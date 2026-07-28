import { describe, expect, it } from "vitest";
import { chaveSegura } from "../../src/dados/arquivos.js";

describe("chaveSegura", () => {
  it("troca espaços e acentos por caracteres válidos, mantendo a pasta", () => {
    expect(chaveSegura("pa/GTAs Maio 2026 dados públicos.xlsx")).toBe(
      "pa/GTAs_Maio_2026_dados_publicos.xlsx",
    );
  });

  it("preserva caminhos que já são seguros", () => {
    expect(chaveSegura("ms/2026-07-25_a_2026-07-27.xlsx")).toBe("ms/2026-07-25_a_2026-07-27.xlsx");
  });

  it("remove acentos de Ê, Ç, Ã", () => {
    expect(chaveSegura("mt/relatório-condensação.xlsx")).toBe("mt/relatorio-condensacao.xlsx");
  });
});
