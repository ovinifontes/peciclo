import { batch, logger, task } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { coletorMt } from "./coletor-mt.js";
import { coletorRo } from "./coletor-ro.js";
import { coletorPa } from "./coletor-pa.js";
import { alertarOperador } from "../notificacao/alertas.js";
import {
  assuntoEsgotado,
  assuntoRecuperado,
  decidirDesfecho,
  normalizarUfs,
  type UfRecoletavel,
} from "../coleta/recoleta.js";
import type { Janela } from "../tipos.js";

/**
 * Recoleta automática dos estados que falharam na coleta diária: a coleta-diaria
 * a agenda para 45 minutos depois, só com as UFs com falha, e ela se reagenda
 * uma vez (até 2 tentativas ao todo) enquanto sobrar falha.
 *
 * Re-executa os MESMOS coletores da coleta diária, que recoletam o mês corrente
 * inteiro e são idempotentes por upsert — cada coletor já faz o próprio rollup
 * (rollupJanela/gravarAgregados) por dentro, então re-rodar o coletor é a
 * recuperação completa. Só banco: NÃO regera planilha nem manda mensagem a
 * cliente; o operador recebe apenas o desfecho.
 *
 * Esta task nunca lança: qualquer erro vira alerta ao operador, porque a coleta
 * de amanhã recoleta o mês inteiro e se autocorrige de qualquer forma.
 */

type ItemRecoleta =
  | { task: typeof coletorMs; payload: { janela: Janela } }
  | { task: typeof coletorMt; payload: { ano: number; mes: number; ateIso: string } }
  | { task: typeof coletorRo; payload: { ano: number; mes: number } }
  | { task: typeof coletorPa; payload: { ano: number } };

interface SaidaRecoleta {
  dataReferencia: string;
  tentativa: number;
  ufs: UfRecoletavel[];
  desfecho: "recuperado" | "reagendada" | "esgotado" | "sem_ufs" | "erro";
  falhas: Array<{ uf: string; erro: string }>;
}

export const recoleta = task({
  id: "recoleta",
  machine: "small-1x",
  maxDuration: 1800,
  // O ciclo de tentativas é da própria task (payload.tentativa); retry de
  // plataforma duplicaria a contagem.
  retry: { maxAttempts: 1 },
  run: async (payload: {
    ufs: string[];
    dataReferencia: string;
    tentativa: number;
  }): Promise<SaidaRecoleta> => {
    const { dataReferencia, tentativa } = payload;
    try {
      const ufs = normalizarUfs(payload.ufs);
      if (ufs.length === 0) {
        logger.warn("recoleta sem UF válida no payload", { pedidas: payload.ufs });
        return { dataReferencia, tentativa, ufs, desfecho: "sem_ufs", falhas: [] };
      }

      // Mesmas janelas da coleta diária, derivadas da data de referência: o mês
      // corrente do 1º dia até a data da coleta que falhou.
      const ano = Number(dataReferencia.slice(0, 4));
      const mes = Number(dataReferencia.slice(5, 7));
      const janela = { inicio: `${ano}-${String(mes).padStart(2, "0")}-01`, fim: dataReferencia };

      const itemPorUf: Record<UfRecoletavel, ItemRecoleta> = {
        MS: { task: coletorMs, payload: { janela } },
        MT: { task: coletorMt, payload: { ano, mes, ateIso: dataReferencia } },
        RO: { task: coletorRo, payload: { ano, mes } },
        PA: { task: coletorPa, payload: { ano } },
      };

      const { runs } = await batch.triggerByTaskAndWait(ufs.map((uf) => itemPorUf[uf]));

      const falhas: Array<{ uf: string; erro: string }> = [];
      runs.forEach((r, i) => {
        const uf = ufs[i]!;
        if (r.ok) {
          logger.info(`recoleta ${uf} ok`, { saida: r.output });
        } else {
          const erro = r.error instanceof Error ? r.error.message : String(r.error);
          falhas.push({ uf, erro });
          logger.error(`recoleta ${uf} falhou`, { erro });
        }
      });

      const desfecho = decidirDesfecho({
        ufsAindaComFalha: ufs.filter((uf) => falhas.some((f) => f.uf === uf)),
        tentativa,
      });

      if (desfecho.tipo === "reagendar") {
        await recoleta.trigger(
          { ufs: desfecho.ufs, dataReferencia, tentativa: desfecho.proximaTentativa },
          { delay: "45m" },
        );
        logger.info("recoleta reagendada", {
          ufs: desfecho.ufs,
          tentativa: desfecho.proximaTentativa,
        });
        return { dataReferencia, tentativa, ufs, desfecho: "reagendada", falhas };
      }

      if (desfecho.tipo === "recuperado") {
        await alertarOperador(
          assuntoRecuperado(ufs, tentativa),
          `Coleta de ${dataReferencia} completada; o banco já está atualizado.`,
          // Boa notícia nunca é suprimida como repetição — se a fonte quebra e
          // se recupera todo dia, o operador precisa ver os dois lados.
          { sempre: true },
        );
        return { dataReferencia, tentativa, ufs, desfecho: "recuperado", falhas };
      }

      await alertarOperador(
        assuntoEsgotado(desfecho.ufs),
        falhas.map((f) => `${f.uf}: ${f.erro}`).join("\n") +
          "\n\nA coleta diária recoleta o mês inteiro, então amanhã isso se autocorrige.",
        // Mesma razão do alerta da coleta diária: a notícia é QUAIS estados
        // esgotaram as tentativas, não em que dia — repetir isso toda manhã
        // durante uma pane de semanas só ensina o operador a ignorar.
        { chave: `recoleta-esgotada:${[...desfecho.ufs].sort().join(",")}` },
      );
      return { dataReferencia, tentativa, ufs, desfecho: "esgotado", falhas };
    } catch (erro) {
      // Nunca relançar: recoleta é rede de segurança, não pode virar incidente.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("recoleta com erro inesperado", { erro: mensagem });
      try {
        await alertarOperador(
          `❌ Recoleta ${dataReferencia}: erro inesperado na tentativa ${tentativa}`,
          `${mensagem}\n\nA coleta diária de amanhã recoleta o mês inteiro e se autocorrige.`,
        );
      } catch (erroAlerta) {
        logger.error("falha ao alertar o operador sobre a recoleta", {
          erro: erroAlerta instanceof Error ? erroAlerta.message : String(erroAlerta),
        });
      }
      return { dataReferencia, tentativa, ufs: [], desfecho: "erro", falhas: [] };
    }
  },
});
