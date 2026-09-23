/**
 * Coletor do MT no SINDESA 2 — o portal NOVO do INDEA
 * (https://sindesa2.indea.mt.gov.br/sindesa), no ar desde 09/2026.
 *
 * Por que existe: o portal velho (InfoSindesa) parou de receber guia nova em
 * 07/08/2026 e devolve vazio de lá em diante. O novo tem o dado, mas NÃO tem
 * relatório somado: a tela lista GTAs e os quatro botões de exportação cospem
 * só metadado da guia — sem sexo, sem quantidade. O número por sexo mora
 * dentro de cada GTA, na tabela "Estratificação", onde a faixa etária carrega
 * o sexo colado ("13 A 24 MESES - MACHO").
 *
 * Então o caminho é caro e não há outro: listar as GTAs do dia (barato, ~17
 * páginas) e abrir uma por uma (~800 a 1.200 por dia útil). Procurei
 * alternativa em todos os ~90 relatórios do menu e nos filtros de valor — não
 * existe agregado por sexo neste portal.
 *
 * A tela é JSF/PrimeFaces com ViewState, então a navegação é por browser de
 * verdade (Playwright, já dependência do projeto). Os DETALHES, porém, saem
 * por GET simples reaproveitando o cookie da sessão — sem renderizar página,
 * que é o que torna mil aberturas viáveis.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AgregadoDiario, Sexo } from "../tipos.js";

/**
 * O que o NAVEGADOR oferece dentro de `page.evaluate`. O tsconfig do projeto é
 * de servidor e não carrega a lib DOM; declarar o mínimo aqui mantém o resto
 * do código sem acesso acidental a `document`, que é o certo para tudo que
 * roda no Trigger.dev. Por isso o acesso é sempre via `janela()`, nunca pelos
 * globais soltos `window`/`document`.
 */
interface ElementoPf {
  value: string;
  options?: Array<{ value: string; textContent: string | null }>;
  getAttribute: (nome: string) => string | null;
  classList: { contains: (classe: string) => boolean };
}
interface WidgetPf {
  id?: string;
  hide?: () => void;
  selectValue?: (valor: string) => void;
  setDate?: (data: Date) => void;
  paginator?: {
    cfg: { rowCount: number; rows: number; page: number; pageCount: number };
    setRowsPerPage?: (n: number) => void;
    setPage?: (p: number) => void;
  };
}
interface JanelaPf {
  PrimeFaces: { widgets: Record<string, WidgetPf | undefined> };
  $: (alvo: unknown) => { trigger: (evento: string) => void };
  document: {
    getElementById: (id: string) => ElementoPf | null;
    querySelector: (seletor: string) => ElementoPf | null;
    querySelectorAll: (seletor: string) => ElementoPf[];
  };
}
/**
 * ATENÇÃO ao mexer aqui: todo corpo de `page.evaluate` é serializado e roda
 * DENTRO do navegador, onde nada deste módulo existe. Nenhum helper daqui pode
 * ser chamado lá — cada callback se vira sozinho. Só os TIPOS acima atravessam,
 * porque somem na compilação. Extrair "para não repetir" quebra em produção sem
 * o typecheck reclamar, que é o pior jeito de descobrir.
 */

const BASE = "https://sindesa2.indea.mt.gov.br/sindesa";
const MODULO = "525"; // Módulo Animal
/** Linhas por página na tabela de resultados: 50 é o máximo que a tela oferece. */
const LINHAS_POR_PAGINA = 50;

export class SessaoSindesa2Error extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SessaoSindesa2Error";
  }
}

export interface LinhaEstratificacao {
  faixa: string;
  sexo: Sexo;
  quantidade: number;
}

export interface GtaLida {
  id: string;
  linhas: LinhaEstratificacao[];
  /** Taxa do INDEA da guia, cobrada POR ANIMAL — a régua de conferência. */
  valorGta: number | null;
}

/**
 * Lê a tabela "Estratificação" do HTML da GTA. A faixa etária vem com o sexo
 * colado ("13 A 24 MESES - MACHO"); a 3ª coluna é a Quantidade Saída.
 *
 * Âncora no id da tabela (`idTableGtaEstratificacao_data`) e não na ordem das
 * tabelas da página: a GTA tem mais de dez tabelas (marcas, vacinas, exames,
 * DARs) e contar posição quebraria no primeiro layout novo.
 */
