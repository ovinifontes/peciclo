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

/** Acima disto o fallback em memória não é seguro — só o streaming serve. */
const LIMITE_FALLBACK_MEMORIA = 50 * 1024 * 1024;

/**
 * Percorre um XLSX por streaming, entregando cada linha de dados já com o
 * mapa de colunas resolvido. Nunca carrega o arquivo inteiro em memória.
 *
 * Fallback: o leitor de streaming (unzipper) recusa ZIPs gravados em modo
 * "streamed" sem a assinatura opcional do data descriptor — é o formato que o
 * servidor novo do INDEA passou a gerar em 08/2026 ("invalid signature:
 * 0x41d", onde 0x41d era o tamanho do primeiro arquivo interno lido no lugar
 * da assinatura). O `unzip` de linha de comando e o leitor em memória do
 * próprio ExcelJS (jszip) leem o mesmo arquivo sem reclamar. Então: falhou o
 * streaming ANTES de qualquer linha útil e o arquivo é pequeno → relê em
 * memória. O PA (155 MB) nunca cai aqui — o arquivo dele streama normalmente.
 */
export async function* lerLinhas(
  caminho: string,
  opcoes: OpcoesLeitura,
): AsyncGenerator<{ valores: unknown[]; colunas: Record<string, number> }> {
  let linhasEntregues = 0;
  try {
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
        linhasEntregues++;
        yield { valores, colunas };
      }
      if (colunas) return;
    }
  } catch (erro) {
    // Depois de entregar linhas não dá para recomeçar sem duplicar — rethrow.
    if (linhasEntregues > 0) throw erro;
    const { statSync } = await import("node:fs");
    if (statSync(caminho).size > LIMITE_FALLBACK_MEMORIA) throw erro;
    yield* lerLinhasEmMemoria(caminho, opcoes);
  }
}

async function* lerLinhasEmMemoria(
  caminho: string,
  opcoes: OpcoesLeitura,
): AsyncGenerator<{ valores: unknown[]; colunas: Record<string, number> }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(caminho);
  const marcador = opcoes.marcadorCabecalho.toLowerCase();

  for (const aba of workbook.worksheets) {
    if (opcoes.nomeAba && aba.name !== opcoes.nomeAba) continue;
    let colunas: Record<string, number> | null = null;
    // getRows materializa; eachRow pula vazias e muda a numeração — o laço
    // manual espelha a ordem do streaming.
    for (let i = 1; i <= aba.rowCount; i++) {
      const valores = aba.getRow(i).values as unknown[];
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
