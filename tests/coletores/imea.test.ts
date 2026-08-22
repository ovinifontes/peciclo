import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extrairAbates,
  numeroDoRelatorio,
  parsearImea,
  type ItemTexto,
} from "../../src/coletores/imea.js";

describe("numeroDoRelatorio", () => {
  it("bate com os pontos conhecidos da série (n = meses desde jan/2024)", () => {
    expect(numeroDoRelatorio(2024, 1)).toBe(1);
    expect(numeroDoRelatorio(2026, 1)).toBe(25);
    expect(numeroDoRelatorio(2026, 7)).toBe(31);
  });

  it("cobre a virada de ano sem pular nem repetir número", () => {
    expect(numeroDoRelatorio(2025, 12)).toBe(24);
    expect(numeroDoRelatorio(2026, 12)).toBe(36);
    expect(numeroDoRelatorio(2027, 1)).toBe(37);
  });
});

// Itens como o pdf.js os entrega para o bloco "Abates / N° de cabeças" do
// relatório real: rótulos numa coluna, números noutra, pareados pelo y.
const blocoReal: ItemTexto[] = [
  { str: "608.829", x: 247, y: 672, pagina: 2 },
  { str: "346.689", x: 247, y: 639, pagina: 2 },
  { str: "263.140", x: 247, y: 607, pagina: 2 },
  { str: "Total", x: 55, y: 672, pagina: 2 },
  { str: "Fêmeas", x: 55, y: 607, pagina: 2 },
  { str: "Machos", x: 55, y: 639, pagina: 2 },
  // Ruído real da mesma página: quebra regional que NÃO nos interessa.
  { str: "58.136", x: 143, y: 500, pagina: 2 },
  { str: "Noroeste", x: 143, y: 480, pagina: 2 },
  // Ruído real de outra página: legenda de gráfico sem número pareável.
  { str: "Machos", x: 405, y: 387, pagina: 1 },
  { str: "Fêmeas", x: 454, y: 387, pagina: 1 },
];

describe("extrairAbates", () => {
  it("pareia rótulo e número pela linha (y), ignorando o ruído regional", () => {
    expect(extrairAbates(blocoReal)).toEqual({
      machos: 346_689,
      femeas: 263_140,
      total: 608_829,
    });
  });

  it("lança quando machos+fêmeas não bate com o total (parser calado é veneno)", () => {
    const soma_errada = blocoReal.map((i) =>
      i.str === "346.689" ? { ...i, str: "300.000" } : i,
    );
    expect(() => extrairAbates(soma_errada)).toThrow(/não bate/i);
  });

  it("tolera a divergência pequena do PRÓPRIO IMEA (jul/26 real: soma 609.829, total impresso 608.829)", () => {
    // O bloco real já carrega essa inconsistência de 1.000 cabeças — a quebra
    // regional do mesmo PDF soma 609.829, ou seja, o total de manchete é que
    // está errado na fonte. A regra dura é relativa (0,5%) para engolir isso
    // e ainda estourar em qualquer pareamento trocado (dezenas de milhares).
    expect(extrairAbates(blocoReal).total).toBe(608_829);
  });

  it("lança quando o total é implausível para o abate mensal de MT", () => {
    const minusculo = blocoReal.map((i) => {
      if (i.str === "608.829") return { ...i, str: "100.000" };
      if (i.str === "346.689") return { ...i, str: "60.000" };
      if (i.str === "263.140") return { ...i, str: "40.000" };
      return i;
    });
    expect(() => extrairAbates(minusculo)).toThrow(/implausível/i);
  });

  it("lança quando não encontra as três linhas", () => {
    expect(() => extrairAbates(blocoReal.filter((i) => i.str !== "Total"))).toThrow();
  });
});

describe("parsearImea (fixture real de jul/2026)", () => {
  it("extrai os números publicados pelo IMEA", async () => {
    const buffer = readFileSync(new URL("../fixtures/imea-jul-2026.pdf", import.meta.url));
    await expect(parsearImea(buffer)).resolves.toEqual({
      machos: 346_689,
      femeas: 263_140,
      total: 608_829,
    });
  });
});
