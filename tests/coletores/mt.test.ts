import { describe, expect, it } from "vitest";
import { formatarDataBr, parsearMt, sessaoExpirada } from "../../src/coletores/mt.js";

describe("formatarDataBr", () => {
  it("converte ISO para dd/MM/yyyy", () => {
    expect(formatarDataBr("2026-07-20")).toBe("20/07/2026");
    expect(formatarDataBr("2026-01-05")).toBe("05/01/2026");
  });
});

describe("sessaoExpirada", () => {
  it("detecta que a resposta é a tela de login", () => {
    expect(sessaoExpirada('<form name="login" action="Login.action"><input name="senha"></form>')).toBe(true);
    expect(sessaoExpirada("<table><tr><td>BOVINO</td></tr></table>")).toBe(false);
  });
});

describe("parsearMt", () => {
  const FIXTURE = "tests/fixtures/mt-indea-2026-07-20.xlsx";

  it("agrega abate bovino por mês e sexo com os totais reais do arquivo", async () => {
    const agregados = await parsearMt(FIXTURE);
    const abate = agregados.filter((a) => a.finalidade === "ABATE");

    const femea = abate.find((a) => a.sexo === "FEMEA");
    const macho = abate.find((a) => a.sexo === "MACHO");

    // Medido no arquivo real (20/07/2026): F=11365, M=14930.
    expect(femea?.quantidade).toBe(11365);
    expect(macho?.quantidade).toBe(14930);
    expect(femea?.ano).toBe(2026);
    expect(femea?.mes).toBe(7);
    expect(femea?.uf).toBe("MT");
  });

  it("usa igualdade exata: não confunde ABATE com RETORNO DE ABATEDOURO", async () => {
    const agregados = await parsearMt(FIXTURE);
    const finalidades = new Set(agregados.map((a) => a.finalidade));
    expect(finalidades.has("ABATE")).toBe(true);
    // Se houvesse contaminação por prefixo, o total de ABATE mudaria.
    const abateFemea = agregados.find((a) => a.finalidade === "ABATE" && a.sexo === "FEMEA");
    expect(abateFemea?.quantidade).toBe(11365);
  });

  it("ignora o sexo 'A' (sem sexo) e espécies não bovinas", async () => {
    const agregados = await parsearMt(FIXTURE);
    expect(agregados.every((a) => a.sexo === "MACHO" || a.sexo === "FEMEA")).toBe(true);
  });

  it("preserva acentos apesar do content-type ISO-8859-1 da resposta HTTP", async () => {
    const agregados = await parsearMt(FIXTURE);
    // O arquivo é XLSX (UTF-8 interno); se houvesse corrupção apareceria o �.
    expect(agregados.every((a) => !a.finalidade.includes("�"))).toBe(true);
  });
});
