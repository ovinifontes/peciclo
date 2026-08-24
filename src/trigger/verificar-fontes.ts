import { logger, schedules } from "@trigger.dev/sdk";
import { descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { anosParaVarrer, encontrarPastaDoAno } from "../coletores/pa.js";
import { alertarOperador } from "../notificacao/alertas.js";

const CHAVE_RO_CONHECIDA = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

/**
 * Os dois portais que dependem de identificadores externos podem mudá-los sem
 * aviso, e a coleta pararia em silêncio. Esta verificação transforma um
 * silêncio em alerta.
 *
 * Ela só alerta o que exige AÇÃO do operador. Site fora do ar, layout mudado e
 * pasta do ano ainda não criada não são ação: enquanto a coleta continua
 * funcionando, viram log. Vigia que grita toda semana deixa de ser lido.
 *
 * E, como o operador só é avisado por WhatsApp, esta task NUNCA lança: falha
 * inesperada (timeout na descoberta, por exemplo) vira alerta — senão o vigia
 * morre e ninguém fica sabendo.
 */
export const verificarFontes = schedules.task({
  id: "verificar-fontes",
  cron: { pattern: "0 7 * * 1", timezone: "America/Sao_Paulo", environments: ["PRODUCTION"] },
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async () => {
    try {
      return await executar();
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("verificação de fontes falhou", { erro: mensagem });
      try {
        await alertarOperador("Verificação de fontes NÃO rodou", mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { problemas: [], erro: mensagem };
    }
  },
});

async function executar() {
  const problemas: string[] = [];

  // --- IDARON: só a chave TROCADA é problema. Não achar o link não é — e
  // --- "não achar" inclui a página EXPLODIR: o site do IDARON recusa a nuvem
  // --- estrangeira (mesmo geo-bloqueio do CEPEA e do IMEA), então daqui o
  // --- fetch falha toda semana. A coleta do RO não passa por essa página; ela
  // --- fala com o Power BI, que responde normalmente. Rede não é notícia.
  let chaveRo: string | null = null;
  try {
    const urlRo = await descobrirRelatorio();
    chaveRo = urlRo ? extrairChaveRecurso(urlRo) : null;
  } catch (erro) {
    logger.warn("IDARON: página inacessível daqui — coleta segue com a chave padrão", {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
  if (!chaveRo) {
    logger.warn("IDARON: não achei o link do Power BI na página — coleta segue com a chave padrão");
  } else if (chaveRo !== CHAVE_RO_CONHECIDA) {
    problemas.push(`IDARON: resource key mudou para ${chaveRo} — atualizar CHAVE_PADRAO`);
  }

  // --- ADEPARA: a pasta do ano corrente só nasce quando o primeiro arquivo
  // --- dele é publicado, lá por março. Até lá a coleta vive da pasta do ano
  // --- anterior, então o alerta só vale se NENHUMA das duas existir.
  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const anos = anosParaVarrer(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)));
    try {
      const pastas = await Promise.all(anos.map((ano) => encontrarPastaDoAno(ano, apiKey)));
      if (pastas.every((p) => p === null)) {
        problemas.push(`ADEPARA: não encontrei no Drive a pasta de GTAs de ${anos.join(" nem de ")}`);
      }
    } catch (erro) {
      // Mesma regra: Drive fora do ar é rede, não mudança de identificador.
      logger.warn("ADEPARA: Drive inacessível nesta verificação", {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  if (problemas.length > 0) {
    await alertarOperador("Verificação de fontes encontrou problemas", problemas.join("\n"));
  }
  logger.info("verificação de fontes concluída", { problemas: problemas.length });
  return { problemas };
}
