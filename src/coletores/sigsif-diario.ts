import type { AgregadoDiario, Sexo, UF } from "../tipos.js";

/**
 * Abate DIÁRIO por sexo, direto da consulta pública do MAPA.
 *
 * "Quantitativos de Animais Abatidos por Sexo e UF" (PGA-SIGSIF) aceita um
 * intervalo de datas, UF e espécie, e devolve a contagem separada em Fêmea e
 * Macho. Pedindo o MESMO dia nas duas pontas, sai o dia.
 *
 * POR QUE EXISTE: o painel do IDARON congelou em 11/09/2026 na migração de
 * plataforma do órgão, e Rondônia ficou sem diário. Esta é a única fonte
 * pública que encontrei com abate diário por sexo por UF, sem login.
 *
 * ⚠️ MEDE OUTRO UNIVERSO, e isto não pode ser esquecido:
 * conta apenas abate sob INSPEÇÃO FEDERAL, e agrega pela UF da GTA (origem do
 * animal), não pela UF da planta. Medido em RO, 01–11/09/2026: o IDARON
 * contou 112.453 cabeças e esta fonte 84.181 — 75%. Por isso grava com fonte
 * PRÓPRIA (`sigsif_dia`): somar ou comparar nível com a série do IDARON
 * produziria um degrau de 25% que não existe no mercado.
 *
 * É JSF (PrimeFaces) com ViewState: cada consulta precisa carregar a página,
 * extrair ViewState + jsessionid + o literal do combo de espécie, e só então
 * postar. Não há atalho de API.
 */

const BASE = "https://sistemas.agricultura.gov.br";
const PAGINA = `${BASE}/pga_sigsif/pages/view/sigsif/abatesexouf/indexAbateSexoPorUf.xhtml`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class SigsifDiarioError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SigsifDiarioError";
  }
}

/** YYYY-MM-DD → dd/MM/yyyy, que é o formato do formulário. */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

interface Sessao {
  viewState: string;
  action: string;
  especieBovino: string;
  cookies: string;
}

/**
 * Abre a página e colhe o que o POST vai exigir.
 *
 * Tudo é por sessão: o `action` traz um `;jsessionid=` embutido e o ViewState
 * é de uso único. Reaproveitar entre consultas devolve ViewExpiredException.
 */
async function abrirFormulario(sinal?: AbortSignal): Promise<Sessao> {
  const resposta = await fetch(PAGINA, {
    headers: { "user-agent": USER_AGENT },
    signal: sinal ?? AbortSignal.timeout(90_000),
  });
  if (!resposta.ok) throw new SigsifDiarioError(`PGA-SIGSIF respondeu HTTP ${resposta.status}`);
  const html = await resposta.text();

  const viewState = /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/.exec(html)?.[1];
  const action = /<form[^>]*id="frmPesquisar"[^>]*action="([^"]+)"/.exec(html)?.[1];
  // O combo manda o objeto serializado inteiro de volta, não um id — e o
  // `rowKey` dentro dele MUDA a cada sessão, então tem de sair desta página.
  const especie = /value="(EspecieVO\[[^"]*Bovino[^"]*\])"/.exec(html)?.[1];

  if (!viewState || !action || !especie) {
    throw new SigsifDiarioError(
      `PGA-SIGSIF: formulário mudou (viewState=${Boolean(viewState)}, action=${Boolean(action)}, especie=${Boolean(especie)})`,
    );
  }
  return {
    viewState,
    action,
    especieBovino: especie.replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
    cookies: (resposta.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
  };
}

/** Lê a tabela de resultado: linhas de Mês/Ano | UF | Espécie | Sexo | Qtd. */
export function parsearResultado(html: string): Record<string, number> {
  const celulas = [...html.matchAll(/<td[^>]*>([^<]{1,60})<\/td>/g)]
    .map((m) => m[1]!.trim())
    .filter(Boolean);

  const porSexo: Record<string, number> = {};
  for (let i = 0; i + 4 <= celulas.length; i += 5) {
    const sexo = celulas[i + 3];
    const quantidade = Number(celulas[i + 4]!.replaceAll(".", ""));
    if (!sexo || !Number.isFinite(quantidade)) continue;
    porSexo[sexo] = (porSexo[sexo] ?? 0) + quantidade;
  }
  return porSexo;
}

const SEXO_SIGSIF: Record<string, Sexo> = { Fêmea: "FEMEA", Femea: "FEMEA", Macho: "MACHO" };

/** Converte os rótulos do MAPA para os do projeto, ignorando o que não é sexo. */
export function normalizarSexos(porSexo: Record<string, number>): Array<{ sexo: Sexo; quantidade: number }> {
  const saida: Array<{ sexo: Sexo; quantidade: number }> = [];
  for (const [rotulo, quantidade] of Object.entries(porSexo)) {
    const sexo = SEXO_SIGSIF[rotulo];
    if (sexo && quantidade > 0) saida.push({ sexo, quantidade });
  }
  return saida;
}

/**
 * Consulta um intervalo (inclusive nas duas pontas) para uma UF.
 * Para um dia só, passe a mesma data em `de` e `ate`.
 */
export async function consultarIntervalo(
  uf: UF,
  de: string,
  ate: string,
  sinal?: AbortSignal,
): Promise<Array<{ sexo: Sexo; quantidade: number }>> {
  const s = await abrirFormulario(sinal);

  const corpo = new URLSearchParams({
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "frmPesquisar:btnConsultar",
    "javax.faces.partial.execute": "@all",
    "javax.faces.partial.render": "@all",
    "frmPesquisar:btnConsultar": "frmPesquisar:btnConsultar",
    frmPesquisar: "frmPesquisar",
    "frmPesquisar:periodo:periodo_startDate_input": formatarDataBr(de),
    "frmPesquisar:periodo:periodo_endDate_input": formatarDataBr(ate),
    "frmPesquisar:cbbUf_focus": "",
    "frmPesquisar:cbbUf_input": `[siglaUf=${uf}]`,
    "frmPesquisar:cbbEspecie:cbbEspecie_focus": "",
    "frmPesquisar:cbbEspecie:cbbEspecie_input": s.especieBovino,
    // Sexo vazio = traz Fêmea E Macho, que é o que se quer.
    "frmPesquisar:cbbSexoAnimal:cbbSexoAnimal_focus": "",
    "frmPesquisar:cbbSexoAnimal:cbbSexoAnimal_input": "",
    "javax.faces.ViewState": s.viewState,
  });

  const resposta = await fetch(`${BASE}${s.action}`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "faces-request": "partial/ajax",
      cookie: s.cookies,
      referer: PAGINA,
    },
    body: corpo,
    signal: sinal ?? AbortSignal.timeout(120_000),
  });
  if (!resposta.ok) {
    throw new SigsifDiarioError(`PGA-SIGSIF respondeu HTTP ${resposta.status} na consulta`);
  }
  const html = await resposta.text();
  if (/ViewExpired|Erro inesperado/i.test(html)) {
    throw new SigsifDiarioError("PGA-SIGSIF: sessão expirou durante a consulta");
  }
  return normalizarSexos(parsearResultado(html));
}

/** Um dia de uma UF, pronto para `gravarAgregadosDiarios`. */
export async function coletarDiaSigsif(
  uf: UF,
  dia: string,
  sinal?: AbortSignal,
): Promise<AgregadoDiario[]> {
  const sexos = await consultarIntervalo(uf, dia, dia, sinal);
  return sexos.map((s) => ({
    uf,
    data: dia,
    finalidade: "ABATE",
    sexo: s.sexo,
    quantidade: s.quantidade,
  }));
}
