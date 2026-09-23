import { describe, expect, it } from "vitest";
import {
  conferirLote,
  parsearEstratificacao,
  somarPorSexo,
  valorGtaDoHtml,
  type GtaLida,
} from "../../src/coletores/mt-sindesa2.js";

/**
 * Recorte do HTML real da GTA (SINDESA 2, v_1.2.25), com os dados de pessoas
 * removidos: o que importa aqui é a FORMA — os spans ocultos com o id interno
 * na frente do texto de cada célula, e o sexo colado na faixa etária.
 */
const htmlGta = (linhas: Array<[string, number, number]>) => `
<div id="crudForm_j_idt19_j_idt1505_idTableGtaEstratificacao" class="ui-datatable">
<div class="ui-datatable-header">Estratificação</div>
<table role="grid"><thead><tr>
<th><span class="ui-column-title">Faixa Etária</span></th>
<th><span class="ui-column-title">Tipo de Saldo</span></th>
<th><span class="ui-column-title">Quantidade Saída</span></th>
<th><span class="ui-column-title">Quantidade Chegada</span></th>
</tr></thead>
<tbody id="crudForm_j_idt19_j_idt1505_idTableGtaEstratificacao_data" class="ui-datatable-data">
${linhas
  .map(
    ([faixa, saida, chegada], i) => `<tr data-ri="${i}" role="row">
<td role="gridcell"><span style="display: none;">83177278${i}</span>${faixa}</td>
<td role="gridcell"><span style="display: none;">83177278${i}</span>NORMAL</td>
<td role="gridcell"><span style="display: none;">83177278${i}</span><span class="tdTextAlignRight">${saida}</span></td>
<td role="gridcell"><span style="display: none;">43656142${i}</span><span class="tdTextAlignRight">${chegada}</span></td>
</tr>`,
  )
  .join("")}
</tbody></table></div>`;

describe("parsearEstratificacao", () => {
  it("lê faixa, sexo e quantidade, ignorando os spans ocultos", () => {
    const linhas = parsearEstratificacao(
      htmlGta([
        ["13 A 24 MESES - MACHO", 25, 25],
        ["25 A 36 MESES - FÊMEA", 17, 17],
      ]),
    );
    expect(linhas).toEqual([
      { faixa: "13 A 24 MESES", sexo: "MACHO", quantidade: 25 },
      { faixa: "25 A 36 MESES", sexo: "FEMEA", quantidade: 17 },
    ]);
  });

  it("usa a Quantidade SAÍDA, não a de chegada", () => {
    // Guia em trânsito pode ter chegada ainda zerada; contar a chegada
    // sumiria com o abate do dia.
    const linhas = parsearEstratificacao(htmlGta([["13 A 24 MESES - MACHO", 47, 0]]));
    expect(linhas[0]!.quantidade).toBe(47);
  });

  it("aceita FEMEA sem acento, como algumas linhas vêm", () => {
    const linhas = parsearEstratificacao(htmlGta([["0 A 12 MESES - FEMEA", 8, 8]]));
    expect(linhas[0]!.sexo).toBe("FEMEA");
  });

  it("devolve vazio quando a tabela não está na página", () => {
    expect(parsearEstratificacao("<html><body>Visualizar GTA</body></html>")).toEqual([]);
  });

  it("ignora linha sem sexo na faixa em vez de chutar um", () => {
    expect(parsearEstratificacao(htmlGta([["SEM CLASSIFICACAO", 10, 10]]))).toEqual([]);
  });
});

describe("valorGtaDoHtml", () => {
  it("lê o valor com ponto de milhar e vírgula decimal", () => {
    expect(valorGtaDoHtml("<b>Valor Taxa INDEA por GTA</b>:1.234,56")).toBe(1234.56);
    expect(valorGtaDoHtml("Valor Taxa INDEA por GTA: 496,32")).toBe(496.32);
  });

  it("devolve null quando o rótulo não aparece", () => {
    expect(valorGtaDoHtml("<html>Valor FETHAB por GTA: 2.632,13</html>")).toBeNull();
  });
});

const gta = (id: string, macho: number, femea: number, valorGta: number | null): GtaLida => ({
  id,
  linhas: [
    ...(macho ? [{ faixa: "13 A 24 MESES", sexo: "MACHO" as const, quantidade: macho }] : []),
    ...(femea ? [{ faixa: "25 A 36 MESES", sexo: "FEMEA" as const, quantidade: femea }] : []),
  ],
  valorGta,
});

describe("conferirLote", () => {
  // A taxa do INDEA é por animal (10,56 em 09/2026): valorGta / total de
  // animais tem que dar o mesmo para toda GTA do dia.
  it("não acusa nada quando toda GTA fecha na mesma razão", () => {
    const { razao, divergentes } = conferirLote([
      gta("1", 47, 0, 47 * 10.56),
      gta("2", 25, 25, 50 * 10.56),
      gta("3", 0, 42, 42 * 10.56),
    ]);
    expect(divergentes).toEqual([]);
    expect(razao).toBeCloseTo(10.56, 6);
  });

  it("acusa a GTA cujo total não bate com o que ela pagou", () => {
    // Simula o que um parser quebrado produz: a GTA 2 perdeu metade dos
    // animais, então a razão dela dispara e ela é denunciada.
    const { divergentes } = conferirLote([
      gta("1", 47, 0, 47 * 10.56),
      gta("2", 25, 0, 50 * 10.56),
      gta("3", 0, 42, 42 * 10.56),
      gta("4", 30, 0, 30 * 10.56),
    ]);
    expect(divergentes).toEqual(["2"]);
  });

  it("não inventa razão quando nenhuma GTA traz o valor", () => {
    expect(conferirLote([gta("1", 10, 0, null)])).toEqual({ razao: null, divergentes: [] });
  });

  it("sobrevive a um dia sem nenhuma GTA", () => {
    expect(conferirLote([])).toEqual({ razao: null, divergentes: [] });
  });
});

describe("somarPorSexo", () => {
  it("soma as faixas de todas as GTAs em uma linha por sexo", () => {
    const agregados = somarPorSexo([gta("1", 47, 0, null), gta("2", 25, 25, null)], "2026-09-15");
    expect(agregados).toEqual(
      expect.arrayContaining([
        { uf: "MT", data: "2026-09-15", finalidade: "ABATE", sexo: "MACHO", quantidade: 72 },
        { uf: "MT", data: "2026-09-15", finalidade: "ABATE", sexo: "FEMEA", quantidade: 25 },
      ]),
    );
    expect(agregados).toHaveLength(2);
  });

  it("dia sem GTA nenhuma não vira linha de zero no banco", () => {
    expect(somarPorSexo([], "2026-09-15")).toEqual([]);
  });
});
