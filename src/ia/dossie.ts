// O dossiê é o retrato do dia que a IA tem permissão de ver: montado por
// código determinístico a partir de dados já lidos do banco. O que não está
// aqui não existe para ela — e todo número do texto gerado é conferido contra
// este objeto (ver `validacao.ts`).
//
// REGRA DURA (herdada da Fatia 1): este módulo é importado pelo SITE por
// caminho relativo, e o build da Vercel não instala as dependências da raiz.
// Só pode importar de `../ciclo/leitura.js`, `../tipos.js` e vizinhos puros.
import { PAINEL_CICLO } from "../ciclo/leitura.js";
import type { LeituraCiclo, PontoCiclo } from "../ciclo/leitura.js";

export interface PrecoDia {
  serie: string; // "boi_gordo" | "bezerro_ms" | "bezerro_sp" | ...
  data: string; // "2026-08-05"
  valor: number;
}

export interface FuturoDia {
  vencimento: string; // "out/26"
  preco: number;
}

export interface Dossie {
  geradoEm: string; // "2026-08-06"
  ciclo: LeituraCiclo;
  serie: PontoCiclo[]; // cortada na competência da leitura
  precos: PrecoDia[]; // o mais recente de cada série
  variacaoBoiDia: number | null; // R$ vs pregão anterior, se houver
  futuros: FuturoDia[];
  relacaoTroca: number | null; // arrobas de boi por bezerro (MS)
  estadosPainel: string; // "MT + MS + RO"
}

