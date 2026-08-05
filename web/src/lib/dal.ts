import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Perfil = {
  id: string;
  nome: string;
  papel: "cliente" | "admin";
  status: "ativo" | "suspenso" | "cancelado";
};

/**
 * Única porta de autorização do app. Nenhuma página, layout ou ação decide
 * acesso por conta própria: todas passam por aqui, porque o proxy sozinho
 * não protege nada (CVE-2025-29927).
 */

/**
 * Identidade do usuário autenticado, ou null.
 *
 * getClaims valida a assinatura do JWT. Nunca use getSession no servidor: ele
 * devolve o que estiver no cookie, sem verificar quem assinou.
 */
export const obterUsuarioId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

/** cache(): uma verificação por requisição, mesmo chamada em vários lugares. */
export const obterPerfil = cache(async (): Promise<Perfil | null> => {
  const id = await obterUsuarioId();
  if (!id) return null;

  const supabase = await createClient();
  const { data: perfil } = await supabase
    .from("peciclo_perfis")
    .select("id, nome, papel, status")
    .eq("id", id)
    .maybeSingle();

  return (perfil as Perfil | null) ?? null;
});

export const exigirClienteAtivo = cache(async (): Promise<Perfil> => {
  const perfil = await obterPerfil();

  if (!perfil) {
    // O Auth deste projeto Supabase é compartilhado com outros sistemas: dá
    // para ter sessão válida e nenhum perfil no Peciclo. Mandar essa pessoa
    // para /login faria um laço — ela entra, o login manda ao painel, o
    // painel manda ao login. Sem perfil mas com sessão, a conversa é a
    // mesma de uma conta inativa: fale com quem administra o acesso.
    const autenticado = await obterUsuarioId();
    redirect(autenticado ? "/conta-inativa" : "/login");
  }

  if (perfil.status !== "ativo") redirect("/conta-inativa");
  return perfil;
});

/**
 * notFound() em vez de forbidden(): forbidden() ainda é experimental no
 * Next 16.3 e a doc não recomenda em produção.
 */
export const exigirAdmin = cache(async (): Promise<Perfil> => {
  const perfil = await exigirClienteAtivo();
  if (perfil.papel !== "admin") notFound();
  return perfil;
});
