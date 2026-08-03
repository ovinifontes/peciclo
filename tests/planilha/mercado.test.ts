import { describe, expect, it } from "vitest";
import { calcularPremioFuturos, calcularRelacaoTroca, ultimoPreco } from "../../src/planilha/mercado.js";
import type { LinhaPreco } from "../../src/dados/experimental.js";

const precos: LinhaPreco[] = [
  { serie: "boi_gordo", data: "2026-07-31", valor: 346.55, unidade: "R$/@" },
  { serie: "bezerro_ms", data: "2026-07-31", valor: 3377.23, unidade: "R$/cabeça" },
  { serie: "boi_gordo", data: "2026-07-30", valor: 346.90, unidade: "R$/@" },
  { serie: "bezerro_ms", data: "2026-07-30", valor: 3377.68, unidade: "R$/cabeça" },
  { serie: "boi_gordo", data: "2026-07-29", valor: 347.00, unidade: "R$/@" },
];

describe("calcularRelacaoTroca", () => {
  it("calcula arrobas por bezerro apenas nos dias com as duas séries", () => {
    const rel = calcularRelacaoTroca(precos);
    expect(rel).toHaveLength(2); // 29/07 tem só boi, fica de fora
    expect(rel[0]!.data).toBe("2026-07-31");
    expect(rel[0]!.arrobasPorBezerro).toBeCloseTo(9.75, 2); // 3377.23 / 346.55
  });

  it("ordena do mais recente para o mais antigo", () => {
    const rel = calcularRelacaoTroca(precos);
    expect(rel[0]!.data > rel[1]!.data).toBe(true);
  });
});

describe("calcularPremioFuturos", () => {
  it("calcula o prêmio do futuro sobre o à vista", () => {
    const p = calcularPremioFuturos([{ contrato: "Dezembro/2026", fechamento: 356 }], 346.55);
    expect(p[0]!.premioPct).toBeCloseTo(2.73, 1); // (356-346.55)/346.55
  });

  it("devolve prêmio nulo quando não há preço à vista", () => {
    const p = calcularPremioFuturos([{ contrato: "Dezembro/2026", fechamento: 356 }], null);
    expect(p[0]!.premioPct).toBeNull();
  });
});

describe("ultimoPreco", () => {
  it("pega o mais recente da série", () => {
    expect(ultimoPreco(precos, "boi_gordo")!.data).toBe("2026-07-31");
    expect(ultimoPreco(precos, "inexistente")).toBeNull();
  });
});
