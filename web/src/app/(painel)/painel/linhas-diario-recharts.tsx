"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { COR_UF, type UF } from "./estados";
import type { FaixaAssentando, LinhaGraficoDiario } from "./explorador-diario";

const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A visão Linhas do diário: 180 dias por estado, em DUAS camadas na mesma cor
 * — o dia cru num traço fino e apagado (strokeOpacity 0.35, sem ponto: 180
 * bolinhas seriam cascalho) e a média móvel de 7 dias na linha cheia, que é
 * onde a tendência mora. Módulo irmão dos gráficos mensais, alcançado apenas
 * pelo `dynamic(..., { ssr: false })` do explorador diário: o Recharts continua
 * fora do pacote inicial do site.
 *
 * A faixa sombreada no fim é o trecho "assentando": os últimos 7 dias, que a
 * recoleta semanal ainda reprocessa — o leitor vê que ali o dado é fresco.
 *
 * `connectNulls={false}` é a regra de honestidade de sempre: dia sem dado (ou
 * MM7 sem janela cheia) deixa buraco — ligar os pontos inventaria abate.
 */
export default function LinhasDiarioRecharts({
  ufs,
  linhas,
  unidade,
  assentando,
  animar = true,
}: {
  ufs: UF[];
  linhas: LinhaGraficoDiario[];
  unidade: "cabecas" | "pct";
  /** Rótulos do primeiro e do último dia da faixa, ou null sem dias nela. */
  assentando: FaixaAssentando | null;
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
          dataKey="dia"
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e5e5" }}
          minTickGap={24}
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
          labelFormatter={(rotulo) => `dia ${String(rotulo)}`}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
        />
        {/* A faixa vai ANTES das linhas para ficar atrás delas. */}
        {assentando && (
          <ReferenceArea
            x1={assentando.x1}
            x2={assentando.x2}
            fill="#737373"
            fillOpacity={0.07}
            label={{ value: "assentando", position: "insideTopRight", fontSize: 10, fill: "#737373" }}
          />
        )}
        {ehPct && <ReferenceLine y={50} stroke="#a3a3a3" strokeDasharray="4 4" />}
        {/* Cru fino atrás, MM7 forte na frente — a MESMA cor por estado, como
            nos chips: duas intensidades da mesma família, não duas séries. */}
        {ufs.map((uf) => (
          <Line
            key={uf}
            type="monotone"
            dataKey={uf}
            name={uf}
            stroke={COR_UF[uf]}
            strokeWidth={1}
            strokeOpacity={0.35}
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={animar}
          />
        ))}
        {ufs.map((uf) => (
          <Line
            key={`${uf}Mm7`}
            type="monotone"
            dataKey={`${uf}Mm7`}
            name={`${uf} · média 7 dias`}
            stroke={COR_UF[uf]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={animar}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
