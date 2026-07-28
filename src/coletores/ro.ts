import type { AgregadoMensal } from "../tipos.js";

const PAGINA_IDARON = "https://www.idaron.ro.gov.br/index.php/relatorios-e-formularios/";
const CLUSTER = "https://wabi-brazil-south-redirect.analysis.windows.net";

/** Erro para quando a query do Power BI ainda não foi capturada (ver coletarRo). */
export class ConsultaNaoConfiguradaError extends Error {
  constructor() {
    super(
      "A query SemanticQuery do Power BI do IDARON ainda não foi capturada. " +
        "Rode a captura num ambiente com acesso a *.analysis.windows.net e preencha montarConsulta().",
    );
    this.name = "ConsultaNaoConfiguradaError";
  }
}

/** Decodifica a resource key pública embutida no parâmetro `r=` da URL. */
export function extrairChaveRecurso(url: string): string | null {
  const r = new URL(url).searchParams.get("r");
  if (!r) return null;
  try {
    const json = JSON.parse(Buffer.from(r, "base64").toString("utf8")) as { k?: string };
    return json.k ?? null;
  } catch {
    return null;
  }
}

/**
 * Redescobre o link do relatório na página do IDARON.
 * Se o órgão republicar o relatório a chave muda, e sem esta verificação a
 * coleta pararia silenciosamente. A página WordPress é acessível por HTTP puro.
 */
export async function descobrirRelatorio(): Promise<string | null> {
  const resposta = await fetch(PAGINA_IDARON, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) return null;
  const html = await resposta.text();
  const achado = html.match(/https:\/\/app\.powerbi\.com\/view\?r=[A-Za-z0-9%._-]+/);
  return achado?.[0] ?? null;
}

export interface TotaisRo {
  femeas: number;
  machos: number;
}

/**
 * Extrai os totais do formato DSR do Power BI. Cada linha do resultado é um
 * objeto com um array "C" cujo ÚLTIMO elemento numérico é a medida (a
 * quantidade); os elementos anteriores são índices de categoria. Coletamos
 * uma medida por linha, na ordem em que aparecem — para um resultado de duas
 * linhas (fêmea, macho) isso dá [fêmeas, machos].
 *
 * A ORDEM das linhas depende da query capturada; validar na captura real que
 * a primeira linha é fêmea. Sem acesso ao cluster daqui, o contrato só é
 * confirmável no ambiente de deploy.
 */
export function parsearRespostaPowerBi(json: unknown): TotaisRo {
  const medidas: number[] = [];

  const percorrer = (no: unknown): void => {
    if (Array.isArray(no)) {
      for (const item of no) percorrer(item);
      return;
    }
    if (no && typeof no === "object") {
      const obj = no as Record<string, unknown>;
      if (Array.isArray(obj.C)) {
        const numeros = obj.C.filter((v): v is number => typeof v === "number");
        const ultima = numeros.at(-1);
        if (ultima !== undefined) medidas.push(ultima);
      }
      for (const valor of Object.values(obj)) percorrer(valor);
    }
  };

  percorrer(json);

  if (medidas.length < 2) {
    throw new Error(`Resposta do Power BI sem os totais esperados (${medidas.length} medidas)`);
  }
  const [femeas, machos] = medidas as [number, number];
  return { femeas, machos };
}

/**
 * Corpo SemanticQuery, parametrizado por ano e mês. PENDENTE DE CAPTURA:
 * o corpo real precisa ser interceptado num ambiente com acesso ao cluster
 * (o de deploy do Trigger.dev, ou a máquina do operador), abrindo o relatório
 * e acionando os slicers BOVINO / ABATE / mês / ano. Ver o script de descoberta.
 */
function montarConsulta(_ano: number, _mes: number): unknown {
  throw new ConsultaNaoConfiguradaError();
}

export async function coletarRo(args: {
  ano: number;
  mes: number;
  chaveRecurso: string;
}): Promise<AgregadoMensal[]> {
  const resposta = await fetch(`${CLUSTER}/public/reports/querydata?synchronous=true`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "x-powerbi-resourcekey": args.chaveRecurso,
    },
    body: JSON.stringify(montarConsulta(args.ano, args.mes)),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resposta.ok) throw new Error(`Power BI respondeu HTTP ${resposta.status}`);

  const { femeas, machos } = parsearRespostaPowerBi(await resposta.json());
  return [
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "FEMEA", quantidade: femeas },
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "MACHO", quantidade: machos },
  ];
}
