import { describe, expect, it } from "vitest";
import { calcularKpis, participacaoFemeas } from "../../src/planilha/kpis.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

describe("participacaoFemeas", () => {
  it("calcula a fração de fêmeas no total", () => {
    expect(participacaoFemeas(40, 60)).toBeCloseTo(0.4, 6);
  });

  it("devolve null quando não há abate", () => {
    expect(participacaoFemeas(0, 0)).toBeNull();
  });
});

describe("calcularKpis", () => {
  const dados: LinhaMensal[] = [
    { uf: "MT", ano: 2026, mes: 5, sexo: "FEMEA", quantidade: 300 },
    { uf: "MT", ano: 2026, mes: 5, sexo: "MACHO", quantidade: 700 },
    { uf: "MT", ano: 2026, mes: 6, sexo: "FEMEA", quantidade: 450 },
    { uf: "MT", ano: 2026, mes: 6, sexo: "MACHO", quantidade: 550 },
    { uf: "MS", ano: 2026, mes: 6, sexo: "FEMEA", quantidade: 500 },
    { uf: "MS", ano: 2026, mes: 6, sexo: "MACHO", quantidade: 500 },
  ];

  it("calcula participação por estado e consolidada", () => {
    const kpis = calcularKpis(dados);
    const junhoMt = kpis.find((k) => k.uf === "MT" && k.ano === 2026 && k.mes === 6)!;
    expect(junhoMt.participacaoFemeas).toBeCloseTo(0.45, 6);

    const junhoTotal = kpis.find((k) => k.uf === "CONSOLIDADO" && k.mes === 6)!;
    expect(junhoTotal.participacaoFemeas).toBeCloseTo(0.475, 6);
  });

  it("calcula a variação contra o mês anterior em pontos percentuais", () => {
    const kpis = calcularKpis(dados);
    const junhoMt = kpis.find((k) => k.uf === "MT" && k.mes === 6)!;
    // 45% contra 30% no mês anterior
    expect(junhoMt.variacaoMesAnteriorPp).toBeCloseTo(0.15, 6);
  });

  it("deixa a variação nula quando não há mês anterior", () => {
    const kpis = calcularKpis(dados);
    const maioMt = kpis.find((k) => k.uf === "MT" && k.mes === 5)!;
    expect(maioMt.variacaoMesAnteriorPp).toBeNull();
    expect(maioMt.variacaoAnoAnteriorPp).toBeNull();
  });
});

describe("contagem de estados no consolidado", () => {
  it("marca quantos estados entraram em cada mês", () => {
    const dados: LinhaMensal[] = [
      { uf: "MT", ano: 2025, mes: 11, sexo: "FEMEA", quantidade: 100 },
      { uf: "MT", ano: 2025, mes: 11, sexo: "MACHO", quantidade: 100 },
      { uf: "MS", ano: 2025, mes: 11, sexo: "FEMEA", quantidade: 100 },
      { uf: "MS", ano: 2025, mes: 11, sexo: "MACHO", quantidade: 100 },
      // dezembro tem os 3
      { uf: "MT", ano: 2025, mes: 12, sexo: "FEMEA", quantidade: 100 },
      { uf: "MS", ano: 2025, mes: 12, sexo: "FEMEA", quantidade: 100 },
      { uf: "PA", ano: 2025, mes: 12, sexo: "FEMEA", quantidade: 100 },
    ];
    const kpis = calcularKpis(dados);
    expect(kpis.find((k) => k.uf === "CONSOLIDADO" && k.mes === 11)!.estados).toBe(2);
    expect(kpis.find((k) => k.uf === "CONSOLIDADO" && k.mes === 12)!.estados).toBe(3);
    // uma linha de estado individual sempre conta 1
    expect(kpis.find((k) => k.uf === "MT" && k.mes === 11)!.estados).toBe(1);
  });
});
