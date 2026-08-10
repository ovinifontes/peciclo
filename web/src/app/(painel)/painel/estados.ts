import type { LinhaMensal } from "@/lib/dados";

export type UF = LinhaMensal["uf"];

/** Ordem fixa de exibição — a mesma da tabela e a mesma da atribuição de cor. */
export const UFS_GRAFICO = ["MT", "MS", "RO", "PA"] as const satisfies readonly UF[];

export const NOME_UF: Record<UF, string> = {
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  RO: "Rondônia",
  PA: "Pará",
};

/**
 * Cor fixa por estado — a mesma no chip, na linha e no tooltip, sempre. A cor
 * segue o estado, nunca a posição: filtrar um estado não repinta os outros.
 *
 * A paleta partiu do vocabulário da casa (verde, petróleo, ouro, terracota) e
 * foi ajustada pelo validador da skill dataviz até passar: o verde-garrafa e o
 * ouro puros da marca reprovam como cor de dado (escuros ou acinzentados
 * demais), então cada família foi movida para o degrau mais próximo que passa.
 * Pior par adjacente sob daltonismo: ΔE 16,5 (alvo ≥ 8); visão normal 17,2
 * (piso 15). O ouro fica a 2,65:1 do branco — abaixo de 3:1, o que é permitido
 * porque a tabela ao lado e os tooltips carregam os mesmos valores.
 */
export const COR_UF: Record<UF, string> = {
  MT: "#047857", // verde — o mesmo do gráfico de fêmeas do painel
  MS: "#0284c7", // petróleo claro
  RO: "#c8942a", // ouro
  PA: "#8c3a1e", // terracota
};

/** Uma linha de dado dos gráficos: a competência e um valor (ou nulo) por UF. */
export type LinhaGrafico = { competencia: string } & Partial<Record<UF, number | null>>;
