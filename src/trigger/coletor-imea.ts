import { logger, schedules } from "@trigger.dev/sdk";
import {
  RelatorioInexistenteError,
  baixarImea,
  numeroDoRelatorio,
  parsearImea,
} from "../coletores/imea.js";
import { gravarMensalImea } from "../dados/imea.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { alertarOperador } from "../notificacao/alertas.js";

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(ano: number, mes: number): string {
  return `${MESES_ABREV[mes - 1]}/${String(ano % 100).padStart(2, "0")}`;
}

/**
 * Fonte substituta do mensal de MT: o portal do INDEA (InfoSindesa) congelou
 * na migração de 08/2026, mas o IMEA publica os números do próprio INDEA em
 * PDF mensal (~2 semanas de atraso). Toda segunda tenta os últimos 3 meses
 * FECHADOS: relatório que ainda não saiu responde 404 e é pulado em silêncio;
 * quando sai, entra no banco pela regra de precedência de `gravarMensalImea`
 * (só grava o que não rebaixa número). Rodar semanalmente é barato e pega o
 * relatório novo na semana em que ele aparecer.
 *
 * Como as demais rotinas, NUNCA lança para o agendador: falha vira alerta.
 */
export const coletorImea = schedules.task({
  id: "coletor-imea",
  cron: {
    pattern: "30 7 * * 1",
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-2x",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    // "YYYY-MM-DD" no fuso local — só ano e mês interessam.
    const [anoCorrente, mesCorrente] = quando
      .toLocaleDateString("en-CA", { timeZone: fuso })
      .split("-")
      .map(Number) as [number, number];

    const problemas: string[] = [];
    const gravados: string[] = [];
    let pulados = 0;

    // Últimos 3 meses fechados (mês corrente fora), do mais recente ao mais
    // antigo — Date.UTC normaliza a virada de ano sozinho.
    for (let i = 1; i <= 3; i++) {
      const d = new Date(Date.UTC(anoCorrente, mesCorrente - 1 - i, 1));
      const ano = d.getUTCFullYear();
      const mes = d.getUTCMonth() + 1;
      const rotulo = rotuloMes(ano, mes);

      try {
        const n = numeroDoRelatorio(ano, mes);
        let pdf: Buffer;
        try {
          pdf = await baixarImea(n);
        } catch (erro) {
          if (erro instanceof RelatorioInexistenteError) {
            // Mês ainda não publicado: nada a fazer, sem alarde.
            logger.info("relatório IMEA ainda não publicado", { ano, mes, n });
            pulados++;
            continue;
          }
          throw erro;
        }

        await arquivarBruto({
          caminho: `imea/abate-mt-${ano}-${String(mes).padStart(2, "0")}.pdf`,
          conteudo: pdf,
          contentType: "application/pdf",
        });

        // O PDF precisa confirmar a competência: `n` é chute aritmético e uma
        // edição extra do IMEA desloca todos — mês divergente vira problema
        // alertado, nunca número gravado sob a competência errada.
        const { machos, femeas } = await parsearImea(pdf, { ano, mes });
        const { gravou, totalAnterior } = await gravarMensalImea({ ano, mes, machos, femeas });

        const totalGravado = machos + femeas;
        if (gravou) {
          gravados.push(rotulo);
          const era =
            totalAnterior === null
              ? "não havia número"
              : `era ${totalAnterior.toLocaleString("pt-BR")}`;
          // Alerta INFORMATIVO: transparência sempre que um número do banco muda.
          await alertarOperador(
            `📈 IMEA: MT de ${rotulo} atualizado para ${totalGravado.toLocaleString("pt-BR")}`,
            `Machos ${machos.toLocaleString("pt-BR")} + fêmeas ${femeas.toLocaleString("pt-BR")} (${era}).`,
            // Notícia boa e rara (só sai quando o número muda de verdade):
            // nunca suprimida como repetição.
            { sempre: true },
          );
        } else {
          logger.info("IMEA não supera o número atual — mantido", {
            ano,
            mes,
            totalImea: totalGravado,
            totalAtual: totalAnterior,
          });
        }
      } catch (erro) {
        problemas.push(`${rotulo}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }

    if (problemas.length > 0) {
      logger.error("coletor IMEA com problemas", { problemas });
      try {
        await alertarOperador(`Coletor IMEA: ${problemas.length} problema(s)`, problemas.join("\n"));
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
    }

    return { gravados, pulados, problemas };
  },
});
