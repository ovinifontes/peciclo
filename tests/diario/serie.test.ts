import { describe, expect, it } from "vitest";
import type { LinhaDiaria, Sexo, UF } from "../../src/tipos.js";
import {
  MINIMO_DIAS_MM7,
  agruparDias,
  diaSemana,
  indicadoresDiarios,
  rotuloDia,
  serieComMm7,
  ufsComDado,
} from "../../src/diario/serie.js";

function linha(uf: UF, data: string, sexo: Sexo, quantidade: number): LinhaDiaria {
  return { uf, data, sexo, quantidade };
}

/** Um dia completo (os dois sexos) de uma UF. */
function dia(uf: UF, data: string, femeas: number, machos: number): LinhaDiaria[] {
  return [linha(uf, data, "FEMEA", femeas), linha(uf, data, "MACHO", machos)];
}

describe("agruparDias", () => {
  it("agrupa por UF e dia, somando por sexo e derivando total e % de fêmeas", () => {
    const dias = agruparDias([
      linha("MS", "2026-08-10", "FEMEA", 300),
      linha("MS", "2026-08-10", "MACHO", 700),
    ]);
    expect(dias).toHaveLength(1);
    expect(dias[0]).toEqual({
      uf: "MS",
      data: "2026-08-10",
      femeas: 300,
      machos: 700,
      total: 1000,
      pctFemeas: 30,
      ambosSexos: true,
    });
  });

  it("marca ambosSexos=false quando o dia só tem um sexo", () => {
    const dias = agruparDias([linha("MS", "2026-08-10", "FEMEA", 300)]);
    expect(dias[0]?.ambosSexos).toBe(false);
    expect(dias[0]?.machos).toBe(0);
    expect(dias[0]?.total).toBe(300);
  });

  it("dia de volume zero tem % de fêmeas nula, não NaN", () => {
    const dias = agruparDias(dia("MS", "2026-08-10", 0, 0));
    expect(dias[0]?.pctFemeas).toBeNull();
    expect(dias[0]?.ambosSexos).toBe(true);
  });

  it("ordena por data crescente e, no mesmo dia, na ordem canônica das UFs", () => {
    const dias = agruparDias([
      ...dia("MS", "2026-08-11", 1, 1),
      ...dia("MS", "2026-08-10", 1, 1),
      ...dia("MT", "2026-08-11", 1, 1),
    ]);
    expect(dias.map((d) => `${d.data} ${d.uf}`)).toEqual([
      "2026-08-10 MS",
      "2026-08-11 MT",
      "2026-08-11 MS",
    ]);
  });

  it("soma linhas repetidas do mesmo (uf, dia, sexo)", () => {
    const dias = agruparDias([
      linha("MS", "2026-08-10", "FEMEA", 100),
      linha("MS", "2026-08-10", "FEMEA", 50),
    ]);
    expect(dias[0]?.femeas).toBe(150);
  });
});

