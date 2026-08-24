import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistroGta, Sexo } from "../tipos.js";
import { lerLinhas, serialParaDataISO, textoCelula } from "../xlsx/leitor.js";

const PAGINA_ADEPARA = "https://www.adepara.pa.gov.br/node/313";
const PASTA_RAIZ = "1Sb-90n2n_NtTAOC_z60OB1TQG7kZin_l";

export interface ArquivoDrive {
  id: string;
  nome: string;
  modificadoEm: string;
  md5: string | null;
}

/** Lista arquivos de uma pasta pública do Drive via API v3 com API key. */
export async function listarPasta(pastaId: string, apiKey: string): Promise<ArquivoDrive[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${pastaId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,md5Checksum)");
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("key", apiKey);

  const resposta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) throw new Error(`Drive respondeu HTTP ${resposta.status}`);

  const json = (await resposta.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime: string; md5Checksum?: string }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    nome: f.name,
    modificadoEm: f.modifiedTime,
    md5: f.md5Checksum ?? null,
  }));
}

/**
 * Encontra a subpasta do ano. O padrão é "GTAs 2026 dados públicos", mas a
 * ADEPARA já variou a nomenclatura, então o casamento é tolerante.
 */
export async function encontrarPastaDoAno(
  ano: number,
  apiKey: string,
): Promise<string | null> {
  const itens = await listarPasta(PASTA_RAIZ, apiKey);
  const alvo = itens.find((i) => i.nome.includes(String(ano)) && /gta/i.test(i.nome));
  return alvo?.id ?? null;
}

/**
 * Último mês em que ainda vale varrer a pasta do ano ANTERIOR.
 *
 * A ADEPARA publica com ~2 meses de atraso e sempre dentro da pasta do ano a
 * que os dados se referem: nov/2026 e dez/2026 aparecem em jan-fev/2027 dentro
 * de "GTAs 2026". Varrendo só a pasta do ano corrente esses dois meses nunca
 * seriam vistos — a coluna do Pará ficaria vazia para sempre.
 *
 * Março (e não o ano inteiro) porque cada arquivo é BAIXADO para ser hasheado:
 * varrer a pasta velha custa downloads, não só requisições. Três meses cobrem
 * o atraso de dois com uma folga de um; a partir de abril a pasta velha já foi
 * lida e só custaria banda.
 */
const ULTIMO_MES_COM_ATRASO_PA = 3;

/** Pastas que a coleta do PA precisa varrer neste mês — ver constante acima. */
export function anosParaVarrer(ano: number, mes: number): number[] {
  return mes <= ULTIMO_MES_COM_ATRASO_PA ? [ano, ano - 1] : [ano];
}

const mesCorrenteBr = () =>
  Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(5, 7));

const ehZip = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;

/**
 * Extrai a URL de confirmação da página "Virus scan warning" que o Drive
 * devolve para arquivos grandes (>~100 MB) em vez do conteúdo. A página traz um
 * formulário com id/export/confirm/uuid que precisa ser reenviado.
 */
export function urlDeConfirmacao(html: string): string | null {
  const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
  if (!action) return null;
  const params = new URLSearchParams();
  for (const campo of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) {
    params.set(campo[1]!, campo[2]!);
  }
  if (!params.has("id")) return null;
  return `${action.replace(/&amp;/g, "&")}?${params.toString()}`;
}

export async function baixarArquivoDrive(id: string): Promise<Buffer> {
  const baixar = (url: string) =>
    fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });

  let resposta = await baixar(`https://drive.google.com/uc?export=download&id=${id}`);
  if (!resposta.ok) throw new Error(`Download do Drive falhou: HTTP ${resposta.status}`);
  let buffer = Buffer.from(await resposta.arrayBuffer());

  // Arquivos grandes vêm como página de aviso de vírus: reenviar confirmando.
  if (!ehZip(buffer)) {
    const url = urlDeConfirmacao(buffer.toString("utf8"));
    if (!url) {
      throw new Error(`Drive devolveu conteúdo que não é XLSX (${buffer.length} bytes)`);
    }
    resposta = await baixar(url);
    if (!resposta.ok) throw new Error(`Download confirmado falhou: HTTP ${resposta.status}`);
    buffer = Buffer.from(await resposta.arrayBuffer());
  }

  if (!ehZip(buffer)) {
    throw new Error(`Drive devolveu conteúdo que não é XLSX (${buffer.length} bytes)`);
  }
  return buffer;
}

export interface Categoria {
  especie: string;
  sexo: Sexo;
  faixaEtaria: string;
}

