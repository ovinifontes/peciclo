"use client";

import type { ReactNode, Ref } from "react";

import CartaoExportavel from "./cartao-exportavel";
import type { UF } from "./estados";

/**
 * A casca OFFSCREEN do cartão de exportação: uma cópia da visão corrente em
 * largura fixa de desktop (1080px), montada só durante o clique em "Exportar
 * imagem" — é ELA que o html-to-image fotografa, nunca o nó visível. Assim o
 * PNG sai igual em qualquer aparelho: no celular a tela é estreita, mas este
 * cartão não. O visual em si mora no `cartao-exportavel.tsx`, compartilhado
 * com a página de impressão que o robô fotografa.
 *
 * Fica fora da tela por POSIÇÃO (`fixed; left:-99999px`), nunca por
 * `display:none` — o ResponsiveContainer do Recharts precisa medir o
 * contêiner para desenhar o SVG, e nó sem display não tem medida. Na hora da
 * foto o `exportar.ts` traz o CLONE de volta para o quadro (`position:
 * static`); o nó real não se move.
 */
export default function Exportavel({
  ref,
  titulo,
  rotulo,
  ufs,
  kpis,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  /** Título da seção fotografada — a diária passa o dela; o padrão é o mensal. */
  titulo?: string;
  /** Rótulo da visão corrente: "Tabela", "Linhas" ou "Colunas". */
  rotulo: string;
  /** Estados da legenda — os filtrados nos gráficos, os quatro na tabela. */
  ufs: readonly UF[];
  /** Os quatro cartões de KPI, prontos — a formatação mora no explorador. */
  kpis: ReactNode;
  /** O conteúdo da visão: tabela completa ou os dois gráficos, sem animação. */
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ position: "fixed", left: -99999, top: 0, width: 1080 }}
      className="bg-white"
    >
      <CartaoExportavel titulo={titulo} rotulo={rotulo} ufs={ufs} kpis={kpis}>
        {children}
      </CartaoExportavel>
    </div>
  );
}
