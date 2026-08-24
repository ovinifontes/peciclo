import { logger, task } from "@trigger.dev/sdk";
import { coletarRo, descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { gravarAgregadosDiarios } from "../dados/diario.js";
import { gravarAgregados } from "../dados/mensal.js";
import { gravarSnapshot, lerHistoricoSnapshots } from "../dados/ro-snapshots.js";
import { calcularDiferencaDiaria } from "../diario/diferenca.js";

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

      // Diário por DIFERENÇA de retratos (ideia do sócio): o painel só publica
      // o acumulado do mês, mas cresce dia a dia — guardando o total de cada
      // manhã, ontem ≈ retrato de hoje − retrato de ontem. Estimativa por
      // fluxo de publicação (fonte 'powerbi_diff'); o mensal acima segue
      // canônico. Em try/catch próprio, molde do coletor-mt: falha aqui loga
      // e NUNCA derruba o mensal.
      let diaDiario: string | null = null;
      try {
        // Mês ainda não publicado devolve [] — sem retrato não há o que ancorar.
        if (agregados.length > 0) {
          const hoje = new Date().toLocaleDateString("en-CA", {
            timeZone: "America/Sao_Paulo",
          });
          const competencia = `${payload.ano}-${String(payload.mes).padStart(2, "0")}-01`;

          const snapshotHoje = { FEMEA: 0, MACHO: 0 };
          for (const a of agregados) snapshotHoje[a.sexo] = a.quantidade;

          // Histórico, não só o retrato de ontem: o painel congela no fim de
          // semana e o ganho de segunda-feira cobre desde a última publicação.
          const historico = await lerHistoricoSnapshots({ competencia, antesDe: hoje });
          const diferenca = calcularDiferencaDiaria({
            snapshotHoje,
            historico,
            capturadoEm: hoje,
          });
          for (const anomalia of diferenca.anomalias) {
            // Anomalia do método (retrato pulado, correção para baixo): log e
            // segue — sem alerta ao operador, o mensal continua íntegro.
            logger.warn("diferença diária do RO com anomalia", { anomalia });
          }
          if (diferenca.agregados.length > 0) {
            await gravarAgregadosDiarios(diferenca.agregados, coletaId, "powerbi_diff");
            diaDiario = diferenca.agregados[0]!.data;
            logger.info("dia do RO gravado por diferença", { dia: diaDiario });
          }

          // O retrato de hoje entra POR ÚLTIMO: gravado antes da leitura acima,
          // ele mesmo viraria o "anterior" e a diferença sairia zero.
          await gravarSnapshot({ competencia, capturadoEm: hoje, porSexo: snapshotHoje });

          // TODO (decisão desta fase): sem acerto de virada de mês. No dia 1º a
          // coleta muda de competência e não existe retrato anterior DELA, então
          // o resíduo do último dia do mês anterior (total final − último
          // retrato) fica sem ponto — o mesmo buraco honesto de um gap. Fechar
          // esse resíduo exigiria reconsultar o mês anterior na virada; fica
          // para quando o buraco mensal incomodar de verdade.
        }
      } catch (erro) {
        logger.warn("diário do RO por diferença indisponível; mensal intacto", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }

      await fecharColeta({ id: coletaId, status: "ok", linhasAfetadas: agregados.length });

      return { uf: "RO" as const, agregados: agregados.length, diaDiario };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
