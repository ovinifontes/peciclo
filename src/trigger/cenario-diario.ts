import { logger, schedules } from "@trigger.dev/sdk";
import { lerConfig } from "../config.js";
import { lerAbateMensal } from "../dados/mensal.js";
import { lerPrecos } from "../dados/experimental.js";
import { coletarFuturos } from "../coletores/precos.js";
import { lerCiclo, serieComposicaoFixa } from "../ciclo/leitura.js";
import { formatarDataBr, futurosParaDossie, montarDossie } from "../ia/dossie.js";
import type { FuturoDia } from "../ia/dossie.js";
import { validarTexto } from "../ia/validacao.js";
import { textoReserva } from "../ia/reserva.js";
import { sistemaCenario, usuarioCenario, usuarioCorrecao } from "../ia/prompt.js";
import { gerarTexto } from "../ia/anthropic.js";
import { gravarCenario } from "../dados/cenarios.js";
import { enviarTexto, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import { listarTelefonesAtivos, unirDestinatarios } from "../dados/perfis.js";

const MODELO = "claude-opus-5";
const MAX_TOKENS = 1200;

/**
 * Cenário diário escrito por IA — roda 15 min depois da planilha completa,
 * quando os preços do dia já estão gravados em `peciclo_precos`.
 *
 * O princípio que governa tudo: a IA escreve, mas nunca inventa número. Ela só
 * vê o dossiê; todo número do texto é conferido contra ele (`validarTexto`);
 * reprovou duas vezes (ou a API falhou), entra o texto determinístico de
 * reserva e o operador é alertado. O cliente nunca recebe texto não conferido
 * — e nunca fica sem texto.
 *
 * ISOLADA de propósito, como as demais: se qualquer coisa aqui falhar, as
 * planilhas das 06:00/06:30 não são afetadas. E esta rotina NUNCA lança para o
 * agendador: falha vira alerta ao operador.
 */
export const cenarioDiario = schedules.task({
  id: "cenario-diario",
  cron: {
    pattern: "45 6 * * *",
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    // Payload defensivo: o agendamento manda timestamp/timezone, um disparo
    // manual pela API pode vir sem eles — cair para "agora" evita quebrar.
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    const dataLocal = quando.toLocaleDateString("en-CA", { timeZone: fuso });

    try {
      return await executar(dataLocal);
    } catch (erro) {
      // Falha inesperada (leitura do banco, config): alerta e devolve — o
      // fazendeiro nunca recebe erro, quem sabe que quebrou é a operação.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("cenário diário falhou", { erro: mensagem });
      try {
        await alertarOperador(`Cenário diário ${dataLocal} NÃO saiu`, mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { data: dataLocal, origem: null, enviados: 0, erro: mensagem };
    }
  },
});

async function executar(dataLocal: string) {
  const cfg = lerConfig();
  const problemas: string[] = [];

  // --- Dados: tudo já está no banco (a rotina das 06:30 gravou os preços);
  // --- só os futuros são coletados ao vivo, porque são o retrato do dia.
  const abate = await lerAbateMensal();
  const precos = (await lerPrecos()).map((p) => ({ serie: p.serie, data: p.data, valor: p.valor }));

  let futuros: FuturoDia[] = [];
  try {
    futuros = futurosParaDossie(await coletarFuturos());
    logger.info("futuros B3 coletados", { contratos: futuros.length });
  } catch (erro) {
    // Sem futuros o dossiê segue — o texto simplesmente não os menciona.
    problemas.push(`futuros B3: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  const dossie = montarDossie({
    hoje: dataLocal,
    ciclo: lerCiclo(abate),
    serie: serieComposicaoFixa(abate),
    precos,
    futuros,
  });

  // --- Geração com validação número a número; 1 regeneração; depois reserva.
  let texto: string | null = null;
  let origem: "ia" | "reserva" = "ia";
  try {
    const sistema = sistemaCenario();
    const primeira = await gerarTexto({
      modelo: MODELO,
      sistema,
      usuario: usuarioCenario(dossie),
      maxTokens: MAX_TOKENS,
    });
    const v1 = validarTexto(primeira, dossie);
    if (v1.ok) {
      texto = primeira;
    } else {
      problemas.push(`1ª geração reprovada na validação: ${v1.invalidos.join(", ")}`);
      const segunda = await gerarTexto({
        modelo: MODELO,
        sistema,
        usuario: usuarioCorrecao(dossie, v1.invalidos),
        maxTokens: MAX_TOKENS,
      });
      const v2 = validarTexto(segunda, dossie);
      if (v2.ok) texto = segunda;
      else problemas.push(`2ª geração reprovada na validação: ${v2.invalidos.join(", ")}`);
    }
  } catch (erro) {
    problemas.push(`API da Anthropic: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  if (texto === null) {
    origem = "reserva";
    texto = textoReserva(dossie);
    logger.warn("cenário caiu para o texto de reserva");
  }

  // --- Grava SEMPRE, mesmo a reserva: o painel nunca fica sem o dia.
  try {
    await gravarCenario({
      data: dataLocal,
      texto,
      origem,
      modelo: origem === "ia" ? MODELO : null,
      dossie,
    });
  } catch (erro) {
    // Gravação falhou mas o texto existe e foi validado: o envio ainda vale.
    problemas.push(`gravação do cenário: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  // --- Envio por WhatsApp: mesma lista das planilhas (banco ∪ configuração).
  const doBanco = await listarTelefonesAtivos();
  const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
  logger.info("destinatários resolvidos", {
    configuracao: cfg.whatsappDestinatarios.length,
    banco: doBanco.length,
    total: destinatarios.length,
  });

  // A reserva já abre com "Resumo do dia — data"; o texto da IA ganha título.
  const mensagem =
    origem === "ia" ? `📈 Cenário Peciclo — ${formatarDataBr(dataLocal)}\n\n${texto}` : texto;

  let enviados = 0;
  const conectada = await instanciaConectada({
    instancia: cfg.evolutionInstancia,
    apiKey: cfg.evolutionApiKey,
    baseUrl: cfg.evolutionBaseUrl,
  }).catch(() => false);

  if (conectada) {
    for (const numero of destinatarios) {
      try {
        await enviarTexto({
          instancia: cfg.evolutionInstancia,
          apiKey: cfg.evolutionApiKey,
          baseUrl: cfg.evolutionBaseUrl,
          numero,
          texto: mensagem,
        });
        enviados++;
      } catch (erro) {
        // Falha por destinatário não derruba o lote.
        logger.error("falha ao enviar cenário", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  } else {
    problemas.push("instância da Evolution desconectada");
  }

  if (problemas.length > 0) {
    await alertarOperador(
      `Cenário diário ${dataLocal}: ${problemas.length} problema(s)`,
      problemas.join("\n"),
    );
  }

  return { data: dataLocal, origem, caracteres: texto.length, enviados, problemas };
}
