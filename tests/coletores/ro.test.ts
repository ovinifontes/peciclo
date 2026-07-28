import { describe, expect, it } from "vitest";
import { extrairChaveRecurso, parsearRespostaPowerBi } from "../../src/coletores/ro.js";

describe("extrairChaveRecurso", () => {
  it("decodifica a resource key do parâmetro r=", () => {
    const url =
      "https://app.powerbi.com/view?r=eyJrIjoiMzFjN2IwZjYtNWVkZS00MzU4LWJlMzUtYjhmYzQ5YWMwYWIxIiwidCI6IjJhOWFiYjFhLTVmMzYtNDA1Ny1hNzVjLTIwYjQyOTZjNTg0MiJ9";
    expect(extrairChaveRecurso(url)).toBe("31c7b0f6-5ede-4358-be35-b8fc49ac0ab1");
  });

  it("devolve null quando não há parâmetro r", () => {
    expect(extrairChaveRecurso("https://app.powerbi.com/view")).toBeNull();
  });

  it("devolve null quando o r= não é base64 de JSON válido", () => {
    expect(extrairChaveRecurso("https://app.powerbi.com/view?r=lixo")).toBeNull();
  });
});

describe("parsearRespostaPowerBi", () => {
  it("extrai os dois últimos números dos arrays C do formato DSR", () => {
    // Estrutura mínima que imita o DSR do Power BI (dicionários + linhas em C).
    const dsr = {
      results: [
        {
          result: {
            data: {
              dsr: {
                DS: [{ PH: [{ DM0: [{ C: [1, 11365] }, { C: [2, 14930] }] }] }],
              },
            },
          },
        },
      ],
    };
    expect(parsearRespostaPowerBi(dsr)).toEqual({ femeas: 11365, machos: 14930 });
  });

  it("lança quando não há números suficientes", () => {
    expect(() => parsearRespostaPowerBi({ vazio: true })).toThrow(/sem os totais/);
  });
});
