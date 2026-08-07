// Cliente mínimo da API da Anthropic para o ROBÔ — fetch puro, sem SDK, de
// propósito: zero dependência nova no bundle do Trigger. O site tem o cliente
// dele (`web/src/lib/ia.ts`, com streaming); este aqui só gera o texto do dia.
//
// A chave vem direto do ambiente (não do `lerConfig`): ela é exclusiva desta
// rotina, e amarrá-la às OBRIGATORIAS derrubaria todas as coletas se a chave
// sumisse do ambiente.

export class AnthropicApiError extends Error {
  status: number;
  corpo: unknown;
  constructor(mensagem: string, status: number, corpo: unknown) {
    super(mensagem);
    this.name = "AnthropicApiError";
    this.status = status;
    this.corpo = corpo;
  }
}

interface RespostaMessages {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

/**
 * Uma chamada, uma resposta: manda sistema + usuário e devolve o texto.
 * Lança em falha HTTP (com o corpo do erro), em resposta truncada/recusada
 * (`stop_reason` ≠ end_turn) e em texto vazio — o chamador trata tudo igual:
 * tenta de novo e, na segunda falha, cai para o texto de reserva.
 */
export async function gerarTexto(params: {
  modelo: string;
  sistema: string;
  usuario: string;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    throw new AnthropicApiError("ANTHROPIC_API_KEY ausente do ambiente.", 0, null);
  }

  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.modelo,
      max_tokens: params.maxTokens,
      system: params.sistema,
      messages: [{ role: "user", content: params.usuario }],
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 180_000),
  });

  const tipo = resposta.headers.get("content-type") ?? "";
  const corpo = tipo.includes("application/json") ? await resposta.json() : await resposta.text();

  if (!resposta.ok) {
    const detalhe = typeof corpo === "string" ? corpo.slice(0, 500) : JSON.stringify(corpo).slice(0, 500);
    throw new AnthropicApiError(`Anthropic respondeu HTTP ${resposta.status}: ${detalhe}`, resposta.status, corpo);
  }

  const json = corpo as RespostaMessages;

  // Truncou (max_tokens) ou recusou: o texto não está íntegro — melhor falhar
  // aqui e deixar o retry/reserva agir do que enviar frase cortada ao cliente.
  if (json.stop_reason && json.stop_reason !== "end_turn") {
    throw new AnthropicApiError(`Geração terminou com stop_reason="${json.stop_reason}".`, resposta.status, corpo);
  }

  const texto = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  if (!texto.trim()) {
    // Texto vazio passaria na validação numérica (nenhum token = nenhum
    // inválido) e chegaria em branco ao cliente. Nunca.
    throw new AnthropicApiError("Resposta sem texto.", resposta.status, corpo);
  }
  return texto;
}
