// Edge Function que baixa o Relatório de Abates do IMEA a partir do IP
// brasileiro do Supabase. O publicacoes.imea.com.br pendura/bloqueia a nuvem
// do Trigger (us-east-1) — mesmo geo-bloqueio do CEPEA e do IAGRO. De um IP
// no Brasil responde normalmente (verificado em 22/08/2026).
//
// Protegida por segredo compartilhado (header x-proxy-secret). Não aceita URL
// arbitrária: o alvo é fixo, só o número do relatório (?n=31) varia — e é
// validado como inteiro pequeno.
//
// Usa o MESMO segredo dos irmãos: supabase secrets set MS_PROXY_SECRET=<...>

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BASE = "https://publicacoes.imea.com.br/relatorio-de-mercado/abate-bovinoculturadecorte";

Deno.serve(async (req: Request) => {
  const segredo = Deno.env.get("MS_PROXY_SECRET");
  if (!segredo || req.headers.get("x-proxy-secret") !== segredo) {
    return new Response("nao autorizado", { status: 401 });
  }

  const n = Number(new URL(req.url).searchParams.get("n"));
  if (!Number.isInteger(n) || n < 1 || n > 2000) {
    return new Response("n invalido", { status: 400 });
  }

  try {
    // redirect: "follow" — a página responde 302 para o PDF assinado no S3.
    const resposta = await fetch(`${BASE}/${n}`, {
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    });

    if (resposta.status === 404) return new Response("inexistente", { status: 404 });
    if (!resposta.ok) {
      return new Response(`IMEA respondeu HTTP ${resposta.status}`, { status: 502 });
    }

    return new Response(await resposta.arrayBuffer(), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return new Response(`falha ao buscar IMEA: ${mensagem}`, { status: 502 });
  }
});
