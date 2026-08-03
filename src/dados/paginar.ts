/** Tamanho de página. O PostgREST/Supabase corta em 1000 por padrão. */
const PAGINA = 1000;

/**
 * Lê uma tabela inteira em páginas.
 *
 * Sem isto, uma consulta sem `.range()` devolve no máximo 1000 linhas SEM
 * erro nenhum — e, como as leituras são ordenadas do mais antigo para o mais
 * novo, o que some é justamente o dado recente. É uma perda silenciosa: a
 * planilha sai "certa", só que sem os últimos meses.
 */
export async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  rotulo: string,
): Promise<T[]> {
  const tudo: T[] = [];

  for (let pagina = 0; ; pagina++) {
    const de = pagina * PAGINA;
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler ${rotulo}: ${error.message}`);

    const lote = data ?? [];
    tudo.push(...lote);
    if (lote.length < PAGINA) return tudo;

    // Guarda contra laço infinito se o backend ignorar o range.
    if (pagina > 1000) throw new Error(`Paginação de ${rotulo} não terminou (excesso de páginas)`);
  }
}
