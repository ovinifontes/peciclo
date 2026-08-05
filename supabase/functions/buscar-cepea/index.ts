// Edge Function que busca o widget de indicadores do CEPEA a partir do IP
// brasileiro do Supabase. O CEPEA está atrás de Cloudflare e devolve 403 para
// a nuvem do Trigger (us-east-1) — mesmo bloqueio geográfico que atinge o
// IAGRO/MS. De um IP no Brasil responde normalmente.
//
// Protegida por segredo compartilhado (header x-proxy-secret) para não virar
// proxy aberto. Não aceita URL arbitrária: o alvo é fixo no código.
//
// Configure com: supabase secrets set MS_PROXY_SECRET=<segredo>

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Alvo fixo: widget oficial de indicadores do CEPEA. */
function urlCepea(): string {
  const base = new URLSearchParams({ fonte: "arial", tamanho: "10", largura: "400px" });
  const ids = Array.from({ length: 60 }, (_, i) => `id_indicador[]=${i + 1}`).join("&");
  return `https://www.cepea.org.br/br/widgetproduto.js.php?${base}&${ids}`;
}

Deno.serve(async (req: Request) => {
  const segredo = Deno.env.get("MS_PROXY_SECRET");
  if (!segredo || req.headers.get("x-proxy-secret") !== segredo) {
    return new Response("nao autorizado", { status: 401 });
  }

  try {
    const resposta = await fetch(urlCepea(), {
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(60_000),
    });

    if (!resposta.ok) {
      return new Response(`CEPEA respondeu HTTP ${resposta.status}`, { status: 502 });
    }

    return new Response(await resposta.text(), {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  } catch (erro) {
    const causa =
      erro instanceof Error
        ? (erro as { cause?: { code?: string } }).cause?.code ?? erro.message
        : String(erro);
    return new Response(`falha ao buscar o CEPEA: ${causa}`, { status: 502 });
  }
});
