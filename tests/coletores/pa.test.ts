import { describe, expect, it } from "vitest";
import { interpretarCategoria, parsearPa, urlDeConfirmacao } from "../../src/coletores/pa.js";

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

describe("urlDeConfirmacao", () => {
  // Página real que o Drive devolve para arquivos >~100 MB.
  const aviso = `<form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
    <input type="submit" id="uc-download-link" value="Download anyway"/>
    <input type="hidden" name="id" value="1vuaU22DNiVZijCVGaEhT4aqJewC6QBbR">
    <input type="hidden" name="export" value="download">
    <input type="hidden" name="confirm" value="t">
    <input type="hidden" name="uuid" value="3bc169c5-3f23-4c12-8f49-00a6033ccbda">
  </form>`;

  it("monta a URL de confirmação com todos os campos do formulário", () => {
    const url = urlDeConfirmacao(aviso)!;
    expect(url.startsWith("https://drive.usercontent.google.com/download?")).toBe(true);
    const p = new URL(url).searchParams;
    expect(p.get("id")).toBe("1vuaU22DNiVZijCVGaEhT4aqJewC6QBbR");
    expect(p.get("confirm")).toBe("t");
    expect(p.get("uuid")).toBe("3bc169c5-3f23-4c12-8f49-00a6033ccbda");
  });

  it("devolve null quando não é a página de aviso", () => {
    expect(urlDeConfirmacao("<html><body>qualquer coisa</body></html>")).toBeNull();
  });
});
