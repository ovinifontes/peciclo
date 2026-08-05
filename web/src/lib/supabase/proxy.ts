import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renova a sessão do Supabase a cada requisição.
 *
 * O que esta função NÃO faz: autorização. Ela não olha papel nem status do
 * usuário. O desvio para `/login` abaixo é conveniência de navegação — quem
 * corta o acesso ao dado é a camada de dados server-only, que reverifica
 * quem é o usuário em toda página e toda ação (CVE-2025-29927: checagem
 * feita só no proxy pode ser burlada por cabeçalho HTTP).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Sem estes cabeçalhos (Cache-Control/no-store), um CDN pode cachear
          // a resposta com Set-Cookie e servir a sessão de um usuário a outro.
          Object.entries(headers ?? {}).forEach(([chave, valor]) =>
            supabaseResponse.headers.set(chave, valor),
          );
        },
      },
    },
  );

  // Não coloque NADA entre createServerClient e getClaims: a doc do Supabase
  // avisa que isso causa usuários deslogados aleatoriamente.
  const { data } = await supabase.auth.getClaims();
  const usuario = data?.claims;

  const publica = ["/login", "/auth"].some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  if (!usuario && !publica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const desvio = NextResponse.redirect(url);
    // Trocar de resposta sem levar os cookies junto perde o que o Supabase
    // acabou de escrever (tipicamente a limpeza de uma sessão expirada).
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => desvio.cookies.set(cookie));
    return desvio;
  }

  return supabaseResponse;
}
