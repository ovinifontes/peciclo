import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { montarGradeDados } from "../../src/planilha/gerar.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

const dados: LinhaMensal[] = [
  { uf: "MT", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 333650 },
  { uf: "MT", ano: 2025, mes: 1, sexo: "MACHO", quantidade: 288211 },
  { uf: "MS", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 185419 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "FEMEA", quantidade: 188406 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "MACHO", quantidade: 152453 },
];

describe("montarGradeDados", () => {
  it("preserva a ordem de colunas da planilha original, com GO e SP vazios", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.cabecalhoEstados).toEqual([
      "Mato Grosso", "Mato Grosso do Sul", "Rondonia", "Pará", "Goias", "São Paulo",
    ]);
    expect(grade.cabecalhoSexos).toHaveLength(12);
  });

  it("posiciona cada valor na célula certa", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const jan2025 = grade.linhas.find((l) => l.ano === 2025 && l.mes === 1)!;
    expect(jan2025.rotuloMes).toBe("Janeiro");
    expect(jan2025.valores[0]).toBe(333650); // MT fêmea
    expect(jan2025.valores[1]).toBe(288211); // MT macho
    expect(jan2025.valores[2]).toBe(185419); // MS fêmea
    expect(jan2025.valores[3]).toBeNull();   // MS macho ausente
    expect(jan2025.valores[8]).toBeNull();   // Goiás fêmea, sempre vazio
  });

  it("gera todos os meses do intervalo, mesmo sem dados", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.linhas).toHaveLength(24);
    expect(grade.linhas[23]!.rotuloMes).toBe("Dezembro");
    expect(grade.linhas[23]!.ano).toBe(2026);
  });

  it("coloca o valor do PA de maio/2026 na posição correta", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const maio = grade.linhas.find((l) => l.ano === 2026 && l.mes === 5)!;
    expect(maio.valores[6]).toBe(188406); // PA fêmea
    expect(maio.valores[7]).toBe(152453); // PA macho
  });
});
