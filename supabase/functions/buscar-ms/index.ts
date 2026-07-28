// Edge Function que busca o relatório de abate do IAGRO (MS) a partir do IP
// brasileiro do Supabase, contornando o bloqueio a IPs estrangeiros que atinge
// a nuvem do Trigger (us-east-1). Devolve o XLSX bruto.
//
// Protegida por um segredo compartilhado (header x-proxy-secret) para não virar
// um proxy aberto. Configure o segredo com:
//   supabase secrets set MS_PROXY_SECRET=<algo-aleatorio>

const BASE = "https://api.ms.gov.br/api-esaniagro/v1/relatorio/DocumentosDeTransitoRel";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

Deno.serve(async (req: Request) => {
  const segredoEsperado = Deno.env.get("MS_PROXY_SECRET");
  if (!segredoEsperado || req.headers.get("x-proxy-secret") !== segredoEsperado) {
    return new Response("nao autorizado", { status: 401 });
  }

  const url = new URL(req.url);
  const inicio = url.searchParams.get("inicio");
  const fim = url.searchParams.get("fim");
  if (!inicio || !fim) {
    return new Response("faltam os parametros inicio e fim", { status: 400 });
  }

  const alvo =
    `${BASE}?especieAnimalID=1&periodoInicial=${inicio}&periodoFinal=${fim}` +
    `&municipioIDOrigem=&municipioIDDestino=&municipioUFDestino=&finalidadeID=`;

  try {
    const resposta = await fetch(alvo, {
      headers: { "user-agent": USER_AGENT, accept: "*/*", "accept-encoding": "gzip, deflate" },
      signal: AbortSignal.timeout(120_000),
    });

    if (!resposta.ok) {
      return new Response(`IAGRO respondeu HTTP ${resposta.status}`, { status: 502 });
    }

    const buffer = await resposta.arrayBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (erro) {
    const causa = erro instanceof Error ? (erro as { cause?: { code?: string } }).cause?.code ?? erro.message : String(erro);
    return new Response(`falha ao buscar o IAGRO: ${causa}`, { status: 502 });
  }
});
