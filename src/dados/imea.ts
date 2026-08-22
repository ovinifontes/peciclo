import { obterCliente } from "./cliente.js";

/**
 * Grava o mensal de MT vindo do IMEA (2 linhas: FEMEA e MACHO, finalidade
 * ABATE) respeitando a REGRA DE PRECEDÊNCIA:
 *
 *   grava se (1) o mês não existe no banco, OU (2) as linhas atuais já são
 *   fonte 'imea' (revisão do próprio relatório), OU (3) o total do IMEA é
 *   MAIOR que o total atual — "o maior vence": ambos contam o mesmo universo
 *   (abate de bovinos de origem MT) e a contagem por GTA só cresce quando
 *   guia atrasada é lançada; um número menor é só o mesmo mês mais incompleto.
 *   NUNCA rebaixa um número maior (empate incluído).
 *
 * A checagem lê as linhas atuais antes de escrever, fora de SQL: são 2 linhas
 * e a task roda 1x/semana — não há corrida real.
 */
export async function gravarMensalImea(args: {
  ano: number;
  mes: number;
  machos: number;
  femeas: number;
}): Promise<{ gravou: boolean; totalAnterior: number | null }> {
  const cliente = obterCliente();

  const { data, error } = await cliente
    .from("peciclo_abate_mensal")
    .select("sexo, quantidade, fonte")
    .eq("uf", "MT")
    .eq("ano", args.ano)
    .eq("mes", args.mes)
    .eq("finalidade", "ABATE");
  if (error) throw new Error(`Falha ao ler o mensal atual de MT: ${error.message}`);

  const atuais = (data ?? []) as { sexo: string; quantidade: number; fonte: string }[];
  const totalAnterior =
    atuais.length === 0 ? null : atuais.reduce((soma, l) => soma + l.quantidade, 0);
  const totalImea = args.machos + args.femeas;

  const pode =
    atuais.length === 0 ||
    atuais.every((l) => l.fonte === "imea") ||
    totalImea > (totalAnterior ?? 0);
  if (!pode) return { gravou: false, totalAnterior };

  const agora = new Date().toISOString();
  const { error: erroUpsert } = await cliente.from("peciclo_abate_mensal").upsert(
    [
      { sexo: "FEMEA", quantidade: args.femeas },
      { sexo: "MACHO", quantidade: args.machos },
    ].map((l) => ({
      uf: "MT",
      ano: args.ano,
      mes: args.mes,
      finalidade: "ABATE",
      ...l,
      fonte: "imea",
      coleta_id: null,
      atualizado_em: agora,
    })),
    { onConflict: "uf,ano,mes,finalidade,sexo" },
  );
  if (erroUpsert) throw new Error(`Falha ao gravar o mensal IMEA: ${erroUpsert.message}`);

  return { gravou: true, totalAnterior };
}
