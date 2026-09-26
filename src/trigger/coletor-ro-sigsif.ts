import { logger, schedules } from "@trigger.dev/sdk";
import { coletarDiaSigsif } from "../coletores/sigsif-diario.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { gravarAgregadosDiarios } from "../dados/diario.js";
import { obterCliente } from "../dados/cliente.js";
import { alertarOperador } from "../notificacao/alertas.js";

/** Janela de recuperação: dias já gravados são pulados sem tocar na fonte. */
const JANELA_DIAS = 10;
/**
 * Dias recentes recoletados mesmo já estando no banco. O MAPA consolida o
 * abate com alguns dias de folga, então a ponta ainda cresce depois de
 * publicada — sem refazer, o último dia fica subestimado para sempre.
 */
const DIAS_RECOLETADOS = 5;
/** Respiro entre consultas: é um JSF público de órgão federal. */
const PAUSA_MS = 1500;

/** Dias que a corrida de hoje deve olhar, do mais antigo ao mais recente. */
export function diasDaJanelaSigsif(
  hojeIso: string,
  janela = JANELA_DIAS,
): Array<{ dia: string; refazer: boolean }> {
  const dias: Array<{ dia: string; refazer: boolean }> = [];
  // D-1 em diante: o dia corrente ainda está sendo consolidado pelo MAPA.
  for (let atras = janela; atras >= 1; atras--) {
    const d = new Date(`${hojeIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - atras);
    dias.push({ dia: d.toISOString().slice(0, 10), refazer: atras <= DIAS_RECOLETADOS });
  }
  return dias;
}

async function jaNoBanco(de: string, ate: string): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("peciclo_abate_diario")
    .select("data")
    .eq("uf", "RO")
    .eq("fonte", "sigsif_dia")
    .gte("data", de)
    .lte("data", ate);
  if (error) throw new Error(`Falha ao ler os dias já gravados: ${error.message}`);
  return new Set((data ?? []).map((l) => String(l.data)));
}

/**
 * Diário de RO pelo MAPA — enquanto o painel do IDARON estiver congelado.
 *
 * O IDARON parou de alimentar o painel em 11/09/2026, na migração de
 * plataforma do órgão: o sistema deles voltou (Rondônia abateu 80.026 cabeças
 * entre 12 e 25/09, medido por esta mesma fonte), mas o relatório público
 * ficou pendurado no banco antigo.
 *
 * Esta task NÃO substitui o coletor do IDARON: as duas convivem, cada uma com
 * a sua fonte no banco. Quando o painel voltar, a série do IDARON volta a
 * crescer sozinha e passa a haver dois números para o mesmo dia — de
 * propósito, porque medem coisas diferentes (ver `sigsif-diario.ts`).
 *
 * Roda às 5h30, depois do MT e antes da planilha das 6h.
 *
 * NUNCA lança para o agendador: falha vira alerta ao operador.
 */
export const coletorRoSigsif = schedules.task({
  id: "coletor-ro-sigsif",
  cron: {
    pattern: "30 5 * * *",
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    const hoje = quando.toLocaleDateString("en-CA", { timeZone: fuso });

    try {
      const janela = diasDaJanelaSigsif(hoje);
      const feitos = await jaNoBanco(janela[0]!.dia, janela.at(-1)!.dia);
      const pendentes = janela.filter((d) => d.refazer || !feitos.has(d.dia));
      if (pendentes.length === 0) return { hoje, gravados: 0, falhas: [] as string[] };

      const coletaId = await abrirColeta({
        uf: "RO",
        tipo: "diaria",
        janela: { inicio: pendentes[0]!.dia, fim: pendentes.at(-1)!.dia },
      });

      const falhas: string[] = [];
      let gravados = 0;
      let cabecas = 0;

      for (const { dia } of pendentes) {
        try {
          const agregados = await coletarDiaSigsif("RO", dia);
          if (agregados.length > 0) {
            await gravarAgregadosDiarios(agregados, coletaId, "sigsif_dia");
            gravados++;
            cabecas += agregados.reduce((s, a) => s + a.quantidade, 0);
          }
          // Dia sem linha é domingo/feriado de verdade aqui: ao contrário do
          // painel do IDARON, esta fonte responde por dia e o vazio é resposta,
          // não silêncio. Não grava zero — ausência não é abate zero provado.
          logger.info("dia do RO pelo MAPA", { dia, linhas: agregados.length });
        } catch (erro) {
          falhas.push(`${dia}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
        await new Promise((r) => setTimeout(r, PAUSA_MS));
      }

      await fecharColeta({
        id: coletaId,
        status: falhas.length > 0 && gravados === 0 ? "falha" : gravados > 0 ? "ok" : "sem_dados",
        linhasAfetadas: gravados,
        erro: falhas.length > 0 ? `${falhas.length} dia(s) falharam` : null,
      });

      if (falhas.length > 0) {
        await alertarOperador(
          `RO/MAPA: ${falhas.length} de ${pendentes.length} dias falharam`,
          falhas.join("\n") + "\n\nA janela olha 10 dias para trás; a corrida de amanhã recolhe o que faltou.",
          { chave: `ro-sigsif-falhou:${falhas.length}` },
        );
      }

      logger.info("coleta diária de RO pelo MAPA concluída", { gravados, falhas: falhas.length, cabecas });
      return { hoje, gravados, falhas, cabecas };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("coleta de RO pelo MAPA falhou", { erro: mensagem });
      try {
        await alertarOperador("RO/MAPA: a coleta do dia NÃO rodou", mensagem);
      } catch {
        /* alerta indisponível não pode derrubar a coleta */
      }
      return { hoje, gravados: 0, falhas: [mensagem] };
    }
  },
});
