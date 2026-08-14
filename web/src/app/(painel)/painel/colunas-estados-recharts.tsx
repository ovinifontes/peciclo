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

import { COR_UF, type LinhaGrafico, type UF } from "./estados";

const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A visão Colunas: as MESMAS duas métricas das Linhas, em barras agrupadas por
 * estado. Módulo irmão de `graficos-estados-recharts.tsx` de propósito — cada
 * visão baixa só o gráfico que usa, e o miolo do Recharts que os dois
 * compartilham sai num chunk assíncrono comum. Alcançado apenas pelo
 * `dynamic(..., { ssr: false })` do explorador, como os outros dois módulos
 * que importam a biblioteca: nada disto entra no pacote inicial do login.
 *
 * Especificação das barras (skill dataviz): no máximo 24px de espessura, topo
 * arredondado em 4px e base reta (a barra nasce da linha de base), 2px de
 * respiro entre barras vizinhas do mesmo grupo, grade horizontal sólida de
 * fio de cabelo — a mesma dos gráficos de linha. A cor segue o estado
 * (`COR_UF`), nunca a posição: filtrar um estado não repinta os outros.
 *
 * Diferente das linhas, aqui o eixo do percentual COMEÇA NO ZERO: barra
 * codifica comprimento, e cortar a base mentiria a proporção. A referência de
 * 50% continua tracejada e sempre visível no domínio.
 *
 * Mês sem dado de um estado simplesmente não tem a barra dele — a lacuna do
 * PA fica visível, que é a regra de honestidade da casa.
 */
export default function ColunasEstadosRecharts({
  ufs,
  linhas,
  unidade,
  animar = true,
}: {
  ufs: UF[];
  linhas: LinhaGrafico[];
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
          domain={[0, ehPct ? (max: number) => Math.ceil(Math.max(max + 2, 53)) : "auto"]}
          tickFormatter={(v: number) => (ehPct ? `${inteiro.format(v)}%` : compacto.format(v))}
        />
        <Tooltip
          formatter={(v, nome) => [
            ehPct ? `${umaCasa.format(Number(v))}%` : inteiro.format(Number(v)),
            String(nome),
          ]}
          labelFormatter={(rotulo) => `competência ${String(rotulo)}`}
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
