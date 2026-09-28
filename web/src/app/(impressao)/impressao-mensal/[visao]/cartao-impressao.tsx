"use client";

import { useEffect, useRef } from "react";

import CartaoExportavel from "@/app/(painel)/painel/cartao-exportavel";
import {
  agruparMeses,
  calcularIndicadores,
  cartoesKpi,
  linhasDoGrafico,
  SecoesGraficoMensal,
  totalCelula,
  type Ver,
} from "@/app/(painel)/painel/explorador";
import { ROTULO_VER } from "@/app/(painel)/painel/visoes";
import type { UF } from "@/app/(painel)/painel/estados";
import type { LinhaMensal } from "@/lib/dados";

/** Os DOIS SVGs que cada visão de gráfico desenha: total e % de fêmeas. */
const SVGS_ESPERADOS = 2;

/**
 * O cartão MENSAL visível da página de impressão — o mesmo miolo que o clique
 * em "Exportar imagem" fotografa fora da tela, aqui parado para o robô, e com
 * os estados escolhidos pela URL em vez de pelos chips.
 *
 * Existe porque o PDF diário leva a MESMA visão quatro vezes, com seleções
 * diferentes (os três juntos, depois cada um sozinho). Sem a seleção na URL o
 * robô teria de clicar chips e torcer para o Recharts reanimar a tempo — e a
 * foto sairia com o traço no meio do caminho.
 *
 * As derivações são o caminho do explorador mensal, importado de lá: agrupar,
 * cortar o mês corrente, achatar para o Recharts e calcular os KPIs. Nenhuma
 * cópia de lógica — os números da foto são os mesmos da tela, por construção.
 */
export default function CartaoImpressaoMensal({
  visao,
  serie,
  mesCorrente,
  ufs,
  dataCabecalho,
  tabela,
}: {
  visao: Ver;
  serie: LinhaMensal[];
  /** "2026-09", calculado no servidor (fuso de Brasília). */
  mesCorrente: string;
  /** Os estados desta página, já validados pela rota. */
  ufs: UF[];
  dataCabecalho: string;
  tabela: React.ReactNode;
}) {
  const cartaoRef = useRef<HTMLDivElement>(null);

  const meses = agruparMeses(serie, mesCorrente);
  const mesesVisiveis = meses.filter((m) =>
    ufs.some((uf) => totalCelula(m.porUf[uf]) !== null),
  );
  // O mesmo corte do explorador: barras agrupadas de 18+ meses são ilegíveis.
  const mesesDoGrafico = visao === "colunas" ? mesesVisiveis.slice(-12) : mesesVisiveis;
  const cortadas = visao === "colunas" && mesesVisiveis.length > mesesDoGrafico.length;

  const linhasTotal = linhasDoGrafico(mesesDoGrafico, ufs, "total");
  const linhasPct = linhasDoGrafico(mesesDoGrafico, ufs, "pct");
  const ind = calcularIndicadores(meses, ufs);

  const prontoNoHtml = visao === "tabela" || mesesDoGrafico.length === 0;

  useEffect(() => {
    if (prontoNoHtml) return;
    const cartao = cartaoRef.current;
    if (!cartao) return;
    const intervalo = setInterval(() => {
      if (cartao.querySelectorAll("svg.recharts-surface").length >= SVGS_ESPERADOS) {
        cartao.setAttribute("data-impressao-pronta", "");
        clearInterval(intervalo);
      }
    }, 150);
    return () => clearInterval(intervalo);
  }, [prontoNoHtml]);

  // O robô chama esta função em vez de tirar screenshot: é a MESMA captura do
  // botão "Exportar imagem" (html-to-image, margem de marca, 2x), para a
  // página do PDF sair byte a byte igual à imagem do clique manual.
  useEffect(() => {
    (window as unknown as { __capturarCartaoPng?: () => Promise<string> }).__capturarCartaoPng =
      async () => {
        const cartao = cartaoRef.current;
        if (!cartao) throw new Error("cartão não montado");
        const { capturarPng } = await import("@/app/(painel)/painel/exportar");
        const blob = await capturarPng(cartao);
        return await new Promise<string>((resolver, rejeitar) => {
          const leitor = new FileReader();
          leitor.onload = () => resolver(String(leitor.result));
          leitor.onerror = () => rejeitar(leitor.error);
          leitor.readAsDataURL(blob);
        });
      };
  }, []);

  return (
    <div
      ref={cartaoRef}
      data-cartao-impressao=""
      {...(prontoNoHtml ? { "data-impressao-pronta": "" } : {})}
      style={{ width: 1080 }}
      className="bg-white"
    >
      <CartaoExportavel
        titulo="Abate mensal por estado"
        rotulo={ROTULO_VER[visao]}
        ufs={ufs}
        kpis={cartoesKpi(ind)}
        dataCabecalho={dataCabecalho}
      >
        {visao === "tabela" ? (
          tabela
        ) : mesesDoGrafico.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nenhum mês com dado para os estados selecionados — nada para desenhar ainda.
          </p>
        ) : (
          <SecoesGraficoMensal
            ver={visao}
            ufs={ufs}
            linhasTotal={linhasTotal}
            linhasPct={linhasPct}
            cortadas={cortadas}
            mesCorrente={mesCorrente}
          />
        )}
      </CartaoExportavel>
    </div>
  );
}
