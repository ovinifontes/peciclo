import { logger, task } from "@trigger.dev/sdk";
import { coletarMs, dividirJanela } from "../coletores/ms.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";
import type { Janela, TipoColeta } from "../tipos.js";

/**
 * Coletor do MS (IAGRO). A coleta diária pede o MÊS INTEIRO até hoje, não só o
 * dia: como o upsert é idempotente por GTA, reconsultar não duplica e o mês se
 * auto-corrige — captura GTAs lançadas com atraso e se recupera sozinho de
 * qualquer período em que o sistema tenha ficado fora do ar.
 *
 * O relatório é grande (~6 MB/mês) e lento (~2 min), então a janela é
 * processada em fatias de 7 dias: cada fatia é baixada, arquivada e gravada em
 * sequência, e o rollup roda uma vez no fim. Fatiar também evita estourar o
 * tempo limite do proxy que dá saída brasileira ao download.
 */
export const coletorMs = task({
  id: "coletor-ms",
  machine: "small-2x",
  maxDuration: 900,
  run: async (payload: { janela: Janela; tipo?: TipoColeta }) => {
    const tipo = payload.tipo ?? "diaria";
    const coletaId = await abrirColeta({ uf: "MS", tipo, janela: payload.janela });

    try {
      const fatias = dividirJanela(payload.janela, 7);
      let registrosTotal = 0;
      let gravadosTotal = 0;
      let ultimoHash: string | null = null;
      let ultimoArquivo: string | null = null;

      for (const fatia of fatias) {
        const { registros, arquivo, hash, nomeArquivo } = await coletarMs(fatia);
        await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
        gravadosTotal += await gravarRegistros(registros, coletaId);
        registrosTotal += registros.length;
        ultimoHash = hash;
        ultimoArquivo = nomeArquivo;
        logger.info("fatia do MS processada", { fatia, registros: registros.length });
      }

      const alteradas = await rollupJanela({ uf: "MS", janela: payload.janela, coletaId });

      await fecharColeta({
        id: coletaId,
        status: registrosTotal > 0 ? "ok" : "sem_dados",
        arquivoPath: ultimoArquivo,
        arquivoHash: ultimoHash,
        linhasAfetadas: gravadosTotal,
      });

      logger.info("coletor MS concluído", { fatias: fatias.length, gravadosTotal, alteradas });
      return {
        uf: "MS" as const,
        fatias: fatias.length,
        registros: registrosTotal,
        gravados: gravadosTotal,
        alteradas,
      };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
