/**
 * Exporta uma seção do painel como PNG — para o dono mandar por WhatsApp.
 *
 * O `html-to-image` (~11 KB gzip) só é baixado no PRIMEIRO clique em
 * "Exportar imagem": o `await import(...)` lá embaixo é a fronteira, como a
 * do Recharts — nada disto encosta no pacote inicial do site.
 *
 * A moldura de marca (mostrador + "Peciclo" + data no alto, "peciclo.com.br"
 * no rodapé) já existe no DOM com `hidden`, dentro do contêiner capturado. A
 * captura revela esses elementos, expande contêineres com rolagem interna
 * (senão a tabela sairia cortada na altura da janela) e restaura tudo num
 * `finally` — a tela volta ao normal mesmo quando a captura falha.
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

  const moldura = Array.from(no.querySelectorAll<HTMLElement>("[data-so-exportar]"));
  const dataEl = no.querySelector<HTMLElement>("[data-exportar-data]");
  const soltos = Array.from(no.querySelectorAll<HTMLElement>("[data-exportar-expandir]")).map(
    (el) => ({ el, maxHeight: el.style.maxHeight, overflow: el.style.overflow }),
  );

  try {
    for (const el of moldura) el.hidden = false;
    if (dataEl) dataEl.textContent = dataPorExtenso(agora);
    for (const { el } of soltos) {
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
    }

    // A margem entra só no CLONE que o html-to-image desenha, via `style` +
    // largura/altura do canvas — o nó da tela não sofre reflow nenhum (os
    // gráficos remedem o contêiner quando a largura muda; aqui ela não muda).
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
      style: { margin: `${MARGEM_CAPTURA}px` },
    });
    if (!blob) throw new Error("captura vazia");

    baixar(blob, nomeArquivo(visao, agora));
  } finally {
    for (const el of moldura) el.hidden = true;
    if (dataEl) dataEl.textContent = "";
    for (const { el, maxHeight, overflow } of soltos) {
      el.style.maxHeight = maxHeight;
      el.style.overflow = overflow;
    }
  }
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
