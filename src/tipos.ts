export type UF = "MT" | "MS" | "RO" | "PA";
export type Sexo = "MACHO" | "FEMEA";
export type FonteDado = "gta_agregada" | "powerbi" | "manual";
export type TipoColeta = "diaria" | "rejanela" | "mensal";
export type StatusColeta = "ok" | "falha" | "sem_dados";

/** Janela de datas em ISO (YYYY-MM-DD), inclusiva nas duas pontas. */
export interface Janela {
  inicio: string;
  fim: string;
}

/** Uma linha de GTA desnormalizada por sexo e faixa etária. */
export interface RegistroGta {
  uf: UF;
  documentoTipo: string;
  documentoNumero: string;
  /** String vazia quando a fonte não traz série. Faz parte da chave natural. */
  documentoSerie: string;
  /** ISO YYYY-MM-DD. */
  dataEmissao: string;
  finalidade: string;
  sexo: Sexo;
  /** null quando a fonte não informa faixa. */
  faixaEtaria: string | null;
  quantidade: number;
  municipioOrigem: string | null;
  municipioDestino: string | null;
  ufDestino: string | null;
}

/** Total já agregado — usado por fontes que só entregam o mês fechado (RO). */
export interface AgregadoMensal {
  uf: UF;
  ano: number;
  mes: number;
  finalidade: string;
  sexo: Sexo;
  quantidade: number;
}

/** Total de UM DIA já agregado — o que o coletor grava em peciclo_abate_diario. */
export interface AgregadoDiario {
  uf: UF;
  /** ISO YYYY-MM-DD. */
  data: string;
  finalidade: string;
  sexo: Sexo;
  quantidade: number;
}

/**
 * Uma linha do abate mensal já consolidado, do jeito que sai do banco.
 *
 * Mora aqui, e não em `dados/mensal.ts`, porque o site importa este tipo: se
 * ele viesse de lá, a checagem de tipos do site puxaria `dados/cliente.ts` e
 * exigiria o `@supabase/supabase-js` da RAIZ — que não existe no build da
 * Vercel, onde só a pasta `web/` instala dependências. `tipos.ts` não importa
 * nada, então é fronteira segura para compartilhar.
 */
export interface LinhaMensal {
  uf: UF;
  ano: number;
  mes: number;
  sexo: "MACHO" | "FEMEA";
  quantidade: number;
}

/**
 * Uma linha do abate diário consolidado, do jeito que sai do banco.
 * Mora aqui pelo mesmo motivo da LinhaMensal: o site importa este tipo e
 * `tipos.ts` é a única fronteira que não arrasta dependência da raiz.
 */
export interface LinhaDiaria {
  uf: UF;
  /** ISO YYYY-MM-DD. */
  data: string;
  sexo: "MACHO" | "FEMEA";
  quantidade: number;
}
