// Coletor do IMEA — fonte substituta do mensal de MT enquanto o portal do
// INDEA (InfoSindesa) estiver congelado. O IMEA publica mensalmente, em PDF,
// os números do PRÓPRIO INDEA (origem MT, incluindo envios para abate em
// outras UFs), com ~2 semanas de atraso.
//
// O pdf-parse entra por import DINÂMICO, nunca no topo: com import estático,
// o worker da nuvem morria no BOOT (runs TIMED_OUT com zero attempts) e sem
// mensagem nenhuma. Preguiçoso, uma falha de carga vira erro legível na run.

/** O mês pedido ainda não foi publicado (URL devolve 404). Não é falha. */
export class RelatorioInexistenteError extends Error {
  constructor(n: number) {
    super(`Relatório IMEA n=${n} ainda não publicado (404)`);
    this.name = "RelatorioInexistenteError";
  }
}

/**
 * Número sequencial do relatório na URL do IMEA: meses desde jan/2024,
 * começando em 1. Pontos conferidos na exploração: jan/2026 = 25, jul/2026 = 31
 * (existe), ago/2026 = 32 (404 em 22/08/2026).
 *
 * É um CHUTE aritmético: uma edição extra ou uma retificação desloca todos os
 * n seguintes e o PDF de agosto chega no lugar do de setembro. Por isso quem
 * lê o PDF confere o "Mês de referência" impresso nele (ver `extrairAbates`) —
 * o número da URL nunca é palavra final sobre a competência.
 */
export function numeroDoRelatorio(ano: number, mes: number): number {
  return (ano - 2024) * 12 + mes;
}

const URL_BASE = "https://publicacoes.imea.com.br/relatorio-de-mercado/abate-bovinoculturadecorte";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Baixa o PDF do relatório n (a URL redireciona para um S3 sem login).
 *
 * Da nuvem do Trigger (us-east-1) o publicacoes.imea.com.br PENDURA a conexão
 * — mesmo geo-bloqueio do CEPEA e do IAGRO (a primeira run de 22/08 morreu em
 * TIMED_OUT). Com `IMEA_PROXY_URL`/`MS_PROXY_SECRET` no ambiente, a busca sai
 * pela Edge Function `buscar-imea` (IP brasileiro do Supabase); sem as
 * variáveis (dev local, IP BR), vai direto.
 */
export async function baixarImea(n: number): Promise<Buffer> {
  const proxy = process.env.IMEA_PROXY_URL;
  const segredo = process.env.MS_PROXY_SECRET;
  const resposta =
    proxy && segredo
      ? await fetch(`${proxy}?n=${n}`, {
          headers: { "x-proxy-secret": segredo },
          signal: AbortSignal.timeout(120_000),
        })
      : await fetch(`${URL_BASE}/${n}`, {
          redirect: "follow",
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(60_000),
        });
  if (resposta.status === 404) throw new RelatorioInexistenteError(n);
  if (!resposta.ok) throw new Error(`IMEA n=${n}: HTTP ${resposta.status}`);

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (!buffer.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
    throw new Error(`IMEA n=${n}: resposta não é PDF (${buffer.length} bytes)`);
  }
  return buffer;
}

/** Um pedaço de texto do PDF com a posição que o pdf.js informa. */
export interface ItemTexto {
  str: string;
  x: number;
  y: number;
  pagina: number;
}

export interface AbatesImea {
  machos: number;
  femeas: number;
  total: number;
}

const ROTULOS = { total: "Total", machos: "Machos", femeas: "Fêmeas" } as const;
// Número com ponto de milhar, como o IMEA imprime ("608.829").
const NUMERO = /^\d{1,3}(\.\d{3})+$/;
// A ordem de extração do texto NÃO segue a ordem visual (na prática os números
// saíram como Total/Machos/Fêmeas e os rótulos como Total/Fêmeas/Machos), então
// parear por posição na lista atribuiria fêmeas aos machos. O pareamento certo
// é geométrico: rótulo e número da mesma LINHA compartilham o y.
const TOLERANCIA_Y = 3;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const MESES_CHAVE = MESES.map(semAcento);
const rotuloPt = (m: { ano: number; mes: number }) => `${MESES[m.mes - 1]} de ${m.ano}`;

