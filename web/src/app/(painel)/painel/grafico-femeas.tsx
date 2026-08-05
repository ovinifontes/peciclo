"use client";

import dynamic from "next/dynamic";

export interface PontoGrafico {
  /** Rótulo do eixo X, já formatado: "06/26". */
  competencia: string;
  /** Participação de fêmeas em porcentagem (54.31), não em fração. */
  pct: number;
}

/**
 * Recharts pesa ~112 KB gzip — mais do que o resto do site inteiro. Este
 * arquivo existe só para mantê-lo FORA do pacote inicial: ele é a fronteira
 * entre a página e o módulo que realmente importa a biblioteca.
 *
 * Sem essa fronteira, o Recharts entraria no chunk compartilhado dos
 * componentes de cliente e seria baixado por quem só abriu `/login` — alguém
 * que ainda não viu gráfico nenhum e pode nem ter conta.
 *
 * `ssr: false` não é preferência: `ResponsiveContainer` descobre a largura
 * medindo o elemento pai, e no servidor não há elemento para medir. Renderizado
 * no servidor, o gráfico sai com largura zero e some.
 */
const Grafico = dynamic(() => import("./grafico-femeas-recharts"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-neutral-100" />,
});

export default function GraficoFemeas({ serie, media }: { serie: PontoGrafico[]; media: number }) {
  // A altura mora aqui, no invólucro renderizado no servidor: o espaço do
  // gráfico já está reservado antes de o Recharts chegar, então a página não
  // pula quando ele carrega.
  return (
    <div data-grafico="femeas" className="h-[320px] w-full">
      <Grafico serie={serie} media={media} />
    </div>
  );
}
