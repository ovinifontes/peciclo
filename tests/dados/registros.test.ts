import { describe, expect, it } from "vitest";
import { deduplicar } from "../../src/dados/registros.js";
import type { RegistroGta } from "../../src/tipos.js";

const base: RegistroGta = {
  uf: "MS",
  documentoTipo: "GTA",
  documentoNumero: "123",
  documentoSerie: "A",
  dataEmissao: "2026-07-20",
  finalidade: "ABATE",
  sexo: "FEMEA",
  faixaEtaria: "13 A 24 MESES",
  quantidade: 10,
  municipioOrigem: "CAMPO GRANDE",
  municipioDestino: "DOURADOS",
  ufDestino: "MS",
};

describe("deduplicar", () => {
  it("soma quantidades de registros com a mesma chave natural", () => {
    const saida = deduplicar([base, { ...base, quantidade: 5 }]);
    expect(saida).toHaveLength(1);
    expect(saida[0]!.quantidade).toBe(15);
  });

  it("trata faixa nula como chave própria e não a mistura com outra faixa", () => {
    const saida = deduplicar([
      { ...base, faixaEtaria: null, quantidade: 3 },
      { ...base, faixaEtaria: null, quantidade: 4 },
      { ...base, faixaEtaria: "0 A 12 MESES", quantidade: 7 },
    ]);
    expect(saida).toHaveLength(2);
    expect(saida.find((r) => r.faixaEtaria === null)!.quantidade).toBe(7);
    expect(saida.find((r) => r.faixaEtaria === "0 A 12 MESES")!.quantidade).toBe(7);
  });

  it("mantém separados registros de sexos diferentes", () => {
    expect(deduplicar([base, { ...base, sexo: "MACHO" }])).toHaveLength(2);
  });
});
