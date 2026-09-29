import { notFound } from "next/navigation";

import TabelaMensal from "@/app/(painel)/painel/tabela";
import { ehVisao } from "@/app/(painel)/painel/visoes";
import { exigirClienteAtivo } from "@/lib/dal";
import { lerAbateMensal } from "@/lib/dados";
import { ufsDaBusca } from "../../ufs-da-busca";
import CartaoImpressaoMensal from "./cartao-impressao";

/**
 * As visões que esta rota sabe desenhar. Área e 100% empilham SEXO e partem de
 * outra derivação (`serieSomadaPorSexo`) — ficam de fora até alguém precisar
 * delas numa foto, e a rota diz 404 em vez de fotografar um cartão vazio.
 */
const VISOES_IMPRESSAS = new Set(["tabela", "linhas", "colunas"]);

/**
 * A página que o robô do envio diário fotografa: SÓ o cartão exportável da
 * seção "Abate mensal por estado", a 1080px, sobre fundo branco — o MESMO
 * componente do clique em "Exportar imagem", com a seleção de estados vinda
 * da URL.
 *
 * As quatro páginas do PDF diário são quatro visitas a esta rota:
 * `?ufs=MT,MS,RO`, `?ufs=MT`, `?ufs=MS` e `?ufs=RO`.
 *
 * A rota não entra em menu nenhum — quem chega aqui é o Chromium da task.
 */
export default async function ImpressaoMensal({
  params,
  searchParams,
}: PageProps<"/impressao-mensal/[visao]">) {
  await exigirClienteAtivo();

  const { visao } = await params;
  if (!ehVisao(visao) || !VISOES_IMPRESSAS.has(visao)) notFound();

  const { ufs: ufsBruto } = await searchParams;
  const ufs = ufsDaBusca(typeof ufsBruto === "string" ? ufsBruto : undefined);
  if (!ufs || ufs.length === 0) notFound();

  const serie = await lerAbateMensal();

  // Mês corrente e data do cabeçalho formatados no SERVIDOR, no fuso do
  // cliente: descem como string e SSR/hidratação nunca divergem (a Vercel roda
  // em UTC, que vira o mês três horas antes do Brasil).
  const mesCorrente = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const dataCabecalho = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  return (
    <main className="flex justify-center p-6">
      <CartaoImpressaoMensal
        visao={visao}
        serie={serie}
        mesCorrente={mesCorrente}
        ufs={ufs}
        dataCabecalho={dataCabecalho}
        tabela={<TabelaMensal serie={serie} />}
      />
    </main>
  );
}

export const metadata = { title: "Impressão" };
