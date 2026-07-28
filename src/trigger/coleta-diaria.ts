import { batch, logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { coletorMt } from "./coletor-mt.js";
import { coletorPa } from "./coletor-pa.js";
import { gerarEEnviar } from "./gerar-e-enviar.js";
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
    const janela = { inicio: dataLocal, fim: dataLocal };
    const ano = Number(dataLocal.slice(0, 4));
    const mes = Number(dataLocal.slice(5, 7));

    // batch.triggerByTaskAndWait roda em paralelo e espera todos; um filho que
    // falha não derruba o pai, então a planilha sai com o que temos.
    // MS e PA dão detalhe por GTA (janela do dia / arquivo do mês); MT e RO são
    // agregados por competência (o INDEA e o Power BI já vêm somados por mês).
    const { runs } = await batch.triggerByTaskAndWait([
      { task: coletorMs, payload: { janela } },
      { task: coletorMt, payload: { ano, mes, ateIso: dataLocal } },
      { task: coletorPa, payload: { ano } },
    ]);

    const ufs = ["MS", "MT", "PA"] as const;
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

    await gerarEEnviar.triggerAndWait({
      dataReferencia: dataLocal,
      ufsComFalha: falhas.map((f) => f.uf),
    });

    if (falhas.length > 0) {
      await alertarOperador(
        `Coleta ${dataLocal}: ${falhas.length} de ${ufs.length} coletores falharam`,
        falhas.map((f) => `${f.uf}: ${f.erro}`).join("\n"),
      );
    }

    return { data: dataLocal, falhas };
  },
});
