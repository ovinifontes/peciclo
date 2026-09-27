// De `tipos.js`, não de `dados/mensal.js`: este módulo é importado pelo site, e
// `dados/mensal.js` arrasta o cliente do Supabase da raiz para a checagem de
// tipos — dependência que não existe no build da Vercel.
// Sem `.js` pelo mesmo motivo de `diario/serie.ts`: o Next empacota este
// módulo e não resolve a extensão que não existe em disco.
import { UFS_VISIVEIS, type LinhaMensal, type UF } from "../tipos";

/**
 * Estados que compõem o consolidado do ciclo — exatamente os VISÍVEIS.
 *
 * Eram duas listas até 23/09/2026 e já discordavam: o PA estava fora daqui
 * (a ADEPARA publica com meses de atraso e faria a leitura inteira esperar
 * por ele) mas continuava nas tabelas e gráficos. Uma lista só impede que
 * voltem a divergir.
 */
/**
 * O painel do ciclo é exatamente o conjunto VISÍVEL. Eram duas listas até
 * 23/09/2026 e já discordavam: o PA estava fora daqui (atraso da ADEPARA) e
 * dentro das tabelas. Uma lista só impede que voltem a divergir.
 */
export const PAINEL_CICLO: UF[] = [...UFS_VISIVEIS];

/** Fora desta faixa (em pontos percentuais no ano), o movimento é direcional. */
const LIMITE_DIRECIONAL_PP = 1;

/**
 * Piso de plausibilidade de um estado contra o PRÓPRIO nível recente. Abaixo
 * dele o número não é mercado, é fonte parada.
 *
 * Substituiu, em 27/09/2026, um teste que exigia 90% do volume do mesmo mês do
 * ano anterior. Aquele teste confundia duas coisas opostas: mês pela metade e
 * mercado caindo. E ele falha exatamente quando o ciclo vira — em retenção o
 * abate CAI de verdade, então julho/2026 (82% do ano anterior) e agosto/2026
 * (89%) foram reprovados por serem corretos, e a leitura do site ficou
 * pendurada em junho/2026 enquanto o calendário andava.
 *
 * O piso mede outra coisa, a que de fato distingue os dois casos: setembro/2026
 * tem Rondônia com 112.453 cabeças, 39% da própria mediana recente, porque o
 * painel do IDARON congelou em 11/09; a maior queda REAL da série (RO em
 * julho/2026, −23% no ano) deu 77%. 0,6 separa as duas com folga nos dois lados.
 */
const PISO_PLAUSIBILIDADE = 0.6;
/** Meses do próprio estado que formam a referência do piso. */
const MESES_DE_REFERENCIA = 6;
/** Sem este tanto de mês anterior não há referência, e o piso não se aplica. */
const MINIMO_PARA_REFERENCIA = 3;

/**
 * Hoje no fuso do cliente. A Vercel e o Trigger.dev rodam em UTC e viravam o
 * mês três horas antes do Brasil — o bastante para o dia 1º nascer errado.
 */
