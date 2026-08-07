import { obterCliente } from "./cliente.js";
import type { Dossie } from "../ia/dossie.js";

/**
 * Camada de dados de `peciclo_cenarios` — um cenário por dia, com o dossiê
 * gravado junto para o texto ser auditável para sempre. Upsert por data:
 * rodar a rotina duas vezes no mesmo dia sobrescreve, não duplica.
 */

export interface LinhaCenario {
  data: string; // "2026-08-07"
  texto: string;
  origem: "ia" | "reserva";
  modelo: string | null; // null quando a reserva assinou o texto
  dossie: Dossie;
}

export async function gravarCenario(linha: LinhaCenario): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_cenarios")
    .upsert(
      {
        data: linha.data,
        texto: linha.texto,
        origem: linha.origem,
        modelo: linha.modelo,
        dossie: linha.dossie,
      },
      { onConflict: "data" },
    );
  if (error) throw new Error(`Falha ao gravar cenário: ${error.message}`);
}

export async function lerCenarioDoDia(data: string): Promise<LinhaCenario | null> {
  const { data: linhas, error } = await obterCliente()
    .from("peciclo_cenarios")
    .select("data, texto, origem, modelo, dossie")
    .eq("data", data)
    .limit(1);
  if (error) throw new Error(`Falha ao ler cenário de ${data}: ${error.message}`);
  return (linhas?.[0] as LinhaCenario | undefined) ?? null;
}
