import { describe, expect, it } from "vitest";
import {
  formatarDataBr,
  normalizarSexos,
  parsearResultado,
} from "../../src/coletores/sigsif-diario.js";

/** Recorte do HTML real da resposta do PGA-SIGSIF (linhas Mês/UF/Espécie/Sexo/Qtd). */
const resposta = (linhas: Array<[string, string]>) =>
  `<table><tbody>${linhas
    .map(
      ([sexo, q]) =>
        `<tr><td>09/2026</td><td>RO</td><td>Bovino</td><td>${sexo}</td><td>${q}</td></tr>`,
    )
    .join("")}</tbody></table>`;

describe("parsearResultado", () => {
  it("lê fêmea e macho da tabela", () => {
    expect(parsearResultado(resposta([["Fêmea", "1612"], ["Macho", "1694"]]))).toEqual({
      "Fêmea": 1612,
      Macho: 1694,
    });
  });

  it("soma linhas repetidas do mesmo sexo", () => {
    // Um intervalo de vários meses devolve uma linha por mês; somar é o certo.
    expect(parsearResultado(resposta([["Macho", "100"], ["Macho", "50"]]))).toEqual({ Macho: 150 });
  });

  it("entende número com ponto de milhar", () => {
    expect(parsearResultado(resposta([["Fêmea", "12.345"]]))).toEqual({ "Fêmea": 12345 });
  });

  it("resposta sem tabela devolve vazio, não quebra", () => {
    expect(parsearResultado("<div>Nenhum registro encontrado</div>")).toEqual({});
  });
});

describe("normalizarSexos", () => {
  it("traduz os rótulos do MAPA para os do projeto", () => {
    expect(normalizarSexos({ "Fêmea": 10, Macho: 20 })).toEqual(
      expect.arrayContaining([
        { sexo: "FEMEA", quantidade: 10 },
        { sexo: "MACHO", quantidade: 20 },
      ]),
    );
  });

  it("descarta zero e rótulo desconhecido", () => {
    // Zero não é abate provado, é ausência — não vira linha no banco.
    expect(normalizarSexos({ "Fêmea": 0, Indefinido: 5 })).toEqual([]);
  });
});

describe("formatarDataBr", () => {
  it("converte ISO para o formato do formulário", () => {
    expect(formatarDataBr("2026-09-12")).toBe("12/09/2026");
  });
});
