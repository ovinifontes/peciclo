import { describe, expect, it } from "vitest";
import { mapearCabecalho, serialParaDataISO, textoCelula } from "../../src/xlsx/leitor.js";

describe("serialParaDataISO", () => {
  it("converte serial do Excel para data ISO", () => {
    expect(serialParaDataISO(46223.1893043403)).toBe("2026-07-20");
    expect(serialParaDataISO(46228.2823954)).toBe("2026-07-25");
  });

  it("usa UTC: meia-noite não escorrega para o dia anterior", () => {
    // Com getters locais em America/Cuiaba (UTC-4) isto viraria 2026-07-25
    // e, na virada do mês, jogaria a GTA no mês errado.
    expect(serialParaDataISO(46229)).toBe("2026-07-26");
  });

  it("aceita Date já convertido", () => {
    expect(serialParaDataISO(new Date(Date.UTC(2026, 4, 1)))).toBe("2026-05-01");
  });
});

describe("mapearCabecalho", () => {
  it("usa a primeira ocorrência de cada rótulo (células mescladas repetem)", () => {
    const mapa = mapearCabecalho([
      undefined, "Tipo de Documento", "Tipo de Documento", "Número", "Número", "Série",
    ]);
    expect(mapa["Tipo de Documento"]).toBe(1);
    expect(mapa["Número"]).toBe(3);
    expect(mapa["Série"]).toBe(5);
  });
});

describe("textoCelula", () => {
  it("extrai texto de célula rich text", () => {
    expect(textoCelula({ richText: [{ text: "ABA" }, { text: "TE" }] })).toBe("ABATE");
  });

  it("normaliza espaços nas bordas", () => {
    expect(textoCelula("  BOVINO ")).toBe("BOVINO");
  });

  it("devolve string vazia para nulo", () => {
    expect(textoCelula(null)).toBe("");
    expect(textoCelula(undefined)).toBe("");
  });
});
