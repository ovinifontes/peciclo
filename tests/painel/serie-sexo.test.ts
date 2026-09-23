import { describe, expect, it } from "vitest";
import {
  serieSomadaPorSexo,
  type EntradaSexo,
} from "../../web/src/app/(painel)/painel/serie-sexo.js";
import type { UF } from "../../src/tipos.js";

const entrada = (
  chave: string,
  uf: UF,
  femeas: number | null,
  machos: number | null,
): EntradaSexo => ({ chave, rotulo: chave.slice(5), uf, celula: { femeas, machos } });

describe("serieSomadaPorSexo", () => {
  it("soma os estados selecionados num ponto só por balde", () => {
    const pontos = serieSomadaPorSexo(
      [entrada("2026-07", "MT", 100, 200), entrada("2026-07", "MS", 50, 150)],
      ["MT", "MS"],
    );
    expect(pontos).toHaveLength(1);
    expect(pontos[0]).toMatchObject({ femeas: 150, machos: 350, pctFemeas: 30 });
  });

  it("ignora estado que não está selecionado", () => {
    const pontos = serieSomadaPorSexo(
      [entrada("2026-07", "MT", 100, 100), entrada("2026-07", "MS", 900, 900)],
      ["MT"],
    );
    expect(pontos[0]).toMatchObject({ femeas: 100, machos: 100 });
  });

  it("descarta o balde em que UM dos selecionados não publicou", () => {
    // O ponto do desenho somado: com 2 estados e só 1 publicado, a barra
    // cairia pela metade e leria como o mercado desabando.
    const pontos = serieSomadaPorSexo(
      [
        entrada("2026-06", "MT", 100, 100),
        entrada("2026-06", "MS", 100, 100),
        entrada("2026-07", "MT", 100, 100),
      ],
      ["MT", "MS"],
    );
    expect(pontos.map((p) => p.chave)).toEqual(["2026-06"]);
  });

  it("descarta o balde em que falta UM dos sexos", () => {
    const pontos = serieSomadaPorSexo([entrada("2026-07", "MT", 100, null)], ["MT"]);
    expect(pontos).toEqual([]);
  });

  it("devolve os baldes em ordem cronológica, venha a entrada como vier", () => {
    const pontos = serieSomadaPorSexo(
      [
        entrada("2026-08", "MT", 1, 1),
        entrada("2026-06", "MT", 1, 1),
        entrada("2026-07", "MT", 1, 1),
      ],
      ["MT"],
    );
    expect(pontos.map((p) => p.chave)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("sem estado selecionado não desenha nada", () => {
    expect(serieSomadaPorSexo([entrada("2026-07", "MT", 1, 1)], [])).toEqual([]);
  });

  it("balde zerado não vira ponto — dividir daria NaN na porcentagem", () => {
    expect(serieSomadaPorSexo([entrada("2026-07", "MT", 0, 0)], ["MT"])).toEqual([]);
  });
});
