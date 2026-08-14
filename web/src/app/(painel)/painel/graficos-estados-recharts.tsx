"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { COR_UF, type LinhaGrafico, type UF } from "./estados";

const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Segundo (e último) módulo do site que importa o Recharts, alcançado apenas
 * pelo `dynamic(..., { ssr: false })` do explorador — a mesma fronteira do
 * `grafico-femeas-recharts.tsx`, pelo mesmo motivo: manter os ~112 KB gzip da
 * biblioteca fora do pacote inicial que a página de login baixa.
 *
 * Um componente, dois usos: `unidade="cabecas"` desenha o total mensal (eixo
 * compacto, base zero — a distância entre MT e os outros é informação) e
 * `unidade="pct"` desenha a participação de fêmeas, com a referência tracejada
 * em 50% sempre visível no domínio.
 *
 * `connectNulls={false}` é regra de honestidade: quando um estado ainda não
 * publicou um mês, a linha dele termina ali — ligar os pontos inventaria dado.
 */
export default function GraficoEstadosRecharts({
  ufs,
  linhas,
  unidade,
  animar = true,
}: {
  ufs: UF[];
  linhas: LinhaGrafico[];
  unidade: "cabecas" | "pct";
  /** `false` no cartão de exportação — a foto pegaria o traço no meio. */
  animar?: boolean;
}) {
  const ehPct = unidade === "pct";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={linhas}
        margin={{ top: 12, right: 12, bottom: 0, left: -4 }}
        accessibilityLayer
      >
        <CartesianGrid stroke="#ececec" vertical={false} />
        <XAxis
          dataKey="competencia"
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e5e5" }}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={false}
          width={ehPct ? 44 : 52}
          domain={
            ehPct
              ? [
                  (min: number) => Math.floor(Math.min(min - 2, 47)),
                  (max: number) => Math.ceil(Math.max(max + 2, 53)),
                ]
              : [0, "auto"]
          }
          tickFormatter={(v: number) => (ehPct ? `${inteiro.format(v)}%` : compacto.format(v))}
        />
        <Tooltip
          formatter={(v, nome) => [
            ehPct ? `${umaCasa.format(Number(v))}%` : inteiro.format(Number(v)),
            String(nome),
          ]}
          labelFormatter={(rotulo) => `competência ${String(rotulo)}`}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
        />
        {/* Sem rótulo no próprio traço: as linhas cruzam os 50% o tempo todo e
            o texto colidiria com elas — o subtítulo do gráfico já explica a
            referência, e o eixo diz a altura. */}
        {ehPct && <ReferenceLine y={50} stroke="#a3a3a3" strokeDasharray="4 4" />}
        {ufs.map((uf) => (
          <Line
            key={uf}
            type="monotone"
            dataKey={uf}
            name={uf}
            stroke={COR_UF[uf]}
            strokeWidth={2}
            dot={{ r: 2, fill: COR_UF[uf], strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={animar}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
