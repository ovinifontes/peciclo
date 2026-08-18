import type { AgregadoDiario, Janela, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

/**
 * Reagrega gta_registros POR DIA na janela informada (MS). Uma chamada só: a
 * função do banco recebe o intervalo inteiro, não há competência a fatiar.
 * A guarda do banco preserva dias com fonte 'gta_condensada_dia' (MT direto).
 */
export async function rollupDiario(args: {
  uf: UF;
  janela: Janela;
  coletaId: number;
}): Promise<number> {
  const { data, error } = await obterCliente().rpc("peciclo_rollup_abate_diario", {
    p_uf: args.uf,
    p_de: args.janela.inicio,
    p_ate: args.janela.fim,
    p_coleta_id: args.coletaId,
  });
  if (error) {
    throw new Error(
      `Falha no rollup diário de ${args.uf} ${args.janela.inicio}..${args.janela.fim}: ${error.message}`,
    );
  }
  return Number(data ?? 0);
}

/**
 * Grava dias que já vêm prontos da fonte: MT com 'gta_condensada_dia' (o INDEA
 * consultado com janela de 1 dia, o default) e RO com 'powerbi_diff' (o dia
 * estimado pela diferença de retratos do painel). Sobrescreve por (uf, dia,
 * finalidade, sexo) — e como o rollup diário só sobrescreve linha
 * 'gta_agregada' (dele mesmo), estas linhas ficam protegidas por construção.
 */
export async function gravarAgregadosDiarios(
  agregados: AgregadoDiario[],
  coletaId: number,
  fonte: "gta_condensada_dia" | "powerbi_diff" = "gta_condensada_dia",
): Promise<void> {
  if (agregados.length === 0) return;
  const { error } = await obterCliente()
    .from("peciclo_abate_diario")
    .upsert(
      agregados.map((a) => ({
        uf: a.uf,
        data: a.data,
        finalidade: a.finalidade,
        sexo: a.sexo,
        quantidade: a.quantidade,
        fonte,
        coleta_id: coletaId,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,data,finalidade,sexo" },
    );
  if (error) throw new Error(`Falha ao gravar agregados diários: ${error.message}`);
}
