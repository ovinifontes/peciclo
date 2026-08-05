"use server";

import { revalidatePath } from "next/cache";
import { criarClienteAdmin } from "@/lib/admin-db";
import { exigirAdmin } from "@/lib/dal";

/**
 * Ações da administração.
 *
 * TODA função aqui chama `exigirAdmin()` na PRIMEIRA linha. Não é zelo
 * decorativo: uma Server Action é uma requisição HTTP à própria rota, o layout
 * do segmento não roda antes dela, e o formulário que a dispara pode ser
 * forjado. Quem só protegesse a tela deixaria a porta dos fundos aberta.
 *
 * Todas usam a chave secreta (`admin-db.ts`), que ignora o RLS por completo —
 * então a única barreira entre um cliente comum e o banco inteiro é a linha de
 * cima.
 *
 * Nenhuma ação escreve a coluna `papel`: não existe promover nem rebaixar pela
 * interface. Trocar papel é operação de banco, feita à mão, de propósito.
 */

/** ~100 anos. O formato é o de duração do Go; `none` levanta o bloqueio. */
const BLOQUEIO_LONGO = "876000h";

type Status = "ativo" | "suspenso" | "cancelado";

/** Mesmo formato que a Evolution usa: DDI+DDD+número, só dígitos. */
function soDigitos(valor: FormDataEntryValue | null): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function texto(valor: FormDataEntryValue | null): string {
  return String(valor ?? "").trim();
}

export async function criarCliente(formData: FormData) {
  await exigirAdmin();

  const email = texto(formData.get("email"));
  const senha = String(formData.get("senha") ?? "");
  const nome = texto(formData.get("nome"));
  const telefone = soDigitos(formData.get("telefone"));

  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // criado pelo dono: não faz sentido pedir confirmação
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário: ${error?.message ?? "sem usuário na resposta"}`);
  }

  const { error: erroPerfil } = await admin.from("peciclo_perfis").insert({
    id: data.user.id,
    nome,
    telefone_whatsapp: telefone || null,
    papel: "cliente",
    status: "ativo",
  });
  if (erroPerfil) {
    // Sem perfil, a conta no Auth loga e não vê nada — um fantasma que ninguém
    // consegue administrar pela tela. Desfaz.
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`Falha ao criar perfil: ${erroPerfil.message}`);
  }

  revalidatePath("/admin");
}

/**
 * Suspensão e cancelamento em DUAS camadas, e a ordem importa pouco mas as
 * duas importam muito:
 *
 * - `ban_duration` no Auth impede entrar de novo e impede o refresh token
 *   renovar a sessão que já existe;
 * - `status` no banco corta o acesso ao dado AGORA, porque `peciclo_e_ativo()`
 *   é consultada a cada leitura e o `dal.ts` relê o perfil a cada requisição.
 *
 * Só o bloqueio no Auth deixaria a sessão aberta valendo até o access token
 * expirar — até uma hora de acesso depois de suspenso.
 */
async function mudarStatus(id: string, status: Status) {
  const eu = await exigirAdmin();

  // Trava contra o auto-tranco. Suspender ou cancelar a própria conta bloqueia
  // o Auth do admin: ele não entra mais, e como só o admin vê esta tela, não há
  // nenhum caminho pela interface para desfazer — só SQL direto no banco.
  if (id === eu.id && status !== "ativo") {
    throw new Error(
      "Um administrador não pode suspender nem cancelar a própria conta.",
    );
  }

  const admin = criarClienteAdmin();

  const { error: erroBloqueio } = await admin.auth.admin.updateUserById(id, {
    ban_duration: status === "ativo" ? "none" : BLOQUEIO_LONGO,
  });
  if (erroBloqueio) throw new Error(`Falha no bloqueio: ${erroBloqueio.message}`);

  const { error } = await admin
    .from("peciclo_perfis")
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Falha ao mudar status: ${error.message}`);

  revalidatePath("/admin");
}

export async function suspender(id: string) {
  await mudarStatus(id, "suspenso");
}

export async function reativar(id: string) {
  await mudarStatus(id, "ativo");
}

export async function cancelar(id: string) {
  await mudarStatus(id, "cancelado");
}

export async function editarTelefone(formData: FormData) {
  await exigirAdmin();

  const id = texto(formData.get("id"));
  const telefone = soDigitos(formData.get("telefone"));

  const admin = criarClienteAdmin();
  const { error } = await admin
    .from("peciclo_perfis")
    .update({
      telefone_whatsapp: telefone || null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Falha ao editar telefone: ${error.message}`);

  revalidatePath("/admin");
}

export async function trocarSenha(formData: FormData) {
  await exigirAdmin();

  const id = texto(formData.get("id"));
  const senha = String(formData.get("senha") ?? "");

  const admin = criarClienteAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) throw new Error(`Falha ao trocar senha: ${error.message}`);

  revalidatePath("/admin");
}
