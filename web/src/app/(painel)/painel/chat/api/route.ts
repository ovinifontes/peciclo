import { exigirClienteAtivo } from "@/lib/dal";
import { criarClienteAdmin } from "@/lib/admin-db";
import { montarContextoChat } from "@/lib/dados";
import { sistemaChat, streamChat, type MensagemChat } from "@/lib/ia";

/**
 * O chat: recebe o histórico do cliente, responde em streaming e grava a
 * conversa. Um Route Handler é uma requisição direta — o layout de `(painel)`
 * NÃO roda antes dele —, então `exigirClienteAtivo()` é a primeira linha:
 * sem sessão o `redirect` do dal responde 307 e nenhum byte sai daqui; conta
 * suspensa no meio da conversa é barrada na mensagem seguinte.
 */

const MAX_MENSAGENS = 40;
const MAX_CHARS = 4_000;
const LIMITE_DIARIO = 50;

/**
 * Valida o corpo `{ mensagens: [...] }` sem confiar em nada: formato, papéis,
 * tamanho de cada mensagem, teto de itens, e a última mensagem tem que ser a
 * pergunta do usuário — é ela que a gravação persiste como pergunta.
 */
function validarMensagens(corpo: unknown): MensagemChat[] | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const { mensagens } = corpo as { mensagens?: unknown };
  if (!Array.isArray(mensagens) || mensagens.length === 0 || mensagens.length > MAX_MENSAGENS) {
    return null;
  }

  const validas: MensagemChat[] = [];
  for (const m of mensagens) {
    if (typeof m !== "object" || m === null) return null;
    const { papel, conteudo } = m as { papel?: unknown; conteudo?: unknown };
    if (papel !== "usuario" && papel !== "assistente") return null;
    if (typeof conteudo !== "string" || !conteudo.trim() || conteudo.length > MAX_CHARS) return null;
    validas.push({ papel, conteudo });
  }

  if (validas.at(-1)?.papel !== "usuario") return null;
  return validas;
}

/** Fronteiras do dia em America/Sao_Paulo (UTC−3 fixo: o DST acabou em 2019). */
function diaSaoPaulo(): { inicio: string; fim: string } {
  const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const seguinte = new Date(`${dia}T12:00:00Z`);
  seguinte.setUTCDate(seguinte.getUTCDate() + 1);
  return {
    inicio: `${dia}T00:00:00-03:00`,
    fim: `${seguinte.toISOString().slice(0, 10)}T00:00:00-03:00`,
  };
}

export async function POST(request: Request) {
  const perfil = await exigirClienteAtivo();

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ erro: "corpo" }, { status: 400 });
  }
  const mensagens = validarMensagens(corpo);
  if (!mensagens) return Response.json({ erro: "corpo" }, { status: 400 });

  // A pergunta é a última mensagem — `validarMensagens` garante o papel.
  const pergunta = mensagens.at(-1)!.conteudo;
  const admin = criarClienteAdmin();

  let streamModelo: ReadableStream<Uint8Array>;
  try {
    // Limite diário ANTES de pagar a chamada do modelo. Contagem via
    // service_role: a tabela não tem GRANT de INSERT a authenticated e o
    // navegador não escreve nela — quem conta e grava é o servidor.
    const { inicio, fim } = diaSaoPaulo();
    const { count, error } = await admin
      .from("peciclo_chat_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", perfil.id)
      .eq("papel", "usuario")
      .gte("criado_em", inicio)
      .lt("criado_em", fim);
    if (error) throw new Error(`Falha ao contar mensagens do dia: ${error.message}`);
    if ((count ?? 0) >= LIMITE_DIARIO) {
      return Response.json({ erro: "limite" }, { status: 429 });
    }

    streamModelo = await streamChat({
      sistema: sistemaChat(await montarContextoChat()),
      mensagens,
    });
  } catch (erro) {
    // Nada foi enviado ainda: dá para responder um 500 limpo. A mensagem não
    // vai ao cliente — pode citar nome de variável de ambiente, por exemplo.
    console.error("chat: falha antes do stream:", erro);
    return Response.json({ erro: "interno" }, { status: 500 });
  }

  // --- Repasse do stream com gravação DENTRO do ciclo de vida da resposta.
  // Em serverless, a função morre quando a resposta termina: um "fire and
  // forget" depois do return perderia a gravação. Por isso o `await` na
  // gravação acontece no fim do pull (antes de fechar o stream) e no cancel
  // (cliente desconectou — persiste o que ele chegou a ver).
  const leitor = streamModelo.getReader();
  const decodificador = new TextDecoder();
  let resposta = "";
  let gravado = false;

  const gravarConversa = async () => {
    if (gravado) return;
    gravado = true;
    // Stream que falhou antes do primeiro byte não vira conversa: o cliente
    // não viu nada e a pergunta não deve consumir o limite diário.
    if (!resposta.trim()) return;
    const { error } = await admin.from("peciclo_chat_mensagens").insert([
      { usuario_id: perfil.id, papel: "usuario", conteudo: pergunta },
      { usuario_id: perfil.id, papel: "assistente", conteudo: resposta },
    ]);
    // A resposta já está na tela do cliente — falha de gravação é problema
    // de operação (fica no log da Vercel), não motivo para errar o stream.
    if (error) console.error("chat: falha ao gravar conversa:", error.message);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let lido: ReadableStreamReadResult<Uint8Array>;
      try {
        lido = await leitor.read();
      } catch (erro) {
        // Erro no meio do stream (evento `error` da API, rede): grava o que
        // já saiu — o cliente viu esse texto — e encerra com erro.
        console.error("chat: stream interrompido:", erro);
        await gravarConversa();
        controller.error(erro);
        return;
      }
      if (lido.done) {
        await gravarConversa();
        controller.close();
        return;
      }
      resposta += decodificador.decode(lido.value, { stream: true });
      controller.enqueue(lido.value);
    },
    async cancel(motivo) {
      await leitor.cancel(motivo);
      await gravarConversa();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Conversa de cliente autenticado: nenhum cache, nenhum proxy guarda.
      "cache-control": "private, no-store",
    },
  });
}
