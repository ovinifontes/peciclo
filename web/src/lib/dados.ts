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
// A série diária vem da MESMA lógica pura que a suíte da raiz testa: agrupar
// por dia, média móvel de 7 e KPIs vivem em `diario/serie.ts` (que importa só
// `tipos.ts`) — recalcular qualquer pedaço aqui criaria duas verdades sobre a
// MM7. Este módulo reexporta o que os componentes de SERVIDOR precisam; o
// explorador diário (cliente) importa `diario/serie` direto, porque este
// arquivo é server-only.
import {
  agruparDias,
  diaSemana,
  rotuloDia,
  serieComMm7,
  ufsComDado,
  type DiaUf,
  type PontoDiario,
} from "../../../src/diario/serie";
// O dossiê é o MESMO que a rotina do cenário usa: o chat e o texto diário
// enxergam o dia pelo mesmo retrato, montado pela mesma função testada na
// suíte da raiz. `dossie.ts` é puro (só importa de `ciclo/leitura`), então a
// regra da fronteira continua valendo.
import {
  dossieParaTexto,
  formatarDataBr,
  montarDossie,
  type PrecoDia,
} from "../../../src/ia/dossie";
// De `tipos`, não de `dados/mensal`: aquele módulo importa o cliente do
// Supabase da RAIZ, que não é instalado no build da Vercel (só `web/` roda
// npm install). `tipos.ts` não importa nada — é a fronteira segura.
import type { LinhaDiaria, LinhaMensal } from "../../../src/tipos";

export { agruparDias, diaSemana, PAINEL_CICLO, rotuloDia, serieComMm7, ufsComDado };
export type { DiaUf, LeituraCiclo, LinhaDiaria, LinhaMensal, PontoCiclo, PontoDiario };

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

