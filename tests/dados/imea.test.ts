import { beforeEach, describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { gravarMensalImea } from "../../src/dados/imea.js";

type Linha = { sexo: string; quantidade: number; fonte: string };

let linhasAtuais: Linha[];
const upsert = vi.fn();
// Builder encadeável e "thenable", como o do supabase-js: os .eq() se
// acumulam e o await resolve com as linhas configuradas no teste.
const cadeia: { eq: ReturnType<typeof vi.fn>; then: (r: (v: unknown) => void) => void } = {
  eq: vi.fn(() => cadeia),
  then: (resolve) => resolve({ data: linhasAtuais, error: null }),
};
const select = vi.fn(() => cadeia);
const from = vi.fn(() => ({ select, upsert }));

const args = { ano: 2026, mes: 7, machos: 346_689, femeas: 263_140 };

beforeEach(() => {
  vi.clearAllMocks();
  cadeia.eq.mockReturnValue(cadeia);
  obterCliente.mockReturnValue({ from });
  upsert.mockResolvedValue({ error: null });
  linhasAtuais = [];
});

describe("gravarMensalImea — regra de precedência", () => {
  it("grava quando o mês ainda não existe no banco", async () => {
    linhasAtuais = [];
    const r = await gravarMensalImea(args);
    expect(r).toEqual({ gravou: true, totalAnterior: null });

    const [linhas, opcoes] = upsert.mock.calls[0]!;
    expect(opcoes).toEqual({ onConflict: "uf,ano,mes,finalidade,sexo" });
    expect(linhas).toHaveLength(2);
    for (const linha of linhas) {
      expect(linha).toMatchObject({ uf: "MT", ano: 2026, mes: 7, finalidade: "ABATE", fonte: "imea" });
    }
    expect(linhas.find((l: { sexo: string }) => l.sexo === "MACHO").quantidade).toBe(346_689);
    expect(linhas.find((l: { sexo: string }) => l.sexo === "FEMEA").quantidade).toBe(263_140);
  });

  it("grava por cima quando as linhas atuais já são do IMEA (revisão do relatório)", async () => {
    linhasAtuais = [
      { sexo: "MACHO", quantidade: 400_000, fonte: "imea" },
      { sexo: "FEMEA", quantidade: 300_000, fonte: "imea" },
    ];
    const r = await gravarMensalImea(args);
    expect(r).toEqual({ gravou: true, totalAnterior: 700_000 });
  });

  it("grava quando o total do IMEA supera o total atual de outra fonte", async () => {
    linhasAtuais = [
      { sexo: "MACHO", quantidade: 320_000, fonte: "gta_condensada" },
      { sexo: "FEMEA", quantidade: 246_400, fonte: "gta_condensada" },
    ];
    const r = await gravarMensalImea(args);
    expect(r).toEqual({ gravou: true, totalAnterior: 566_400 });
  });

  it("NÃO rebaixa um total maior de outra fonte", async () => {
    linhasAtuais = [
      { sexo: "MACHO", quantidade: 400_000, fonte: "gta_condensada" },
      { sexo: "FEMEA", quantidade: 300_000, fonte: "gta_condensada" },
    ];
    const r = await gravarMensalImea(args);
    expect(r).toEqual({ gravou: false, totalAnterior: 700_000 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("empate não grava — número igual não é mais completo", async () => {
    linhasAtuais = [
      { sexo: "MACHO", quantidade: 346_689, fonte: "gta_condensada" },
      { sexo: "FEMEA", quantidade: 263_140, fonte: "gta_condensada" },
    ];
    const r = await gravarMensalImea(args);
    expect(r.gravou).toBe(false);
  });

  it("lança quando a leitura das linhas atuais falha", async () => {
    cadeia.then = (resolve) => resolve({ data: null, error: { message: "boom" } });
    await expect(gravarMensalImea(args)).rejects.toThrow(/boom/);
    cadeia.then = (resolve) => resolve({ data: linhasAtuais, error: null });
  });
});