export function parsearEstratificacao(html: string): LinhaEstratificacao[] {
  const inicio = html.indexOf("idTableGtaEstratificacao_data");
  if (inicio < 0) return [];
  const fim = html.indexOf("</tbody>", inicio);
  const corpo = html.slice(inicio, fim < 0 ? undefined : fim);

  const linhas: LinhaEstratificacao[] = [];
  for (const tr of corpo.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const celulas = [...tr[1]!.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((td) =>
      td[1]!
        // spans ocultos guardam o id interno da linha e sujariam o texto
        .replace(/<span style="display: none;">[^<]*<\/span>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim(),
    );
    const achado = /^(.*?)\s*-\s*(MACHO|F[ÊE]MEA)$/.exec(celulas[0] ?? "");
    if (!achado) continue;
    const quantidade = Number(celulas[2]);
    if (!Number.isFinite(quantidade) || quantidade <= 0) continue;
    linhas.push({
      faixa: achado[1]!.trim(),
      sexo: achado[2]!.startsWith("M") ? "MACHO" : "FEMEA",
      quantidade,
    });
  }
  return linhas;
}

/** "Valor Taxa INDEA por GTA: 496,32" → 496.32. */
export function valorGtaDoHtml(html: string): number | null {
  const texto = html.replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
  const achado = /Valor Taxa INDEA por GTA\s*:?\s*\n?\s*([\d.]+,\d{2})/.exec(texto);
  return achado ? Number(achado[1]!.replaceAll(".", "").replace(",", ".")) : null;
}

/**
 * Confere o lote contra a taxa do INDEA, que é cobrada POR ANIMAL: para toda
 * GTA, `valorGta / total de animais` tem que dar o MESMO valor (10,56 em
 * 09/2026). Medido em 10 GTAs reais de 15/09/2026: bateu em 10 de 10.
 *
 * A razão é calculada, nunca fixada em código — a taxa muda por decreto, e um
 * número cravado transformaria o próximo reajuste num falso alarme diário.
 * O que se exige é COERÊNCIA dentro do dia: se a leitura da Estratificação
 * quebrar numa GTA, só o total dela muda e a razão dela destoa das demais.
 *
 * Sem isto, um parser quebrado entrega abate menor em silêncio — e número
 * menor não parece defeito, parece mercado caindo.
 */
export function conferirLote(gtas: GtaLida[]): {
  razao: number | null;
  divergentes: string[];
} {
  const razoes: Array<{ id: string; razao: number }> = [];
  for (const g of gtas) {
    const total = g.linhas.reduce((s, l) => s + l.quantidade, 0);
    if (g.valorGta === null || total <= 0) continue;
    razoes.push({ id: g.id, razao: g.valorGta / total });
  }
  if (razoes.length === 0) return { razao: null, divergentes: [] };

  const ordenadas = [...razoes].sort((a, b) => a.razao - b.razao);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)]!.razao;
  return {
    razao: mediana,
    divergentes: razoes.filter((r) => Math.abs(r.razao - mediana) > mediana * 0.01).map((r) => r.id),
  };
}

/** Soma o lote do dia em duas linhas (MACHO e FEMEA) prontas para o banco. */
export function somarPorSexo(gtas: GtaLida[], dia: string): AgregadoDiario[] {
  const porSexo = new Map<Sexo, number>();
  for (const g of gtas) {
    for (const l of g.linhas) porSexo.set(l.sexo, (porSexo.get(l.sexo) ?? 0) + l.quantidade);
  }
  return [...porSexo].map(([sexo, quantidade]) => ({
    uf: "MT" as const,
    data: dia,
    finalidade: "ABATE",
    sexo,
    quantidade,
  }));
}

/** YYYY-MM-DD → dd/MM/yyyy, que é o formato do formulário. */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export interface SessaoSindesa2 {
  ctx: BrowserContext;
  page: Page;
  fechar: () => Promise<void>;
}

/** Abre o browser, autentica e devolve a sessão para reaproveitar em todos os dias. */
export async function abrirSessaoSindesa2(cpf: string, senha: string): Promise<SessaoSindesa2> {
  // `launch()` + `newContext()`, não `launchPersistentContext`: é o mesmo
  // caminho que o robô das imagens diárias já usa em produção, e perfil
  // persistente em container é fonte de dor sem nenhum ganho aqui.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.fill("#login", cpf);
  await page.fill("#senha", senha);
  await page.click("#btnSubmit");
  await page.waitForLoadState("networkidle", { timeout: 90_000 });
  if (page.url().includes("/login")) {
    await browser.close();
    throw new SessaoSindesa2Error(`SINDESA 2 recusou a credencial (parou em ${page.url()})`);
  }
  return { ctx, page, fechar: () => browser.close() };
}

