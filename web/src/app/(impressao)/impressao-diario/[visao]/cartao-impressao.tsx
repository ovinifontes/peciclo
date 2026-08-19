"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Import DIRETO da raiz, como no explorador diário: `diario/serie.ts` é puro
// (importa apenas tipos) e este componente roda no navegador — `@/lib/dados`
// é server-only e não pode entrar aqui.
import {
  indicadoresDiarios,
  rotuloDia,
  ufsComDado,
  type PontoDiario,
} from "../../../../../../src/diario/serie";
import CartaoExportavel from "@/app/(painel)/painel/cartao-exportavel";
import {
  cartoesKpiDiario,
  linhasDoGrafico,
  ROTULO_VER,
  SecoesGraficoDiario,
  type FaixaAssentando,
} from "@/app/(painel)/painel/explorador-diario";
import type { Ver } from "@/app/(painel)/painel/explorador";

/** Os DOIS SVGs que cada visão de gráfico desenha: total e % de fêmeas. */
const SVGS_ESPERADOS = 2;

/**
 * O cartão diário VISÍVEL da página de impressão — o mesmo miolo que o export
 * manual fotografa fora da tela, aqui parado no meio da página para o robô.
 *
 * As derivações são o MESMO caminho do explorador diário no estado que o
 * export manual usa (todos os estados com dado ativos): janela da visão,
 * achatamento para o Recharts, faixa "assentando" e KPIs saem das funções
 * exportadas de lá e das puras da raiz — nenhuma cópia de lógica.
 *
 * Prontidão (`data-impressao-pronta`, que o robô espera):
 * - Tabela: server-rendered — o atributo já nasce no HTML.
 * - Gráficos: entram por `dynamic(..., { ssr: false })` e o Recharts ainda
 *   mede o contêiner de forma assíncrona antes de desenhar — o atributo só
 *   pode ser setado quando os SVGs EXISTIREM. Um polling leve (150ms) conta
 *   `svg.recharts-surface` dentro do cartão e seta o atributo ao chegar em 2.
 */
export default function CartaoImpressaoDiario({
  visao,
  pontos,
  cortes,
  dataCabecalho,
  tabela,
}: {
  visao: Ver;
  /** A série pronta (dia cru + MM7), calculada no servidor por `serie.ts`. */
  pontos: PontoDiario[];
  /** Cortes ISO calculados no servidor: 180 dias (linhas), 14 (colunas), 7 (assentando). */
  cortes: { linhas: string; colunas: string; assentando: string };
  /** Data do cabeçalho formatada no servidor (fuso de Brasília). */
  dataCabecalho: string;
  tabela: ReactNode;
}) {
  const cartaoRef = useRef<HTMLDivElement>(null);

  // Todos os estados com dado — o estado inicial dos chips do explorador, que
  // é também o que o export manual fotografa por padrão.
  const ufs = ufsComDado(pontos);
  const ind = indicadoresDiarios(pontos, ufs);

  // A janela da visão corrente: 180 dias nas Linhas, 14 nas Colunas — os
  // mesmos cortes do explorador, comparando texto ISO com texto ISO.
  const corteJanela = visao === "colunas" ? cortes.colunas : cortes.linhas;
  const pontosJanela = pontos.filter((p) => p.data >= corteJanela);
  const diasVisiveis = [...new Set(pontosJanela.map((p) => p.data))].sort();

  const linhasTotal = linhasDoGrafico(pontosJanela, ufs, "total", visao !== "colunas");
  const linhasPct = linhasDoGrafico(pontosJanela, ufs, "pct", visao !== "colunas");

  const primeiroAssentando = diasVisiveis.find((d) => d >= cortes.assentando);
  const assentando: FaixaAssentando | null = primeiroAssentando
    ? { x1: rotuloDia(primeiroAssentando), x2: rotuloDia(diasVisiveis.at(-1)!) }
    : null;

  // Sem gráfico não há o que esperar: a tabela é server-rendered, e a visão de
  // gráficos sem nenhum dia com dado mostra só o recado (nenhum SVG virá).
  const prontoNoHtml = visao === "tabela" || diasVisiveis.length === 0;

  useEffect(() => {
    if (prontoNoHtml) return;
    const cartao = cartaoRef.current;
    if (!cartao) return;
    const intervalo = setInterval(() => {
      const svgs = cartao.querySelectorAll("svg.recharts-surface").length;
      if (svgs >= SVGS_ESPERADOS) {
        cartao.setAttribute("data-impressao-pronta", "");
        clearInterval(intervalo);
      }
    }, 150);
    return () => clearInterval(intervalo);
  }, [prontoNoHtml]);

  return (
    <div
      ref={cartaoRef}
      data-cartao-impressao=""
      {...(prontoNoHtml ? { "data-impressao-pronta": "" } : {})}
      style={{ width: 1080 }}
      className="bg-white"
    >
      <CartaoExportavel
        titulo="Abate diário por estado"
        rotulo={ROTULO_VER[visao]}
        ufs={ufs}
        kpis={cartoesKpiDiario(ind, cortes.assentando)}
        dataCabecalho={dataCabecalho}
      >
        {visao === "tabela" ? (
          tabela
        ) : diasVisiveis.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nenhum dia com dado para os estados selecionados — nada para desenhar ainda.
          </p>
        ) : (
          <SecoesGraficoDiario
            ver={visao}
            ufs={ufs}
            linhasTotal={linhasTotal}
            linhasPct={linhasPct}
            assentando={assentando}
          />
        )}
      </CartaoExportavel>
    </div>
  );
}
