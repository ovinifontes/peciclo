import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { CredencialInvalidaError, coletarMt } from "../coletores/mt.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarAgregados } from "../dados/mensal.js";
import type { TipoColeta } from "../tipos.js";

/**
 * Coletor do MT (INDEA / GTA Condensado). Ao contrário do MS e do PA, o INDEA
 * só publica dados JÁ CONDENSADOS por mês — não há GTA individual. Por isso o
 * MT é um agregado, como o RO: consulta a competência inteira (do 1º dia até
 * `ateIso`), soma o abate bovino por sexo e sobrescreve abate_mensal.
 *
 * Reconsultar a competência inteira todo dia captura GTAs lançadas com atraso
 * sem precisar de rejanela separada — cada execução já ressoma o mês.
 */
export const coletorMt = task({
  id: "coletor-mt",
  // Um login por vez: portal de governo atrás de WAF.
  queue: { concurrencyLimit: 1 },
  machine: "small-2x",
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 300_000,
    randomize: true,
  },
  run: async (payload: { ano: number; mes: number; ateIso: string; tipo?: TipoColeta }) => {
    const cpf = process.env.INDEA_CPF;
    const senha = process.env.INDEA_SENHA;
    // Credencial ausente nunca melhora com retry.
    if (!cpf || !senha) throw new AbortTaskRunError("INDEA_CPF/INDEA_SENHA ausentes");

    const inicio = `${payload.ano}-${String(payload.mes).padStart(2, "0")}-01`;
    const janela = { inicio, fim: payload.ateIso };
    const coletaId = await abrirColeta({ uf: "MT", tipo: payload.tipo ?? "diaria", janela });

    try {
      const { agregados, arquivo, hash, nomeArquivo } = await coletarMt(janela, cpf, senha);
      await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
      await gravarAgregados(agregados, coletaId, "gta_condensada");
      await fecharColeta({
        id: coletaId,
        status: agregados.length > 0 ? "ok" : "sem_dados",
        arquivoPath: nomeArquivo,
        arquivoHash: hash,
        linhasAfetadas: agregados.length,
      });
      logger.info("coletor MT concluído", { agregados: agregados.length });
      return { uf: "MT" as const, agregados: agregados.length };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      // Credencial rejeitada também não melhora com retry.
      if (erro instanceof CredencialInvalidaError) throw new AbortTaskRunError(mensagem);
      throw erro;
    }
  },
});
