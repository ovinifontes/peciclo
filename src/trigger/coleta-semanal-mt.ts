import { batch, logger, schedules } from "@trigger.dev/sdk";
import { coletorMtDia } from "./coletor-mt-dia.js";
import { obterCliente } from "../dados/cliente.js";
import { alertarOperador } from "../notificacao/alertas.js";

/** Primeiro dia que só existe no SINDESA 2 — antes disso era o portal velho. */
const PRIMEIRO_DIA_DO_NOVO = "2026-08-07";
/** Quantos dias para trás a semana olha. */
const JANELA_DIAS = 10;
/**
 * Quantos dos dias mais recentes são recoletados MESMO já estando no banco.
 *
 * GTA é lançada com atraso, então o número de um dia continua crescendo por
 * alguns dias depois dele. Sem isto, o último dia de cada semana entraria
 * incompleto e ficaria incompleto para sempre — e uma série que subestima
 * justo a ponta é pior que uma série curta, porque a ponta é o que se olha.
 */
const DIAS_RECOLETADOS = 3;

/** Os dias que a corrida de hoje deve olhar, do mais antigo ao mais recente. */
export function diasDaJanela(
  hojeIso: string,
  janela = JANELA_DIAS,
): { dia: string; refazer: boolean }[] {
  const dias: { dia: string; refazer: boolean }[] = [];
  // Começa em D-1: o dia corrente ainda está recebendo guia e entraria parcial.
  for (let atras = janela; atras >= 1; atras--) {
    const d = new Date(`${hojeIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - atras);
    const dia = d.toISOString().slice(0, 10);
    if (dia < PRIMEIRO_DIA_DO_NOVO) continue;
    dias.push({ dia, refazer: atras <= DIAS_RECOLETADOS });
  }
  return dias;
}

/** Dias de MT que já vieram DESTE portal — só eles contam como feitos. */
async function jaNoBanco(de: string, ate: string): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("peciclo_abate_diario")
    .select("data")
    .eq("uf", "MT")
    .eq("fonte", "sindesa2_gta")
    .gte("data", de)
    .lte("data", ate);
  if (error) throw new Error(`Falha ao ler os dias já gravados: ${error.message}`);
  return new Set((data ?? []).map((l) => String(l.data)));
}

/**
 * Coleta semanal do diário de MT — sábado de manhã.
 *
 * Semanal, e não diária, porque cada dia custa abrir ~800 GTAs no SINDESA 2:
 * o portal não tem relatório somado por sexo, e o número só existe dentro de
 * cada guia. Uma vez por semana, com os dias em fila de um em um, é o ritmo
 * que o portal aguenta sem que o acesso vire incômodo para o INDEA.
 *
 * Sábado de propósito: pega a semana inteira já fechada e roda quando o portal
 * está vazio. Um dia que falhar não se perde — o sábado seguinte olha 10 dias
 * para trás e recolhe o que ficou.
 *
 * NUNCA lança para o agendador: falha vira alerta ao operador. O fazendeiro
 * não vê nada disto.
 */
export const coletaSemanalMt = schedules.task({
  id: "coleta-semanal-mt",
  cron: {
    pattern: "0 5 * * 6", // sábado, 05:00 de Brasília
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  // Só orquestra: o trabalho pesado está nos filhos. O teto cobre a espera
  // dos 10 dias em fila (~5 min cada) com folga para um retry.
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    const hoje = quando.toLocaleDateString("en-CA", { timeZone: fuso });

    try {
      const janela = diasDaJanela(hoje);
      if (janela.length === 0) {
        logger.info("nenhum dia na janela", { hoje });
        return { hoje, disparados: 0, falhas: [] as string[] };
      }

      const feitos = await jaNoBanco(janela[0]!.dia, janela.at(-1)!.dia);
      const pendentes = janela.filter((d) => d.refazer || !feitos.has(d.dia));

      logger.info("janela da semana", {
        hoje,
        naJanela: janela.length,
        jaNoBanco: feitos.size,
        aColetar: pendentes.length,
      });
      if (pendentes.length === 0) return { hoje, disparados: 0, falhas: [] as string[] };

      // `triggerByTaskAndWait` espera todos; a fila de concorrência 1 do
      // coletor garante que eles rodem UM DE CADA VEZ mesmo disparados juntos.
      // Um filho que falha não derruba o pai.
      const { runs } = await batch.triggerByTaskAndWait(
        pendentes.map((d) => ({ task: coletorMtDia, payload: { dia: d.dia, refazer: d.refazer } })),
      );

      const falhas: string[] = [];
      let cabecas = 0;
      runs.forEach((r, i) => {
        const dia = pendentes[i]!.dia;
        if (r.ok) cabecas += (r.output as { cabecas?: number })?.cabecas ?? 0;
        else falhas.push(`${dia}: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
      });

      if (falhas.length > 0) {
        // Identidade pela QUANTIDADE de dias, não pelo texto: "3 dias falharam"
        // toda semana com dias diferentes precisa alertar toda semana, mas o
        // mesmo problema repetido não deve virar ruído diário.
        await alertarOperador(
          `MT semanal: ${falhas.length} de ${pendentes.length} dias falharam`,
          falhas.join("\n") +
            "\n\nOs dias que faltaram entram sozinhos no sábado seguinte — a janela " +
            `olha ${JANELA_DIAS} dias para trás e pula o que já está no banco.`,
          { chave: `mt-semanal-falhou:${falhas.length}` },
        );
      }

      logger.info("coleta semanal do MT concluída", {
        disparados: pendentes.length,
        falhas: falhas.length,
        cabecas,
      });
      return { hoje, disparados: pendentes.length, falhas, cabecas };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("coleta semanal do MT falhou", { erro: mensagem });
      try {
        await alertarOperador("MT semanal NÃO rodou", mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { hoje, disparados: 0, falhas: [mensagem] };
    }
  },
});
