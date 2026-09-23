import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { legendaPlanilha, montarGradeDados } from "../../src/planilha/gerar.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

const dados: LinhaMensal[] = [
  { uf: "MT", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 333650 },
  { uf: "MT", ano: 2025, mes: 1, sexo: "MACHO", quantidade: 288211 },
  { uf: "MS", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 185419 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "FEMEA", quantidade: 188406 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "MACHO", quantidade: 152453 },
];

describe("montarGradeDados", () => {
  it("mostra só os estados visíveis, com GO e SP vazios no fim", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    // O PA está escondido desde 23/09/2026 (ver UFS_VISIVEIS em tipos.ts).
    expect(grade.cabecalhoEstados).toEqual([
      "Mato Grosso", "Mato Grosso do Sul", "Rondonia", "Goias", "São Paulo",
    ]);
    expect(grade.cabecalhoColunas).toHaveLength(15);
    expect(grade.cabecalhoColunas.slice(0, 3)).toEqual(["Fêmea", "Macho", "% Fêmeas"]);
  });

  it("posiciona cada valor na célula certa", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const jan2025 = grade.linhas.find((l) => l.ano === 2025 && l.mes === 1)!;
    expect(jan2025.rotuloMes).toBe("Janeiro");
    expect(jan2025.valores[0]).toBe(333650); // MT fêmea
    expect(jan2025.valores[1]).toBe(288211); // MT macho
    expect(jan2025.valores[3]).toBe(185419); // MS fêmea
    expect(jan2025.valores[4]).toBeNull();   // MS macho ausente
    expect(jan2025.valores[9]).toBeNull();   // Goiás fêmea, sempre vazio
  });

  it("gera todos os meses do intervalo, mesmo sem dados", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.linhas).toHaveLength(24);
    expect(grade.linhas[23]!.rotuloMes).toBe("Dezembro");
    expect(grade.linhas[23]!.ano).toBe(2026);
  });

  it("estado escondido não ocupa coluna nenhuma", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.cabecalhoEstados).not.toContain("Pará");
    // Com MT, MS e RO visíveis, a 4ª posição já é Goiás — e Goiás é sempre
    // vazio. Se o PA voltasse sem este teste ser revisto, ele apareceria aqui.
    const maio = grade.linhas.find((l) => l.ano === 2026 && l.mes === 5)!;
    expect(maio.valores[9]).toBeNull();
    expect(maio.valores[10]).toBeNull();
  });

  it("calcula a % de fêmeas de cada estado ao lado do par", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const jan2025 = grade.linhas.find((l) => l.ano === 2025 && l.mes === 1)!;
    expect(jan2025.valores[2]).toBeCloseTo(333650 / (333650 + 288211), 6); // MT
  });

  it("não inventa % quando falta um dos sexos", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const jan2025 = grade.linhas.find((l) => l.ano === 2025 && l.mes === 1)!;
    // MS tem fêmea e não tem macho: dividir daria 100% e venderia mês
    // incompleto como leitura do ciclo.
    expect(jan2025.valores[5]).toBeNull();
    // Goiás não tem nada.
    expect(jan2025.valores[11]).toBeNull();
  });
});

describe("legendaPlanilha", () => {
  it("sem falha, diz só a data", () => {
    expect(legendaPlanilha("2026-08-24")).toBe("Abate bovino — atualizado em 2026-08-24");
  });

  it("com um estado parado, avisa o cliente em vez de vender dado velho como fresco", () => {
    const legenda = legendaPlanilha("2026-08-24", ["MT"]);
    expect(legenda).toContain("Abate bovino — atualizado em 2026-08-24");
    expect(legenda).toContain("Mato Grosso não atualizou hoje");
    expect(legenda).toContain("última atualização");
  });

  it("com vários, lista no plural e com nome de estado, não sigla", () => {
    expect(legendaPlanilha("2026-08-24", ["MT", "RO"])).toContain(
      "Mato Grosso e Rondonia não atualizaram hoje",
    );
    expect(legendaPlanilha("2026-08-24", ["MT", "RO", "MS"])).toContain(
      "Mato Grosso, Rondonia e Mato Grosso do Sul não atualizaram hoje",
    );
  });

  it("não avisa sobre estado que a planilha nem mostra", () => {
    // Dizer "Pará não atualizou" numa planilha sem coluna de Pará só gera
    // pergunta para o cliente.
    const legenda = legendaPlanilha("2026-08-24", ["MT", "PA"]);
    expect(legenda).toContain("Mato Grosso não atualizou hoje");
    expect(legenda).not.toContain("Pará");
  });

  it("UF desconhecida não quebra a legenda", () => {
    expect(legendaPlanilha("2026-08-24", ["ZZ"])).toContain("ZZ não atualizou hoje");
  });
});
