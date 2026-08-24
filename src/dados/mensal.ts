import type { AgregadoMensal, Janela, LinhaMensal, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";
import { lerTudo } from "./paginar.js";

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
    const { data, error } = await cliente.rpc("peciclo_rollup_abate_mensal", {
      p_uf: args.uf,
      p_competencia: competencia,
      p_coleta_id: args.coletaId,
    });
    if (error) throw new Error(`Falha no rollup de ${args.uf} ${competencia}: ${error.message}`);
    alteradas += Number(data ?? 0);
  }
  return alteradas;
}

/** Universo de contagem: um mês de uma UF numa finalidade. */
const universoDe = (a: { uf: string; ano: number; mes: number; finalidade: string }) =>
  `${a.uf}|${a.ano}|${a.mes}|${a.finalidade}`;

/**
 * Grava um agregado que já vem pronto da fonte. Sobrescreve por competência.
 * RO usa fonte "powerbi" (Power BI); MT usa "gta_condensada" (o relatório GTA
 * Condensado do INDEA já vem somado por mês, não por GTA).
 *
 * REGRA DE PRECEDÊNCIA (o outro lado da que `dados/imea.ts` já aplica): entre
 * duas contagens do MESMO universo — o mesmo mês, da mesma UF, na mesma
 * finalidade — a MAIOR vence. Contagem por GTA só cresce (guia atrasada é
 * lançada, nunca desemitida), então total menor é o mesmo mês mais incompleto.
 * Aqui isso vira uma guarda ESTREITA: um lote só é recusado quando rebaixaria
 * um total já gravado com fonte 'imea'.
 *
 * Sem ela, o dia em que o INDEA consertar o export a competência de MT volta
 * com o valor parado da migração (~1/4 do mês), sobrescreve o número do IMEA e
 * a planilha do cliente REGRIDE — e o coletor IMEA regrava para cima na segunda
 * seguinte: ping-pong semanal com alerta de anomalia junto.
 *
 * Por que estreita, e não "nunca rebaixar nada": só existe linha 'imea' em
 * MT/ABATE, então (a) o RO (powerbi) nunca é bloqueado e correção legítima para
 * baixo de qualquer outra fonte passa intacta, e (b) recoleta do mesmo mês com
 * valor MAIOR continua gravando normalmente. O preço é que, se o IMEA publicar
 * um número inflado, o INDEA não o corrige sozinho — correção para baixo em
 * cima do IMEA é ato manual, deliberado, e assim deve ser.
 */
export async function gravarAgregados(
  agregados: AgregadoMensal[],
  coletaId: number,
  fonte: "powerbi" | "gta_condensada",
): Promise<void> {
  if (agregados.length === 0) return;
  const cliente = obterCliente();

  // Um filtro só, cartesiano de propósito (uf × ano × mes): traz no máximo
  // punhado de linhas 'imea' e o pareamento exato é feito aqui embaixo.
  const { data, error: erroLeitura } = await cliente
    .from("peciclo_abate_mensal")
    .select("uf, ano, mes, finalidade, quantidade")
    .eq("fonte", "imea")
    .in("uf", [...new Set(agregados.map((a) => a.uf))])
    .in("ano", [...new Set(agregados.map((a) => a.ano))])
    .in("mes", [...new Set(agregados.map((a) => a.mes))]);
  if (erroLeitura) {
    throw new Error(`Falha ao ler o mensal atual antes de gravar: ${erroLeitura.message}`);
  }

  const totalImea = new Map<string, number>();
  for (const l of (data ?? []) as AgregadoMensal[]) {
    totalImea.set(universoDe(l), (totalImea.get(universoDe(l)) ?? 0) + l.quantidade);
  }
  const totalNovo = new Map<string, number>();
  for (const a of agregados) {
    totalNovo.set(universoDe(a), (totalNovo.get(universoDe(a)) ?? 0) + a.quantidade);
  }

  const aGravar = agregados.filter((a) => {
    const imea = totalImea.get(universoDe(a));
    return imea === undefined || totalNovo.get(universoDe(a))! > imea;
  });

  for (const [universo, total] of totalImea) {
    if (totalNovo.has(universo) && totalNovo.get(universo)! <= total) {
      // Nunca em silêncio: recusa de gravação aparece no log da run.
      console.warn(
        `Mantido o número do IMEA em ${universo}: ${total} (fonte ${fonte} trouxe ${totalNovo.get(universo)}).`,
      );
    }
  }
  if (aGravar.length === 0) return;

  const { error } = await cliente
    .from("peciclo_abate_mensal")
    .upsert(
      aGravar.map((a) => ({
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

// Declarado em `tipos.ts` (que não importa nada) para o site poder usá-lo sem
// arrastar o cliente do Supabase junto. Reexportado aqui para não quebrar quem
// já importava daqui.
export type { LinhaMensal } from "../tipos.js";

/** Lê o abate mensal que alimenta a planilha. Igualdade exata em ABATE. */
export async function lerAbateMensal(): Promise<LinhaMensal[]> {
  // Paginado: sem isto o Supabase devolve no máximo 1000 linhas sem erro, e
  // como a ordem é crescente, seriam os meses RECENTES a sumir da planilha.
  return lerTudo<LinhaMensal>(
    (de, ate) =>
      obterCliente()
        .from("peciclo_abate_mensal")
        .select("uf, ano, mes, sexo, quantidade")
        // Igualdade exata, nunca prefixo: "ABATE SANITÁRIO" e "SACRIFÍCIO" são
        // abate por determinação sanitária, não decisão econômica do pecuarista.
        .eq("finalidade", "ABATE")
        .order("ano")
        .order("mes")
        .range(de, ate) as never,
    "abate mensal",
  );
}
