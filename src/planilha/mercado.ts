import type { LinhaPreco } from "../dados/experimental.js";
import type { Futuro } from "../coletores/precos.js";

/**
 * Indicadores que ligam o ciclo (fundamento) ao preço (o que o mercado já
 * precificou). É nessa diferença que mora a decisão de quem opera futuro.
 */

export interface RelacaoTroca {
  data: string;
  boiGordo: number; // R$/@
  bezerro: number; // R$/cabeça
  /** Quantas arrobas de boi gordo compram um bezerro. Sobe = reposição cara. */
  arrobasPorBezerro: number;
}

/**
 * Relação de troca: quantas arrobas de boi gordo são necessárias para comprar
 * um bezerro. É o termômetro de rentabilidade da recria/engorda — quando fica
 * cara, o recriador aperta; quando fica barata, ele compra e o ciclo gira.
 *
 * Cruza as duas séries pela data; só usa dias em que ambas existem.
 */
export function calcularRelacaoTroca(precos: LinhaPreco[]): RelacaoTroca[] {
  const boi = new Map(precos.filter((p) => p.serie === "boi_gordo").map((p) => [p.data, p.valor]));
  const bezerro = new Map(precos.filter((p) => p.serie === "bezerro_ms").map((p) => [p.data, p.valor]));

  const saida: RelacaoTroca[] = [];
  for (const [data, valorBoi] of boi) {
    const valorBezerro = bezerro.get(data);
    if (!valorBezerro || valorBoi <= 0) continue;
    saida.push({
      data,
      boiGordo: valorBoi,
      bezerro: valorBezerro,
      arrobasPorBezerro: Number((valorBezerro / valorBoi).toFixed(2)),
    });
  }
  return saida.sort((a, b) => b.data.localeCompare(a.data));
}

export interface PremioFuturo {
  contrato: string;
  fechamento: number;
  /** Diferença percentual contra o preço à vista. */
  premioPct: number | null;
}

/**
 * Prêmio dos futuros sobre o à vista. Diz o que o mercado já espera: curva
 * subindo = alta precificada; curva plana ou caindo com o ciclo apontando
 * retenção = fundamento ainda não refletido no preço.
 */
export function calcularPremioFuturos(futuros: Futuro[], aVista: number | null): PremioFuturo[] {
  return futuros.map((f) => ({
    contrato: f.contrato,
    fechamento: f.fechamento,
    premioPct: aVista && aVista > 0 ? Number((((f.fechamento - aVista) / aVista) * 100).toFixed(2)) : null,
  }));
}

/** Último valor de uma série de preço. */
export function ultimoPreco(precos: LinhaPreco[], serie: string): LinhaPreco | null {
  return precos.filter((p) => p.serie === serie).sort((a, b) => b.data.localeCompare(a.data))[0] ?? null;
}
