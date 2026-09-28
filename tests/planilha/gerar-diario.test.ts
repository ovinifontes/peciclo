import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { escreverAbaDiaria, letraColuna, montarGradeDiaria } from "../../src/planilha/gerar-diario.js";
import type { DiaUf } from "../../src/diario/serie.js";

function dia(data: string, uf: "MT" | "MS" | "RO", femeas: number, machos: number): DiaUf {
  const total = femeas + machos;
  return { uf, data, femeas, machos, total, pctFemeas: total ? (femeas / total) * 100 : null, ambosSexos: true };
}

describe("montarGradeDiaria", () => {
  it("põe o dia mais recente em cima", () => {
    const grade = montarGradeDiaria([
      dia("2026-09-01", "MT", 10, 10),
      dia("2026-09-03", "MT", 30, 10),
      dia("2026-09-02", "MT", 20, 10),
    ]);
    expect(grade.linhas.map((l) => l.data)).toEqual(["2026-09-03", "2026-09-02", "2026-09-01"]);
  });

  it("deixa de fora o estado sem nenhum dia — coluna vazia é mobília", () => {
    const grade = montarGradeDiaria([dia("2026-09-01", "MT", 10, 10)]);
    expect(grade.ufs).toEqual(["MT"]);
  });

  it("mantém a ordem de UFS_VISIVEIS, não a de chegada", () => {
    const grade = montarGradeDiaria([
      dia("2026-09-01", "RO", 1, 1),
      dia("2026-09-01", "MT", 1, 1),
    ]);
    expect(grade.ufs).toEqual(["MT", "RO"]);
  });

  it("dia sem linha de um estado vira null, nunca zero", () => {
    const grade = montarGradeDiaria([
      dia("2026-09-01", "MT", 10, 10),
      dia("2026-09-01", "MS", 5, 5),
      dia("2026-09-02", "MT", 20, 10),
    ]);
    const maisRecente = grade.linhas[0]!;
    // ordem: MT fêmeas, machos, total | MS fêmeas, machos, total
    expect(maisRecente.valores).toEqual([20, 10, 30, null, null, null]);
  });
});

describe("letraColuna", () => {
  it("converte índice em letra do Excel", () => {
    expect(letraColuna(1)).toBe("A");
    expect(letraColuna(26)).toBe("Z");
    expect(letraColuna(27)).toBe("AA");
    expect(letraColuna(28)).toBe("AB");
  });
});

describe("escreverAbaDiaria", () => {
  it("escreve a % como fórmula sobre as colunas certas", async () => {
    const planilha = new ExcelJS.Workbook();
    const grade = montarGradeDiaria([
      dia("2026-09-02", "MT", 20, 10),
      dia("2026-09-01", "MT", 10, 10),
    ]);
    escreverAbaDiaria(planilha, grade);
    const aba = planilha.getWorksheet("Abate diário")!;
    // MT ocupa C (fêmeas), D (machos), E (total) e F (% fêmeas), sob o
    // rótulo "MT" mesclado na primeira linha.
    expect(aba.getCell(1, 3).value).toBe("MT");
    expect(aba.getCell(2, 6).value).toBe("% Fêmeas");
    expect(aba.getCell(3, 6).value).toMatchObject({ formula: 'IFERROR(C3/E3,"")' });
    expect(aba.getCell(3, 3).value).toBe(20);
    expect(aba.getCell(3, 5).value).toBe(30);
  });
});
