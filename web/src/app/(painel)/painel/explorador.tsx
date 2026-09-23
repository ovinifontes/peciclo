"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";

import type { LinhaMensal } from "@/lib/dados";
import CabecalhoVisoes from "./cabecalho-visoes";
import { COR_UF, NOME_UF, UFS_GRAFICO, type LinhaGrafico, type UF } from "./estados";
import { serieSomadaPorSexo, type EntradaSexo, type PontoSexo } from "./serie-sexo";
import { ehPorSexo, ROTULO_VER, temDuasSecoes, VISOES, type Ver } from "./visoes";
import Exportavel from "./exportavel";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const inteiro = new Intl.NumberFormat("pt-BR");
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const comSinal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

// A mesma fronteira do grafico-femeas: o Recharts (~112 KB gzip) só é baixado
// quando alguém abre uma visão de gráficos — nunca no pacote inicial do site.
// Linhas e Colunas são módulos irmãos de propósito: cada visão baixa só o
// gráfico que usa, e o miolo comum do Recharts sai num chunk compartilhado.
const GraficoLinhas = dynamic(() => import("./graficos-estados-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});
const GraficoColunas = dynamic(() => import("./colunas-estados-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

const GraficoArea = dynamic(() => import("./area-sexo-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

const GraficoCemPorCento = dynamic(() => import("./cem-por-cento-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

export type { Ver } from "./visoes";

/** Fêmeas e machos de um estado num mês, somados da série crua. */
interface CelulaMes {
  femeas: number | null;
  machos: number | null;
}

interface MesAgregado {
  /** "2026-07" — ordena e compara por texto sem montar Date nenhum. */
  chave: string;
  ano: number;
  mes: number;
  /** Rótulo curto do eixo X: "07/26". */
  competencia: string;
  porUf: Partial<Record<UF, CelulaMes>>;
}

/** "2026-08" -> "agosto de 2026". */
function mesLongo(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MESES[(mes ?? 1) - 1]} de ${ano}`;
}

/**
 * Agrupa a série crua por mês, DESCARTANDO o mês corrente do calendário (e
 * qualquer coisa depois dele): ele está sempre pela metade e desenharia uma
 * queda que não existe. `mesCorrente` vem calculado no servidor — aqui não
 * entra `new Date()`, que divergiria entre servidor e navegador.
 * A tabela é outro recorte: lá o parcial aparece, com travessão.
 */
function agruparMeses(serie: LinhaMensal[], mesCorrente: string): MesAgregado[] {
  const porMes = new Map<string, MesAgregado>();
  for (const linha of serie) {
    const chave = `${linha.ano}-${String(linha.mes).padStart(2, "0")}`;
    if (chave >= mesCorrente) continue;
    let m = porMes.get(chave);
    if (!m) {
      m = {
        chave,
        ano: linha.ano,
        mes: linha.mes,
        competencia: `${String(linha.mes).padStart(2, "0")}/${String(linha.ano).slice(2)}`,
        porUf: {},
      };
      porMes.set(chave, m);
    }
    const celula = (m.porUf[linha.uf] ??= { femeas: null, machos: null });
    if (linha.sexo === "FEMEA") celula.femeas = (celula.femeas ?? 0) + linha.quantidade;
    else celula.machos = (celula.machos ?? 0) + linha.quantidade;
  }
  return [...porMes.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

function totalCelula(celula?: CelulaMes): number | null {
  if (!celula || (celula.femeas === null && celula.machos === null)) return null;
  return (celula.femeas ?? 0) + (celula.machos ?? 0);
}

/** % de fêmeas — só existe quando os dois sexos foram publicados. */
function pctCelula(celula?: CelulaMes): number | null {
  if (!celula || celula.femeas === null || celula.machos === null) return null;
  const total = celula.femeas + celula.machos;
  return total > 0 ? (celula.femeas / total) * 100 : null;
}

/**
 * Achata os meses agregados no formato do Recharts — uma linha por
 * competência, uma coluna por UF. Serve às DUAS visões de gráfico: as Linhas
 * recebem a série inteira, as Colunas recebem o recorte dos últimos 12 meses.
 */
function linhasDoGrafico(
  meses: MesAgregado[],
  ufs: UF[],
  metrica: "total" | "pct",
): LinhaGrafico[] {
  return meses.map((m) => {
    const linha: LinhaGrafico = { competencia: m.competencia };
    for (const uf of ufs) {
      if (metrica === "total") {
        linha[uf] = totalCelula(m.porUf[uf]);
      } else {
        const pct = pctCelula(m.porUf[uf]);
        linha[uf] = pct === null ? null : Number(pct.toFixed(1));
      }
    }
    return linha;
  });
}

/** Achata os meses agregados no formato que `serieSomadaPorSexo` consome. */
function entradasDeSexo(meses: MesAgregado[]): EntradaSexo[] {
  const saida: EntradaSexo[] = [];
  for (const m of meses) {
    for (const [uf, celula] of Object.entries(m.porUf)) {
      saida.push({ rotulo: m.competencia, chave: m.chave, uf: uf as UF, celula });
    }
  }
  return saida;
}

interface Indicadores {
  /** "julho de 2026" — a competência dos números, dita em todos os cartões. */
  competencia: string | null;
  total: number | null;
  pct: number | null;
  varTotal: number | null;
  varPct: number | null;
  mesBase: string | null;
}

/**
 * KPIs do último mês FECHADO POR TODOS os estados selecionados — somar um mês
 * em que um deles ainda não publicou seria apresentar um total capenga como se
 * fosse inteiro. Com o PA ligado a competência costuma recuar uns dois meses;
 * é o preço da honestidade, e os cartões dizem qual mês estão mostrando.
 */
function calcularIndicadores(meses: MesAgregado[], ufs: UF[]): Indicadores {
  const vazio: Indicadores = {
    competencia: null, total: null, pct: null, varTotal: null, varPct: null, mesBase: null,
  };
  const completos = meses.filter((m) => ufs.every((uf) => pctCelula(m.porUf[uf]) !== null));
  const atual = completos.at(-1);
  if (!atual) return vazio;

  const totalDe = (m: MesAgregado) =>
    ufs.reduce((soma, uf) => soma + (totalCelula(m.porUf[uf]) ?? 0), 0);
  const femeasDe = (m: MesAgregado) =>
    ufs.reduce((soma, uf) => soma + (m.porUf[uf]?.femeas ?? 0), 0);

  const total = totalDe(atual);
  const pct = total > 0 ? (femeasDe(atual) / total) * 100 : null;

  const anterior = completos.find((m) => m.ano === atual.ano - 1 && m.mes === atual.mes);
  const totalAnterior = anterior ? totalDe(anterior) : null;
  const pctAnterior = anterior ? (totalAnterior! > 0 ? (femeasDe(anterior) / totalAnterior!) * 100 : null) : null;

  return {
    competencia: mesLongo(atual.chave),
    total,
    pct,
    varTotal: totalAnterior ? (total / totalAnterior - 1) * 100 : null,
    varPct: pct !== null && pctAnterior !== null ? pct - pctAnterior : null,
    mesBase: anterior ? mesLongo(anterior.chave) : null,
  };
}

/**
 * A seção "Abate mensal por estado" em três modos: a tabela de sempre
 * (server-rendered, chega pronta pela prop `tabela`), as Linhas e as Colunas
 * — as duas visões de gráfico com o mesmo filtro por estado e os mesmos KPIs.
 * O modo inicial vem de `?ver=` para as visões poderem ser favoritadas
 * (`?ver=graficos`, o valor antigo, vira Linhas lá no `page.tsx`).
 *
 * Cada visão tem um "Exportar imagem": baixa um PNG SEMPRE em leiaute de
 * desktop (1080px), em qualquer aparelho — o clique monta o cartão do
 * `exportavel.tsx` fora da tela com a visão corrente, espera o Recharts medir
 * e desenhar, e o `exportar.ts` fotografa o CARTÃO, nunca o nó visível (que
 * no celular está estreito e sairia com o leiaute errado).
 */
export default function Explorador({
  serie,
  mesCorrente,
  verInicial,
  titulo,
  descricao,
  tabela,
}: {
  serie: LinhaMensal[];
  /** "2026-08", calculado no servidor (fuso de Brasília). */
  mesCorrente: string;
  verInicial: Ver;
  titulo: string;
  descricao: ReactNode;
  tabela: ReactNode;
}) {
  const [ver, setVer] = useState<Ver>(verInicial);
  const [ativas, setAtivas] = useState<ReadonlySet<UF>>(() => new Set(UFS_GRAFICO));
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const exportavelRef = useRef<HTMLDivElement>(null);

  const meses = useMemo(() => agruparMeses(serie, mesCorrente), [serie, mesCorrente]);

  // Ordem fixa de exibição — a cor segue o estado, não a posição na lista.
  const ufsAtivas = UFS_GRAFICO.filter((uf) => ativas.has(uf));

  // Meses em que nenhum estado selecionado tem dado saem do eixo (só com o PA
  // sozinho isso acontece: os meses que ele ainda não publicou).
  const mesesVisiveis = meses.filter((m) =>
    ufsAtivas.some((uf) => totalCelula(m.porUf[uf]) !== null),
  );

  // Vários estados × 18+ meses em barras agrupadas seria ilegível: as Colunas
  // mostram só os últimos 12 meses fechados, com nota. As Linhas seguem inteiras.
  const mesesDoGrafico = ver === "colunas" ? mesesVisiveis.slice(-12) : mesesVisiveis;
  const colunasCortadas = ver === "colunas" && mesesVisiveis.length > mesesDoGrafico.length;

  const linhasTotal = linhasDoGrafico(mesesDoGrafico, ufsAtivas, "total");
  const linhasPct = linhasDoGrafico(mesesDoGrafico, ufsAtivas, "pct");

  // Área e 100% somam os estados e separam por sexo. Partem de `mesesVisiveis`
  // e não de `mesesDoGrafico`: o corte de 12 meses existe para barras
  // AGRUPADAS por estado ficarem legíveis, e a pilha de duas faixas não tem
  // esse problema.
  const pontosSexo = useMemo(
    () => serieSomadaPorSexo(entradasDeSexo(mesesVisiveis), ufsAtivas),
    [mesesVisiveis, ufsAtivas],
  );

  // As visões por ESTADO compartilham a casca (filtro, KPIs, títulos, notas);
  // só o desenho muda — linhas contínuas ou barras agrupadas.
  const CorpoGrafico = ver === "colunas" ? GraficoColunas : GraficoLinhas;

  const ind = calcularIndicadores(meses, ufsAtivas);

  function mudarVer(novo: Ver) {
    setVer(novo);
    // `?ver=linhas`/`?ver=colunas` sobrevivem a recarga e a favorito; a URL
    // limpa é a tabela.
    const url = new URL(window.location.href);
    if (novo === "tabela") url.searchParams.delete("ver");
    else url.searchParams.set("ver", novo);
    window.history.replaceState(null, "", url);
  }

  async function exportar() {
    if (exportando) return;
    // `exportando` faz duas coisas: vira o botão para "gerando…" e monta o
    // cartão do `exportavel.tsx` fora da tela (o `{cartao && ...}` lá embaixo).
    setExportando(true);
    setErroExportar(null);
    try {
      // Import dinâmico no clique: o html-to-image, que o exportar.ts importa
      // por dentro, nunca entra no JavaScript inicial da página.
      const { exportarPng } = await import("./exportar");
      // Espera a renderização REAL do cartão: dois requestAnimationFrame
      // garantem o commit do React e o primeiro paint; os ~450ms dão tempo ao
      // ResponsiveContainer do Recharts, que mede o contêiner de forma
      // assíncrona antes de desenhar o SVG nos 1080px.
      await new Promise<void>((resolver) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setTimeout(resolver, 450));
        });
      });
      const no = exportavelRef.current;
      if (!no) throw new Error("cartão de exportação não montou");
      await exportarPng(no, ver);
    } catch {
      // Recado curto; a tela nunca quebra por causa de um export.
      setErroExportar("Não deu para gerar a imagem — tente de novo.");
    } finally {
      // Desmonta o cartão mesmo quando a captura falha.
      setExportando(false);
    }
  }

  function alternarUf(uf: UF) {
    setAtivas((atuais) => {
      if (atuais.has(uf) && atuais.size === 1) return atuais; // pelo menos 1
      const novas = new Set(atuais);
      if (novas.has(uf)) novas.delete(uf);
      else novas.add(uf);
      return novas;
    });
  }

  // Legenda e KPIs do cartão de exportação. Nos gráficos, os estados
  // filtrados; na tabela — que mostra sempre todos —, todos: um filtro
  // invisível herdado dos gráficos mentiria sobre o conteúdo da foto.
  const ufsTabela = [...UFS_GRAFICO];
  const cartao = exportando
    ? ver === "tabela"
      ? { ufs: ufsTabela, ind: calcularIndicadores(meses, ufsTabela) }
      : { ufs: ufsAtivas, ind }
    : null;

  /**
   * O corpo do gráfico — o MESMO nas duas saídas, tela e cartão de exportação.
   * Eram dois trechos iguais e, no dia em que divergissem, a foto deixaria de
   * ser o que está na tela. Os KPIs ficam de fora do cartão porque o
   * `Exportavel` já os desenha na moldura dele — incluí-los aqui os
   * imprimia duas vezes no PNG.
   */
  function corpoGrafico(indicadores: Indicadores, comKpis: boolean): ReactNode {
    if (ehPorSexo(ver)) {
      if (pontosSexo.length === 0) {
        return (
          <p className="text-sm text-neutral-600">
            Nenhum mês fechado por <strong>todos</strong> os estados selecionados — estas duas
            visões somam os estados, e somar mês incompleto desenharia uma queda que não existe.
          </p>
        );
      }
      const Corpo = ver === "area" ? GraficoArea : GraficoCemPorCento;
      return (
        <>
          {comKpis && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cartoesKpi(indicadores)}</div>
          )}
          <div>
            <h3 className="text-sm font-medium text-neutral-800">
              {ver === "area"
                ? "Cabeças abatidas por mês, por sexo"
                : "Composição do abate por mês"}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Soma de {ufsAtivas.join(" + ")} — só os meses que todos publicaram.
            </p>
            <div className="mt-2 h-[280px] w-full">
              <Corpo pontos={pontosSexo} animar={!exportando} />
            </div>
          </div>
        </>
      );
    }

    if (mesesVisiveis.length === 0) {
      return (
        <p className="text-sm text-neutral-600">
          Nenhum mês fechado para os estados selecionados — nada para desenhar ainda.
        </p>
      );
    }
    return (
      <>
        {comKpis && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cartoesKpi(indicadores)}</div>
        )}
        <SecoesGrafico
          Corpo={CorpoGrafico}
          ufs={ufsAtivas}
          linhasTotal={linhasTotal}
          linhasPct={linhasPct}
          cortadas={colunasCortadas}
          mesCorrente={mesCorrente}
        />
      </>
    );
  }

  return (
    <>
      <CabecalhoVisoes
        titulo={titulo}
        ver={ver}
        aoTrocar={mudarVer}
        aoExportar={exportar}
        exportando={exportando}
        erroExportar={erroExportar}
        descricao={descricao}
      />

      <div className="mt-4">
        {ver === "tabela" ? (
          tabela
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-500">Estados</span>
              {UFS_GRAFICO.map((uf) => {
                const ativa = ativas.has(uf);
                return (
                  <button
                    key={uf}
                    type="button"
                    aria-pressed={ativa}
                    title={NOME_UF[uf]}
                    onClick={() => alternarUf(uf)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ouro)] ${
                      ativa
                        ? "text-neutral-800"
                        : "border-neutral-200 bg-white text-neutral-400 hover:text-neutral-600"
                    }`}
                    style={ativa ? { borderColor: COR_UF[uf], backgroundColor: `${COR_UF[uf]}14` } : undefined}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ativa ? COR_UF[uf] : "#d4d4d4" }}
                    />
                    {uf}
                  </button>
                );
              })}
            </div>

            {corpoGrafico(ind, true)}
          </div>
        )}
      </div>

      {/* O cartão de exportação: só existe durante o clique em Exportar, fora
          da tela, com a MESMA visão e os MESMOS dados — é ele que vira PNG. */}
      {cartao && (
        <Exportavel
          ref={exportavelRef}
          rotulo={ROTULO_VER[ver]}
          ufs={cartao.ufs}
          kpis={cartoesKpi(cartao.ind)}
        >
          {ver === "tabela" ? tabela : corpoGrafico(cartao.ind, false)}
        </Exportavel>
      )}
    </>
  );
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-neutral-500">{rotulo}</p>
      <p className="mt-0.5 text-xl font-semibold text-neutral-900">{valor}</p>
      <p className="mt-0.5 text-xs text-neutral-400">{nota}</p>
    </div>
  );
}

