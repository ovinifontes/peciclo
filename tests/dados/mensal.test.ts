import { describe, expect, it } from "vitest";
import { competenciasDaJanela } from "../../src/dados/mensal.js";

describe("competenciasDaJanela", () => {
  it("devolve uma competência para janela dentro do mesmo mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-20", fim: "2026-07-26" })).toEqual([
      "2026-07-01",
    ]);
  });

  it("devolve as duas competências quando a janela cruza a virada do mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-28", fim: "2026-08-03" })).toEqual([
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("cobre a virada de ano", () => {
    expect(competenciasDaJanela({ inicio: "2026-12-30", fim: "2027-01-02" })).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});
