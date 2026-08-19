/**
 * `(impressao)` é o route group das páginas que o robô fotografa: SEM o
 * cabeçalho do painel (logo, navegação, "sair" — nada disso deve sair na
 * foto), fundo branco puro. A autorização não mora aqui: cada página do grupo
 * chama `exigirClienteAtivo()` na primeira linha, como todas as outras.
 */
export default function ImpressaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
