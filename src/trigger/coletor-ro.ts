import { logger, task } from "@trigger.dev/sdk";
import { coletarRo, descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { gravarAgregados } from "../dados/mensal.js";

const CHAVE_PADRAO = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

/**
 * Coletor do RO (IDARON / Power BI publish-to-web). Agregado mensal, como o MT.
 *
 * PENDENTE: montarConsulta() em src/coletores/ro.ts precisa do corpo real da
 * query, capturado num ambiente com acesso ao cluster. Enquanto não estiver,
 * coletarRo lança ConsultaNaoConfiguradaError e esta task falha — por isso ela
 * NÃO está ligada ao batch da coleta-diaria ainda. Ligar após a captura.
 */
export const coletorRo = task({
  id: "coletor-ro",
  machine: "small-2x",
  maxDuration: 300,
  run: async (payload: { ano: number; mes: number }) => {
    const janela = {
      inicio: `${payload.ano}-${String(payload.mes).padStart(2, "0")}-01`,
      fim: `${payload.ano}-${String(payload.mes).padStart(2, "0")}-28`,
    };
    const coletaId = await abrirColeta({ uf: "RO", tipo: "mensal", janela });

    try {
      const url = await descobrirRelatorio();
      const chave = (url && extrairChaveRecurso(url)) ?? CHAVE_PADRAO;
      if (chave !== CHAVE_PADRAO) {
        logger.warn("resource key do IDARON mudou", { chave });
      }

      const agregados = await coletarRo({ ano: payload.ano, mes: payload.mes, chaveRecurso: chave });
      await gravarAgregados(agregados, coletaId, "powerbi");
      await fecharColeta({ id: coletaId, status: "ok", linhasAfetadas: agregados.length });

      return { uf: "RO" as const, agregados: agregados.length };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
