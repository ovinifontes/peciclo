"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";

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
// quando alguém abre a visão de gráficos — nunca no pacote inicial do site.
const Grafico = dynamic(() => import("./graficos-estados-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

type Ver = "tabela" | "graficos";

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
 * A seção "Abate mensal por estado" em dois modos: a tabela de sempre
 * (server-rendered, chega pronta pela prop `tabela`) ou a visão de gráficos,
 * com filtro por estado, KPIs e duas séries por UF. O modo inicial vem de
 * `?ver=` para a visão de gráficos poder ser favoritada.
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

  const meses = useMemo(() => agruparMeses(serie, mesCorrente), [serie, mesCorrente]);

  // Ordem fixa de exibição — a cor segue o estado, não a posição na lista.
  const ufsAtivas = UFS_GRAFICO.filter((uf) => ativas.has(uf));

  // Meses em que nenhum estado selecionado tem dado saem do eixo (só com o PA
  // sozinho isso acontece: os meses que ele ainda não publicou).
  const mesesVisiveis = meses.filter((m) =>
    ufsAtivas.some((uf) => totalCelula(m.porUf[uf]) !== null),
  );

  const linhasTotal: LinhaGrafico[] = mesesVisiveis.map((m) => {
    const linha: LinhaGrafico = { competencia: m.competencia };
    for (const uf of ufsAtivas) linha[uf] = totalCelula(m.porUf[uf]);
    return linha;
  });
  const linhasPct: LinhaGrafico[] = mesesVisiveis.map((m) => {
    const linha: LinhaGrafico = { competencia: m.competencia };
    for (const uf of ufsAtivas) {
      const pct = pctCelula(m.porUf[uf]);
      linha[uf] = pct === null ? null : Number(pct.toFixed(1));
    }
    return linha;
  });

  const ind = calcularIndicadores(meses, ufsAtivas);

  function mudarVer(novo: Ver) {
    setVer(novo);
    // `?ver=graficos` sobrevive a recarga e a favorito; a URL limpa é a tabela.
    const url = new URL(window.location.href);
    if (novo === "graficos") url.searchParams.set("ver", "graficos");
    else url.searchParams.delete("ver");
    window.history.replaceState(null, "", url);
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
        <div
          role="group"
          aria-label="Modo de visualização"
          className="inline-flex shrink-0 overflow-hidden rounded-full border"
        >
          {(["tabela", "graficos"] as const).map((opcao) => (
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
              {opcao === "tabela" ? "Tabela" : "Gráficos"}
            </button>
          ))}
        </div>
      </div>

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
                  <div className="mt-2 h-[280px] w-full">
                    <Grafico ufs={ufsAtivas} linhas={linhasTotal} unidade="cabecas" />
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
                    <Grafico ufs={ufsAtivas} linhas={linhasPct} unidade="pct" />
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-neutral-500">
                  Dois recortes de honestidade: o mês corrente ({mesLongo(mesCorrente)}) fica fora
                  dos gráficos e dos indicadores — ainda está em coleta, e o parcial desenharia uma
                  queda que não existe —, e cada linha termina no último mês que o estado publicou
                  (o PA costuma ficar uns dois meses atrás dos demais). Os indicadores usam o
                  último mês fechado por <strong>todos</strong> os estados selecionados, indicado
                  nos cartões. O parcial do mês corrente está na Tabela.
                </p>
              </>
            )}
          </div>
        )}
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
