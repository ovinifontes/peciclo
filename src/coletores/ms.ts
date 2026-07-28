import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Janela, RegistroGta, Sexo } from "../tipos.js";
import { lerLinhas, serialParaDataISO, textoCelula } from "../xlsx/leitor.js";

const BASE = "https://api.ms.gov.br/api-esaniagro/v1/relatorio/DocumentosDeTransitoRel";
const ESPECIE_BOVINO = 1;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** As 4 faixas etárias que o relatório do MS traz, por sexo. */
const FAIXAS = ["0 A 12 MESES", "13 A 24 MESES", "25 A 36 MESES", "ACIMA DE 36 MESES"] as const;
const ROTULO_SEXO: Record<Sexo, string> = { FEMEA: "FÊMEA", MACHO: "MACHO" };

export function urlRelatorioMs(janela: Janela): string {
  const p = new URLSearchParams({
    especieAnimalID: String(ESPECIE_BOVINO),
    periodoInicial: janela.inicio,
    periodoFinal: janela.fim,
    municipioIDOrigem: "",
    municipioIDDestino: "",
    municipioUFDestino: "",
    finalidadeID: "",
  });
  return `${BASE}?${p.toString()}`;
}

export class RespostaInesperadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RespostaInesperadaError";
  }
}

/** Baixa o relatório e devolve o buffer, validando que é mesmo um XLSX. */
export async function baixarMs(janela: Janela, signal?: AbortSignal): Promise<Buffer> {
  const resposta = await fetch(urlRelatorioMs(janela), {
    headers: { "user-agent": USER_AGENT, "accept-encoding": "gzip, deflate" },
    signal: signal ?? AbortSignal.timeout(120_000),
  });

  if (!resposta.ok) {
    throw new RespostaInesperadaError(`IAGRO respondeu HTTP ${resposta.status}`);
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());

  // Assinatura de ZIP. Uma página de erro ou de manutenção jamais deve ser
  // gravada como se fosse dado: é falha, não zero.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new RespostaInesperadaError(
      `IAGRO devolveu conteúdo que não é XLSX (${buffer.length} bytes, início ${buffer.subarray(0, 8).toString("hex")})`,
    );
  }
  return buffer;
}

/** Lê o XLSX do MS e devolve os registros desnormalizados por sexo e faixa. */
export async function parsearMs(caminho: string): Promise<RegistroGta[]> {
  const registros: RegistroGta[] = [];

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "Tipo de Documento",
  })) {
    const especie = textoCelula(valores[colunas["Espécie"]!]);
    const finalidade = textoCelula(valores[colunas["Finalidade"]!]);
    if (especie !== "BOVINO" || !finalidade) continue;

    const bruto = valores[colunas["Data Emissão"]!];
    if (typeof bruto !== "number" && !(bruto instanceof Date)) continue;

    const comum = {
      uf: "MS" as const,
      documentoTipo: textoCelula(valores[colunas["Tipo de Documento"]!]),
      documentoNumero: textoCelula(valores[colunas["Número"]!]),
      documentoSerie: textoCelula(valores[colunas["Série"]!]),
      dataEmissao: serialParaDataISO(bruto),
      finalidade,
      municipioOrigem: textoCelula(valores[colunas["Município Origem"]!]) || null,
      municipioDestino: textoCelula(valores[colunas["Município Destino"]!]) || null,
      ufDestino: textoCelula(valores[colunas["UF Destino"]!]) || null,
    };

    for (const sexo of ["FEMEA", "MACHO"] as const) {
      for (const faixa of FAIXAS) {
        const indice = colunas[`${ROTULO_SEXO[sexo]} ${faixa}`];
        if (indice === undefined) continue;
        const quantidade = Number(valores[indice]) || 0;
        if (quantidade <= 0) continue;
        registros.push({ ...comum, sexo, faixaEtaria: faixa, quantidade });
      }
    }
  }

  return registros;
}

export interface ColetaMs {
  registros: RegistroGta[];
  arquivo: Buffer;
  hash: string;
  nomeArquivo: string;
}

/** Baixa, valida, arquiva em disco temporário e parseia. */
export async function coletarMs(janela: Janela, signal?: AbortSignal): Promise<ColetaMs> {
  const arquivo = await baixarMs(janela, signal);
  const hash = createHash("sha256").update(arquivo).digest("hex");
  const nomeArquivo = `ms/${janela.inicio}_a_${janela.fim}.xlsx`;
  const temporario = join(tmpdir(), `ms-${hash.slice(0, 12)}.xlsx`);
  await writeFile(temporario, arquivo);
  const registros = await parsearMs(temporario);
  return { registros, arquivo, hash, nomeArquivo };
}
