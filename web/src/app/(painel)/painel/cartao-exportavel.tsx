"use client";

import type { ReactNode } from "react";

import { COR_UF, type UF } from "./estados";
import { dataPorExtenso } from "./exportar";

/**
 * O MIOLO do cartão de exportação — moldura de marca, título, KPIs, legenda,
 * conteúdo e rodapé — em leiaute fixo de desktop, pensado para 1080px de
 * largura. Duas cascas o usam, e as duas dão a largura:
 *
 * - `exportavel.tsx`: o export manual, que o monta FORA da tela durante o
 *   clique em "Exportar imagem" e fotografa com html-to-image;
 * - `/impressao-diario/[visao]`: a página que o robô do envio diário abre num
 *   Chromium de verdade e fotografa — o MESMO cartão, pixel por pixel.
 *
 * Tudo aqui já nasce visível e sem rolagem interna: a trava de altura da
 * tabela (`data-exportar-expandir`) é solta por CSS logo abaixo, e as classes
 * de leiaute são fixas — `grid-cols-4` SEM prefixo responsivo, porque media
 * query olha o viewport do celular e mentiria dentro do cartão de 1080px.
 */
export default function CartaoExportavel({
  titulo = "Abate mensal por estado",
  rotulo,
  ufs,
  kpis,
  dataCabecalho,
  children,
}: {
  /** Título da seção fotografada — a diária passa o dela; o padrão é o mensal. */
  titulo?: string;
  /** Rótulo da visão corrente: "Tabela", "Linhas" ou "Colunas". */
  rotulo: string;
  /** Estados da legenda — os filtrados nos gráficos, os quatro na tabela. */
  ufs: readonly UF[];
  /** Os quatro cartões de KPI, prontos — a formatação mora no explorador. */
  kpis: ReactNode;
  /**
   * Data do cabeçalho já formatada. A página de impressão a calcula no
   * SERVIDOR (fuso de Brasília) para SSR e hidratação nunca divergirem; o
   * export manual não passa nada e cai no `new Date()` do navegador — o
   * comportamento de sempre.
   */
  dataCabecalho?: string;
  /** O conteúdo da visão: tabela completa ou os dois gráficos, sem animação. */
  children: ReactNode;
}) {
  return (
    <>
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
        <p className="text-xs text-neutral-500">
          {dataCabecalho ?? dataPorExtenso(new Date())}
        </p>
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
    </>
  );
}
