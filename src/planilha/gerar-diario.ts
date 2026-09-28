import ExcelJS from "exceljs";
import { lerAbateDiarioTudo } from "../dados/diario.js";
import { agruparDias, diaSemana, type DiaUf } from "../diario/serie.js";
import { UFS_VISIVEIS, type UF } from "../tipos.js";

/**
 * A planilha do ABATE DIÁRIO por estado — a mesma tabela que o painel mostra,
 * inteira e em XLSX.
 *
 * Por que existe: na tela a tabela mostra 60 dias e o "Exportar imagem" a
 * fotografa; a foto corta estado no meio quando há coluna demais, e ninguém
 * faz conta em cima de um PNG. Quem recebe isto quer a série para abrir no
 * Excel, e aí o recorte de 60 dias deixa de fazer sentido: vai tudo.
 *
 * Formato: uma linha por DIA, do mais recente para o mais antigo (quem abre
 * quer ver ontem, não janeiro), e um bloco de três colunas por estado —
 * fêmeas, machos e total. A % de fêmeas é FÓRMULA, não valor congelado: quem
 * filtra ou apaga linha no Excel vê a conta continuar batendo.
 */

/** Fêmeas, Machos, Total e % Fêmeas — cada estado ocupa quatro colunas. */
const COLUNAS_POR_ESTADO = 4;
/** Quantas dessas colunas vêm da grade; a quarta é fórmula. */
const COLUNAS_DE_DADO = 3;

/** A primeira coluna de um estado (1-based), dado o índice dele na lista. */
function colunaDoEstado(i: number): number {
  // Coluna 1 = Dia, coluna 2 = Dia da semana; os estados começam na 3.
  return 3 + i * COLUNAS_POR_ESTADO;
}

export interface LinhaDiaPlanilha {
  /** ISO YYYY-MM-DD — o que vai na célula, como data de verdade. */
  data: string;
  diaSemana: string;
  /** Por estado, na ordem de `ufs`: fêmeas, machos e total, ou null. */
  valores: Array<number | null>;
}

/**
 * Monta a grade da planilha a partir dos dias já agrupados.
 *
 * Estados: só os que TÊM dado diário, na ordem de `UFS_VISIVEIS`. Coluna
 * inteira de vazio seria mobília, não informação — a mesma regra da tela.
 *
 * Dia sem linha de um estado vira `null`, nunca zero: ausência de dado não é
 * abate zero provado, e um zero aqui entraria nas médias de quem abrir.
 */
export function montarGradeDiaria(dias: DiaUf[]): {
  ufs: UF[];
  linhas: LinhaDiaPlanilha[];
} {
  const comDado = new Set(dias.map((d) => d.uf));
  const ufs = UFS_VISIVEIS.filter((uf) => comDado.has(uf));

  const porDia = new Map<string, Map<UF, DiaUf>>();
  for (const dia of dias) {
    const estados = porDia.get(dia.data) ?? new Map<UF, DiaUf>();
    estados.set(dia.uf, dia);
    porDia.set(dia.data, estados);
  }

  const datas = [...porDia.keys()].sort().reverse();
  const linhas = datas.map((data) => {
    const estados = porDia.get(data)!;
    const valores: Array<number | null> = [];
    for (const uf of ufs) {
      const dia = estados.get(uf);
      valores.push(dia?.femeas ?? null, dia?.machos ?? null, dia?.total ?? null);
    }
    return { data, diaSemana: diaSemana(data), valores };
  });

  return { ufs, linhas };
}

