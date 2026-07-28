import type { LinhaMensal } from "../dados/mensal.js";
import type { Sexo, UF } from "../tipos.js";

/** Mínimo de meses anteriores para a média ter significado. */
const HISTORICO_MINIMO = 6;
/** Fora desta faixa em relação à média, o valor vira alerta. */
const LIMITE_INFERIOR = 0.4;
const LIMITE_SUPERIOR = 2.5;

export interface Anomalia {
  uf: UF;
  ano: number;
  mes: number;
  sexo: Sexo;
  quantidade: number;
  media: number;
  mensagem: string;
}

/**
 * Compara o mês mais recente de cada série contra a média dos anteriores.
 * Alerta, nunca bloqueia: uma virada real de ciclo também produz variação
 * grande, e travar o envio por isso seria pior que avisar.
 */
export function detectarAnomalias(dados: LinhaMensal[]): Anomalia[] {
  const series = new Map<string, LinhaMensal[]>();
  for (const linha of dados) {
    const chave = `${linha.uf}|${linha.sexo}`;
    const lista = series.get(chave) ?? [];
    lista.push(linha);
    series.set(chave, lista);
  }

  const anomalias: Anomalia[] = [];

  for (const linhas of series.values()) {
    const ordenadas = [...linhas].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
    const atual = ordenadas.at(-1);
    const anteriores = ordenadas.slice(0, -1);
    if (!atual || anteriores.length < HISTORICO_MINIMO) continue;

    const media = anteriores.reduce((s, l) => s + l.quantidade, 0) / anteriores.length;
    if (media === 0) continue;

    const razao = atual.quantidade / media;
    if (razao >= LIMITE_INFERIOR && razao <= LIMITE_SUPERIOR) continue;

    const direcao = razao > LIMITE_SUPERIOR ? "acima" : "abaixo";
    anomalias.push({
      uf: atual.uf,
      ano: atual.ano,
      mes: atual.mes,
      sexo: atual.sexo,
      quantidade: atual.quantidade,
      media,
      mensagem:
        `${atual.uf} ${String(atual.mes).padStart(2, "0")}/${atual.ano} ${atual.sexo}: ` +
        `${atual.quantidade.toLocaleString("pt-BR")} está muito ${direcao} da média ` +
        `dos ${anteriores.length} meses anteriores (${Math.round(media).toLocaleString("pt-BR")}).`,
    });
  }

  return anomalias;
}
