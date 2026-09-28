import { ufVisivel, type AgregadoDiario, type Janela, type LinhaDiaria, type UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";
import { lerTudo } from "./paginar.js";

/**
 * A série diária INTEIRA, até ontem, dos estados visíveis — o que a planilha
 * do diário leva. Sem corte de janela de propósito: a tela mostra 60 dias
 * porque quem abre quer ver ontem, mas quem recebe uma planilha quer a série
 * para abrir no Excel e fazer a própria conta.
 *
 * O dia de HOJE fica de fora: ainda está em coleta e sairia menor do que foi.
 * `hoje` vem de quem chama, no fuso de Brasília — aqui não entra `new Date()`,
 * que na Vercel e no Trigger.dev (UTC) viraria o dia três horas antes.
 */
export async function lerAbateDiarioTudo(hoje: string): Promise<LinhaDiaria[]> {
  const linhas = await lerTudo<LinhaDiaria>(
    (de, ate) =>
      obterCliente()
        .from("peciclo_abate_diario")
        .select("uf, data, sexo, quantidade")
        // Igualdade exata, nunca prefixo — a mesma regra do mensal: "ABATE
        // SANITÁRIO" e "SACRIFÍCIO" não são decisão do pecuarista.
        .eq("finalidade", "ABATE")
        .lt("data", hoje)
        // Ordem total (data, uf, sexo): páginas do lerTudo nunca se sobrepõem.
        .order("data")
        .order("uf")
        .order("sexo")
        .range(de, ate) as never,
    "abate diário",
  );
  return linhas.filter((l) => ufVisivel(l.uf));
}

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
 * velho consultado com janela de 1 dia, o default), MT com 'sindesa2_gta' (o
 * portal novo, somando a Estratificação GTA a GTA — a única saída depois que o
 * velho parou em 07/08/2026) e RO com 'powerbi_diff' (o dia estimado pela
 * diferença de retratos do painel) e RO com 'sigsif_dia' (a consulta pública
 * do MAPA, que mede só inspeção federal — fonte separada de propósito, ver
 * `coletores/sigsif-diario.ts`). Sobrescreve por (uf, dia, finalidade,
 * sexo) — e como o rollup diário só sobrescreve linha 'gta_agregada' (dele
 * mesmo), estas linhas ficam protegidas por construção.
 */
export async function gravarAgregadosDiarios(
  agregados: AgregadoDiario[],
  coletaId: number,
  fonte: "gta_condensada_dia" | "powerbi_diff" | "sindesa2_gta" | "sigsif_dia" = "gta_condensada_dia",
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
