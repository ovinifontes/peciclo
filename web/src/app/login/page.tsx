import { entrar } from "./acoes";

export default function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-emerald-900">Peciclo</h1>
        <p className="text-sm text-neutral-500">Ciclo pecuário em tempo real</p>
      </div>
      <form action={entrar} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="e-mail"
          className="rounded border border-neutral-300 px-3 py-2" />
        <input name="senha" type="password" required placeholder="senha"
          className="rounded border border-neutral-300 px-3 py-2" />
        <button type="submit" className="rounded bg-emerald-700 px-3 py-2 font-medium text-white">
          Entrar
        </button>
      </form>
      <Erro searchParams={searchParams} />
    </main>
  );
}

async function Erro({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  if (!erro) return null;
  return <p className="text-sm text-red-600">E-mail ou senha inválidos.</p>;
}
