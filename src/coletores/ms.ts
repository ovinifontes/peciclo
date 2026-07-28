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

/** Descreve a causa real por trás do genérico "fetch failed" do undici. */
function descreverCausa(erro: unknown): string {
  if (erro instanceof Error) {
    const causa = (erro as { cause?: unknown }).cause as
      | { code?: string; message?: string; name?: string }
      | undefined;
    if (causa) return `${causa.code ?? causa.name ?? ""} ${causa.message ?? ""}`.trim();
    return `${erro.name}: ${erro.message}`;
  }
  return String(erro);
}

/**
 * Monta a requisição do relatório. O `api.ms.gov.br` bloqueia IPs estrangeiros
 * (datacenter dos EUA), então em produção passamos por uma Edge Function do
 * Supabase (IP brasileiro), configurada em `MS_PROXY_URL`. No dev local, com o
 * IP brasileiro da máquina, vai direto.
 */
function requisicaoMs(janela: Janela): { url: string; headers: Record<string, string> } {
  const proxyUrl = process.env.MS_PROXY_URL;
  const proxySecret = process.env.MS_PROXY_SECRET;
  if (proxyUrl && proxySecret) {
    const u = new URL(proxyUrl);
    u.searchParams.set("inicio", janela.inicio);
    u.searchParams.set("fim", janela.fim);
    return { url: u.toString(), headers: { "x-proxy-secret": proxySecret } };
  }
  return {
    url: urlRelatorioMs(janela),
    headers: { "user-agent": USER_AGENT, "accept-encoding": "gzip, deflate", accept: "*/*" },
  };
}

/**
 * Faz o GET do relatório com tentativas. O endpoint do IAGRO é lento (~10 s) e
 * instável; retentar com espera contorna quedas transitórias e revela a causa
 * real se persistir.
 */
async function buscarComTentativas(janela: Janela, signal?: AbortSignal): Promise<Response> {
  const { url, headers } = requisicaoMs(janela);
  const tentativas = 4;
  let ultimoErro: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(180_000) });
    } catch (erro) {
      ultimoErro = erro;
      if (i < tentativas) await new Promise((r) => setTimeout(r, i * 5000));
    }
  }
  throw new RespostaInesperadaError(
    `IAGRO inacessível após ${tentativas} tentativas — causa: ${descreverCausa(ultimoErro)}`,
  );
}

/** Baixa o relatório e devolve o buffer, validando que é mesmo um XLSX. */
export async function baixarMs(janela: Janela, signal?: AbortSignal): Promise<Buffer> {
  const resposta = await buscarComTentativas(janela, signal);

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
