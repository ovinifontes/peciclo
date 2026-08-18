import { beforeEach, describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { gravarSnapshot, lerSnapshotAnterior } from "../../src/dados/ro-snapshots.js";

const upsert = vi.fn();
const limit = vi.fn();
const order = vi.fn(() => ({ limit }));
const lt = vi.fn(() => ({ order }));
const eq = vi.fn(() => ({ lt }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ upsert, select }));

beforeEach(() => {
  vi.clearAllMocks();
  obterCliente.mockReturnValue({ from });
});

describe("gravarSnapshot", () => {
  it("faz upsert das duas linhas (uma por sexo) pela PK — rodar 2x no dia sobrescreve", async () => {
    upsert.mockResolvedValue({ error: null });
    await gravarSnapshot({
      competencia: "2026-08-01",
      capturadoEm: "2026-08-18",
      porSexo: { FEMEA: 1200, MACHO: 1900 },
    });

    expect(from).toHaveBeenCalledWith("peciclo_ro_snapshots");
    const [linhas, opcoes] = upsert.mock.calls[0]!;
    expect(opcoes).toEqual({ onConflict: "competencia,sexo,capturado_em" });
    expect(linhas).toEqual([
      { competencia: "2026-08-01", sexo: "FEMEA", capturado_em: "2026-08-18", quantidade: 1200 },
      { competencia: "2026-08-01", sexo: "MACHO", capturado_em: "2026-08-18", quantidade: 1900 },
    ]);
  });

  it("lança quando o upsert falha", async () => {
    upsert.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(
      gravarSnapshot({
        competencia: "2026-08-01",
        capturadoEm: "2026-08-18",
        porSexo: { FEMEA: 1, MACHO: 2 },
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("lerSnapshotAnterior", () => {
  it("devolve o retrato mais recente ANTES do dia pedido, remontado por sexo", async () => {
    limit.mockResolvedValue({
      data: [
        { sexo: "FEMEA", capturado_em: "2026-08-17", quantidade: 1000 },
        { sexo: "MACHO", capturado_em: "2026-08-17", quantidade: 1500 },
      ],
      error: null,
    });

    const retrato = await lerSnapshotAnterior({ competencia: "2026-08-01", antesDe: "2026-08-18" });

    expect(retrato).toEqual({
      capturadoEm: "2026-08-17",
      porSexo: { FEMEA: 1000, MACHO: 1500 },
    });
    expect(eq).toHaveBeenCalledWith("competencia", "2026-08-01");
    expect(lt).toHaveBeenCalledWith("capturado_em", "2026-08-18");
    expect(order).toHaveBeenCalledWith("capturado_em", { ascending: false });
  });

  it("devolve null quando a competência ainda não tem retrato anterior", async () => {
    limit.mockResolvedValue({ data: [], error: null });
    await expect(
      lerSnapshotAnterior({ competencia: "2026-08-01", antesDe: "2026-08-18" }),
    ).resolves.toBeNull();
  });

  it("ignora linha órfã de um dia mais antigo que vaze na página", async () => {
    // Duas linhas por captura é o invariante do gravarSnapshot; se a página
    // trouxer dias misturados, só o dia mais recente conta.
    limit.mockResolvedValue({
      data: [
        { sexo: "FEMEA", capturado_em: "2026-08-17", quantidade: 1000 },
        { sexo: "MACHO", capturado_em: "2026-08-16", quantidade: 900 },
      ],
      error: null,
    });

    const retrato = await lerSnapshotAnterior({ competencia: "2026-08-01", antesDe: "2026-08-18" });
    expect(retrato).toEqual({ capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 0 } });
  });

  it("lança com a mensagem do banco quando a leitura falha", async () => {
    limit.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    await expect(
      lerSnapshotAnterior({ competencia: "2026-08-01", antesDe: "2026-08-18" }),
    ).rejects.toThrow(/relation does not exist/);
  });
});
