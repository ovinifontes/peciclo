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

import type { PontoGrafico } from "./grafico-femeas";

const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Único módulo do site que importa o Recharts. Ele só é alcançado pelo
 * `dynamic(..., { ssr: false })` do invólucro — nada mais deve importá-lo
 * diretamente, ou a biblioteca volta para o pacote inicial.
 */
export default function GraficoFemeasRecharts({
  serie,
  media,
}: {
  serie: PontoGrafico[];
  media: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={serie} margin={{ top: 12, right: 12, bottom: 0, left: -8 }} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
        <XAxis
          dataKey="competencia"
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e5e5" }}
          minTickGap={16}
        />
        <YAxis
          unit="%"
          domain={["dataMin - 2", "dataMax + 2"]}
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => umaCasa.format(v)}
        />
        <Tooltip
          formatter={(v) => [`${umaCasa.format(Number(v))}%`, "fêmeas"]}
          labelFormatter={(rotulo) => `competência ${String(rotulo)}`}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
        />
        {/* A média do próprio período plotado: dá a régua para dizer se o mês
            atual está alto ou baixo sem o leitor ter de estimar no olho. */}
        <ReferenceLine
          y={media}
          stroke="#a3a3a3"
          strokeDasharray="4 4"
          label={{
            value: `média ${umaCasa.format(media)}%`,
            position: "insideTopRight",
            fontSize: 11,
            fill: "#737373",
          }}
        />
        <Line
          type="monotone"
          dataKey="pct"
          name="fêmeas"
          stroke="#047857"
          strokeWidth={2}
          dot={{ r: 2, fill: "#047857", strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
