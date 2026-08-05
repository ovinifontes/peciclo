import Link from "next/link";
import { exigirClienteAtivo } from "@/lib/dal";
import { sair } from "@/app/login/acoes";

/**
 * `(painel)` é um route group: os parênteses somem da URL. Quem dá o endereço
 * `/painel` é a pasta `painel/` dentro do grupo — o layout fica no grupo para
 * envolver todas as telas do cliente sem entrar no caminho.
 */
export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const perfil = await exigirClienteAtivo();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <Link href="/painel" className="font-semibold text-emerald-900">
          Peciclo
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/painel/planilhas" className="text-emerald-700">
            Planilhas
          </Link>
          {perfil.papel === "admin" && (
            <Link href="/admin" className="text-emerald-700">
              Clientes
            </Link>
          )}
          <span className="text-neutral-500">{perfil.nome}</span>
          <form action={sair}>
            <button className="text-neutral-500 underline">sair</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
