import { describe, expect, it } from "vitest";
import { dossieParaTexto, montarDossie } from "../../src/ia/dossie.js";
import type { FuturoDia, PrecoDia } from "../../src/ia/dossie.js";
import type { LeituraCiclo, PontoCiclo } from "../../src/ciclo/leitura.js";

function ponto(ano: number, mes: number, pctFemeas: number): PontoCiclo {
  const total = 300_000;
  const femeas = Math.round(total * pctFemeas);
  return { ano, mes, femeas, machos: total - femeas, total, pctFemeas };
}

const ciclo: LeituraCiclo = {
  fase: "retencao",
  competencia: { ano: 2026, mes: 6 },
  pctFemeas: 0.4984,
  yoyMm3Pp: -4.17,
  mesesNaDirecao: 4,
};

const serie: PontoCiclo[] = [
  ponto(2026, 4, 0.51),
  ponto(2026, 5, 0.5042),
  ponto(2026, 6, 0.4984),
  ponto(2026, 7, 0.62), // mês parcial, além da competência
];

const precos: PrecoDia[] = [
  { serie: "boi_gordo", data: "2026-08-04", valor: 351.5 },
  { serie: "boi_gordo", data: "2026-08-05", valor: 350.2 },
  { serie: "bezerro_ms", data: "2026-08-05", valor: 3369.17 },
];

const futuros: FuturoDia[] = [
  { vencimento: "out/26", preco: 348.5 },
  { vencimento: "jan/27", preco: 355.1 },
];

describe("montarDossie", () => {
  it("monta o dossiê completo: últimos preços, variação do dia, relação de troca", () => {
    const d = montarDossie({ hoje: "2026-08-06", ciclo, serie, precos, futuros });

    expect(d.geradoEm).toBe("2026-08-06");
    expect(d.estadosPainel).toBe("MT + MS + RO");

    // um preço por série, o mais recente de cada
    expect(d.precos).toHaveLength(2);
    const boi = d.precos.find((p) => p.serie === "boi_gordo");
    expect(boi).toEqual({ serie: "boi_gordo", data: "2026-08-05", valor: 350.2 });

    expect(d.variacaoBoiDia).toBeCloseTo(-1.3, 6); // 350,20 − 351,50
    expect(d.relacaoTroca).toBeCloseTo(3369.17 / 350.2, 6); // ~9,62 @ por bezerro
    expect(d.futuros).toEqual(futuros);
  });

  it("corta a série na competência da leitura (mês parcial fica de fora)", () => {
    const d = montarDossie({ hoje: "2026-08-06", ciclo, serie, precos, futuros });
    expect(d.serie).toHaveLength(3);
    expect(d.serie.at(-1)).toMatchObject({ ano: 2026, mes: 6 });
  });

  it("sem dois pregões do boi, a variação do dia é null", () => {
    const soUmDia = precos.filter((p) => p.data === "2026-08-05");
    const d = montarDossie({ hoje: "2026-08-06", ciclo, serie, precos: soUmDia, futuros });
    expect(d.variacaoBoiDia).toBeNull();
    expect(d.relacaoTroca).not.toBeNull(); // boi e bezerro do dia existem
  });

  it("sem bezerro, a relação de troca é null", () => {
    const semBezerro = precos.filter((p) => p.serie !== "bezerro_ms");
    const d = montarDossie({ hoje: "2026-08-06", ciclo, serie, precos: semBezerro, futuros });
    expect(d.relacaoTroca).toBeNull();
  });

  it("sem preço nenhum e sem futuros, o dossiê ainda se monta", () => {
    const d = montarDossie({ hoje: "2026-08-06", ciclo, serie, precos: [], futuros: [] });
    expect(d.precos).toEqual([]);
    expect(d.variacaoBoiDia).toBeNull();
    expect(d.relacaoTroca).toBeNull();
    expect(d.futuros).toEqual([]);
  });

  it("com competência null, a série vai inteira", () => {
    const indefinido: LeituraCiclo = { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 };
    const d = montarDossie({ hoje: "2026-08-06", ciclo: indefinido, serie, precos, futuros });
    expect(d.serie).toHaveLength(serie.length);
  });
});

describe("dossieParaTexto", () => {
  it("traz a competência por extenso e a data de cada preço", () => {
    const texto = dossieParaTexto(montarDossie({ hoje: "2026-08-06", ciclo, serie, precos, futuros }));
    expect(texto).toContain("junho de 2026");
    expect(texto).toContain("05/08/2026"); // data do preço em pt-BR
    expect(texto).toContain("49,84"); // pctFemeas em %
    expect(texto).toContain("350,20");
    expect(texto).toContain("3.369,17");
    expect(texto).toContain("out/26");
  });

  it("com dados faltando, não escreve undefined nem NaN", () => {
    const indefinido: LeituraCiclo = { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 };
    const texto = dossieParaTexto(montarDossie({ hoje: "2026-08-06", ciclo: indefinido, serie: [], precos: [], futuros: [] }));
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("NaN");
    expect(texto).not.toContain("null");
  });
});
