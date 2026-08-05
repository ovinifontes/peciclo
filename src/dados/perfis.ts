import { obterCliente } from "./cliente.js";
import { normalizarNumero } from "../notificacao/evolution.js";

/**
 * Une os destinatários da configuração com os do banco, normalizando e
 * descartando os inválidos. A configuração permanece como rede de segurança:
 * se a lista viesse só do banco e a tabela estivesse vazia, o job rodaria com
 * sucesso, reportaria "0 enviados" e ninguém receberia nada — nem o dono.
 */
export function unirDestinatarios(daConfiguracao: string[], doBanco: string[]): string[] {
  const validos = [...daConfiguracao, ...doBanco]
    .map((n) => {
      try {
        return normalizarNumero(n);
      } catch {
        return null; // número torto não derruba o lote
      }
    })
    .filter((n): n is string => n !== null);
  return [...new Set(validos)];
}

/**
 * Telefones dos clientes ativos que optaram por receber.
 * Usa a service_role, que ignora RLS — não depende de policy nenhuma.
 * Nunca lança: qualquer falha devolve lista vazia e o job segue.
 */
export async function listarTelefonesAtivos(): Promise<string[]> {
  try {
    const { data, error } = await obterCliente()
      .from("peciclo_perfis")
      .select("telefone_whatsapp")
      .eq("status", "ativo")
      .eq("recebe_whatsapp", true)
      .not("telefone_whatsapp", "is", null);
    if (error) return [];
    return (data ?? []).map((l) => String(l.telefone_whatsapp));
  } catch {
    return [];
  }
}
