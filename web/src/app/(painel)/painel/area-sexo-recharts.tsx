"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { COR_SEXO, ROTULO_SEXO } from "./estados";
import type { PontoSexo } from "./serie-sexo";

const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });

/**
 * A visão Área: volume e composição na MESMA figura.
 *
 * As faixas empilhadas somam o total de cabeças — a altura da pilha é o volume
 * abatido, e a espessura de cada faixa é quanto daquilo foi fêmea. É a única
 * visão do painel que responde "subiu o abate ou mudou a composição?" sem
 * trocar de gráfico.
 *
 * Empilha SEXO, não estado: com três estados a pilha teria seis faixas e
 * viraria borrão em 360px. Os chips de estado continuam valendo — eles
 * escolhem o que entra na soma.
 *
 * Fêmeas embaixo, de propósito: é a série que o pecuarista acompanha, e a
 * faixa colada na linha de base é a única cuja altura se lê direto, sem
 * descontar a de baixo.
 *
 * Especificação (skill dataviz): 2px de respiro entre as faixas empilhadas,
 * grade horizontal de fio de cabelo, legenda sempre presente — com duas séries
 * a identidade nunca pode depender só da cor.
 */
export default function AreaSexoRecharts({
  pontos,
  animar = true,
}: {
  pontos: PontoSexo[];
  /** `false` no cartão de exportação — a foto pegaria a animação no meio. */
  animar?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={pontos} margin={{ top: 12, right: 12, bottom: 0, left: -4 }} accessibilityLayer>
        <CartesianGrid stroke="#ececec" vertical={false} />
        <XAxis
          dataKey="rotulo"
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e5e5" }}
          // 24px no celular deixa o Recharts rarear as marcas sozinho, em vez
          // de girar rótulo — rótulo rotacionado em 360px vira borrão.
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => compacto.format(v)}
        />
        <Tooltip
          formatter={(v, nome) => [inteiro.format(Number(v)), String(nome)]}
          labelFormatter={(rotulo) => String(rotulo)}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: "#525252" }}
        />
        <Area
          type="monotone"
          dataKey="femeas"
          name={ROTULO_SEXO.FEMEA}
          stackId="sexo"
          stroke={COR_SEXO.FEMEA}
          strokeWidth={2}
          fill={COR_SEXO.FEMEA}
          fillOpacity={0.85}
          isAnimationActive={animar}
        />
        <Area
          type="monotone"
          dataKey="machos"
          name={ROTULO_SEXO.MACHO}
          stackId="sexo"
          stroke={COR_SEXO.MACHO}
          strokeWidth={2}
          fill={COR_SEXO.MACHO}
          fillOpacity={0.85}
          isAnimationActive={animar}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
