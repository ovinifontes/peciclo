import type { Janela, StatusColeta, TipoColeta, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

export async function abrirColeta(args: {
  uf: UF;
  tipo: TipoColeta;
  janela: Janela;
}): Promise<number> {
  const { data, error } = await obterCliente()
    .from("peciclo_coletas")
    .insert({
      uf: args.uf,
      tipo: args.tipo,
      janela_inicio: args.janela.inicio,
      janela_fim: args.janela.fim,
      status: "sem_dados",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao abrir coleta: ${error.message}`);
  return data.id as number;
}

export async function fecharColeta(args: {
  id: number;
  status: StatusColeta;
  arquivoPath?: string | null;
  arquivoHash?: string | null;
  linhasAfetadas?: number | null;
  erro?: string | null;
}): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_coletas")
    .update({
      status: args.status,
      arquivo_path: args.arquivoPath ?? null,
      arquivo_hash: args.arquivoHash ?? null,
      linhas_afetadas: args.linhasAfetadas ?? null,
      erro: args.erro ?? null,
      concluido_em: new Date().toISOString(),
    })
    .eq("id", args.id);

  if (error) throw new Error(`Falha ao fechar coleta ${args.id}: ${error.message}`);
}

/** Hashes de arquivos já processados com sucesso — usado pelo coletor do PA. */
export async function hashesProcessados(uf: UF): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("peciclo_coletas")
    .select("arquivo_hash")
    .eq("uf", uf)
    .eq("status", "ok")
    .not("arquivo_hash", "is", null);

  if (error) throw new Error(`Falha ao ler hashes de ${uf}: ${error.message}`);
  return new Set((data ?? []).map((l) => l.arquivo_hash as string));
}
