/**
 * Reconstrói o abate DIÁRIO de Rondônia pela consulta pública do MAPA.
 *
 * Por que a série inteira, e não só o buraco: o diário de RO vinha de
 * `powerbi_diff`, uma estimativa por diferença entre retratos do total mensal
 * do painel do IDARON. Ela existia havia 5 semanas, cobria 13 dos 39 dias,
 * errava 25% em média e datava o dia errado sistematicamente. Emendar o MAPA
 * nela criaria um degrau de 25% no volume E de 6 pontos no percentual de
 * fêmeas — nos mesmos 11 dias de setembro o IDARON dá 46,9% e o MAPA 41,2%,
 * porque medem universos diferentes. Para quem lê ciclo, um degrau assim
 * estraga a média móvel e toda comparação que o atravesse.
 *
 * O upsert é por (uf, data, finalidade, sexo), então gravar aqui SUBSTITUI as
 * linhas 'powerbi_diff' do mesmo dia. Não há emenda: fica uma série só.
 *
 * O mensal de RO NÃO é tocado — continua vindo do painel do IDARON, que mede
 * todas as inspeções e tem história longa.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/backfill-ro-sigsif.ts 2024-01-01 2026-09-25
 *
 * Retomável: dia já gravado com fonte 'sigsif_dia' é pulado sem tocar na
 * fonte. Numa corrida de ~1.000 dias isso é requisito, não conforto.
 */
import { coletarDiaSigsif } from "../src/coletores/sigsif-diario.js";
import { abrirColeta, fecharColeta } from "../src/dados/coletas.js";
import { gravarAgregadosDiarios } from "../src/dados/diario.js";
import { obterCliente } from "../src/dados/cliente.js";

/** Respiro entre consultas: JSF público de órgão federal, sem paralelismo. */
const PAUSA_MS = 1200;

const [de, ate] = process.argv.slice(2);
if (!de || !ate || !/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
  console.error("uso: backfill-ro-sigsif.ts <AAAA-MM-DD inicial> <AAAA-MM-DD final>");
  process.exit(1);
}

function listarDias(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  const cursor = new Date(`${inicio}T00:00:00Z`);
  const parada = new Date(`${fim}T00:00:00Z`);
  while (cursor <= parada) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

async function jaGravados(de: string, ate: string): Promise<Set<string>> {
  const feitos = new Set<string>();
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await obterCliente()
      .from("peciclo_abate_diario")
      .select("data")
      .eq("uf", "RO")
      .eq("fonte", "sigsif_dia")
      .gte("data", de)
      .lte("data", ate)
      .range(inicio, inicio + 999);
    if (error) throw new Error(`Falha ao ler os dias já gravados: ${error.message}`);
    for (const l of data ?? []) feitos.add(String(l.data));
    if (!data || data.length < 1000) return feitos;
  }
}

const dias = listarDias(de, ate);
const feitos = await jaGravados(de, ate);
const pendentes = dias.filter((d) => !feitos.has(d));
console.log(`${dias.length} dias no intervalo, ${feitos.size} já no banco, ${pendentes.length} a coletar`);
if (pendentes.length === 0) process.exit(0);

const coletaId = await abrirColeta({ uf: "RO", tipo: "rejanela", janela: { inicio: de, fim: ate } });
const falhas: string[] = [];
let gravados = 0;
let vazios = 0;
let cabecas = 0;
const comecou = Date.now();

for (const [i, dia] of pendentes.entries()) {
  try {
    const agregados = await coletarDiaSigsif("RO", dia);
    if (agregados.length === 0) {
      vazios++;
    } else {
      await gravarAgregadosDiarios(agregados, coletaId, "sigsif_dia");
      gravados++;
      cabecas += agregados.reduce((s, a) => s + a.quantidade, 0);
    }
  } catch (erro) {
    // Um dia ruim não derruba a corrida: anota e segue. A releitura pula o
    // que já entrou, então rodar de novo custa só os que faltaram.
    falhas.push(dia);
    console.error(`${dia}  FALHOU: ${erro instanceof Error ? erro.message.slice(0, 110) : erro}`);
  }
  if (i % 50 === 49) {
    const min = (Date.now() - comecou) / 60_000;
    console.log(
      `  … ${i + 1}/${pendentes.length} em ${min.toFixed(1)} min, faltam ~${(((pendentes.length - i - 1) * min) / (i + 1)).toFixed(0)} min`,
    );
  }
  await new Promise((r) => setTimeout(r, PAUSA_MS));
}

await fecharColeta({
  id: coletaId,
  status: gravados > 0 ? "ok" : "falha",
  linhasAfetadas: gravados,
  erro: falhas.length > 0 ? `${falhas.length} dia(s) falharam` : null,
});

console.log(
  `\n${gravados} dias gravados, ${vazios} sem movimento, ${falhas.length} falhas, ` +
    `${cabecas.toLocaleString("pt-BR")} cabeças, ${((Date.now() - comecou) / 60_000).toFixed(1)} min`,
);
if (falhas.length > 0) console.log("dias que falharam:", falhas.join(", "));
