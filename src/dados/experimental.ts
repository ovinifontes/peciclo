import type { AbateSif } from "../coletores/sigsif.js";
import type { Preco } from "../coletores/precos.js";
import { obterCliente } from "./cliente.js";
import { lerTudo } from "./paginar.js";

/**
 * Camada de dados da planilha EXPERIMENTAL. Escreve e lê apenas
 * `peciclo_abate_sif` e `peciclo_precos` — nunca toca nas tabelas que
 * alimentam a planilha de produção.
 */

export async function gravarAbateSif(dados: AbateSif[]): Promise<number> {
  if (dados.length === 0) return 0;
  const linhas = dados.flatMap((d) => [
    { uf: d.uf, ano: d.ano, mes: d.mes, sexo: "MACHO", quantidade: d.macho, fonte: "sigsif", atualizado_em: new Date().toISOString() },
    { uf: d.uf, ano: d.ano, mes: d.mes, sexo: "FEMEA", quantidade: d.femea, fonte: "sigsif", atualizado_em: new Date().toISOString() },
  ]);

  const cliente = obterCliente();
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error } = await cliente
      .from("peciclo_abate_sif")
      .upsert(linhas.slice(i, i + 1000), { onConflict: "uf,ano,mes,sexo" });
    if (error) throw new Error(`Falha ao gravar abate SIF: ${error.message}`);
  }
  return linhas.length;
}

export async function gravarPrecos(precos: Preco[]): Promise<number> {
  if (precos.length === 0) return 0;
  const { error } = await obterCliente()
    .from("peciclo_precos")
    .upsert(
      precos.map((p) => ({
        serie: p.serie,
        data: p.data,
        valor: p.valor,
        unidade: p.unidade,
        fonte: p.fonte,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "serie,data" },
    );
  if (error) throw new Error(`Falha ao gravar preços: ${error.message}`);
  return precos.length;
}

export interface LinhaSif {
  uf: string;
  ano: number;
  mes: number;
  sexo: "MACHO" | "FEMEA";
  quantidade: number;
}

export async function lerAbateSif(): Promise<LinhaSif[]> {
  return lerTudo<LinhaSif>(
    (de, ate) =>
      obterCliente()
        .from("peciclo_abate_sif")
        .select("uf, ano, mes, sexo, quantidade")
        .order("ano")
        .order("mes")
        .range(de, ate) as never,
    "abate SIF",
  );
}

export interface LinhaPreco {
  serie: string;
  data: string;
  valor: number;
  unidade: string;
}

export async function lerPrecos(): Promise<LinhaPreco[]> {
  const linhas = await lerTudo<LinhaPreco>(
    (de, ate) =>
      obterCliente()
        .from("peciclo_precos")
        .select("serie, data, valor, unidade")
        .order("data", { ascending: false })
        .range(de, ate) as never,
    "preços",
  );
  return linhas.map((p) => ({ ...p, valor: Number(p.valor) }));
}
