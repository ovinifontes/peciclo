import { readFile } from "node:fs/promises";
import type { Sexo, UF } from "../tipos.js";
import { obterCliente } from "../dados/cliente.js";

/** Ordem das colunas na planilha do sócio: pares Fêmea/Macho por estado. */
const ORDEM_ESTADOS: Array<UF | null> = ["MT", "MS", "RO", "PA", null, null];

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Correções confirmadas com o sócio antes de semear o banco. */
const COLUNAS_INVERTIDAS = new Set(["PA-2025-7"]);

export interface LinhaHistorico {
  uf: UF;
  ano: number;
  mes: number;
  sexo: Sexo;
  quantidade: number;
}

function parsearNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\./g, "").replace(/,/g, "");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function lerCsvHistorico(caminho: string): Promise<LinhaHistorico[]> {
  const texto = await readFile(caminho, "utf8");
  const linhas = texto.split("\n").slice(2); // pula as duas linhas de cabeçalho
  const saida: LinhaHistorico[] = [];

  for (const linha of linhas) {
    const celulas = linha.split(",");
    const mes = MESES[(celulas[0] ?? "").trim().toLowerCase()];
    const ano = Number((celulas[1] ?? "").trim());
    if (!mes || !Number.isFinite(ano)) continue;

    ORDEM_ESTADOS.forEach((uf, i) => {
      if (!uf) return;
      let femea = parsearNumero(celulas[2 + i * 2] ?? "");
      let macho = parsearNumero(celulas[3 + i * 2] ?? "");
      if (femea === null && macho === null) return;

      if (COLUNAS_INVERTIDAS.has(`${uf}-${ano}-${mes}`)) {
        [femea, macho] = [macho, femea];
      }

      if (femea !== null) saida.push({ uf, ano, mes, sexo: "FEMEA", quantidade: femea });
      if (macho !== null) saida.push({ uf, ano, mes, sexo: "MACHO", quantidade: macho });
    });
  }

  return saida;
}

/** Semeia abate_mensal. Não sobrescreve dado já coletado automaticamente. */
export async function semearHistorico(caminho: string): Promise<number> {
  const linhas = await lerCsvHistorico(caminho);
  const { error } = await obterCliente()
    .from("abate_mensal")
    .upsert(
      linhas.map((l) => ({
        uf: l.uf,
        ano: l.ano,
        mes: l.mes,
        finalidade: "ABATE",
        sexo: l.sexo,
        quantidade: l.quantidade,
        fonte: "manual",
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,ano,mes,finalidade,sexo", ignoreDuplicates: true },
    );

  if (error) throw new Error(`Falha ao semear histórico: ${error.message}`);
  return linhas.length;
}
