import { batch, logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { coletorMt } from "./coletor-mt.js";
import { coletorRo } from "./coletor-ro.js";
import { coletorPa } from "./coletor-pa.js";
import { gerarEEnviar } from "./gerar-e-enviar.js";
import { recoleta } from "./recoleta.js";
import { alertarOperador } from "../notificacao/alertas.js";

export const coletaDiaria = schedules.task({
  id: "coleta-diaria",
  cron: {
    pattern: "0 6 * * *",
    // Sem timezone explícito o Trigger.dev agenda em UTC, o que dispararia
    // às 3h da manhã no Brasil.
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const dataLocal = payload.timestamp.toLocaleDateString("en-CA", {
      timeZone: payload.timezone,
    });
    const ano = Number(dataLocal.slice(0, 4));
    const mes = Number(dataLocal.slice(5, 7));
    // Mês corrente até hoje. Todos os coletores reconsultam a competência
    // inteira, então cada execução recalcula o mês em vez de depender do
    // acúmulo dia a dia — se um dia falhar, o seguinte conserta sozinho.
    const janela = { inicio: `${ano}-${String(mes).padStart(2, "0")}-01`, fim: dataLocal };

    // batch.triggerByTaskAndWait roda em paralelo e espera todos; um filho que
    // falha não derruba o pai, então a planilha sai com o que temos.
    // MS e PA dão detalhe por GTA (janela do dia / arquivo do mês); MT e RO são
    // agregados por competência (o INDEA e o Power BI já vêm somados por mês).
    const { runs } = await batch.triggerByTaskAndWait([
      { task: coletorMs, payload: { janela } },
      { task: coletorMt, payload: { ano, mes, ateIso: dataLocal } },
      { task: coletorRo, payload: { ano, mes } },
      { task: coletorPa, payload: { ano } },
    ]);

    const ufs = ["MS", "MT", "RO", "PA"] as const;
    const falhas: Array<{ uf: string; erro: string }> = [];

    runs.forEach((r, i) => {
      if (r.ok) {
        logger.info(`coletor ${ufs[i]} ok`, { saida: r.output });
      } else {
        const erro = r.error instanceof Error ? r.error.message : String(r.error);
        falhas.push({ uf: ufs[i]!, erro });
        logger.error(`coletor ${ufs[i]} falhou`, { erro });
      }
    });

    // triggerAndWait devolve o desfecho em vez de lançar: sem checar `.ok`, uma
    // planilha que estoura passa como sucesso e o cliente fica sem planilha E
    // sem aviso (os coletores tinham ido bem, então nada mais alertaria).
    const planilha = await gerarEEnviar.triggerAndWait({
      dataReferencia: dataLocal,
      ufsComFalha: falhas.map((f) => f.uf),
    });
    if (!planilha.ok) {
      const erro =
        planilha.error instanceof Error ? planilha.error.message : String(planilha.error);
      logger.error("geração/envio da planilha falhou", { erro });
      await alertarOperador(`Planilha de ${dataLocal} NÃO saiu`, erro);
    }

    if (falhas.length > 0) {
      // Recoleta automática só das UFs que falharam, 45 min depois (até 2
      // tentativas; ela mesma se reagenda). Antes do alerta e protegida por
      // try/catch: nem alerta indisponível nem API do Trigger fora do ar podem
      // derrubar uma coleta que já terminou.
      try {
        await recoleta.trigger(
          { ufs: falhas.map((f) => f.uf), dataReferencia: dataLocal, tentativa: 1 },
          { delay: "45m" },
        );
      } catch (erro) {
        logger.error("falha ao agendar a recoleta", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
      await alertarOperador(
        `Coleta ${dataLocal}: ${falhas.length} de ${ufs.length} coletores falharam`,
        falhas.map((f) => `${f.uf}: ${f.erro}`).join("\n"),
        // Identidade pela LISTA DE ESTADOS, não pelo texto: a data no assunto
        // faria "MT falhou" virar notícia nova todo dia. Mudou o conjunto de
        // estados (outro caiu, ou o MT voltou), a chave muda e o alerta sai.
        { chave: `coletores-falharam:${falhas.map((f) => f.uf).sort().join(",")}` },
      );
    }

    return { data: dataLocal, falhas };
  },
});
