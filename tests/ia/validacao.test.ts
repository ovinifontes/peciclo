import { describe, expect, it } from "vitest";
import type { Dossie } from "../../src/ia/dossie.js";
import { validarTexto, valoresPermitidos } from "../../src/ia/validacao.js";
import type { PontoCiclo } from "../../src/ciclo/leitura.js";

function ponto(ano: number, mes: number, pctFemeas: number): PontoCiclo {
  const total = 300_000;
  const femeas = Math.round(total * pctFemeas);
  return { ano, mes, femeas, machos: total - femeas, total, pctFemeas };
}

/** Dossiê de referência: retenção em junho/2026, boi a 350,20, bezerro a 3.369,17. */
const dossie: Dossie = {
  geradoEm: "2026-08-06",
  ciclo: {
    fase: "retencao",
    competencia: { ano: 2026, mes: 6 },
    pctFemeas: 0.4984,
    yoyMm3Pp: -4.17,
    mesesNaDirecao: 4,
  },
  serie: [ponto(2026, 4, 0.51), ponto(2026, 5, 0.5042), ponto(2026, 6, 0.4984)],
  precos: [
    { serie: "boi_gordo", data: "2026-08-05", valor: 350.2 },
    { serie: "bezerro_ms", data: "2026-08-05", valor: 3369.17 },
  ],
  variacaoBoiDia: -1.3,
  futuros: [{ vencimento: "out/26", preco: 348.5 }],
  relacaoTroca: 3369.17 / 350.2, // ≈ 9,6207
  estadosPainel: "MT + MS + RO",
};

describe("valoresPermitidos", () => {
  it("reúne percentuais, preços, variações, relação de troca e futuros", () => {
    const valores = valoresPermitidos(dossie);
    expect(valores).toContain(49.84); // pctFemeas*100
    expect(valores).toContain(-4.17); // yoyMm3Pp
    expect(valores).toContain(4.17); // e o valor absoluto
    expect(valores).toContain(4); // mesesNaDirecao
    expect(valores).toContain(350.2);
    expect(valores).toContain(3369.17);
    expect(valores).toContain(-1.3);
    expect(valores).toContain(1.3);
    expect(valores).toContain(348.5);
    expect(valores).toContain(2026); // ano da competência
  });

  it("campos null não viram NaN na lista", () => {
    const vazio: Dossie = {
      ...dossie,
      ciclo: { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 },
      serie: [],
      precos: [],
      variacaoBoiDia: null,
      futuros: [],
      relacaoTroca: null,
    };
    expect(valoresPermitidos(vazio).every(Number.isFinite)).toBe(true);
  });
});

describe("validarTexto", () => {
  it("aprova texto fiel ao dossiê (49,8%, R$ 350,20, 9,62 @, −4,17 p.p.)", () => {
    const texto =
      "A participação de fêmeas ficou em 49,8%, recuo de −4,17 p.p. no ano. " +
      "O boi gordo fechou a R$ 350,20 e a relação de troca está em 9,62 arrobas por bezerro.";
    expect(validarTexto(texto, dossie)).toEqual({ ok: true, invalidos: [] });
  });

  it("reprova número que não está no dossiê e o lista como aparece no texto", () => {
    const r = validarTexto("O abate somou 152.596 cabeças em junho.", dossie);
    expect(r.ok).toBe(false);
    expect(r.invalidos).toEqual(["152.596"]);
  });

  it("aprova a variação sem sinal (queda de 4,17 p.p.)", () => {
    expect(validarTexto("Queda de 4,17 p.p. na comparação anual.", dossie).ok).toBe(true);
  });

  it("isenta datas, vencimentos, contagens pequenas e horários", () => {
    const texto = "Em 04/08/2026 e no vencimento out/26, há 4 meses o quadro se repete; atualizado às 06:45 e às 18:30.";
    expect(validarTexto(texto, dossie).ok).toBe(true);
  });

  it("aprova arredondamento na casa do token (50% com pctFemeas 0,4984)", () => {
    expect(validarTexto("Praticamente 50% de fêmeas no abate.", dossie).ok).toBe(true);
  });

  it("aprova preço com milhar pt-BR (R$ 3.369,17)", () => {
    expect(validarTexto("O bezerro em MS vale R$ 3.369,17.", dossie).ok).toBe(true);
  });

  it("valida número entre parênteses normalmente (não é isenção)", () => {
    expect(validarTexto("A relação de troca (9,62) segue alta.", dossie).ok).toBe(true);
    const r = validarTexto("A relação de troca (77,77) segue alta.", dossie);
    expect(r.invalidos).toEqual(["77,77"]);
  });

  it("13 fica fora da isenção de inteiros pequenos", () => {
    const r = validarTexto("Há 13 meses o movimento se mantém.", dossie);
    expect(r.invalidos).toEqual(["13"]);
  });

  it("ano fora de 1900–2100 não é isento", () => {
    expect(validarTexto("Desde 1899 não se via isso.", dossie).invalidos).toEqual(["1899"]);
    expect(validarTexto("O rebanho de 1995 era outro.", dossie).ok).toBe(true);
  });

  it("lista todos os tokens reprovados, na ordem do texto", () => {
    const r = validarTexto("Foram 500 mil cabeças e alta de 22,5% no trimestre.", dossie);
    expect(r.invalidos).toEqual(["500", "22,5"]);
  });

  it("texto sem número nenhum passa", () => {
    expect(validarTexto("A retenção de fêmeas segue firme no consolidado.", dossie).ok).toBe(true);
  });
});
