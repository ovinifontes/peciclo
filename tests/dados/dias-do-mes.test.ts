import { describe, expect, it } from "vitest";
import { diasDoMes } from "../../src/dados/mensal.js";

describe("diasDoMes", () => {
  it("dá 31 dias em janeiro e 30 em abril", () => {
    expect(diasDoMes(2026, 1)).toHaveLength(31);
    expect(diasDoMes(2026, 4)).toHaveLength(30);
  });

  it("acerta fevereiro bissexto e comum", () => {
    // É a régua da trava de completude: errar aqui faria um fevereiro completo
    // parecer furado, ou um furado passar por completo.
    expect(diasDoMes(2024, 2)).toHaveLength(29);
    expect(diasDoMes(2026, 2)).toHaveLength(28);
  });

  it("devolve ISO com zero à esquerda, em ordem", () => {
    const dias = diasDoMes(2026, 9);
    expect(dias[0]).toBe("2026-09-01");
    expect(dias.at(-1)).toBe("2026-09-30");
    expect([...dias].sort()).toEqual(dias);
  });
});
