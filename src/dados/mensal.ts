import { ufVisivel, type AgregadoMensal, type Janela, type LinhaMensal, type UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";
import { lerTudo } from "./paginar.js";

/**
 * Lista os primeiros dias de cada mês tocado pela janela.
 * Uma janela de rejanela pode cruzar a virada, e nesse caso os dois meses
 * precisam ser reagregados.
 */
export function competenciasDaJanela(janela: Janela): string[] {
  const competencias: string[] = [];
  const inicio = new Date(`${janela.inicio}T00:00:00Z`);
  const fim = new Date(`${janela.fim}T00:00:00Z`);
  const cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));

  while (cursor <= fim) {
    const ano = cursor.getUTCFullYear();
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    competencias.push(`${ano}-${mes}-01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return competencias;
}

/** Reagrega gta_registros nos meses tocados pela janela. */
export async function rollupJanela(args: {
  uf: UF;
  janela: Janela;
  coletaId: number;
}): Promise<number> {
  const cliente = obterCliente();
  let alteradas = 0;

  for (const competencia of competenciasDaJanela(args.janela)) {
    const { data, error } = await cliente.rpc("peciclo_rollup_abate_mensal", {
      p_uf: args.uf,
      p_competencia: competencia,
      p_coleta_id: args.coletaId,
    });
    if (error) throw new Error(`Falha no rollup de ${args.uf} ${competencia}: ${error.message}`);
    alteradas += Number(data ?? 0);
  }
  return alteradas;
}

/** Universo de contagem: um mês de uma UF numa finalidade. */
const universoDe = (a: { uf: string; ano: number; mes: number; finalidade: string }) =>
  `${a.uf}|${a.ano}|${a.mes}|${a.finalidade}`;

/**
 * Grava um agregado que já vem pronto da fonte. Sobrescreve por competência.
 * RO usa fonte "powerbi" (Power BI); MT usa "gta_condensada" (o relatório GTA
 * Condensado do INDEA já vem somado por mês, não por GTA).
 *
 * REGRA DE PRECEDÊNCIA (o outro lado da que `dados/imea.ts` já aplica): entre
 * duas contagens do MESMO universo — o mesmo mês, da mesma UF, na mesma
 * finalidade — a MAIOR vence. Contagem por GTA só cresce (guia atrasada é
 * lançada, nunca desemitida), então total menor é o mesmo mês mais incompleto.
 * Aqui isso vira uma guarda ESTREITA: um lote só é recusado quando rebaixaria
 * um total já gravado com fonte 'imea'.
 *
 * Sem ela, o dia em que o INDEA consertar o export a competência de MT volta
 * com o valor parado da migração (~1/4 do mês), sobrescreve o número do IMEA e
 * a planilha do cliente REGRIDE — e o coletor IMEA regrava para cima na segunda
 * seguinte: ping-pong semanal com alerta de anomalia junto.
 *
 * Por que estreita, e não "nunca rebaixar nada": só existe linha 'imea' em
 * MT/ABATE, então (a) o RO (powerbi) nunca é bloqueado e correção legítima para
 * baixo de qualquer outra fonte passa intacta, e (b) recoleta do mesmo mês com
 * valor MAIOR continua gravando normalmente. O preço é que, se o IMEA publicar
 * um número inflado, o INDEA não o corrige sozinho — correção para baixo em
 * cima do IMEA é ato manual, deliberado, e assim deve ser.
 */
export async function gravarAgregados(
  agregados: AgregadoMensal[],
  coletaId: number,
  fonte: "powerbi" | "gta_condensada" | "sindesa2_gta" | "gta_agregada",
): Promise<number> {
  if (agregados.length === 0) return 0;
  const cliente = obterCliente();

  // Um filtro só, cartesiano de propósito (uf × ano × mes): traz no máximo
  // punhado de linhas 'imea' e o pareamento exato é feito aqui embaixo.
  const { data, error: erroLeitura } = await cliente
    .from("peciclo_abate_mensal")
    .select("uf, ano, mes, finalidade, sexo, quantidade, fonte")
    .in("uf", [...new Set(agregados.map((a) => a.uf))])
    .in("ano", [...new Set(agregados.map((a) => a.ano))])
    .in("mes", [...new Set(agregados.map((a) => a.mes))]);
  if (erroLeitura) {
    throw new Error(`Falha ao ler o mensal atual antes de gravar: ${erroLeitura.message}`);
  }

  const atuais = (data ?? []) as Array<AgregadoMensal & { fonte: string }>;
  const totalImea = new Map<string, number>();
  for (const l of atuais.filter((l) => l.fonte === "imea")) {
    totalImea.set(universoDe(l), (totalImea.get(universoDe(l)) ?? 0) + l.quantidade);
  }
  // Quantidade já gravada, por linha exata — para não reescrever o que não
  // mudou (ver o filtro de `aGravar`).
  const jaGravado = new Map<string, number>();
  for (const l of atuais) jaGravado.set(`${universoDe(l)}|${l.sexo}`, l.quantidade);
  const totalNovo = new Map<string, number>();
  for (const a of agregados) {
    totalNovo.set(universoDe(a), (totalNovo.get(universoDe(a)) ?? 0) + a.quantidade);
  }

  const aGravar = agregados.filter((a) => {
    // Valor idêntico ao que já está lá não é gravação: reescrever só mexeria
    // no `atualizado_em`, e é dele que sai "desde quando este número não muda"
    // — o sinal que o vigia do MT usa para dizer há quantos dias a fonte está
    // congelada. Carimbo que se renova sozinho todo dia não informa nada.
    if (jaGravado.get(`${universoDe(a)}|${a.sexo}`) === a.quantidade) return false;
    const imea = totalImea.get(universoDe(a));
    return imea === undefined || totalNovo.get(universoDe(a))! > imea;
  });

  for (const [universo, total] of totalImea) {
    if (totalNovo.has(universo) && totalNovo.get(universo)! <= total) {
      // Nunca em silêncio: recusa de gravação aparece no log da run.
      console.warn(
        `Mantido o número do IMEA em ${universo}: ${total} (fonte ${fonte} trouxe ${totalNovo.get(universo)}).`,
      );
    }
  }
  if (aGravar.length === 0) return 0;

  const { error } = await cliente
    .from("peciclo_abate_mensal")
    .upsert(
      aGravar.map((a) => ({
        uf: a.uf,
        ano: a.ano,
        mes: a.mes,
        finalidade: a.finalidade,
        sexo: a.sexo,
        quantidade: a.quantidade,
        fonte,
        coleta_id: coletaId,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,ano,mes,finalidade,sexo" },
    );
  if (error) throw new Error(`Falha ao gravar agregados: ${error.message}`);
  return aGravar.length;
}

// Declarado em `tipos.ts` (que não importa nada) para o site poder usá-lo sem
// arrastar o cliente do Supabase junto. Reexportado aqui para não quebrar quem
// já importava daqui.
export type { LinhaMensal } from "../tipos.js";

/**
 * Lê o abate mensal que alimenta a planilha. Igualdade exata em ABATE.
 *
 * Filtra pelas UFs VISÍVEIS (`UFS_VISIVEIS` em tipos.ts): estado escondido sai
 * daqui e, com isso, some das colunas E do consolidado de uma vez só. Filtrar
 * na leitura, e não em cada gerador, é o que garante que os dois lugares
 * concordem — um estado visível na tabela mas ausente da soma seria pior que
 * não ter escondido nada.
 */
export async function lerAbateMensal(): Promise<LinhaMensal[]> {
  // Paginado: sem isto o Supabase devolve no máximo 1000 linhas sem erro, e
  // como a ordem é crescente, seriam os meses RECENTES a sumir da planilha.
  const linhas = await lerTudo<LinhaMensal>(
    (de, ate) =>
      obterCliente()
        .from("peciclo_abate_mensal")
        .select("uf, ano, mes, sexo, quantidade")
        // Igualdade exata, nunca prefixo: "ABATE SANITÁRIO" e "SACRIFÍCIO" são
        // abate por determinação sanitária, não decisão econômica do pecuarista.
        .eq("finalidade", "ABATE")
        .order("ano")
        .order("mes")
        .range(de, ate) as never,
    "abate mensal",
  );
  return linhas.filter((l) => ufVisivel(l.uf));
}

/**
 * Há quantos dias a FONTE não produz número novo, e desde quando.
 *
 * Mede pela fonte e não pela competência de propósito: na virada do mês a
 * fonte morta não cria linha nenhuma para o mês novo, e uma medição por
 * competência devolvia null justo quando o problema estava pior — o alerta
 * perdia a contagem, virava texto fixo e a supressão de repetidos o engolia
 * por 3 dias (aconteceu em 01-03/09/2026).
 *
 * Só faz sentido porque `gravarAgregados` deixou de reescrever linha idêntica:
 * `atualizado_em` marca a última vez que o VALOR mudou, não a última vez que
 * alguém olhou. É o que permite o alerta dizer "congelado há 19 dias" em vez de
 * repetir o mesmo texto todo dia — e é o que faz o alerta voltar a ser notícia
 * a cada manhã, escapando da supressão de repetidos por mérito, não por burla.
 */
export async function congeladoDesde(args: {
  uf: UF;
  /** Fonte que se quer medir — o congelamento é DELA, não do mês. */
  fonte: string;
}): Promise<{ desde: string; dias: number } | null> {
  const { data, error } = await obterCliente()
    .from("peciclo_abate_mensal")
    .select("atualizado_em")
    .eq("uf", args.uf)
    .eq("fonte", args.fonte)
    .eq("finalidade", "ABATE")
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const desde = String((data as { atualizado_em: string }).atualizado_em);
  const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
  return { desde: desde.slice(0, 10), dias };
}

/** Todos os dias do mês em ISO — a régua contra a qual se mede o que falta. */
export function diasDoMes(ano: number, mes: number): string[] {
  // `Date.UTC(ano, mes, 0)` devolve o último dia do mês `mes` (mês seguinte,
  // dia zero). Resolve fevereiro bissexto sem tabela nem `if`.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return Array.from(
    { length: ultimo },
    (_, i) => `${ano}-${mm}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** Dias do mês presentes no diário, e quais faltam. */
export async function diasDoMesNoDiario(
  uf: UF,
  ano: number,
  mes: number,
): Promise<{ presentes: Set<string>; faltam: string[] }> {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  const { data, error } = await obterCliente()
    .from("peciclo_abate_diario")
    .select("data")
    .eq("uf", uf)
    .eq("finalidade", "ABATE")
    .gte("data", `${ano}-${mm}-01`)
    .lte("data", `${ano}-${mm}-${String(ultimo).padStart(2, "0")}`);
  if (error) throw new Error(`Falha ao ler o diário de ${uf} ${ano}-${mm}: ${error.message}`);

  const presentes = new Set((data ?? []).map((l) => String(l.data)));
  return { presentes, faltam: diasDoMes(ano, mes).filter((d) => !presentes.has(d)) };
}

/**
 * Fecha o mensal a partir do DIÁRIO — só quando o mês está INTEIRO.
 *
 * Por que existe: o mensal de MT vinha só do IMEA, que publica com ~2 semanas
 * de atraso. Tendo o diário completo, setembro pode fechar no dia 1º de
 * outubro em vez de meados do mês — e o IMEA deixa de ser a fonte para virar
 * conferência, que é um papel melhor para ele.
 *
 * A trava de completude é o ponto inteiro desta função. Um mês com dias
 * faltando somaria MENOS do que foi e entraria como queda de mercado; e como
 * a série mensal alimenta a leitura do ciclo, a queda inventada viraria uma
 * fase de ciclo inventada. Mês furado não é gravado, e o número que já estava
 * lá (IMEA) permanece — que é exatamente o desejado para agosto/2026, que tem
 * 4 dias que o portal se recusa a devolver.
 *
 * A precedência de `gravarAgregados` continua valendo por cima disto: entre
 * duas contagens do mesmo mês, a MAIOR vence. Então esta função nunca rebaixa
 * um número do IMEA — no máximo o confirma ou o supera.
 */
export async function consolidarMesDoDiario(args: {
  uf: UF;
  ano: number;
  mes: number;
  coletaId: number;
}): Promise<{ gravou: boolean; motivo?: string; total?: number }> {
  const { faltam } = await diasDoMesNoDiario(args.uf, args.ano, args.mes);
  if (faltam.length > 0) {
    return {
      gravou: false,
      motivo: `mês incompleto: faltam ${faltam.length} dia(s) (${faltam.slice(0, 5).join(", ")}${faltam.length > 5 ? "…" : ""})`,
    };
  }

  const mm = String(args.mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(args.ano, args.mes, 0)).getUTCDate();
  const { data, error } = await obterCliente()
    .from("peciclo_abate_diario")
    .select("sexo, quantidade")
    .eq("uf", args.uf)
    .eq("finalidade", "ABATE")
    .gte("data", `${args.ano}-${mm}-01`)
    .lte("data", `${args.ano}-${mm}-${String(ultimo).padStart(2, "0")}`);
  if (error) throw new Error(`Falha ao somar o diário: ${error.message}`);

  const porSexo = new Map<string, number>();
  for (const l of data ?? []) {
    porSexo.set(String(l.sexo), (porSexo.get(String(l.sexo)) ?? 0) + Number(l.quantidade));
  }
  if (porSexo.size === 0) return { gravou: false, motivo: "mês sem linha nenhuma no diário" };

  const agregados: AgregadoMensal[] = [...porSexo].map(([sexo, quantidade]) => ({
    uf: args.uf,
    ano: args.ano,
    mes: args.mes,
    finalidade: "ABATE",
    sexo: sexo as AgregadoMensal["sexo"],
    quantidade,
  }));
  const total = agregados.reduce((s, a) => s + a.quantidade, 0);
  const escritas = await gravarAgregados(agregados, args.coletaId, "sindesa2_gta");
  // Zero escritas não é falha: ou o número já era idêntico, ou a precedência
  // recusou rebaixar um total do IMEA. Dizer "gravou" nesse caso seria mentir
  // no log de quem for investigar um mês depois.
  if (escritas === 0) {
    return { gravou: false, motivo: "nada a mudar (valor idêntico ou o IMEA tem número maior)", total };
  }
  return { gravou: true, total };
}
