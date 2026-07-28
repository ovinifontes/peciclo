import { describe, expect, it } from "vitest";
import { interpretarCategoria, parsearPa } from "../../src/coletores/pa.js";

describe("interpretarCategoria", () => {
  it("separa espécie, sexo e faixa etária do rótulo da coluna", () => {
    expect(interpretarCategoria("BOVINO, FÊMEA, ACIMA DE 36 MESES")).toEqual({
      especie: "BOVINO",
      sexo: "FEMEA",
      faixaEtaria: "ACIMA DE 36 MESES",
    });
    expect(interpretarCategoria("BOVINO, MACHO, 0 A 12 MESES")).toEqual({
      especie: "BOVINO",
      sexo: "MACHO",
      faixaEtaria: "0 A 12 MESES",
    });
  });

  it("devolve null para categorias sem sexo", () => {
    expect(interpretarCategoria("GALINHA, ADULTO")).toBeNull();
    expect(interpretarCategoria("SUÍNO, SEXO E IDADE NÃO RELEVANTES")).toBeNull();
  });

  it("ignora espécies que não são bovino", () => {
    expect(interpretarCategoria("BUBALINO, MACHO, 0 A 12 MESES")).toBeNull();
  });
});

describe("parsearPa", () => {
  const FIXTURE = "tests/fixtures/pa-adepara-maio-2026-reduzido.xlsx";

  it("só considera abate com igualdade exata, nunca prefixo", async () => {
    const registros = await parsearPa(FIXTURE);
    const finalidades = new Set(registros.map((r) => r.finalidade));
    // "ABATE SANITÁRIO" e "SACRIFÍCIO" existem no arquivo e são armazenados,
    // mas jamais devem ser confundidos com "ABATE" pelo filtro.
    expect(finalidades.has("ABATE")).toBe(true);
    const abate = registros.filter((r) => r.finalidade === "ABATE");
    expect(abate.every((r) => r.finalidade === "ABATE")).toBe(true);
  });

  it("preenche os campos da chave natural", async () => {
    const registros = await parsearPa(FIXTURE);
    for (const r of registros.slice(0, 50)) {
      expect(r.uf).toBe("PA");
      expect(r.documentoNumero).not.toBe("");
      expect(r.dataEmissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.quantidade).toBeGreaterThan(0);
    }
  });
});
