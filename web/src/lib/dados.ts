import "server-only";

import { createClient } from "@/lib/supabase/server";
// Imports da RAIZ do repositório (fora de web/), por caminho relativo: a
// lógica do ciclo é a MESMA que a Fatia 2 (narrativa por WhatsApp) vai usar e
// está testada pela suíte da raiz. Duplicá-la aqui criaria duas verdades sobre
// qual é a fase do ciclo. Os dois módulos são puros — `leitura.ts` só tem
// imports de tipo e `paginar.ts` não importa nada —, então nada do robô
// (config, chave de service_role, Trigger.dev) entra no bundle do site.
import { lerCiclo, PAINEL_CICLO, type LeituraCiclo } from "../../../src/ciclo/leitura";
import { lerTudo } from "../../../src/dados/paginar";
import type { LinhaMensal } from "../../../src/dados/mensal";

export { PAINEL_CICLO };
export type { LeituraCiclo, LinhaMensal };

export interface Preco {
  valor: number;
  data: string;
}

export interface DadosPainel {
  leitura: LeituraCiclo;
  serie: LinhaMensal[];
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

  return { leitura: lerCiclo(serie), serie, precoBoi, precoBezerro };
}