/**
 * Interpreta o rótulo de uma coluna de categoria: "ESPÉCIE, SEXO, FAIXA".
 * Devolve null para categorias sem sexo (aves, suínos) e para espécies que
 * não são bovino.
 */
export function interpretarCategoria(rotulo: string): Categoria | null {
  const partes = rotulo.split(",").map((p) => p.trim());
  if (partes.length !== 3) return null;

  const [especie, sexoBruto, faixaEtaria] = partes as [string, string, string];
  if (especie !== "BOVINO") return null;
  if (sexoBruto !== "MACHO" && sexoBruto !== "FÊMEA") return null;

  return { especie, sexo: sexoBruto === "FÊMEA" ? "FEMEA" : "MACHO", faixaEtaria };
}

/**
 * Lê a planilha mensal do PA. O formato é wide: uma linha por GTA, com 48
 * colunas de categoria. A coluna `taxonomia` traz apenas a espécie, então o
 * sexo vem do NOME da coluna, não do conteúdo dela.
 */
export async function parsearPa(caminho: string): Promise<RegistroGta[]> {
  const registros: RegistroGta[] = [];
  let categorias: Array<{ indice: number; categoria: Categoria }> | null = null;

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "finalidade",
  })) {
    if (!categorias) {
      categorias = Object.entries(colunas)
        .map(([rotulo, indice]) => {
          const categoria = interpretarCategoria(rotulo);
          return categoria ? { indice, categoria } : null;
        })
        .filter((c): c is { indice: number; categoria: Categoria } => c !== null);
    }

    const finalidade = textoCelula(valores[colunas["finalidade"]!]);
    const taxonomia = textoCelula(valores[colunas["taxonomia"]!]);
    if (!finalidade || taxonomia !== "BOVINO") continue;

    const bruto = valores[colunas["data_emissao"]!];
    if (typeof bruto !== "number" && !(bruto instanceof Date)) continue;

    const comum = {
      uf: "PA" as const,
      documentoTipo: "GTA",
      documentoNumero: textoCelula(valores[colunas["gta_numero"]!]),
      documentoSerie: "",
      dataEmissao: serialParaDataISO(bruto),
      finalidade,
      municipioOrigem: textoCelula(valores[colunas["origem_cidade_nome"]!]) || null,
      municipioDestino: textoCelula(valores[colunas["destinatario_cidade_nome"]!]) || null,
      ufDestino: null,
    };

    for (const { indice, categoria } of categorias) {
      const quantidade = Number(valores[indice]) || 0;
      if (quantidade <= 0) continue;
      registros.push({
        ...comum,
        sexo: categoria.sexo,
        faixaEtaria: categoria.faixaEtaria,
        quantidade,
      });
    }
  }

  return registros;
}

export interface ArquivoNovo {
  arquivo: ArquivoDrive;
  conteudo: Buffer;
  hash: string;
  registros: RegistroGta[];
}

/**
 * Baixa e parseia apenas os arquivos ainda não processados. No começo do ano
 * varre também a pasta do ano anterior (`anosParaVarrer`), onde a ADEPARA
 * publica nov e dez com atraso; o filtro por hash descarta o que já entrou.
 */
export async function coletarPa(args: {
  ano: number;
  /** Mês de referência; padrão é o mês corrente no fuso de Brasília. */
  mes?: number;
  apiKey: string;
  hashesJaProcessados: Set<string>;
}): Promise<ArquivoNovo[]> {
  const novos: ArquivoNovo[] = [];

  for (const ano of anosParaVarrer(args.ano, args.mes ?? mesCorrenteBr())) {
    const pastaId = await encontrarPastaDoAno(ano, args.apiKey);
    // Pasta ausente é normal: a do ano corrente só nasce quando a ADEPARA
    // publica o 1º arquivo dele, lá por março.
    if (!pastaId) continue;

    const itens = (await listarPasta(pastaId, args.apiKey)).filter((i) => /\.xlsx$/i.test(i.nome));
    for (const item of itens) {
      const conteudo = await baixarArquivoDrive(item.id);
      const hash = createHash("sha256").update(conteudo).digest("hex");
      if (args.hashesJaProcessados.has(hash)) continue;

      const temporario = join(tmpdir(), `pa-${hash.slice(0, 12)}.xlsx`);
      await writeFile(temporario, conteudo);
      novos.push({ arquivo: item, conteudo, hash, registros: await parsearPa(temporario) });
    }
  }

  return novos;
}
