import { beforeEach, describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { competenciasDaJanela, gravarAgregados } from "../../src/dados/mensal.js";
import type { AgregadoMensal } from "../../src/tipos.js";

describe("competenciasDaJanela", () => {
  it("devolve uma competência para janela dentro do mesmo mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-20", fim: "2026-07-26" })).toEqual([
      "2026-07-01",
    ]);
  });

  it("devolve as duas competências quando a janela cruza a virada do mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-28", fim: "2026-08-03" })).toEqual([
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("cobre a virada de ano", () => {
    expect(competenciasDaJanela({ inicio: "2026-12-30", fim: "2027-01-02" })).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});

// --- gravarAgregados: guarda contra rebaixar número do IMEA -----------------

type LinhaImea = { uf: string; ano: number; mes: number; finalidade: string; quantidade: number };

let linhasImea: LinhaImea[];
const upsert = vi.fn();
// Builder encadeável e "thenable", como o do supabase-js (mesmo molde do
// teste de dados/imea.ts): os filtros se acumulam e o await resolve.
const cadeia: {
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  then: (r: (v: unknown) => void) => void;
} = {
  eq: vi.fn(() => cadeia),
  in: vi.fn(() => cadeia),
  then: (resolve) => resolve({ data: linhasImea, error: null }),
};
const select = vi.fn(() => cadeia);
const from = vi.fn(() => ({ select, upsert }));

const mt = (sexo: "MACHO" | "FEMEA", quantidade: number, mes = 8): AgregadoMensal => ({
  uf: "MT",
  ano: 2026,
  mes,
  finalidade: "ABATE",
  sexo,
  quantidade,
});
const ro = (sexo: "MACHO" | "FEMEA", quantidade: number): AgregadoMensal => ({
  uf: "RO",
  ano: 2026,
  mes: 8,
  finalidade: "ABATE",
  sexo,
  quantidade,
});
/** As 609.829 cabeças de MT 08/2026 que o IMEA já gravou. */
const imeaMt = [
  { uf: "MT", ano: 2026, mes: 8, finalidade: "ABATE", quantidade: 346_689 },
  { uf: "MT", ano: 2026, mes: 8, finalidade: "ABATE", quantidade: 263_140 },
];
const linhasGravadas = () => upsert.mock.calls[0]?.[0] as { quantidade: number }[] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  cadeia.eq.mockReturnValue(cadeia);
  cadeia.in.mockReturnValue(cadeia);
  obterCliente.mockReturnValue({ from });
  upsert.mockResolvedValue({ error: null });
  linhasImea = [];
});

describe("gravarAgregados — não rebaixa o número do IMEA", () => {
  it("grava normalmente quando não há linha 'imea' na competência", async () => {
    await gravarAgregados([mt("MACHO", 100_000), mt("FEMEA", 80_000)], 7, "gta_condensada");
    expect(linhasGravadas()).toHaveLength(2);
    expect(upsert.mock.calls[0]![1]).toEqual({ onConflict: "uf,ano,mes,finalidade,sexo" });
  });

  it("NÃO sobrescreve o IMEA com o valor parado da migração do INDEA", async () => {
    linhasImea = imeaMt;
    // O export do INDEA volta com ~1/4 do mês: gravar isso faria a planilha do
    // cliente REGREDIR e o IMEA regravar na segunda seguinte (ping-pong).
    await gravarAgregados([mt("MACHO", 90_000), mt("FEMEA", 60_000)], 7, "gta_condensada");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("grava quando a recoleta do mesmo mês supera o total do IMEA", async () => {
    linhasImea = imeaMt;
    await gravarAgregados([mt("MACHO", 400_000), mt("FEMEA", 300_000)], 7, "gta_condensada");
    expect(linhasGravadas()).toHaveLength(2);
  });

  it("empate não regrava — número igual não é mais completo", async () => {
    linhasImea = imeaMt;
    await gravarAgregados([mt("MACHO", 346_689), mt("FEMEA", 263_140)], 7, "gta_condensada");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("não bloqueia correção para baixo do RO, que nunca tem linha 'imea'", async () => {
    linhasImea = imeaMt; // o .in() do filtro pode trazer MT junto; RO não é MT
    await gravarAgregados([ro("MACHO", 10), ro("FEMEA", 10)], 7, "powerbi");
    expect(linhasGravadas()).toHaveLength(2);
  });

  it("bloqueia só a competência coberta pelo IMEA, não as outras do lote", async () => {
    linhasImea = imeaMt;
    await gravarAgregados(
      [mt("MACHO", 1, 8), mt("FEMEA", 1, 8), mt("MACHO", 400_000, 9), mt("FEMEA", 300_000, 9)],
      7,
      "gta_condensada",
    );
    expect(linhasGravadas()).toHaveLength(2);
    expect(linhasGravadas()!.every((l) => l.quantidade >= 300_000)).toBe(true);
  });

  it("lança quando a leitura das linhas do IMEA falha (não grava no escuro)", async () => {
    cadeia.then = (resolve) => resolve({ data: null, error: { message: "boom" } });
    await expect(
      gravarAgregados([mt("MACHO", 1), mt("FEMEA", 1)], 7, "gta_condensada"),
    ).rejects.toThrow(/boom/);
    cadeia.then = (resolve) => resolve({ data: linhasImea, error: null });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lote vazio não toca no banco", async () => {
    await gravarAgregados([], 7, "powerbi");
    expect(from).not.toHaveBeenCalled();
  });
});
