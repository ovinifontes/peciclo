import { exigirClienteAtivo } from "@/lib/dal";
import { listarPlanilhas, PASTAS, type Planilha } from "@/lib/planilhas";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Cuiaba",
});

function tamanhoBr(bytes: number | null): string | null {
  if (bytes === null) return null;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
}

export default async function Planilhas() {
  // O layout do grupo já exigiu cliente ativo, mas a página confere de novo:
  // um layout não roda a cada navegação, e esta página abre o arquivo.
  await exigirClienteAtivo();

  const pastas = await Promise.all(
    PASTAS.map(async (pasta) => ({ ...pasta, arquivos: await listarPlanilhas(pasta.prefixo) })),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-white p-5">
        <h1 className="text-lg font-semibold">Planilhas</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Todo arquivo já enviado por WhatsApp fica guardado aqui, do mais recente para o mais
          antigo. O download passa pelo Peciclo: não há link de arquivo para copiar, colar ou
          vazar.
        </p>
      </div>

      {pastas.map((pasta) => (
        <section key={pasta.prefixo} className="rounded-lg border bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            {pasta.titulo}
          </p>
          <p className="mt-1 text-sm text-neutral-600">{pasta.descricao}</p>

          {pasta.arquivos.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">Nenhuma planilha arquivada ainda.</p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y border-t text-sm">
              {pasta.arquivos.map((arquivo) => (
                <Linha key={arquivo.chave} arquivo={arquivo} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Linha({ arquivo }: { arquivo: Planilha }) {
  const tamanho = tamanhoBr(arquivo.tamanho);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <a
        className="font-medium text-emerald-700 underline"
        href={`/painel/planilhas/baixar?arquivo=${encodeURIComponent(arquivo.chave)}`}
      >
        {arquivo.nome}
      </a>
      <span className="text-xs text-neutral-500">
        {arquivo.atualizadoEm && dataHora.format(new Date(arquivo.atualizadoEm))}
        {arquivo.atualizadoEm && tamanho && " · "}
        {tamanho}
      </span>
    </li>
  );
}

export const metadata = { title: "Planilhas" };
