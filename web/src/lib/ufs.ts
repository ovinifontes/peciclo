/**
 * Ponte CLIENTE-SEGURA para a lista de estados visíveis.
 *
 * `lib/dados.ts` é `server-only` (usa next/headers pelo cliente do Supabase),
 * então componente de cliente não pode importar VALOR de lá — só tipo, que
 * some na compilação. Chips, tabelas e cores rodam no navegador e precisam da
 * lista de verdade, então ela passa por aqui, sem tocar em nada de servidor.
 */
export { UFS_VISIVEIS, ufVisivel } from "../../../src/tipos";
