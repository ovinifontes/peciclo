"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { LinhaMensal } from "@/lib/dados";
import { COR_UF, NOME_UF, UFS_GRAFICO, type LinhaGrafico, type UF } from "./estados";

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

export type Ver = "tabela" | "linhas" | "colunas";

const ROTULO_VER: Record<Ver, string> = {
  tabela: "Tabela",
  linhas: "Linhas",
  colunas: "Colunas",
};

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
 * Cada visão tem um "Exportar imagem": baixa um PNG do conteúdo com uma
 * moldura de marca que só existe na captura — os elementos `data-so-exportar`
 * abaixo ficam `hidden` na tela e o `exportar.ts` os revela e restaura.
 */
export default function Explorador({
  serie,
  mesCorrente,
  verInicial,
  cabecalho,
  tabela,
}: {
  serie: LinhaMensal[];
  /** "2026-08", calculado no servidor (fuso de Brasília). */
  mesCorrente: string;
  verInicial: Ver;
  cabecalho: ReactNode;
  tabela: ReactNode;
}) {
  const [ver, setVer] = useState<Ver>(verInicial);
  const [ativas, setAtivas] = useState<ReadonlySet<UF>>(() => new Set(UFS_GRAFICO));
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const meses = useMemo(() => agruparMeses(serie, mesCorrente), [serie, mesCorrente]);

  // Ordem fixa de exibição — a cor segue o estado, não a posição na lista.
  const ufsAtivas = UFS_GRAFICO.filter((uf) => ativas.has(uf));

  // Meses em que nenhum estado selecionado tem dado saem do eixo (só com o PA
  // sozinho isso acontece: os meses que ele ainda não publicou).
  const mesesVisiveis = meses.filter((m) =>
    ufsAtivas.some((uf) => totalCelula(m.porUf[uf]) !== null),
  );

  // 4 estados × 18+ meses em barras agrupadas seria ilegível: as Colunas
  // mostram só os últimos 12 meses fechados, com nota. As Linhas seguem inteiras.
  const mesesDoGrafico = ver === "colunas" ? mesesVisiveis.slice(-12) : mesesVisiveis;
  const colunasCortadas = ver === "colunas" && mesesVisiveis.length > mesesDoGrafico.length;

  const linhasTotal = linhasDoGrafico(mesesDoGrafico, ufsAtivas, "total");
  const linhasPct = linhasDoGrafico(mesesDoGrafico, ufsAtivas, "pct");

  // As duas visões de gráfico têm a mesma casca (filtro, KPIs, títulos, notas);
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
    const no = areaRef.current;
    if (!no || exportando) return;
    setExportando(true);
    setErroExportar(null);
    try {
      // Import dinâmico no clique: nem o exportar.ts, nem o html-to-image que
      // ele importa por dentro, entram no JavaScript inicial da página.
      const { exportarPng } = await import("./exportar");
      await exportarPng(no, ver);
    } catch {
      // Recado curto; a tela nunca quebra por causa de um export.
      setErroExportar("Não deu para gerar a imagem — tente de novo.");
    } finally {
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

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">{cabecalho}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div
            role="group"
            aria-label="Modo de visualização"
            className="inline-flex overflow-hidden rounded-full border"
          >
            {(["tabela", "linhas", "colunas"] as const).map((opcao) => (
              <button
                key={opcao}
                type="button"
                aria-pressed={ver === opcao}
                onClick={() => mudarVer(opcao)}
                className={`px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ouro)] ${
                  ver === opcao
                    ? "bg-[var(--verde)] text-white"
                    : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                }`}
              >
                {ROTULO_VER[opcao]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {erroExportar && (
              <span role="alert" className="text-xs text-[#93402c]">
                {erroExportar}
              </span>
            )}
            <button
              type="button"
              onClick={exportar}
              disabled={exportando}
              className="text-xs text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ouro)] disabled:cursor-wait disabled:no-underline"
            >
              {exportando ? "gerando…" : "Exportar imagem"}
            </button>
          </div>
        </div>
      </div>

      {/* Tudo dentro deste contêiner sai no PNG — inclusive a moldura de marca,
          que na tela fica `hidden` e só é revelada durante a captura. */}
      <div ref={areaRef} className="mt-4">
        <div data-so-exportar hidden>
          <div className="mb-4 flex items-center justify-between gap-4 border-b pb-3">
            <div className="flex items-center gap-2.5">
              {/* O mostrador do ciclo, parado — o mesmo da tela de entrada. */}
              <svg aria-hidden className="h-9 w-9" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="30" stroke="var(--verde)" strokeWidth="2" />
                <circle
                  cx="32"
                  cy="32"
                  r="24"
                  stroke="var(--verde)"
                  strokeOpacity="0.45"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeDasharray="0.1 12.466"
                />
                <circle cx="32" cy="8" r="3.2" fill="var(--ouro)" />
                <circle cx="32" cy="32" r="2" fill="var(--verde)" />
              </svg>
              <div>
                <p className="text-base leading-tight font-semibold text-[var(--verde)]">
                  Peciclo
                </p>
                <p className="text-[11px] tracking-[0.18em] text-neutral-500 uppercase">
                  Abate mensal por estado
                </p>
              </div>
            </div>
            <p data-exportar-data className="text-xs text-neutral-500" />
          </div>
        </div>
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

            {mesesVisiveis.length === 0 ? (
              <p className="text-sm text-neutral-600">
                Nenhum mês fechado para os estados selecionados — nada para desenhar ainda.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                </div>

                <div>
                  <h3 className="text-sm font-medium text-neutral-800">Cabeças abatidas por mês</h3>
                  {colunasCortadas && (
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Últimos 12 meses — a visão Linhas mostra a série inteira.
                    </p>
                  )}
                  <div className="mt-2 h-[280px] w-full">
                    <CorpoGrafico ufs={ufsAtivas} linhas={linhasTotal} unidade="cabecas" />
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
                    <CorpoGrafico ufs={ufsAtivas} linhas={linhasPct} unidade="pct" />
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-neutral-500">
                  Dois recortes de honestidade: o mês corrente ({mesLongo(mesCorrente)}) fica fora
                  dos gráficos e dos indicadores — ainda está em coleta, e o parcial desenharia uma
                  queda que não existe —, e cada estado aparece até o último mês que publicou: nas
                  Linhas a série termina ali; nas Colunas, mês sem dado fica sem barra (o PA
                  costuma ficar uns dois meses atrás dos demais). Os indicadores usam o último mês
                  fechado por <strong>todos</strong> os estados selecionados, indicado nos cartões.
                  O parcial do mês corrente está na Tabela.
                </p>
              </>
            )}
          </div>
        )}

        <div data-so-exportar hidden>
          <p className="mt-4 border-t pt-2 text-center text-[11px] tracking-[0.18em] text-neutral-400">
            peciclo.com.br
          </p>
        </div>
      </div>
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
