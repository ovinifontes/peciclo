import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { CredencialInvalidaError, atribuirDia, coletarMt } from "../coletores/mt.js";
import { abrirColeta, coletaVaziaSuspeita, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { congeladoDesde, gravarAgregados } from "../dados/mensal.js";
import { gravarAgregadosDiarios } from "../dados/diario.js";
import { alertarOperador } from "../notificacao/alertas.js";
import type { TipoColeta } from "../tipos.js";

// O INDEA não publica histórico por dia, mas o relatório aceita janela de 1
// dia (aditividade provada na exploração): o diário do MT se constrói daqui
// em diante, reconsultando os últimos dias para capturar GTA lançada com
// atraso. 3 dias ≈ 3 consultas extras por run, dentro do WAF e do maxDuration.
const DIAS_DIARIO_MT = 3;

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
  // 600: o mensal (~2 min) mais até 3 consultas diárias de 1 dia cada.
  maxDuration: 600,
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

      // Diário: SÓ roda se o mensal acima já gravou — se o mensal lançar, o
      // catch lá embaixo fecha a coleta como falha e nada daqui executa.
      // Sequencial na mesma run (um login por vez, o WAF agradece), e num
      // try/catch que engole a falha: HOJE o export do INDEA está quebrado e
      // isto vai falhar todos os dias até consertarem — é o esperado, não é
      // alerta (o mensal, que quebra pelo MESMO motivo, já alerta o operador).
      let diasDiario = 0;
      let diasVazios = 0;
      try {
        for (let atras = 1; atras <= DIAS_DIARIO_MT; atras++) {
          const d = new Date(`${payload.ateIso}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - atras);
          const dia = d.toISOString().slice(0, 10);

          // nomeArquivo já embute a janela (mt/DIA_a_DIA.xlsx): não colide
          // com o arquivo do mês nem com o de outro dia.
          const doDia = await coletarMt({ inicio: dia, fim: dia }, cpf, senha);
          await arquivarBruto({ caminho: doDia.nomeArquivo, conteudo: doDia.arquivo });
          await gravarAgregadosDiarios(atribuirDia(doDia.agregados, dia), coletaId);
          diasDiario += 1;
          if (doDia.agregados.length === 0) diasVazios += 1;
          logger.info("dia do MT gravado", { dia, agregados: doDia.agregados.length });
        }
      } catch (erro) {
        logger.warn("coleta diária do MT indisponível; mensal intacto", {
          erro: erro instanceof Error ? erro.message : String(erro),
          diasGravados: diasDiario,
        });
      }

      // MT emite ~25 mil cabeças/dia: três dias seguidos VAZIOS é impossível
      // de verdade — é o relatório respondendo com banco congelado (visto em
      // 08/2026: as guias novas nascem no SINDESA novo e não abastecem o banco
      // antigo do InfoSindesa). Sem este alerta, a coleta "funciona" todos os
      // dias entregando dado parado — falha silenciosa, a pior de todas.
      // TODOS os dias SONDADOS vazios, não os 3 combinados: exigir a sondagem
      // completa fazia um único timeout do WAF na 3ª consulta calar o alerta
      // para sempre — a condição de detectar congelamento não pode depender de
      // a rede ter colaborado.
      if (diasVazios === diasDiario && diasDiario > 0) {
        // A duração vai no ASSUNTO de propósito: problema crônico com texto
        // fixo era suprimido como repetição e o silêncio passava a ler como
        // "voltou a funcionar" — foi o que aconteceu em 25/08. Com o número de
        // dias, cada manhã é notícia nova e o operador vê a coisa piorando.
        const congelado = await congeladoDesde({ uf: "MT", ano: payload.ano, mes: payload.mes });
        const quanto = congelado ? ` há ${congelado.dias} dia(s)` : "";
        const desde = congelado ? ` O último número novo é de ${congelado.desde}.` : "";
        await alertarOperador(
          `MT: dado CONGELADO${quanto} (o relatório responde, mas vem vazio)`,
          `Os últimos ${diasDiario} dias sondados vieram vazios no GTA Condensado — o banco do ` +
            "InfoSindesa não recebe as guias do SINDESA novo." +
            desde +
            " O mensal do MT continua coberto pelo IMEA; o diário fica sem fonte até " +
            "o INDEA destravar o portal ou o SINDESA novo abrir consulta.",
        );
      }

      await fecharColeta({
        id: coletaId,
        status: agregados.length > 0 ? "ok" : "sem_dados",
        arquivoPath: nomeArquivo,
        arquivoHash: hash,
        linhasAfetadas: agregados.length,
      });
      logger.info("coletor MT concluído", { agregados: agregados.length, diasDiario });

      // "sem_dados" ficava só no banco de coletas e ninguém lia: mês que já
      // devia ter volume voltando VAZIO é falha silenciosa, e falha silenciosa
      // alerta (ver `coletaVaziaSuspeita`). Depois do fecharColeta de
      // propósito — falha de alerta não pode desmentir a coleta registrada.
      if (coletaVaziaSuspeita({ linhas: agregados.length, ano: payload.ano, mes: payload.mes })) {
        await alertarOperador(
          "MT: coleta mensal voltou VAZIA",
          `O GTA Condensado respondeu, mas nenhuma linha de abate bovino saiu para ${String(payload.mes).padStart(2, "0")}/${payload.ano} ` +
            `(janela ${inicio} a ${payload.ateIso}). Nada foi gravado: o mensal de MT está parado no ` +
            "último valor bom até isso ser conferido.",
        ).catch((erro) =>
          logger.error("falha ao alertar coleta vazia do MT", {
            erro: erro instanceof Error ? erro.message : String(erro),
          }),
        );
      }

      return { uf: "MT" as const, agregados: agregados.length, diasDiario };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      // Credencial rejeitada também não melhora com retry.
      if (erro instanceof CredencialInvalidaError) throw new AbortTaskRunError(mensagem);
      throw erro;
    }
  },
});
