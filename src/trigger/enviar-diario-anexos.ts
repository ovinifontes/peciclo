import { logger, schedules } from "@trigger.dev/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { lerConfig } from "../config.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { formatarDataBr } from "../ia/dossie.js";
import { gerarPlanilhaDiaria } from "../planilha/gerar-diario.js";
import { enviarDocumento, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";
import {
  listarTelefonesAtivos,
  motivoNinguemRecebeu,
  unirDestinatarios,
} from "../dados/perfis.js";
import { imagensJaEnviadas, marcarImagensEnviadas } from "../dados/envios-imagens.js";

/**
 * As páginas de cada PDF: a MESMA visão (Colunas) com quatro seleções de
 * estado — o consolidado e depois cada estado sozinho.
 *
 * Quatro fotos do mesmo gráfico e não quatro gráficos diferentes de propósito:
 * o consolidado responde "como está o Centro-Oeste" e as três páginas
 * seguintes respondem "de onde veio esse movimento", na mesma escala visual e
 * com os mesmos eixos. Trocar a visão entre páginas obrigaria o leitor a
 * reaprender o desenho a cada folha.
 */
export const PAGINAS_PDF = [
  { ufs: "MT,MS,RO", rotulo: "MT + MS + RO" },
  { ufs: "MT", rotulo: "Mato Grosso" },
  { ufs: "MS", rotulo: "Mato Grosso do Sul" },
  { ufs: "RO", rotulo: "Rondônia" },
] as const;

/** A visão fotografada nas quatro páginas. */
const VISAO_PDF = "colunas";

/**
 * Os PDFs do dia, na ordem de envio: mesma receita (Colunas × 4 seleções),
 * uma seção do painel cada. O diário entrou em 29/09/2026 a pedido do cliente,
 * "igual manda no mensal".
 */
const PDFS = [
  { rota: "impressao-mensal", titulo: "Abate mensal por estado", emoji: "📈", arquivo: "peciclo-abate-mensal" },
  { rota: "impressao-diario", titulo: "Abate diário por estado", emoji: "📉", arquivo: "peciclo-abate-diario" },
] as const;

/**
 * Envio diário dos anexos — roda 7 min depois do cenário das 06:45, fechando a
 * sequência da manhã (planilhas 06:00/06:30, resumo 06:45, anexos 06:52).
 *
 * Manda TRÊS arquivos, nesta ordem:
 *
 * 1. um PDF de 4 páginas com o abate MENSAL por estado em Colunas — o
 *    consolidado e cada estado sozinho;
 * 2. o mesmo PDF para o abate DIÁRIO por estado (desde 29/09/2026);
 * 3. a planilha do abate diário por estado, a série inteira.
 *
 * Substituiu, em 28/09/2026, o envio de 3 imagens soltas da seção diária. O
 * motivo foi do cliente: três PNGs viram três rolagens no WhatsApp e a foto da
 * tabela cortava estado no meio. Um PDF abre paginado, e a tabela vira planilha
 * onde ela serve para fazer conta.
 *
 * O princípio não mudou: as páginas do PDF são PIXEL POR PIXEL as imagens do
 * clique manual em "Exportar imagem". Nada é recriado no servidor — um Chromium
 * de verdade loga no site com a conta-robô (formulário real, RLS intacta), abre
 * `/impressao-mensal/colunas?ufs=…` e `/impressao-diario/colunas?ufs=…` e chama
 * a MESMA captura do botão.
 *
 * Envio único por dia: `peciclo_envios_imagens` é o cadeado — redisparar a
 * rotina no mesmo dia sai com `jaEnviado` sem mandar nada de novo.
 *
 * ISOLADA como as demais: se qualquer coisa aqui falhar, planilhas e cenário
 * não são afetados. E NUNCA lança para o agendador: falha vira alerta.
 */
export const enviarDiarioAnexos = schedules.task({
  id: "enviar-diario-anexos",
  cron: {
    pattern: "52 6 * * *",
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  // Chromium + 4 páginas com gráficos + montagem do PDF: máquina do
  // gerar-e-enviar e folga de tempo.
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
      logger.error("envio diário de anexos falhou", { erro: mensagem });
      try {
        await alertarOperador(`Anexos diários ${dataLocal} NÃO saíram`, mensagem);
      } catch (falhaAlerta) {
        logger.error("falha até no alerta ao operador", {
          erro: falhaAlerta instanceof Error ? falhaAlerta.message : String(falhaAlerta),
        });
      }
      return { data: dataLocal, enviados: 0, jaEnviado: false, erro: mensagem };
    }
  },
});

