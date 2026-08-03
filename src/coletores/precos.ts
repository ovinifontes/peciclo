const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Widget oficial do CEPEA. As páginas .aspx do site estão atrás de desafio
 * Cloudflare (403 para qualquer cliente HTTP), mas este endpoint de embed
 * responde limpo. Traz só o ÚLTIMO valor de cada indicador — a série histórica
 * se constrói pela coleta diária acumulada.
 *
 * O próprio payload embute "Fonte: Cepea": o crédito é obrigatório ao publicar.
 */
const URL_CEPEA = (() => {
  const p = new URLSearchParams({ fonte: "arial", tamanho: "10", largura: "400px" });
  // Pedimos uma faixa ampla de indicadores e casamos por RÓTULO, nunca por id:
  // os ids não são estáveis nem documentados.
  const ids = Array.from({ length: 60 }, (_, i) => `id_indicador[]=${i + 1}`).join("&");
  return `https://www.cepea.org.br/br/widgetproduto.js.php?${p}&${ids}`;
})();

/** Página que republica os indicadores CEPEA e traz a curva de futuros da B3. */
const URL_NOTICIAS = "https://www.noticiasagricolas.com.br/cotacoes/boi-gordo";

export interface Preco {
  serie: string;
  data: string; // ISO AAAA-MM-DD
  valor: number;
  unidade: string;
  fonte: string;
}

export interface Futuro {
  contrato: string; // "Agosto/2026"
  fechamento: number;
}

export class PrecoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PrecoError";
  }
}

/** Converte "3.377,23" (pt-BR) em 3377.23. */
export function numeroBr(texto: string): number {
  return Number(texto.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
}

/** Converte "31/07/2026" em "2026-07-31". */
export function dataBrParaIso(texto: string): string | null {
  const m = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const semTags = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Extrai os indicadores do widget do CEPEA. As linhas são
 * `<td>data</td><td>produto</td><td>valor</td>`; casamos o produto por regex
 * porque a ordem e os ids variam.
 */
export function parsearCepea(js: string): Preco[] {
  const alvos: Array<{ serie: string; regex: RegExp; unidade: string }> = [
    { serie: "boi_gordo", regex: /^Boi Gordo\b/i, unidade: "R$/@" },
    { serie: "bezerro_ms", regex: /^Bezerro - MS\b/i, unidade: "R$/cabeça" },
    { serie: "bezerro_sp", regex: /^Bezerro - SP\b/i, unidade: "R$/cabeça" },
  ];

  const precos: Preco[] = [];
  for (const linha of js.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const celulas = [...linha[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => semTags(c[1]!));
    if (celulas.length < 3) continue;

    const [dataTexto, produto, valorTexto] = celulas as [string, string, string];
    const data = dataBrParaIso(dataTexto);
    if (!data) continue; // linhas mensais ("07/2026") e cabeçalho caem aqui

    for (const alvo of alvos) {
      if (!alvo.regex.test(produto)) continue;
      const valor = numeroBr(valorTexto);
      if (Number.isFinite(valor) && valor > 0) {
        precos.push({ serie: alvo.serie, data, valor, unidade: alvo.unidade, fonte: "CEPEA" });
      }
    }
  }
  return precos;
}

/** Baixa e interpreta o widget do CEPEA. */
export async function coletarCepea(signal?: AbortSignal): Promise<Preco[]> {
  const resposta = await fetch(URL_CEPEA, {
    headers: { "user-agent": USER_AGENT },
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (!resposta.ok) throw new PrecoError(`CEPEA respondeu HTTP ${resposta.status}`);

  const js = await resposta.text();
  const precos = parsearCepea(js);
  if (precos.length === 0) {
    throw new PrecoError("Widget do CEPEA não devolveu nenhum indicador reconhecido");
  }
  return precos;
}

/**
 * Extrai a curva de futuros do boi gordo (BGI) da B3. É o que o mercado já
 * precificou — a contraparte do indicador de ciclo. A B3 não publica isso por
 * API aberta; esta página republica em tabela.
 */
export function parsearFuturos(html: string): Futuro[] {
  const futuros: Futuro[] = [];
  for (const linha of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const celulas = [...linha[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => semTags(c[1]!));
    if (celulas.length < 2) continue;

    const [contrato, fechamento] = celulas as [string, string];
    if (!/^[A-Za-zÀ-ú]+\/\d{4}$/.test(contrato)) continue;
    const valor = numeroBr(fechamento);
    if (Number.isFinite(valor) && valor > 0) futuros.push({ contrato, fechamento: valor });
  }
  return futuros;
}

/** Baixa a curva de futuros do BGI. */
export async function coletarFuturos(signal?: AbortSignal): Promise<Futuro[]> {
  const resposta = await fetch(URL_NOTICIAS, {
    headers: { "user-agent": USER_AGENT },
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (!resposta.ok) throw new PrecoError(`Notícias Agrícolas respondeu HTTP ${resposta.status}`);
  return parsearFuturos(await resposta.text());
}

/**
 * Sanidade antes de gravar: dado raspado de terceiro é não confiável, e um
 * valor absurdo entrando no banco contamina a relação de troca em silêncio.
 */
export function dentroDaFaixa(preco: Preco): boolean {
  if (preco.serie === "boi_gordo") return preco.valor >= 100 && preco.valor <= 800;
  if (preco.serie.startsWith("bezerro")) return preco.valor >= 800 && preco.valor <= 9000;
  return true;
}
