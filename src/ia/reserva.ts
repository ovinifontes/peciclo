// O texto de reserva: quando a IA falha na validação duas vezes (ou nem
// responde), o cliente ainda recebe um resumo correto. Template determinístico
// — cada número vem direto do dossiê, então passa na própria `validarTexto`.
//
// Módulo puro, compartilhado raiz↔web: só importa de `./dossie.js`.
import type { Dossie } from "./dossie.js";
import { formatarDataBr, formatarNumeroBr, mesPorExtenso } from "./dossie.js";

/** O que cada fase significa para quem cria e engorda boi. */
const LEITURA_DA_FASE: Record<string, string> = {
  retencao: "retenção de fêmeas — o criador está segurando matriz para produzir bezerro, o que aperta a oferta de boi mais adiante",
  liquidacao: "liquidação de fêmeas — mais matriz indo para o gancho, oferta maior agora e menor produção de bezerro na frente",
  transicao: "transição — o movimento está dentro da faixa neutra, sem direção firme de retenção nem de liquidação",
};

export function textoReserva(d: Dossie): string {
  const c = d.ciclo;
  const linhas: string[] = [];

  linhas.push(`Resumo do dia — ${formatarDataBr(d.geradoEm)}`);
  linhas.push("");

  // Onde estamos no ciclo
  const leitura = LEITURA_DA_FASE[c.fase];
  if (leitura && c.competencia && c.pctFemeas !== null && c.yoyMm3Pp !== null) {
    linhas.push(`O consolidado ${d.estadosPainel} aponta ${leitura}.`);
    linhas.push(
      `Em ${mesPorExtenso(c.competencia.ano, c.competencia.mes)}, as fêmeas foram ${formatarNumeroBr(c.pctFemeas * 100)}% do abate, ` +
        `variação de ${formatarNumeroBr(c.yoyMm3Pp)} p.p. sobre um ano atrás (média móvel de 3 meses)` +
        (c.mesesNaDirecao > 0 ? `, há ${c.mesesNaDirecao} meses na mesma direção.` : `.`),
    );
  } else {
    linhas.push(`O consolidado ${d.estadosPainel} ainda não tem leitura de ciclo utilizável.`);
  }

  // O que o mercado fez
  const boi = d.precos.find((p) => p.serie === "boi_gordo");
  if (boi) {
    linhas.push(
      `Boi gordo a R$ ${formatarNumeroBr(boi.valor)} a arroba (${formatarDataBr(boi.data)})` +
        (d.variacaoBoiDia !== null ? `, ${formatarNumeroBr(d.variacaoBoiDia)} R$/@ sobre o pregão anterior.` : `.`),
    );
  }
  const bezerro = d.precos.find((p) => p.serie === "bezerro_ms");
  if (bezerro) {
    linhas.push(
      `Bezerro em MS a R$ ${formatarNumeroBr(bezerro.valor)} (${formatarDataBr(bezerro.data)})` +
        (d.relacaoTroca !== null ? `; a relação de troca está em ${formatarNumeroBr(d.relacaoTroca)} arrobas de boi por bezerro.` : `.`),
    );
  }

  // O que observar
  if (d.futuros.length > 0) {
    linhas.push(`Futuros do boi na B3: ${d.futuros.map((f) => `${f.vencimento} a R$ ${formatarNumeroBr(f.preco)}`).join("; ")}.`);
  }
  linhas.push("");
  linhas.push("Resumo automático a partir dos dados do Peciclo.");

  return linhas.join("\n");
}

/** Nome curto da fase para o resumo — sem a explicação didática do completo. */
const FASE_CURTA: Record<string, string> = {
  retencao: "retenção de fêmeas",
  liquidacao: "liquidação de fêmeas",
  transicao: "transição",
};

/**
 * Reserva do RESUMO do WhatsApp: 3–4 linhas determinísticas (preço e variação,
 * fase com competência e %, relação de troca). Mesmo invariante do texto
 * completo: cada número vem direto do dossiê e passa em `validarTexto`.
 * Sem cabeçalho — a rotina põe o título "📈 Cenário Peciclo — dd/mm/aaaa".
 */
export function resumoReserva(d: Dossie): string {
  const c = d.ciclo;
  const linhas: string[] = [];

  const boi = d.precos.find((p) => p.serie === "boi_gordo");
  if (boi) {
    linhas.push(
      `Boi gordo a R$ ${formatarNumeroBr(boi.valor)} a arroba (${formatarDataBr(boi.data)})` +
        (d.variacaoBoiDia !== null ? `, ${formatarNumeroBr(d.variacaoBoiDia)} R$/@ sobre o pregão anterior.` : `.`),
    );
  }

  const fase = FASE_CURTA[c.fase];
  if (fase && c.competencia && c.pctFemeas !== null) {
    linhas.push(
      `Ciclo em ${fase}: fêmeas a ${formatarNumeroBr(c.pctFemeas * 100)}% do abate em ${mesPorExtenso(c.competencia.ano, c.competencia.mes)}` +
        (c.mesesNaDirecao > 0 ? `, há ${c.mesesNaDirecao} meses na mesma direção.` : `.`),
    );
  }

  if (d.relacaoTroca !== null) {
    linhas.push(`Relação de troca: ${formatarNumeroBr(d.relacaoTroca)} arrobas de boi por bezerro (MS).`);
  }

  // Dia sem nenhum dado utilizável: uma linha honesta, nunca texto vazio.
  if (linhas.length === 0) {
    linhas.push(`Sem dado novo utilizável hoje no consolidado ${d.estadosPainel}.`);
  }

  return linhas.join("\n");
}
