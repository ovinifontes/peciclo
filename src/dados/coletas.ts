import type { Janela, StatusColeta, TipoColeta, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

export async function abrirColeta(args: {
  uf: UF;
  tipo: TipoColeta;
  janela: Janela;
}): Promise<number> {
  const { data, error } = await obterCliente()
    .from("peciclo_coletas")
    .insert({
      uf: args.uf,
      tipo: args.tipo,
      janela_inicio: args.janela.inicio,
      janela_fim: args.janela.fim,
      status: "sem_dados",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao abrir coleta: ${error.message}`);
  return data.id as number;
}

export async function fecharColeta(args: {
  id: number;
  status: StatusColeta;
  arquivoPath?: string | null;
  arquivoHash?: string | null;
  linhasAfetadas?: number | null;
  erro?: string | null;
}): Promise<void> {
  const { error } = await obterCliente()
    .from("peciclo_coletas")
    .update({
      status: args.status,
      arquivo_path: args.arquivoPath ?? null,
      arquivo_hash: args.arquivoHash ?? null,
      linhas_afetadas: args.linhasAfetadas ?? null,
      erro: args.erro ?? null,
      concluido_em: new Date().toISOString(),
    })
    .eq("id", args.id);

  if (error) throw new Error(`Falha ao fechar coleta ${args.id}: ${error.message}`);
}

/** Dias de graça no começo do mês: até aqui, mês corrente vazio é normal. */
const DIA_DE_GRACA = 5;

/**
 * Zero linhas é sucesso ou falha calada? Depende do calendário.
 *
 * Coletor que devolve `[]` some sem barulho: no RO, basta o IDARON renomear as
 * faixas etárias para o sufixo " F"/" M" deixar de casar, `femeas`/`machos`
 * saírem 0 e a coleta virar "mês sem dados ainda" para sempre — o painel
 * congela no último mês bom e ninguém é avisado. Aqui a regra é: mês futuro
 * vazio é normal (não há o que publicar), mês corrente vazio só nos primeiros
 * dias, e mês FECHADO vazio nunca é normal.
 */
export function coletaVaziaSuspeita(args: {
  linhas: number;
  ano: number;
  mes: number;
  /** "YYYY-MM-DD"; por padrão hoje em São Paulo. */
  hojeIso?: string;
}): boolean {
  if (args.linhas > 0) return false;

  const hojeIso =
    args.hojeIso ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [anoHoje, mesHoje, diaHoje] = hojeIso.split("-").map(Number) as [number, number, number];

  const competencia = args.ano * 12 + args.mes;
  const corrente = anoHoje * 12 + mesHoje;
  if (competencia > corrente) return false;
  if (competencia < corrente) return true;
  return diaHoje > DIA_DE_GRACA;
}

/** Hashes de arquivos já processados com sucesso — usado pelo coletor do PA. */
export async function hashesProcessados(uf: UF): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("peciclo_coletas")
    .select("arquivo_hash")
    .eq("uf", uf)
    .eq("status", "ok")
    .not("arquivo_hash", "is", null);

  if (error) throw new Error(`Falha ao ler hashes de ${uf}: ${error.message}`);
  return new Set((data ?? []).map((l) => l.arquivo_hash as string));
}
