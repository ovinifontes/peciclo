import type { AgregadoMensal, Janela, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

/**
 * Lista os primeiros dias de cada mês tocado pela janela.
 * Uma janela de rejanela pode cruzar a virada, e nesse caso os dois meses
 * precisam ser reagregados.
 */
export function competenciasDaJanela(janela: Janela): string[] {
  const competencias: string[] = [];
  const inicio = new Date(`${janela.inicio}T00:00:00Z`);
  const fim = new Date(`${janela.fim}T00:00:00Z`);
  const cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));

  while (cursor <= fim) {
    const ano = cursor.getUTCFullYear();
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    competencias.push(`${ano}-${mes}-01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return competencias;
}

/** Reagrega gta_registros nos meses tocados pela janela. */
export async function rollupJanela(args: {
  uf: UF;
  janela: Janela;
  coletaId: number;
}): Promise<number> {
  const cliente = obterCliente();
  let alteradas = 0;

  for (const competencia of competenciasDaJanela(args.janela)) {
    const { data, error } = await cliente.rpc("rollup_abate_mensal", {
      p_uf: args.uf,
      p_competencia: competencia,
      p_coleta_id: args.coletaId,
    });
    if (error) throw new Error(`Falha no rollup de ${args.uf} ${competencia}: ${error.message}`);
    alteradas += Number(data ?? 0);
  }
  return alteradas;
}

/**
 * Grava um agregado que já vem pronto da fonte. Sobrescreve por competência.
 * RO usa fonte "powerbi" (Power BI); MT usa "gta_condensada" (o relatório GTA
 * Condensado do INDEA já vem somado por mês, não por GTA).
 */
export async function gravarAgregados(
  agregados: AgregadoMensal[],
  coletaId: number,
  fonte: "powerbi" | "gta_condensada",
): Promise<void> {
  if (agregados.length === 0) return;
  const { error } = await obterCliente()
    .from("abate_mensal")
    .upsert(
      agregados.map((a) => ({
        uf: a.uf,
        ano: a.ano,
        mes: a.mes,
        finalidade: a.finalidade,
        sexo: a.sexo,
        quantidade: a.quantidade,
        fonte,
        coleta_id: coletaId,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,ano,mes,finalidade,sexo" },
    );
  if (error) throw new Error(`Falha ao gravar agregados: ${error.message}`);
}

export interface LinhaMensal {
  uf: UF;
  ano: number;
  mes: number;
  sexo: "MACHO" | "FEMEA";
  quantidade: number;
}

/** Lê o abate mensal que alimenta a planilha. Igualdade exata em ABATE. */
export async function lerAbateMensal(): Promise<LinhaMensal[]> {
  const { data, error } = await obterCliente()
    .from("abate_mensal")
    .select("uf, ano, mes, sexo, quantidade")
    // Igualdade exata, nunca prefixo: "ABATE SANITÁRIO" e "SACRIFÍCIO" são
    // abate por determinação sanitária, não decisão econômica do pecuarista.
    .eq("finalidade", "ABATE")
    .order("ano")
    .order("mes");

  if (error) throw new Error(`Falha ao ler abate mensal: ${error.message}`);
  return (data ?? []) as LinhaMensal[];
}
