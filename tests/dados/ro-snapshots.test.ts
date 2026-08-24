import { beforeEach, describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { gravarSnapshot, lerHistoricoSnapshots } from "../../src/dados/ro-snapshots.js";

const upsert = vi.fn();
const order = vi.fn();
const lt = vi.fn(() => ({ order }));
const gte = vi.fn(() => ({ lt }));
const eq = vi.fn(() => ({ gte }));
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

describe("lerHistoricoSnapshots", () => {
  it("devolve os retratos anteriores em ordem crescente, remontados por sexo", async () => {
    order.mockResolvedValue({
      data: [
        { sexo: "FEMEA", capturado_em: "2026-08-16", quantidade: 900 },
        { sexo: "MACHO", capturado_em: "2026-08-16", quantidade: 1400 },
        { sexo: "FEMEA", capturado_em: "2026-08-17", quantidade: 1000 },
        { sexo: "MACHO", capturado_em: "2026-08-17", quantidade: 1500 },
      ],
      error: null,
    });

    const historico = await lerHistoricoSnapshots({
      competencia: "2026-08-01",
      antesDe: "2026-08-18",
    });

    expect(historico).toEqual([
      { capturadoEm: "2026-08-16", porSexo: { FEMEA: 900, MACHO: 1400 } },
      { capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 1500 } },
    ]);
    expect(from).toHaveBeenCalledWith("peciclo_ro_snapshots");
    expect(eq).toHaveBeenCalledWith("competencia", "2026-08-01");
    expect(lt).toHaveBeenCalledWith("capturado_em", "2026-08-18");
    expect(order).toHaveBeenCalledWith("capturado_em", { ascending: true });
  });

  it("limita a janela aos últimos 12 dias por padrão, e respeita `dias`", async () => {
    order.mockResolvedValue({ data: [], error: null });

    await lerHistoricoSnapshots({ competencia: "2026-08-01", antesDe: "2026-08-18" });
    expect(gte).toHaveBeenCalledWith("capturado_em", "2026-08-06");

    // Janela curta atravessando a virada de mês, contada em UTC.
    await lerHistoricoSnapshots({ competencia: "2026-09-01", antesDe: "2026-09-02", dias: 3 });
    expect(gte).toHaveBeenLastCalledWith("capturado_em", "2026-08-30");
  });

  it("devolve [] quando a competência ainda não tem retrato anterior", async () => {
    order.mockResolvedValue({ data: [], error: null });
    await expect(
      lerHistoricoSnapshots({ competencia: "2026-08-01", antesDe: "2026-08-18" }),
    ).resolves.toEqual([]);
  });

  it("retrato meio gravado deixa o sexo ausente em 0 em vez de sumir com o dia", async () => {
    order.mockResolvedValue({
      data: [
        { sexo: "FEMEA", capturado_em: "2026-08-16", quantidade: 900 },
        { sexo: "FEMEA", capturado_em: "2026-08-17", quantidade: 1000 },
        { sexo: "MACHO", capturado_em: "2026-08-17", quantidade: 1500 },
      ],
      error: null,
    });

    const historico = await lerHistoricoSnapshots({
      competencia: "2026-08-01",
      antesDe: "2026-08-18",
    });
    expect(historico).toEqual([
      { capturadoEm: "2026-08-16", porSexo: { FEMEA: 900, MACHO: 0 } },
      { capturadoEm: "2026-08-17", porSexo: { FEMEA: 1000, MACHO: 1500 } },
    ]);
  });

  it("lança com a mensagem do banco quando a leitura falha", async () => {
    order.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    await expect(
      lerHistoricoSnapshots({ competencia: "2026-08-01", antesDe: "2026-08-18" }),
    ).rejects.toThrow(/relation does not exist/);
  });
});
