import { lerConfig } from "../config.js";
import { normalizarNumero } from "./evolution.js";

/**
 * Alerta técnico, só para o operador. O fazendeiro nunca recebe mensagem de
 * erro: ele recebe a planilha, e quem sabe que algo quebrou é a operação.
 */
export async function alertarOperador(assunto: string, detalhe: string): Promise<void> {
  const cfg = lerConfig();
  const url = `${cfg.evolutionBaseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.evolutionInstancia)}`;

  const resposta = await fetch(url, {
    method: "POST",
    headers: { apikey: cfg.evolutionApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      number: normalizarNumero(cfg.whatsappOperador),
      text: `⚠️ ${assunto}\n\n${detalhe}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  // Falha de alerta nunca deve derrubar a coleta que ela está reportando.
  if (!resposta.ok) {
    console.error(`Falha ao alertar operador: HTTP ${resposta.status}`);
  }
}
