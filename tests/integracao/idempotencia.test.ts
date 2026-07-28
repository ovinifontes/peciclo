import { describe, expect, it } from "vitest";
import { chaveNatural, deduplicar } from "../../src/dados/registros.js";
import { parsearMs } from "../../src/coletores/ms.js";

const FIXTURE = "tests/fixtures/ms-iagro-2026-07-20-a-26.xlsx";

describe("idempotência do parse", () => {
  it("parsear duas vezes produz exatamente o mesmo resultado", async () => {
    const primeira = await parsearMs(FIXTURE);
    const segunda = await parsearMs(FIXTURE);
    expect(segunda).toEqual(primeira);
  });

  it("deduplicar é idempotente: aplicar de novo não muda nada", async () => {
    const registros = await parsearMs(FIXTURE);
    const umaVez = deduplicar(registros);
    const duasVezes = deduplicar(umaVez);
    expect(duasVezes).toEqual(umaVez);
  });

  it("todas as chaves naturais são únicas após deduplicar", async () => {
    const unicos = deduplicar(await parsearMs(FIXTURE));
    const chaves = unicos.map(chaveNatural);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("deduplicar preserva o total de animais", async () => {
    const registros = await parsearMs(FIXTURE);
    const soma = (lista: typeof registros) => lista.reduce((s, r) => s + r.quantidade, 0);
    expect(soma(deduplicar(registros))).toBe(soma(registros));
  });
});