/** "2026-08-18" no fuso de Brasília — o dia do CLIENTE, não o UTC da Vercel. */
export function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** ISO `dias` dias antes de `iso`, por aritmética UTC (imune a DST). */
export function diasAntes(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Dias lidos do diário: 180 do gráfico + 6 que a MM7 do 1º ponto olha + folga. */
const DIAS_LEITURA_DIARIA = 200;

/**
 * Abate diário visível para o usuário logado (RLS decide o que volta).
 *
 * O dia de HOJE nunca chega ao navegador (`.lt`): está sempre em coleta, e um
 * parcial de meio-dia desenharia um tombo que não existe — o mesmo motivo de o
 * mês corrente ficar fora dos gráficos mensais. `lerTudo` é obrigatório: 200
 * dias × até 4 UFs × 2 sexos passa das 1000 linhas em que o Supabase corta SEM
 * erro, e o que sumiria seriam justamente os dias recentes.
 */
export async function lerAbateDiario(): Promise<LinhaDiaria[]> {
  const supabase = await createClient();
  const hoje = hojeSaoPaulo();
  const corte = diasAntes(hoje, DIAS_LEITURA_DIARIA);
  return lerTudo<LinhaDiaria>(
    (de, ate) =>
      supabase
        .from("peciclo_abate_diario")
        .select("uf, data, sexo, quantidade")
        // Igualdade exata, nunca prefixo — a mesma regra do mensal: "ABATE
        // SANITÁRIO" e "SACRIFÍCIO" não são decisão do pecuarista.
        .eq("finalidade", "ABATE")
        .gte("data", corte)
        .lt("data", hoje)
        // Ordem total (data, uf, sexo): páginas do lerTudo nunca se sobrepõem.
        .order("data")
        .order("uf")
        .order("sexo")
        .range(de, ate),
    "abate diário",
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

export interface Cenario {
  /** "2026-08-06" — o dia a que o texto se refere. */
  data: string;
  texto: string;
  origem: "ia" | "reserva";
}

/**
 * O cenário mais recente, ou null se a tabela ainda está vazia (primeiro dia,
 * falha total da rotina — casos em que o bloco simplesmente não aparece).
 * Leitura direta, sem `lerTudo`: `data` é chave primária e só a última linha
 * interessa — não existe cenário para paginar.
 */
export async function lerCenarioMaisRecente(): Promise<Cenario | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("peciclo_cenarios")
    .select("data, texto, origem")
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler cenário: ${error.message}`);
  if (!data) return null;
  return {
    data: String(data.data),
    texto: String(data.texto),
    // O CHECK da tabela só admite esses dois valores; o ternário é para o
    // TypeScript, não para dado real.
    origem: data.origem === "reserva" ? "reserva" : "ia",
  };
}

/**
 * Todas as cotações, de todas as séries — `montarDossie` escolhe as mais
 * recentes e calcula a variação do boi (que precisa dos DOIS últimos pregões,
 * por isso `ultimoPreco` não serve aqui). `lerTudo` pelo mesmo motivo de
 * sempre: um dia a tabela passa de 1000 linhas e o corte silencioso comeria
 * justamente os pregões recentes.
 */
async function lerPrecosTodos(): Promise<PrecoDia[]> {
  const supabase = await createClient();
  const linhas = await lerTudo<PrecoDia>(
    (de, ate) =>
      supabase
        .from("peciclo_precos")
        .select("serie, data, valor")
        .order("data")
        .range(de, ate),
    "preços",
  );
  return linhas.map((p) => ({ ...p, valor: Number(p.valor) }));
}

/**
 * O contexto que o chat entrega ao modelo: o dossiê do dia (mesma montagem da
 * rotina do cenário) + o cenário publicado, se houver. Sem futuros da B3: o
 * coletor (`coletarFuturos`) vive na raiz com dependências que o build do site
 * não instala — a curva chega ao chat pelo texto do cenário, que já a cita.
 */
export async function montarContextoChat(): Promise<string> {
  const [abate, precos, cenario] = await Promise.all([
    lerAbateMensal(),
    lerPrecosTodos(),
    lerCenarioMaisRecente(),
  ]);

  const dossie = montarDossie({
    // O dia do cliente, não o do servidor: a Vercel roda em UTC e viraria a
    // data três horas antes do Brasil.
    hoje: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
    ciclo: lerCiclo(abate),
    serie: serieComposicaoFixa(abate),
    precos,
    futuros: [],
  });

  const partes = [dossieParaTexto(dossie)];
  if (cenario) {
    partes.push(
      "",
      `CENÁRIO PUBLICADO EM ${formatarDataBr(cenario.data)}${cenario.origem === "reserva" ? " (resumo automático)" : ""}`,
      cenario.texto,
    );
  }
  return partes.join("\n");
}

export interface MensagemDoDia {
  papel: "usuario" | "assistente";
  conteudo: string;
}

/**
 * O histórico do chat de hoje (America/Sao_Paulo, UTC−3 fixo desde 2019). O
 * RLS recorta por usuário — o cliente comum só enxerga as próprias mensagens;
 * a consulta filtra apenas o dia. Ordem por `id`, não por `criado_em`: a
 * gravação insere pergunta e resposta no mesmo INSERT e as duas saem com o
 * MESMO timestamp — só a identity desempata.
 */
export async function lerMensagensChatDoDia(): Promise<MensagemDoDia[]> {
  const supabase = await createClient();
  const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const linhas = await lerTudo<{ papel: string; conteudo: string }>(
    (de, ate) =>
      supabase
        .from("peciclo_chat_mensagens")
        .select("papel, conteudo")
        .gte("criado_em", `${dia}T00:00:00-03:00`)
        .order("id")
        .range(de, ate),
    "mensagens do chat",
  );
  return linhas.map((l) => ({
    // O CHECK da tabela só admite esses dois papéis; o ternário é para o tipo.
    papel: l.papel === "usuario" ? "usuario" : "assistente",
    conteudo: String(l.conteudo),
  }));
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
