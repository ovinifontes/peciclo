import { exigirAdmin } from "@/lib/dal";

/**
 * A trava de rota da administração.
 *
 * O layout do grupo `(painel)` só exige cliente ativo — sem ele, qualquer
 * cliente ativo que digitasse `/admin` chegaria à tela. Este layout fecha o
 * segmento inteiro: tudo que nascer em `admin/` daqui para frente já entra
 * protegido, sem depender de alguém lembrar de repetir a checagem.
 *
 * `exigirAdmin()` responde 404, não 403: quem não é admin não fica sabendo que
 * existe uma administração.
 *
 * Isto NÃO protege as Server Actions. Uma action é uma requisição direta à
 * rota — o layout não roda antes dela. Por isso cada função de `acoes.ts`
 * chama `exigirAdmin()` na primeira linha. As duas camadas são necessárias:
 * esta esconde a porta, aquela tranca a fechadura.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await exigirAdmin();
  return <>{children}</>;
}
