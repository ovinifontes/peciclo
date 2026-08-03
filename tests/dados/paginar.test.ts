import { describe, expect, it } from "vitest";
import { lerTudo } from "../../src/dados/paginar.js";

describe("lerTudo", () => {
  it("junta várias páginas de 1000 (o que o limite do Supabase cortaria)", async () => {
    const total = Array.from({ length: 2350 }, (_, i) => ({ i }));
    const chamadas: Array<[number, number]> = [];
    const dados = await lerTudo(async (de, ate) => {
      chamadas.push([de, ate]);
      return { data: total.slice(de, ate + 1), error: null };
    }, "teste");

    expect(dados).toHaveLength(2350);
    expect(dados.at(-1)).toEqual({ i: 2349 }); // o dado RECENTE, que se perdia
    expect(chamadas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("faz uma chamada só quando cabe numa página", async () => {
    let n = 0;
    const dados = await lerTudo(async () => { n++; return { data: [{ a: 1 }], error: null }; }, "teste");
    expect(dados).toHaveLength(1);
    expect(n).toBe(1);
  });

  it("propaga erro com o rótulo", async () => {
    await expect(
      lerTudo(async () => ({ data: null, error: { message: "boom" } }), "minha tabela"),
    ).rejects.toThrow(/minha tabela.*boom/);
  });
});
