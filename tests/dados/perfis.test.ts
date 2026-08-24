import { describe, expect, it, vi } from "vitest";

const obterCliente = vi.hoisted(() => vi.fn());
vi.mock("../../src/dados/cliente.js", () => ({ obterCliente }));

import {
  listarTelefonesAtivos,
  motivoNinguemRecebeu,
  unirDestinatarios,
} from "../../src/dados/perfis.js";

/** Imita a cadeia do supabase-js: qualquer método devolve a si mesma e o await resolve. */
function consultaQueResolve(resultado: unknown) {
  const cadeia: any = {};
  for (const metodo of ["from", "select", "eq", "not"]) cadeia[metodo] = () => cadeia;
  cadeia.then = (aoResolver: (v: unknown) => unknown) =>
    Promise.resolve(resultado).then(aoResolver);
  return cadeia;
}

describe("unirDestinatarios", () => {
  it("junta os telefones do banco com os da configuração, sem repetir", () => {
    expect(unirDestinatarios(["5565992249488"], ["5565996210067", "5565992249488"])).toEqual([
      "5565992249488",
      "5565996210067",
    ]);
  });

  it("mantém os da configuração quando o banco está vazio", () => {
    // Rede de segurança: se a tabela estiver vazia ou a query falhar, o envio
    // NÃO pode terminar em zero destinatários — silêncio é a pior falha aqui.
    expect(unirDestinatarios(["5565992249488"], [])).toEqual(["5565992249488"]);
  });

  it("normaliza máscara e descarta número inválido sem derrubar o resto", () => {
    expect(unirDestinatarios(["+55 (65) 99224-9488"], ["123", "5565996210067"])).toEqual([
      "5565992249488",
      "5565996210067",
    ]);
  });
});

describe("listarTelefonesAtivos", () => {
  it("devolve os telefones dos clientes ativos", async () => {
    obterCliente.mockReturnValue(
      consultaQueResolve({
        data: [{ telefone_whatsapp: "5565996210067" }, { telefone_whatsapp: "5565992249488" }],
        error: null,
      }),
    );
    expect(await listarTelefonesAtivos()).toEqual(["5565996210067", "5565992249488"]);
  });

  it("devolve lista vazia quando o banco responde com erro, sem lançar", async () => {
    obterCliente.mockReturnValue(
      consultaQueResolve({ data: null, error: { message: "column does not exist" } }),
    );
    await expect(listarTelefonesAtivos()).resolves.toEqual([]);
  });

  it("devolve lista vazia quando a consulta explode, sem lançar", async () => {
    obterCliente.mockImplementation(() => {
      throw new Error("sem rede");
    });
    await expect(listarTelefonesAtivos()).resolves.toEqual([]);
  });
});

describe("motivoNinguemRecebeu", () => {
  it("cala quando pelo menos um cliente recebeu", () => {
    expect(motivoNinguemRecebeu("a planilha", 1, 3)).toBeNull();
  });

  it("acusa quando a Evolution aceitou a conexão mas recusou todo envio", () => {
    expect(motivoNinguemRecebeu("a planilha", 0, 3)).toBe(
      "nenhum dos 3 destinatários recebeu a planilha",
    );
  });

  it("acusa também a lista vazia — run verde com zero envio é a pior falha", () => {
    expect(motivoNinguemRecebeu("o cenário", 0, 0)).toBe(
      "lista de destinatários vazia — o cenário não foi para ninguém",
    );
  });
});