/**
 * Os quatro cartões de KPI, sem a grade em volta — a tela os põe numa grade
 * responsiva (2×2 no celular), o cartão de exportação numa linha fixa de 4.
 */
function cartoesKpi(ind: Indicadores): ReactNode {
  return (
    <>
      <Kpi
        rotulo="Cabeças abatidas"
        valor={ind.total !== null ? inteiro.format(ind.total) : "—"}
        nota={ind.competencia ?? "sem mês fechado por todos"}
      />
      <Kpi
        rotulo="Fêmeas no abate"
        valor={ind.pct !== null ? `${umaCasa.format(ind.pct)}%` : "—"}
        nota={ind.competencia ?? "sem mês fechado por todos"}
      />
      <Kpi
        rotulo="Total vs ano anterior"
        valor={ind.varTotal !== null ? `${comSinal.format(ind.varTotal)}%` : "—"}
        nota={ind.mesBase ? `vs ${ind.mesBase}` : "sem o mesmo mês do ano anterior"}
      />
      <Kpi
        rotulo="Fêmeas vs ano anterior"
        valor={ind.varPct !== null ? `${comSinal.format(ind.varPct)} p.p.` : "—"}
        nota={ind.mesBase ? `vs ${ind.mesBase}` : "sem o mesmo mês do ano anterior"}
      />
    </>
  );
}

