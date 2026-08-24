import { describe, expect, it } from "vitest";
import { calcularDiferencaDiaria } from "../../src/diario/diferenca.js";

/** Atalho: retrato com o total repartido entre os sexos. */
const retrato = (capturadoEm: string, FEMEA: number, MACHO: number) => ({
  capturadoEm,
  porSexo: { FEMEA, MACHO },
});

/**
 * O fim de semana real de 22-24/08/2026 no painel da IDARON: sexta publica,
 * sábado/domingo/segunda congelam no mesmo acumulado, terça anda de novo.
 */
const SEMANA_REAL = [
  retrato("2026-08-20", 60_000, 78_940), // 138.940
  retrato("2026-08-21", 63_000, 84_569), // 147.569
  retrato("2026-08-22", 66_000, 90_470), // 156.470
  retrato("2026-08-23", 66_000, 90_470), // congelado
  retrato("2026-08-24", 66_000, 90_470), // congelado
];

describe("calcularDiferencaDiaria", () => {
  it("sem histórico o retrato de hoje só ancora: nada gravado, nenhuma anomalia", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1000, MACHO: 1500 },
      historico: [],
      capturadoEm: "2026-08-18",
    });
    expect(saida).toEqual({ agregados: [], anomalias: [] });
  });

  it("histórico só com retratos que não são anteriores também apenas ancora", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      historico: [retrato("2026-08-18", 1000, 1500), retrato("2026-08-19", 1100, 1600)],
      capturadoEm: "2026-08-18",
    });
    expect(saida).toEqual({ agregados: [], anomalias: [] });
  });

  it("acumulado que andou 1 dia vira o dia do último retrato, por sexo, ABATE", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      historico: [retrato("2026-08-16", 800, 1200), retrato("2026-08-17", 1000, 1500)],
      capturadoEm: "2026-08-18",
    });
    expect(saida.anomalias).toEqual([]);
    expect(saida.agregados).toEqual([
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "FEMEA", quantidade: 200 },
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "MACHO", quantidade: 400 },
    ]);
  });

  it("FIM DE SEMANA: acumulado parado não grava zero — grava NADA e denuncia", () => {
    const saida = calcularDiferencaDiaria({
      // Domingo lendo o mesmo acumulado de sábado.
      snapshotHoje: { FEMEA: 66_000, MACHO: 90_470 },
      historico: SEMANA_REAL.slice(0, 3),
      capturadoEm: "2026-08-23",
    });
    // Zero seria a afirmação "RO não abateu" — e RO abate ~8 mil/dia.
    expect(saida.agregados).toEqual([]);
    expect(saida.agregados.some((a) => a.quantidade === 0)).toBe(false);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("parado");
    expect(saida.anomalias[0]).toContain("156470");
    expect(saida.anomalias[0]).toContain("2026-08-22");
  });

  it("TERÇA APÓS O FERIADÃO: o ganho cobre 3 dias, então não vira ponto nenhum", () => {
    const saida = calcularDiferencaDiaria({
      // 165.000: o painel voltou a publicar e despejou o acumulado dos 3 dias.
      snapshotHoje: { FEMEA: 69_000, MACHO: 96_000 },
      historico: SEMANA_REAL,
      capturadoEm: "2026-08-25",
    });
    expect(saida.agregados).toEqual([]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("8530"); // 165.000 − 156.470
    expect(saida.anomalias[0]).toContain("3 dias");
    expect(saida.anomalias[0]).toContain("2026-08-22"); // última publicação de verdade
    expect(saida.anomalias[0]).toContain("2026-08-25");
  });

  it("buraco de coleta (retrato faltando) também cobre mais de 1 dia: nada gravado", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 1200, MACHO: 1900 },
      historico: [retrato("2026-08-15", 1000, 1500)],
      capturadoEm: "2026-08-18",
    });
    expect(saida.agregados).toEqual([]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("3 dias");
    expect(saida.anomalias[0]).toContain("2026-08-15");
  });

  it("acumulado que caiu (painel corrigiu para baixo) não grava nada e denuncia", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 900, MACHO: 1400 },
      historico: [retrato("2026-08-17", 1000, 1500)],
      capturadoEm: "2026-08-18",
    });
    expect(saida.agregados).toEqual([]);
    expect(saida.anomalias).toHaveLength(1);
    expect(saida.anomalias[0]).toContain("2500");
    expect(saida.anomalias[0]).toContain("2300");
  });

  it("um sexo isolado caindo enquanto o total sobe: aquele sexo vira 0, o dia vale", () => {
    const saida = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 900, MACHO: 1700 },
      historico: [retrato("2026-08-17", 1000, 1500)],
      capturadoEm: "2026-08-18",
    });
    expect(saida.anomalias).toEqual([]);
    expect(saida.agregados).toEqual([
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "FEMEA", quantidade: 0 },
      { uf: "RO", data: "2026-08-17", finalidade: "ABATE", sexo: "MACHO", quantidade: 200 },
    ]);
  });

  it("conta os dias por UTC: virada de mês e de ano ainda são gap de 1", () => {
    const viradaMes = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 10, MACHO: 20 },
      historico: [retrato("2026-08-31", 5, 10)],
      capturadoEm: "2026-09-01",
    });
    expect(viradaMes.agregados.map((a) => a.data)).toEqual(["2026-08-31", "2026-08-31"]);

    const viradaAno = calcularDiferencaDiaria({
      snapshotHoje: { FEMEA: 10, MACHO: 20 },
      historico: [retrato("2026-12-31", 5, 10)],
      capturadoEm: "2027-01-01",
    });
    expect(viradaAno.anomalias).toEqual([]);
    expect(viradaAno.agregados).toHaveLength(2);
  });
});
