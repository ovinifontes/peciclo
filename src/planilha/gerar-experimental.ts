import ExcelJS from "exceljs";
import { lerAbateMensal, type LinhaMensal } from "../dados/mensal.js";
import { lerAbateSif, lerPrecos, type LinhaPreco } from "../dados/experimental.js";
import { calcularKpis } from "./kpis.js";
import { calcularPremioFuturos, calcularRelacaoTroca, ultimoPreco } from "./mercado.js";
import type { Futuro } from "../coletores/precos.js";

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Planilha EXPERIMENTAL. Os 4 estados de GTA vêm iguais à planilha de
 * produção; GO e SP entram de fonte diferente (inspeção federal) e ficam
 * rotulados, porque o nível absoluto não é comparável — só a tendência.
 */
const ESTADOS: Array<{ rotulo: string; uf: string; fonte: "gta" | "sif" }> = [
  { rotulo: "Mato Grosso", uf: "MT", fonte: "gta" },
  { rotulo: "Mato Grosso do Sul", uf: "MS", fonte: "gta" },
  { rotulo: "Rondonia", uf: "RO", fonte: "gta" },
  { rotulo: "Pará", uf: "PA", fonte: "gta" },
  { rotulo: "Goias (SIF)", uf: "GO", fonte: "sif" },
  { rotulo: "São Paulo (SIF)", uf: "SP", fonte: "sif" },
];

function abaAviso(planilha: ExcelJS.Workbook): void {
  const aba = planilha.addWorksheet("Leia-me");
  const linhas: Array<[string, string]> = [
    ["O que é esta planilha", "Versão EXPERIMENTAL, separada da planilha oficial. Serve para avaliar se os dados novos (Goiás, São Paulo e preços) agregam valor."],
    ["MT, MS, RO, PA", "Idênticos à planilha oficial. Fonte: GTA dos órgãos estaduais (INDEA, IAGRO, IDARON, ADEPARA) — intenção de abate registrada na origem."],
    ["Goiás e São Paulo", "Fonte DIFERENTE: abate sob inspeção federal (SIGSIF/MAPA). Não cobre inspeção estadual e municipal, então o NÚMERO ABSOLUTO é menor e NÃO é comparável com os outros quatro estados. Use apenas a TENDÊNCIA do % de fêmeas."],
    ["Por que não dá para igualar", "GO e SP não publicam abate bovino por sexo nas próprias fontes de GTA. O SIGSIF é a única fonte pública com essa quebra."],
    ["Preços", "Indicador do Boi Gordo CEPEA/B3 (R$/@) e Indicador do Bezerro CEPEA/ESALQ-MS (R$/cabeça). Fonte: CEPEA-ESALQ/USP."],
    ["Futuros", "Ajustes dos contratos futuros de boi gordo (BGI) da B3, republicados por Notícias Agrícolas."],
    ["Série de preços", "Começa na data em que este sistema entrou no ar: a fonte publica apenas o valor do dia, sem histórico."],
    ["Relação de troca", "Quantas arrobas de boi gordo compram um bezerro. Subindo = reposição cara (aperta a recria). Caindo = reposição barata."],
  ];
  aba.addRow(["Item", "Explicação"]);
  aba.getRow(1).font = { bold: true };
  for (const l of linhas) aba.addRow(l);
  aba.getColumn(1).width = 26;
  aba.getColumn(2).width = 120;
  aba.getColumn(2).alignment = { wrapText: true, vertical: "top" };
}

function abaAbate(
  planilha: ExcelJS.Workbook,
  gta: LinhaMensal[],
  sif: Array<{ uf: string; ano: number; mes: number; sexo: string; quantidade: number }>,
): void {
  const aba = planilha.addWorksheet("Abate");
  const indice = new Map<string, number>();
  for (const d of gta) indice.set(`${d.uf}-${d.ano}-${d.mes}-${d.sexo}`, d.quantidade);
  for (const d of sif) indice.set(`${d.uf}-${d.ano}-${d.mes}-${d.sexo}`, d.quantidade);

  const anos = [...gta.map((d) => d.ano), ...sif.map((d) => d.ano)];
  const anoInicial = anos.length ? Math.min(...anos) : new Date().getUTCFullYear();
  const anoFinal = Math.max(anoInicial, new Date().getUTCFullYear());

  const cabecalho: Array<string | null> = [null, null];
  for (const e of ESTADOS) cabecalho.push(e.rotulo, null);
  aba.addRow(cabecalho);
  aba.addRow(["Mês", "Ano", ...ESTADOS.flatMap(() => ["Fêmea", "Macho"])]);

  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const valores = ESTADOS.flatMap((e) => [
        indice.get(`${e.uf}-${ano}-${mes}-FEMEA`) ?? null,
        indice.get(`${e.uf}-${ano}-${mes}-MACHO`) ?? null,
      ]);
      aba.addRow([NOMES_MESES[mes - 1]!, ano, ...valores]);
    }
  }

  ESTADOS.forEach((_, i) => aba.mergeCells(1, 3 + i * 2, 1, 4 + i * 2));
  aba.getRow(1).font = { bold: true };
  aba.getRow(2).font = { bold: true };
  aba.getColumn(1).width = 12;
  aba.getColumn(2).width = 8;
  for (let c = 3; c <= 2 + ESTADOS.length * 2; c++) {
    aba.getColumn(c).width = 13;
    aba.getColumn(c).numFmt = "#,##0";
  }
}

