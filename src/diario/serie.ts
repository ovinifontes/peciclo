import type { LinhaDiaria, UF } from "../tipos.js";

// Lógica pura da série diária. Importa APENAS ../tipos.js: o site importa este
// módulo direto (mesmo precedente do ciclo/leitura.ts), então qualquer outra
// dependência da raiz quebraria o build da Vercel, onde só `web/` instala.

/**
 * Quantos dos 7 dias corridos da janela precisam existir para a MM7 valer.
 * 7 = regra estrita (qualquer lacuna anula); a consulta de lacunas no banco
 * pode mandar relaxar para 5 — por isso as funções aceitam o mínimo como
 * argumento e os testes cobrem os dois modos.
 */
export const MINIMO_DIAS_MM7 = 7;

/** A janela da média móvel é sempre de 7 dias CORRIDOS (calendário, não pontos). */
const JANELA_MM7 = 7;

/** Ordem canônica das UFs no projeto (a mesma do web/estados.ts). */
const ORDEM_UF: readonly UF[] = ["MT", "MS", "RO", "PA"];

/** Um dia de uma UF já agrupado: soma por sexo e derivados. */
export interface DiaUf {
  uf: UF;
  /** ISO YYYY-MM-DD. */
  data: string;
  femeas: number;
  machos: number;
  total: number;
  /** 0–100; null quando o total é zero. */
  pctFemeas: number | null;
  /** true quando o banco tinha linha dos DOIS sexos — dia contável para KPI. */
  ambosSexos: boolean;
}

/** Um ponto da série pronta para o gráfico: o dia cru mais as duas MM7. */
export interface PontoDiario extends DiaUf {
  mm7Total: number | null;
  /** 0–100, ponderada por volume (Σfêmeas/Σtotal da janela); null sem janela. */
  mm7PctFemeas: number | null;
}

export interface IndicadoresDiarios {
  /** Último dia com ambos os sexos de TODAS as UFs pedidas; null sem dia completo. */
  diaReferencia: string | null;
  /** D-7 exato do dia de referência (mesmo dia da semana anterior). */
  diaComparacao: string | null;
  totalDia: number | null;
  femeasDia: number | null;
  /** 0–100. */
  pctFemeasDia: number | null;
  /** Nulos quando o D-7 não existe ou está incompleto para alguma UF pedida. */
  totalD7: number | null;
  femeasD7: number | null;
  variacaoTotalPct: number | null;
  variacaoFemeasPct: number | null;
}

/** Soma `dias` dias corridos a um ISO, por aritmética UTC (imune a DST). */
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa as linhas do banco por (uf, dia), somando por sexo. Saída ordenada
 * por data crescente e, no mesmo dia, na ordem canônica das UFs.
 */
export function agruparDias(linhas: LinhaDiaria[]): DiaUf[] {
  const porChave = new Map<string, { femeas: number; machos: number; sexos: Set<string> }>();

  for (const linha of linhas) {
    const chave = `${linha.uf}|${linha.data}`;
    const grupo = porChave.get(chave) ?? { femeas: 0, machos: 0, sexos: new Set<string>() };
    if (linha.sexo === "FEMEA") grupo.femeas += linha.quantidade;
    else grupo.machos += linha.quantidade;
    grupo.sexos.add(linha.sexo);
    porChave.set(chave, grupo);
  }

  const dias: DiaUf[] = [...porChave].map(([chave, g]) => {
    const [uf, data] = chave.split("|") as [UF, string];
    const total = g.femeas + g.machos;
    return {
      uf,
      data,
      femeas: g.femeas,
      machos: g.machos,
      total,
      pctFemeas: total > 0 ? (g.femeas / total) * 100 : null,
      ambosSexos: g.sexos.has("FEMEA") && g.sexos.has("MACHO"),
    };
  });

  return dias.sort(
    (a, b) =>
      a.data.localeCompare(b.data) || ORDEM_UF.indexOf(a.uf) - ORDEM_UF.indexOf(b.uf),
  );
}

/**
 * Anexa a cada dia as médias móveis da janela de 7 dias CORRIDOS que termina
 * nele, calculadas por UF. A MM7 do total é a média dos dias presentes; a do
 * % de fêmeas é ponderada por volume (Σfêmeas/Σtotal) — a média simples dos
 * percentuais daria a um domingo de 3% do volume o mesmo peso de uma terça.
 * Janela com menos de `minimoDias` presentes anula as duas.
 */
