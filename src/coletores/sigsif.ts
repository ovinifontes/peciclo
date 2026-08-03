const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * "Relatório de Abates" do SIGSIF/MAPA — abate sob inspeção FEDERAL, já
 * agregado por (mês, UF, categoria), com as colunas QTD_MACHO e QTD_FEMEA.
 *
 * Este é o arquivo CERTO. O outro recurso do mesmo dataset
 * (sigsifquantitativoanimaisabatidoscategoriauf.csv, ~100 MB) tinha categorias
 * "Bovino Macho"/"Bovino Femea", mas elas ACABARAM em jan/2021: de fev/2021 em
 * diante 100% do volume de GO e SP está numa categoria "Bovino" sem sexo.
 * Usar aquele arquivo produziria zeros silenciosos.
 */
const URL_ABATES =
  "https://dados.agricultura.gov.br/dataset/062166e3-b515-4274-8e7d-68aadd64b820/resource/341dc717-4716-42ab-b189-c8d7a9d2a1ba/download/sigsifrelatorioabates.csv";

/** Mínimo de meses anteriores para julgar se o último é parcial. */
const HISTORICO_GUARDA = 6;
/** Abaixo desta fração da mediana recente, o mês é considerado incompleto. */
const FRACAO_MES_PARCIAL = 0.5;

export interface AbateSif {
  uf: string;
  ano: number;
  mes: number;
  macho: number;
  femea: number;
}

export class SigsifError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SigsifError";
  }
}

/** Baixa o CSV. O WAF devolve 403 com corpo vazio se faltar User-Agent. */
export async function baixarSigsif(signal?: AbortSignal): Promise<string> {
  const resposta = await fetch(URL_ABATES, {
    headers: { "user-agent": USER_AGENT, accept: "text/csv,*/*" },
    signal: signal ?? AbortSignal.timeout(180_000),
  });
  if (!resposta.ok) throw new SigsifError(`SIGSIF respondeu HTTP ${resposta.status}`);

  const texto = await resposta.text();
  // Uma página HTML de erro também vem com 200; validar o conteúdo.
  if (!texto.startsWith("MES_ANO;")) {
    throw new SigsifError(
      `SIGSIF devolveu conteúdo inesperado (início: ${texto.slice(0, 60).replace(/\n/g, " ")})`,
    );
  }
  return texto;
}

/**
 * Extrai o abate bovino por sexo das UFs pedidas.
 * Linhas terminam em CRLF; sem remover o \r, o último campo vira NaN.
 */
export function parsearSigsif(csv: string, ufs: string[]): AbateSif[] {
  const saida: AbateSif[] = [];

  for (const bruta of csv.split("\n").slice(1)) {
    const linha = bruta.replace(/\r$/, "");
    if (!linha) continue;
    const campos = linha.split(";");
    if (campos.length !== 5) continue;

    const [mesAno, uf, categoria, qtdMacho, qtdFemea] = campos as [string, string, string, string, string];
    // Igualdade exata: o arquivo tem 93 categorias com nomes sujos e parecidos.
    if (categoria !== "Bovino" || !ufs.includes(uf)) continue;

    const [mes, ano] = mesAno.split("/").map(Number);
    const macho = Number(qtdMacho);
    const femea = Number(qtdFemea);
    if (!mes || !ano || !Number.isFinite(macho) || !Number.isFinite(femea)) continue;

    saida.push({ uf, ano, mes, macho, femea });
  }

  return saida.sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.uf.localeCompare(b.uf));
}

/**
 * Descarta o último mês de cada UF quando ele parece incompleto. O arquivo é
 * reprocessado quase diariamente, então o mês corrente entra como um stub (às
 * vezes algumas centenas de cabeças) e o anterior pode ainda estar fechando.
 */
export function removerMesesParciais(dados: AbateSif[]): AbateSif[] {
  const manter: AbateSif[] = [];

  for (const uf of new Set(dados.map((d) => d.uf))) {
    const serie = dados.filter((d) => d.uf === uf);
    let corte = serie.length;

    while (corte > HISTORICO_GUARDA) {
      const candidato = serie[corte - 1]!;
      const anteriores = serie.slice(corte - 1 - HISTORICO_GUARDA, corte - 1);
      const totais = anteriores.map((d) => d.macho + d.femea).sort((a, b) => a - b);
      const mediana = totais[Math.floor(totais.length / 2)] ?? 0;
      const total = candidato.macho + candidato.femea;
      if (total >= FRACAO_MES_PARCIAL * mediana) break;
      corte--;
    }

    manter.push(...serie.slice(0, corte));
  }

  return manter.sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.uf.localeCompare(b.uf));
}

/** Baixa, parseia e remove meses parciais. */
export async function coletarSigsif(ufs: string[], signal?: AbortSignal): Promise<AbateSif[]> {
  return removerMesesParciais(parsearSigsif(await baixarSigsif(signal), ufs));
}
