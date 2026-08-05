import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente com a chave SECRETA do Supabase.
 *
 * Esta chave ignora o RLS por completo: quem a tem lê e escreve qualquer linha
 * de qualquer tabela e qualquer arquivo do Storage. Ela existe aqui por um
 * motivo só — o bucket `peciclo_brutos` é privado e não tem política de
 * Storage para `authenticated`, então listar e baixar as planilhas exige
 * privilégio. A Task 9 (administração) reusa este mesmo módulo.
 *
 * Três regras que este arquivo carrega:
 *
 * 1. `import "server-only"` na primeira linha. Se algum dia um componente de
 *    cliente importar este módulo, direta ou transitivamente, o build QUEBRA —
 *    de propósito, antes de vazar a chave para o navegador.
 * 2. A variável se chama `SUPABASE_SECRET_KEY`, sem o prefixo `NEXT_PUBLIC_`.
 *    O prefixo faria o Next embutir o valor no pacote do navegador, que é
 *    exatamente o vazamento que a regra 1 previne.
 * 3. Nada aqui — nem erro, nem log — imprime o valor da chave. A mensagem de
 *    falha cita o NOME da variável ausente, nunca o conteúdo.
 *
 * Quem chama este cliente está fora do alcance do RLS, então a autorização
 * passa a ser responsabilidade de quem chama: toda função que o usa reverifica
 * o acesso na primeira linha (`exigirClienteAtivo` / `exigirAdmin`). Um Route
 * Handler ou uma Server Action é uma requisição direta — o layout do painel
 * não roda antes dela e não protege nada.
 */
let cliente: SupabaseClient | null = null;

export function criarClienteAdmin(): SupabaseClient {
  // Um cliente por processo: `createClient` monta o fetch e o cache interno do
  // supabase-js, e refazer isso a cada requisição é desperdício puro.
  if (cliente) return cliente;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) {
    throw new Error(
      "Ambiente incompleto: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no servidor.",
    );
  }

  cliente = createClient(url, chave, {
    // Sem sessão e sem renovação: este cliente não representa uma pessoa, e
    // guardar sessão num processo de servidor misturaria usuários.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente;
}
