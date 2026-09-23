"use client";

import type { ReactNode } from "react";

import { ROTULO_VER, VISOES, type Ver } from "./visoes";

/**
 * O topo dos dois cartões de exploração: título, seletor de formato e o botão
 * de exportar. Componente único de propósito — o cartão diário e o mensal
 * precisam ficar IGUAIS, e duas cópias divergem no primeiro ajuste.
 *
 * Desenho pensado para o celular, que é 90% do uso:
 *
 * - O seletor fica CENTRALIZADO logo abaixo do título, no caminho do olho, em
 *   vez de encostado num canto. Ele é a descoberta que se quer provocar: quem
 *   não sabe que dá para trocar de formato, não troca.
 * - Cada opção é uma pílula independente, e não um bloco segmentado inteiriço:
 *   em 360px as cinco não cabem numa linha, e pílulas soltas quebram em duas
 *   linhas centradas sozinhas. Um bloco segmentado, nessa largura, ou vaza ou
 *   vira rolagem escondida.
 * - Alvo de toque de 44px de altura, o mínimo confortável no dedo.
 * - O botão de exportar fica abaixo do seletor no celular e no canto superior
 *   direito a partir de `sm`, que é onde ele sempre esteve no desktop.
 */
export default function CabecalhoVisoes({
  titulo,
  ver,
  aoTrocar,
  aoExportar,
  exportando,
  erroExportar,
  descricao,
}: {
  titulo: string;
  ver: Ver;
  aoTrocar: (v: Ver) => void;
  aoExportar: () => void;
  exportando: boolean;
  erroExportar: string | null;
  descricao: ReactNode;
}) {
  return (
    <>
      <div className="relative flex flex-col items-center gap-3">
        <h2 className="text-center text-lg font-semibold tracking-tight text-neutral-900 sm:text-xl">
          {titulo}
        </h2>

        <div
          role="group"
          aria-label="Formato de visualização"
          className="flex flex-wrap justify-center gap-1.5"
        >
          {VISOES.map((opcao) => {
            const ativa = ver === opcao;
            return (
              <button
                key={opcao}
                type="button"
                aria-pressed={ativa}
                onClick={() => aoTrocar(opcao)}
                className={`min-h-11 rounded-full border px-4 text-xs font-medium uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ouro)] ${
                  ativa
                    ? "border-[var(--verde)] bg-[var(--verde)] text-white"
                    : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                }`}
              >
                {ROTULO_VER[opcao]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 sm:absolute sm:right-0 sm:top-0">
          {erroExportar && (
            <span role="alert" className="text-xs text-[#93402c]">
              {erroExportar}
            </span>
          )}
          <button
            type="button"
            onClick={aoExportar}
            disabled={exportando}
            className="min-h-9 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ouro)] disabled:cursor-wait disabled:text-neutral-400"
          >
            {exportando ? "gerando…" : "Exportar imagem"}
          </button>
        </div>
      </div>

      <div className="mt-3 text-sm leading-relaxed text-neutral-600">{descricao}</div>
    </>
  );
}
