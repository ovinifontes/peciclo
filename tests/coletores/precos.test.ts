import { describe, expect, it } from "vitest";
import {
  dataBrParaIso,
  dentroDaFaixa,
  numeroBr,
  parsearCepea,
  parsearFuturos,
} from "../../src/coletores/precos.js";

describe("numeroBr", () => {
  it("lê o formato brasileiro (ponto de milhar, vírgula decimal)", () => {
    expect(numeroBr("3.377,23")).toBe(3377.23);
    expect(numeroBr("R$ 346,55")).toBe(346.55);
    expect(numeroBr("356")).toBe(356);
  });
});

describe("dataBrParaIso", () => {
  it("converte dd/mm/aaaa em ISO", () => {
    expect(dataBrParaIso("31/07/2026")).toBe("2026-07-31");
  });
  it("recusa competência mensal (07/2026), que não é um dia", () => {
    expect(dataBrParaIso("07/2026")).toBeNull();
  });
});

describe("parsearCepea", () => {
  // Trecho real do widget do CEPEA.
  const widget = `document.write(\`<table>
    <tr><th>Data</th><th>Produto</th><th>Valor</th></tr>
    <tr><td>31/07/2026</td><td>Boi Gordo <span class="unidade">@</span></td><td>R$ 346,55</td></tr>
    <tr><td>31/07/2026</td><td>Bezerro - MS <span class="unidade">cabeça</span></td><td>R$ 3.377,23</td></tr>
    <tr><td>31/07/2026</td><td>Café Arábica <span class="unidade">sc</span></td><td>R$ 1.744,18</td></tr>
    <tr><td>07/2026</td><td>Açúcar - PE <span class="unidade">sc</span></td><td>R$ 125,77</td></tr>
  </table>\`)`;

  it("extrai boi gordo e bezerro casando pelo rótulo, não por posição", () => {
    const precos = parsearCepea(widget);
    const boi = precos.find((p) => p.serie === "boi_gordo")!;
    const bezerro = precos.find((p) => p.serie === "bezerro_ms")!;
    expect(boi.valor).toBe(346.55);
    expect(boi.unidade).toBe("R$/@");
    expect(bezerro.valor).toBe(3377.23);
    expect(boi.data).toBe("2026-07-31");
  });

  it("ignora produtos que não interessam e linhas de competência mensal", () => {
    const series = parsearCepea(widget).map((p) => p.serie);
    expect(series).not.toContain("cafe");
    expect(parsearCepea(widget).every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.data))).toBe(true);
  });
});

describe("parsearFuturos", () => {
  const html = `<table>
    <tr><th>Contrato - Mês</th><th>Fechamento (R$/@)</th><th>Variação (%)</th></tr>
    <tr><td>Agosto/2026</td><td>340,75</td><td>-1,96</td></tr>
    <tr><td>Dezembro/2026</td><td>356,00</td><td>-1,66</td></tr>
    <tr><td>31/07/2026</td><td>346,55</td><td>-0,10</td></tr>
  </table>`;

  it("extrai só as linhas de contrato futuro", () => {
    const futuros = parsearFuturos(html);
    expect(futuros).toHaveLength(2);
    expect(futuros[0]).toEqual({ contrato: "Agosto/2026", fechamento: 340.75 });
    // a linha de data (à vista) não é contrato
    expect(futuros.some((f) => f.contrato.includes("/07/"))).toBe(false);
  });
});

describe("dentroDaFaixa", () => {
  it("aceita valores plausíveis", () => {
    expect(dentroDaFaixa({ serie: "boi_gordo", data: "2026-07-31", valor: 346.55, unidade: "R$/@", fonte: "CEPEA" })).toBe(true);
    expect(dentroDaFaixa({ serie: "bezerro_ms", data: "2026-07-31", valor: 3377, unidade: "R$", fonte: "CEPEA" })).toBe(true);
  });

  it("barra valores absurdos, que contaminariam a relação de troca", () => {
    expect(dentroDaFaixa({ serie: "boi_gordo", data: "2026-07-31", valor: 34655, unidade: "R$/@", fonte: "CEPEA" })).toBe(false);
    expect(dentroDaFaixa({ serie: "bezerro_ms", data: "2026-07-31", valor: 33, unidade: "R$", fonte: "CEPEA" })).toBe(false);
  });
});