/**
 * O mês que o PDF carimba no cabeçalho ("Mês de referência: Julho de 2026"),
 * ou null se não achar. O pdf.js corta o cabeçalho em dois itens ("Mês de
 * referência:" e "Julho de 2026"), então a busca é no texto da página inteira
 * remontado, não item a item.
 */
export function mesDeReferencia(itens: ItemTexto[]): { ano: number; mes: number } | null {
  const texto = semAcento(itens.map((i) => i.str).join(" ")).replace(/\s+/g, " ");
  const achado = /mes de referencia:? ([a-z]+) de (\d{4})/.exec(texto);
  if (!achado) return null;
  const mes = MESES_CHAVE.indexOf(achado[1]!) + 1;
  return mes === 0 ? null : { ano: Number(achado[2]), mes };
}

/**
 * Encontra o bloco "Abates / N° de cabeças" pareando cada rótulo com o número
 * na mesma linha (mesmo y, na mesma página). Valida com regras duras — um
 * parser de PDF que erra em silêncio é veneno.
 *
 * Antes de tudo confere o mês: o `n` da URL é aritmética cega e um PDF do mês
 * errado passa liso pelas outras validações (a faixa 200k–900k e a soma fecham
 * igual), gravando agosto sob a competência de setembro com cara de dado bom.
 */
export function extrairAbates(itens: ItemTexto[], esperado: { ano: number; mes: number }): AbatesImea {
  const referencia = mesDeReferencia(itens);
  if (referencia === null) {
    throw new Error(
      "IMEA: não achei o 'Mês de referência' no PDF — sem ele não dá para saber de que mês é o número (layout mudou?)",
    );
  }
  if (referencia.ano !== esperado.ano || referencia.mes !== esperado.mes) {
    throw new Error(
      `IMEA: o PDF é de ${rotuloPt(referencia)}, mas o pedido era ${rotuloPt(esperado)} — a numeração do relatório deslocou (edição extra ou retificação?)`,
    );
  }

  const paginas = [...new Set(itens.map((i) => i.pagina))];

  for (const pagina of paginas) {
    const daPagina = itens.filter((i) => i.pagina === pagina);
    const numeros = daPagina.filter((i) => NUMERO.test(i.str.trim()));

    const valorDe = (rotulo: string): number | null => {
      for (const item of daPagina.filter((i) => i.str.trim() === rotulo)) {
        const naLinha = numeros.filter((n) => Math.abs(n.y - item.y) <= TOLERANCIA_Y);
        if (naLinha.length === 1) return Number(naLinha[0]!.str.trim().replaceAll(".", ""));
      }
      return null;
    };

    const total = valorDe(ROTULOS.total);
    const machos = valorDe(ROTULOS.machos);
    const femeas = valorDe(ROTULOS.femeas);
    if (total === null || machos === null || femeas === null) continue;

    if (total < 200_000 || total > 900_000) {
      throw new Error(`IMEA: total ${total} implausível para o abate mensal de MT (200k–900k)`);
    }
    // Tolerância RELATIVA (0,5%), não ±1: o PDF real de jul/26 imprime total
    // 608.829 com machos+fêmeas = 609.829 — e a quebra regional do mesmo PDF
    // soma 609.829, ou seja, a manchete do IMEA é que está 1.000 fora. Um
    // pareamento trocado erraria por dezenas de milhares e estoura igual.
    if (Math.abs(machos + femeas - total) > total * 0.005) {
      throw new Error(`IMEA: machos (${machos}) + fêmeas (${femeas}) não bate com o total (${total})`);
    }
    return { machos, femeas, total };
  }

  throw new Error("IMEA: não encontrei as linhas Total/Machos/Fêmeas no PDF — o layout mudou?");
}

/**
 * Extrai machos/fêmeas/total do PDF do IMEA para a competência `esperado`.
 * Lança se qualquer coisa não fechar — inclusive se o PDF for de outro mês.
 */
export async function parsearImea(
  buffer: Buffer,
  esperado: { ano: number; mes: number },
): Promise<AbatesImea> {
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const itens: ItemTexto[] = [];
  let pagina = 0;
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      pagina++;
      const conteudo = await pageData.getTextContent();
      for (const item of conteudo.items) {
        itens.push({ str: item.str, x: item.transform[4], y: item.transform[5], pagina });
      }
      return "";
    },
  });
  return extrairAbates(itens, esperado);
}
