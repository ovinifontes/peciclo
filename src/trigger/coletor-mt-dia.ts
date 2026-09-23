import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import {
  abrirSessaoSindesa2,
  coletarDiaSindesa2,
  prepararPesquisa,
  SessaoSindesa2Error,
} from "../coletores/mt-sindesa2.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { gravarAgregadosDiarios } from "../dados/diario.js";
import { arquivarBruto } from "../dados/arquivos.js";

/**
 * Coleta UM dia do MT no SINDESA 2. É a unidade de trabalho da coleta semanal.
 *
 * Um dia por execução, e não a semana inteira numa só, por três motivos que
 * valem mais que a economia de uma task: um dia que falha não derruba os
 * outros seis, cada dia ganha o retry do Trigger.dev de graça, e nenhuma
 * execução chega perto do limite de tempo. Medido no servidor deles (sonda de
 * 23/09/2026): ~5 min para um dia útil de ~800 GTAs.
 *
 * `concurrencyLimit: 1` é a regra de gentileza da casa: o INDEA é serviço
 * público, e a semana inteira disparada de uma vez viraria sete navegadores
 * simultâneos no portal.
 */
export const coletorMtDia = task({
  id: "coletor-mt-dia",
  queue: { concurrencyLimit: 1 },
  machine: "small-2x",
  // ~5 min medidos num dia útil; 1800 cobre um dia atípico e o retry interno
  // das GTAs sem que o teto vire a causa da falha.
  maxDuration: 1800,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 600_000,
    randomize: true,
  },
  run: async (payload: { dia: string; refazer?: boolean }) => {
    const cpf = process.env.INDEA_CPF;
    const senha = process.env.INDEA_SENHA;
    // Credencial ausente nunca melhora com retry.
    if (!cpf || !senha) throw new AbortTaskRunError("INDEA_CPF/INDEA_SENHA ausentes");

    const { dia } = payload;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      throw new AbortTaskRunError(`dia inválido: ${dia}`);
    }

    const sessao = await abrirSessaoSindesa2(cpf, senha);
    const coletaId = await abrirColeta({
      uf: "MT",
      tipo: "diaria",
      janela: { inicio: dia, fim: dia },
    });

    try {
      await prepararPesquisa(sessao.page);
      const r = await coletarDiaSindesa2(sessao.page, dia);

      // As duas guardas que impedem um dia MENOR do que foi de entrar calado.
      // Já barraram três defeitos diferentes de paginação durante o backfill;
      // sem elas o abate entraria 40 a 50 GTAs menor e leria como mercado
      // caindo, não como bug.
      const semDados = r.semEstratificacao.length;
      if (semDados > 0 && semDados > r.gtas.length * 0.02) {
        throw new SessaoSindesa2Error(
          `${semDados} de ${r.gtas.length} GTAs vieram sem Estratificação — leitura quebrada`,
        );
      }
      if (r.divergentes.length > 0) {
        throw new SessaoSindesa2Error(
          `${r.divergentes.length} GTAs não fecham com a taxa por animal ` +
            `(ex.: ${r.divergentes.slice(0, 3).join(", ")})`,
        );
      }

      const cabecas = r.agregados.reduce((s, a) => s + a.quantidade, 0);

      if (r.agregados.length > 0) {
        // Trilha de auditoria enxuta: o HTML das ~800 GTAs daria ~100 MB por
        // dia. Guarda-se a leitura por GTA, que basta para reconferir a soma
        // depois sem voltar ao portal.
        await arquivarBruto({
          caminho: `mt-sindesa2/${dia}.json`,
          conteudo: Buffer.from(
            JSON.stringify({ dia, gtas: r.gtas.map((g) => ({ id: g.id, linhas: g.linhas })) }),
          ),
          contentType: "application/json",
        });
        await gravarAgregadosDiarios(r.agregados, coletaId, "sindesa2_gta");
      }

      await fecharColeta({
        id: coletaId,
        status: r.agregados.length > 0 ? "ok" : "sem_dados",
        linhasAfetadas: r.agregados.length,
      });
      logger.info("dia do MT coletado", { dia, gtas: r.gtas.length, cabecas });
      return { dia, gtas: r.gtas.length, cabecas };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    } finally {
      await sessao.fechar();
    }
  },
});
