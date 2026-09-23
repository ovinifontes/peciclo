"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { COR_SEXO, ROTULO_SEXO } from "./estados";
import type { PontoSexo } from "./serie-sexo";

const inteiro = new Intl.NumberFormat("pt-BR");
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A visão 100%: composição e nada mais.
 *
 * Toda barra tem a mesma altura, então o volume some e sobra a proporção —
 * é a visão que compara a composição de um mês fraco com a de um mês forte
 * sem o volume atrapalhar a leitura. Quem quiser volume usa a Área.
 *
 * A linha de 50% fica sempre visível: é a referência que separa "abateu mais
 * fêmea que macho" de "menos", e ela é o assunto do produto inteiro.
 *
 * Os valores vão para o tooltip em CABEÇAS e em porcentagem. Só a porcentagem
 * seria uma meia-verdade: 60% de um mês de 300 mil e de um de 600 mil não
 * significam a mesma coisa para quem decide.
 */
export default function CemPorCentoRecharts({
  pontos,
  animar = true,
}: {
  pontos: PontoSexo[];
  /** `false` no cartão de exportação. */
  animar?: boolean;
}) {
  // A proporção é calculada aqui, não no Recharts: `stackOffset="expand"`
  // normalizaria o desenho mas entregaria 0–1 ao tooltip, e o usuário leria
  // "0,4" onde devia ler "40%".
  const dados = pontos.map((p) => {
    const total = p.femeas + p.machos;
    return {
      rotulo: p.rotulo,
      pctFemeas: Number(((p.femeas / total) * 100).toFixed(1)),
      pctMachos: Number(((p.machos / total) * 100).toFixed(1)),
      femeas: p.femeas,
      machos: p.machos,
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={dados}
        margin={{ top: 12, right: 12, bottom: 0, left: -4 }}
        barCategoryGap="18%"
        accessibilityLayer
      >
        <CartesianGrid stroke="#ececec" vertical={false} />
        <XAxis
          dataKey="rotulo"
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={{ stroke: "#e5e5e5" }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#737373" }}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${inteiro.format(v)}%`}
        />
        <Tooltip
          formatter={(v, nome, item) => {
            const d = item?.payload as (typeof dados)[number] | undefined;
            const cabecas = nome === ROTULO_SEXO.FEMEA ? d?.femeas : d?.machos;
            return [
              `${umaCasa.format(Number(v))}%${cabecas === undefined ? "" : ` · ${inteiro.format(cabecas)} cab.`}`,
              String(nome),
            ];
          }}
          labelFormatter={(rotulo) => String(rotulo)}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e5e5" }}
          cursor={{ fill: "rgba(22, 33, 27, 0.05)" }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: "#525252" }}
        />
        <ReferenceLine y={50} stroke="#a3a3a3" strokeDasharray="4 4" />
        {/* Fêmeas na base: a faixa colada na linha de zero é a única que se lê
            sem descontar a de baixo, e é a que o pecuarista acompanha. */}
        <Bar
          dataKey="pctFemeas"
          name={ROTULO_SEXO.FEMEA}
          stackId="sexo"
          fill={COR_SEXO.FEMEA}
          maxBarSize={28}
          isAnimationActive={animar}
        />
        <Bar
          dataKey="pctMachos"
          name={ROTULO_SEXO.MACHO}
          stackId="sexo"
          fill={COR_SEXO.MACHO}
          maxBarSize={28}
          radius={[4, 4, 0, 0]}
          isAnimationActive={animar}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
