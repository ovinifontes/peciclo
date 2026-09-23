import { UFS_VISIVEIS } from "@/lib/ufs";
import type { LinhaMensal } from "@/lib/dados";

export type UF = LinhaMensal["uf"];

/**
 * Ordem fixa de exibição — a mesma da tabela e a mesma da atribuição de cor.
 * Sai de `UFS_VISIVEIS` (src/tipos.ts): esconder um estado é editar aquela
 * lista, e ele some de chip, linha, coluna e tabela de uma vez.
 */
export const UFS_GRAFICO: readonly UF[] = UFS_VISIVEIS;

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

/**
 * Cores das visões Área e 100%, que empilham SEXO em vez de estado.
 *
 * Par próprio, não reaproveitado de `COR_UF`: nessas visões a cor deixa de
 * significar estado e passa a significar sexo, e repetir o verde do MT ao lado
 * do ouro do RO ensinaria a leitura errada.
 *
 * Aprovado pelo validador da skill dataviz contra a superfície clara do site:
 * ΔE 20,1 sob protanopia, 30,8 sob tritanopia, 29,2 na visão normal (piso 15),
 * e os dois acima de 3:1 de contraste. Empilhados numa barra, fêmea e macho
 * são o par mais crítico do painel — se não separarem, o gráfico mente.
 */
export const COR_SEXO = {
  FEMEA: "#c2410c", // terracota
  MACHO: "#0369a1", // petróleo
} as const;

export const ROTULO_SEXO = { FEMEA: "Fêmeas", MACHO: "Machos" } as const;
