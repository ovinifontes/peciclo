import ExcelJS from "exceljs";
import type { LinhaMensal } from "../dados/mensal.js";
import { UFS_VISIVEIS, ufVisivel, type UF } from "../tipos.js";
import { calcularKpis, participacaoFemeas, type Kpi } from "./kpis.js";
import { lerAbateMensal } from "../dados/mensal.js";

/**
 * Ordem das colunas na planilha que o fazendeiro já conhece.
 * Goiás e São Paulo continuam presentes e vazios de propósito: não existe
 * fonte estadual pública equivalente, e mudar o formato agora atrapalharia.
 */
const ROTULO_UF: Record<UF, string> = {
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  RO: "Rondonia",
  PA: "Pará",
};

/**
 * As colunas saem de `UFS_VISIVEIS`, não de uma lista fixa: esconder um estado
 * é editar aquela única lista, e a coluna some daqui junto com o dado.
 * Goiás e São Paulo continuam presentes e vazios de propósito — não existe
 * fonte estadual pública equivalente, e mudar o formato agora atrapalharia.
 */
const ESTADOS: Array<{ rotulo: string; uf: UF | null }> = [
  ...UFS_VISIVEIS.map((uf) => ({ rotulo: ROTULO_UF[uf], uf: uf as UF | null })),
  { rotulo: "Goias", uf: null },
  { rotulo: "São Paulo", uf: null },
];

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Fêmea, Macho e % Fêmeas — cada estado ocupa três colunas. */
const COLUNAS_POR_ESTADO = 3;

export interface LinhaGrade {
  rotuloMes: string;
  ano: number;
  mes: number;
  /** 18 posições: trios fêmea/macho/% na ordem de ESTADOS. */
  valores: Array<number | null>;
}

export interface Grade {
  cabecalhoEstados: string[];
  cabecalhoColunas: string[];
  linhas: LinhaGrade[];
}

/**
 * Legenda da planilha no WhatsApp. Texto de CLIENTE: quando um estado não
 * atualizou hoje, a legenda diz — "atualizado em <data>" sozinho vende dado
 * congelado há semanas como se fosse fresco.
 * Usa os mesmos nomes de estado das colunas da planilha, não a sigla técnica.
 */
export function legendaPlanilha(dataReferencia: string, ufsComFalha: string[] = []): string {
  const base = `Abate bovino — atualizado em ${dataReferencia}`;
  // Só avisa sobre estado que a planilha MOSTRA: dizer "Pará não atualizou"
  // numa planilha sem coluna de Pará só gera pergunta.
  const nomes = ufsComFalha
    .filter((uf) => ufVisivel(uf) || !(uf in ROTULO_UF))
    .map((uf) => ESTADOS.find((e) => e.uf === uf)?.rotulo ?? uf);
  if (nomes.length === 0) return base;
  if (nomes.length === 1) {
    return `${base}\n\n⚠️ ${nomes[0]} não atualizou hoje: os números desse estado são os da última atualização.`;
  }
  const lista = `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
  return `${base}\n\n⚠️ ${lista} não atualizaram hoje: os números desses estados são os da última atualização.`;
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
        const femea = estado.uf ? indice.get(`${estado.uf}-${ano}-${mes}-FEMEA`) ?? null : null;
        const macho = estado.uf ? indice.get(`${estado.uf}-${ano}-${mes}-MACHO`) ?? null : null;
        // A porcentagem só sai com os DOIS sexos presentes. Com um lado
        // ausente a conta daria 100% (ou 0%) e venderia um mês pela metade
        // como se fosse leitura do ciclo — que é justamente o número que o
        // fazendeiro olha para decidir.
        const pct = femea === null || macho === null ? null : participacaoFemeas(femea, macho);
        valores.push(femea, macho, pct);
      }
      linhas.push({ rotuloMes: NOMES_MESES[mes - 1]!, ano, mes, valores });
    }
  }

  return {
    cabecalhoEstados: ESTADOS.map((e) => e.rotulo),
    cabecalhoColunas: ESTADOS.flatMap(() => ["Fêmea", "Macho", "% Fêmeas"]),
    linhas,
  };
}

/** Escreve a aba de dados no formato que o fazendeiro já conhece. */
export function escreverAbaDados(planilha: ExcelJS.Workbook, grade: Grade): void {
  const aba = planilha.addWorksheet("Abate");

  const linhaEstados: Array<string | null> = [null, null];
  for (const rotulo of grade.cabecalhoEstados) {
    linhaEstados.push(rotulo, ...Array(COLUNAS_POR_ESTADO - 1).fill(null));
  }
  aba.addRow(linhaEstados);

  aba.addRow(["Mês", "Ano", ...grade.cabecalhoColunas]);

  for (const linha of grade.linhas) {
    aba.addRow([linha.rotuloMes, linha.ano, ...linha.valores]);
  }

  // mescla o rótulo de cada estado sobre o trio fêmea/macho/%
  grade.cabecalhoEstados.forEach((_, i) => {
    const coluna = 3 + i * COLUNAS_POR_ESTADO;
    aba.mergeCells(1, coluna, 1, coluna + COLUNAS_POR_ESTADO - 1);
  });

  aba.getRow(1).font = { bold: true };
  aba.getRow(2).font = { bold: true };
  aba.getColumn(1).width = 12;
  aba.getColumn(2).width = 8;
  const ultimaColuna = 2 + grade.cabecalhoEstados.length * COLUNAS_POR_ESTADO;
  for (let c = 3; c <= ultimaColuna; c++) {
    aba.getColumn(c).width = 12;
    // A terceira coluna de cada estado é a porcentagem.
    aba.getColumn(c).numFmt = (c - 3) % COLUNAS_POR_ESTADO === 2 ? "0.0%" : "#,##0";
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
    "Estados no cálculo",
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
      // No consolidado, faltar estado significa que o mês não é comparável
      // com os demais — a ausência de um desloca o percentual sem que o
      // mercado tenha mudado. O total vem de UFS_VISIVEIS, não cravado em 4:
      // com o PA escondido o denominador é 3, e "3 de 4" seria alarme falso
      // todo mês.
      k.uf === "CONSOLIDADO" ? `${k.estados} de ${UFS_VISIVEIS.length}` : "—",
    ]);
  }

  aba.getColumn(1).width = 20;
  for (const c of [4, 5, 6]) aba.getColumn(c).numFmt = "#,##0";
  for (const c of [7, 8, 9, 10]) {
    aba.getColumn(c).numFmt = "0.0%";
    aba.getColumn(c).width = 22;
  }
  aba.getColumn(11).width = 18;
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
