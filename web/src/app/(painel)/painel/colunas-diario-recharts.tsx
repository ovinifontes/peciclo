"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { COR_UF, type UF } from "./estados";
import type { LinhaGraficoDiario } from "./explorador-diario";

const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A visão Colunas do diário: os últimos 14 dias, DADO CRU, em barras agrupadas
 * por estado — é a visão de perto do serrote (fim de semana em quase zero,
 * dias úteis cheios), sem média móvel de propósito: alisar 14 dias esconderia
 * exatamente o que esta visão existe para mostrar. A especificação das barras
 * é a mesma das Colunas mensais (skill dataviz): 24px no máximo, topo
 * arredondado, base reta, eixo do percentual começando no zero — barra
 * codifica comprimento, cortar a base mentiria a proporção.
 *
 * Módulo alcançado apenas pelo `dynamic(..., { ssr: false })` do explorador
 * diário, como todos os que importam o Recharts: nada disto entra no pacote
 * inicial do login. Dia sem dado de um estado fica sem a barra dele.
 */
export default function ColunasDiarioRecharts({
  ufs,
  linhas,
  unidade,
  animar = true,
}: {
  ufs: UF[];
  linhas: LinhaGraficoDiario[];
  unidade: "cabecas" | "pct";
  /** `false` no cartão de exportação — a foto pegaria a barra no meio. */
  animar?: boolean;
}) {
  const ehPct = unidade === "pct";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={linhas}
        margin={{ top: 12, right: 12, bottom: 0, left: -4 }}
        barGap={2}
        barCategoryGap="20%"
        accessibilityLayer
      >
        <CartesianGrid stroke="#ececec" vertical={false} />
        <XAxis
          dataKey="dia"
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
          domain={[0, ehPct ? (max: number) => Math.ceil(Math.max(max + 2, 53)) : "auto"]}
          tickFormatter={(v: number) => (ehPct ? `${inteiro.format(v)}%` : compacto.format(v))}
        />
        <Tooltip
          formatter={(v, nome) => [
            ehPct ? `${umaCasa.format(Number(v))}%` : inteiro.format(Number(v)),
            String(nome),
          ]}
          labelFormatter={(rotulo) => `dia ${String(rotulo)}`}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
          cursor={{ fill: "rgba(22, 33, 27, 0.05)" }}
        />
        {ehPct && <ReferenceLine y={50} stroke="#a3a3a3" strokeDasharray="4 4" />}
        {ufs.map((uf) => (
          <Bar
            key={uf}
            dataKey={uf}
            name={uf}
            fill={COR_UF[uf]}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animar}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
