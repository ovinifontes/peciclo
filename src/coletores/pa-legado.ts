/**
 * Leitor do arquivo HISTÓRICO do PA — "GTAs 23-24 dados públicos.xlsx".
 *
 * A ADEPARA mudou o formato no meio do caminho e os dois convivem no mesmo
 * Drive. O atual (2025/2026, lido por `pa.ts`) é uma linha por GTA com colunas
 * `finalidade`, `taxonomia`, `data_emissao`… O histórico (2022 a 2024) é
 * FORMATO LARGO: oito colunas de faixa etária × sexo na mesma linha, data em
 * dd/MM/yyyy e finalidade em capitalização de frase ("Abate", não "ABATE").
 *
 * Por isso um leitor separado, e não um `if` dentro do outro: são dois
 * contratos de arquivo diferentes, e misturá-los faria cada mudança futura de
 * um layout arriscar o outro.
 *
 * Só agrega por (ano, mês, sexo) — o que a planilha precisa. Não produz GTA a
 * GTA porque o arquivo cobre dois anos em 74 MB e o detalhe histórico não tem
 * uso hoje; se um dia tiver, o arquivo continua lá.
 */
import { lerLinhas, textoCelula } from "../xlsx/leitor.js";
import type { AgregadoMensal, Sexo } from "../tipos.js";

/** Cabeçalho do formato largo; o leitor acha a linha por esta string. */
const MARCADOR = "NomeFinalidade";

/**
 * As oito colunas de contagem, por sexo. O nome da última faixa é truncado
 * pela ADEPARA de formas diferentes ("acima 36", "acima 3…"), então o
 * casamento é por PREFIXO, nunca por igualdade.
 */
const PREFIXOS: Array<{ prefixo: string; sexo: Sexo }> = [
  { prefixo: "bovinos machos", sexo: "MACHO" },
  { prefixo: "bovinos femeas", sexo: "FEMEA" },
  { prefixo: "bovinos fêmeas", sexo: "FEMEA" },
];

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "22/11/2023" → { ano: 2023, mes: 11 }, ou null se não for data reconhecível. */
export function competenciaDaData(bruto: unknown): { ano: number; mes: number } | null {
  if (bruto instanceof Date) {
    return { ano: bruto.getUTCFullYear(), mes: bruto.getUTCMonth() + 1 };
  }
  const achado = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(bruto ?? "").trim());
  if (!achado) return null;
  const mes = Number(achado[2]);
  const ano = Number(achado[3]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return { ano, mes };
}

/** Descobre quais colunas contam animais e de que sexo cada uma é. */
export function mapearColunasDeSexo(colunas: Record<string, number>): Array<{ indice: number; sexo: Sexo }> {
  const saida: Array<{ indice: number; sexo: Sexo }> = [];
  for (const [nome, indice] of Object.entries(colunas)) {
    const limpo = semAcento(nome);
    const casou = PREFIXOS.find((p) => limpo.startsWith(semAcento(p.prefixo)));
    if (casou) saida.push({ indice, sexo: casou.sexo });
  }
  return saida;
}

/**
 * Soma o abate bovino por (ano, mês, sexo) no arquivo histórico.
 *
 * Igualdade exata em "abate" depois de normalizar: "Abate Sanitário" e
 * "Sacrifício" são determinação sanitária, não decisão do pecuarista — a mesma
 * regra que `lerAbateMensal` aplica no banco.
 */
export async function agregarPaLegado(
  caminho: string,
  anos: number[],
): Promise<{ agregados: AgregadoMensal[]; linhasLidas: number; linhasDeAbate: number }> {
  const acumulado = new Map<string, AgregadoMensal>();
  let linhasLidas = 0;
  let linhasDeAbate = 0;
  let colunasDeSexo: Array<{ indice: number; sexo: Sexo }> | null = null;

  for await (const { valores, colunas } of lerLinhas(caminho, { marcadorCabecalho: MARCADOR })) {
    if (colunasDeSexo === null) {
      colunasDeSexo = mapearColunasDeSexo(colunas);
      if (colunasDeSexo.length === 0) {
        throw new Error(
          `PA legado: nenhuma coluna de contagem por sexo no cabeçalho (${Object.keys(colunas).join(", ")})`,
        );
      }
    }
    linhasLidas++;

    if (semAcento(textoCelula(valores[colunas[MARCADOR]!])) !== "abate") continue;
    if (!semAcento(textoCelula(valores[colunas["DescEspAnimal"]!])).startsWith("bovino")) continue;

    const competencia = competenciaDaData(valores[colunas["Data Emissão da GTA"]!]);
    if (!competencia || !anos.includes(competencia.ano)) continue;
    linhasDeAbate++;

    for (const { indice, sexo } of colunasDeSexo) {
      const quantidade = Number(textoCelula(valores[indice])) || 0;
      if (quantidade <= 0) continue;
      const chave = `${competencia.ano}-${competencia.mes}-${sexo}`;
      const atual = acumulado.get(chave);
      if (atual) atual.quantidade += quantidade;
      else {
        acumulado.set(chave, {
          uf: "PA",
          ano: competencia.ano,
          mes: competencia.mes,
          finalidade: "ABATE",
          sexo,
          quantidade,
        });
      }
    }
  }

  const agregados = [...acumulado.values()].sort(
    (a, b) => a.ano - b.ano || a.mes - b.mes || a.sexo.localeCompare(b.sexo),
  );
  return { agregados, linhasLidas, linhasDeAbate };
}
