import { obterCliente } from "./cliente.js";
import type { Retrato, RetratoPorSexo } from "../diario/diferenca.js";

// O cofre dos retratos do RO: o total ACUMULADO do mês que o painel da IDARON
// mostrava em cada manhã. Interno ao robô (a tabela nem tem grant para
// authenticated); o site só vê o resultado, já em peciclo_abate_diario.

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
 * Os retratos da competência com `capturado_em < antesDe`, em ordem CRESCENTE
 * de data e limitados aos últimos `dias` (padrão 12).
 *
 * A diferença diária precisa de mais que o retrato de ontem: quando o painel
 * fica parado, ela anda para trás no histórico até achar a última publicação
 * de verdade. 12 dias cobrem qualquer feriadão realista e ainda cabem numa
 * página (2 linhas por dia); mês novo devolve [] e o retrato de hoje só ancora.
 */
export async function lerHistoricoSnapshots(args: {
  competencia: string;
  antesDe: string;
  dias?: number;
}): Promise<Retrato[]> {
  const dias = args.dias ?? 12;
  const desde = new Date(new Date(`${args.antesDe}T00:00:00Z`).getTime() - dias * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await obterCliente()
    .from("peciclo_ro_snapshots")
    .select("sexo, capturado_em, quantidade")
    .eq("competencia", args.competencia)
    .gte("capturado_em", desde)
    .lt("capturado_em", args.antesDe)
    .order("capturado_em", { ascending: true });
  if (error) throw new Error(`Falha ao ler histórico de snapshots do RO: ${error.message}`);

  // Remonta por dia. Sexo ausente na linha (retrato meio gravado) fica 0 — o
  // total sai menor, o que no máximo encurta o standstill; nunca inventa dia.
  const porDia = new Map<string, RetratoPorSexo>();
  for (const linha of data ?? []) {
    const dia = String(linha.capturado_em);
    const porSexo = porDia.get(dia) ?? { FEMEA: 0, MACHO: 0 };
    const sexo = String(linha.sexo);
    if (sexo === "FEMEA" || sexo === "MACHO") porSexo[sexo] = Number(linha.quantidade);
    porDia.set(dia, porSexo);
  }
  return [...porDia].map(([capturadoEm, porSexo]) => ({ capturadoEm, porSexo }));
}
