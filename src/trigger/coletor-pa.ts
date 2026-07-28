import { logger, task } from "@trigger.dev/sdk";
import { coletarPa } from "../coletores/pa.js";
import { abrirColeta, fecharColeta, hashesProcessados } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";

export const coletorPa = task({
  id: "coletor-pa",
  machine: "medium-1x",
  maxDuration: 900,
  run: async (payload: { ano: number }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY ausente no ambiente");

    const jaProcessados = await hashesProcessados("PA");
    const novos = await coletarPa({ ano: payload.ano, apiKey, hashesJaProcessados: jaProcessados });

    // Nenhum arquivo novo é o caso comum: o PA publica uma vez por mês, com
    // cerca de dois meses de atraso. Não é falha.
    if (novos.length === 0) {
      logger.info("PA sem arquivos novos");
      return { arquivosNovos: 0, registros: 0 };
    }

    let total = 0;
    for (const novo of novos) {
      const datas = novo.registros.map((r) => r.dataEmissao).sort();
      const janela = { inicio: datas[0] ?? `${payload.ano}-01-01`, fim: datas.at(-1) ?? `${payload.ano}-12-31` };
      const coletaId = await abrirColeta({ uf: "PA", tipo: "mensal", janela });

      try {
        await arquivarBruto({ caminho: `pa/${novo.arquivo.nome}`, conteudo: novo.conteudo });
        const gravados = await gravarRegistros(novo.registros, coletaId);
        await rollupJanela({ uf: "PA", janela, coletaId });
        await fecharColeta({
          id: coletaId,
          status: "ok",
          arquivoPath: `pa/${novo.arquivo.nome}`,
          arquivoHash: novo.hash,
          linhasAfetadas: gravados,
        });
        total += gravados;
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
        throw erro;
      }
    }

    return { arquivosNovos: novos.length, registros: total };
  },
});
