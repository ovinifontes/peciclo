/**
 * Decisões puras da recoleta automática — o que fazer depois de cada tentativa
 * e como redigir o aviso ao operador. Sem SDK do Trigger.dev de propósito:
 * fica fora de src/trigger/ (que é só de tasks) e testa sem carregar runtime.
 */

/** Ordem canônica dos coletores da coleta diária. */
export const UFS_RECOLETAVEIS = ["MS", "MT", "RO", "PA"] as const;
export type UfRecoletavel = (typeof UFS_RECOLETAVEIS)[number];

/** Duas tentativas de recoleta; depois disso a coleta de amanhã se autocorrige. */
export const MAX_TENTATIVAS_RECOLETA = 2;

/**
 * Sanitiza a lista de UFs pedida: descarta desconhecidas, remove duplicatas e
 * devolve na ordem canônica. Payload vem de outra task (ou de disparo manual
 * pelo painel), então não dá para confiar no formato.
 */
export function normalizarUfs(ufs: string[]): UfRecoletavel[] {
  const pedidas = new Set(ufs.map((uf) => uf.trim().toUpperCase()));
  return UFS_RECOLETAVEIS.filter((uf) => pedidas.has(uf));
}

export type DesfechoRecoleta =
  | { tipo: "recuperado" }
  | { tipo: "reagendar"; ufs: UfRecoletavel[]; proximaTentativa: number }
  | { tipo: "esgotado"; ufs: UfRecoletavel[] };

/**
 * Decide o passo seguinte de uma tentativa de recoleta. Tentativa acima do
 * limite nunca reagenda (defesa contra payload adulterado ou bug de contagem):
 * o pior caso vira alerta, não loop infinito de recoletas.
 */
export function decidirDesfecho(args: {
  ufsAindaComFalha: UfRecoletavel[];
  tentativa: number;
  maxTentativas?: number;
}): DesfechoRecoleta {
  const max = args.maxTentativas ?? MAX_TENTATIVAS_RECOLETA;
  if (args.ufsAindaComFalha.length === 0) return { tipo: "recuperado" };
  if (args.tentativa < max) {
    return { tipo: "reagendar", ufs: args.ufsAindaComFalha, proximaTentativa: args.tentativa + 1 };
  }
  return { tipo: "esgotado", ufs: args.ufsAindaComFalha };
}

export function assuntoRecuperado(ufs: readonly string[], tentativa: number): string {
  const sufixo = ufs.length === 1 ? "recuperado" : "recuperados";
  return `✅ Recoleta: ${ufs.join(", ")} ${sufixo} na tentativa ${tentativa}`;
}

export function assuntoEsgotado(
  ufs: readonly string[],
  maxTentativas: number = MAX_TENTATIVAS_RECOLETA,
): string {
  const [falhou, fica] = ufs.length === 1 ? ["falhou", "fica"] : ["falharam", "ficam"];
  return (
    `❌ Recoleta: ${ufs.join(", ")} ${falhou} nas ${maxTentativas} tentativas` +
    ` — ${fica} para a coleta de amanhã`
  );
}
