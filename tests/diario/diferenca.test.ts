import { describe, expect, it } from "vitest";
import { calcularDiferencaDiaria } from "../../src/diario/diferenca.js";

describe("calcularDiferencaDiaria", () => {
  it("primeiro retrato (sem anterior) só ancora: nada gravado, nenhuma anomalia", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1000, MACHO: 1500 },
      anterior: null,
      capturadoEm: "2026-08-18",
    });
    expect(saida).toEqual({ agregados: [], anomalias: [] });
  });

  it("gap de 1 dia vira o dia do retrato ANTERIOR, por sexo, finalidade ABATE", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      anterior: { capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 1500 } },
      capturadoEm: "2026-08-18",
    });
    expect(saida.anomalias).toEqual([]);
    expect(saida.agregados).toEqual([
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "FEMEA", quantidade: 200 },
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "MACHO", quantidade: 400 },
    ]);
  });

  it("gap maior que 1 dia não grava nada e explica na anomalia", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      anterior: { capturadoEm: "2026-08-15", porSexo: { FEMEA: 1000, MACHO: 1500 } },
      capturadoEm: "2026-08-18",
    });
    expect(saida.agregados).toEqual([]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("3 dias");
    expect(saida.anomalias[0]).toContain("2026-08-15");
    expect(saida.anomalias[0]).toContain("2026-08-18");
  });

  it("diferença negativa num sexo vira 0 com anomalia; o outro sexo segue normal", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 900, MACHO: 1600 },
      anterior: { capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 1500 } },
      capturadoEm: "2026-08-18",
    });
    expect(saida.agregados).toEqual([
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "FEMEA", quantidade: 0 },
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "MACHO", quantidade: 100 },
    ]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("FEMEA");
    expect(saida.anomalias[0]).toContain("1000");
    expect(saida.anomalias[0]).toContain("900");
  });

  it("diferença zero grava 0 mesmo — feriado é dado, não ausência", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1000, MACHO: 1500 },
      anterior: { capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 1500 } },
      capturadoEm: "2026-08-18",
    });
    expect(saida.anomalias).toEqual([]);
    expect(saida.agregados).toEqual([
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "FEMEA", quantidade: 0 },
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "MACHO", quantidade: 0 },
    ]);
  });

  it("conta os dias por UTC: virada de mês e de ano ainda são gap de 1", () => {
    const viradaMes = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 10, MACHO: 20 },
      anterior: { capturadoEm: "2026-08-31", porSexo: { FEMEA: 5, MACHO: 10 } },
      capturadoEm: "2026-09-01",
    });
    expect(viradaMes.agregados.map((a) => a.data)).toEqual(["2026-08-31", "2026-08-31"]);

    const viradaAno = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 10, MACHO: 20 },
      anterior: { capturadoEm: "2026-12-31", porSexo: { FEMEA: 5, MACHO: 10 } },
      capturadoEm: "2027-01-01",
    });
    expect(viradaAno.anomalias).toEqual([]);
    expect(viradaAno.agregados).toHaveLength(2);
  });

  it("retrato anterior que não é anterior (gap <= 0) não grava nada e denuncia", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      anterior: { capturadoEm: "2026-08-19", porSexo: { FEMEA: 1000, MACHO: 1500 } },
      capturadoEm: "2026-08-18",
    });
    expect(saida.agregados).toEqual([]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("2026-08-19");
  });
});
