import ExcelJS from "exceljs";
import type { LinhaMensal } from "../dados/mensal.js";
import type { Sexo, UF } from "../tipos.js";

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