function hojeNoBrasil(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function mediana(valores: number[]): number {
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = ordenado.length >> 1;
  return ordenado.length % 2 ? ordenado[meio]! : (ordenado[meio - 1]! + ordenado[meio]!) / 2;
}

export interface PontoCiclo {
  ano: number;
  mes: number;
  femeas: number;
  machos: number;
  total: number;
  pctFemeas: number;
}

export interface MesAvaliado {
  ano: number;
  mes: number;
  ponto: PontoCiclo;
  /** Estados do painel que não publicaram este mês. */
  ausentes: UF[];
  /** Estados que publicaram número implausível para o próprio nível recente. */
  implausiveis: UF[];
}

/**
 * Avalia mês a mês, do mais antigo ao mais recente, dizendo por que cada um
 * entra ou não na série do ciclo. Três exclusões, cada uma por um motivo
 * diferente:
 *
 * 1. Estado ausente. Sem isso a falta de um estado vira degrau que parece
 *    mercado — junho/2026 sem o PA cai de ~54% para 49,8% sem nada ter mudado.
 * 2. Mês em curso. Nem o calendário nem a coleta terminaram; o mês soma menos
 *    do que foi e lê como queda. Meses em curso nem aparecem nesta lista.
 * 3. Estado com número implausível para o próprio nível (ver
 *    `PISO_PLAUSIBILIDADE`). Fonte parada no meio do mês entrega um mês
 *    completo no calendário e pela metade no número — é o caso de Rondônia em
 *    setembro/2026. Derruba o mês igual a estado ausente.
 *
 * A ordem cronológica é requisito, não conveniência: o piso do mês compara com
 * a mediana dos meses ANTERIORES do mesmo estado.
 */
function avaliarMeses(dados: LinhaMensal[], painel: UF[], hoje: string): MesAvaliado[] {
  const porMes = new Map<string, Map<UF, { femeas: number; machos: number }>>();

  for (const linha of dados) {
    if (!painel.includes(linha.uf)) continue;
    // Mês com dois dígitos: a ordenação da série é a ordenação destas chaves.
    const chave = `${linha.ano}-${String(linha.mes).padStart(2, "0")}`;
    const doMes = porMes.get(chave) ?? new Map<UF, { femeas: number; machos: number }>();
    const estado = doMes.get(linha.uf) ?? { femeas: 0, machos: 0 };
    if (linha.sexo === "FEMEA") estado.femeas += linha.quantidade;
    else estado.machos += linha.quantidade;
    doMes.set(linha.uf, estado);
    porMes.set(chave, doMes);
  }

  const mesCorrente = hoje.slice(0, 7);
  const nivelRecente = new Map<UF, number[]>(painel.map((uf) => [uf, []]));
  const avaliados: MesAvaliado[] = [];

  for (const chave of [...porMes.keys()].sort()) {
    if (chave >= mesCorrente) continue;
    const doMes = porMes.get(chave)!;
    const ausentes: UF[] = [];
    const implausiveis: UF[] = [];

    for (const uf of painel) {
      const estado = doMes.get(uf);
      if (!estado) {
        ausentes.push(uf);
        continue;
      }
      const total = estado.femeas + estado.machos;
      const referencia = nivelRecente.get(uf)!;
      if (
        referencia.length >= MINIMO_PARA_REFERENCIA &&
        total < PISO_PLAUSIBILIDADE * mediana(referencia.slice(-MESES_DE_REFERENCIA))
      ) {
        implausiveis.push(uf);
      }
      // Entra na referência mesmo tendo reprovado, de propósito: um nível novo
      // que se sustenta por alguns meses vira a normalidade daquele estado e a
      // série volta sozinha. Sem isso um mês ruim trancaria a leitura para
      // sempre.
      referencia.push(total);
    }

    let femeas = 0;
    let machos = 0;
    for (const estado of doMes.values()) {
      femeas += estado.femeas;
      machos += estado.machos;
    }
    const [ano, mes] = chave.split("-").map(Number);
    const total = femeas + machos;
    avaliados.push({
      ano: ano!,
      mes: mes!,
      ausentes,
      implausiveis,
      ponto: { ano: ano!, mes: mes!, femeas, machos, total, pctFemeas: total ? femeas / total : 0 },
    });
  }

  return avaliados;
}

/** Só os meses que passaram — a série que o ciclo lê e o gráfico desenha. */
export function serieComposicaoFixa(
  dados: LinhaMensal[],
  painel: UF[] = PAINEL_CICLO,
  hoje: string = hojeNoBrasil(),
): PontoCiclo[] {
  return avaliarMeses(dados, painel, hoje)
    .filter((m) => m.ausentes.length === 0 && m.implausiveis.length === 0)
    .map((m) => m.ponto);
}

/**
 * Meses já fechados no calendário que a série recusou, do mais recente para
 * trás. Existe para o site poder dizer POR QUE a competência não é o mês
 * passado — sem isso a leitura para de andar e parece defeito nosso, que foi
 * exatamente a dúvida que originou esta função em 27/09/2026.
 */
export function mesesBloqueados(
  dados: LinhaMensal[],
  painel: UF[] = PAINEL_CICLO,
  hoje: string = hojeNoBrasil(),
): MesAvaliado[] {
  return avaliarMeses(dados, painel, hoje)
    .filter((m) => m.ausentes.length > 0 || m.implausiveis.length > 0)
    .reverse();
}

export type FaseCiclo = "retencao" | "liquidacao" | "transicao" | "indefinido";

export interface LeituraCiclo {
  fase: FaseCiclo;
  /** Mês de referência: o mais recente utilizável (ver `avaliarMeses`). */
  competencia: { ano: number; mes: number } | null;
  pctFemeas: number | null;
  /** Variação anual da média móvel de 3 meses, em pontos percentuais. */
  yoyMm3Pp: number | null;
  /** Há quantos meses seguidos o movimento aponta na mesma direção. */
  mesesNaDirecao: number;
}

/** Verdadeiro se `b` é o mês imediatamente seguinte a `a`. */
function ehMesSeguinte(a: PontoCiclo, b: PontoCiclo): boolean {
  return a.ano * 12 + a.mes + 1 === b.ano * 12 + b.mes;
}

/**
 * Média móvel de 3 meses terminando no índice i; null se não houver 3 meses
 * SEGUIDOS. A série tem buracos de propósito (mês reprovado não entra), e a
 * média de três pontos não consecutivos não é média móvel de 3 meses — é outra
 * coisa com o mesmo nome. Devolver null aqui faz a leitura recuar para o último
 * mês que tem os três, que é o comportamento correto.
 */
function mediaMovel3(serie: PontoCiclo[], i: number): number | null {
  if (i < 2) return null;
  if (!ehMesSeguinte(serie[i - 2]!, serie[i - 1]!) || !ehMesSeguinte(serie[i - 1]!, serie[i]!)) {
    return null;
  }
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
export function lerCiclo(
  dados: LinhaMensal[],
  painel: UF[] = PAINEL_CICLO,
  hoje: string = hojeNoBrasil(),
): LeituraCiclo {
  const serie = serieComposicaoFixa(dados, painel, hoje);
  const vazio: LeituraCiclo = { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 };

  /** Variação anual da mm3 no índice i, ou null se não der para calcular. */
  const yoy = (i: number): number | null => {
    const j = indiceDoMesmoMesAnoAnterior(serie, i);
    if (j < 0) return null;
    const atual = mediaMovel3(serie, i);
    const anterior = mediaMovel3(serie, j);
    if (atual === null || anterior === null) return null;
    // Sem teste de volume aqui: quem decide se o mês é utilizável é
    // `serieComposicaoFixa`, e por completude da COLETA, não por comparação com
    // o ano anterior. Abate caindo 20% no ano é leitura de ciclo, não defeito.
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
