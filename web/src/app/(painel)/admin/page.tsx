import { criarClienteAdmin } from "@/lib/admin-db";
import { exigirAdmin } from "@/lib/dal";
import {
  cancelar,
  criarCliente,
  editarTelefone,
  reativar,
  suspender,
  trocarSenha,
} from "./acoes";

/**
 * A tela fica dentro do grupo `(painel)` para herdar o cabeçalho — os
 * parênteses somem da URL, então o endereço continua sendo `/admin`. Quem
 * barra o cliente comum é o `layout.tsx` ao lado deste arquivo; quem barra um
 * POST forjado é o `exigirAdmin()` de cada ação em `acoes.ts`.
 */

interface Perfil {
  id: string;
  nome: string;
  telefone_whatsapp: string | null;
  papel: "cliente" | "admin";
  status: "ativo" | "suspenso" | "cancelado";
}

const CORES: Record<Perfil["status"], string> = {
  ativo: "text-emerald-700",
  suspenso: "text-amber-700",
  cancelado: "text-neutral-400",
};

const CAMPO = "rounded border border-neutral-300 px-2 py-1 text-sm";
const LINK = "text-xs text-emerald-700 underline";

const RECADOS: Record<string, string> = {
  telefone:
    "Telefone não salvo: use DDD + número (65 99621-0067) ou o formato completo com o 55 na frente.",
  email: "E-mail já cadastrado. Cada conta precisa de um endereço próprio.",
  senha: "Senha muito curta: no mínimo 8 caracteres.",
  falha: "Não deu para concluir. Tente de novo; se repetir, é problema do servidor.",
};

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const eu = await exigirAdmin();
  const recado = RECADOS[(await searchParams).erro ?? ""];

  const admin = criarClienteAdmin();
  const { data: perfis } = await admin
    .from("peciclo_perfis")
    .select("id, nome, telefone_whatsapp, papel, status")
    .order("criado_em")
    .overrideTypes<Perfil[]>();

  // O e-mail mora no Auth, não em `peciclo_perfis`. Sem ele a lista mostraria
  // dois "João" indistinguíveis.
  const { data: contas } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = new Map(contas.users.map((u) => [u.id, u.email ?? ""]));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border bg-white p-5">
        <h1 className="text-lg font-semibold">Clientes</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Não há cadastro público: toda conta nasce aqui. Suspender ou cancelar age em duas
          camadas — bloqueia o login e corta o acesso ao dado na mesma hora, inclusive de quem
          já estava com a tela aberta.
        </p>
      </section>

      {recado && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900"
        >
          {recado}
        </p>
      )}

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-medium">Novo cliente</h2>
        <form action={criarCliente} className="flex flex-wrap items-center gap-2">
          <input name="nome" required placeholder="nome" className={CAMPO} />
          <input name="email" type="email" required placeholder="e-mail" className={CAMPO} />
          <input name="senha" required minLength={8} placeholder="senha inicial" className={CAMPO} />
          <input name="telefone" placeholder="65 99621-0067" className={CAMPO} />
          <button className="rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white">
            Criar
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Telefone com DDD; o 55 do Brasil entra sozinho e a máscara é ignorada. Pode ficar
          em branco — aí o cliente não recebe as planilhas por WhatsApp.
        </p>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-medium">Contas</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-neutral-500">
              <th className="py-2 font-medium">Nome</th>
              <th className="font-medium">Telefone</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(perfis ?? []).map((perfil) => (
              <Linha
                key={perfil.id}
                perfil={perfil}
                email={emails.get(perfil.id) ?? ""}
                souEu={perfil.id === eu.id}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Linha({
  perfil,
  email,
  souEu,
}: {
  perfil: Perfil;
  email: string;
  souEu: boolean;
}) {
  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pr-4">
        <span className="font-medium">{perfil.nome}</span>
        {perfil.papel === "admin" && (
          <span className="ml-1 text-xs text-neutral-500">(admin)</span>
        )}
        <span className="block text-xs text-neutral-500">{email}</span>
      </td>

      <td className="py-2 pr-4">
        <form action={editarTelefone} className="flex items-center gap-1">
          <input type="hidden" name="id" value={perfil.id} />
          <input
            name="telefone"
            defaultValue={perfil.telefone_whatsapp ?? ""}
            className="w-36 rounded border border-neutral-300 px-1 py-0.5 text-sm"
          />
          <button className={LINK}>salvar</button>
        </form>
      </td>

      <td className={`py-2 pr-4 ${CORES[perfil.status]}`}>{perfil.status}</td>

      <td className="flex flex-wrap items-center gap-3 py-2">
        {souEu ? (
          // A trava do `mudarStatus` recusaria de qualquer jeito; esconder os
          // botões evita oferecer ao dono um caminho que só termina em erro.
          <span className="text-xs text-neutral-400">é você</span>
        ) : (
          <>
            {perfil.status === "ativo" ? (
              <Botao acao={suspender} id={perfil.id} rotulo="suspender" />
            ) : (
              <Botao acao={reativar} id={perfil.id} rotulo="reativar" />
            )}
            {perfil.status !== "cancelado" && (
              <Botao acao={cancelar} id={perfil.id} rotulo="cancelar" />
            )}
          </>
        )}
        <form action={trocarSenha} className="flex items-center gap-1">
          <input type="hidden" name="id" value={perfil.id} />
          <input
            name="senha"
            placeholder="nova senha"
            minLength={8}
            className="w-32 rounded border border-neutral-300 px-1 py-0.5 text-sm"
          />
          <button className={LINK}>trocar</button>
        </form>
      </td>
    </tr>
  );
}

function Botao({
  acao,
  id,
  rotulo,
}: {
  acao: (id: string) => Promise<void>;
  id: string;
  rotulo: string;
}) {
  // `bind` manda o id pelo servidor: ele vai assinado no payload da action, não
  // como campo que o navegador possa reescrever.
  const comId = acao.bind(null, id);
  return (
    <form action={comId}>
      <button className={LINK}>{rotulo}</button>
    </form>
  );
}

export const metadata = { title: "Clientes" };
