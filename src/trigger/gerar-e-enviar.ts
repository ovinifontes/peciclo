import { logger, task } from "@trigger.dev/sdk";
import { lerConfig } from "../config.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gerarPlanilha, legendaPlanilha } from "../planilha/gerar.js";
import { enviarDocumento, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import { detectarAnomalias } from "../planilha/anomalias.js";
import { lerAbateMensal } from "../dados/mensal.js";
import {
  listarTelefonesAtivos,
  motivoNinguemRecebeu,
  unirDestinatarios,
} from "../dados/perfis.js";

export const gerarEEnviar = task({
  id: "gerar-e-enviar",
  machine: "small-2x",
  maxDuration: 600,
  run: async (payload: { dataReferencia: string; ufsComFalha: string[] }) => {
    const cfg = lerConfig();
    const arquivo = await gerarPlanilha();

    // Alerta, nunca bloqueia: a planilha vai de qualquer forma.
    // dataReferencia = "AAAA-MM-DD" de hoje; o mês dela é o mês em andamento.
    const competenciaAtual = {
      ano: Number(payload.dataReferencia.slice(0, 4)),
      mes: Number(payload.dataReferencia.slice(5, 7)),
    };
    const anomalias = detectarAnomalias(await lerAbateMensal(), competenciaAtual);
    if (anomalias.length > 0) {
      await alertarOperador(
        `Valores fora do padrão em ${anomalias.length} série(s)`,
        anomalias.map((a) => a.mensagem).join("\n"),
      );
    }
    const nomeArquivo = `abate-ciclo-pecuario-${payload.dataReferencia}.xlsx`;

    await arquivarBruto({ caminho: `planilhas/${nomeArquivo}`, conteudo: arquivo });

    if (!(await instanciaConectada({
      instancia: cfg.evolutionInstancia,
      apiKey: cfg.evolutionApiKey,
      baseUrl: cfg.evolutionBaseUrl,
    }))) {
      await alertarOperador(
        "Instância da Evolution desconectada",
        `A planilha de ${payload.dataReferencia} foi gerada e arquivada, mas não pôde ser enviada.`,
      );
      return { enviados: 0, arquivada: true };
    }

    let enviados = 0;
    // Clientes ativos do banco ∪ configuração. A configuração fica como rede de
    // segurança: tabela vazia ou consulta falhando não pode zerar o envio.
    const doBanco = await listarTelefonesAtivos();
    const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
    logger.info("destinatários resolvidos", {
      configuracao: cfg.whatsappDestinatarios.length,
      banco: doBanco.length,
      total: destinatarios.length,
    });

    for (const numero of destinatarios) {
      try {
        await enviarDocumento({
          instancia: cfg.evolutionInstancia,
          apiKey: cfg.evolutionApiKey,
          baseUrl: cfg.evolutionBaseUrl,
          numero,
          arquivo,
          nomeArquivo,
          legenda: legendaPlanilha(payload.dataReferencia, payload.ufsComFalha),
        });
        enviados++;
      } catch (erro) {
        // Um destinatário com problema não pode impedir os outros de receber.
        logger.error("falha ao enviar para destinatário", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    // Sem esta guarda o run fecha VERDE com `enviados: 0`: a Evolution aceita a
    // conexão mas recusa todo envio, ou a lista vem vazia, e ninguém fica sabendo.
    const ninguem = motivoNinguemRecebeu("a planilha", enviados, destinatarios.length);
    if (ninguem) {
      await alertarOperador(
        `Planilha de ${payload.dataReferencia} não chegou a ninguém`,
        `${ninguem}. Ela foi gerada e arquivada.`,
      );
    }

    return { enviados, arquivada: true };
  },
});