async function executar(dataLocal: string) {
  const cfg = lerConfig();
  const problemas: string[] = [];

  // --- Cadeado do envio único: já saiu hoje? Nada de anexo dobrado no zap.
  if (await imagensJaEnviadas(dataLocal)) {
    logger.info("anexos do dia já enviados — nada a fazer", { data: dataLocal });
    return { data: dataLocal, enviados: 0, jaEnviado: true, problemas };
  }

  // --- Os anexos. Os PDFs fotografam o site; a planilha sai do banco.
  const pdfs = await montarPdfsDoDia();
  const planilha = await gerarPlanilhaDiaria(dataLocal);
  logger.info("anexos prontos", {
    pdfs: pdfs.map((p) => `${p.arquivo}: ${p.pdf.length}`),
    planilha: planilha.length,
  });

  const nomePlanilha = `peciclo-abate-diario-${dataLocal}.xlsx`;
  // Arquivar antes de enviar: se a Evolution estiver fora, o dia não se perde.
  for (const { arquivo, pdf } of pdfs) {
    await arquivarBruto({ caminho: `pdfs/${arquivo}-${dataLocal}.pdf`, conteudo: pdf, contentType: "application/pdf" });
  }
  await arquivarBruto({ caminho: `planilhas-diario/${nomePlanilha}`, conteudo: planilha });

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

  const anexos = [
    ...pdfs.map(({ titulo, emoji, arquivo, pdf }) => ({
      arquivo: pdf,
      nomeArquivo: `${arquivo}-${dataLocal}.pdf`,
      legenda:
        `${emoji} ${titulo} · Colunas — ${formatarDataBr(dataLocal)}\n` +
        `4 páginas: ${PAGINAS_PDF.map((p) => p.rotulo).join(", ")}.`,
    })),
    {
      arquivo: planilha,
      nomeArquivo: nomePlanilha,
      legenda:
        `📊 Abate diário por estado — série completa até ${formatarDataBr(dataLocal)}\n` +
        "Fêmeas, machos e total por dia, com a % de fêmeas em fórmula.",
    },
  ];

  let enviados = 0;
  if (conectada) {
    for (const numero of destinatarios) {
      // Uma falha não derruba o lote — e só conta quem recebeu TODOS os anexos.
      try {
        for (const [i, anexo] of anexos.entries()) {
          await enviarDocumento({
            instancia: cfg.evolutionInstancia,
            apiKey: cfg.evolutionApiKey,
            baseUrl: cfg.evolutionBaseUrl,
            numero,
            ...anexo,
          });
          // Pausa curta: chegar em ordem (mensal, diário, planilha) vale mais
          // que alguns segundos.
          if (i < anexos.length - 1) await pausa(500);
        }
        enviados++;
      } catch (erro) {
        logger.error("falha ao enviar anexos para destinatário", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
    // Lista vazia também é falha: sem esta guarda, um dia sem destinatário
    // nenhum fechava verde com `enviados: 0` e sem aviso.
    const ninguem = motivoNinguemRecebeu("os anexos do dia", enviados, destinatarios.length);
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
      `Anexos diários ${dataLocal}: ${problemas.length} problema(s)`,
      problemas.join("\n"),
    );
  }

  return { data: dataLocal, pdfs: pdfs.length, enviados, jaEnviado: false, problemas };
}

/**
 * Largura e altura de um PNG, lidas do IHDR — sempre o primeiro chunk, com os
 * dois inteiros big-endian nos bytes 16..24. É tudo o que precisamos saber da
 * imagem; uma biblioteca de imagem aqui seria dependência nova para duas linhas.
 */
export function dimensoesPng(png: Buffer): { largura: number; altura: number } {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452 /* "IHDR" */) {
    throw new Error("não parece um PNG: IHDR ausente");
  }
  return { largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) };
}

/**
 * O HTML de uma folha por imagem, e o tamanho da folha.
 *
 * A folha fica com a proporção da imagem MAIS ALTA do lote: assim nenhuma
 * transborda para uma segunda página. As outras ficam centradas, e a faixa
 * branca que sobra passa por margem. O contrário — folha pela imagem mais
 * baixa — cortaria gráfico, que é o único erro inaceitável aqui.
 *
 * Largura fixa em 1080: é a largura do cartão, então a imagem entra em escala
 * 1:1 de leiaute e o texto do PDF sai no tamanho que foi desenhado.
 */
