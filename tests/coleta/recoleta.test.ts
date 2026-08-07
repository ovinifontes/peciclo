import { describe, expect, it } from "vitest";
import {
  MAX_TENTATIVAS_RECOLETA,
  assuntoEsgotado,
  assuntoRecuperado,
  decidirDesfecho,
  normalizarUfs,
} from "../../src/coleta/recoleta.js";

describe("normalizarUfs", () => {
  it("mantém apenas UFs coletáveis, descartando as desconhecidas", () => {
    expect(normalizarUfs(["MT", "GO", "XX"])).toEqual(["MT"]);
  });

  it("remove duplicatas", () => {
    expect(normalizarUfs(["MT", "MT", "MS"])).toEqual(["MS", "MT"]);
  });

  it("normaliza caixa e espaços", () => {
    expect(normalizarUfs([" mt ", "ro"])).toEqual(["MT", "RO"]);
  });

  it("devolve na ordem canônica MS, MT, RO, PA", () => {
    expect(normalizarUfs(["PA", "RO", "MT", "MS"])).toEqual(["MS", "MT", "RO", "PA"]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(normalizarUfs([])).toEqual([]);
  });
});

describe("decidirDesfecho", () => {
  it("sem falhas remanescentes é recuperação, em qualquer tentativa", () => {
    expect(decidirDesfecho({ ufsAindaComFalha: [], tentativa: 1 })).toEqual({ tipo: "recuperado" });
    expect(decidirDesfecho({ ufsAindaComFalha: [], tentativa: 2 })).toEqual({ tipo: "recuperado" });
  });

  it("falha na tentativa 1 reagenda a tentativa 2 só com as UFs que faltam", () => {
    expect(decidirDesfecho({ ufsAindaComFalha: ["MT"], tentativa: 1 })).toEqual({
      tipo: "reagendar",
      ufs: ["MT"],
      proximaTentativa: 2,
    });
  });

  it("falha na última tentativa esgota", () => {
    expect(decidirDesfecho({ ufsAindaComFalha: ["MT", "RO"], tentativa: 2 })).toEqual({
      tipo: "esgotado",
      ufs: ["MT", "RO"],
    });
  });

  it("tentativa acima do limite (defensivo) também esgota, nunca reagenda", () => {
    expect(decidirDesfecho({ ufsAindaComFalha: ["MS"], tentativa: 3 })).toEqual({
      tipo: "esgotado",
      ufs: ["MS"],
    });
  });

  it("respeita um limite de tentativas customizado", () => {
    expect(decidirDesfecho({ ufsAindaComFalha: ["PA"], tentativa: 2, maxTentativas: 3 })).toEqual({
      tipo: "reagendar",
      ufs: ["PA"],
      proximaTentativa: 3,
    });
  });

  it("o limite padrão é 2 tentativas", () => {
    expect(MAX_TENTATIVAS_RECOLETA).toBe(2);
  });
});

describe("mensagens ao operador", () => {
  it("recuperação de uma UF", () => {
    expect(assuntoRecuperado(["MT"], 2)).toBe("✅ Recoleta: MT recuperado na tentativa 2");
  });

  it("recuperação de várias UFs concorda no plural", () => {
    expect(assuntoRecuperado(["MS", "MT"], 1)).toBe(
      "✅ Recoleta: MS, MT recuperados na tentativa 1",
    );
  });

  it("esgotamento de uma UF aponta a autocorreção de amanhã", () => {
    expect(assuntoEsgotado(["MT"])).toBe(
      "❌ Recoleta: MT falhou nas 2 tentativas — fica para a coleta de amanhã",
    );
  });

  it("esgotamento de várias UFs concorda no plural", () => {
    expect(assuntoEsgotado(["MT", "RO"])).toBe(
      "❌ Recoleta: MT, RO falharam nas 2 tentativas — ficam para a coleta de amanhã",
    );
  });
});
