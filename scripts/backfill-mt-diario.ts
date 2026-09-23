/**
 * Reconstrói o abate DIÁRIO do MT no portal VELHO do INDEA (InfoSindesa).
 *
 * O relatório GTA Condensado aceita janela de 1 dia e devolve o dia já somado
 * por sexo — uma requisição por dia, contra as ~1.000 GTAs que o SINDESA novo
 * exigiria abrir. O velho parou de receber guia nova em 07/08/2026 (migração),
 * mas o PASSADO dele continua intacto e respondendo: testado até 2018.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/backfill-mt-diario.ts 2024-01-01 2026-08-06
 *   npx tsx --env-file=.env scripts/backfill-mt-diario.ts 2024-01-01 2026-08-06 --simular
 *
 * Retomável: dia que já tem linha em peciclo_abate_diario é pulado sem tocar
 * no portal. Cair no meio de uma corrida de horas e recomeçar não custa nada.
 */
import { coletarMt, atribuirDia, CredencialInvalidaError } from "../src/coletores/mt.js";
import { abrirColeta, fecharColeta } from "../src/dados/coletas.js";
import { gravarAgregadosDiarios } from "../src/dados/diario.js";
import { arquivarBruto } from "../src/dados/arquivos.js";
import { obterCliente } from "../src/dados/cliente.js";

/** Último dia que o portal velho enxerga. Depois disso ele responde vazio. */
const ULTIMO_DIA_DO_VELHO = "2026-08-06";
/** Respiro entre dias: portal de governo atrás de WAF, sem paralelismo. */
const PAUSA_MS = 800;

const [de, ate, ...resto] = process.argv.slice(2);
const simular = resto.includes("--simular");

if (!de || !ate || !/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
  console.error("uso: backfill-mt-diario.ts <AAAA-MM-DD inicial> <AAAA-MM-DD final> [--simular]");
  process.exit(1);
}
if (de > ate) {
  console.error(`intervalo invertido: ${de} vem depois de ${ate}`);
  process.exit(1);
}
if (ate > ULTIMO_DIA_DO_VELHO) {
  // Avisa e segue: pedir além do corte não é erro, é só desperdício de
  // requisição — e gravar os zeros que voltariam seria inventar dia sem abate.
  console.warn(
    `aviso: o portal velho só tem até ${ULTIMO_DIA_DO_VELHO}; os dias posteriores ` +
      "voltam vazios e serão pulados. Para eles a fonte é o SINDESA novo.",
  );
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

/** Dias de MT que já estão no banco — para não reconsultar o portal à toa. */
async function diasJaGravados(inicio: string, fim: string): Promise<Set<string>> {
  const feitos = new Set<string>();
  // Paginado na mão: são no máximo alguns milhares de linhas e o Supabase
  // corta em 1000 sem avisar.
  for (let de = 0; ; de += 1000) {
    const { data, error } = await obterCliente()
      .from("peciclo_abate_diario")
      .select("data")
      .eq("uf", "MT")
      .gte("data", inicio)
      .lte("data", fim)
      .range(de, de + 999);
    if (error) throw new Error(`Falha ao ler os dias já gravados: ${error.message}`);
    for (const l of data ?? []) feitos.add(String(l.data));
    if (!data || data.length < 1000) return feitos;
  }
}

const dias = listarDias(de, ate).filter((d) => d <= ULTIMO_DIA_DO_VELHO);
const jaFeitos = simular ? new Set<string>() : await diasJaGravados(de, ate);
const pendentes = dias.filter((d) => !jaFeitos.has(d));

console.log(
  `${dias.length} dias no intervalo, ${jaFeitos.size} já no banco, ${pendentes.length} a coletar` +
    (simular ? "  [SIMULAÇÃO: nada é gravado]" : ""),
);
if (pendentes.length === 0) process.exit(0);

const coletaId = simular
  ? 0
  : await abrirColeta({ uf: "MT", tipo: "rejanela", janela: { inicio: de, fim: ate } });

const falhas: Array<{ dia: string; erro: string }> = [];
let gravados = 0;
let vazios = 0;
let cabecas = 0;
const comecou = Date.now();

for (const [i, dia] of pendentes.entries()) {
  try {
    const { agregados, arquivo, nomeArquivo } = await coletarMt({ inicio: dia, fim: dia }, cpf, senha);

    if (agregados.length === 0) {
      vazios++;
      console.log(`${dia}  vazio`);
    } else {
      const total = agregados.reduce((s, a) => s + a.quantidade, 0);
      cabecas += total;
      if (!simular) {
        // O bruto vai para o bucket: se um dia o parser mudar, reprocessar sai
        // do Storage em vez de bater de novo nestes milhares de dias.
        await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
        await gravarAgregadosDiarios(atribuirDia(agregados, dia), coletaId);
      }
      gravados++;
      console.log(`${dia}  ${String(total).padStart(7)} cabeças`);
    }
  } catch (erro) {
    // Um dia ruim não derruba uma corrida de horas: anota e segue. Credencial
    // rejeitada é outra história — daí TODOS os dias seguintes falhariam igual.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    falhas.push({ dia, erro: mensagem });
    console.error(`${dia}  FALHOU: ${mensagem.slice(0, 140)}`);
    if (erro instanceof CredencialInvalidaError) {
      console.error("credencial rejeitada — parando aqui para não queimar o acesso");
      break;
    }
  }

  if (i % 50 === 49) {
    const min = (Date.now() - comecou) / 60_000;
    const restam = ((pendentes.length - i - 1) * min) / (i + 1);
    console.log(`  … ${i + 1}/${pendentes.length} em ${min.toFixed(1)} min, faltam ~${restam.toFixed(0)} min`);
  }
  await new Promise((r) => setTimeout(r, PAUSA_MS));
}

if (!simular) {
  await fecharColeta({
    id: coletaId,
    status: falhas.length > 0 && gravados === 0 ? "falha" : gravados > 0 ? "ok" : "sem_dados",
    linhasAfetadas: gravados,
    erro: falhas.length > 0 ? `${falhas.length} dia(s) falharam` : null,
  });
}

console.log(
  `\n${gravados} dias gravados, ${vazios} vazios, ${falhas.length} falhas, ` +
    `${cabecas.toLocaleString("pt-BR")} cabeças, ${((Date.now() - comecou) / 60_000).toFixed(1)} min`,
);
if (falhas.length > 0) {
  console.log("dias que falharam (rode de novo, o script pula o que já entrou):");
  for (const f of falhas) console.log(`  ${f.dia}  ${f.erro.slice(0, 100)}`);
}