function abaCiclo(planilha: ExcelJS.Workbook, gta: LinhaMensal[], sif: LinhaMensal[]): void {
  const aba = planilha.addWorksheet("Ciclo");
  aba.addRow(["Escopo", "Ano", "Mês", "Fêmeas", "Machos", "Total", "% Fêmeas", "Var. mês ant. (p.p.)", "Média móvel 12m", "Fonte"]);
  aba.getRow(1).font = { bold: true };

  // GTA e SIF são calculados SEPARADAMENTE: misturar as duas metodologias num
  // consolidado único produziria um percentual sem significado.
  const blocos: Array<{ dados: LinhaMensal[]; fonte: string }> = [
    { dados: gta, fonte: "GTA estadual" },
    { dados: sif, fonte: "SIF federal" },
  ];

  for (const bloco of blocos) {
    if (bloco.dados.length === 0) continue;
    const kpis = calcularKpis(bloco.dados).sort(
      (a, b) => b.ano - a.ano || b.mes - a.mes || a.uf.localeCompare(b.uf),
    );
    for (const k of kpis) {
      aba.addRow([
        k.uf === "CONSOLIDADO" ? `Consolidado (${k.estados} est.)` : k.uf,
        k.ano,
        NOMES_MESES[k.mes - 1],
        k.femeas,
        k.machos,
        k.total,
        k.participacaoFemeas,
        k.variacaoMesAnteriorPp,
        k.mediaMovel12m,
        bloco.fonte,
      ]);
    }
  }

  aba.getColumn(1).width = 20;
  for (const c of [4, 5, 6]) aba.getColumn(c).numFmt = "#,##0";
  for (const c of [7, 8, 9]) { aba.getColumn(c).numFmt = "0.0%"; aba.getColumn(c).width = 20; }
  aba.getColumn(10).width = 14;
}

function abaMercado(planilha: ExcelJS.Workbook, precos: LinhaPreco[], futuros: Futuro[]): void {
  const aba = planilha.addWorksheet("Mercado");
  const boi = ultimoPreco(precos, "boi_gordo");
  const bezerro = ultimoPreco(precos, "bezerro_ms");

  aba.addRow(["Indicador", "Valor", "Unidade", "Data", "Fonte"]);
  aba.getRow(1).font = { bold: true };
  if (boi) aba.addRow(["Boi Gordo CEPEA/B3", boi.valor, boi.unidade, boi.data, "CEPEA-ESALQ/USP"]);
  if (bezerro) aba.addRow(["Bezerro CEPEA/ESALQ-MS", bezerro.valor, bezerro.unidade, bezerro.data, "CEPEA-ESALQ/USP"]);
  if (boi && bezerro) {
    aba.addRow(["Relação de troca", Number((bezerro.valor / boi.valor).toFixed(2)), "arrobas por bezerro", boi.data, "calculado"]);
  }

  aba.addRow([]);
  aba.addRow(["Futuros do Boi Gordo (BGI) — B3"]);
  aba.getRow(aba.rowCount).font = { bold: true };
  aba.addRow(["Contrato", "Fechamento (R$/@)", "Prêmio sobre o à vista", "", "Fonte"]);
  for (const f of calcularPremioFuturos(futuros, boi?.valor ?? null)) {
    aba.addRow([f.contrato, f.fechamento, f.premioPct === null ? null : f.premioPct / 100, "", "B3 via Notícias Agrícolas"]);
  }

  aba.addRow([]);
  aba.addRow(["Histórico da relação de troca"]);
  aba.getRow(aba.rowCount).font = { bold: true };
  aba.addRow(["Data", "Boi gordo (R$/@)", "Bezerro (R$)", "Arrobas por bezerro"]);
  for (const r of calcularRelacaoTroca(precos).slice(0, 60)) {
    aba.addRow([r.data, r.boiGordo, r.bezerro, r.arrobasPorBezerro]);
  }

  aba.getColumn(1).width = 26;
  aba.getColumn(2).width = 18;
  aba.getColumn(3).width = 22;
  aba.getColumn(4).width = 20;
  aba.getColumn(5).width = 26;
}

/** Monta a planilha experimental a partir do banco. */
export async function gerarPlanilhaExperimental(futuros: Futuro[]): Promise<Buffer> {
  const gta = await lerAbateMensal();
  const sifBruto = await lerAbateSif();
  const precos = await lerPrecos();

  const sif = sifBruto.map((d) => ({
    uf: d.uf as LinhaMensal["uf"],
    ano: d.ano,
    mes: d.mes,
    sexo: d.sexo,
    quantidade: d.quantidade,
  })) as LinhaMensal[];

  const planilha = new ExcelJS.Workbook();
  planilha.created = new Date();
  abaAviso(planilha);
  abaAbate(planilha, gta, sifBruto);
  abaCiclo(planilha, gta, sif);
  abaMercado(planilha, precos, futuros);

  return Buffer.from(await planilha.xlsx.writeBuffer());
}
