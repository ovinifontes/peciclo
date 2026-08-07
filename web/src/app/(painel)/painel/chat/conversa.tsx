"use client";

import { useEffect, useRef, useState } from "react";

export interface Mensagem {
  papel: "usuario" | "assistente";
  conteudo: string;
}

// Os mesmos tetos da rota (`./api/route.ts`): estourar aqui viraria 400 lá.
const MAX_MENSAGENS = 40;
const MAX_CHARS = 4_000;

const ERRO_LIMITE =
  "Você chegou ao limite de mensagens de hoje. O chat abre de novo amanhã.";
const ERRO_GENERICO = "Não consegui responder agora. Tente de novo em instantes.";

/**
 * A conversa: bolhas, campo de pergunta e a leitura do stream. O texto chega
 * por `res.body.getReader()` e vai sendo anexado à última bolha — o cliente
 * vê a resposta nascer, como no painel de qualquer chat que se preze.
 */
export default function Conversa({ historico }: { historico: Mensagem[] }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>(historico);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  // Rola para o fim a cada pedaço novo — quem lê acompanha a resposta nascer.
  useEffect(() => {
    const area = areaRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [mensagens]);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;

    setErro(null);
    setEnviando(true);
    setTexto("");

    // O corpo vai DENTRO dos tetos da rota: só as últimas mensagens, cada uma
    // cortada em 4k (uma resposta longa do assistente passaria do limite), e
    // sem começar por "assistente" — a API do modelo exige abrir com o usuário.
    const conversa = [...mensagens, { papel: "usuario" as const, conteudo: pergunta }];
    const envio = conversa
      .slice(-MAX_MENSAGENS)
      .map((m) => ({ papel: m.papel, conteudo: m.conteudo.slice(0, MAX_CHARS) }));
    while (envio[0]?.papel === "assistente") envio.shift();

    // A bolha vazia do assistente entra já — é nela que o stream se acumula.
    setMensagens([...conversa, { papel: "assistente", conteudo: "" }]);

    try {
      const res = await fetch("/painel/chat/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mensagens: envio }),
      });
      if (!res.ok || !res.body) {
        setErro(res.status === 429 ? ERRO_LIMITE : ERRO_GENERICO);
        setMensagens(conversa); // some a bolha vazia; a pergunta fica na tela
        return;
      }

      const leitor = res.body.getReader();
      const decodificador = new TextDecoder();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        const pedaco = decodificador.decode(value, { stream: true });
        setMensagens((atual) => {
          const proxima = atual.slice();
          const ultima = proxima[proxima.length - 1];
          proxima[proxima.length - 1] = { ...ultima, conteudo: ultima.conteudo + pedaco };
          return proxima;
        });
      }
    } catch {
      // Rede caiu (antes ou no meio do stream): o que já chegou fica na tela.
      setErro(ERRO_GENERICO);
      setMensagens((atual) =>
        atual.at(-1)?.papel === "assistente" && !atual.at(-1)?.conteudo ? atual.slice(0, -1) : atual,
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={areaRef}
        className="flex h-[24rem] flex-col gap-3 overflow-y-auto rounded-lg border bg-neutral-50/60 p-4 md:h-[28rem]"
      >
        {mensagens.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--ouro)]" />
            <p className="max-w-xs text-sm text-neutral-500">
              Comece perguntando, por exemplo: “Em que fase do ciclo estamos?” ou “Qual a
              participação de fêmeas no abate?”
            </p>
          </div>
        )}

        {mensagens.map((m, i) =>
          m.papel === "usuario" ? (
            <div
              key={i}
              className="max-w-[85%] self-end whitespace-pre-line rounded-lg rounded-br-sm border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[0.9375rem] leading-relaxed text-emerald-950"
            >
              {m.conteudo}
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[85%] self-start whitespace-pre-line rounded-lg rounded-bl-sm border bg-white px-4 py-2.5 text-[0.9375rem] leading-relaxed text-neutral-800"
            >
              {m.conteudo || (
                <span aria-label="escrevendo" className="inline-flex items-center gap-1 py-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ouro)]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ouro)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ouro)] [animation-delay:300ms]" />
                </span>
              )}
            </div>
          ),
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-3 border-l-2 border-[#93402c] pl-3 text-[0.8125rem] text-[#93402c]">
          {erro}
        </p>
      )}

      <form onSubmit={enviar} className="mt-3 flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha — o padrão de todo chat.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          maxLength={MAX_CHARS}
          placeholder="Escreva sua pergunta…"
          aria-label="Sua pergunta"
          className="min-h-[3.25rem] flex-1 resize-none rounded-md border px-3 py-2 text-[16px] text-neutral-900 placeholder:text-neutral-400 focus:border-[var(--verde)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="h-[3.25rem] shrink-0 rounded-sm bg-[var(--verde)] px-5 text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-[var(--verde-escuro)] focus-visible:outline-2 focus-visible:outline-[var(--ouro)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? "Respondendo…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
