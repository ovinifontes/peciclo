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