/** As props que os módulos Linhas e Colunas compartilham. */
interface PropsCorpoGrafico {
  ufs: UF[];
  linhas: LinhaGrafico[];
  unidade: "cabecas" | "pct";
  animar?: boolean;
}

/**
 * Os dois gráficos da visão corrente (total e participação de fêmeas) com a
 * nota de método — o MESMO markup na tela e no cartão de exportação, para os
 * dois nunca divergirem. `animar={false}` nos dois lugares: na tela a casa
 * sempre desenhou sem animação, e no cartão é obrigatório — a foto pegaria o
 * traço no meio do caminho.
 */
function SecoesGrafico({
  Corpo,
  ufs,
  linhasTotal,
  linhasPct,
  cortadas,
  mesCorrente,
}: {
  Corpo: ComponentType<PropsCorpoGrafico>;
  ufs: UF[];
  linhasTotal: LinhaGrafico[];
  linhasPct: LinhaGrafico[];
  cortadas: boolean;
  mesCorrente: string;
}) {
  return (
    <>
      <div>
        <h3 className="text-sm font-medium text-neutral-800">Cabeças abatidas por mês</h3>
        {cortadas && (
          <p className="mt-0.5 text-xs text-neutral-500">
            Últimos 12 meses — a visão Linhas mostra a série inteira.
          </p>
        )}
        <div className="mt-2 h-[280px] w-full">
          <Corpo ufs={ufs} linhas={linhasTotal} unidade="cabecas" animar={false} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-neutral-800">
          Participação de fêmeas no abate
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Acima da linha de 50%, abatem-se mais fêmeas que machos.
        </p>
        <div className="mt-2 h-[280px] w-full">
          <Corpo ufs={ufs} linhas={linhasPct} unidade="pct" animar={false} />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-neutral-500">
        Dois recortes de honestidade: o mês corrente ({mesLongo(mesCorrente)}) fica fora
        dos gráficos e dos indicadores — ainda está em coleta, e o parcial desenharia uma
        queda que não existe —, e cada estado aparece até o último mês que publicou: nas
        Linhas a série termina ali; nas Colunas, mês sem dado fica sem barra. Os indicadores usam o último mês
        fechado por <strong>todos</strong> os estados selecionados, indicado nos cartões.
        O parcial do mês corrente está na Tabela.
      </p>
    </>
  );
}
