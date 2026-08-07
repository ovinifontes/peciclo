export const XLSX_MIMETYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class EvolutionApiError extends Error {
  status: number;
  corpo: unknown;
  constructor(mensagem: string, status: number, corpo: unknown) {
    super(mensagem);
    this.name = "EvolutionApiError";
    this.status = status;
    this.corpo = corpo;
  }
}

/** Aceita máscara e JID; devolve só dígitos, no formato DDI+DDD+numero. */
export function normalizarNumero(numero: string): string {
  const limpo = numero.split("@")[0]!.replace(/\D/g, "");
  if (limpo.length < 10) {
    throw new EvolutionApiError(
      `Número inválido: "${numero}". Use DDI+DDD+numero (ex.: 5567999999999).`,
      0,
      null,
    );
  }
  return limpo;
}

function extrairMensagemErro(corpo: unknown, padrao: string): string {
  const achatar = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  if (corpo && typeof corpo === "object") {
    const c = corpo as Record<string, any>;
    const msg = c.response?.message ?? c.message ?? c.error;
    if (Array.isArray(msg)) return msg.map(achatar).join("; ");
    if (msg != null) return achatar(msg);
  }
  if (typeof corpo === "string" && corpo.trim()) return corpo.slice(0, 500);
  return padrao;
}

/** Confere se a instância está conectada antes de tentar enviar. */
export async function instanciaConectada(args: {
  instancia: string;
  apiKey: string;
  baseUrl: string;
}): Promise<boolean> {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/instance/connectionState/${encodeURIComponent(args.instancia)}`;
  const resposta = await fetch(url, {
    headers: { apikey: args.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resposta.ok) return false;
  const json = (await resposta.json()) as any;
  return (json?.instance?.state ?? json?.state) === "open";
}

/** Mensagem de texto simples — usada pelo cenário diário. */
export async function enviarTexto(params: {
  instancia: string;
  apiKey: string;
  baseUrl: string;
  numero: string;
  texto: string;
  timeoutMs?: number;
}): Promise<unknown> {
  if (!params.texto.trim()) {
    throw new EvolutionApiError("Texto da mensagem vazio.", 0, null);
  }

  const url = `${params.baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(params.instancia)}`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: { apikey: params.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      number: normalizarNumero(params.numero),
      text: params.texto,
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 60_000),
  });

  const tipo = resposta.headers.get("content-type") ?? "";
  const corpo = tipo.includes("application/json") ? await resposta.json() : await resposta.text();

  if (!resposta.ok) {
    throw new EvolutionApiError(
      extrairMensagemErro(corpo, `Evolution respondeu HTTP ${resposta.status}`),
      resposta.status,
      corpo,
    );
  }
  return corpo;
}

export async function enviarDocumento(params: {
  instancia: string;
  apiKey: string;
  baseUrl: string;
  numero: string;
  arquivo: Buffer;
  nomeArquivo: string;
  legenda?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  if (!Buffer.isBuffer(params.arquivo) || params.arquivo.length === 0) {
    throw new EvolutionApiError("Buffer do arquivo vazio ou inválido.", 0, null);
  }
  // O servidor deriva o mimetype de fileName e ignora o mimetype enviado.
  // Sem extensão conhecida, o lookup falha e o arquivo chega quebrado.
  if (!/\.xlsx$/i.test(params.nomeArquivo)) {
    throw new EvolutionApiError(
      `nomeArquivo precisa terminar em .xlsx (recebido: "${params.nomeArquivo}").`,
      0,
      null,
    );
  }

  const url = `${params.baseUrl.replace(/\/+$/, "")}/message/sendMedia/${encodeURIComponent(params.instancia)}`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: { apikey: params.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      number: normalizarNumero(params.numero),
      mediatype: "document",
      mimetype: XLSX_MIMETYPE,
      fileName: params.nomeArquivo,
      caption: params.legenda ?? "",
      media: params.arquivo.toString("base64"),
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
  });

  const tipo = resposta.headers.get("content-type") ?? "";
  const corpo = tipo.includes("application/json") ? await resposta.json() : await resposta.text();

  if (!resposta.ok) {
    throw new EvolutionApiError(
      extrairMensagemErro(corpo, `Evolution respondeu HTTP ${resposta.status}`),
      resposta.status,
      corpo,
    );
  }
  return corpo;
}
