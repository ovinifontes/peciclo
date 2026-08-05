import { baixarPlanilha } from "@/lib/planilhas";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Entrega uma planilha arquivada.
 *
 * Um Route Handler é uma requisição direta: o layout de `(painel)` NÃO roda
 * antes dele e não protege nada. Quem exige cliente ativo é `baixarPlanilha`,
 * na primeira linha — sem sessão, o `redirect` de dentro do `dal` responde
 * 307 para `/login` e nenhum byte sai daqui.
 *
 * Os bytes são reemitidos por este endereço em vez de o painel redirecionar
 * para uma URL assinada do Storage: o bucket é privado e continua invisível
 * para o navegador, e não sobra link que ainda funcione depois.
 */
export async function GET(request: Request) {
  const chave = new URL(request.url).searchParams.get("arquivo") ?? "";
  const arquivo = await baixarPlanilha(chave);

  // Chave fora das pastas permitidas e arquivo inexistente respondem igual: a
  // resposta não é um mapa do bucket.
  if (!arquivo) return new Response("Planilha não encontrada.", { status: 404 });

  return new Response(arquivo.conteudo, {
    headers: {
      "content-type": XLSX,
      // O nome vem do regex de `ehChavePermitida` ([A-Za-z0-9._-]), então não
      // há aspa nem quebra de linha para escapar deste cabeçalho.
      "content-disposition": `attachment; filename="${arquivo.nome}"`,
      "content-length": String(arquivo.conteudo.byteLength),
      // Planilha de cliente autenticado não entra em cache compartilhado.
      "cache-control": "private, no-store",
    },
  });
}
