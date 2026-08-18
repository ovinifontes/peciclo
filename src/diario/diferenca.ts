import type { AgregadoDiario, Sexo } from "../tipos.js";

// Lógica pura da diferença de retratos do RO. Importa APENAS ../tipos.js —
// mesma fronteira do serie.ts: nada daqui pode arrastar dependência da raiz.
//
// A ideia (do sócio): o painel da IDARON só publica o acumulado do mês, mas o
// acumulado cresce dia a dia. Guardando o total de cada manhã, a variação entre
// duas manhãs consecutivas ≈ o abate do dia entre elas. É ESTIMATIVA por fluxo
// de publicação — guia registrada com atraso cai no dia em que apareceu no
// painel, não no dia do abate — por isso a fonte 'powerbi_diff' e o rótulo de
// estimado na tela. O mensal segue canônico.

/** O total acumulado do mês num retrato, por sexo. */
export interface RetratoPorSexo {
  FEMEA: number;
  MACHO: number;
}

/** Mesma ordem em que o coletor do RO emite os agregados. */
const SEXOS: readonly Sexo[] = ["FEMEA", "MACHO"];

/** Dias corridos de `deIso` até `ateIso`, por aritmética UTC (sem fuso). */
function diasEntre(deIso: string, ateIso: string): number {
  const de = new Date(`${deIso}T00:00:00Z`).getTime();
  const ate = new Date(`${ateIso}T00:00:00Z`).getTime();
  return Math.round((ate - de) / 86_400_000);
}

/**
 * Converte dois retratos do acumulado mensal do RO no agregado de UM dia.
 *
 * - Sem retrato anterior, o de hoje só ancora: nada a gravar, nada anômalo.
 * - Retratos de dias consecutivos: a diferença vira o dia do retrato ANTERIOR
 *   (a coleta roda de manhã; a variação entre duas manhãs cobre ~aquele dia).
 * - Gap maior que 1 dia: não dá para repartir a diferença entre os dias sem
 *   inventar — nada gravado, anomalia explica, os dias ficam sem ponto (o
 *   gráfico já trata buraco com honestidade).
 * - Painel corrigido para baixo num sexo: aquele sexo vai como 0 + anomalia;
 *   o outro segue normal.
 * - Diferença zero é dado (feriado existe), não ausência: grava 0 mesmo.
 */
export function calcularDiferencaDiaria(entrada: {
  snapshotHoje: RetratoPorSexo;
  anterior: { capturadoEm: string; porSexo: RetratoPorSexo } | null;
  /** Dia (ISO) do retrato de hoje. */
  capturadoEm: string;
}): { agregados: AgregadoDiario[]; anomalias: string[] } {
  const { snapshotHoje, anterior, capturadoEm } = entrada;
  if (anterior === null) return { agregados: [], anomalias: [] };

  const gap = diasEntre(anterior.capturadoEm, capturadoEm);
  if (gap <= 0) {
    // Não deveria acontecer (a leitura filtra capturado_em < hoje), mas se os
    // retratos vierem fora de ordem a diferença não significa nada.
    return {
      agregados: [],
      anomalias: [
        `retrato "anterior" de ${anterior.capturadoEm} não vem antes de ${capturadoEm} — nada gravado`,
      ],
    };
  }
  if (gap > 1) {
    return {
      agregados: [],
      anomalias: [
        `${gap} dias entre os retratos (${anterior.capturadoEm} → ${capturadoEm}): ` +
          "a diferença acumulada não pode ser repartida entre os dias — nada gravado, os dias ficam sem ponto",
      ],
    };
  }

  const anomalias: string[] = [];
  const agregados: AgregadoDiario[] = SEXOS.map((sexo) => {
    const diferenca = snapshotHoje[sexo] - anterior.porSexo[sexo];
    if (diferenca < 0) {
      anomalias.push(
        `painel corrigiu ${sexo} para baixo (${anterior.porSexo[sexo]} → ${snapshotHoje[sexo]}): ` +
          `o dia ${anterior.capturadoEm} vai como 0 nesse sexo`,
      );
    }
    return {
      uf: "RO" as const,
      data: anterior.capturadoEm,
      finalidade: "ABATE",
      sexo,
      quantidade: Math.max(0, diferenca),
    };
  });

  return { agregados, anomalias };
}
