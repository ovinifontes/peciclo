import { describe, expect, it } from "vitest";
import { coletaVaziaSuspeita } from "../../src/dados/coletas.js";

const mesCorrente = { ano: 2026, mes: 8 };

describe("coletaVaziaSuspeita", () => {
  it("coleta com linhas nunca é suspeita", () => {
    expect(coletaVaziaSuspeita({ linhas: 2, ...mesCorrente, hojeIso: "2026-08-20" })).toBe(false);
  });

  it("mês corrente vazio nos primeiros dias é normal (o mês mal começou)", () => {
    expect(coletaVaziaSuspeita({ linhas: 0, ...mesCorrente, hojeIso: "2026-08-03" })).toBe(false);
    expect(coletaVaziaSuspeita({ linhas: 0, ...mesCorrente, hojeIso: "2026-08-05" })).toBe(false);
  });

  it("mês corrente vazio depois do dia 5 é falha silenciosa", () => {
    // O caso do RO: se o IDARON renomear as faixas etárias, o sufixo " F"/" M"
    // deixa de casar, femeas/machos saem 0 e o coletor devolve [] como se o mês
    // não tivesse sido publicado — o painel congela sem ninguém saber.
    expect(coletaVaziaSuspeita({ linhas: 0, ...mesCorrente, hojeIso: "2026-08-06" })).toBe(true);
    expect(coletaVaziaSuspeita({ linhas: 0, ...mesCorrente, hojeIso: "2026-08-25" })).toBe(true);
  });

  it("mês já fechado vazio é suspeito em qualquer dia", () => {
    expect(coletaVaziaSuspeita({ linhas: 0, ano: 2026, mes: 7, hojeIso: "2026-08-02" })).toBe(true);
    expect(coletaVaziaSuspeita({ linhas: 0, ano: 2025, mes: 12, hojeIso: "2026-01-01" })).toBe(true);
  });

  it("mês futuro vazio não é suspeito — não há o que publicar", () => {
    expect(coletaVaziaSuspeita({ linhas: 0, ano: 2026, mes: 9, hojeIso: "2026-08-25" })).toBe(false);
    expect(coletaVaziaSuspeita({ linhas: 0, ano: 2027, mes: 1, hojeIso: "2026-12-31" })).toBe(false);
  });
});
