import { describe, expect, it } from "vitest";
import { lerCiclo, mesesBloqueados, serieComposicaoFixa } from "../../src/ciclo/leitura.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

/**
 * Gera um mês completo do painel (MT, MS, RO) com o pct de fêmeas pedido.
 * `escala` encolhe o volume do mês sem mexer na composição — é assim que se
 * simula fonte parada.
 */
function mes(
  ano: number,
  m: number,
  pct: number,
  ufs: Array<"MT" | "MS" | "RO"> = ["MT", "MS", "RO"],
  escala = 1,
): LinhaMensal[] {
  return ufs.flatMap((uf) => [
    { uf, ano, mes: m, sexo: "FEMEA" as const, quantidade: Math.round(100_000 * escala * pct) },
    { uf, ano, mes: m, sexo: "MACHO" as const, quantidade: Math.round(100_000 * escala * (1 - pct)) },
  ]);
}

/**
 * Todo teste fixa o "hoje": o mês corrente nunca entra na série, então sem data
 * explícita a suíte passaria ou falharia conforme o mês em que roda.
 */
const HOJE = "2027-01-15";

describe("serieComposicaoFixa", () => {
  it("exclui mês em que falta um estado do painel", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      ...mes(2026, 2, 0.5, ["MT", "MS"]), // sem RO
    ];
    const serie = serieComposicaoFixa(dados, undefined, HOJE);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.mes).toBe(1);
  });

  it("ignora estados fora do painel (o PA não entra no consolidado)", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      { uf: "PA" as const, ano: 2026, mes: 1, sexo: "FEMEA" as const, quantidade: 999_999 },
    ];
    const serie = serieComposicaoFixa(dados, undefined, HOJE);
    expect(serie[0]!.femeas).toBe(150_000); // 3 estados × 50.000, sem o PA
  });

  it("calcula a participação de fêmeas do mês", () => {
    const serie = serieComposicaoFixa(mes(2026, 1, 0.4), undefined, HOJE);
    expect(serie[0]!.pctFemeas).toBeCloseTo(0.4, 4);
  });

  it("exclui o mês em curso, que está incompleto por definição", () => {
    const dados = [...mes(2026, 8, 0.5), ...mes(2026, 9, 0.5)];
    const serie = serieComposicaoFixa(dados, undefined, "2026-09-27");
    expect(serie.map((p) => p.mes)).toEqual([8]);
  });

  it("exclui mês em que um estado veio muito abaixo do próprio nível", () => {
    // Seis meses normais e um sétimo em que o RO entrega 30% do de sempre —
    // é o que o painel do IDARON fez em setembro/2026 ao congelar em 11/09.
    const dados = [1, 2, 3, 4, 5, 6].flatMap((m) => mes(2026, m, 0.5));
    dados.push(...mes(2026, 7, 0.5, ["MT", "MS"]), ...mes(2026, 7, 0.5, ["RO"], 0.3));
    const serie = serieComposicaoFixa(dados, undefined, HOJE);
    expect(serie.map((p) => p.mes)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mesesBloqueados(dados, undefined, HOJE)[0]).toMatchObject({
      ano: 2026,
      mes: 7,
      implausiveis: ["RO"],
    });
  });

  it("aceita queda anual grande de volume: é mercado, não dado faltando", () => {
    // 2026 inteiro a 75% do volume de 2025 — reprovava no teste antigo, que
    // exigia 90% do mesmo mês do ano anterior, e travava a leitura no ciclo.
    const dados = [
      ...Array.from({ length: 12 }, (_, i) => mes(2025, i + 1, 0.5)).flat(),
      ...Array.from({ length: 12 }, (_, i) => mes(2026, i + 1, 0.44, undefined, 0.75)).flat(),
    ];
    const serie = serieComposicaoFixa(dados, undefined, HOJE);
    expect(serie).toHaveLength(24);
    expect(lerCiclo(dados, undefined, HOJE).competencia).toEqual({ ano: 2026, mes: 12 });
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
    const leitura = lerCiclo(doisAnos(0.5, 0.44), undefined, HOJE); // −6 p.p.
    expect(leitura.fase).toBe("retencao");
    expect(leitura.yoyMm3Pp).toBeLessThan(-1);
  });

  it("classifica como liquidação quando sobe no ano", () => {
    expect(lerCiclo(doisAnos(0.44, 0.5), undefined, HOJE).fase).toBe("liquidacao");
  });

  it("classifica como transição quando a variação é pequena", () => {
    expect(lerCiclo(doisAnos(0.5, 0.495), undefined, HOJE).fase).toBe("transicao"); // −0,5 p.p.
  });

  it("recua para o último mês utilizável quando o mais recente é recusado", () => {
    const dados = doisAnos(0.5, 0.44);
    // dezembro/2026 com 10% do volume em todo o painel: fonte parada, não mês.
    const parcial = dados.filter((d) => !(d.ano === 2026 && d.mes === 12));
    parcial.push(...mes(2026, 12, 0.44, undefined, 0.1));
    const leitura = lerCiclo(parcial, undefined, HOJE);
    expect(leitura.competencia).toEqual({ ano: 2026, mes: 11 });
  });

  it("não calcula média móvel por cima de buraco na série", () => {
    // Sem novembro, dezembro não tem 3 meses SEGUIDOS: a leitura recua até
    // outubro em vez de misturar setembro, outubro e dezembro numa "mm3".
    const dados = doisAnos(0.5, 0.44).filter((d) => !(d.ano === 2026 && d.mes === 11));
    expect(lerCiclo(dados, undefined, HOJE).competencia).toEqual({ ano: 2026, mes: 10 });
  });

  it("conta há quantos meses o movimento se mantém", () => {
    const leitura = lerCiclo(doisAnos(0.5, 0.44), undefined, HOJE);
    expect(leitura.mesesNaDirecao).toBeGreaterThanOrEqual(3);
  });

  it("devolve indefinido quando não há histórico suficiente", () => {
    const leitura = lerCiclo(mes(2026, 1, 0.5), undefined, HOJE);
    expect(leitura.fase).toBe("indefinido");
    expect(leitura.yoyMm3Pp).toBeNull();
  });
});
