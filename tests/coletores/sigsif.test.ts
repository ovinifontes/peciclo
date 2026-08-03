import { describe, expect, it } from "vitest";
import { parsearSigsif, removerMesesParciais } from "../../src/coletores/sigsif.js";

// Formato real do arquivo, incluindo CRLF e categorias parecidas.
const CSV = [
  "MES_ANO;UF_PROCEDENCIA;CATEGORIA;QTD_MACHO;QTD_FEMEA",
  "07/2026;GO;Bovino;180146;63532",
  "07/2026;SP;Bovino;174939;37722",
  "06/2026;GO;Bovino;206749;99724",
  "07/2026;GO;Bubalino;10;20",
  "07/2026;MT;Bovino;999;999",
].join("\r\n");

describe("parsearSigsif", () => {
  it("extrai só bovino das UFs pedidas, tratando CRLF", () => {
    const dados = parsearSigsif(CSV, ["GO", "SP"]);
    expect(dados).toHaveLength(3);
    const go07 = dados.find((d) => d.uf === "GO" && d.mes === 7)!;
    expect(go07.macho).toBe(180146);
    expect(go07.femea).toBe(63532); // sem o \r, isto viraria NaN
  });

  it("ignora outras espécies e outras UFs", () => {
    const dados = parsearSigsif(CSV, ["GO", "SP"]);
    expect(dados.every((d) => ["GO", "SP"].includes(d.uf))).toBe(true);
    expect(dados.some((d) => d.macho === 10)).toBe(false); // bubalino fora
  });

  it("usa igualdade exata de categoria (não pega 'Bubalino' por conter texto)", () => {
    const dados = parsearSigsif("MES_ANO;UF;CAT;M;F\r\n01/2026;GO;Bovino Macho;5;5", ["GO"]);
    expect(dados).toHaveLength(0);
  });
});

describe("removerMesesParciais", () => {
  function serie(totais: number[]) {
    return totais.map((t, i) => ({ uf: "GO", ano: 2026, mes: i + 1, macho: Math.round(t / 2), femea: Math.round(t / 2) }));
  }

  it("descarta o último mês quando ele é um stub", () => {
    // 7 meses normais + 1 mês com 266 cabeças (o stub que o SIGSIF publica)
    const dados = removerMesesParciais(serie([300000, 300000, 300000, 300000, 300000, 300000, 300000, 266]));
    expect(dados).toHaveLength(7);
    expect(dados.at(-1)!.mes).toBe(7);
  });

  it("mantém o último mês quando ele está em linha com os anteriores", () => {
    const dados = removerMesesParciais(serie([300000, 300000, 300000, 300000, 300000, 300000, 300000, 290000]));
    expect(dados).toHaveLength(8);
  });

  it("não mexe em séries curtas demais para julgar", () => {
    const dados = removerMesesParciais(serie([300000, 1]));
    expect(dados).toHaveLength(2);
  });
});