/**
 * Escolhe um valor num selectOneMenu do PrimeFaces pela API do widget.
 * Clicar no painel é frágil: o painel com campo de filtro fica aberto e
 * intercepta o clique seguinte (custou meia hora de timeouts na exploração).
 */
async function escolher(page: Page, idWidget: string, rotulo: string): Promise<void> {
  const erro = await page.evaluate(([id, rot]) => {
    const j = globalThis as unknown as JanelaPf;
    const w = Object.values(j.PrimeFaces.widgets).find((x) => x && x.id === id);
    const sel = j.document.getElementById(`${id}_input`);
    if (!sel?.options) return `select ausente: ${id}`;
    // `options` é HTMLOptionsCollection, não Array: sem o spread, `.find` não existe.
    const opcao = [...sel.options].find((o) => o.textContent?.trim() === rot);
    if (!opcao) return `opção ausente: ${rot}`;
    if (w?.selectValue) {
      w.hide?.();
      w.selectValue(opcao.value);
    } else {
      sel.value = opcao.value;
      j.$(sel).trigger("change");
    }
    return null;
  }, [idWidget, rotulo] as const);
  if (erro) throw new SessaoSindesa2Error(erro);
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
  await page.waitForTimeout(600);
}

/** Preenche uma data pelo widget de calendário (o `_input` cru não basta). */
async function preencherData(page: Page, idWidget: string, br: string): Promise<void> {
  await page.evaluate(([id, valor]) => {
    const j = globalThis as unknown as JanelaPf;
    const inp = j.document.getElementById(`${id}_input`);
    if (!inp) return;
    inp.value = valor;
    j.$(inp).trigger("change");
    const w = Object.values(j.PrimeFaces.widgets).find((x) => x && x.id === id);
    if (w?.setDate) {
      const [d, m, a] = valor.split("/").map(Number);
      w.setDate(new Date(a!, m! - 1, d!));
    }
  }, [idWidget, br] as const);
  await page.waitForTimeout(300);
}

/**
 * Deixa a tela de pesquisa com os filtros BOVINO + ABATE montados. Roda uma
 * vez por sessão: depois só as datas mudam, e o JSF guarda o resto no
 * ViewState. Remontar a cada dia custaria 3 AJAX por dia à toa.
 */
