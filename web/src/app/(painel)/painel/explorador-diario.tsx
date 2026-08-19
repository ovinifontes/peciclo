"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";

// Import DIRETO da raiz, não via `@/lib/dados`: aquele módulo é server-only e
// este componente roda no navegador. `diario/serie.ts` é puro (importa apenas
// tipos), então nada do robô entra no bundle — o mesmo contrato que permite ao
// `dados.ts` importá-lo no servidor. A matemática (MM7, dia de referência,
// comparação com D-7) mora SÓ lá, testada pela suíte da raiz.
import {
  diaSemana,
  indicadoresDiarios,
  rotuloDia,
  ufsComDado,
  type IndicadoresDiarios,
  type PontoDiario,
} from "../../../../../src/diario/serie";
import { COR_UF, NOME_UF, type UF } from "./estados";
import type { Ver } from "./explorador";
import Exportavel from "./exportavel";

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

// A mesma fronteira do explorador mensal: o Recharts só é baixado quando
// alguém abre uma visão de gráficos, nunca no pacote inicial do site.
const GraficoLinhas = dynamic(() => import("./linhas-diario-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});
const GraficoColunas = dynamic(() => import("./colunas-diario-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

// Exportado para a página de impressão (`/impressao-diario/[visao]`), que
// monta o MESMO cartão do export manual com os MESMOS rótulos.
export const ROTULO_VER: Record<Ver, string> = {
  tabela: "Tabela",
  linhas: "Linhas",
  colunas: "Colunas",
};

/** Chave de série do gráfico diário: o dia cru ("MS") ou a MM7 dele ("MSMm7"). */
type ChaveSerie = UF | `${UF}Mm7`;

/** Uma linha dos gráficos diários: o rótulo do dia e um valor (ou nulo) por série. */
export type LinhaGraficoDiario = { dia: string } & Partial<Record<ChaveSerie, number | null>>;

/** Primeiro e último rótulo da faixa "assentando" — o x1/x2 da ReferenceArea. */
export interface FaixaAssentando {
  x1: string;
  x2: string;
}

/**
 * Achata a série diária no formato do Recharts — uma linha por dia, uma coluna
 * por UF (dado cru) e, quando a visão pede, mais uma por MM7. Dias em que
 * nenhuma UF selecionada tem dado saem do eixo. Exportada para a página de
 * impressão, que refaz o mesmo achatamento com todos os estados ativos.
 */
export function linhasDoGrafico(
  pontos: PontoDiario[],
  ufs: UF[],
  metrica: "total" | "pct",
  comMm7: boolean,
): LinhaGraficoDiario[] {
  const porDia = new Map<string, LinhaGraficoDiario>();
  for (const p of pontos) {
    if (!ufs.includes(p.uf)) continue;
    let linha = porDia.get(p.data);
    if (!linha) {
      linha = { dia: rotuloDia(p.data) };
      porDia.set(p.data, linha);
    }
    if (metrica === "total") {
      linha[p.uf] = p.total;
      if (comMm7) linha[`${p.uf}Mm7`] = p.mm7Total;
    } else {
      linha[p.uf] = p.pctFemeas === null ? null : Number(p.pctFemeas.toFixed(1));
      if (comMm7)
        linha[`${p.uf}Mm7`] =
          p.mm7PctFemeas === null ? null : Number(p.mm7PctFemeas.toFixed(1));
    }
  }
  // O Map preserva a ordem de inserção e `pontos` já vem ordenado por data —
  // mas ordenar de novo custa nada e blinda contra prop desordenada.
  return [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, l]) => l);
}

/**
 * A seção "Abate diário por estado" — irmã do explorador mensal DE PROPÓSITO:
 * parametrizar o mensal, que o dono considera pronto, seria trocar risco de
 * regressão por meia dúzia de linhas. A anatomia é a mesma (Tabela · Linhas ·
 * Colunas, chips, 4 KPIs, Exportar imagem); o que muda é o grão e a honestidade
 * que ele exige: dado por dia é serrote, então as Linhas carregam a média
 * móvel de 7 dias, os KPIs comparam com o MESMO dia da semana anterior e os
 * últimos 7 dias ficam marcados "assentando" (a rejanela ainda os reprocessa).
 *
 * Tudo chega pré-computado do servidor (`pontos` com MM7, cortes de janela no
 * fuso de Brasília): aqui não entra `new Date()` nem recálculo de média — só
 * filtro por UF/janela e os KPIs da função pura.
 */
export default function ExploradorDiario({
  pontos,
  cortes,
  verInicial,
  cabecalho,
  tabela,
}: {
  /** A série pronta (dia cru + MM7), calculada no servidor por `serie.ts`. */
  pontos: PontoDiario[];
  /** Cortes ISO calculados no servidor: 180 dias (linhas), 14 (colunas), 7 (assentando). */
  cortes: { linhas: string; colunas: string; assentando: string };
  verInicial: Ver;
  cabecalho: ReactNode;
  tabela: ReactNode;
}) {
  const [ver, setVer] = useState<Ver>(verInicial);
  // Chips só de quem TEM dado: MS hoje; o MT aparece sozinho quando o INDEA
  // voltar a publicar — nenhum chip promete estado que não entrega.
  const ufsDado = useMemo(() => ufsComDado(pontos), [pontos]);
  const [ativas, setAtivas] = useState<ReadonlySet<UF>>(() => new Set(ufsComDado(pontos)));
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const exportavelRef = useRef<HTMLDivElement>(null);

  // Ordem fixa de exibição — a cor segue o estado, não a posição na lista.
  const ufsAtivas = ufsDado.filter((uf) => ativas.has(uf));

  // A janela da visão corrente: 180 dias nas Linhas (tendência), 14 nas
  // Colunas (o serrote de perto). O corte vem do servidor; aqui só se compara
  // texto ISO com texto ISO.
  const corteJanela = ver === "colunas" ? cortes.colunas : cortes.linhas;
  const pontosJanela = useMemo(
    () => pontos.filter((p) => p.data >= corteJanela),
    [pontos, corteJanela],
  );

  // Dias visíveis (algum estado selecionado tem dado), em ordem — dão o eixo e
  // as bordas da faixa "assentando".
  const diasVisiveis = useMemo(() => {
    const datas = new Set<string>();
    for (const p of pontosJanela) if (ativas.has(p.uf)) datas.add(p.data);
    return [...datas].sort();
  }, [pontosJanela, ativas]);

  const linhasTotal = linhasDoGrafico(pontosJanela, ufsAtivas, "total", ver !== "colunas");
  const linhasPct = linhasDoGrafico(pontosJanela, ufsAtivas, "pct", ver !== "colunas");

  // A faixa "assentando": do primeiro dia visível dentro dos últimos 7 até o
  // fim da série — é o trecho que a rejanela semanal ainda reprocessa.
  const primeiroAssentando = diasVisiveis.find((d) => d >= cortes.assentando);
  const assentando: FaixaAssentando | null = primeiroAssentando
    ? { x1: rotuloDia(primeiroAssentando), x2: rotuloDia(diasVisiveis.at(-1)!) }
    : null;

  // KPIs sobre a série INTEIRA, não a janela: o dia de referência é o último
  // dia completo de todos os estados selecionados, esteja a visão em 14 ou 180
  // dias. A matemática é a função pura da raiz.
  const ind = indicadoresDiarios(pontos, ufsAtivas);

  function mudarVer(novo: Ver) {
    setVer(novo);
    // `?verDiario=` é independente do `?ver=` mensal: cada seção guarda a sua
    // visão na URL sem pisar na da outra. A URL limpa é a tabela.
    const url = new URL(window.location.href);
    if (novo === "tabela") url.searchParams.delete("verDiario");
    else url.searchParams.set("verDiario", novo);
    window.history.replaceState(null, "", url);
  }

  async function exportar() {
    if (exportando) return;
    // `exportando` faz duas coisas: vira o botão para "gerando…" e monta o
    // cartão do `exportavel.tsx` fora da tela (o `{cartao && ...}` lá embaixo).
    setExportando(true);
    setErroExportar(null);
    try {
      // Import dinâmico no clique: o html-to-image nunca entra no JavaScript
      // inicial da página — a mesma fronteira do explorador mensal.
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
      // `diario-` no nome para o arquivo nunca se confundir com o do mensal:
      // `peciclo-diario-linhas-2026-08-18.png`.
      await exportarPng(no, `diario-${ver}`);
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
  // filtrados; na tabela — que mostra todos os que têm dado —, todos eles.
  const cartao = exportando
    ? ver === "tabela"
      ? { ufs: ufsDado, ind: indicadoresDiarios(pontos, ufsDado) }
      : { ufs: ufsAtivas, ind }
    : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">{cabecalho}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div
            role="group"
            aria-label="Modo de visualização do diário"
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

      <div className="mt-4">
        {ver === "tabela" ? (
          tabela
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-500">Estados</span>
              {ufsDado.map((uf) => {
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

            {diasVisiveis.length === 0 ? (
              <p className="text-sm text-neutral-600">
                Nenhum dia com dado para os estados selecionados — nada para desenhar ainda.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {cartoesKpiDiario(ind, cortes.assentando)}
                </div>
                <SecoesGraficoDiario
                  ver={ver}
                  ufs={ufsAtivas}
                  linhasTotal={linhasTotal}
                  linhasPct={linhasPct}
                  assentando={assentando}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* O cartão de exportação: só existe durante o clique em Exportar, fora
          da tela, com a MESMA visão e os MESMOS dados — é ele que vira PNG. */}
      {cartao && (
        <Exportavel
          ref={exportavelRef}
          titulo="Abate diário por estado"
          rotulo={ROTULO_VER[ver]}
          ufs={cartao.ufs}
          kpis={cartoesKpiDiario(cartao.ind, cortes.assentando)}
        >
          {ver === "tabela" ? (
            tabela
          ) : diasVisiveis.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Nenhum dia com dado para os estados selecionados — nada para desenhar ainda.
            </p>
          ) : (
            <SecoesGraficoDiario
              ver={ver}
              ufs={ufsAtivas}
              linhasTotal={linhasTotal}
              linhasPct={linhasPct}
              assentando={assentando}
            />
          )}
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
 * Os quatro cartões de KPI do diário. Manchete = dia de referência (o último
 * dia COMPLETO de todos os estados selecionados — dia pela metade não vira
 * número grande); comparação = o MESMO dia da semana anterior, porque terça
 * contra domingo mediria o calendário, não o mercado. Enquanto o dia de
 * referência estiver na janela que a rejanela reprocessa, a nota avisa que ele
 * ainda assenta. Exportada para a página de impressão — os KPIs do cartão do
 * robô saem DESTA função, nunca de uma cópia.
 */
export function cartoesKpiDiario(ind: IndicadoresDiarios, corteAssentando: string): ReactNode {
  const notaDia = ind.diaReferencia
    ? `${diaSemana(ind.diaReferencia)}, ${rotuloDia(ind.diaReferencia)}${
        ind.diaReferencia >= corteAssentando ? " · dia ainda assenta" : ""
      }`
    : "sem dia completo por todos";
  const notaVs =
    ind.diaComparacao && ind.totalD7 !== null
      ? `vs ${diaSemana(ind.diaComparacao)}, ${rotuloDia(ind.diaComparacao)}`
      : "sem o mesmo dia da semana anterior";
  return (
    <>
      <Kpi
        rotulo="Cabeças abatidas"
        valor={ind.totalDia !== null ? inteiro.format(ind.totalDia) : "—"}
        nota={notaDia}
      />
      <Kpi
        rotulo="Fêmeas no abate"
        valor={ind.pctFemeasDia !== null ? `${umaCasa.format(ind.pctFemeasDia)}%` : "—"}
        nota={notaDia}
      />
      <Kpi
        rotulo="Total vs semana anterior"
        valor={ind.variacaoTotalPct !== null ? `${comSinal.format(ind.variacaoTotalPct)}%` : "—"}
        nota={notaVs}
      />
      <Kpi
        rotulo="Fêmeas vs semana anterior"
        valor={ind.variacaoFemeasPct !== null ? `${comSinal.format(ind.variacaoFemeasPct)}%` : "—"}
        nota={notaVs}
      />
    </>
  );
}

/**
 * Os dois gráficos da visão corrente (total e participação de fêmeas) com a
 * nota de método — o MESMO markup na tela e no cartão de exportação. As Linhas
 * mostram 180 dias com o cru fino atrás e a MM7 forte na frente; as Colunas
 * mostram 14 dias de dado cru, sem média. `animar={false}` nos dois lugares,
 * como no mensal — no cartão é obrigatório (a foto pegaria o traço no meio).
 * Exportada para a página de impressão: o robô fotografa ESTES gráficos.
 */
export function SecoesGraficoDiario({
  ver,
  ufs,
  linhasTotal,
  linhasPct,
  assentando,
}: {
  ver: Ver;
  ufs: UF[];
  linhasTotal: LinhaGraficoDiario[];
  linhasPct: LinhaGraficoDiario[];
  assentando: FaixaAssentando | null;
}) {
  const colunas = ver === "colunas";
  return (
    <>
      <div>
        <h3 className="text-sm font-medium text-neutral-800">Cabeças abatidas por dia</h3>
        {colunas ? (
          <p className="mt-0.5 text-xs text-neutral-500">
            Últimos 14 dias, dado cru — a visão Linhas mostra 180 dias com a média móvel.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-neutral-500">
            Traço fino: o dia cru. Linha cheia: média móvel de 7 dias — a tendência mora nela.
          </p>
        )}
        <div className="mt-2 h-[280px] w-full">
          {colunas ? (
            <GraficoColunas ufs={ufs} linhas={linhasTotal} unidade="cabecas" animar={false} />
          ) : (
            <GraficoLinhas
              ufs={ufs}
              linhas={linhasTotal}
              unidade="cabecas"
              assentando={assentando}
              animar={false}
            />
          )}
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
          {colunas ? (
            <GraficoColunas ufs={ufs} linhas={linhasPct} unidade="pct" animar={false} />
          ) : (
            <GraficoLinhas
              ufs={ufs}
              linhas={linhasPct}
              unidade="pct"
              assentando={assentando}
              animar={false}
            />
          )}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-neutral-500">
        Dado por dia é serrote — fim de semana quase não abate e o % de fêmeas balança
        muito — e ainda assenta: o dia de HOJE fica fora (está em coleta) e os últimos 7
        dias{colunas ? "" : ", na faixa sombreada,"} ainda são reprocessados pela recoleta
        semanal, então mexem um pouco antes de firmar. Dia sem dado fica sem ponto — ligar
        a linha por cima inventaria abate.{" "}
        {!colunas &&
          "O traço fino é o dia cru; a linha cheia é a média móvel de 7 dias, com o % de fêmeas ponderado pelo volume de cada dia. "}
        Os indicadores usam o último dia completo de <strong>todos</strong> os estados
        selecionados e comparam com o mesmo dia da semana anterior.
      </p>
    </>
  );
}
