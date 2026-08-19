import { obterCliente } from "./cliente.js";

/**
 * Trava de envio único do dia para as imagens da seção diária — a mesma lição
 * do cenário duplicado: redisparo manual no mesmo dia nunca reenvia.
 * Tabela interna (`peciclo_envios_imagens`), RLS ligada e zero políticas:
 * só a service_role passa.
 */

export async function imagensJaEnviadas(data: string): Promise<boolean> {
  const { data: linhas, error } = await obterCliente()
    .from("peciclo_envios_imagens")
    .select("data")
    .eq("data", data)
    .limit(1);
  if (error) throw new Error(`Falha ao checar envio de imagens de ${data}: ${error.message}`);
  return (linhas?.length ?? 0) > 0;
}

/** Marca que as imagens do dia saíram — a partir daqui, nenhum reenvio. */
export async function marcarImagensEnviadas(data: string): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_envios_imagens")
    .upsert({ data, enviado_em: new Date().toISOString() }, { onConflict: "data" });
  if (error) throw new Error(`Falha ao marcar imagens de ${data} como enviadas: ${error.message}`);
}