export function montarHtmlDoPdf(pngs: Buffer[]): { html: string; largura: number; altura: number } {
  if (pngs.length === 0) throw new Error("PDF sem nenhuma página");
  const largura = 1080;
  const altura = Math.ceil(
    Math.max(...pngs.map((png) => {
      const d = dimensoesPng(png);
      return (largura * d.altura) / d.largura;
    })),
  );

  const folhas = pngs
    .map(
      (png) =>
        `<div class="folha"><img src="data:image/png;base64,${png.toString("base64")}"></div>`,
    )
    .join("");

  return {
    largura,
    altura,
    html:
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>` +
      `@page{size:${largura}px ${altura}px;margin:0}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      // `break-after` na última folha criaria uma página em branco no fim.
      `.folha{width:${largura}px;height:${altura}px;display:flex;align-items:center;` +
      `justify-content:center;break-after:page}` +
      `.folha:last-child{break-after:auto}` +
      `img{max-width:100%;max-height:100%;display:block}` +
      `</style></head><body>${folhas}</body></html>`,
  };
}

/**
 * Loga no site com a conta-robô UMA vez e, para cada seção de `PDFS`,
 * fotografa as quatro seleções e costura o PDF. Lança em qualquer tropeço —
 * quem chama transforma em alerta. O browser SEMPRE fecha.
 */
export async function montarPdfsDoDia(): Promise<Array<(typeof PDFS)[number] & { pdf: Buffer }>> {
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

    const saida: Array<(typeof PDFS)[number] & { pdf: Buffer }> = [];
    for (const secao of PDFS) {
      const pngs: Buffer[] = [];
      for (const { ufs, rotulo } of PAGINAS_PDF) {
        pngs.push(await fotografarCartao(pagina, site, secao.rota, ufs));
        logger.info("página do PDF fotografada", { secao: secao.rota, rotulo, bytes: pngs.at(-1)!.length });
      }
      saida.push({ ...secao, pdf: await montarPdf(browser, pngs) });
    }
    return saida;
  } finally {
    await browser.close();
  }
}

/** Uma seleção de estados, fotografada pela MESMA captura do botão manual. */
async function fotografarCartao(
  pagina: Page,
  site: string,
  rota: string,
  ufs: string,
): Promise<Buffer> {
  const url = `${site}/${rota}/${VISAO_PDF}?ufs=${encodeURIComponent(ufs)}`;
  await pagina.goto(url, { waitUntil: "load", timeout: 60_000 });
  // O cartão avisa quando os SVGs montaram.
  await pagina.waitForSelector("[data-impressao-pronta]", { state: "attached", timeout: 30_000 });
  await pagina.waitForTimeout(400); // assentar fontes/último paint

  // NÃO é screenshot: a página expõe a MESMA captura do botão "Exportar
  // imagem" (html-to-image, margem de marca, 2x). Screenshot do elemento saía
  // sem margem e cortando borda — reclamação real do dono em 19/08.
  const dataUrl = await pagina.evaluate(async () => {
    // No navegador globalThis === window; a raiz não tem os tipos do DOM.
    const capturar = (globalThis as unknown as { __capturarCartaoPng?: () => Promise<string> })
      .__capturarCartaoPng;
    if (!capturar) throw new Error("captura da página não registrada");
    return await capturar();
  });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  if (base64 === dataUrl || base64.length < 1000) {
    throw new Error(`captura de ${rota} ${ufs} não devolveu um PNG`);
  }
  return Buffer.from(base64, "base64");
}

/**
 * Costura os PNGs num PDF usando o próprio Chromium que já está aberto.
 *
 * Sem biblioteca de PDF de propósito: escrever um PDF com imagem embutida não
 * é "algumas linhas", mas o navegador que tirou as fotos já sabe imprimir — e
 * é uma dependência a menos para manter, auditar e empacotar no deploy.
 */
async function montarPdf(browser: Browser, pngs: Buffer[]): Promise<Buffer> {
  const { html, largura, altura } = montarHtmlDoPdf(pngs);
  // Aba própria, sem deviceScaleFactor: a densidade já está DENTRO do PNG, e
  // repetir o 2x aqui só inflaria o arquivo.
  const pagina = await (await browser.newContext()).newPage();
  try {
    await pagina.setContent(html, { waitUntil: "load", timeout: 60_000 });
    // `load` não garante que as imagens decodificaram; sem isto o PDF pode
    // sair com folha em branco.
    await pagina.waitForFunction(
      () => {
        // A raiz não tem os tipos do DOM; no navegador globalThis é o window.
        const imagens = (globalThis as unknown as {
          document: { images: { length: number; item(i: number): { complete: boolean } | null } };
        }).document.images;
        for (let i = 0; i < imagens.length; i++) {
          if (!imagens.item(i)?.complete) return false;
        }
        return true;
      },
      undefined,
      { timeout: 30_000 },
    );
    return await pagina.pdf({
      width: `${largura}px`,
      height: `${altura}px`,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await pagina.close();
  }
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