describe("serieComMm7", () => {
  // 03..09/08/2026: seis dias de semana iguais e um domingo minúsculo e cheio
  // de fêmeas — o cenário que quebra a média simples de percentuais.
  const semanaAssimetrica = [
    ...dia("MS", "2026-08-03", 300, 700),
    ...dia("MS", "2026-08-04", 300, 700),
    ...dia("MS", "2026-08-05", 300, 700),
    ...dia("MS", "2026-08-06", 300, 700),
    ...dia("MS", "2026-08-07", 300, 700),
    ...dia("MS", "2026-08-08", 300, 700),
    ...dia("MS", "2026-08-09", 76, 24),
  ];

  it("só o 7º dia da série ganha MM7; os anteriores ficam nulos", () => {
    const serie = serieComMm7(agruparDias(semanaAssimetrica));
    expect(serie.slice(0, 6).every((p) => p.mm7Total === null)).toBe(true);
    expect(serie[6]?.mm7Total).toBeCloseTo(6100 / 7, 6);
  });

  it("pondera a MM7 do % por volume (Σfêmeas/Σtotal), não pela média dos percentuais", () => {
    const serie = serieComMm7(agruparDias(semanaAssimetrica));
    const ponderada = (1876 / 6100) * 100; // (6×300 + 76) / (6×1000 + 100)
    const mediaDosPct = (6 * 30 + 76) / 7; // o jeito errado: domingo pesaria igual
    expect(serie[6]?.mm7PctFemeas).toBeCloseTo(ponderada, 6);
    expect(serie[6]?.mm7PctFemeas).not.toBeCloseTo(mediaDosPct, 1);
  });

  // 01..08/08 com o dia 07 faltando: nenhuma janela de 7 dias corridos fecha.
  const comLacuna = ["01", "02", "03", "04", "05", "06", "08"].flatMap((d) =>
    dia("MS", `2026-08-${d}`, 100, 100),
  );

  it("dia faltante na janela anula a MM7 no modo padrão (mínimo 7)", () => {
    const serie = serieComMm7(agruparDias(comLacuna));
    expect(MINIMO_DIAS_MM7).toBe(7);
    expect(serie.every((p) => p.mm7Total === null)).toBe(true);
  });

  it("com mínimo 5, a MM7 é a média dos dias presentes na janela", () => {
    const serie = serieComMm7(agruparDias(comLacuna), 5);
    const dia08 = serie.find((p) => p.data === "2026-08-08");
    const dia05 = serie.find((p) => p.data === "2026-08-05");
    const dia04 = serie.find((p) => p.data === "2026-08-04");
    expect(dia08?.mm7Total).toBe(200); // 6 presentes na janela 02..08
    expect(dia08?.mm7PctFemeas).toBe(50);
    expect(dia05?.mm7Total).toBe(200); // exatamente 5 presentes: entra
    expect(dia04?.mm7Total).toBeNull(); // 4 presentes: abaixo do mínimo
  });

  it("calcula a MM7 por UF, sem uma UF contaminar a janela da outra", () => {
    const serie = serieComMm7(
      agruparDias([
        ...semanaAssimetrica,
        // MT sem o dia 05: a janela do MT não fecha, a do MS segue intacta.
        ...["03", "04", "06", "07", "08", "09"].flatMap((d) =>
          dia("MT", `2026-08-${d}`, 50, 50),
        ),
      ]),
    );
    const ms09 = serie.find((p) => p.uf === "MS" && p.data === "2026-08-09");
    const mt09 = serie.find((p) => p.uf === "MT" && p.data === "2026-08-09");
    expect(ms09?.mm7Total).toBeCloseTo(6100 / 7, 6);
    expect(mt09?.mm7Total).toBeNull();
  });

  it("semana inteira de volume zero: MM7 do total é 0 e a do % é nula", () => {
    const zeros = ["03", "04", "05", "06", "07", "08", "09"].flatMap((d) =>
      dia("MS", `2026-08-${d}`, 0, 0),
    );
    const serie = serieComMm7(agruparDias(zeros));
    expect(serie[6]?.mm7Total).toBe(0);
    expect(serie[6]?.mm7PctFemeas).toBeNull();
  });
});

