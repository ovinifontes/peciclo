import "server-only";

import { createClient } from "@/lib/supabase/server";
// Imports da RAIZ do repositório (fora de web/), por caminho relativo: a
// lógica do ciclo é a MESMA que a Fatia 2 (narrativa por WhatsApp) vai usar e
// está testada pela suíte da raiz. Duplicá-la aqui criaria duas verdades sobre
// qual é a fase do ciclo. Os dois módulos são puros — `leitura.ts` só tem
// imports de tipo e `paginar.ts` não importa nada —, então nada do robô
// (config, chave de service_role, Trigger.dev) entra no bundle do site.
import {
  lerCiclo,
  PAINEL_CICLO,
  serieComposicaoFixa,
  type LeituraCiclo,
  type PontoCiclo,
} from "../../../src/ciclo/leitura";
import { lerTudo } from "../../../src/dados/paginar";
import type { LinhaMensal } from "../../../src/dados/mensal";

export { PAINEL_CICLO };
export type { LeituraCiclo, LinhaMensal, PontoCiclo };

export interface Preco {
  valor: number;
  data: string;
}

export interface DadosPainel {
  leitura: LeituraCiclo;
  /** Linhas cruas, por estado e sexo — a tabela mensal precisa delas. */
  serie: LinhaMensal[];
  /** A MESMA série consolidada que classifica a fase: é o que o gráfico plota. */
  serieCiclo: PontoCiclo[];
  precoBoi: Preco | null;
  precoBezerro: Preco | null;
}

/**
 * Abate mensal visível para o usuário logado (RLS decide o que volta).
 *
 * Paginado por `lerTudo` mesmo com a tabela pequena hoje (150 linhas em
 * `finalidade = 'ABATE'`, 05/08/2026): o Supabase corta em 1000 linhas SEM
 * erro, e como a ordem é crescente o que sumiria seriam os meses recentes —
 * ou seja, a leitura do ciclo ficaria velha sem ninguém perceber.
 */
async function lerAbateMensal(): Promise<LinhaMensal[]> {
  const supabase = await createClient();
  return lerTudo<LinhaMensal>(
    (de, ate) =>
      supabase
        .from("peciclo_abate_mensal")
        .select("uf, ano, mes, sexo, quantidade")
        // Igualdade exata, nunca prefixo: "ABATE SANITÁRIO" e "SACRIFÍCIO" são
        // abate por determinação sanitária, não decisão do pecuarista.
        .eq("finalidade", "ABATE")
        .order("ano")
        .order("mes")
        .range(de, ate),
    "abate mensal",
  );
}

/** Última cotação de uma série de preço, ou null se não houver nenhuma. */
async function ultimoPreco(serie: string): Promise<Preco | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("peciclo_precos")
    .select("valor, data")
    .eq("serie", serie)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler preço ${serie}: ${error.message}`);
  if (!data) return null;
  return { valor: Number(data.valor), data: String(data.data) };
}

/**
 * Corta a série na competência que a leitura escolheu.
 *
 * `serieComposicaoFixa` garante que todo mês tem os três estados, mas NÃO
 * aplica o teste de completude de volume — quem faz isso é `lerCiclo`, ao
 * andar para trás até achar um mês utilizável. Sem este corte, o gráfico
 * plotaria justamente os meses que a leitura reprovou: em 05/08/2026, julho e
 * agosto de 2026, este último com cinco dias de coleta. A curva desabaria de
 * 49,8% para 47,0% e o leitor veria mercado onde há mês pela metade — o mesmo
 * erro da composição variável, só que no eixo do tempo.
 *
 * Efeito colateral desejado: a curva termina exatamente na competência escrita
 * no bloco Ciclo, então gráfico e texto nunca discordam.
 */
function ateACompetencia(pontos: PontoCiclo[], leitura: LeituraCiclo): PontoCiclo[] {
  const ate = leitura.competencia;
  // Sem competência não há leitura: também não há curva honesta para desenhar.
  if (!ate) return [];
  return pontos.filter((p) => p.ano < ate.ano || (p.ano === ate.ano && p.mes <= ate.mes));
}

/**
 * Este módulo não sabe quem é o usuário — quem valida acesso é quem chama
 * (`dal.ts`). O que ele garante é que o dado volta completo e do jeito que a
 * lógica do ciclo espera.
 */
export async function obterDadosPainel(): Promise<DadosPainel> {
  const serie = await lerAbateMensal();
  const [precoBoi, precoBezerro] = await Promise.all([
    ultimoPreco("boi_gordo"),
    ultimoPreco("bezerro_ms"),
  ]);

  // `serieComposicaoFixa` é a mesma função que `lerCiclo` usa por dentro, e
  // vem da raiz: o gráfico não pode plotar uma curva calculada por outro
  // caminho que a frase "retenção de matrizes" logo acima dele.
  const leitura = lerCiclo(serie);

  return {
    leitura,
    serie,
    serieCiclo: ateACompetencia(serieComposicaoFixa(serie), leitura),
    precoBoi,
    precoBezerro,
  };
}
