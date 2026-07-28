import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgregadoMensal, Janela, Sexo } from "../tipos.js";
import { lerLinhas, textoCelula } from "../xlsx/leitor.js";

const BASE = "https://sistemas.indea.mt.gov.br/FronteiraWeb";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class CredencialInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CredencialInvalidaError";
  }
}

/** Converte YYYY-MM-DD para o dd/MM/yyyy que o formulário do INDEA espera. */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Detecta que a resposta voltou sendo a tela de login (sessão expirou). */
export function sessaoExpirada(html: string): boolean {
  return /Login\.action/i.test(html) && /name="senha"/i.test(html);
}

function extrairCookies(resposta: Response, jar: Map<string, string>): void {
  for (const linha of resposta.headers.getSetCookie?.() ?? []) {
    const [par] = linha.split(";");
    const [nome, valor] = (par ?? "").split("=");
    if (nome && valor) jar.set(nome.trim(), valor.trim());
  }
}

const serializar = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** Semeia cookies, autentica e devolve o cookie jar da sessão. */
export async function autenticar(cpf: string, senha: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();

  const inicial = await fetch(`${BASE}/`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  extrairCookies(inicial, jar);

  const login = await fetch(`${BASE}/Login.action`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializar(jar),
    },
    body: new URLSearchParams({ usuario: cpf, senha }),
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  extrairCookies(login, jar);

  if (login.status === 401 || login.status === 403) {
    throw new CredencialInvalidaError(`INDEA rejeitou a credencial (HTTP ${login.status})`);
  }
  return jar;
}

/**
 * Baixa o relatório GTA Condensado para a janela informada.
 * O formulário usa multipart/form-data com os campos dataIni e dataFim.
 */
export async function baixarMt(janela: Janela, cpf: string, senha: string): Promise<Buffer> {
  const jar = await autenticar(cpf, senha);

  const form = new FormData();
  form.set("dataIni", formatarDataBr(janela.inicio));
  form.set("dataFim", formatarDataBr(janela.fim));

  const resposta = await fetch(`${BASE}/exportar_gta_condensado.action`, {
    method: "POST",
    headers: { "user-agent": USER_AGENT, cookie: serializar(jar) },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!resposta.ok) throw new Error(`INDEA respondeu HTTP ${resposta.status} no export`);

  const buffer = Buffer.from(await resposta.arrayBuffer());

  // Se voltou HTML, a sessão caiu: é a tela de login. Nunca gravar isso.
  const inicio = buffer.subarray(0, 512).toString("latin1");
  if (sessaoExpirada(inicio) || inicio.trimStart().startsWith("<")) {
    throw new CredencialInvalidaError("INDEA devolveu a tela de login em vez do arquivo");
  }
  // Assinatura de ZIP (XLSX). Qualquer outra coisa é falha, não dado.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(`INDEA devolveu conteúdo que não é XLSX (${buffer.length} bytes)`);
  }
  return buffer;
}

/** Converte "MM/YYYY" em { ano, mes }. */
function parsearCompetencia(mesBr: string): { ano: number; mes: number } | null {
  const [mes, ano] = mesBr.split("/").map(Number);
  if (!mes || !ano || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

const SEXO_MT: Record<string, Sexo> = { F: "FEMEA", M: "MACHO" };

/**
 * Lê o relatório GTA Condensado do INDEA, que já vem AGREGADO por
 * (origem, destino, mês, espécie, finalidade, faixa, sexo). Soma o abate
 * bovino por competência e sexo, devolvendo um agregado mensal por mês
 * encontrado no arquivo (uma consulta de intervalo pode cobrir dois meses).
 */
export async function parsearMt(caminho: string): Promise<AgregadoMensal[]> {
  const acumulado = new Map<string, AgregadoMensal>();

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "ESPÉCIE",
  })) {
    const especie = textoCelula(valores[colunas["ESPÉCIE"]!]);
    const finalidade = textoCelula(valores[colunas["FINALIDADE"]!]);
    if (especie !== "BOVINO" || finalidade !== "ABATE") continue;

    const sexo = SEXO_MT[textoCelula(valores[colunas["SEXO"]!])];
    if (!sexo) continue; // ignora o "A" (sem sexo)

    const competencia = parsearCompetencia(textoCelula(valores[colunas["MÊS"]!]));
    if (!competencia) continue;

    const quantidade = Number(textoCelula(valores[colunas["QNT"]!])) || 0;
    if (quantidade <= 0) continue;

    const chave = `${competencia.ano}-${competencia.mes}-${sexo}`;
    const atual = acumulado.get(chave);
    if (atual) {
      atual.quantidade += quantidade;
    } else {
      acumulado.set(chave, {
        uf: "MT",
        ano: competencia.ano,
        mes: competencia.mes,
        finalidade: "ABATE",
        sexo,
        quantidade,
      });
    }
  }

  return [...acumulado.values()];
}

export interface ColetaMt {
  agregados: AgregadoMensal[];
  arquivo: Buffer;
  hash: string;
  nomeArquivo: string;
}

/** Baixa, valida, e agrega o abate bovino do MT para a janela informada. */
export async function coletarMt(janela: Janela, cpf: string, senha: string): Promise<ColetaMt> {
  const arquivo = await baixarMt(janela, cpf, senha);
  const hash = createHash("sha256").update(arquivo).digest("hex");
  const nomeArquivo = `mt/${janela.inicio}_a_${janela.fim}.xlsx`;
  const temporario = join(tmpdir(), `mt-${hash.slice(0, 12)}.xlsx`);
  await writeFile(temporario, arquivo);
  const agregados = await parsearMt(temporario);
  return { agregados, arquivo, hash, nomeArquivo };
}
