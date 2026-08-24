import { logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { coletorRo } from "./coletor-ro.js";
import { alertarOperador } from "../notificacao/alertas.js";

const DIAS_REJANELA = 10;

/**
 * Meses fechados do RO que voltamos a consultar toda semana.
 *
 * O painel do IDARON se ENCHE DEVAGAR: julho/2026 estava em 210.362 quando o
 * mês virou e em 222.484 vinte e quatro dias depois — e nada revisitava mês
 * fechado, então o número congelava no primeiro retrato e o cliente via uma
 * queda que não existiu (jul/25 fechou em 342.093). Três meses cobrem com
 * folga o tempo de assentamento observado, ao custo de 3 consultas por semana.
 */
const MESES_REVISITA_RO = 3;

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

    // RO: reconsulta os meses fechados recentes (ver MESES_REVISITA_RO).
    const [ano, mes] = hoje.split("-").map(Number);
    const mesesRo: Array<{ ano: number; mes: number }> = [];
    for (let i = 1; i <= MESES_REVISITA_RO; i++) {
      const d = new Date(Date.UTC(ano!, mes! - 1 - i, 1));
      mesesRo.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 });
    }
    const ro = await coletorRo.batchTriggerAndWait(mesesRo.map((payload) => ({ payload })));
    const falhasRo = ro.runs.filter((r) => !r.ok).length;

    logger.info("rejanela concluída", {
      dias: DIAS_REJANELA,
      falhas,
      mesesRo: mesesRo.map((m) => `${m.ano}-${m.mes}`),
      falhasRo,
    });

    if (falhas > 0 || falhasRo > 0) {
      await alertarOperador(
        "Rejanela semanal com falhas",
        `${falhas} de ${lotes.length} execuções (MS, últimos ${DIAS_REJANELA} dias) e ` +
          `${falhasRo} de ${mesesRo.length} (RO, meses fechados) falharam.`,
      );
    }
    return { dias: DIAS_REJANELA, falhas, mesesRo: mesesRo.length, falhasRo };
  },
});
