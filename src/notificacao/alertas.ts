import { lerConfig } from "../config.js";
import { normalizarNumero } from "./evolution.js";
import {
  JANELA_REPETICAO_DIAS,
  chaveAlerta,
  deveAlertar,
  registrarAlerta,
} from "../dados/alertas-enviados.js";

/**
 * Alerta técnico, só para o operador. O fazendeiro nunca recebe mensagem de
 * erro: ele recebe a planilha, e quem sabe que algo quebrou é a operação.
 *
 * NUNCA lança — nem timeout, nem DNS, nem config faltando. Esta função é
 * chamada no meio de coletas e ANTES do envio da planilha; um soluço da
 * Evolution não pode derrubar a rotina que ela está reportando.
 *
 * Alerta de conteúdo idêntico não se repete dentro de 3 dias (`sempre: true`
 * fura a regra, para o que precisa sair todo dia — boa notícia, por exemplo).
 *
 * `chave` dá IDENTIDADE PRÓPRIA ao alerta, para quando o texto varia mas a
 * notícia é a mesma: "Coleta 24/08: MT falhou" e "Coleta 25/08: MT falhou" têm
 * hashes diferentes e escapariam da supressão, repetindo todo dia a mesma
 * notícia velha. Quem passa `chave` está dizendo "isto é o mesmo assunto" —
 * e quando o conteúdo REAL muda (outro estado falha, o estado se recupera), a
 * chave muda junto e o alerta volta a sair.
 */
export async function alertarOperador(
  assunto: string,
  detalhe: string,
  opcoes: { sempre?: boolean; chave?: string } = {},
): Promise<void> {
  const chave = opcoes.chave ? chaveAlerta(opcoes.chave, "") : chaveAlerta(assunto, detalhe);
  if (!opcoes.sempre && !(await deveAlertar(chave))) {
    console.info(
      `Alerta repetido suprimido (mesmo conteúdo há menos de ${JANELA_REPETICAO_DIAS} dias): ${assunto}`,
    );
    return;
  }

  try {
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

    if (!resposta.ok) {
      console.error(`Falha ao alertar operador: HTTP ${resposta.status}`);
      return; // não registra: alerta que não chegou não pode calar o próximo
    }
  } catch (erro) {
    // Timeout, DNS, ECONNRESET, config ausente: loga e segue. A coleta que
    // este alerta reporta continua valendo.
    console.error(
      `Falha ao alertar operador: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return;
  }

  await registrarAlerta(chave, assunto);
}
