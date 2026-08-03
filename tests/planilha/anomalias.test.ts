import { describe, expect, it } from "vitest";
import { detectarAnomalias } from "../../src/planilha/anomalias.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

/** Doze meses estáveis em torno de 100.000, mais o mês que queremos testar. */
function serie(ultimaQuantidade: number): LinhaMensal[] {
  const linhas: LinhaMensal[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    linhas.push({ uf: "MT", ano: 2025, mes, sexo: "FEMEA", quantidade: 100_000 });
  }
  linhas.push({ uf: "MT", ano: 2026, mes: 1, sexo: "FEMEA", quantidade: ultimaQuantidade });
  return linhas;
}

describe("detectarAnomalias", () => {
  it("não acusa nada quando o valor está próximo da média", () => {
    expect(detectarAnomalias(serie(105_000))).toEqual([]);
  });

  it("acusa valor muito acima da média histórica", () => {
    const anomalias = detectarAnomalias(serie(400_000));
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0]!.uf).toBe("MT");
    expect(anomalias[0]!.mensagem).toMatch(/acima/i);
  });

  it("acusa valor muito abaixo da média histórica", () => {
    const anomalias = detectarAnomalias(serie(10_000));
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0]!.mensagem).toMatch(/abaixo/i);
  });

  it("não acusa nada sem histórico suficiente", () => {
    const curta: LinhaMensal[] = [
      { uf: "MT", ano: 2026, mes: 1, sexo: "FEMEA", quantidade: 999_999 },
    ];
    expect(detectarAnomalias(curta)).toEqual([]);
  });
});

describe("ignora o mês corrente (em andamento)", () => {
  function serie(ultimoMes: number, ultimaQtd: number): LinhaMensal[] {
    const linhas: LinhaMensal[] = [];
    for (let mes = 1; mes <= ultimoMes - 1; mes++) {
      linhas.push({ uf: "MS", ano: 2026, mes, sexo: "FEMEA", quantidade: 170_000 });
    }
    linhas.push({ uf: "MS", ano: 2026, mes: ultimoMes, sexo: "FEMEA", quantidade: ultimaQtd });
    return linhas;
  }

  it("não alerta sobre o mês corrente mesmo com valor baixíssimo (parcial)", () => {
    // ago/2026 com 1.874 (dia 3 do mês) não deve gerar alerta se ago é o mês corrente
    const anomalias = detectarAnomalias(serie(8, 1_874), { ano: 2026, mes: 8 });
    expect(anomalias).toEqual([]);
  });

  it("ainda alerta sobre um mês FECHADO anômalo", () => {
    // se julho (fechado) estiver quebrado e agosto é o corrente, julho é avaliado
    const anomalias = detectarAnomalias(serie(8, 1_874), { ano: 2026, mes: 9 });
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0]!.mes).toBe(8);
  });
})
