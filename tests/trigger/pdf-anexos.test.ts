import { describe, expect, it } from "vitest";
import { dimensoesPng, montarHtmlDoPdf } from "../../src/trigger/enviar-diario-anexos.js";

/** Cabeçalho de PNG de verdade: assinatura + IHDR com largura e altura. */
function pngFalso(largura: number, altura: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

describe("dimensoesPng", () => {
  it("lê largura e altura do IHDR", () => {
    expect(dimensoesPng(pngFalso(2160, 4204))).toEqual({ largura: 2160, altura: 4204 });
  });

  it("recusa buffer que não é PNG em vez de devolver lixo", () => {
    expect(() => dimensoesPng(Buffer.from("isto não é um png"))).toThrow(/IHDR/);
  });
});

describe("montarHtmlDoPdf", () => {
  it("dimensiona a folha pela imagem MAIS ALTA — nenhuma pode transbordar", () => {
    // 2160×4204 e 2160×4600: em 1080 de largura viram 2102 e 2300 de altura.
    const { largura, altura } = montarHtmlDoPdf([pngFalso(2160, 4204), pngFalso(2160, 4600)]);
    expect(largura).toBe(1080);
    expect(altura).toBe(2300);
  });

  it("gera uma folha por imagem e solta a quebra na última", () => {
    const { html } = montarHtmlDoPdf([pngFalso(100, 100), pngFalso(100, 100)]);
    expect(html.match(/class="folha"/g)).toHaveLength(2);
    expect(html).toContain(".folha:last-child{break-after:auto}");
  });

  it("recusa PDF sem página", () => {
    expect(() => montarHtmlDoPdf([])).toThrow(/sem nenhuma página/);
  });
});
