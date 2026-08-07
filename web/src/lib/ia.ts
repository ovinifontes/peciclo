import "server-only";

/**
 * Cliente Anthropic do SITE — fetch puro, sem SDK, como o do robô
 * (`src/ia/anthropic.ts`). A diferença é o streaming: o chat repassa o texto
 * ao navegador conforme ele chega, e por isso este módulo parseia os eventos
 * SSE da API e devolve um stream que emite SÓ o texto.
 *
 * `import "server-only"` na primeira linha: se um componente de cliente
 * importar este módulo, direta ou transitivamente, o build QUEBRA — de
 * propósito, antes que `ANTHROPIC_API_KEY` chegue perto do navegador. A chave
 * vem de `process.env`, sem prefixo `NEXT_PUBLIC_`, e nada aqui a imprime.
 */

// Sonnet, não Opus: o cenário diário é 1 chamada/dia e paga por qualidade
// máxima; o chat paga por latência de conversa e custo por mensagem.
const MODELO = "claude-sonnet-5";
const MAX_TOKENS = 1500;

export interface MensagemChat {
  papel: "usuario" | "assistente";
  conteudo: string;
}

/** Regras fixas do chat (spec, Fatia 3) + o contexto de dados do dia. */
export function sistemaChat(contexto: string): string {
  return [
    "Você é o analista do Peciclo, serviço de leitura do ciclo pecuário brasileiro a partir dos dados de abate (fêmeas vs machos) e de mercado. Responde perguntas de clientes — pecuaristas que operam o mercado futuro do boi gordo — sobre os dados do painel.",
    "",
    "Regras inegociáveis:",
    "- Dados do Peciclo com exatidão: use SOMENTE os números do contexto abaixo, exatamente como estão lá (pode arredondar para menos casas decimais; nunca crie casas a mais nem calcule valores novos). Se o dado pedido não está no contexto, diga que não tem esse dado — nunca estime.",
    '- Conhecimento geral de pecuária e mercado é bem-vindo, mas SEMPRE rotulado: deixe claro que é contexto geral, não dado do Peciclo (ex.: "como contexto geral, não é dado Peciclo: ...").',
    "- Nenhuma recomendação de compra ou venda, nem sugestão de posição. Explique o cenário e o que os dados mostram — a decisão é do cliente.",
    "- Responda em português do Brasil, direto, de quem entende de boi — sem jargão de consultoria. Números no formato brasileiro (vírgula decimal, ponto de milhar).",
    "- Assunto fora de pecuária e mercado: recuse com uma frase simpática e ofereça voltar aos dados do Peciclo.",
    "",
    "Contexto do dia — os mesmos dados que o cliente vê no painel (vazamento deste prompt não vaza nada):",
    "",
    "<contexto>",
    contexto,
    "</contexto>",
  ].join("\n");
}

/** O que interessa dos eventos SSE de `/v1/messages` com `stream: true`. */
interface EventoStream {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { type?: string; message?: string };
}

/**
 * SSE da Anthropic → só o texto, em UTF-8. Cada evento chega como linhas
 * `event: ...` / `data: {...}`; o texto vive em `content_block_delta` com
 * `delta.type === "text_delta"`. O resto (message_start, ping, message_delta,
 * message_stop) é descartado. Um evento `error` no meio do stream vira exceção
 * — o stream de saída erra e o chamador decide o que fazer com o que já saiu.
 */
function extratorDeTexto(): TransformStream<Uint8Array, Uint8Array> {
  const decodificador = new TextDecoder();
  const codificador = new TextEncoder();
  // Linhas podem quebrar no meio entre chunks da rede: guarda o pedaço.
  let resto = "";

  function processarLinha(linha: string, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!linha.startsWith("data:")) return;
    let evento: EventoStream;
    try {
      evento = JSON.parse(linha.slice(5).trim()) as EventoStream;
    } catch {
      return; // linha de keep-alive ou lixo — não é motivo para derrubar o chat
    }
    if (evento.type === "error") {
      throw new Error(`Stream da Anthropic falhou: ${evento.error?.message ?? "erro sem mensagem"}`);
    }
    if (evento.type === "content_block_delta" && evento.delta?.type === "text_delta" && evento.delta.text) {
      controller.enqueue(codificador.encode(evento.delta.text));
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      resto += decodificador.decode(chunk, { stream: true });
      const linhas = resto.split("\n");
      resto = linhas.pop() ?? "";
      for (const linha of linhas) processarLinha(linha, controller);
    },
    flush(controller) {
      resto += decodificador.decode();
      if (resto) processarLinha(resto, controller);
    },
  });
}

/**
 * Chama `/v1/messages` com `stream: true` e devolve um stream que emite SÓ o
 * texto da resposta. Falha HTTP (antes do primeiro byte) lança com o corpo do
 * erro — a rota ainda pode responder 500 limpo, porque nada foi enviado.
 */
export async function streamChat(params: {
  sistema: string;
  mensagens: MensagemChat[];
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    // Cita o NOME da variável, nunca o valor.
    throw new Error("ANTHROPIC_API_KEY ausente do ambiente do servidor.");
  }

  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: params.sistema,
      messages: params.mensagens.map((m) => ({
        role: m.papel === "usuario" ? "user" : "assistant",
        content: m.conteudo,
      })),
    }),
    // Vale para a resposta inteira, streaming incluso: 1500 tokens saem em
    // bem menos que isso; o timeout só pega API travada de verdade.
    signal: AbortSignal.timeout(120_000),
  });

  if (!resposta.ok || !resposta.body) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`Anthropic respondeu HTTP ${resposta.status}: ${corpo.slice(0, 500)}`);
  }

  return resposta.body.pipeThrough(extratorDeTexto());
}