describe("indicadoresDiarios", () => {
  // MT+MS completos de 08 a 15; dia 16 só MS; dia 17 com MT capenga (sem macho).
  const cenario = agruparDias([
    ...dia("MT", "2026-08-08", 300, 700),
    ...dia("MS", "2026-08-08", 400, 600),
    ...["10", "11", "12", "13", "14"].flatMap((d) => [
      ...dia("MT", `2026-08-${d}`, 310, 690),
      ...dia("MS", `2026-08-${d}`, 410, 590),
    ]),
    ...dia("MT", "2026-08-15", 330, 770),
    ...dia("MS", "2026-08-15", 450, 650),
    ...dia("MS", "2026-08-16", 500, 500),
    ...dia("MS", "2026-08-17", 500, 500),
    linha("MT", "2026-08-17", "FEMEA", 200),
  ]);

  it("recua o dia de referência até o último dia com ambos os sexos de TODAS as UFs pedidas", () => {
    const ind = indicadoresDiarios(cenario, ["MT", "MS"]);
    expect(ind.diaReferencia).toBe("2026-08-15");
  });

  it("compara com o D-7 exato e soma as UFs pedidas", () => {
    const ind = indicadoresDiarios(cenario, ["MT", "MS"]);
    expect(ind.diaComparacao).toBe("2026-08-08");
    expect(ind.totalDia).toBe(2200);
    expect(ind.femeasDia).toBe(780);
    expect(ind.pctFemeasDia).toBeCloseTo((780 / 2200) * 100, 6);
    expect(ind.totalD7).toBe(2000);
    expect(ind.femeasD7).toBe(700);
    expect(ind.variacaoTotalPct).toBeCloseTo(10, 6);
    expect(ind.variacaoFemeasPct).toBeCloseTo((80 / 700) * 100, 6);
  });

  it("com uma UF só, o dia de referência avança até onde ela alcança", () => {
    const ind = indicadoresDiarios(cenario, ["MS"]);
    expect(ind.diaReferencia).toBe("2026-08-17");
    expect(ind.totalDia).toBe(1000);
    // D-7 = 10/08, completo para o MS.
    expect(ind.totalD7).toBe(1000);
    expect(ind.variacaoTotalPct).toBeCloseTo(0, 6);
  });

  it("D-7 ausente: a data da comparação existe, os valores e variações ficam nulos", () => {
    const curto = agruparDias([
      ...dia("MS", "2026-08-15", 400, 600),
      ...dia("MS", "2026-08-16", 450, 550),
    ]);
    const ind = indicadoresDiarios(curto, ["MS"]);
    expect(ind.diaReferencia).toBe("2026-08-16");
    expect(ind.diaComparacao).toBe("2026-08-09");
    expect(ind.totalD7).toBeNull();
    expect(ind.variacaoTotalPct).toBeNull();
    expect(ind.variacaoFemeasPct).toBeNull();
  });

  it("D-7 presente mas sem os dois sexos não vale como comparação", () => {
    const capenga = agruparDias([
      linha("MS", "2026-08-08", "FEMEA", 400),
      ...dia("MS", "2026-08-15", 450, 550),
    ]);
    const ind = indicadoresDiarios(capenga, ["MS"]);
    expect(ind.diaReferencia).toBe("2026-08-15");
    expect(ind.variacaoTotalPct).toBeNull();
  });

  it("sem nenhum dia completo para as UFs pedidas, devolve tudo nulo", () => {
    const ind = indicadoresDiarios(cenario, ["RO"]);
    expect(ind.diaReferencia).toBeNull();
    expect(ind.diaComparacao).toBeNull();
    expect(ind.totalDia).toBeNull();
    expect(ind.variacaoTotalPct).toBeNull();
  });

  it("lista vazia de UFs devolve tudo nulo", () => {
    const ind = indicadoresDiarios(cenario, []);
    expect(ind.diaReferencia).toBeNull();
  });
});

describe("ufsComDado", () => {
  it("devolve as UFs presentes na ordem canônica MT, MS, RO, PA, sem repetir", () => {
    const dias = agruparDias([
      ...dia("PA", "2026-08-10", 1, 1),
      ...dia("MS", "2026-08-10", 1, 1),
      ...dia("MS", "2026-08-11", 1, 1),
      ...dia("MT", "2026-08-11", 1, 1),
    ]);
    expect(ufsComDado(dias)).toEqual(["MT", "MS", "PA"]);
  });

  it("lista vazia devolve vazio", () => {
    expect(ufsComDado([])).toEqual([]);
  });
});

describe("rotuloDia", () => {
  it("formata dd/MM por fatiamento, sem passar por Date", () => {
    expect(rotuloDia("2026-08-15")).toBe("15/08");
    expect(rotuloDia("2026-01-05")).toBe("05/01");
  });
});

describe("diaSemana", () => {
  it("nomeia o dia da semana de forma determinística (UTC meio-dia)", () => {
    expect(diaSemana("2026-08-14")).toBe("sexta");
    expect(diaSemana("2026-08-15")).toBe("sábado");
    expect(diaSemana("2026-08-16")).toBe("domingo");
    expect(diaSemana("2026-08-18")).toBe("terça");
    expect(diaSemana("2025-01-01")).toBe("quarta");
  });
});
