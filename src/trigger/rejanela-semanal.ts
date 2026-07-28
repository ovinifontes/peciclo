import { logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { alertarOperador } from "../notificacao/alertas.js";

const DIAS_REJANELA = 10;

export const rejanelaSemanal = schedules.task({
  id: "rejanela-semanal",
  cron: { pattern: "0 5 * * 0", timezone: "America/Sao_Paulo", environments: ["PRODUCTION"] },
  machine: "small-1x",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const hoje = payload.timestamp.toLocaleDateString("en-CA", { timeZone: payload.timezone });
    const datas: string[] = [];
    for (let i = 1; i <= DIAS_REJANELA; i++) {
      const d = new Date(`${hoje}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      datas.push(d.toISOString().slice(0, 10));
    }

    const lotes = datas.map((data) => ({
      payload: { janela: { inicio: data, fim: data }, tipo: "rejanela" as const },
    }));

    const ms = await coletorMs.batchTriggerAndWait(lotes);

    const falhas = ms.runs.filter((r) => !r.ok).length;
    logger.info("rejanela concluída", { dias: DIAS_REJANELA, falhas });

    if (falhas > 0) {
      await alertarOperador(
        "Rejanela semanal com falhas",
        `${falhas} de ${lotes.length} execuções (MS) falharam nos últimos ${DIAS_REJANELA} dias.`,
      );
    }
    return { dias: DIAS_REJANELA, falhas };
  },
});
