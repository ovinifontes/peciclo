/**
 * Refaz meses históricos com o dado oficial dos portais, substituindo o que
 * veio da semente manual. Útil quando se descobre erro no histórico ou quando
 * um portal republica dados.
 *
 * Uso (carregue o .env antes):
 *   npx tsx scripts/backfill.ts MS 2025-01 2025-12
 *   npx tsx scripts/backfill.ts RO 2026-01 2026-07
 *   npx tsx scripts/backfill.ts MT 2025-01 2025-06
 *
 * MT aceita range multi-mês num pedido só (o relatório traz a coluna MÊS),
 * então ele é consultado em bloco. MS e RO vão mês a mês.
 */
import { coletarMs } from "../src/coletores/ms.js";
import { coletarMt } from "../src/coletores/mt.js";
import { coletarRo } from "../src/coletores/ro.js";
import { abrirColeta, fecharColeta } from "../src/dados/coletas.js";
import { arquivarBruto } from "../src/dados/arquivos.js";
import { gravarRegistros } from "../src/dados/registros.js";
import { gravarAgregados, rollupJanela } from "../src/dados/mensal.js";
import type { UF } from "../src/tipos.js";

const CHAVE_RO = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

const [uf, de, ate] = process.argv.slice(2) as [UF, string, string];
if (!uf || !de || !ate) {
  console.error("uso: backfill.ts <UF> <AAAA-MM inicial> <AAAA-MM final>");
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

const janelaDoMes = (ano: number, mes: number) => ({
  inicio: `${ano}-${String(mes).padStart(2, "0")}-01`,
  fim: `${ano}-${String(mes).padStart(2, "0")}-${new Date(Date.UTC(ano, mes, 0)).getUTCDate()}`,
});

if (uf === "MT") {
  const janela = { inicio: janelaDoMes(meses[0]!.ano, meses[0]!.mes).inicio, fim: janelaDoMes(meses.at(-1)!.ano, meses.at(-1)!.mes).fim };
  const id = await abrirColeta({ uf, tipo: "rejanela", janela });
  const { agregados, arquivo, nomeArquivo } = await coletarMt(janela, process.env.INDEA_CPF!, process.env.INDEA_SENHA!);
  await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
  await gravarAgregados(agregados, id, "gta_condensada");
  await fecharColeta({ id, status: "ok", linhasAfetadas: agregados.length });
  console.log(`MT ${janela.inicio}..${janela.fim}: ${agregados.length / 2} meses gravados`);
} else {
  for (const { ano, mes } of meses) {
    const janela = janelaDoMes(ano, mes);
    const id = await abrirColeta({ uf, tipo: uf === "RO" ? "mensal" : "rejanela", janela });
    try {
      if (uf === "RO") {
        const ag = await coletarRo({ ano, mes, chaveRecurso: CHAVE_RO });
        await gravarAgregados(ag, id, "powerbi");
        await fecharColeta({ id, status: ag.length ? "ok" : "sem_dados", linhasAfetadas: ag.length });
        console.log(`RO ${mes}/${ano}: ${ag.length} agregados`);
      } else {
        const { registros, arquivo, hash, nomeArquivo } = await coletarMs(janela);
        await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
        const g = await gravarRegistros(registros, id);
        await rollupJanela({ uf, janela, coletaId: id });
        await fecharColeta({ id, status: "ok", arquivoPath: nomeArquivo, arquivoHash: hash, linhasAfetadas: g });
        console.log(`MS ${mes}/${ano}: ${g} registros`);
      }
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id, status: "falha", erro: msg });
      console.error(`${uf} ${mes}/${ano} FALHOU: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 3000)); // gentileza com o portal
  }
}
console.log("backfill concluído");
