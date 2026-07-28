import { logger, schedules } from "@trigger.dev/sdk";
import { descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { encontrarPastaDoAno } from "../coletores/pa.js";
import { alertarOperador } from "../notificacao/alertas.js";

const CHAVE_RO_CONHECIDA = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

/**
 * Os dois portais que dependem de identificadores externos podem mudá-los sem
 * aviso, e a coleta pararia em silêncio. Esta verificação transforma um
 * silêncio em alerta.
 */
export const verificarFontes = schedules.task({
  id: "verificar-fontes",
  cron: { pattern: "0 7 * * 1", timezone: "America/Sao_Paulo", environments: ["PRODUCTION"] },
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async () => {
    const problemas: string[] = [];

    const urlRo = await descobrirRelatorio();
    const chaveRo = urlRo ? extrairChaveRecurso(urlRo) : null;
    if (!chaveRo) problemas.push("IDARON: não encontrei o link do Power BI na página");
    else if (chaveRo !== CHAVE_RO_CONHECIDA) {
      problemas.push(`IDARON: resource key mudou para ${chaveRo} — atualizar CHAVE_PADRAO`);
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      const ano = new Date().getUTCFullYear();
      if (!(await encontrarPastaDoAno(ano, apiKey))) {
        problemas.push(`ADEPARA: não encontrei a pasta de ${ano} no Drive`);
      }
    }

    if (problemas.length > 0) {
      await alertarOperador("Verificação de fontes encontrou problemas", problemas.join("\n"));
    }
    logger.info("verificação de fontes concluída", { problemas: problemas.length });
    return { problemas };
  },
});
