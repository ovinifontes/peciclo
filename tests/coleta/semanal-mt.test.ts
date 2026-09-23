import { describe, expect, it } from "vitest";
import { diasDaJanela } from "../../src/trigger/coleta-semanal-mt.js";

describe("diasDaJanela", () => {
  it("olha para trás e nunca inclui o dia corrente", () => {
    // O dia de hoje ainda recebe guia: entraria parcial e ficaria parcial.
    const dias = diasDaJanela("2026-09-26").map((d) => d.dia);
    expect(dias).not.toContain("2026-09-26");
    expect(dias.at(-1)).toBe("2026-09-25");
    expect(dias[0]).toBe("2026-09-16");
    expect(dias).toHaveLength(10);
  });

  it("devolve do mais antigo para o mais recente", () => {
    const dias = diasDaJanela("2026-09-26").map((d) => d.dia);
    expect([...dias].sort()).toEqual(dias);
  });

  it("marca só os 3 dias mais recentes para refazer", () => {
    // GTA lançada com atraso faz o número do dia crescer depois dele; sem
    // refazer a ponta, o último dia de cada semana fica incompleto para sempre.
    const janela = diasDaJanela("2026-09-26");
    const refazer = janela.filter((d) => d.refazer).map((d) => d.dia);
    expect(refazer).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("não pede dia anterior ao portal novo", () => {
    // Antes de 07/08/2026 o dado vem do portal velho, com outro coletor.
    const dias = diasDaJanela("2026-08-12").map((d) => d.dia);
    expect(dias[0]).toBe("2026-08-07");
    expect(dias.every((d) => d >= "2026-08-07")).toBe(true);
  });

  it("devolve vazio quando a janela inteira é anterior ao portal novo", () => {
    expect(diasDaJanela("2026-08-01")).toEqual([]);
  });

  it("atravessa a virada de mês sem inventar dia", () => {
    const dias = diasDaJanela("2026-10-03").map((d) => d.dia);
    expect(dias).toContain("2026-09-30");
    expect(dias).toContain("2026-10-02");
    expect(dias).not.toContain("2026-09-31");
  });
});
