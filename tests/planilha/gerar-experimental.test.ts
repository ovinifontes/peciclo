import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { abaAbate } from "../../src/planilha/gerar-experimental.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

const gta: LinhaMensal[] = [
  { uf: "MT", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 10 },
  { uf: "MT", ano: 2026, mes: 3, sexo: "MACHO", quantidade: 20 },
];

/** Lê (ano, mês) das linhas de dados — as duas primeiras são cabeçalho. */
function competencias(aba: ExcelJS.Worksheet): Array<{ mes: string; ano: number }> {
  const saida: Array<{ mes: string; ano: number }> = [];
  aba.eachRow((linha, i) => {
    if (i <= 2) return;
    saida.push({ mes: String(linha.getCell(1).value), ano: Number(linha.getCell(2).value) });
  });
  return saida;
}

describe("abaAbate da planilha completa", () => {
  it("começa pelo mês mais recente e termina no mais antigo", () => {
    const planilha = new ExcelJS.Workbook();
    abaAbate(planilha, gta, []);
    const linhas = competencias(planilha.getWorksheet("Abate")!);

    const [anoHoje, mesHoje] = new Date()
      .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
      .split("-")
      .map(Number) as [number, number];
    const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    expect(linhas[0]).toEqual({ mes: MESES[mesHoje - 1], ano: anoHoje });
    expect(linhas.at(-1)).toEqual({ mes: "Janeiro", ano: 2025 });
  });

  it("não abre a planilha com meses que ainda não aconteceram", () => {
    const planilha = new ExcelJS.Workbook();
    abaAbate(planilha, gta, []);
    const linhas = competencias(planilha.getWorksheet("Abate")!);
    const [anoHoje, mesHoje] = new Date()
      .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
      .split("-")
      .map(Number) as [number, number];
    const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const futuros = linhas.filter(
      (l) => l.ano > anoHoje || (l.ano === anoHoje && MESES.indexOf(l.mes) + 1 > mesHoje),
    );
    expect(futuros).toEqual([]);
  });

  it("nunca volta no tempo entre uma linha e a seguinte", () => {
    const planilha = new ExcelJS.Workbook();
    abaAbate(planilha, gta, []);
    const linhas = competencias(planilha.getWorksheet("Abate")!);
    const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const ordinal = (l: { mes: string; ano: number }) => l.ano * 12 + MESES.indexOf(l.mes);

    for (let i = 1; i < linhas.length; i++) {
      expect(ordinal(linhas[i - 1]!)).toBeGreaterThan(ordinal(linhas[i]!));
    }
  });
});

describe("fonte de cada estado na aba Abate", () => {
  // MT/MS/RO/PA são GTA estadual; GO/SP são inspeção federal (SIGSIF). O
  // SIGSIF TAMBÉM publica MT, então um índice único fazia o SIF sobrescrever
  // o GTA e a coluna "Mato Grosso" saía com o número federal, menor — e
  // diferente da planilha tradicional enviada 30 min antes.
  const gtaMt: LinhaMensal[] = [
    { uf: "MT", ano: 2026, mes: 8, sexo: "FEMEA", quantidade: 254451 },
    { uf: "MT", ano: 2026, mes: 8, sexo: "MACHO", quantidade: 356339 },
  ];
  const sifMt = [
    { uf: "MT", ano: 2026, mes: 8, sexo: "FEMEA", quantidade: 179808 },
    { uf: "MT", ano: 2026, mes: 8, sexo: "MACHO", quantidade: 338921 },
    { uf: "GO", ano: 2026, mes: 8, sexo: "FEMEA", quantidade: 58692 },
    { uf: "GO", ano: 2026, mes: 8, sexo: "MACHO", quantidade: 195712 },
  ];

  function linhaDe(aba: ExcelJS.Worksheet, mes: string, ano: number): ExcelJS.Row | null {
    let achada: ExcelJS.Row | null = null;
    aba.eachRow((linha, i) => {
      if (i > 2 && String(linha.getCell(1).value) === mes && Number(linha.getCell(2).value) === ano) {
        achada = linha;
      }
    });
    return achada;
  }

  it("Mato Grosso mostra o GTA, nunca o federal", () => {
    const planilha = new ExcelJS.Workbook();
    abaAbate(planilha, gtaMt, sifMt);
    const linha = linhaDe(planilha.getWorksheet("Abate")!, "Agosto", 2026)!;
    expect(linha.getCell(3).value).toBe(254451); // MT fêmea — GTA
    expect(linha.getCell(4).value).toBe(356339); // MT macho — GTA
  });

  it("Goiás continua lendo do federal, que é a única fonte dele", () => {
    const planilha = new ExcelJS.Workbook();
    abaAbate(planilha, gtaMt, sifMt);
    const aba = planilha.getWorksheet("Abate")!;
    // A coluna de Goiás é achada pelo cabeçalho, não por número fixo:
    // esconder um estado desloca tudo à direita, e um índice cravado faria
    // este teste passar apontando para a coluna errada.
    const cabecalho = aba.getRow(1).values as unknown[];
    const coluna = cabecalho.findIndex((c) => String(c ?? "").startsWith("Goias"));
    const linha = linhaDe(aba, "Agosto", 2026)!;
    expect(linha.getCell(coluna).value).toBe(58692);
    expect(linha.getCell(coluna + 1).value).toBe(195712);
  });
});