export function montarDossie(entrada: {
  hoje: string;
  ciclo: LeituraCiclo;
  serie: PontoCiclo[];
  precos: PrecoDia[]; // série completa; a função pega os últimos
  futuros: FuturoDia[];
}): Dossie {
  const { hoje, ciclo, serie, precos, futuros } = entrada;

  const comp = ciclo.competencia;
  const serieCortada = comp
    ? serie.filter((p) => p.ano < comp.ano || (p.ano === comp.ano && p.mes <= comp.mes))
    : serie;

  // Por série de preço, o histórico ordenado por data — datas ISO ordenam como texto.
  const porSerie = new Map<string, PrecoDia[]>();
  for (const p of precos) {
    const lista = porSerie.get(p.serie) ?? [];
    lista.push(p);
    porSerie.set(p.serie, lista);
  }
  for (const lista of porSerie.values()) lista.sort((a, b) => a.data.localeCompare(b.data));

  const maisRecentes = [...porSerie.values()].map((lista) => lista.at(-1)!);

  const boi = porSerie.get("boi_gordo") ?? [];
  const ultimoBoi = boi.at(-1);
  const penultimoBoi = boi.at(-2);
  const variacaoBoiDia =
    ultimoBoi && penultimoBoi ? ultimoBoi.valor - penultimoBoi.valor : null;

  const ultimoBezerro = (porSerie.get("bezerro_ms") ?? []).at(-1);
  const relacaoTroca =
    ultimoBoi && ultimoBezerro && ultimoBoi.valor > 0 ? ultimoBezerro.valor / ultimoBoi.valor : null;

  return {
    geradoEm: hoje,
    ciclo,
    serie: serieCortada,
    precos: maisRecentes,
    variacaoBoiDia,
    futuros,
    relacaoTroca,
    estadosPainel: PAINEL_CICLO.join(" + "),
  };
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

const FASES: Record<LeituraCiclo["fase"], string> = {
  retencao: "retenção de fêmeas",
  liquidacao: "liquidação de fêmeas",
  transicao: "transição",
  indefinido: "indefinida (histórico insuficiente)",
};

const ROTULO_SERIE: Record<string, string> = {
  boi_gordo: "Boi gordo (CEPEA, R$/@)",
  bezerro_ms: "Bezerro MS (CEPEA, R$/cabeça)",
  bezerro_sp: "Bezerro SP (CEPEA, R$/cabeça)",
};

/** "junho de 2026" — competência e meses da série por extenso. */
export function mesPorExtenso(ano: number, mes: number): string {
  return `${MESES[mes - 1] ?? `mês ${mes}`} de ${ano}`;
}

/** Contrato da B3 ("Outubro/2026") → vencimento curto do dossiê ("out/26"). */
export function contratoParaVencimento(contrato: string): string {
  const [nome, ano] = contrato.split("/");
  if (!nome?.trim() || !ano?.trim()) return contrato;
  const mes = nome.trim().toLowerCase();
  const conhecido = MESES.find((m) => m === mes);
  // Mês fora da lista: 3 primeiras letras ainda dão um rótulo legível.
  const abreviado = (conhecido ?? mes).slice(0, 3);
  return `${abreviado}/${ano.trim().slice(-2)}`;
}

/** Converte a curva coletada (`coletarFuturos`) para o formato do dossiê. */
export function futurosParaDossie(futuros: Array<{ contrato: string; fechamento: number }>): FuturoDia[] {
  return futuros.map((f) => ({ vencimento: contratoParaVencimento(f.contrato), preco: f.fechamento }));
}

/** "2026-08-05" → "05/08/2026". */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

const numeroBr = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatarNumeroBr(valor: number): string {
  return numeroBr.format(valor);
}

/**
 * Bloco estruturado em pt-BR para o prompt. Só expõe números que a validação
 * permite (`valoresPermitidos`): percentuais da série, preços, variações,
 * relação de troca e futuros — nada de contagens absolutas de cabeças.
 */
export function dossieParaTexto(d: Dossie): string {
  const linhas: string[] = [];
  const c = d.ciclo;

  linhas.push(`DOSSIÊ PECICLO — ${formatarDataBr(d.geradoEm)}`);
  linhas.push(`Estados do consolidado do ciclo: ${d.estadosPainel}`);
  linhas.push("");

  linhas.push("LEITURA DO CICLO PECUÁRIO");
  linhas.push(`- Fase: ${FASES[c.fase]}`);
  linhas.push(`- Competência (mês mais recente utilizável): ${c.competencia ? mesPorExtenso(c.competencia.ano, c.competencia.mes) : "sem mês utilizável"}`);
  if (c.pctFemeas !== null) linhas.push(`- Participação de fêmeas no abate: ${formatarNumeroBr(c.pctFemeas * 100)}%`);
  if (c.yoyMm3Pp !== null) linhas.push(`- Variação anual da média móvel de 3 meses: ${formatarNumeroBr(c.yoyMm3Pp)} p.p.`);
  if (c.mesesNaDirecao > 0) linhas.push(`- Meses seguidos na mesma direção: ${c.mesesNaDirecao}`);
  linhas.push("");

  if (d.serie.length > 0) {
    linhas.push(`SÉRIE MENSAL (participação de fêmeas no abate, ${d.estadosPainel})`);
    for (const p of d.serie) linhas.push(`- ${mesPorExtenso(p.ano, p.mes)}: ${formatarNumeroBr(p.pctFemeas * 100)}%`);
    linhas.push("");
  }

  if (d.precos.length > 0) {
    linhas.push("PREÇOS MAIS RECENTES (cada um com a data do pregão)");
    for (const p of d.precos) {
      linhas.push(`- ${ROTULO_SERIE[p.serie] ?? p.serie.replaceAll("_", " ")}: R$ ${formatarNumeroBr(p.valor)} em ${formatarDataBr(p.data)}`);
    }
    if (d.variacaoBoiDia !== null) linhas.push(`- Variação do boi gordo vs pregão anterior: ${formatarNumeroBr(d.variacaoBoiDia)} R$/@`);
    if (d.relacaoTroca !== null) linhas.push(`- Relação de troca: um bezerro (MS) vale ${formatarNumeroBr(d.relacaoTroca)} arrobas de boi gordo`);
    linhas.push("");
  }

  if (d.futuros.length > 0) {
    linhas.push("FUTUROS DO BOI GORDO (B3)");
    for (const f of d.futuros) linhas.push(`- ${f.vencimento}: R$ ${formatarNumeroBr(f.preco)}`);
    linhas.push("");
  }

  return linhas.join("\n").trimEnd();
}
