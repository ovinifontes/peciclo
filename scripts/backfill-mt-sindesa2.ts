/**
 * Preenche o buraco do diário de MT pelo portal NOVO (SINDESA 2).
 *
 * O portal velho parou em 06/08/2026; de 07/08 em diante só o novo tem o dado,
 * e lá não existe relatório somado — cada dia custa abrir ~800 a 1.200 GTAs.
 * Por isso este script é separado do `backfill-mt-diario.ts` (velho, 1
 * requisição por dia): mesma tabela de destino, custos de ordem diferente.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/backfill-mt-sindesa2.ts 2026-08-07 2026-09-21
 *   npx tsx --env-file=.env scripts/backfill-mt-sindesa2.ts 2026-08-07 2026-09-21 --simular
 *
 * Retomável: dia que já tem linha `sindesa2_gta` no banco é pulado sem tocar
 * no portal. Numa corrida de horas isso não é conforto, é requisito.
 */
import {
  abrirSessaoSindesa2,
  coletarDiaSindesa2,
  prepararPesquisa,
  SessaoSindesa2Error,
} from "../src/coletores/mt-sindesa2.js";
import { abrirColeta, fecharColeta } from "../src/dados/coletas.js";
import { gravarAgregadosDiarios } from "../src/dados/diario.js";
import { arquivarBruto } from "../src/dados/arquivos.js";
import { obterCliente } from "../src/dados/cliente.js";

/** Primeiro dia que só existe no portal novo. */
const PRIMEIRO_DIA_DO_NOVO = "2026-08-07";
/**
 * GTAs abertas ao mesmo tempo. Com 5 o portal devolveu ETIMEDOUT no meio do
 * primeiro dia de teste; 3 é o ritmo que ele aguenta. Somado ao retry com
 * espera crescente dentro do coletor, é o que faz a corrida chegar ao fim.
 */
const CONCORRENCIA = 3;

const [de, ate, ...resto] = process.argv.slice(2);
const simular = resto.includes("--simular");

if (!de || !ate || !/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
  console.error("uso: backfill-mt-sindesa2.ts <AAAA-MM-DD inicial> <AAAA-MM-DD final> [--simular]");
  process.exit(1);
}
if (de > ate) {
  console.error(`intervalo invertido: ${de} vem depois de ${ate}`);
  process.exit(1);
}
if (de < PRIMEIRO_DIA_DO_NOVO) {
  console.error(
    `${de} é anterior a ${PRIMEIRO_DIA_DO_NOVO}: até 06/08/2026 use backfill-mt-diario.ts, ` +
      "que resolve o dia em 1 requisição em vez de mil.",
  );
  process.exit(1);
}

const cpf = process.env.INDEA_CPF;
const senha = process.env.INDEA_SENHA;
if (!cpf || !senha) {
  console.error("INDEA_CPF/INDEA_SENHA ausentes no ambiente");
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

/** Dias que já vieram DESTE portal — só eles contam como feitos. */
async function diasJaGravados(inicio: string, fim: string): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("peciclo_abate_diario")
    .select("data")
    .eq("uf", "MT")
    .eq("fonte", "sindesa2_gta")
    .gte("data", inicio)
    .lte("data", fim);
  if (error) throw new Error(`Falha ao ler os dias já gravados: ${error.message}`);
  return new Set((data ?? []).map((l) => String(l.data)));
}

const dias = listarDias(de, ate);
const jaFeitos = simular ? new Set<string>() : await diasJaGravados(de, ate);
const pendentes = dias.filter((d) => !jaFeitos.has(d));

console.log(
  `${dias.length} dias no intervalo, ${jaFeitos.size} já no banco, ${pendentes.length} a coletar` +
    (simular ? "  [SIMULAÇÃO: nada é gravado]" : ""),
);
if (pendentes.length === 0) process.exit(0);

const sessao = await abrirSessaoSindesa2(cpf, senha);

const coletaId = simular
  ? 0
  : await abrirColeta({ uf: "MT", tipo: "rejanela", janela: { inicio: de, fim: ate } });

const falhas: Array<{ dia: string; erro: string }> = [];
let gravados = 0;
let cabecas = 0;
const comecou = Date.now();

