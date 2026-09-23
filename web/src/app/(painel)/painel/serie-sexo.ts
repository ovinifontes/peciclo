import type { UF } from "../../../../../src/tipos";

/**
 * Série somada por SEXO, para as visões Área e 100%.
 *
 * As visões por estado desenham uma série por UF; estas duas somam os estados
 * selecionados e separam macho de fêmea. Por isso a régua de honestidade muda,
 * e é esta função que a aplica.
 *
 * Importa `UF` por caminho relativo, e não pelo atalho `@/`, para o teste da
 * raiz conseguir carregar este módulo sem o resolvedor do Next.
 */

export interface CelulaSexo {
  femeas: number | null;
  machos: number | null;
}

/** Uma linha crua: um balde (mês ou dia), um estado, os dois sexos. */
export interface EntradaSexo {
  /** Rótulo do eixo X, já pronto ("07/26" ou "15/08"). */
  rotulo: string;
  /** Chave de ordenação estável ("2026-07", "2026-08-15"). */
  chave: string;
  uf: UF;
  celula: CelulaSexo;
}

export interface PontoSexo {
  rotulo: string;
  chave: string;
  femeas: number;
  machos: number;
  /** 0 a 100, com uma casa. Sempre existe: o balde só entra completo. */
  pctFemeas: number;
}

/**
 * Soma os estados ativos por balde, mantendo só os baldes COMPLETOS.
 *
 * Completo = todos os estados selecionados publicaram os dois sexos naquele
 * balde. É mais estrito que a regra das visões por estado, que mantém o mês se
 * QUALQUER estado tiver dado — e por um motivo que só aparece ao somar: com 3
 * estados selecionados e só 1 publicado, a barra somada cairia a um terço.
 * Numa série por estado isso se lê (a linha do estado ausente some); numa barra
 * empilhada única, lê-se como o mercado desabando. Seria um degrau inventado.
 *
 * O preço é que a série somada termina no último balde que TODOS fecharam, e
 * pode ficar mais curta que a das outras visões. É o mesmo preço que o
 * consolidado do ciclo já paga, pela mesma razão.
 */
export function serieSomadaPorSexo(entradas: EntradaSexo[], ufs: UF[]): PontoSexo[] {
  if (ufs.length === 0) return [];

  const baldes = new Map<string, { rotulo: string; porUf: Map<UF, CelulaSexo> }>();
  for (const e of entradas) {
    if (!ufs.includes(e.uf)) continue;
    const balde = baldes.get(e.chave) ?? { rotulo: e.rotulo, porUf: new Map<UF, CelulaSexo>() };
    // Mesmo estado repetido no mesmo balde (a série crua vem por sexo): soma.
    const atual = balde.porUf.get(e.uf);
    balde.porUf.set(
      e.uf,
      atual
        ? {
            femeas: somar(atual.femeas, e.celula.femeas),
            machos: somar(atual.machos, e.celula.machos),
          }
        : e.celula,
    );
    baldes.set(e.chave, balde);
  }

  const pontos: PontoSexo[] = [];
  for (const [chave, balde] of [...baldes].sort((a, b) => a[0].localeCompare(b[0]))) {
    const completo = ufs.every((uf) => {
      const c = balde.porUf.get(uf);
      return c !== undefined && c.femeas !== null && c.machos !== null;
    });
    if (!completo) continue;

    let femeas = 0;
    let machos = 0;
    for (const uf of ufs) {
      const c = balde.porUf.get(uf)!;
      femeas += c.femeas!;
      machos += c.machos!;
    }
    const total = femeas + machos;
    if (total <= 0) continue;

    pontos.push({
      rotulo: balde.rotulo,
      chave,
      femeas,
      machos,
      pctFemeas: Number(((femeas / total) * 100).toFixed(1)),
    });
  }
  return pontos;
}

function somar(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
