/**
 * Exporta o cartão de exportação como PNG — para o dono mandar por WhatsApp.
 *
 * O `html-to-image` (~11 KB gzip) só é baixado no PRIMEIRO clique em
 * "Exportar imagem": o `await import(...)` lá embaixo é a fronteira, como a
 * do Recharts — nada dele encosta no pacote inicial do site.
 *
 * Quem chega aqui é o nó do `exportavel.tsx`: a cópia da visão em 1080px de
 * largura, montada fora da tela já com a moldura de marca, tudo visível e sem
 * rolagem interna — por isso não existe mais nada para revelar, expandir nem
 * restaurar em volta da foto. A única correção necessária é no CLONE que o
 * html-to-image desenha: ele copia o computed style do nó, e um clone com
 * `position:fixed; left:-99999px` sairia do quadro — PNG em branco.
 */

/** Nome do arquivo baixado: `peciclo-colunas-2026-08-12.png`. */
export function nomeArquivo(visao: string, agora: Date): string {
  // en-CA é o locale que formata como YYYY-MM-DD; sem `toISOString`, que
  // converteria para UTC e viraria o dia à noite.
  const dia = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  return `peciclo-${visao}-${dia}.png`;
}

/** Data do cabeçalho da moldura: "12 de agosto de 2026". */
export function dataPorExtenso(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(agora);
}

/** Respiro branco em volta do conteúdo no PNG, em pixels de CSS. */
export const MARGEM_CAPTURA = 24;

export async function exportarPng(no: HTMLElement, visao: string): Promise<void> {
  const { toBlob } = await import("html-to-image");
  const agora = new Date();

  // A margem e o reset de posição entram só no CLONE, via `style` — o nó real
  // continua parado fora da tela, sem reflow nenhum.
  //
  // Blob, NUNCA data URL: um PNG 2x de seção inteira passa fácil de 2 MB, e
  // navegador de celular aceita o aviso de download de data URL e descarta o
  // arquivo em silêncio (foi exatamente o bug relatado em 14/08).
  const rect = no.getBoundingClientRect();
  const blob = await toBlob(no, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    width: Math.ceil(rect.width) + MARGEM_CAPTURA * 2,
    height: Math.ceil(rect.height) + MARGEM_CAPTURA * 2,
    style: {
      position: "static",
      left: "0",
      top: "0",
      margin: `${MARGEM_CAPTURA}px`,
    },
  });
  if (!blob) throw new Error("captura vazia");

  baixar(blob, nomeArquivo(visao, agora));
}

function baixar(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  // No DOM antes do clique: iOS Safari e Firefox ignoram cliques em âncora
  // solta. E o revoke espera um minuto — revogar cedo demais corta o save
  // do iOS no meio.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
