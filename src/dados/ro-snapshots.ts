import { obterCliente } from "./cliente.js";
import type { RetratoPorSexo } from "../diario/diferenca.js";

// O cofre dos retratos do RO: o total ACUMULADO do mês que o painel da IDARON
// mostrava em cada manhã. Interno ao robô (a tabela nem tem grant para
// authenticated); o site só vê o resultado, já em peciclo_abate_diario.

/** Um retrato remontado: o dia da captura e o acumulado por sexo. */
export interface SnapshotRo {
  /** ISO YYYY-MM-DD do dia (America/Sao_Paulo) em que o painel foi lido. */
  capturadoEm: string;
  porSexo: RetratoPorSexo;
}

/**
 * Grava o retrato de um dia (uma linha por sexo). Upsert pela PK
 * (competencia, sexo, capturado_em): rodar duas vezes no mesmo dia sobrescreve
 * o retrato — fica valendo a leitura mais recente.
 */
export async function gravarSnapshot(args: {
  /** Primeiro dia do mês retratado (ISO). */
  competencia: string;
  capturadoEm: string;
  porSexo: RetratoPorSexo;
}): Promise<void> {
  const linhas = (["FEMEA", "MACHO"] as const).map((sexo) => ({
    competencia: args.competencia,
    sexo,
    capturado_em: args.capturadoEm,
    quantidade: args.porSexo[sexo],
  }));
  const { error } = await obterCliente()
    .from("peciclo_ro_snapshots")
    .upsert(linhas, { onConflict: "competencia,sexo,capturado_em" });
  if (error) throw new Error(`Falha ao gravar snapshot do RO: ${error.message}`);
}

/**
 * O retrato mais recente da competência com `capturado_em < antesDe`, ou null
 * quando ainda não há retrato anterior (primeiro dia de coleta do mês).
 */
export async function lerSnapshotAnterior(args: {
  competencia: string;
  antesDe: string;
}): Promise<SnapshotRo | null> {
  // 2 linhas bastam: gravarSnapshot sempre escreve os dois sexos do dia numa
  // chamada só, então o retrato mais recente ocupa exatamente as duas primeiras
  // posições da ordem decrescente.
  const { data, error } = await obterCliente()
    .from("peciclo_ro_snapshots")
    .select("sexo, capturado_em, quantidade")
    .eq("competencia", args.competencia)
    .lt("capturado_em", args.antesDe)
    .order("capturado_em", { ascending: false })
    .limit(2);
  if (error) throw new Error(`Falha ao ler snapshot anterior do RO: ${error.message}`);
  if (!data || data.length === 0) return null;

  const capturadoEm = String(data[0]!.capturado_em);
  const porSexo: RetratoPorSexo = { FEMEA: 0, MACHO: 0 };
  for (const linha of data) {
    // Defesa contra linha órfã de outro dia: só o dia mais recente conta.
    if (linha.capturado_em !== capturadoEm) continue;
    const sexo = String(linha.sexo);
    if (sexo === "FEMEA" || sexo === "MACHO") porSexo[sexo] = Number(linha.quantidade);
  }
  return { capturadoEm, porSexo };
}
