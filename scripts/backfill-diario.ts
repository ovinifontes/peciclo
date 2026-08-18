/**
 * Preenche `peciclo_abate_diario` reagregando o que JÁ está em
 * `peciclo_gta_registros` — nada é baixado dos portais. Idempotente:
 * rodar de novo é seguro (o rollup só grava o que mudou).
 *
 * Uso (carregue o .env antes):
 *   npx tsx scripts/backfill-diario.ts MS 2025-01 2026-08
 *
 * Só faz sentido para UFs com detalhe por GTA no banco (MS; PA se um dia
 * quisermos). MT e RO não têm linhas em gta_registros.
 */
import { obterCliente } from "../src/dados/cliente.js";
import type { UF } from "../src/tipos.js";

const [uf, de, ate] = process.argv.slice(2) as [UF, string, string];
if (!uf || !de || !ate) {
  console.error("uso: backfill-diario.ts <UF> <AAAA-MM inicial> <AAAA-MM final>");
  process.exit(1);
}

const meses: Array<{ ano: number; mes: number }> = [];
{
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  for (let a = a1!, m = m1!; a < a2! || (a === a2! && m <= m2!); m === 12 ? (a++, (m = 1)) : m++) {
    meses.push({ ano: a, mes: m });
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const db = obterCliente();

let total = 0;
for (const { ano, mes } of meses) {
  const primeiro = `${ano}-${pad(mes)}-01`;
  const ultimo = `${ano}-${pad(mes)}-${pad(new Date(Date.UTC(ano, mes, 0)).getUTCDate())}`;
  const { data, error } = await db.rpc("peciclo_rollup_abate_diario", {
    p_uf: uf,
    p_de: primeiro,
    p_ate: ultimo,
    p_coleta_id: null,
  });
  if (error) {
    console.error(`${ano}-${pad(mes)}: FALHOU — ${error.message}`);
    process.exit(1);
  }
  const n = Number(data ?? 0);
  total += n;
  console.log(`${ano}-${pad(mes)}: ${n} linhas`);
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`total: ${total} linhas diárias gravadas/atualizadas`);
