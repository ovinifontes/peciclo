import { batch, logger, schedules } from "@trigger.dev/sdk";
import { coletorMtDia } from "./coletor-mt-dia.js";
import { obterCliente } from "../dados/cliente.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { consolidarMesDoDiario } from "../dados/mensal.js";
import { alertarOperador } from "../notificacao/alertas.js";

/** Primeiro dia que só existe no SINDESA 2 — antes disso era o portal velho. */
const PRIMEIRO_DIA_DO_NOVO = "2026-08-07";
/**
 * Quantos dias para trás a corrida olha.
 *
 * Com corrida DIÁRIA a janela não precisa cobrir uma semana inteira — o dia
 * novo entra no dia seguinte. Ela existe para CICATRIZAR: se um dia falhar, ou
 * o portal cair numa madrugada, os dias seguintes recolhem o que ficou sem
 * ninguém precisar olhar. Dia já gravado é pulado sem tocar no portal, então
 * uma janela folgada não custa requisição nenhuma.
 */
const JANELA_DIAS = 7;
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
 * Coleta do diário de MT — todo dia, 5h da manhã.
 *
 * Cada dia custa abrir ~800 GTAs no SINDESA 2, uma por uma: o portal não tem
 * relatório somado por sexo, e o número só existe dentro de cada guia. Rodando
 * todo dia, a conta típica é o dia novo mais os dois anteriores recoletados —
 * três dias, ~15 min, em fila de um em um.
 *
 * 5h de propósito: o portal está vazio e a coleta termina antes das 6h, que é
 * quando a planilha do cliente é gerada.
 *
 * Dia que falhar não se perde: a janela olha 7 dias para trás e pula o que já
 * está no banco, então a corrida do dia seguinte cicatriza sozinha.
 *
 * NUNCA lança para o agendador: falha vira alerta ao operador. O fazendeiro
 * não vê nada disto.
 */
export const coletaDiariaMt = schedules.task({
  id: "coleta-diaria-mt",
  cron: {
    pattern: "0 5 * * *", // todo dia, 05:00 de Brasília
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  // Só orquestra: o trabalho pesado está nos filhos. O teto cobre o pior caso
  // — a janela inteira em fila, ~5 min cada — e não o caso típico de três.
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
          `MT: ${falhas.length} de ${pendentes.length} dias falharam`,
          falhas.join("\n") +
            "\n\nOs dias que faltaram entram sozinhos na corrida de amanhã — a janela " +
            `olha ${JANELA_DIAS} dias para trás e pula o que já está no banco.`,
          { chave: `mt-diaria-falhou:${falhas.length}` },
        );
      }

      // Fecha o mês ANTERIOR a partir do diário, se ele estiver inteiro.
      // Roda aqui, e não num agendamento próprio, porque o único momento em
      // que o mês pode ter ficado completo é logo depois de uma coleta. Com a
      // corrida diária, o mês fecha no primeiro dia do mês seguinte em que a
      // última peça entrar — em vez de esperar o sábado.
      // Mês furado é recusado pela própria função — agosto/2026 tem 4 dias que
      // o portal não devolve, e o número do IMEA continua valendo para ele.
      const mensal = await consolidarMensais(hoje);
      logger.info("coleta diária do MT concluída", {
        disparados: pendentes.length,
        falhas: falhas.length,
        cabecas,
        mensal,
      });
      return { hoje, disparados: pendentes.length, falhas, cabecas, mensal };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("coleta diária do MT falhou", { erro: mensagem });
      try {
        await alertarOperador("MT: a coleta do dia NÃO rodou", mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { hoje, disparados: 0, falhas: [mensagem] };
    }
  },
});

/**
 * Fecha o mensal de MT a partir do diário — DOIS meses por corrida.
 *
 * O mês CORRENTE entra parcial, com os dias que já existem, porque é assim que
 * MS e RO já aparecem e é assim que a planilha se explica ("o mês corrente
 * aparece parcial"). Sem isto o MT simplesmente SUMIA da linha do mês corrente
 * enquanto os vizinhos apareciam — foi o que aconteceu com setembro/2026.
 *
 * O mês ANTERIOR entra só inteiro: ali o furo é permanente, e somar mês furado
 * subestimaria para sempre. É a trava que mantém agosto/2026 com o número do
 * IMEA, já que três dias daquele mês não existem em fonte nenhuma.
 *
 * Nunca lança: o mensal é consequência da coleta, não a razão dela. Se falhar,
 * os dias já estão gravados.
 */
async function consolidarMensais(hojeIso: string) {
  const [ano, mes] = hojeIso.split("-").map(Number) as [number, number];
  const alvos = [
    { data: new Date(Date.UTC(ano, mes - 1, 1)), parcial: true },
    { data: new Date(Date.UTC(ano, mes - 2, 1)), parcial: false },
  ];

  const saida: Array<{ competencia: string; gravou: boolean; motivo?: string; total?: number; dias?: number }> = [];
  for (const alvo of alvos) {
    const a = alvo.data.getUTCFullYear();
    const m = alvo.data.getUTCMonth() + 1;
    const competencia = `${a}-${String(m).padStart(2, "0")}`;
    try {
      const coletaId = await abrirColeta({
        uf: "MT",
        tipo: "mensal",
        janela: { inicio: `${competencia}-01`, fim: `${competencia}-28` },
      });
      const r = await consolidarMesDoDiario({
        uf: "MT",
        ano: a,
        mes: m,
        coletaId,
        permitirParcial: alvo.parcial,
      });
      await fecharColeta({
        id: coletaId,
        status: r.gravou ? "ok" : "sem_dados",
        erro: r.motivo ?? null,
      });
      saida.push({ competencia, ...r });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      logger.warn("consolidação do mensal de MT falhou; os dias estão gravados", { competencia, motivo });
      saida.push({ competencia, gravou: false, motivo });
    }
  }
  return saida;
}
