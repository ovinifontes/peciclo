import ExcelJS from "exceljs";

/** Dias entre a época do Excel (1899-12-30) e a do Unix (1970-01-01). */
const EPOCA_EXCEL_EM_DIAS = 25569;
const MS_POR_DIA = 86_400_000;

/**
 * Converte o valor de uma célula de data para ISO YYYY-MM-DD.
 *
 * Na leitura por streaming o ExcelJS não aplica os estilos, então as datas
 * chegam como serial numérico. Os getters são UTC de propósito: o serial não
 * carrega fuso, e usar getters locais desloca a data em fusos negativos.
 */
export function serialParaDataISO(valor: number | Date): string {
  const data =
    valor instanceof Date
      ? valor
      : new Date(Math.round((valor - EPOCA_EXCEL_EM_DIAS) * MS_POR_DIA));
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Extrai o texto de uma célula, lidando com rich text e nulos. */
export function textoCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" && valor !== null && "richText" in valor) {
    const partes = (valor as { richText: Array<{ text: string }> }).richText;
    return partes.map((p) => p.text).join("").trim();
  }
  return String(valor).trim();
}

/**
 * Mapeia rótulo de coluna para índice, usando a PRIMEIRA ocorrência.
 * Células mescladas fazem o ExcelJS repetir o mesmo rótulo em colunas vizinhas.
 */
export function mapearCabecalho(valores: unknown[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  valores.forEach((valor, indice) => {
    const rotulo = textoCelula(valor);
    if (rotulo && !(rotulo in mapa)) mapa[rotulo] = indice;
  });
  return mapa;
}

export interface OpcoesLeitura {
  /** Rótulo que identifica a linha de cabeçalho. */
  marcadorCabecalho: string;
  /** Nome da aba. Quando omitido, usa a primeira que tiver dados. */
  nomeAba?: string;
}

/**
 * Percorre um XLSX por streaming, entregando cada linha de dados já com o
 * mapa de colunas resolvido. Nunca carrega o arquivo inteiro em memória.
 */
export async function* lerLinhas(
  caminho: string,
  opcoes: OpcoesLeitura,
): AsyncGenerator<{ valores: unknown[]; colunas: Record<string, number> }> {
  const leitor = new ExcelJS.stream.xlsx.WorkbookReader(caminho, {
    entries: "emit",
    sharedStrings: "cache",
    worksheets: "emit",
    styles: "ignore",
  });

  for await (const aba of leitor) {
    // O .d.ts do ExcelJS não declara `name` no WorksheetReader, mas a
    // propriedade existe em runtime (workbook-reader.js atribui o nome da aba).
    const nomeDaAba = (aba as unknown as { name?: string }).name;
    if (opcoes.nomeAba && nomeDaAba !== opcoes.nomeAba) continue;
    let colunas: Record<string, number> | null = null;
    const marcador = opcoes.marcadorCabecalho.toLowerCase();

    for await (const linha of aba) {
      const valores = linha.values as unknown[];
      if (!colunas) {
        const achou = valores.some((v) => textoCelula(v).toLowerCase() === marcador);
        if (achou) colunas = mapearCabecalho(valores);
        continue;
      }
      yield { valores, colunas };
    }
    if (colunas) return;
  }
}
