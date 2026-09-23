/**
 * O contrato das visões do painel — um lugar só.
 *
 * Antes dos formatos novos isto vivia em três: `ROTULO_VER` escrito igual em
 * `explorador.tsx` e `explorador-diario.tsx`, e a lista validada de novo à mão
 * em `/impressao-diario/[visao]`. Acrescentar uma visão eram três edições e uma
 * chance de esquecer — e a esquecida quebraria a imagem do WhatsApp em
 * silêncio, só na manhã seguinte.
 */

export const VISOES = ["tabela", "linhas", "colunas", "area", "cemPorCento"] as const;

export type Ver = (typeof VISOES)[number];

export const ROTULO_VER: Record<Ver, string> = {
  tabela: "Tabela",
  linhas: "Linhas",
  colunas: "Colunas",
  area: "Área",
  cemPorCento: "100%",
};

export function ehVisao(valor: string): valor is Ver {
  return (VISOES as readonly string[]).includes(valor);
}

/**
 * Visões que desenham DUAS seções (cabeças abatidas e % de fêmeas) com o mesmo
 * componente de corpo.
 *
 * Área e 100% desenham uma só: a Área já mostra volume e composição na mesma
 * figura, e a 100% mostra composição e nada mais. Repetir a seção de % embaixo
 * da 100% seria dizer duas vezes a mesma coisa, e ocupar meia tela de celular
 * para isso.
 */
const DUAS_SECOES: readonly Ver[] = ["linhas", "colunas"];

export const temDuasSecoes = (ver: Ver): boolean => DUAS_SECOES.includes(ver);

/**
 * Visões que empilham MACHO e FÊMEA somando os estados selecionados, em vez de
 * desenhar uma série por estado.
 */
const POR_SEXO: readonly Ver[] = ["area", "cemPorCento"];

export const ehPorSexo = (ver: Ver): boolean => POR_SEXO.includes(ver);
