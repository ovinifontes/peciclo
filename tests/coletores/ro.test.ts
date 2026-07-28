import { describe, expect, it } from "vitest";
import {
  extrairChaveRecurso,
  montarConsulta,
  parsearRespostaPowerBi,
} from "../../src/coletores/ro.js";

describe("extrairChaveRecurso", () => {
  it("decodifica a resource key do parâmetro r=", () => {
    const url =
      "https://app.powerbi.com/view?r=eyJrIjoiMzFjN2IwZjYtNWVkZS00MzU4LWJlMzUtYjhmYzQ5YWMwYWIxIiwidCI6IjJhOWFiYjFhLTVmMzYtNDA1Ny1hNzVjLTIwYjQyOTZjNTg0MiJ9";
    expect(extrairChaveRecurso(url)).toBe("31c7b0f6-5ede-4358-be35-b8fc49ac0ab1");
  });

  it("devolve null quando não há parâmetro r", () => {
    expect(extrairChaveRecurso("https://app.powerbi.com/view")).toBeNull();
  });
});

describe("montarConsulta", () => {
  it("monta a query com bovino, abate e o mês/ano pedidos", () => {
    const body = JSON.stringify(montarConsulta(2026, 5));
    expect(body).toContain("vw_DASHBOARD_GTA_ESTRATIFICACAO_SITE");
    expect(body).toContain("FAIXA_ETARIA_PERSONALIZADA");
    expect(body).toContain("2026L");
    expect(body).toContain("5L");
    expect(body).toContain("'Abate'");
  });
});

describe("parsearRespostaPowerBi", () => {
  // Resposta REAL do IDARON para bovino/abate em jan/2026 (categorias com
  // sufixo " F"/" M"). Total F=154166, M=125414 — idêntico à planilha do sócio.
  const respostaReal = {
    results: [
      {
        result: {
          data: {
            dsr: {
              DS: [
                {
                  PH: [
                    {
                      DM0: [
                        { S: [{ N: "G0", T: 1 }, { N: "M0", T: 4 }], C: ["00 a 12 meses F", 6] },
                        { C: ["00 a 12 meses M", 2] },
                        { C: ["13 a 24 meses F", 48906] },
                        { C: ["13 a 24 meses M", 50115] },
                        { C: ["25 a 36 meses F", 45864] },
                        { C: ["25 a 36 meses M", 66700] },
                        { C: ["36+ meses F", 59390] },
                        { C: ["36+ meses M", 8597] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    ],
  };

  it("soma fêmea e macho pelo sufixo da faixa etária", () => {
    expect(parsearRespostaPowerBi(respostaReal)).toEqual({ femeas: 154166, machos: 125414 });
  });

  it("trata o bitmask de repetição (R) do formato DSR", () => {
    // Se a quantidade se repete, o DSR omite-a de C e marca o bit em R.
    const resp = {
      results: [{ result: { data: { dsr: { DS: [{ PH: [{ DM0: [
        { C: ["13 a 24 meses F", 100] },
        { C: ["13 a 24 meses M"], R: 2 }, // quantidade repetida (100) do anterior
      ] }] }] } } } }],
    };
    expect(parsearRespostaPowerBi(resp)).toEqual({ femeas: 100, machos: 100 });
  });

  it("lança erro quando a resposta não tem dados", () => {
    expect(() => parsearRespostaPowerBi({ results: [] })).toThrow(/sem dados/);
  });
});
