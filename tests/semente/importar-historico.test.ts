import { describe, expect, it } from "vitest";
import { lerCsvHistorico } from "../../src/semente/importar-historico.js";

const CSV = "referencias/planilha-abate-2025-2026.csv";

describe("lerCsvHistorico", () => {
  it("lê os valores de um mês completo", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const mtJan = linhas.filter((l) => l.uf === "MT" && l.ano === 2025 && l.mes === 1);
    expect(mtJan.find((l) => l.sexo === "FEMEA")!.quantidade).toBe(333650);
    expect(mtJan.find((l) => l.sexo === "MACHO")!.quantidade).toBe(288211);
  });

  it("normaliza o separador de milhar de MS fev/2025", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const msFev = linhas.find(
      (l) => l.uf === "MS" && l.ano === 2025 && l.mes === 2 && l.sexo === "FEMEA",
    );
    // A célula está gravada como texto "186.830" ao contrário de todas as outras.
    expect(msFev!.quantidade).toBe(186830);
  });

  it("corrige as colunas invertidas de PA jul/2025", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const paJul = linhas.filter((l) => l.uf === "PA" && l.ano === 2025 && l.mes === 7);
    // No CSV está fêmea 86.612 e macho 138.294, invertido em relação a todos
    // os outros meses do estado. O sócio confirmou que foi erro de cópia.
    expect(paJul.find((l) => l.sexo === "FEMEA")!.quantidade).toBe(138294);
    expect(paJul.find((l) => l.sexo === "MACHO")!.quantidade).toBe(86612);
  });

  it("ignora meses vazios e as colunas de GO e SP", async () => {
    const linhas = await lerCsvHistorico(CSV);
    expect(linhas.some((l) => l.ano === 2026 && l.mes === 12)).toBe(false);
    expect(linhas.every((l) => ["MT", "MS", "RO", "PA"].includes(l.uf))).toBe(true);
  });
});
