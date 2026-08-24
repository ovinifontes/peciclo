import { createHash } from "node:crypto";
import { obterCliente } from "./cliente.js";

/**
 * Memória curta dos alertas ao operador: o mesmo aviso, palavra por palavra,
 * não volta dentro de 3 dias. O dono reclamou (com razão) de receber todo dia
 * a mesma anomalia e três avisos da mesma fonte quebrada — alerta repetido
 * treina a pessoa a ignorar alerta.
 *
 * Tabela interna (`peciclo_alertas_enviados`), RLS ligada e zero políticas:
 * só a service_role passa.
 *
 * Regra de ouro: banco fora do ar NUNCA pode calar um alerta. Em dúvida, alerta.
 */

/** Janela de silêncio para um alerta de conteúdo idêntico. */
export const JANELA_REPETICAO_DIAS = 3;

/** Hash estável do conteúdo do alerta — mudou uma vírgula, é outro alerta. */
export function chaveAlerta(assunto: string, detalhe: string): string {
  return createHash("sha1").update(`${assunto}\n${detalhe}`).digest("hex");
}

/** Falso só quando ESTE alerta já saiu nos últimos 3 dias. Erro de banco → true. */
export async function deveAlertar(chave: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_REPETICAO_DIAS * 86_400_000).toISOString();
  try {
    const { data, error } = await obterCliente()
      .from("peciclo_alertas_enviados")
      .select("chave")
      .eq("chave", chave)
      .gte("enviado_em", desde)
      .limit(1);
    if (error) return true;
    return (data?.length ?? 0) === 0;
  } catch {
    return true;
  }
}

/** Anota que o alerta saiu. Nunca lança: a mensagem já chegou, o resto é registro. */
export async function registrarAlerta(chave: string, assunto: string): Promise<void> {
  try {
    const { error } = await obterCliente()
      .from("peciclo_alertas_enviados")
      .upsert({ chave, assunto, enviado_em: new Date().toISOString() }, { onConflict: "chave" });
    if (error) console.error(`Falha ao registrar alerta enviado: ${error.message}`);
  } catch (erro) {
    console.error(
      `Falha ao registrar alerta enviado: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}
