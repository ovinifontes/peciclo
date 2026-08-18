"use client";

import type { ReactNode, Ref } from "react";

import { COR_UF, type UF } from "./estados";
import { dataPorExtenso } from "./exportar";

/**
 * O cartão de exportação: uma cópia da visão corrente em largura fixa de
 * desktop (1080px), montada só durante o clique em "Exportar imagem" — é ELE
 * que o html-to-image fotografa, nunca o nó visível. Assim o PNG sai igual em
 * qualquer aparelho: no celular a tela é estreita, mas este cartão não.
 *
 * Fica fora da tela por POSIÇÃO (`fixed; left:-99999px`), nunca por
 * `display:none` — o ResponsiveContainer do Recharts precisa medir o
 * contêiner para desenhar o SVG, e nó sem display não tem medida. Na hora da
 * foto o `exportar.ts` traz o CLONE de volta para o quadro (`position:
 * static`); o nó real não se move.
 *
 * Tudo aqui já nasce visível e sem rolagem interna: a trava de altura da
 * tabela (`data-exportar-expandir`) é solta por CSS logo abaixo, e as classes
 * de leiaute são fixas — `grid-cols-4` SEM prefixo responsivo, porque media
 * query olha o viewport do celular e mentiria dentro do cartão de 1080px.
 */
export default function Exportavel({
  ref,
  titulo = "Abate mensal por estado",
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
      {/* Cabeçalho de marca — o mesmo mostrador parado da tela de entrada. */}
      <div className="mb-4 flex items-center justify-between gap-4 border-b pb-3">
        <div className="flex items-center gap-2.5">
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
              {titulo} · {rotulo}
            </p>
          </div>
        </div>
        <p className="text-xs text-neutral-500">{dataPorExtenso(new Date())}</p>
      </div>

      {/* O seletor arbitrário solta a rolagem interna da tabela: no cartão ela
          aparece INTEIRA, sem o corte de 26rem que a tela precisa ter. */}
      <div className="flex flex-col gap-5 [&_[data-exportar-expandir]]:max-h-none [&_[data-exportar-expandir]]:overflow-visible">
        <div className="grid grid-cols-4 gap-3">{kpis}</div>

        {/* Legenda parada no lugar dos chips interativos — botão em foto é
            promessa que a imagem não cumpre. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-neutral-500">Estados</span>
          {ufs.map((uf) => (
            <span
              key={uf}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-800"
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: COR_UF[uf] }}
              />
              {uf}
            </span>
          ))}
        </div>

        {children}
      </div>

      <p className="mt-4 border-t pt-2 text-center text-[11px] tracking-[0.18em] text-neutral-400">
        peciclo.com.br
      </p>
    </div>
  );
}
