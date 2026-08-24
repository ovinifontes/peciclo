import { logger, schedules } from "@trigger.dev/sdk";
import { lerConfig } from "../config.js";
import { lerAbateMensal } from "../dados/mensal.js";
import { lerPrecos } from "../dados/experimental.js";
import { coletarFuturos } from "../coletores/precos.js";
import { lerCiclo, serieComposicaoFixa } from "../ciclo/leitura.js";
import { formatarDataBr, futurosParaDossie, montarDossie } from "../ia/dossie.js";
import type { FuturoDia } from "../ia/dossie.js";
import { validarTexto } from "../ia/validacao.js";
import { resumoReserva, textoReserva } from "../ia/reserva.js";
import {
  sistemaCenario,
  LIMITE_RESUMO,
  sistemaResumo,
  usuarioCenario,
  usuarioCorrecao,
  usuarioResumo,
  usuarioResumoCorrecao,
} from "../ia/prompt.js";
import { gerarTexto } from "../ia/anthropic.js";
import { gravarCenario, lerCenarioDoDia, marcarEnviado } from "../dados/cenarios.js";
import { enviarTexto, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import {
  listarTelefonesAtivos,
  motivoNinguemRecebeu,
  unirDestinatarios,
} from "../dados/perfis.js";

const MODELO = "claude-opus-5";
// Folga larga de propósito: o Opus 5 raciocina antes de escrever e o
// raciocínio CONTA no max_tokens. Com 1200, num dia de raciocínio longo a
// resposta truncou (stop_reason=max_tokens, 08/08) e o cliente recebeu a
// reserva. O tamanho do texto quem governa é o prompt; o teto é só
// disjuntor — e só se paga o que for gerado, não o teto.
const MAX_TOKENS = 8000;
const MAX_TOKENS_RESUMO = 4000;

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
 * Dois textos por dia: o COMPLETO (fica só no site) e o RESUMO (o que sai no
 * WhatsApp), cada um com a mesma escada geração→validação→reserva. E o envio
 * é ÚNICO por dia: `enviado_em` em `peciclo_cenarios` é o cadeado — redisparar
 * a rotina atualiza os textos, mas nunca manda a mensagem de novo.
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
      return { data: dataLocal, origem: null, enviados: 0, jaEnviado: false, erro: mensagem };
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

  // --- Resumo para o WhatsApp: mesma escada geração→validação→reserva, com o
  // --- completo como matéria-prima. Se o próprio completo já é a reserva, não
  // --- há por que insistir na API: o resumo determinístico entra direto.
  let resumo: string | null = null;
  let origemResumo: "ia" | "reserva" = "ia";
  if (origem === "ia") {
    try {
      const sistema = sistemaResumo();
      const primeira = await gerarTexto({
        modelo: MODELO,
        sistema,
        usuario: usuarioResumo(dossie, texto),
        maxTokens: MAX_TOKENS_RESUMO,
      });
      // Reprova por número inventado OU por tamanho — as duas coisas quebram
      // a promessa do produto (a segunda quebrou no dia 12/08: 672 caracteres
      // "dentro do prompt" viram uma tela inteira de celular).
      const reprovas = (t: string): string[] => {
        const v = validarTexto(t, dossie);
        const lista = v.ok ? [] : [`números fora do dossiê: ${v.invalidos.join(", ")}`];
        if (t.length > LIMITE_RESUMO) {
          lista.push(`TAMANHO: ${t.length} caracteres (máximo ${LIMITE_RESUMO})`);
        }
        return lista;
      };

      const r1 = reprovas(primeira);
      if (r1.length === 0) {
        resumo = primeira;
      } else {
        problemas.push(`resumo: 1ª geração reprovada: ${r1.join("; ")}`);
        const segunda = await gerarTexto({
          modelo: MODELO,
          sistema,
          usuario: usuarioResumoCorrecao(dossie, texto, r1),
          maxTokens: MAX_TOKENS_RESUMO,
        });
        const r2 = reprovas(segunda);
        if (r2.length === 0) resumo = segunda;
        else problemas.push(`resumo: 2ª geração reprovada: ${r2.join("; ")}`);
      }
    } catch (erro) {
      problemas.push(`resumo (API da Anthropic): ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  if (resumo === null) {
    origemResumo = "reserva";
    resumo = resumoReserva(dossie);
    logger.warn("resumo caiu para a versão determinística");
  }

  // --- Grava SEMPRE os dois textos, mesmo quando não vai enviar: o painel
  // --- nunca fica sem o dia (e o upsert não toca em `enviado_em`).
  try {
    await gravarCenario({
      data: dataLocal,
      texto,
      resumo,
      origem,
      modelo: origem === "ia" ? MODELO : null,
      dossie,
    });
  } catch (erro) {
    // Gravação falhou mas os textos existem e foram validados: o envio ainda vale.
    problemas.push(`gravação do cenário: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  // --- Cadeado do envio único: já saiu WhatsApp hoje? Então os textos acima
  // --- foram atualizados e a rotina para por aqui — nada de mensagem dupla.
  let jaEnviado = false;
  let podeEnviar = true;
  try {
    const doDia = await lerCenarioDoDia(dataLocal);
    if (doDia?.enviado_em) {
      jaEnviado = true;
      podeEnviar = false;
      logger.info("já enviado hoje — textos atualizados, WhatsApp não reenvia", {
        enviadoEm: doDia.enviado_em,
      });
    }
  } catch (erro) {
    // Sem conseguir checar, não dá para garantir o envio único — e mensagem
    // duplicada ao cliente é pior que atraso. Não envia; o operador é avisado.
    podeEnviar = false;
    problemas.push(
      `checagem de envio único falhou (${erro instanceof Error ? erro.message : String(erro)}); por segurança, não enviou`,
    );
  }

  let enviados = 0;
  if (podeEnviar) {
    // --- Envio por WhatsApp: mesma lista das planilhas (banco ∪ configuração).
    const doBanco = await listarTelefonesAtivos();
    const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
    logger.info("destinatários resolvidos", {
      configuracao: cfg.whatsappDestinatarios.length,
      banco: doBanco.length,
      total: destinatarios.length,
    });

    // No WhatsApp vai SEMPRE o resumo com o título do dia — o completo é do site.
    const mensagem = `📈 Cenário Peciclo — ${formatarDataBr(dataLocal)}\n\n${resumo}`;

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
      // Conectada e ainda assim ninguém recebeu (todo envio recusado, ou lista
      // vazia): sem isto o run fecha verde com `enviados: 0` e ninguém sabe.
      const ninguem = motivoNinguemRecebeu("o cenário", enviados, destinatarios.length);
      if (ninguem) problemas.push(ninguem);
    } else {
      problemas.push("instância da Evolution desconectada");
    }

    // Chegou em pelo menos um cliente: o dia está fechado para novos envios.
    if (enviados > 0) {
      try {
        await marcarEnviado(dataLocal);
      } catch (erro) {
        problemas.push(
          `marcarEnviado falhou (${erro instanceof Error ? erro.message : String(erro)}) — um redisparo hoje reenviaria`,
        );
      }
    }
  }

  if (problemas.length > 0) {
    await alertarOperador(
      `Cenário diário ${dataLocal}: ${problemas.length} problema(s)`,
      problemas.join("\n"),
    );
  }

  return {
    data: dataLocal,
    origem,
    origemResumo,
    caracteres: texto.length,
    caracteresResumo: resumo.length,
    enviados,
    jaEnviado,
    problemas,
  };
}