export async function prepararPesquisa(page: Page): Promise<void> {
  await page.goto(`${BASE}/gta/geral/pesquisar?moduloid=${MODULO}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });

  for (const [rotulo, marcador, valor] of [
    ["Espécie", "especie", "BOVINO"],
    ["Finalidade", "finalidade", "ABATE"],
  ] as const) {
    // A AJAX de "Adicionar filtro" às vezes não pega de primeira; insistir é
    // mais barato que descobrir depois que o dia inteiro veio sem filtro.
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      if (await page.$(`select[id*='${marcador}']`)) break;
      await escolher(page, "filtrosForm_filter_selectOneMenuField", rotulo);
      // Espera crescente: a AJAX que adiciona o filtro às vezes demora mais
      // que o `networkidle`, e insistir no mesmo ritmo só repete a falha.
      await page.waitForTimeout(800 * tentativa);
    }
    const alvo = (await page.$$eval("select[id*='listField']", (ss) => ss.map((s) => s.id)))
      .map((i) => i.replace(/_input$/, ""))
      .find((i) => i.includes(marcador));
    if (!alvo) throw new SessaoSindesa2Error(`o filtro de ${rotulo} não apareceu na tela`);
    await escolher(page, alvo, valor);
  }
}

const ID_TABELA = "resultadoForm_datatable_dataTabledatatable";

const primeiroIdDaPagina = (page: Page) =>
  page.evaluate(() => {
    const j = globalThis as unknown as JanelaPf;
    const b = j.document.querySelector("[id$='_visualizar']");
    return b ? /,\s*(\d+)\)/.exec(b.getAttribute("onclick") ?? "")?.[1] ?? null : null;
  });

const idsDaPagina = (page: Page) =>
  page.evaluate(() => {
    const j = globalThis as unknown as JanelaPf;
    return [...j.document.querySelectorAll("[id$='_visualizar']")]
      .map((b) => /,\s*(\d+)\)/.exec(b.getAttribute("onclick") ?? "")?.[1])
      .filter((x): x is string => Boolean(x));
  });

/**
 * Ids internos das GTAs de BOVINO/ABATE emitidas no dia.
 *
 * O id interno só existe no onclick do botão "Visualizar" — o CSV exportado
 * traz o número da GTA, que não abre o detalhe. Por isso a listagem é raspada
 * da tela em vez de baixada.
 */
export async function idsDoDia(page: Page, dia: string): Promise<string[]> {
  const br = formatarDataBr(dia);
  await preencherData(page, "filtrosForm_filter_datedataEmissao_11", br);
  await preencherData(page, "filtrosForm_filter_datedataEmissao_12", br);

  const botao = await page.$("#filtrosForm_buttons_pesquisar_btnPesquisar");
  if (!botao) {
    throw new SessaoSindesa2Error(
      `a tela de pesquisa sumiu em ${dia}: ${(await page.innerText("body")).replace(/\s+/g, " ").slice(0, 200)}`,
    );
  }
  await botao.click();
  await page.waitForLoadState("networkidle", { timeout: 180_000 });
  await page.waitForTimeout(1200);

  // Zero NÃO pode ser lido como "dia sem abate". Quando o ViewState do JSF
  // envelhece, a pesquisa volta uma página de erro ("Accesso Negado") ou sem
  // tabela nenhuma, e ler isso como zero grava um dia vazio que na verdade
  // teve 25 mil cabeças — falha silenciosa, exatamente a que este projeto
  // combate. Só é zero de verdade quando a própria tela diz "Sem Registros".
  const estado = await page.evaluate((id) => {
    const j = globalThis as unknown as JanelaPf;
    const paginador = Object.values(j.PrimeFaces.widgets).find((x) => x && x.id === id)?.paginator;
    const corpo = j.document.querySelector("body");
    const texto = (corpo as unknown as { innerText?: string })?.innerText ?? "";
    return {
      temPaginador: Boolean(paginador),
      total: paginador?.cfg.rowCount ?? 0,
      semRegistros: /Sem Registros/i.test(texto),
      erro: /Accesso Negado|Acesso Negado|Erro na Execução|Struts Problem/i.test(texto)
        ? texto.replace(/\s+/g, " ").slice(0, 160)
        : null,
    };
  }, ID_TABELA);

  if (estado.erro) throw new SessaoSindesa2Error(`${dia}: o portal recusou a pesquisa — ${estado.erro}`);
  if (!estado.temPaginador && !estado.semRegistros) {
    throw new SessaoSindesa2Error(
      `${dia}: a pesquisa não devolveu tabela de resultados — página quebrada, não dia vazio`,
    );
  }
  const total = estado.total;
  if (total === 0) return [];

  // 50 por página: 10 (o padrão) faria ~100 idas ao servidor por dia.
  if (total > LINHAS_POR_PAGINA) {
    await page.evaluate(([id, linhas]) => {
      const j = globalThis as unknown as JanelaPf;
      Object.values(j.PrimeFaces.widgets).find((x) => x && x.id === id)?.paginator?.setRowsPerPage?.(linhas);
    }, [ID_TABELA, LINHAS_POR_PAGINA] as const);
    // Esperar a tabela REALMENTE virar 50 linhas. Sem isto, a primeira página
    // era colhida ainda com as 10 do padrão e o "próximo" já pulava para a
    // linha 51 — sumiam as linhas 11 a 50, exatos 40 registros, e o dia
    // entrava menor do que foi. Só não entrou porque a conferência final
    // recusa; a causa é esta.
    const esperado = Math.min(LINHAS_POR_PAGINA, total);
    await page.waitForFunction(
      (quantas) => {
        const j = globalThis as unknown as JanelaPf;
        return j.document.querySelectorAll("[id$='_visualizar']").length === quantas;
      },
      esperado,
      { timeout: 60_000 },
    );
  }

  // Paginação por ÍNDICE, esperando o CONTEÚDO trocar — as duas coisas.
  //
  // Só o índice não basta: `cfg.page` é otimista, o PrimeFaces marca a página
  // pedida antes de a resposta chegar, e ler o DOM nesse instante devolve a
  // página ANTERIOR de novo. Como os ids entram num Set, essas 50 linhas
  // repetidas viravam 50 linhas perdidas — o déficit de exatos 50 que apareceu
  // em 17/08 e 21/08 (diagnosticado página a página: "p9: 50 linhas, 0 novas").
  //
  // Só esperar o conteúdo também não basta: era o desenho anterior, e quando a
  // espera estourava eu reclicava "próximo", às vezes avançando duas páginas.
  // Mandar a página por índice torna repetir o pedido inofensivo.
  const ids = new Set<string>();
  const paginas = Math.max(1, Math.ceil(total / Math.min(LINHAS_POR_PAGINA, total)));
  let primeiroAnterior: string | null = null;

  for (let k = 0; k < paginas; k++) {
    if (k > 0) {
      let trocou = false;
      for (let tentativa = 1; tentativa <= 3 && !trocou; tentativa++) {
        await page.evaluate(([id, alvo]) => {
          const j = globalThis as unknown as JanelaPf;
          Object.values(j.PrimeFaces.widgets).find((x) => x && x.id === id)?.paginator?.setPage?.(alvo);
        }, [ID_TABELA, k] as const);
        try {
          await page.waitForFunction(
            (anterior) => {
              const j = globalThis as unknown as JanelaPf;
              const b = j.document.querySelector("[id$='_visualizar']");
              const atual = b ? /,\s*(\d+)\)/.exec(b.getAttribute("onclick") ?? "")?.[1] ?? null : null;
              return atual !== null && atual !== anterior;
            },
            primeiroAnterior,
            { timeout: 30_000 },
          );
          trocou = true;
        } catch {
          await page.waitForTimeout(2000);
        }
      }
      if (!trocou) {
        throw new SessaoSindesa2Error(
          `${dia}: a página ${k + 1} de ${paginas} não trocou de conteúdo (${ids.size} de ${total} colhidos)`,
        );
      }
    }
    const daPagina = await idsDaPagina(page);
    for (const id of daPagina) ids.add(id);
    primeiroAnterior = daPagina[0] ?? primeiroAnterior;
  }

  if (ids.size !== total) {
    throw new SessaoSindesa2Error(
      `${dia}: a tela diz ${total} GTAs e a paginação rendeu ${ids.size} — gravar daria um dia menor do que é`,
    );
  }
  return [...ids];
}

/**
 * Abre as GTAs por GET, sem renderizar página, reaproveitando o cookie da
 * sessão. É o que torna mil aberturas por dia viáveis: renderizar cada uma no
 * browser custaria ~10x mais.
 */
export async function lerGtas(
  page: Page,
  ids: string[],
  concorrencia = 3,
): Promise<GtaLida[]> {
  const saida: GtaLida[] = [];
  const fila = [...ids];

  /**
   * Uma GTA que expira não pode custar o dia inteiro. Numa corrida de dezenas
   * de dias e dezenas de milhares de aberturas, timeout isolado é rotina, não
   * exceção — e sem tentar de novo aqui, cada um deles obrigaria a refazer
   * ~1.000 aberturas já pagas.
   *
   * Espera crescente (2s, 4s, 8s): se o portal está estrangulando, insistir no
   * mesmo ritmo piora. O timeout é curto de propósito — conexão pendurada some
   * rápido e a tentativa seguinte costuma passar.
   */
  async function buscar(id: string): Promise<string> {
    let ultimo: unknown;
    for (let tentativa = 1; tentativa <= 4; tentativa++) {
      try {
        const resposta = await page.request.get(
          `${BASE}/gta/geral/visualizar/resumo/${id}?perm=pesquisar.gta&moduloid=${MODULO}`,
          { timeout: 45_000 },
        );
        if (!resposta.ok()) throw new SessaoSindesa2Error(`GTA ${id}: HTTP ${resposta.status()}`);
        return await resposta.text();
      } catch (erro) {
        ultimo = erro;
        if (tentativa < 4) await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
      }
    }
    throw ultimo instanceof Error ? ultimo : new SessaoSindesa2Error(`GTA ${id}: ${String(ultimo)}`);
  }

  async function trabalhar(): Promise<void> {
    for (let id = fila.pop(); id !== undefined; id = fila.pop()) {
      const html = await buscar(id);
      // Sessão caída devolve a tela de login com HTTP 200: sem esta checagem,
      // o dia inteiro entraria zerado com cara de dia sem abate.
      if (/name="senha"/i.test(html)) {
        throw new SessaoSindesa2Error(`GTA ${id}: voltou a tela de login — a sessão caiu`);
      }
      saida.push({ id, linhas: parsearEstratificacao(html), valorGta: valorGtaDoHtml(html) });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concorrencia, ids.length) }, trabalhar));
  return saida;
}

export interface DiaSindesa2 {
  dia: string;
  gtas: GtaLida[];
  agregados: AgregadoDiario[];
  semEstratificacao: string[];
  divergentes: string[];
}

/** Coleta um dia inteiro: lista, abre todas as GTAs, soma e confere. */
export async function coletarDiaSindesa2(
  page: Page,
  dia: string,
  concorrencia = 3,
): Promise<DiaSindesa2> {
  const ids = await idsDoDia(page, dia);
  const gtas = ids.length === 0 ? [] : await lerGtas(page, ids, concorrencia);
  const { divergentes } = conferirLote(gtas);
  return {
    dia,
    gtas,
    agregados: somarPorSexo(gtas, dia),
    semEstratificacao: gtas.filter((g) => g.linhas.length === 0).map((g) => g.id),
    divergentes,
  };
}
