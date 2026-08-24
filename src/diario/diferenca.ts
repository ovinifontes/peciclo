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
//
// A armadilha que este módulo existe para evitar (vista em 22-24/08/2026): a
// IDARON NÃO publica no fim de semana. O acumulado congela de sábado a
// segunda e volta a andar na terça. Ler isso ingenuamente produz DOIS erros
// opostos — zeros falsos no fim de semana ("RO não abateu") e, na terça, três
// dias de abate empilhados num dia só. Nenhum dos dois é mercado: é o
// calendário de publicação do órgão. Quando não dá para saber de que dia é o
// número, o certo é não ter ponto.

/** O total acumulado do mês num retrato, por sexo. */
export interface RetratoPorSexo {
  FEMEA: number;
  MACHO: number;
}

/** Um retrato do cofre: o acumulado do mês visto numa manhã. */
export interface Retrato {
  capturadoEm: string;
  porSexo: RetratoPorSexo;
}

/** Mesma ordem em que o coletor do RO emite os agregados. */
const SEXOS: readonly Sexo[] = ["FEMEA", "MACHO"];

const total = (r: RetratoPorSexo) => r.FEMEA + r.MACHO;

/** Dias corridos de `deIso` até `ateIso`, por aritmética UTC (sem fuso). */
function diasEntre(deIso: string, ateIso: string): number {
  const de = new Date(`${deIso}T00:00:00Z`).getTime();
  const ate = new Date(`${ateIso}T00:00:00Z`).getTime();
  return Math.round((ate - de) / 86_400_000);
}

/**
 * Converte o histórico de retratos do acumulado mensal do RO no agregado de UM
 * dia — ou em nada, quando o dia não é atribuível.
 *
 * Regras, todas com o mesmo princípio (número sem dia certo não vira ponto):
 *
 * - Sem histórico, o retrato de hoje só ancora: nada a gravar, nada anômalo.
 * - Acumulado parado: o órgão não publicou. NÃO grava zero — zero seria a
 *   afirmação "não abateram", e RO abate ~8 mil cabeças/dia. Anomalia informa.
 * - Acumulado andou: o ganho cobre o período desde a ÚLTIMA publicação, não
 *   desde ontem. Só vira ponto se esse período for de exatamente 1 dia; se o
 *   painel ficou k dias parado, o ganho cobre k dias e não há como reparti-lo
 *   sem inventar — nada gravado, anomalia registra o total que ficou de fora.
 * - Acumulado caiu (painel corrigiu para baixo): nada gravado, anomalia.
 */
export function calcularDiferencaDiaria(entrada: {
  snapshotHoje: RetratoPorSexo;
  /** Retratos anteriores a hoje, em ordem crescente de data. */
  historico: Retrato[];
  /** Dia (ISO) do retrato de hoje. */
  capturadoEm: string;
}): { agregados: AgregadoDiario[]; anomalias: string[] } {
  const { snapshotHoje, historico, capturadoEm } = entrada;
  const anteriores = historico.filter((r) => diasEntre(r.capturadoEm, capturadoEm) > 0);
  if (anteriores.length === 0) return { agregados: [], anomalias: [] };

  const ultimo = anteriores[anteriores.length - 1]!;
  const totalHoje = total(snapshotHoje);
  const totalUltimo = total(ultimo.porSexo);

  if (totalHoje === totalUltimo) {
    return {
      agregados: [],
      anomalias: [
        `acumulado do RO parado em ${totalHoje} desde ${ultimo.capturadoEm}: ` +
          "o painel não publicou — sem ponto para este dia (zero seria mentira)",
      ],
    };
  }

  if (totalHoje < totalUltimo) {
    return {
      agregados: [],
      anomalias: [
        `painel do RO corrigiu o acumulado para baixo (${totalUltimo} → ${totalHoje}): nada gravado`,
      ],
    };
  }

  // Desde quando o acumulado está no valor de `ultimo`? Esse é o dia da última
  // publicação — e o ganho de hoje cobre o período de lá até aqui.
  let desde = ultimo.capturadoEm;
  for (let i = anteriores.length - 2; i >= 0; i--) {
    if (total(anteriores[i]!.porSexo) !== totalUltimo) break;
    desde = anteriores[i]!.capturadoEm;
  }

  const diasCobertos = diasEntre(desde, capturadoEm);
  if (diasCobertos > 1) {
    return {
      agregados: [],
      anomalias: [
        `o ganho de ${totalHoje - totalUltimo} cabeças cobre ${diasCobertos} dias ` +
          `(${desde} → ${capturadoEm}) e não pode ser repartido entre eles — nada gravado`,
      ],
    };
  }

  const agregados: AgregadoDiario[] = SEXOS.map((sexo) => ({
    uf: "RO" as const,
    data: desde,
    finalidade: "ABATE",
    sexo,
    // Um sexo isolado pode cair enquanto o total sobe (correção pontual do
    // painel); aí só aquele sexo vira 0 — o dia continua atribuível.
    quantidade: Math.max(0, snapshotHoje[sexo] - ultimo.porSexo[sexo]),
  }));

  return { agregados, anomalias: [] };
}
