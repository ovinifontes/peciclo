import { describe, expect, it } from "vitest";
import type { Dossie } from "../../src/ia/dossie.js";
import { textoReserva } from "../../src/ia/reserva.js";
import { validarTexto } from "../../src/ia/validacao.js";
import type { FaseCiclo, PontoCiclo } from "../../src/ciclo/leitura.js";

function ponto(ano: number, mes: number, pctFemeas: number): PontoCiclo {
  const total = 300_000;
  const femeas = Math.round(total * pctFemeas);
  return { ano, mes, femeas, machos: total - femeas, total, pctFemeas };
}

function dossieDaFase(fase: FaseCiclo, pctFemeas: number, yoyMm3Pp: number): Dossie {
  return {
    geradoEm: "2026-08-06",
    ciclo: { fase, competencia: { ano: 2026, mes: 6 }, pctFemeas, yoyMm3Pp, mesesNaDirecao: 4 },
    serie: [ponto(2026, 5, 0.5042), ponto(2026, 6, pctFemeas)],
    precos: [
      { serie: "boi_gordo", data: "2026-08-05", valor: 350.2 },
      { serie: "bezerro_ms", data: "2026-08-05", valor: 3369.17 },
    ],
    variacaoBoiDia: -1.3,
    futuros: [{ vencimento: "out/26", preco: 348.5 }],
    relacaoTroca: 3369.17 / 350.2,
    estadosPainel: "MT + MS + RO",
  };
}

describe("textoReserva", () => {
  it("retenção: cita a fase, a competência e os números do dossiê", () => {
    const texto = textoReserva(dossieDaFase("retencao", 0.4984, -4.17));
    expect(texto).toContain("retenção");
    expect(texto).toContain("junho de 2026");
    expect(texto).toContain("49,84");
    expect(texto).toContain("4,17");
    expect(texto).toContain("350,20");
    expect(texto).toContain("05/08/2026"); // preço datado
    expect(texto).toContain("9,62"); // relação de troca
  });

  it("liquidação: fase e números corretos", () => {
    const texto = textoReserva(dossieDaFase("liquidacao", 0.5423, 3.05));
    expect(texto).toContain("liquidação");
    expect(texto).toContain("54,23");
    expect(texto).toContain("3,05");
  });

  it("transição: fase e números corretos", () => {
    const texto = textoReserva(dossieDaFase("transicao", 0.5101, 0.42));
    expect(texto).toContain("transição");
    expect(texto).toContain("51,01");
  });

  it("todo número citado passa na própria validação (o texto de reserva nunca inventa)", () => {
    for (const [fase, pct, yoy] of [["retencao", 0.4984, -4.17], ["liquidacao", 0.5423, 3.05], ["transicao", 0.5101, 0.42]] as const) {
      const d = dossieDaFase(fase, pct, yoy);
      expect(validarTexto(textoReserva(d), d)).toEqual({ ok: true, invalidos: [] });
    }
  });

  it("sem dados de mercado nem leitura, não escreve undefined, NaN ou null", () => {
    const d: Dossie = {
      geradoEm: "2026-08-06",
      ciclo: { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 },
      serie: [],
      precos: [],
      variacaoBoiDia: null,
      futuros: [],
      relacaoTroca: null,
      estadosPainel: "MT + MS + RO",
    };
    const texto = textoReserva(d);
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("NaN");
    expect(texto).not.toContain("null");
    expect(texto.length).toBeGreaterThan(0);
  });

  it("tem o tamanho de um resumo (~8 linhas), não de um tuíte nem de um relatório", () => {
    const linhas = textoReserva(dossieDaFase("retencao", 0.4984, -4.17)).split("\n").filter((l) => l.trim() !== "");
    expect(linhas.length).toBeGreaterThanOrEqual(5);
    expect(linhas.length).toBeLessThanOrEqual(12);
  });
});
