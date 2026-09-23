export type UF = "MT" | "MS" | "RO" | "PA";

/** Todos os estados que o sistema COLETA, na ordem canônica de exibição. */
export const UFS_COLETADAS = ["MT", "MS", "RO", "PA"] as const satisfies readonly UF[];

/**
 * Estados que o sistema MOSTRA. Coleta e banco não mudam: o que sai daqui é
 * só o que aparece em planilha, gráfico, tabela e no cálculo do consolidado.
 *
 * O PA saiu em 23/09/2026. A ADEPARA parou de publicar depois de maio/2026 e
 * só deve voltar por volta de novembro; exibir uma coluna parada há meses ao
 * lado de três atualizadas engana mais do que informa, e o percentual
 * consolidado ficava puxado por um estado que não se move. O histórico
 * continua todo no banco, e o coletor continua rodando — no dia em que a
 * ADEPARA publicar, o dado já estará lá esperando.
 *
 * PARA VOLTAR: devolva "PA" a esta lista. Só isto. Colunas, cores, ordem dos
 * gráficos, o "N de N" do consolidado e os filtros de leitura saem todos
 * daqui, de propósito — para que voltar não seja uma caçada por dez arquivos.
 */
export const UFS_VISIVEIS = ["MT", "MS", "RO"] as const satisfies readonly UF[];

/** Filtro usado em toda leitura que alimenta planilha, site ou KPI. */
export function ufVisivel(uf: string): boolean {
  return (UFS_VISIVEIS as readonly string[]).includes(uf);
}
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
