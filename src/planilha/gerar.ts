import ExcelJS from "exceljs";
import type { LinhaMensal } from "../dados/mensal.js";
import type { Sexo, UF } from "../tipos.js";
import { calcularKpis, type Kpi } from "./kpis.js";
import { lerAbateMensal } from "../dados/mensal.js";

/**
 * Ordem das colunas na planilha que o fazendeiro já conhece.
 * Goiás e São Paulo continuam presentes e vazios de propósito: não existe
 * fonte estadual pública equivalente, e mudar o formato agora atrapalharia.
 */
const ESTADOS: Array<{ rotulo: string; uf: UF | null }> = [
  { rotulo: "Mato Grosso", uf: "MT" },
  { rotulo: "Mato Grosso do Sul", uf: "MS" },
  { rotulo: "Rondonia", uf: "RO" },
  { rotulo: "Pará", uf: "PA" },
  { rotulo: "Goias", uf: null },
  { rotulo: "São Paulo", uf: null },
];

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const SEXOS: Sexo[] = ["FEMEA", "MACHO"];

export interface LinhaGrade {
  rotuloMes: string;
  ano: number;
  mes: number;
  /** 12 posições: pares fêmea/macho na ordem de ESTADOS. */
  valores: Array<number | null>;
}

export interface Grade {
  cabecalhoEstados: string[];
  cabecalhoSexos: string[];
  linhas: LinhaGrade[];
}

export function montarGradeDados(
  dados: LinhaMensal[],
  anoInicial: number,
  anoFinal: number,
): Grade {
  const indice = new Map<string, number>();
  for (const d of dados) indice.set(`${d.uf}-${d.ano}-${d.mes}-${d.sexo}`, d.quantidade);

  const linhas: LinhaGrade[] = [];
  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const valores: Array<number | null> = [];
      for (const estado of ESTADOS) {
        for (const sexo of SEXOS) {
          valores.push(estado.uf ? indice.get(`${estado.uf}-${ano}-${mes}-${sexo}`) ?? null : null);
        }
      }
      linhas.push({ rotuloMes: NOMES_MESES[mes - 1]!, ano, mes, valores });
    }
  }

  return {
    cabecalhoEstados: ESTADOS.map((e) => e.rotulo),
    cabecalhoSexos: ESTADOS.flatMap(() => ["Fêmea", "Macho"]),
    linhas,
  };
}

/** Escreve a aba de dados no formato que o fazendeiro já conhece. */
export function escreverAbaDados(planilha: ExcelJS.Workbook, grade: Grade): void {
  const aba = planilha.addWorksheet("Abate");

  const linhaEstados: Array<string | null> = [null, null];
  for (const rotulo of grade.cabecalhoEstados) linhaEstados.push(rotulo, null);
  aba.addRow(linhaEstados);

  aba.addRow(["Mês", "Ano", ...grade.cabecalhoSexos]);

  for (const linha of grade.linhas) {
    aba.addRow([linha.rotuloMes, linha.ano, ...linha.valores]);
  }

  // mescla o rótulo de cada estado sobre o par fêmea/macho
  grade.cabecalhoEstados.forEach((_, i) => {
    const coluna = 3 + i * 2;
    aba.mergeCells(1, coluna, 1, coluna + 1);
  });

  aba.getRow(1).font = { bold: true };
  aba.getRow(2).font = { bold: true };
  aba.getColumn(1).width = 12;
  aba.getColumn(2).width = 8;
  for (let c = 3; c <= 14; c++) {
    aba.getColumn(c).width = 12;
    aba.getColumn(c).numFmt = "#,##0";
  }
}

const ROTULO_ESCOPO: Record<string, string> = {
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  RO: "Rondônia",
  PA: "Pará",
  CONSOLIDADO: "Consolidado",
};

/** Aba de leitura do ciclo: participação de fêmeas e suas variações. */
export function escreverAbaCiclo(planilha: ExcelJS.Workbook, kpis: Kpi[]): void {
  const aba = planilha.addWorksheet("Ciclo");

  aba.addRow([
    "Estado", "Ano", "Mês", "Fêmeas", "Machos", "Total",
    "% Fêmeas", "Var. mês anterior (p.p.)", "Var. ano anterior (p.p.)", "Média móvel 12m",
  ]);
  aba.getRow(1).font = { bold: true };

  const ordenados = [...kpis].sort(
    (a, b) => b.ano - a.ano || b.mes - a.mes || a.uf.localeCompare(b.uf),
  );

  for (const k of ordenados) {
    aba.addRow([
      ROTULO_ESCOPO[k.uf] ?? k.uf,
      k.ano,
      NOMES_MESES[k.mes - 1],
      k.femeas,
      k.machos,
      k.total,
      k.participacaoFemeas,
      k.variacaoMesAnteriorPp,
      k.variacaoAnoAnteriorPp,
      k.mediaMovel12m,
    ]);
  }

  aba.getColumn(1).width = 20;
  for (const c of [4, 5, 6]) aba.getColumn(c).numFmt = "#,##0";
  for (const c of [7, 8, 9, 10]) {
    aba.getColumn(c).numFmt = "0.0%";
    aba.getColumn(c).width = 22;
  }
}

/** Monta a planilha completa a partir do banco. */
export async function gerarPlanilha(): Promise<Buffer> {
  const dados = await lerAbateMensal();
  const anos = dados.map((d) => d.ano);
  const anoInicial = anos.length ? Math.min(...anos) : new Date().getUTCFullYear();
  const anoFinal = Math.max(anoInicial, new Date().getUTCFullYear());

  const planilha = new ExcelJS.Workbook();
  planilha.created = new Date();
  escreverAbaDados(planilha, montarGradeDados(dados, anoInicial, anoFinal));
  escreverAbaCiclo(planilha, calcularKpis(dados));

  return Buffer.from(await planilha.xlsx.writeBuffer());
}
