import { describe, expect, it } from "vitest";
import { dividirJanela, parsearMs, urlRelatorioMs } from "../../src/coletores/ms.js";

const FIXTURE = "tests/fixtures/ms-iagro-2026-07-20-a-26.xlsx";

describe("urlRelatorioMs", () => {
  it("monta a URL com espécie bovina e sem filtro de finalidade", () => {
    const url = urlRelatorioMs({ inicio: "2026-07-20", fim: "2026-07-26" });
    expect(url).toContain("especieAnimalID=1");
    expect(url).toContain("periodoInicial=2026-07-20");
    expect(url).toContain("periodoFinal=2026-07-26");
    // finalidadeID vazio de propósito: o lookup de IDs exige token, e filtrar
    // localmente traz engorda e reprodução de graça no mesmo download.
    expect(url).toContain("finalidadeID=");
  });
});

describe("parsearMs", () => {
  it("extrai os registros de abate com os totais conhecidos do arquivo real", async () => {
    const registros = await parsearMs(FIXTURE);
    const abate = registros.filter((r) => r.finalidade === "ABATE");

    const femeas = abate.filter((r) => r.sexo === "FEMEA").reduce((s, r) => s + r.quantidade, 0);
    const machos = abate.filter((r) => r.sexo === "MACHO").reduce((s, r) => s + r.quantidade, 0);

    expect(femeas).toBe(29991);
    expect(machos).toBe(30644);
  });

  it("guarda também as outras finalidades", async () => {
    const registros = await parsearMs(FIXTURE);
    const finalidades = new Set(registros.map((r) => r.finalidade));
    expect(finalidades.has("ENGORDA")).toBe(true);
    expect(finalidades.has("REPRODUÇÃO")).toBe(true);
  });

  it("desnormaliza por faixa etária e preenche os campos da chave natural", async () => {
    const registros = await parsearMs(FIXTURE);
    const comFaixa = registros.filter((r) => r.faixaEtaria !== null);
    expect(comFaixa.length).toBeGreaterThan(0);
    for (const r of registros.slice(0, 50)) {
      expect(r.uf).toBe("MS");
      expect(r.documentoNumero).not.toBe("");
      expect(r.dataEmissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.quantidade).toBeGreaterThan(0);
    }
  });

  it("não emite registros com quantidade zero", async () => {
    const registros = await parsearMs(FIXTURE);
    expect(registros.every((r) => r.quantidade > 0)).toBe(true);
  });
});

describe("dividirJanela", () => {
  it("devolve uma fatia só quando a janela cabe no tamanho", () => {
    expect(dividirJanela({ inicio: "2026-07-01", fim: "2026-07-05" }, 7)).toEqual([
      { inicio: "2026-07-01", fim: "2026-07-05" },
    ]);
  });

  it("fatia um mês inteiro em pedaços de 7 dias, sem sobrepor nem pular dia", () => {
    const fatias = dividirJanela({ inicio: "2026-07-01", fim: "2026-07-28" }, 7);
    expect(fatias).toEqual([
      { inicio: "2026-07-01", fim: "2026-07-07" },
      { inicio: "2026-07-08", fim: "2026-07-14" },
      { inicio: "2026-07-15", fim: "2026-07-21" },
      { inicio: "2026-07-22", fim: "2026-07-28" },
    ]);
  });

  it("respeita o fim da janela na última fatia", () => {
    const fatias = dividirJanela({ inicio: "2026-07-01", fim: "2026-07-10" }, 7);
    expect(fatias.at(-1)).toEqual({ inicio: "2026-07-08", fim: "2026-07-10" });
  });

  it("cobre a virada de mês sem perder dias", () => {
    const fatias = dividirJanela({ inicio: "2026-07-28", fim: "2026-08-03" }, 7);
    expect(fatias).toEqual([{ inicio: "2026-07-28", fim: "2026-08-03" }]);
  });
});
