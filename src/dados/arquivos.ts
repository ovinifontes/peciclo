import { obterCliente } from "./cliente.js";

const BUCKET = "brutos";

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
  const { error } = await obterCliente()
    .storage.from(BUCKET)
    .upload(args.caminho, args.conteudo, {
      contentType:
        args.contentType ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (error) throw new Error(`Falha ao arquivar ${args.caminho}: ${error.message}`);
  return args.caminho;
}
