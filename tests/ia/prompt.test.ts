import { describe, expect, it } from "vitest";
import type { Dossie } from "../../src/ia/dossie.js";
import { dossieParaTexto } from "../../src/ia/dossie.js";
import {
  sistemaCenario,
  sistemaResumo,
  usuarioCenario,
  usuarioCorrecao,
  usuarioResumo,
  usuarioResumoCorrecao,
} from "../../src/ia/prompt.js";

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

describe("usuarioCorrecao", () => {
  it("aponta os tokens reprovados e mantém o dossiê completo", () => {
    const p = usuarioCorrecao(dossie, ["152.596", "9,99"]);
    expect(p).toContain(dossieParaTexto(dossie)); // o dossiê vai de novo, inteiro
    expect(p).toContain("152.596");
    expect(p).toContain("9,99");
    expect(p).toMatch(/não estão no dossiê/i);
  });
});

describe("sistemaResumo", () => {
  it("fixa o formato curto e mantém as regras que protegem o produto", () => {
    const s = sistemaResumo();
    expect(s).toMatch(/somente os números do dossiê/i);
    expect(s).toMatch(/recomendação de compra ou venda/i);
    expect(s).toMatch(/6 linhas/);
    expect(s).toMatch(/700 caracteres/);
    expect(s).toMatch(/a decisão é sua/i); // proibida como frase de fecho
  });
});

describe("usuarioResumo", () => {
  it("embute o dossiê e o cenário completo como matéria-prima", () => {
    const p = usuarioResumo(dossie, "TEXTO COMPLETO DO DIA");
    expect(p).toContain(dossieParaTexto(dossie));
    expect(p).toContain("TEXTO COMPLETO DO DIA");
  });
});

describe("usuarioResumoCorrecao", () => {
  it("aponta os tokens reprovados e mantém dossiê e completo", () => {
    const p = usuarioResumoCorrecao(dossie, "TEXTO COMPLETO DO DIA", ["152.596"]);
    expect(p).toContain(dossieParaTexto(dossie));
    expect(p).toContain("TEXTO COMPLETO DO DIA");
    expect(p).toContain("152.596");
    expect(p).toMatch(/não estão no dossiê/i);
  });
});
