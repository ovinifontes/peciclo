import type { LinhaMensal } from "../dados/mensal.js";
import type { UF } from "../tipos.js";

/**
 * Estados que compõem o consolidado do ciclo. O Pará fica FORA de propósito:
 * a ADEPARA publica com ~2 meses de atraso, e incluí-lo faria a leitura
 * inteira esperar por ele — três meses de defasagem em vez de um.
 * O PA continua aparecendo na tabela e no gráfico por estado.
 */
export const PAINEL_CICLO: UF[] = ["MT", "MS", "RO"];

/** Fora desta faixa (em pontos percentuais no ano), o movimento é direcional. */
const LIMITE_DIRECIONAL_PP = 1;
/** Volume mínimo em relação ao mesmo mês do ano anterior para o mês valer. */
const COMPLETUDE_MINIMA = 0.9;

export interface PontoCiclo {
  ano: number;
  mes: number;
  femeas: number;
  machos: number;
  total: number;
  pctFemeas: number;
}

/**
 * Série de composição fixa: um mês só entra se TODOS os estados do painel
 * tiverem dado. Sem isso, a ausência de um estado vira um degrau que parece
 * mercado — junho/2026 sem o PA cai de ~54% para 49,8% sem nada ter mudado.
 */
export function serieComposicaoFixa(dados: LinhaMensal[], painel: UF[] = PAINEL_CICLO): PontoCiclo[] {
  const porMes = new Map<string, { femeas: number; machos: number; ufs: Set<string> }>();

  for (const linha of dados) {
    if (!painel.includes(linha.uf)) continue;
    const chave = `${linha.ano}-${linha.mes}`;
    const atual = porMes.get(chave) ?? { femeas: 0, machos: 0, ufs: new Set<string>() };
    if (linha.sexo === "FEMEA") atual.femeas += linha.quantidade;
    else atual.machos += linha.quantidade;
    atual.ufs.add(linha.uf);
    porMes.set(chave, atual);
  }

  return [...porMes.entries()]
    .filter(([, v]) => v.ufs.size === painel.length)
    .map(([chave, v]) => {
      const [ano, mes] = chave.split("-").map(Number);
      const total = v.femeas + v.machos;
      return { ano: ano!, mes: mes!, femeas: v.femeas, machos: v.machos, total, pctFemeas: total ? v.femeas / total : 0 };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

export type FaseCiclo = "retencao" | "liquidacao" | "transicao" | "indefinido";

export interface LeituraCiclo {
  fase: FaseCiclo;
  /** Mês de referência: o mais recente que passou no teste de completude. */
  competencia: { ano: number; mes: number } | null;
  pctFemeas: number | null;
  /** Variação anual da média móvel de 3 meses, em pontos percentuais. */
  yoyMm3Pp: number | null;
  /** Há quantos meses seguidos o movimento aponta na mesma direção. */
  mesesNaDirecao: number;
}

/** Média móvel de 3 meses terminando no índice i; null se não houver 3 meses. */
function mediaMovel3(serie: PontoCiclo[], i: number): number | null {
  if (i < 2) return null;
  return (serie[i]!.pctFemeas + serie[i - 1]!.pctFemeas + serie[i - 2]!.pctFemeas) / 3;
}

function indiceDoMesmoMesAnoAnterior(serie: PontoCiclo[], i: number): number {
  const alvo = serie[i]!;
  return serie.findIndex((p) => p.ano === alvo.ano - 1 && p.mes === alvo.mes);
}

/**
 * Lê o ciclo a partir da variação ANUAL da média móvel de 3 meses. Comparar
 * com o mesmo mês do ano anterior neutraliza a sazonalidade (safra, chuvas),
 * e a média de 3 meses tira o ruído de calendário de um mês isolado.
 */
export function lerCiclo(dados: LinhaMensal[], painel: UF[] = PAINEL_CICLO): LeituraCiclo {
  const serie = serieComposicaoFixa(dados, painel);
  const vazio: LeituraCiclo = { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 };

  /** Variação anual da mm3 no índice i, ou null se não der para calcular. */
  const yoy = (i: number): number | null => {
    const j = indiceDoMesmoMesAnoAnterior(serie, i);
    if (j < 0) return null;
    const atual = mediaMovel3(serie, i);
    const anterior = mediaMovel3(serie, j);
    if (atual === null || anterior === null) return null;
    // mês corrente parcial reprova aqui
    if (serie[i]!.total < COMPLETUDE_MINIMA * serie[j]!.total) return null;
    return (atual - anterior) * 100;
  };

  // do mais recente para trás, até achar um mês utilizável
  let i = serie.length - 1;
  let variacao: number | null = null;
  while (i >= 0 && (variacao = yoy(i)) === null) i--;
  if (i < 0 || variacao === null) return vazio;

  const fase: FaseCiclo =
    variacao <= -LIMITE_DIRECIONAL_PP ? "retencao"
    : variacao >= LIMITE_DIRECIONAL_PP ? "liquidacao"
    : "transicao";

  // há quantos meses a variação mantém o mesmo sinal
  let meses = 0;
  for (let k = i; k >= 0; k--) {
    const v = yoy(k);
    if (v === null || Math.sign(v) !== Math.sign(variacao)) break;
    meses++;
  }

  return {
    fase,
    competencia: { ano: serie[i]!.ano, mes: serie[i]!.mes },
    pctFemeas: serie[i]!.pctFemeas,
    yoyMm3Pp: Number(variacao.toFixed(2)),
    mesesNaDirecao: meses,
  };
}
