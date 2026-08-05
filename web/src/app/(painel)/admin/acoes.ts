"use server";

import { redirect } from "next/navigation";
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
 *
 * Erro previsível (telefone torto, e-mail repetido, senha curta) volta para a
 * tela como recado; `throw` fica só para o que não era para acontecer. Um 500
 * cru na cara de quem digitou o telefone sem o DDI é defeito, não rigor.
 */

/** ~100 anos. O formato é o de duração do Go; `none` levanta o bloqueio. */
const BLOQUEIO_LONGO = "876000h";

/** O Supabase recusa senha com menos de 6; o formulário já pede 8. */
const SENHA_MINIMA = 8;

type Status = "ativo" | "suspenso" | "cancelado";

// Não exportar nada além de função assíncrona daqui: num módulo "use server"
// todo export vira endpoint, e o Next recusa o resto.
type ErroAdmin = "telefone" | "email" | "senha" | "falha";

function voltarComErro(erro: ErroAdmin): never {
  redirect(`/admin?erro=${erro}`);
}

function pronto(): never {
  // Redireciona mesmo no sucesso: sem isso, um `?erro=` da tentativa anterior
  // continuaria na barra de endereços e o recado velho seguiria na tela.
  revalidatePath("/admin");
  redirect("/admin");
}

function texto(valor: FormDataEntryValue | null): string {
  return String(valor ?? "").trim();
}

/**
 * Formato da Evolution: DDI+DDD+número, só dígitos — o mesmo `^\d{12,13}$` que
 * a coluna cobra. Quem digita "(65) 99621-0067" está certo do ponto de vista
 * humano, então a máscara sai e o 55 entra sozinho. Devolve `null` para campo
 * em branco (telefone é opcional) e `undefined` para entrada que não dá para
 * salvar.
 */
function normalizarTelefone(bruto: string): string | null | undefined {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos === "") return null;
  // 10 = fixo com DDD, 11 = celular com DDD: falta só o país.
  const completo = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  return /^\d{12,13}$/.test(completo) ? completo : undefined;
}

export async function criarCliente(formData: FormData) {
  await exigirAdmin();

  const email = texto(formData.get("email"));
  const senha = String(formData.get("senha") ?? "");
  const nome = texto(formData.get("nome"));
  const telefone = normalizarTelefone(texto(formData.get("telefone")));

  if (telefone === undefined) voltarComErro("telefone");
  if (senha.length < SENHA_MINIMA) voltarComErro("senha");

  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // criado pelo dono: não faz sentido pedir confirmação
  });
  if (error || !data.user) {
    if (error?.code === "email_exists") voltarComErro("email");
    if (error?.code === "weak_password") voltarComErro("senha");
    voltarComErro("falha");
  }

  const { error: erroPerfil } = await admin.from("peciclo_perfis").insert({
    id: data.user.id,
    nome,
    telefone_whatsapp: telefone,
    papel: "cliente",
    status: "ativo",
  });
  if (erroPerfil) {
    // Sem perfil, a conta no Auth loga e não vê nada — um fantasma que ninguém
    // consegue administrar pela tela. Desfaz.
    await admin.auth.admin.deleteUser(data.user.id);
    voltarComErro("falha");
  }

  pronto();
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
  if (erroBloqueio) voltarComErro("falha");

  const { error } = await admin
    .from("peciclo_perfis")
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) voltarComErro("falha");

  pronto();
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
  const telefone = normalizarTelefone(texto(formData.get("telefone")));
  if (telefone === undefined) voltarComErro("telefone");

  const admin = criarClienteAdmin();
  const { error } = await admin
    .from("peciclo_perfis")
    .update({
      telefone_whatsapp: telefone,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) voltarComErro("falha");

  pronto();
}

export async function trocarSenha(formData: FormData) {
  await exigirAdmin();

  const id = texto(formData.get("id"));
  const senha = String(formData.get("senha") ?? "");
  if (senha.length < SENHA_MINIMA) voltarComErro("senha");

  const admin = criarClienteAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) voltarComErro(error.code === "weak_password" ? "senha" : "falha");

  pronto();
}
