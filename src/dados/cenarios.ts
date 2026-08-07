import { obterCliente } from "./cliente.js";
import type { Dossie } from "../ia/dossie.js";

/**
 * Camada de dados de `peciclo_cenarios` — um cenário por dia, com o dossiê
 * gravado junto para o texto ser auditável para sempre. Upsert por data:
 * rodar a rotina duas vezes no mesmo dia sobrescreve, não duplica.
 *
 * `enviado_em` fica FORA do upsert de propósito: regravar os textos nunca
 * apaga a marca de envio — é ela que garante um só WhatsApp por dia.
 */

export interface LinhaCenario {
  data: string; // "2026-08-07"
  texto: string; // o cenário completo — fica só no site
  resumo: string | null; // versão curta para o WhatsApp; null em dias antigos
  origem: "ia" | "reserva";
  modelo: string | null; // null quando a reserva assinou o texto
  dossie: Dossie;
}

export interface CenarioDoDia extends LinhaCenario {
  enviado_em: string | null; // null = o WhatsApp do dia ainda não saiu
}

export async function gravarCenario(linha: LinhaCenario): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_cenarios")
    .upsert(
      {
        data: linha.data,
        texto: linha.texto,
        resumo: linha.resumo,
        origem: linha.origem,
        modelo: linha.modelo,
        dossie: linha.dossie,
      },
      { onConflict: "data" },
    );
  if (error) throw new Error(`Falha ao gravar cenário: ${error.message}`);
}

export async function lerCenarioDoDia(data: string): Promise<CenarioDoDia | null> {
  const { data: linhas, error } = await obterCliente()
    .from("peciclo_cenarios")
    .select("data, texto, resumo, origem, modelo, dossie, enviado_em")
    .eq("data", data)
    .limit(1);
  if (error) throw new Error(`Falha ao ler cenário de ${data}: ${error.message}`);
  return (linhas?.[0] as CenarioDoDia | undefined) ?? null;
}

/** Marca que o WhatsApp do dia saiu — a partir daqui, nenhum reenvio. */
export async function marcarEnviado(data: string): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_cenarios")
    .update({ enviado_em: new Date().toISOString() })
    .eq("data", data);
  if (error) throw new Error(`Falha ao marcar cenário de ${data} como enviado: ${error.message}`);
}
