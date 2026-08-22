import { logger, schedules } from "@trigger.dev/sdk";
import { coletarSigsif } from "../coletores/sigsif.js";
import { coletarCepea, coletarFuturos, dentroDaFaixa } from "../coletores/precos.js";
import { gravarAbateSif, gravarPrecos } from "../dados/experimental.js";
import { gerarPlanilhaExperimental } from "../planilha/gerar-experimental.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { enviarDocumento, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import { lerConfig } from "../config.js";
import { listarTelefonesAtivos, unirDestinatarios } from "../dados/perfis.js";
import type { Futuro } from "../coletores/precos.js";

/**
 * Rotina da planilha COMPLETA — roda 30 min depois da tradicional, com os
 * dados adicionais (GO e SP pelo SIGSIF federal, preços do CEPEA e futuros da
 * B3). Validada pelo sócio em 05/08/2026 e promovida a envio padrão.
 *
 * Continua ISOLADA de propósito: não compartilha task, tabela nem gerador com
 * a rotina tradicional. Se qualquer coisa aqui falhar, a planilha das 06:00
 * não é afetada.
 *
 * O id da task segue "coleta-experimental" de propósito: renomear criaria um
 * agendamento novo e deixaria o antigo órfão, com risco de envio duplicado.
 */
export const coletaExperimental = schedules.task({
  id: "coleta-experimental",
  cron: {
    pattern: "30 6 * * *", // 30 min depois da coleta oficial
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-2x",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const cfg = lerConfig();
    // O agendamento fornece timestamp/timezone; um disparo manual pelo painel
    // ou pela API pode vir sem eles — cair para "agora" evita quebrar o teste.
    // new Date() aceita tanto o Date do agendamento quanto a string ISO que
    // chega num disparo manual pela API.
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    const dataLocal = quando.toLocaleDateString("en-CA", { timeZone: fuso });
    const problemas: string[] = [];

    // --- GO, SP e MT (SIGSIF federal) ---
    // MT entrou em 22/08/2026 como rede de segurança: o InfoSindesa congelou
    // na migração do INDEA e esta série (~90% do abate de MT, só inspeção
    // federal) garante que nunca ficamos às cegas. Tendência, não nível.
    let mesesSif = 0;
    try {
      const dados = await coletarSigsif(["GO", "SP", "MT"]);
      mesesSif = await gravarAbateSif(dados);
      logger.info("SIGSIF coletado", { linhas: mesesSif });
    } catch (erro) {
      problemas.push(`SIGSIF: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    // --- Preços do CEPEA ---
    let precosGravados = 0;
    try {
      const precos = (await coletarCepea()).filter((p) => {
        if (dentroDaFaixa(p)) return true;
        problemas.push(`preço fora da faixa esperada, descartado: ${p.serie}=${p.valor}`);
        return false;
      });
      precosGravados = await gravarPrecos(precos);
      logger.info("CEPEA coletado", { precos: precosGravados });
    } catch (erro) {
      problemas.push(`CEPEA: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    // --- Curva de futuros da B3 (não persistida: é sempre o retrato do dia) ---
    let futuros: Futuro[] = [];
    try {
      futuros = await coletarFuturos();
      logger.info("futuros B3 coletados", { contratos: futuros.length });
    } catch (erro) {
      problemas.push(`futuros B3: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    // --- Planilha e envio ---
    const arquivo = await gerarPlanilhaExperimental(futuros);
    const nomeArquivo = `abate-ciclo-completo-${dataLocal}.xlsx`;
    await arquivarBruto({ caminho: `planilhas-completa/${nomeArquivo}`, conteudo: arquivo });

    let enviados = 0;
    // Mesma lista da rotina das 06:00: as duas planilhas são padrão, então um
    // cliente cadastrado no banco precisa receber as duas.
    const doBanco = await listarTelefonesAtivos();
    const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
    logger.info("destinatários resolvidos", {
      configuracao: cfg.whatsappDestinatarios.length,
      banco: doBanco.length,
      total: destinatarios.length,
    });

    if (await instanciaConectada({
      instancia: cfg.evolutionInstancia,
      apiKey: cfg.evolutionApiKey,
      baseUrl: cfg.evolutionBaseUrl,
    })) {
      for (const numero of destinatarios) {
        try {
          await enviarDocumento({
            instancia: cfg.evolutionInstancia,
            apiKey: cfg.evolutionApiKey,
            baseUrl: cfg.evolutionBaseUrl,
            numero,
            arquivo,
            nomeArquivo,
            legenda:
              `📊 Abate + Mercado — ${dataLocal}\n` +
              `Os 6 estados (Goiás e São Paulo vêm da inspeção federal: use a tendência, não o nível) ` +
              `mais preços do boi gordo e do bezerro e a curva de futuros da B3.\n` +
              `Fonte dos preços: CEPEA-ESALQ/USP.`,
          });
          enviados++;
        } catch (erro) {
          logger.error("falha ao enviar experimental", {
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
      }
    } else {
      problemas.push("instância da Evolution desconectada");
    }

    if (problemas.length > 0) {
      await alertarOperador(
        `Planilha completa ${dataLocal}: ${problemas.length} problema(s)`,
        problemas.join("\n"),
      );
    }

    return { data: dataLocal, linhasSif: mesesSif, precos: precosGravados, futuros: futuros.length, enviados, problemas };
  },
});
