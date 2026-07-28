import type { LinhaMensal } from "../dados/mensal.js";
import type { UF } from "../tipos.js";

export type EscopoKpi = UF | "CONSOLIDADO";

export interface Kpi {
  uf: EscopoKpi;
  ano: number;
  mes: number;
  femeas: number;
  machos: number;
  total: number;
  /** Fração de 0 a 1, ou null quando não houve abate. */
  participacaoFemeas: number | null;
  /** Diferença em pontos percentuais (0,15 = 15 p.p.). */
  variacaoMesAnteriorPp: number | null;
  variacaoAnoAnteriorPp: number | null;
  /** Média móvel de 12 meses da participação; null antes de 12 observações. */
  mediaMovel12m: number | null;
}

export function participacaoFemeas(femeas: number, machos: number): number | null {
  const total = femeas + machos;
  return total === 0 ? null : femeas / total;
}

export function calcularKpis(dados: LinhaMensal[]): Kpi[] {
  const acumulado = new Map<string, { femeas: number; machos: number }>();

  const somar = (escopo: EscopoKpi, ano: number, mes: number, sexo: string, qtd: number) => {
    const chave = `${escopo}|${ano}|${mes}`;
    const atual = acumulado.get(chave) ?? { femeas: 0, machos: 0 };
    if (sexo === "FEMEA") atual.femeas += qtd;
    else atual.machos += qtd;
    acumulado.set(chave, atual);
  };

  for (const d of dados) {
    somar(d.uf, d.ano, d.mes, d.sexo, d.quantidade);
    somar("CONSOLIDADO", d.ano, d.mes, d.sexo, d.quantidade);
  }

  const kpis: Kpi[] = [...acumulado.entries()]
    .map(([chave, { femeas, machos }]) => {
      const [uf, ano, mes] = chave.split("|");
      return {
        uf: uf as EscopoKpi,
        ano: Number(ano),
        mes: Number(mes),
        femeas,
        machos,
        total: femeas + machos,
        participacaoFemeas: participacaoFemeas(femeas, machos),
        variacaoMesAnteriorPp: null as number | null,
        variacaoAnoAnteriorPp: null as number | null,
        mediaMovel12m: null as number | null,
      };
    })
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.ano - b.ano || a.mes - b.mes);

  const porChave = new Map(kpis.map((k) => [`${k.uf}|${k.ano}|${k.mes}`, k]));

  for (const kpi of kpis) {
    if (kpi.participacaoFemeas === null) continue;

    const anterior = kpi.mes === 1
      ? porChave.get(`${kpi.uf}|${kpi.ano - 1}|12`)
      : porChave.get(`${kpi.uf}|${kpi.ano}|${kpi.mes - 1}`);
    if (anterior?.participacaoFemeas != null) {
      kpi.variacaoMesAnteriorPp = kpi.participacaoFemeas - anterior.participacaoFemeas;
    }

    const anoPassado = porChave.get(`${kpi.uf}|${kpi.ano - 1}|${kpi.mes}`);
    if (anoPassado?.participacaoFemeas != null) {
      kpi.variacaoAnoAnteriorPp = kpi.participacaoFemeas - anoPassado.participacaoFemeas;
    }

    const janela: number[] = [];
    for (let i = 0; i < 12; i++) {
      const total = kpi.mes - 1 - i;
      const ano = kpi.ano + Math.floor(total / 12);
      const mes = ((total % 12) + 12) % 12 + 1;
      const p = porChave.get(`${kpi.uf}|${ano}|${mes}`)?.participacaoFemeas;
      if (p != null) janela.push(p);
    }
    if (janela.length === 12) {
      kpi.mediaMovel12m = janela.reduce((s, v) => s + v, 0) / 12;
    }
  }

  return kpis;
}
