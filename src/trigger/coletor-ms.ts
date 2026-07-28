import { logger, task } from "@trigger.dev/sdk";
import { coletarMs } from "../coletores/ms.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";
import type { Janela, TipoColeta } from "../tipos.js";

export const coletorMs = task({
  id: "coletor-ms",
  machine: "small-2x",
  maxDuration: 300,
  run: async (payload: { janela: Janela; tipo?: TipoColeta }) => {
    const tipo = payload.tipo ?? "diaria";
    const coletaId = await abrirColeta({ uf: "MS", tipo, janela: payload.janela });

    try {
      const { registros, arquivo, hash, nomeArquivo } = await coletarMs(payload.janela);
      await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
      const gravados = await gravarRegistros(registros, coletaId);
      const alteradas = await rollupJanela({ uf: "MS", janela: payload.janela, coletaId });

      await fecharColeta({
        id: coletaId,
        status: registros.length > 0 ? "ok" : "sem_dados",
        arquivoPath: nomeArquivo,
        arquivoHash: hash,
        linhasAfetadas: gravados,
      });

      logger.info("coletor MS concluído", { gravados, alteradas });
      return { uf: "MS" as const, registros: registros.length, gravados, alteradas };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
