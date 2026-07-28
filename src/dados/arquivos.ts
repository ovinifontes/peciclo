import { obterCliente } from "./cliente.js";

const BUCKET = "peciclo_brutos";

/**
 * Torna um caminho seguro como chave do Supabase Storage, que rejeita espaços
 * e acentos. Mantém a "/" das pastas. Ex.: "pa/GTAs Maio 2026 públicos.xlsx"
 * vira "pa/GTAs_Maio_2026_publicos.xlsx".
 */
export function chaveSegura(caminho: string): string {
  return caminho
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._/-]/g, "_");
}

/**
 * Arquiva o arquivo bruto antes de qualquer parse. Um parser com bug pode ser
 * corrigido e reexecutado sobre todo o histórico sem tocar nos portais — que
 * não guardam dados acessíveis indefinidamente.
 */
export async function arquivarBruto(args: {
  caminho: string;
  conteudo: Buffer;
  contentType?: string;
}): Promise<string> {
  const chave = chaveSegura(args.caminho);
  const { error } = await obterCliente()
    .storage.from(BUCKET)
    .upload(chave, args.conteudo, {
      contentType:
        args.contentType ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (error) throw new Error(`Falha ao arquivar ${chave}: ${error.message}`);
  return chave;
}
