import { describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import { chaveAlerta, deveAlertar, registrarAlerta } from "../../src/dados/alertas-enviados.js";

/** Imita a cadeia do supabase-js: qualquer método devolve a si mesma e o await resolve. */
function consultaQueResolve(resultado: unknown) {
  const cadeia: any = {};
  for (const metodo of ["from", "select", "eq", "gte", "limit", "upsert"]) {
    cadeia[metodo] = () => cadeia;
  }
  cadeia.then = (aoResolver: (v: unknown) => unknown) =>
    Promise.resolve(resultado).then(aoResolver);
  return cadeia;
}

describe("chaveAlerta", () => {
  it("é estável para o mesmo conteúdo", () => {
    expect(chaveAlerta("MT parou", "detalhe")).toBe(chaveAlerta("MT parou", "detalhe"));
  });

  it("muda quando o assunto ou o detalhe mudam", () => {
    const base = chaveAlerta("MT parou", "detalhe");
    expect(chaveAlerta("RO parou", "detalhe")).not.toBe(base);
    expect(chaveAlerta("MT parou", "outro detalhe")).not.toBe(base);
  });

  it("não confunde a fronteira assunto/detalhe", () => {
    // "a\nb" + "" não pode colidir com "a" + "b".
    expect(chaveAlerta("a\nb", "")).not.toBe(chaveAlerta("a", "b"));
  });
});

describe("deveAlertar", () => {
  it("alerta quando não há registro recente", async () => {
    obterCliente.mockReturnValue(consultaQueResolve({ data: [], error: null }));
    await expect(deveAlertar("abc")).resolves.toBe(true);
  });

  it("suprime quando o mesmo alerta já saiu na janela", async () => {
    obterCliente.mockReturnValue(consultaQueResolve({ data: [{ chave: "abc" }], error: null }));
    await expect(deveAlertar("abc")).resolves.toBe(false);
  });

  it("filtra pela janela de 3 dias, não pela tabela inteira", async () => {
    const gte = vi.fn();
    const cadeia: any = {};
    for (const m of ["from", "select", "eq", "limit"]) cadeia[m] = () => cadeia;
    cadeia.gte = (coluna: string, valor: string) => {
      gte(coluna, valor);
      return cadeia;
    };
    cadeia.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    obterCliente.mockReturnValue(cadeia);

    await deveAlertar("abc");
    const [coluna, desde] = gte.mock.calls[0]!;
    expect(coluna).toBe("enviado_em");
    const dias = (Date.now() - Date.parse(desde as string)) / 86_400_000;
    expect(dias).toBeGreaterThan(2.9);
    expect(dias).toBeLessThan(3.1);
  });

  it("em dúvida, alerta: erro do banco não cala o aviso", async () => {
    obterCliente.mockReturnValue(
      consultaQueResolve({ data: null, error: { message: "relation does not exist" } }),
    );
    await expect(deveAlertar("abc")).resolves.toBe(true);
  });

  it("em dúvida, alerta: consulta que explode não cala o aviso", async () => {
    obterCliente.mockImplementation(() => {
      throw new Error("sem rede");
    });
    await expect(deveAlertar("abc")).resolves.toBe(true);
  });
});

describe("registrarAlerta", () => {
  it("grava por upsert, sem lançar", async () => {
    obterCliente.mockReturnValue(consultaQueResolve({ error: null }));
    await expect(registrarAlerta("abc", "MT parou")).resolves.toBeUndefined();
  });

  it("não lança quando o banco recusa a gravação", async () => {
    obterCliente.mockReturnValue(consultaQueResolve({ error: { message: "sem permissão" } }));
    await expect(registrarAlerta("abc", "MT parou")).resolves.toBeUndefined();
  });

  it("não lança quando a gravação explode", async () => {
    obterCliente.mockImplementation(() => {
      throw new Error("sem rede");
    });
    await expect(registrarAlerta("abc", "MT parou")).resolves.toBeUndefined();
  });
});
