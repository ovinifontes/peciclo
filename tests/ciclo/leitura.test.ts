import { describe, expect, it } from "vitest";
import { lerCiclo, serieComposicaoFixa } from "../../src/ciclo/leitura.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

/** Gera um mês completo do painel (MT, MS, RO) com o pct de fêmeas pedido. */
function mes(ano: number, m: number, pct: number, ufs: Array<"MT" | "MS" | "RO"> = ["MT", "MS", "RO"]): LinhaMensal[] {
  return ufs.flatMap((uf) => [
    { uf, ano, mes: m, sexo: "FEMEA" as const, quantidade: Math.round(100_000 * pct) },
    { uf, ano, mes: m, sexo: "MACHO" as const, quantidade: Math.round(100_000 * (1 - pct)) },
  ]);
}

describe("serieComposicaoFixa", () => {
  it("exclui mês em que falta um estado do painel", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      ...mes(2026, 2, 0.5, ["MT", "MS"]), // sem RO
    ];
    const serie = serieComposicaoFixa(dados);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.mes).toBe(1);
  });

  it("ignora estados fora do painel (o PA não entra no consolidado)", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      { uf: "PA" as const, ano: 2026, mes: 1, sexo: "FEMEA" as const, quantidade: 999_999 },
    ];
    const serie = serieComposicaoFixa(dados);
    expect(serie[0]!.femeas).toBe(150_000); // 3 estados × 50.000, sem o PA
  });

  it("calcula a participação de fêmeas do mês", () => {
    const serie = serieComposicaoFixa(mes(2026, 1, 0.4));
    expect(serie[0]!.pctFemeas).toBeCloseTo(0.4, 4);
  });
});

describe("lerCiclo", () => {
  /** 24 meses: ano 1 estável em `base`, ano 2 em `atual`. */
  function doisAnos(base: number, atual: number): LinhaMensal[] {
    const dados: LinhaMensal[] = [];
    for (let m = 1; m <= 12; m++) dados.push(...mes(2025, m, base));
    for (let m = 1; m <= 12; m++) dados.push(...mes(2026, m, atual));
    return dados;
  }

  it("classifica como retenção quando a participação de fêmeas cai no ano", () => {
    const leitura = lerCiclo(doisAnos(0.5, 0.44)); // −6 p.p.
    expect(leitura.fase).toBe("retencao");
    expect(leitura.yoyMm3Pp).toBeLessThan(-1);
  });

  it("classifica como liquidação quando sobe no ano", () => {
    expect(lerCiclo(doisAnos(0.44, 0.5)).fase).toBe("liquidacao");
  });

  it("classifica como transição quando a variação é pequena", () => {
    expect(lerCiclo(doisAnos(0.5, 0.495)).fase).toBe("transicao"); // −0,5 p.p.
  });

  it("reprova mês com volume muito abaixo do mesmo mês do ano anterior", () => {
    const dados = doisAnos(0.5, 0.44);
    // dezembro/2026 com 10% do volume: mês corrente parcial
    const parcial = dados.filter((d) => !(d.ano === 2026 && d.mes === 12));
    for (const uf of ["MT", "MS", "RO"] as const) {
      parcial.push(
        { uf, ano: 2026, mes: 12, sexo: "FEMEA", quantidade: 4_400 },
        { uf, ano: 2026, mes: 12, sexo: "MACHO", quantidade: 5_600 },
      );
    }
    const leitura = lerCiclo(parcial);
    expect(leitura.competencia).toEqual({ ano: 2026, mes: 11 }); // usa o último utilizável
  });

  it("conta há quantos meses o movimento se mantém", () => {
    const leitura = lerCiclo(doisAnos(0.5, 0.44));
    expect(leitura.mesesNaDirecao).toBeGreaterThanOrEqual(3);
  });

  it("devolve indefinido quando não há histórico suficiente", () => {
    const leitura = lerCiclo(mes(2026, 1, 0.5));
    expect(leitura.fase).toBe("indefinido");
    expect(leitura.yoyMm3Pp).toBeNull();
  });
});
