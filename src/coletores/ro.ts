import type { AgregadoMensal } from "../tipos.js";

const PAGINA_IDARON = "https://www.idaron.ro.gov.br/index.php/relatorios-e-formularios/";

// Cluster real do Power BI (o host "-redirect" não aceita POST direto; o app
// resolve para "-api"). Estável para a região brazil-south deste relatório.
const CLUSTER = "https://wabi-brazil-south-api.analysis.windows.net";
const QUERYDATA = `${CLUSTER}/public/reports/querydata?synchronous=true`;

// Identificadores do relatório publicado (não são segredos; mudam só se o
// IDARON republicar o painel — nesse caso a resource key também muda e a task
// verificar-fontes alerta).
const RESOURCE_KEY_PADRAO = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";
const MODEL_ID = 9025931;
const DATASET_ID = "cca4f28f-5942-42fe-8e7d-88e5ca980c27";
const REPORT_ID = "f4c7854f-2b8b-4af9-9683-a4a9279eb6e8";
const VISUAL_ID = "b4f31856810fd43c5e54";

const ENTIDADE = "vw_DASHBOARD_GTA_ESTRATIFICACAO_SITE";
const ID_ESPECIE_BOVINO = 1; // confirmado: soma das faixas = total de RO da planilha manual

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
 * Redescobre o link do relatório na página do IDARON. Se o órgão republicar o
 * relatório a chave muda; sem esta verificação a coleta pararia em silêncio.
 */
export async function descobrirRelatorio(): Promise<string | null> {
  const resposta = await fetch(PAGINA_IDARON, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) return null;
  const html = await resposta.text();
  const achado = html.match(/https:\/\/app\.powerbi\.com\/view\?r=[A-Za-z0-9%._-]+/);
  return achado?.[0] ?? null;
}

const coluna = (p: string) => ({ Column: { Expression: { SourceRef: { Source: "v" } }, Property: p } });
const filtroIgual = (p: string, valor: string) => ({
  Condition: { In: { Expressions: [coluna(p)], Values: [[{ Literal: { Value: valor } }]] } },
});

/**
 * Monta a SemanticQuery do Power BI: soma de animais por faixa etária (que já
 * embute o sexo no sufixo " F"/" M"), para bovino + abate no mês pedido.
 */
export function montarConsulta(ano: number, mes: number): unknown {
  const query = {
    Version: 2,
    From: [{ Name: "v", Entity: ENTIDADE, Type: 0 }],
    Select: [
      { ...coluna("FAIXA_ETARIA_PERSONALIZADA"), Name: "faixa" },
      {
        Aggregation: {
          Expression: { Column: { Expression: { SourceRef: { Source: "v" } }, Property: "QUANTIDADE" } },
          Function: 0,
        },
        Name: "Sum",
      },
    ],
    Where: [
      filtroIgual("ANO", `${ano}L`),
      filtroIgual("MES", `${mes}L`),
      filtroIgual("DS_FINALIDADE", "'Abate'"),
      filtroIgual("ID_ESPECIE", `${ID_ESPECIE_BOVINO}L`),
    ],
  };

  return {
    version: "1.0.0",
    queries: [
      {
        Query: {
          Commands: [
            {
              SemanticQueryDataShapeCommand: {
                Query: query,
                Binding: {
                  Primary: { Groupings: [{ Projections: [0, 1] }] },
                  DataReduction: { DataVolume: 4, Primary: { Window: { Count: 5000 } } },
                  Version: 1,
                },
              },
            },
          ],
        },
        QueryId: "",
        ApplicationContext: {
          DatasetId: DATASET_ID,
          Sources: [{ ReportId: REPORT_ID, VisualId: VISUAL_ID }],
        },
      },
    ],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
}

export interface TotaisRo {
  femeas: number;
  machos: number;
}

/**
 * Decodifica a resposta DSR do Power BI e soma por sexo. Cada linha é uma
 * faixa etária ("13 a 24 meses F", "36+ meses M", ...); o sufixo " F"/" M"
 * indica o sexo. Trata os bitmasks R (repetição) e Ø (nulo) do formato DSR.
 */
export function parsearRespostaPowerBi(json: unknown): TotaisRo {
  const data = (json as any)?.results?.[0]?.result?.data;
  const linhas = data?.dsr?.DS?.[0]?.PH?.[0]?.DM0;
  if (!Array.isArray(linhas)) {
    const erro = (json as any)?.results?.[0]?.result?.data?.dsr?.DataShapes?.[0]?.["odata.error"];
    throw new Error(`Resposta do Power BI sem dados${erro ? ": " + JSON.stringify(erro.message?.value ?? erro) : ""}`);
  }

  let femeas = 0;
  let machos = 0;
  let anterior: unknown[] = [];

  for (const linha of linhas) {
    const C = (linha.C ?? []) as unknown[];
    const R = (linha.R ?? 0) as number;
    const nulos = (linha["Ø"] ?? 0) as number;
    const valores: unknown[] = [];
    let ci = 0;
    for (let i = 0; i < 2; i++) {
      if (R & (1 << i)) valores[i] = anterior[i];
      else if (nulos & (1 << i)) valores[i] = null;
      else valores[i] = C[ci++];
    }
    anterior = valores;

    const categoria = String(valores[0] ?? "");
    const quantidade = Number(valores[1]) || 0;
    if (categoria.endsWith(" F")) femeas += quantidade;
    else if (categoria.endsWith(" M")) machos += quantidade;
  }

  return { femeas, machos };
}

/** Consulta o abate bovino de RO para um mês. Devolve os agregados por sexo. */
export async function coletarRo(args: {
  ano: number;
  mes: number;
  chaveRecurso: string;
}): Promise<AgregadoMensal[]> {
  const resposta = await fetch(QUERYDATA, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "X-PowerBI-ResourceKey": args.chaveRecurso,
    },
    body: JSON.stringify(montarConsulta(args.ano, args.mes)),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resposta.ok) throw new Error(`Power BI respondeu HTTP ${resposta.status}`);

  const { femeas, machos } = parsearRespostaPowerBi(await resposta.json());

  // Mês sem dados ainda (futuro ou não publicado): não gravar zeros.
  if (femeas === 0 && machos === 0) return [];

  return [
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "FEMEA", quantidade: femeas },
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "MACHO", quantidade: machos },
  ];
}
