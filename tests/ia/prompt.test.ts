import { describe, expect, it } from "vitest";
import type { Dossie } from "../../src/ia/dossie.js";
import { dossieParaTexto } from "../../src/ia/dossie.js";
import { sistemaCenario, usuarioCenario } from "../../src/ia/prompt.js";

const dossie: Dossie = {
  geradoEm: "2026-08-06",
  ciclo: { fase: "retencao", competencia: { ano: 2026, mes: 6 }, pctFemeas: 0.4984, yoyMm3Pp: -4.17, mesesNaDirecao: 4 },
  serie: [],
  precos: [{ serie: "boi_gordo", data: "2026-08-05", valor: 350.2 }],
  variacaoBoiDia: null,
  futuros: [],
  relacaoTroca: null,
  estadosPainel: "MT + MS + RO",
};

describe("sistemaCenario", () => {
  it("fixa as regras que protegem o produto", () => {
    const s = sistemaCenario();
    expect(s).toMatch(/somente os números do dossiê/i);
    expect(s).toMatch(/recomendação de compra ou venda/i);
    expect(s).toMatch(/8 a 12 linhas/);
  });
});

describe("usuarioCenario", () => {
  it("embute o dossiê serializado por dossieParaTexto", () => {
    expect(usuarioCenario(dossie)).toContain(dossieParaTexto(dossie));
  });
});
