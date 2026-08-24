import { logger, schedules } from "@trigger.dev/sdk";
import { chromium } from "playwright";
import { lerConfig } from "../config.js";
import { formatarDataBr } from "../ia/dossie.js";
import { enviarImagem, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import {
  listarTelefonesAtivos,
  motivoNinguemRecebeu,
  unirDestinatarios,
} from "../dados/perfis.js";
import { imagensJaEnviadas, marcarImagensEnviadas } from "../dados/envios-imagens.js";

/** As três visões do cartão diário, na ordem em que chegam no WhatsApp. */
const VISOES = [
  { visao: "tabela", rotulo: "Tabela" },
  { visao: "linhas", rotulo: "Linhas" },
  { visao: "colunas", rotulo: "Colunas" },
] as const;

/**
 * Envio diário das 3 imagens da seção diária — roda 7 min depois do cenário
 * das 06:45, fechando a sequência da manhã (planilhas 06:00/06:30, resumo
 * 06:45, imagens 06:52).
 *
 * O princípio: as imagens automáticas são PIXEL POR PIXEL as mesmas do clique
 * manual em "Exportar imagem". Nada é recriado no servidor — um Chromium de
 * verdade loga no site com a conta-robô (formulário real, RLS intacta), abre
 * `/impressao-diario/{visao}` e fotografa o MESMO cartão de 1080px em 2x.
 *
 * Envio único por dia: `peciclo_envios_imagens` é o cadeado — redisparar a
 * rotina no mesmo dia sai com `jaEnviado` sem mandar nada de novo.
 *
 * ISOLADA como as demais: se qualquer coisa aqui falhar, planilhas e cenário
 * não são afetados. E NUNCA lança para o agendador: falha vira alerta.
 */
export const enviarDiarioImagens = schedules.task({
  id: "enviar-diario-imagens",
  cron: {
    pattern: "52 6 * * *",
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  // Chromium + 3 páginas com gráficos: máquina do gerar-e-enviar e folga de tempo.
  machine: "small-2x",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    // Payload defensivo: o agendamento manda timestamp/timezone, um disparo
    // manual pela API pode vir sem eles — cair para "agora" evita quebrar.
    const quando = payload?.timestamp ? new Date(payload.timestamp) : new Date();
    const fuso = payload?.timezone ?? "America/Sao_Paulo";
    const dataLocal = quando.toLocaleDateString("en-CA", { timeZone: fuso });

    try {
      return await executar(dataLocal);
    } catch (erro) {
      // Falha inesperada (banco, login, navegador): alerta e devolve — o
      // fazendeiro nunca recebe erro, quem sabe que quebrou é a operação.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      logger.error("envio diário de imagens falhou", { erro: mensagem });
      try {
        await alertarOperador(`Imagens diárias ${dataLocal} NÃO saíram`, mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { data: dataLocal, imagens: 0, enviados: 0, jaEnviado: false, erro: mensagem };
    }
  },
});

async function executar(dataLocal: string) {
  const cfg = lerConfig();
  const problemas: string[] = [];

  // --- Cadeado do envio único: já saiu hoje? Nada de imagem dupla no zap.
  if (await imagensJaEnviadas(dataLocal)) {
    logger.info("imagens do dia já enviadas — nada a fazer", { data: dataLocal });
    return { data: dataLocal, imagens: 0, enviados: 0, jaEnviado: true, problemas };
  }

  // --- Fotografa o site real com a conta-robô (Chromium sempre fecha).
  const capturas = await fotografarCartoes();
  logger.info("cartões fotografados", {
    visoes: capturas.map((c) => `${c.visao}: ${c.png.length} bytes`),
  });

  // --- Destinatários: clientes ativos do banco ∪ configuração (regra da casa).
  const doBanco = await listarTelefonesAtivos();
  const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
  logger.info("destinatários resolvidos", {
    configuracao: cfg.whatsappDestinatarios.length,
    banco: doBanco.length,
    total: destinatarios.length,
  });

  const conectada = await instanciaConectada({
    instancia: cfg.evolutionInstancia,
    apiKey: cfg.evolutionApiKey,
    baseUrl: cfg.evolutionBaseUrl,
  }).catch(() => false);

  let enviados = 0;
  if (conectada) {
    for (const numero of destinatarios) {
      // Uma falha não derruba o lote — e só conta quem recebeu as 3 imagens.
      try {
        for (const [i, captura] of capturas.entries()) {
          await enviarImagem({
            instancia: cfg.evolutionInstancia,
            apiKey: cfg.evolutionApiKey,
            baseUrl: cfg.evolutionBaseUrl,
            numero,
            imagemBase64: captura.png.toString("base64"),
            legenda: `📊 Abate diário — ${captura.rotulo} · ${formatarDataBr(dataLocal)}`,
            nomeArquivo: `peciclo-diario-${captura.visao}-${dataLocal}.png`,
          });
          // Pausa curta entre as imagens do mesmo destinatário: chegar em
          // ordem (Tabela, Linhas, Colunas) vale mais que alguns segundos.
          if (i < capturas.length - 1) await pausa(500);
        }
        enviados++;
      } catch (erro) {
        logger.error("falha ao enviar imagens para destinatário", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
    // Lista vazia também é falha: sem o `else` da guarda antiga, um dia sem
    // destinatário nenhum fechava verde com `enviados: 0` e sem aviso.
    const ninguem = motivoNinguemRecebeu("as 3 imagens", enviados, destinatarios.length);
    if (ninguem) problemas.push(ninguem);
  } else {
    problemas.push("instância da Evolution desconectada");
  }

  // Chegou completo em pelo menos um cliente: o dia fecha para novos envios.
  if (enviados > 0) {
    try {
      await marcarImagensEnviadas(dataLocal);
    } catch (erro) {
      problemas.push(
        `marcarImagensEnviadas falhou (${erro instanceof Error ? erro.message : String(erro)}) — um redisparo hoje reenviaria`,
      );
    }
  }

  if (problemas.length > 0) {
    await alertarOperador(
      `Imagens diárias ${dataLocal}: ${problemas.length} problema(s)`,
      problemas.join("\n"),
    );
  }

  return { data: dataLocal, imagens: capturas.length, enviados, jaEnviado: false, problemas };
}

/**
 * Loga no site com a conta-robô pelo formulário real e fotografa o cartão de
 * impressão nas 3 visões, em ordem. Lança em qualquer tropeço — quem chama
 * transforma em alerta. O browser SEMPRE fecha.
 */
async function fotografarCartoes(): Promise<
  Array<{ visao: string; rotulo: string; png: Buffer }>
> {
  const site = (process.env.SITE_URL?.trim() || "https://peciclo.com.br").replace(/\/+$/, "");
  const email = process.env.ROBO_IMAGENS_EMAIL?.trim();
  const senha = process.env.ROBO_IMAGENS_SENHA?.trim();
  if (!email || !senha) {
    throw new Error("Variáveis de ambiente ausentes: ROBO_IMAGENS_EMAIL, ROBO_IMAGENS_SENHA");
  }

  const browser = await chromium.launch();
  try {
    const contexto = await browser.newContext({
      // Altura folgada para o cartão inteiro caber sem lazy-render; 2x é a
      // mesma densidade do export manual.
      viewport: { width: 1280, height: 2000 },
      deviceScaleFactor: 2,
    });
    const pagina = await contexto.newPage();

    // Login pelo formulário de verdade (server action) — sem token, sem API.
    await pagina.goto(`${site}/login`, { waitUntil: "load", timeout: 60_000 });
    await pagina.fill('input[name="email"]', email);
    await pagina.fill('input[name="senha"]', senha);
    await pagina.click('button[type="submit"]');
    await pagina.waitForURL("**/painel", { timeout: 30_000 });

    const capturas: Array<{ visao: string; rotulo: string; png: Buffer }> = [];
    for (const { visao, rotulo } of VISOES) {
      await pagina.goto(`${site}/impressao-diario/${visao}`, {
        waitUntil: "load",
        timeout: 60_000,
      });
      // O cartão avisa quando os SVGs montaram (a tabela já nasce pronta).
      await pagina.waitForSelector("[data-impressao-pronta]", {
        state: "attached",
        timeout: 30_000,
      });
      await pagina.waitForTimeout(400); // assentar fontes/último paint
      // NÃO é screenshot: a página expõe a MESMA captura do botão "Exportar
      // imagem" (html-to-image, margem de marca, 2x). Screenshot do elemento
      // saía sem margem e cortando borda — reclamação real do dono em 19/08.
      const dataUrl = await pagina.evaluate(async () => {
        // No navegador globalThis === window; a raiz não tem os tipos do DOM.
        const capturar = (globalThis as unknown as { __capturarCartaoPng?: () => Promise<string> })
          .__capturarCartaoPng;
        if (!capturar) throw new Error("captura da página não registrada");
        return await capturar();
      });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      if (base64 === dataUrl || base64.length < 1000) {
        throw new Error("captura da página não devolveu um PNG");
      }
      const png = Buffer.from(base64, "base64");
      capturas.push({ visao, rotulo, png });
    }
    return capturas;
  } finally {
    await browser.close();
  }
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