/** Escreve a aba "Abate diário" na pasta de trabalho recebida. */
export function escreverAbaDiaria(
  planilha: ExcelJS.Workbook,
  grade: { ufs: UF[]; linhas: LinhaDiaPlanilha[] },
): void {
  const aba = planilha.addWorksheet("Abate diário");

  const linhaEstados: Array<string | null> = [null, null];
  for (const uf of grade.ufs) {
    linhaEstados.push(uf, ...Array<null>(COLUNAS_POR_ESTADO - 1).fill(null));
  }
  aba.addRow(linhaEstados);
  aba.addRow([
    "Dia",
    "Dia da semana",
    ...grade.ufs.flatMap(() => ["Fêmeas", "Machos", "Total", "% Fêmeas"]),
  ]);

  for (const linha of grade.linhas) {
    // Data como Date, não texto: quem abrir consegue ordenar, filtrar por mês
    // e usar na fórmula. Meio-dia UTC evita que o fuso do Excel puxe o dia
    // para trás em quem está a oeste de Greenwich — como o Brasil inteiro.
    const celulas: Array<Date | string | number | null> = [new Date(`${linha.data}T12:00:00Z`), linha.diaSemana];
    for (let i = 0; i < grade.ufs.length; i++) {
      // A % fica NULA aqui e vira fórmula logo abaixo, mas o lugar dela na
      // linha tem de existir agora — senão o próximo estado anda uma coluna.
      celulas.push(...linha.valores.slice(i * COLUNAS_DE_DADO, (i + 1) * COLUNAS_DE_DADO), null);
    }
    aba.addRow(celulas);
  }

  // A % de fêmeas é FÓRMULA, a quarta coluna do bloco de cada estado — no
  // mesmo lugar em que ela aparece na tela. Fórmula e não valor congelado:
  // filtrar ou apagar linha no Excel mantém a conta certa, e quem confere vê
  // de onde o número saiu.
  grade.ufs.forEach((_, i) => {
    const femeas = letraColuna(colunaDoEstado(i));
    const total = letraColuna(colunaDoEstado(i) + 2);
    const colPct = colunaDoEstado(i) + 3;
    for (let l = 3; l <= grade.linhas.length + 2; l++) {
      aba.getCell(l, colPct).value = {
        // IFERROR e não IF(total>0): total vazio vira divisão por zero, e o
        // vazio diz "não publicou" em vez de "abateu 0% de fêmeas".
        formula: `IFERROR(${femeas}${l}/${total}${l},"")`,
        date1904: false,
      };
    }
  });

  // mescla o rótulo de cada estado sobre o bloco dele
  grade.ufs.forEach((_, i) => {
    const coluna = colunaDoEstado(i);
    aba.mergeCells(1, coluna, 1, coluna + COLUNAS_POR_ESTADO - 1);
  });

  aba.getRow(1).font = { bold: true };
  aba.getRow(2).font = { bold: true };
  aba.getColumn(1).width = 12;
  aba.getColumn(1).numFmt = "dd/mm/yyyy";
  aba.getColumn(2).width = 16;
  for (let i = 0; i < grade.ufs.length; i++) {
    const inicio = colunaDoEstado(i);
    for (let c = inicio; c < inicio + COLUNAS_POR_ESTADO; c++) {
      // A quarta coluna do bloco é a porcentagem.
      const ehPct = c === inicio + 3;
      aba.getColumn(c).width = ehPct ? 11 : 12;
      aba.getColumn(c).numFmt = ehPct ? "0.0%" : "#,##0";
    }
  }
  // Cabeçalho preso: com centenas de dias, rolar sem isto é perder a coluna.
  aba.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
}

/** Converte um índice de coluna 1-based em letra do Excel (1 = A, 27 = AA). */
export function letraColuna(indice: number): string {
  let n = indice;
  let saida = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    saida = String.fromCharCode(65 + resto) + saida;
    n = Math.floor((n - 1) / 26);
  }
  return saida;
}

/** A nota de método, na segunda aba — a mesma que está embaixo da tabela. */
function escreverAbaLeiaMe(planilha: ExcelJS.Workbook, dias: number, hoje: string): void {
  const aba = planilha.addWorksheet("Leia-me");
  aba.getColumn(1).width = 110;
  const linhas = [
    "Abate diário por estado — Peciclo",
    "",
    `Série completa até ${hoje}: ${dias} dias com dado, do mais recente para o mais antigo.`,
    "",
    "Cabeças abatidas com finalidade ABATE. Abate sanitário e sacrifício ficam de fora,",
    "porque não são decisão econômica do pecuarista.",
    "",
    "O dia de HOJE não aparece: ainda está em coleta e sairia menor do que foi.",
    "Os 7 dias mais recentes ainda são reprocessados pela recoleta e podem mexer um",
    "pouco antes de firmar.",
    "",
    "Célula vazia é estado que não publicou aquele dia — não é abate zero.",
    "Fim de semana quase não abate: o serrote é do calendário, não do mercado.",
    "",
    "peciclo.com.br",
  ];
  for (const texto of linhas) aba.addRow([texto]);
  aba.getRow(1).font = { bold: true, size: 14 };
}

/** A planilha pronta, em memória — quem chama envia ou arquiva. */
export async function gerarPlanilhaDiaria(hoje: string): Promise<Buffer> {
  const linhas = await lerAbateDiarioTudo(hoje);
  const dias = agruparDias(linhas);
  const grade = montarGradeDiaria(dias);

  const planilha = new ExcelJS.Workbook();
  planilha.creator = "Peciclo";
  planilha.created = new Date();
  escreverAbaDiaria(planilha, grade);
  escreverAbaLeiaMe(planilha, grade.linhas.length, hoje);

  return Buffer.from(await planilha.xlsx.writeBuffer());
}