export function serieComMm7(dias: DiaUf[], minimoDias: number = MINIMO_DIAS_MM7): PontoDiario[] {
  const porUf = new Map<UF, Map<string, DiaUf>>();
  for (const dia of dias) {
    const mapa = porUf.get(dia.uf) ?? new Map<string, DiaUf>();
    mapa.set(dia.data, dia);
    porUf.set(dia.uf, mapa);
  }

  const pontos = dias.map((dia): PontoDiario => {
    const mapa = porUf.get(dia.uf)!;
    const presentes: DiaUf[] = [];
    for (let atras = 0; atras < JANELA_MM7; atras++) {
      const d = mapa.get(somarDias(dia.data, -atras));
      if (d) presentes.push(d);
    }
    if (presentes.length < minimoDias) return { ...dia, mm7Total: null, mm7PctFemeas: null };

    const somaTotal = presentes.reduce((s, d) => s + d.total, 0);
    const somaFemeas = presentes.reduce((s, d) => s + d.femeas, 0);
    return {
      ...dia,
      mm7Total: somaTotal / presentes.length,
      mm7PctFemeas: somaTotal > 0 ? (somaFemeas / somaTotal) * 100 : null,
    };
  });

  return pontos.sort(
    (a, b) =>
      a.data.localeCompare(b.data) || ORDEM_UF.indexOf(a.uf) - ORDEM_UF.indexOf(b.uf),
  );
}

/**
 * KPIs do dia de referência: o último dia em que TODAS as UFs pedidas têm os
 * dois sexos (dia parcial não vira manchete). A comparação é com o D-7 exato —
 * mesmo dia da semana anterior; comparar serrote com o dia anterior é ruído —
 * e só vale se o D-7 também estiver completo para as mesmas UFs.
 */
export function indicadoresDiarios(dias: DiaUf[], ufs: UF[]): IndicadoresDiarios {
  const nulo: IndicadoresDiarios = {
    diaReferencia: null,
    diaComparacao: null,
    totalDia: null,
    femeasDia: null,
    pctFemeasDia: null,
    totalD7: null,
    femeasD7: null,
    variacaoTotalPct: null,
    variacaoFemeasPct: null,
  };
  if (ufs.length === 0) return nulo;

  const completosPorDia = new Map<string, Map<UF, DiaUf>>();
  for (const dia of dias) {
    if (!dia.ambosSexos || !ufs.includes(dia.uf)) continue;
    const mapa = completosPorDia.get(dia.data) ?? new Map<UF, DiaUf>();
    mapa.set(dia.uf, dia);
    completosPorDia.set(dia.data, mapa);
  }

  const diasCompletos = [...completosPorDia.entries()]
    .filter(([, porUf]) => ufs.every((uf) => porUf.has(uf)))
    .map(([data]) => data)
    .sort();
  const diaReferencia = diasCompletos.at(-1);
  if (!diaReferencia) return nulo;

  const somar = (data: string) => {
    const porUf = completosPorDia.get(data);
    if (!porUf || !ufs.every((uf) => porUf.has(uf))) return null;
    let total = 0;
    let femeas = 0;
    for (const uf of ufs) {
      total += porUf.get(uf)!.total;
      femeas += porUf.get(uf)!.femeas;
    }
    return { total, femeas };
  };

  const atual = somar(diaReferencia)!;
  const diaComparacao = somarDias(diaReferencia, -7);
  const anterior = somar(diaComparacao);

  return {
    diaReferencia,
    diaComparacao,
    totalDia: atual.total,
    femeasDia: atual.femeas,
    pctFemeasDia: atual.total > 0 ? (atual.femeas / atual.total) * 100 : null,
    totalD7: anterior ? anterior.total : null,
    femeasD7: anterior ? anterior.femeas : null,
    variacaoTotalPct:
      anterior && anterior.total > 0
        ? ((atual.total - anterior.total) / anterior.total) * 100
        : null,
    variacaoFemeasPct:
      anterior && anterior.femeas > 0
        ? ((atual.femeas - anterior.femeas) / anterior.femeas) * 100
        : null,
  };
}

/** UFs presentes na série, na ordem canônica — a lista de chips do painel. */
export function ufsComDado(dias: Array<{ uf: UF }>): UF[] {
  const presentes = new Set(dias.map((d) => d.uf));
  return ORDEM_UF.filter((uf) => presentes.has(uf));
}

/** "2026-08-15" → "15/08", por fatiamento: nada de `new Date` no render. */
export function rotuloDia(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Nome do dia da semana do ISO, determinístico em qualquer fuso: ancora no
 * MEIO-DIA UTC, onde nenhum offset do planeta muda a data.
 */
export function diaSemana(iso: string): string {
  return DIAS_SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;
}