for (const [i, dia] of pendentes.entries()) {
  const t0 = Date.now();
  try {
    // Duas tentativas por dia. O portal falha de formas passageiras — filtro
    // que não nasce, ViewState velho, "Accesso Negado" — e numa corrida de
    // dezenas de dias desistir na primeira deixaria buracos espalhados que
    // alguém teria de caçar depois, um a um.
    let r: Awaited<ReturnType<typeof coletarDiaSindesa2>> | null = null;
    let ultimoErro: unknown;
    for (let tentativa = 1; tentativa <= 2 && r === null; tentativa++) {
      try {
        // Tela recarregada a cada dia: o ViewState do JSF envelhece depois de
        // uma pesquisa pesada e a seguinte volta "Accesso Negado". Custa ~6s
        // por dia e foi o que fez metade de agosto voltar como dia vazio na
        // primeira corrida.
        await prepararPesquisa(sessao.page);
        r = await coletarDiaSindesa2(sessao.page, dia, CONCORRENCIA);
      } catch (erro) {
        ultimoErro = erro;
        if (tentativa < 2) {
          console.error(`${dia}  1ª tentativa falhou (${erro instanceof Error ? erro.message.slice(0, 80) : erro}); repetindo`);
          await new Promise((espera) => setTimeout(espera, 5000));
        }
      }
    }
    if (r === null) throw ultimoErro;

    // Guarda dura: GTA sem Estratificação é guia sem animal, o que não existe
    // em GTA de abate. Uma ou outra pode ser guia cancelada; muitas significam
    // parser quebrado, e aí gravar entregaria um dia menor do que foi.
    const semDados = r.semEstratificacao.length;
    if (semDados > 0 && semDados > r.gtas.length * 0.02) {
      throw new SessaoSindesa2Error(
        `${semDados} de ${r.gtas.length} GTAs vieram sem Estratificação — leitura quebrada, nada gravado`,
      );
    }
    if (r.divergentes.length > 0) {
      throw new SessaoSindesa2Error(
        `${r.divergentes.length} GTAs não fecham com a taxa por animal (ex.: ${r.divergentes.slice(0, 3).join(", ")}) — nada gravado`,
      );
    }

    const total = r.agregados.reduce((s, a) => s + a.quantidade, 0);
    cabecas += total;

    if (!simular && r.agregados.length > 0) {
      // Trilha de auditoria enxuta: o HTML das ~1.000 GTAs daria ~130 MB por
      // dia. O que se guarda é a leitura por GTA — o suficiente para
      // reconferir a soma depois sem voltar ao portal.
      const detalhe = Buffer.from(
        JSON.stringify({ dia, gtas: r.gtas.map((g) => ({ id: g.id, linhas: g.linhas })) }),
      );
      await arquivarBruto({
        caminho: `mt-sindesa2/${dia}.json`,
        conteudo: detalhe,
        contentType: "application/json",
      });
      await gravarAgregadosDiarios(r.agregados, coletaId, "sindesa2_gta");
    }

    if (r.agregados.length > 0) gravados++;
    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `${dia}  ${String(r.gtas.length).padStart(5)} GTAs  ${String(total).padStart(7)} cabeças  ${seg}s`,
    );
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    falhas.push({ dia, erro: mensagem });
    console.error(`${dia}  FALHOU: ${mensagem.slice(0, 160)}`);
    // Sessão caída não melhora sozinha: reabre e remonta os filtros em vez de
    // deixar todos os dias seguintes falharem igual.
    if (/sessão caiu|tela de pesquisa sumiu|login/i.test(mensagem)) {
      console.error("  reabrindo a sessão…");
      try {
        await sessao.fechar();
      } catch {
        /* já estava morta */
      }
      const nova = await abrirSessaoSindesa2(cpf, senha);
      sessao.ctx = nova.ctx;
      sessao.page = nova.page;
      sessao.fechar = nova.fechar;
    }
  }

  const min = (Date.now() - comecou) / 60_000;
  const restam = ((pendentes.length - i - 1) * min) / (i + 1);
  console.log(`  … ${i + 1}/${pendentes.length} em ${min.toFixed(1)} min, faltam ~${restam.toFixed(0)} min`);
}

await sessao.fechar();

if (!simular) {
  await fecharColeta({
    id: coletaId,
    status: falhas.length > 0 && gravados === 0 ? "falha" : gravados > 0 ? "ok" : "sem_dados",
    linhasAfetadas: gravados,
    erro: falhas.length > 0 ? `${falhas.length} dia(s) falharam` : null,
  });
}

console.log(
  `\n${gravados} dias gravados, ${falhas.length} falhas, ` +
    `${cabecas.toLocaleString("pt-BR")} cabeças, ${((Date.now() - comecou) / 60_000).toFixed(1)} min`,
);
if (falhas.length > 0) {
  console.log("dias que falharam (rode de novo, o script pula o que já entrou):");
  for (const f of falhas) console.log(`  ${f.dia}  ${f.erro.slice(0, 120)}`);
  process.exitCode = 1;
}
