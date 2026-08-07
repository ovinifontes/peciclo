// O coração da confiança do produto: a IA escreve, mas nunca inventa número.
// Todo token numérico do texto gerado precisa existir no dossiê (com
// arredondamento compatível com as casas decimais do próprio token). Falhou,
// o chamador regenera; falhou de novo, entra o texto de reserva.
//
// Módulo puro, compartilhado raiz↔web: só importa tipos de `./dossie.js`.
import type { Dossie } from "./dossie.js";

/** Todos os valores numéricos que o texto tem permissão de citar. */
export function valoresPermitidos(d: Dossie): number[] {
  const valores: number[] = [];
  const c = d.ciclo;

  if (c.pctFemeas !== null) valores.push(c.pctFemeas * 100);
  if (c.yoyMm3Pp !== null) valores.push(c.yoyMm3Pp, Math.abs(c.yoyMm3Pp));
  valores.push(c.mesesNaDirecao);
  if (c.competencia) valores.push(c.competencia.ano, c.competencia.mes);

  for (const p of d.serie) valores.push(p.pctFemeas * 100);
  for (const p of d.precos) valores.push(p.valor);
  if (d.variacaoBoiDia !== null) valores.push(d.variacaoBoiDia, Math.abs(d.variacaoBoiDia));
  if (d.relacaoTroca !== null) valores.push(d.relacaoTroca);
  for (const f of d.futuros) valores.push(f.preco);

  return valores;
}

export interface Validacao {
  ok: boolean;
  /** Tokens reprovados, como aparecem no texto (ex.: "152.596"). */
  invalidos: string[];
}

/** Tokens numéricos pt-BR: "152.596", "3.369,17", "49,8", "350", … */
const RE_TOKEN = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

/** "3.369,17" → 3369.17 (ponto de milhar, vírgula decimal). */
function paraNumero(token: string): number {
  return Number(token.replaceAll(".", "").replace(",", "."));
}

function arredondar(v: number, casas: number): number {
  const fator = Math.pow(10, casas);
  return Math.round(v * fator) / fator;
}

export function validarTexto(texto: string, d: Dossie): Validacao {
  const permitidos = valoresPermitidos(d);
  const invalidos: string[] = [];

  for (const m of texto.matchAll(RE_TOKEN)) {
    const bruto = m[0];
    const antes = texto[m.index - 1];
    const depois = texto[m.index + bruto.length];

    // Datas e vencimentos: qualquer token colado em "/" ("04/08", "out/26").
    if (antes === "/" || depois === "/") continue;

    // Horários (\d+:\d+): o dígito do outro lado do ":" confirma que é hora,
    // sem isentar por engano um "total: 500".
    const antesDoDoisPontos = texto[m.index - 2];
    const depoisDoDoisPontos = texto[m.index + bruto.length + 1];
    if (antes === ":" && /\d/.test(antesDoDoisPontos ?? "")) continue;
    if (depois === ":" && /\d/.test(depoisDoDoisPontos ?? "")) continue;

    const valor = paraNumero(bruto);
    const inteiro = !bruto.includes(",");

    // Contagens pequenas ("há 4 meses", "3 partes") e anos.
    if (inteiro && valor >= 0 && valor <= 12) continue;
    if (inteiro && valor >= 1900 && valor <= 2100) continue;

    // Válido se algum valor permitido, arredondado nas casas do token, bate.
    // Assim "49,8" casa com 49,84 e "50" também. O sinal fica fora do token
    // (a regex não captura "−"/"-"), por isso os absolutos entram na lista.
    const casas = inteiro ? 0 : bruto.split(",")[1]!.length;
    const tolerancia = Math.pow(10, -casas) / 2 + 1e-9;
    const bate = permitidos.some((v) => Math.abs(valor - arredondar(v, casas)) < tolerancia);
    if (!bate) invalidos.push(bruto);
  }

  return { ok: invalidos.length === 0, invalidos };
}
