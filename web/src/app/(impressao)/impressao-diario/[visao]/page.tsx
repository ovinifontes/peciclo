import { notFound } from "next/navigation";

import TabelaDiaria from "@/app/(painel)/painel/tabela-diaria";
import { exigirClienteAtivo } from "@/lib/dal";
import {
  agruparDias,
  diasAntes,
  hojeSaoPaulo,
  lerAbateDiario,
  serieComMm7,
} from "@/lib/dados";
import CartaoImpressaoDiario from "./cartao-impressao";

const VISOES = ["tabela", "linhas", "colunas"] as const;
type Visao = (typeof VISOES)[number];

function ehVisao(valor: string): valor is Visao {
  return (VISOES as readonly string[]).includes(valor);
}

/**
 * A página que o robô do envio diário fotografa: SÓ o cartão exportável da
 * seção "Abate diário por estado", visível, a 1080px, sobre fundo branco —
 * o MESMO componente que o clique em "Exportar imagem" monta fora da tela,
 * para as imagens automáticas saírem pixel por pixel iguais às manuais.
 *
 * Os dados descem EXATAMENTE como no painel: mesmas funções de `dados.ts`,
 * mesmos cortes de janela calculados no servidor (fuso de Brasília), mesmo
 * agrupamento e MM7 pré-computados pelas funções puras da raiz. O RLS decide
 * o que a conta-robô enxerga, como para qualquer cliente.
 *
 * Prontidão: o robô espera `[data-impressao-pronta]` aparecer. A tabela é
 * server-rendered e nasce pronta no HTML; nos gráficos o atributo só entra
 * quando os SVGs do Recharts existirem de verdade (ver `cartao-impressao`).
 *
 * A rota não entra em menu nenhum — quem chega aqui é o Chromium da task.
 */
export default async function ImpressaoDiario({
  params,
}: PageProps<"/impressao-diario/[visao]">) {
  await exigirClienteAtivo();

  const { visao } = await params;
  if (!ehVisao(visao)) notFound();

  const hoje = hojeSaoPaulo();
  const linhasDiarias = await lerAbateDiario();
  const diasDiarios = agruparDias(linhasDiarias);
  const pontosDiarios = serieComMm7(diasDiarios);

  // Data do cabeçalho formatada no SERVIDOR, no fuso do cliente: desce como
  // string e SSR/hidratação nunca divergem (a Vercel roda em UTC, que vira o
  // dia três horas antes do Brasil).
  const dataCabecalho = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  return (
    <main className="flex justify-center p-6">
      <CartaoImpressaoDiario
        visao={visao}
        pontos={pontosDiarios}
        cortes={{
          linhas: diasAntes(hoje, 180),
          colunas: diasAntes(hoje, 14),
          assentando: diasAntes(hoje, 7),
        }}
        dataCabecalho={dataCabecalho}
        tabela={
          <TabelaDiaria
            dias={diasDiarios}
            corte60={diasAntes(hoje, 60)}
            corteAssentando={diasAntes(hoje, 7)}
          />
        }
      />
    </main>
  );
}

export const metadata = { title: "Impressão" };
