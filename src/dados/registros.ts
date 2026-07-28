import type { RegistroGta } from "../tipos.js";
import { obterCliente } from "./cliente.js";

const TAMANHO_LOTE = 1000;

/**
 * Chave natural, igual à constraint `gta_registros_chave_natural` do banco.
 * Usa JSON para que `null` em faixaEtaria nunca colida com uma faixa real.
 */
export function chaveNatural(r: RegistroGta): string {
  return JSON.stringify([r.uf, r.documentoNumero, r.documentoSerie, r.sexo, r.faixaEtaria]);
}

/**
 * Soma registros que compartilham a chave natural do banco.
 * Sem isto, o ON CONFLICT falha com "cannot affect row a second time" (21000)
 * quando o arquivo do portal traz a mesma combinação duas vezes — o que
 * acontece na prática, já que MS e PA desnormalizam colunas em linhas.
 */
export function deduplicar(registros: RegistroGta[]): RegistroGta[] {
  const porChave = new Map<string, RegistroGta>();
  for (const r of registros) {
    const chave = chaveNatural(r);
    const existente = porChave.get(chave);
    if (existente) existente.quantidade += r.quantidade;
    else porChave.set(chave, { ...r });
  }
  return [...porChave.values()];
}

/** Grava os registros em lotes, atualizando os que já existem. */
export async function gravarRegistros(
  registros: RegistroGta[],
  coletaId: number,
): Promise<number> {
  const unicos = deduplicar(registros);
  const cliente = obterCliente();
  let gravados = 0;

  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE).map((r) => ({
      coleta_id: coletaId,
      uf: r.uf,
      documento_tipo: r.documentoTipo,
      documento_numero: r.documentoNumero,
      documento_serie: r.documentoSerie,
      data_emissao: r.dataEmissao,
      finalidade: r.finalidade,
      sexo: r.sexo,
      faixa_etaria: r.faixaEtaria,
      quantidade: r.quantidade,
      municipio_origem: r.municipioOrigem,
      municipio_destino: r.municipioDestino,
      uf_destino: r.ufDestino,
    }));

    const { error } = await cliente
      .from("gta_registros")
      .upsert(lote, { onConflict: "uf,documento_numero,documento_serie,sexo,faixa_etaria" });

    if (error) throw new Error(`Falha ao gravar registros: ${error.message}`);
    gravados += lote.length;
  }

  return gravados;
}
