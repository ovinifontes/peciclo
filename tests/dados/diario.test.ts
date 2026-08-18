import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgregadoDiario } from "../../src/tipos.js";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { gravarAgregadosDiarios, rollupDiario } from "../../src/dados/diario.js";

const rpc = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

beforeEach(() => {
  vi.clearAllMocks();
  obterCliente.mockReturnValue({ rpc, from });
});

describe("rollupDiario", () => {
  it("chama a função do banco com a janela e devolve as linhas alteradas", async () => {
    rpc.mockResolvedValue({ data: 5, error: null });
    const alteradas = await rollupDiario({
      uf: "MS",
      janela: { inicio: "2026-08-01", fim: "2026-08-17" },
      coletaId: 42,
    });
    expect(alteradas).toBe(5);
    expect(rpc).toHaveBeenCalledWith("peciclo_rollup_abate_diario", {
      p_uf: "MS",
      p_de: "2026-08-01",
      p_ate: "2026-08-17",
      p_coleta_id: 42,
    });
  });

  it("devolve 0 quando o banco responde null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      rollupDiario({ uf: "MS", janela: { inicio: "2026-08-01", fim: "2026-08-01" }, coletaId: 1 }),
    ).resolves.toBe(0);
  });

  it("lança com a mensagem do banco quando a rpc falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(
      rollupDiario({ uf: "MS", janela: { inicio: "2026-08-01", fim: "2026-08-01" }, coletaId: 1 }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("gravarAgregadosDiarios", () => {
  const agregados: AgregadoDiario[] = [
    { uf: "MT", data: "2026-08-15", finalidade: "ABATE", sexo: "FEMEA", quantidade: 320 },
    { uf: "MT", data: "2026-08-15", finalidade: "ABATE", sexo: "MACHO", quantidade: 480 },
  ];

  it("faz upsert em peciclo_abate_diario com fonte gta_condensada_dia e a chave do dia", async () => {
    upsert.mockResolvedValue({ error: null });
    await gravarAgregadosDiarios(agregados, 42);

    expect(from).toHaveBeenCalledWith("peciclo_abate_diario");
    const [linhas, opcoes] = upsert.mock.calls[0]!;
    expect(opcoes).toEqual({ onConflict: "uf,data,finalidade,sexo" });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({
      uf: "MT",
      data: "2026-08-15",
      finalidade: "ABATE",
      sexo: "FEMEA",
      quantidade: 320,
      fonte: "gta_condensada_dia",
      coleta_id: 42,
    });
    expect(typeof linhas[0].atualizado_em).toBe("string");
  });

  it("não toca no banco com lista vazia", async () => {
    await gravarAgregadosDiarios([], 42);
    expect(obterCliente).not.toHaveBeenCalled();
  });

  it("lança quando o upsert falha", async () => {
    upsert.mockResolvedValue({ error: { message: "violates check constraint" } });
    await expect(gravarAgregadosDiarios(agregados, 42)).rejects.toThrow(
      /violates check constraint/,
    );
  });
});
