import { exigirClienteAtivo } from "@/lib/dal";
import { lerMensagensChatDoDia } from "@/lib/dados";
import Conversa from "./conversa";

/**
 * A tela do chat. O servidor entrega o histórico do dia (RLS garante que cada
 * cliente só vê o seu) e o componente de cliente cuida da conversa em si —
 * inclusive de ler o stream da rota irmã em `./api`.
 */
export default async function Chat() {
  // O layout do grupo já exige cliente ativo, mas a autorização se confere em
  // cada página: um layout não roda de novo a cada navegação.
  await exigirClienteAtivo();
  const historico = await lerMensagensChatDoDia();

  return (
    // pb-10: o rodapé fixo do aviso não pode cobrir a última mensagem.
    <div className="flex flex-col gap-4 pb-10">
      <section className="rounded-lg border bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Chat</p>
            <h2 className="mt-1 text-2xl font-semibold">Converse com os dados</h2>
          </div>
          <p className="text-xs text-neutral-500">A conversa zera a cada dia</p>
        </div>
        <p className="mt-1 text-neutral-600">
          Pergunte sobre a fase do ciclo, a participação de fêmeas, os preços ou o cenário do dia —
          as respostas usam os mesmos números deste painel.
        </p>

        <div className="mt-4">
          <Conversa historico={historico} />
        </div>
      </section>

      {/* O aviso é permanente e discreto — fixo para valer em qualquer altura
          de rolagem, inclusive com a conversa longa. */}
      <footer className="fixed inset-x-0 bottom-0 z-10 border-t bg-white/95 px-6 py-2 text-center text-[0.6875rem] tracking-wide text-neutral-500 backdrop-blur">
        Respostas geradas por IA sobre os dados do Peciclo. Não é recomendação de investimento.
      </footer>
    </div>
  );
}

export const metadata = { title: "Chat" };
