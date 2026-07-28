/**
 * Semeia o histórico da planilha do sócio em peciclo_abate_mensal (fonte manual).
 * Rodar uma vez, após aplicar o schema. Idempotente (ignoreDuplicates).
 *
 * Uso: carregue o .env e rode `npx tsx scripts/semear-historico.ts`
 */
import { lerCsvHistorico, semearHistorico } from "../src/semente/importar-historico.js";

const CSV = "referencias/planilha-abate-2025-2026.csv";

const linhas = await lerCsvHistorico(CSV);
console.log("linhas a semear:", linhas.length);

const enviadas = await semearHistorico(CSV);
console.log("semeadura concluída:", enviadas, "linhas enviadas");
