# Pesquisa técnica — SaaS Peciclo (2026-08-05)
> Levantamento para a fase 2 (interface web). Cada seção traz a recomendação, os achados verificados e as armadilhas.

---

## Autenticação e multi-tenancy do peciclo com Supabase Auth: convite-só (admin cria), perfis em peciclo_perfis, suspensão em duas camadas (ban no Auth + status no RLS) e policies via função SECURITY DEFINER
**Recomendação:** Desligue "Allow new users to sign up" no dashboard, crie contas só por `auth.admin.createUser` com service_role, espelhe cada usuário em `public.peciclo_perfis` (papel/status/telefone) e libere leitura das tabelas de dados com `GRANT SELECT TO authenticated` + policy `using ((select public.peciclo_usuario_ativo()))` apoiada em função SECURITY DEFINER — suspender exige as duas camadas (ban no Auth corta o refresh, status no RLS corta o acesso a dado na hora), porque ban sozinho deixa o JWT já emitido valendo até expirar.

### Achados

ACHADO CRÍTICO NO ESTADO ATUAL (lido no repositório, não no banco)

`supabase/migrations/20260727120000_coleta_abate_schema.sql:105-107`, `supabase/migrations/20260803120000_experimental_sif_precos.sql:57-59` e `supabase/aplicar-no-sql-editor.sql:113` executam `revoke all on table ... from authenticated` nas cinco tabelas. Isso significa que **escrever policy de RLS sozinha NÃO vai funcionar**. O Postgres avalia o privilégio SQL antes da policy: sem `GRANT SELECT`, o usuário logado recebe `permission denied for table peciclo_abate_mensal` e a policy nem chega a ser considerada. Doc do Postgres, verbatim: "In addition to the SQL-standard privilege system available through GRANT, tables can have row security policies". É "além de", não "no lugar de". Todo plano de RLS aqui precisa começar por um `GRANT SELECT ... TO authenticated`.

1. DESLIGAR SIGNUP PÚBLICO — CONFIRMADO
- Dashboard: Authentication → o toggle chama-se literalmente **"Allow new users to sign up"**. Doc: "only existing users can sign in" quando desligado. (https://supabase.com/docs/guides/auth/general-configuration)
- Campo equivalente no `supabase/config.toml`: `auth.enable_signup`, default `true`. Também confirmei `auth.enable_anonymous_sign_ins` (default false), `auth.enable_manual_linking` (default false), `auth.jwt_expiry` (default 3600s, máx 604800), `auth.email.enable_confirmations` (default false). (https://supabase.com/docs/guides/local-development/cli/config)
- O `supabase/config.toml` deste projeto (linhas 1-9) tem só `project_id` e `[db] major_version = 15` — não há seção `[auth]`. Ou seja: hoje o caminho operativo é o toggle do dashboard. Adicionar `[auth]` ao config.toml só surte efeito via `supabase config push` com o projeto linkado.
- API do admin — CONFIRMADO na referência oficial (https://supabase.com/docs/reference/javascript/auth-admin-createuser): `supabase.auth.admin.createUser(attributes)`, aceitando `email`, `password`, `phone`, `email_confirm`, `phone_confirm`, `user_metadata`, `app_metadata`. Aviso verbatim da doc: "This function should only be called on a server. Never expose your service_role key in the browser."
- `email_confirm: true` é obrigatório no seu caso. Sem ele o usuário nasce não-confirmado e, dependendo de `enable_confirmations`, não loga — e você não quer mandar e-mail de confirmação para um cliente cuja conta você criou à mão.

2. MODELO DE PERFIS
`public.peciclo_perfis` com PK `uuid` referenciando `auth.users(id) on delete cascade`. Colunas: `nome`, `telefone_whatsapp`, `papel` ('admin'|'cliente'), `status` ('ativo'|'suspenso'|'cancelado'), `motivo_status`, `status_em`, `criado_em`, `atualizado_em`. DDL completo no campo de código.
- O formato do telefone segue o que o projeto já usa: `.env.example` linha 18 documenta "números em DDI+DDD+numero, só dígitos" com exemplo `5567999999999`. Coloquei o CHECK `~ '^\d{12,13}$'` para casar com a Evolution API sem precisar de conversão.
- Três estados em vez de um booleano porque o requisito distingue SUSPENDER (reversível, inadimplência) de CANCELAR (fim de relação, mas você quer preservar o histórico e o e-mail para não reciclar).
- Multi-tenancy futura: hoje o dado é global. O caminho de menor dano é adicionar depois `peciclo_perfis.conta_id uuid` e uma coluna `conta_id` nullable nas tabelas de dado, onde NULL = global. As policies que escrevi já isolam a decisão numa função, então a mudança futura é um `create or replace function` — não é reescrever 5 policies.

3. SUSPENDER DE VERDADE — os dois, e o motivo é preciso
- `ban_duration` EXISTE e está documentado em `auth.admin.updateUserById(uid, attributes)` (https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), com exemplo verbatim `'876000h'` ("100 years"). A referência oficial não lista os valores aceitos; o formato é o `time.ParseDuration` do Go — "ns", "us"/"µs", "ms", "s", "m", "h", ex. '300ms', '2h45m', '1200s' — e `'none'` levanta o ban. Isso está confirmado por resposta de Collaborator (GaryAustin1) na discussion oficial #9239, com a assinatura `ban_duration?: string | 'none'`. Não está na página de referência.
- **EFEITO PRÁTICO DO BAN**: bloqueia login novo e bloqueia a troca do refresh token (erro `user_banned`, "Invalid Refresh Token: User Banned"). NÃO revoga a sessão já aberta. O access token é um JWT autocontido e continua válido até expirar — default 3600s. A doc de sessões (https://supabase.com/docs/guides/auth/sessions) lista o que encerra sessão ("The user clicks sign out. The user changes their password... A user signs in on another device") e não inclui ban; confirma que a única checagem server-side é comparar o claim `session_id` com `auth.sessions`. Conclusão: com só o ban, um cliente suspenso continua puxando dado por até 1 hora.
- **EFEITO PRÁTICO DA FLAG NA TABELA**: instantâneo. A policy é reavaliada a cada query no Postgres, então no primeiro SELECT depois do UPDATE o cliente já não vê nada — independente do JWT dele ainda ser criptograficamente válido.
- **POR ISSO OS DOIS**: o ban é a camada de autenticação (não entra mais, não renova); o `status` é a camada de autorização (não lê mais dado, agora). Um não substitui o outro.
- Não existe, em `supabase-js`, revogar sessões de um usuário por id: `auth.admin.signOut(jwt, scope)` exige "A valid, logged-in JWT" — que o admin não tem. Reduzir `jwt_expiry` (ex. 1800s) só encurta a janela residual; não a elimina.
- Alavanca extra, NÃO documentada e NÃO testada: a issue supabase/auth#1579 relata que em versões mais recentes o `PUT /admin/users/:id` trocando senha mata a sessão atual (historicamente não matava). Se valer na sua versão do GoTrue, suspender = ban + trocar a senha por um valor aleatório + flag. Trate como bônus, não como garantia.

4. POLICIES DE RLS
Escritas no campo de código. Pontos verificados:
- `service_role` continua funcionando sem nenhuma alteração: a doc de API keys diz verbatim que ele "uses the BYPASSRLS attribute, skipping any and all Row Level Security policies you attach". O Postgres confirma: "Superusers and roles with the BYPASSRLS attribute always bypass the row security system". Os jobs do Trigger.dev (`src/dados/cliente.ts:10`, que instancia com `supabaseServiceRoleKey`) não sentem nada.
- RLS ligada sem policy = default-deny, confirmado no Postgres: "If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified" — que é exatamente o estado de hoje e o motivo de o comentário na linha 92 da migration estar correto.
- `peciclo_gta_registros` (2,3 mi de linhas) fica FORA: não dou grant nenhum. O front lê o agregado `peciclo_abate_mensal`. `peciclo_coletas` fica opcionalmente visível só para admin.
- Toda policy leva `TO authenticated`. A doc de performance do Supabase recomenda explicitamente: "Always add 'authenticated' to the approved roles instead of nothing or public" — elimina o anon antes de avaliar a lógica.

5. IDENTIFICAÇÃO DO ADMIN SEM RECURSÃO
O problema clássico: policy em `peciclo_perfis` que faz `select ... from peciclo_perfis` → `infinite recursion detected in policy for relation`.
- Solução correta: função **SECURITY DEFINER**. Ela roda com os privilégios do dono (postgres, que é dono da tabela); dono de tabela não está sujeito a RLS por padrão, então o SELECT interno não dispara as policies e a recursão não existe. Isso conversa direto com a decisão que a migration já tomou: o comentário da linha 94-95 explica que `FORCE ROW LEVEL SECURITY` foi deixado de fora de propósito — e é justamente isso que faz o padrão funcionar. Se alguém ligar `force row level security` em `peciclo_perfis` no futuro, a recursão volta.
- Detalhe de linguagem: circula na internet (post do DEV.to) a afirmação de que é preciso usar `plpgsql` porque funções `sql` são "inlined" e perdem o contexto SECURITY DEFINER. **Isso está errado.** Verifiquei no wiki oficial do PostgreSQL (Inlining_of_SQL_functions): entre as condições para inlining está "the function is not SECURITY DEFINER" e "the function has no SET clauses in its definition". Uma função `language sql security definer set search_path = ''` satisfaz as duas negativas — nunca é inlined. `language sql` é seguro e mais rápido de planejar.
- `set search_path = ''` é obrigatório (linter do Supabase, `function_search_path_mutable`) e por isso tudo dentro da função é qualificado: `public.peciclo_perfis`, `auth.uid()`.
- Alternativa via JWT: o `custom_access_token_hook` (disponível em Free e Pro, confirmado em https://supabase.com/docs/guides/auth/auth-hooks) injeta o papel no token, lido com `auth.jwt() ->> 'user_role'`; ou, mais simples, `app_metadata: { papel: 'admin' }` no createUser, lido com `auth.jwt() -> 'app_metadata' ->> 'papel'` (a doc de RLS confirma que `raw_app_meta_data` chega no JWT e que ela, ao contrário de `raw_user_meta_data`, não é editável pelo usuário). **Não recomendo o JWT como fonte de autorização aqui**: o claim é congelado no momento da emissão e fica obsoleto por até `jwt_expiry`. Você acabou de exigir suspensão que morde na hora — logo o `status` TEM que vir da tabela. Use o claim, se quiser, só para o front decidir se pinta o menu de gestão; a policy decide de verdade.

6. PERFORMANCE — `(select auth.uid())` CONFIRMADO
- Doc de troubleshooting do Supabase (rls-performance-and-best-practices-Z5Jjwv), verbatim: trocar `is_admin() or auth.uid() = user_id` por `(select is_admin()) OR (select auth.uid()) = user_id`. Explicação da própria doc: isso faz o otimizador executar um "initPlan", que "allows it to 'cache' the results versus calling the function on each row". O benchmark deles vai de 11.000ms para 10ms.
- Mecânica: `auth.uid()` é uma função `stable` que lê `current_setting('request.jwt.claims', true)`. STABLE não significa memoizada — numa expressão de filtro ela é chamada uma vez por linha. Envolver num subselect escalar sem referência externa transforma em InitPlan, avaliado uma única vez por execução da query.
- No seu caso o ganho é o mesmo para `(select public.peciclo_usuario_ativo())`: uma busca por PK em `peciclo_perfis` por query, em vez de uma por linha varrida. Em `peciclo_abate_mensal` (pequena) isso quase não pesa; se um dia expuser `peciclo_gta_registros`, a diferença é entre 1 lookup e 2,3 milhões.
- A doc também recomenda índice nas colunas usadas em policy — aqui não é necessário, porque o filtro é por PK de `peciclo_perfis`.

O QUE EU NÃO TESTEI (explicitamente)
- Não conectei no projeto `qafcxvdrrwcmnyedvyts`. Não rodei nenhum SQL, nenhum EXPLAIN, não apliquei migration, não alterei nada. Tudo sobre o estado atual vem da leitura dos arquivos do repositório.
- Não confirmei empiricamente que `auth.admin.createUser` continua funcionando com "Allow new users to sign up" desligado. É comportamento esperado (o endpoint `/admin/users` é outro, autenticado por service_role, e não o `/signup` público) e é o padrão de todo fluxo invite-only do Supabase — mas a doc de general-configuration não afirma isso em letra fria. **Teste isso antes de qualquer outra coisa**: é a premissa que sustenta o modelo inteiro.
- Não verifiquei a versão do GoTrue rodando no seu projeto. Isso afeta duas coisas: a issue #1798 (createUser não persiste ban_duration) e a #1579 (troca de senha pelo admin mata sessão).
- Não verifiquei o valor mínimo aceito de `jwt_expiry` no dashboard.
- Não medi nenhum plano de execução das policies propostas.

### Código / SQL verificado

```
-- =====================================================================
-- MIGRATION PROPOSTA (NÃO APLICADA) — auth + multi-tenancy do peciclo
-- Arquivo sugerido:
--   supabase/migrations/20260805120000_auth_perfis_rls.sql
-- Rodar no SQL Editor como `postgres` (o dono das tabelas peciclo_*),
-- senão as funções SECURITY DEFINER nascem com o dono errado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. peciclo_perfis — espelho de auth.users com papel, status e telefone
-- ---------------------------------------------------------------------
create table if not exists public.peciclo_perfis (
  id                uuid        primary key
                                references auth.users (id) on delete cascade,
  nome              text        not null,
  -- mesmo formato de WHATSAPP_DESTINATARIOS (.env.example): DDI+DDD+numero,
  -- só dígitos, ex. 5567999999999. Evita conversão na Evolution API.
  telefone_whatsapp text,
  papel             text        not null default 'cliente',
  status            text        not null default 'ativo',
  motivo_status     text,
  status_em         timestamptz not null default now(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint peciclo_perfis_papel_check
    check (papel in ('admin','cliente')),
  -- 'suspenso' é reversível (inadimplência); 'cancelado' encerra a relação
  -- mas preserva histórico e impede reciclar o e-mail por engano.
  constraint peciclo_perfis_status_check
    check (status in ('ativo','suspenso','cancelado')),
  constraint peciclo_perfis_nome_check
    check (nome = btrim(nome) and nome <> ''),
  constraint peciclo_perfis_telefone_check
    check (telefone_whatsapp is null or telefone_whatsapp ~ '^\d{12,13}$'),
  constraint peciclo_perfis_motivo_check
    check (status = 'ativo' or motivo_status is null or btrim(motivo_status) <> '')
);

-- listagem de admins na área de gestão; a checagem de RLS é por PK
create index if not exists peciclo_perfis_admin_idx
  on public.peciclo_perfis (id) where papel = 'admin';

comment on table public.peciclo_perfis is
  'Perfil de aplicação por usuário do Auth. Escrita só via service_role.';

-- ---------------------------------------------------------------------
-- 2. Funções SECURITY DEFINER — quebram a recursão de policy
--
-- Rodam como o dono (postgres). Dono de tabela não sofre RLS enquanto
-- peciclo_perfis NÃO tiver `force row level security` — que a migration
-- 20260727120000 já decidiu, de propósito, não ligar. Se alguém ligar
-- FORCE em peciclo_perfis, a recursão volta e tudo aqui quebra.
--
-- `language sql` é seguro: pelo wiki do PostgreSQL, SECURITY DEFINER e a
-- presença de cláusula SET impedem inlining, então o contexto do definer
-- é preservado. Não precisa de plpgsql.
--
-- `set search_path = ''` satisfaz o linter (function_search_path_mutable);
-- por isso tudo abaixo está qualificado.
-- ---------------------------------------------------------------------
create or replace function public.peciclo_usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.peciclo_perfis p
     where p.id = (select auth.uid())
       and p.status = 'ativo'
  );
$$;

create or replace function public.peciclo_eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.peciclo_perfis p
     where p.id = (select auth.uid())
       and p.status = 'ativo'
       and p.papel  = 'admin'
  );
$$;

-- funções nascem com EXECUTE para PUBLIC: tirar antes de dar o grant certo
revoke execute on function public.peciclo_usuario_ativo() from public, anon;
revoke execute on function public.peciclo_eh_admin()      from public, anon;
grant  execute on function public.peciclo_usuario_ativo() to authenticated, service_role;
grant  execute on function public.peciclo_eh_admin()      to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. RLS em peciclo_perfis
-- ---------------------------------------------------------------------
alter table public.peciclo_perfis enable row level security;
-- NÃO ligar `force row level security` aqui (ver comentário do item 2).

revoke all    on table public.peciclo_perfis from anon, authenticated;
grant  select on table public.peciclo_perfis to authenticated;
grant  select, insert, update, delete on table public.peciclo_perfis to service_role;

-- lê o próprio perfil, INCLUSIVE se suspenso: o front precisa saber o
-- porquê da tela vazia e mostrar "conta suspensa" em vez de um erro cru.
create policy peciclo_perfis_self_select
  on public.peciclo_perfis
  for select to authenticated
  using ( id = (select auth.uid()) );

-- admin vê todos. Duas policies PERMISSIVE fazem OR entre si.
create policy peciclo_perfis_admin_select
  on public.peciclo_perfis
  for select to authenticated
  using ( (select public.peciclo_eh_admin()) );

-- Sem policy de INSERT/UPDATE/DELETE e sem grant: nenhum usuário logado
-- escreve nesta tabela, nem o admin. Gestão passa pelo backend com
-- service_role — que é obrigatório de qualquer jeito para auth.admin.*.

-- ---------------------------------------------------------------------
-- 4. Leitura dos dados para cliente ATIVO
--
-- ATENÇÃO: as migrations 20260727120000 e 20260803120000 fizeram
-- `revoke all ... from authenticated`. Sem os GRANTs abaixo as policies
-- são letra morta — o Postgres barra no privilégio SQL antes de avaliar
-- a policy e devolve "permission denied for table".
-- ---------------------------------------------------------------------
grant select on table
  public.peciclo_abate_mensal,
  public.peciclo_abate_sif,
  public.peciclo_precos
to authenticated;

-- `(select ...)` obrigatório: vira InitPlan, avaliado 1x por query em vez
-- de 1x por linha (doc do Supabase: 11.000ms -> 10ms no benchmark deles).
-- `to authenticated` descarta anon antes de avaliar a expressão.
create policy peciclo_abate_mensal_leitura_ativa
  on public.peciclo_abate_mensal
  for select to authenticated
  using ( (select public.peciclo_usuario_ativo()) );

create policy peciclo_abate_sif_leitura_ativa
  on public.peciclo_abate_sif
  for select to authenticated
  using ( (select public.peciclo_usuario_ativo()) );

create policy peciclo_precos_leitura_ativa
  on public.peciclo_precos
  for select to authenticated
  using ( (select public.peciclo_usuario_ativo()) );

-- OPCIONAL — auditoria de coleta visível só para admin.
grant select on table public.peciclo_coletas to authenticated;
create policy peciclo_coletas_admin_select
  on public.peciclo_coletas
  for select to authenticated
  using ( (select public.peciclo_eh_admin()) );

-- peciclo_gta_registros (2,3 mi de linhas) fica DE FORA de propósito:
-- nenhum grant, nenhuma policy. O front consome só o agregado mensal.
-- service_role continua entrando por BYPASSRLS, sem alteração nenhuma.

-- ---------------------------------------------------------------------
-- 5. FUTURO — dado por cliente, sem reescrever as policies
-- Quando existir conteúdo diferenciado, adicione peciclo_perfis.conta_id
-- e uma coluna conta_id nullable nas tabelas de dado (NULL = global), e
-- troque só as policies para:
--
--   using (
--     (select public.peciclo_usuario_ativo())
--     and (conta_id is null or conta_id = (select public.peciclo_conta_atual()))
--   )
-- ---------------------------------------------------------------------


-- =====================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO (somente leitura)
-- =====================================================================
select relname, relrowsecurity as rls_on, relforcerowsecurity as force_on
  from pg_class
 where relnamespace = 'public'::regnamespace and relname like 'peciclo_%'
 order by relname;

select tablename, policyname, roles, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename like 'peciclo_%'
 order by tablename, policyname;

select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name like 'peciclo_%'
   and grantee in ('anon','authenticated','service_role')
 group by table_name, grantee
 order by table_name, grantee;

-- confirma que as funções ficaram com o dono certo
select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef, p.proconfig
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('peciclo_usuario_ativo','peciclo_eh_admin');


// =====================================================================
// BACKEND DE GESTÃO — SÓ SERVIDOR. Nunca no browser.
// Sugestão: src/admin/contas.ts
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Cria conta de cliente. Não há auto-cadastro: só isto cria usuário. */
export async function criarCliente(entrada: {
  email: string;
  senha: string;
  nome: string;
  telefoneWhatsapp: string;   // 5567999999999
  papel?: "admin" | "cliente";
}) {
  const papel = entrada.papel ?? "cliente";

  // email_confirm: true é essencial — sem isso o usuário nasce pendente
  // e você acaba mandando e-mail de confirmação para alguém cuja conta
  // você mesmo criou. NÃO passe ban_duration aqui (ver issue auth#1798).
  const { data, error } = await admin.auth.admin.createUser({
    email: entrada.email,
    password: entrada.senha,
    email_confirm: true,
    app_metadata: { papel },   // só para o front pintar o menu; authz é o RLS
  });
  if (error) throw error;

  const { error: erroPerfil } = await admin.from("peciclo_perfis").insert({
    id: data.user!.id,
    nome: entrada.nome,
    telefone_whatsapp: entrada.telefoneWhatsapp,
    papel,
    status: "ativo",
  });

  // as duas escritas não são atômicas: compensa apagando o usuário do Auth,
  // senão sobra um auth.users órfão que não consegue ler nada e é invisível
  // na área de gestão.
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(data.user!.id);
    throw erroPerfil;
  }
  return data.user!;
}

/** Troca a senha. Em GoTrue recente isto também derruba a sessão (auth#1579,
 *  NÃO documentado e NÃO testado aqui — não conte com isso). */
export async function trocarSenha(userId: string, novaSenha: string) {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: novaSenha,
  });
  if (error) throw error;
}

export async function atualizarTelefone(userId: string, telefone: string) {
  const { error } = await admin
    .from("peciclo_perfis")
    .update({ telefone_whatsapp: telefone, atualizado_em: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

/**
 * SUSPENDER — as duas camadas, e cada uma faz uma coisa diferente:
 *  - ban no Auth  -> não loga de novo e não renova o refresh token
 *                    (erro user_banned). NÃO mata a sessão aberta.
 *  - status no RLS -> para de ler dado no PRÓXIMO SELECT, imediatamente.
 * Sem o status, o cliente suspenso continua puxando dado até o JWT expirar
 * (default 3600s). Sem o ban, ele volta a entrar amanhã.
 * '876000h' = 100 anos: GoTrue não tem ban infinito.
 */
export async function suspender(userId: string, motivo: string) {
  const { error: e1 } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (e1) throw e1;

  const { error: e2 } = await admin
    .from("peciclo_perfis")
    .update({ status: "suspenso", motivo_status: motivo, status_em: new Date().toISOString() })
    .eq("id", userId);
  if (e2) throw e2;
}

/** Reativar: 'none' levanta o ban (confirmado por Collaborator na
 *  discussion supabase#9239; não consta na página de referência). */
export async function reativar(userId: string) {
  const { error: e1 } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (e1) throw e1;

  const { error: e2 } = await admin
    .from("peciclo_perfis")
    .update({ status: "ativo", motivo_status: null, status_em: new Date().toISOString() })
    .eq("id", userId);
  if (e2) throw e2;
}

/** CANCELAR — encerra a relação preservando histórico. Para apagar de vez
 *  use admin.auth.admin.deleteUser(userId): o ON DELETE CASCADE leva o perfil
 *  junto e o e-mail volta a ficar livre. */
export async function cancelar(userId: string, motivo: string) {
  const { error: e1 } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (e1) throw e1;

  const { error: e2 } = await admin
    .from("peciclo_perfis")
    .update({ status: "cancelado", motivo_status: motivo, status_em: new Date().toISOString() })
    .eq("id", userId);
  if (e2) throw e2;
}


# =====================================================================
# CONFIGURAÇÃO DO AUTH
# Hoje supabase/config.toml tem só project_id e [db]; o caminho operativo
# é o dashboard. Só adicione o bloco abaixo se for rodar `supabase config push`.
# =====================================================================
# Dashboard -> Authentication:
#   "Allow new users to sign up"  -> OFF   (obrigatório)
#   "Allow anonymous sign-ins"    -> OFF
#   "Allow manual linking"        -> OFF
#   JWT expiry                    -> 1800  (encurta a janela pós-ban)
#
# Equivalente em supabase/config.toml:
# [auth]
# enable_signup             = false
# enable_anonymous_sign_ins = false
# enable_manual_linking     = false
# jwt_expiry                = 1800
```

### Armadilhas
- MAIOR ARMADILHA: as migrations em produção já rodaram `revoke all on table ... from authenticated` (schema:105-107, experimental:57-59, aplicar-no-sql-editor:113). Policy de RLS sem `GRANT SELECT TO authenticated` não funciona — o Postgres barra no privilégio antes da policy e devolve 'permission denied for table', não 'zero linhas'. Você vai debugar a policy por horas achando que a lógica está errada quando o problema é o GRANT.
- Ban NÃO derruba sessão aberta. O access token é JWT autocontido: o cliente suspenso continua lendo dado por até `jwt_expiry` (default 3600s). O ban só morde no login novo e na troca do refresh token (erro user_banned). É exatamente por isso que a flag `status` no RLS não é redundante — ela é a única coisa que corta na hora.
- Não existe 'revogar todas as sessões do usuário X' em supabase-js. `auth.admin.signOut(jwt, scope)` exige 'A valid, logged-in JWT', que o admin não tem. Baixar jwt_expiry encurta a janela residual mas nunca a zera.
- Issue aberta supabase/auth#1798: `auth.admin.createUser` com `ban_duration` retorna `banned_until` correto no objeto MAS não persiste em auth.users (fica null). Nunca banir no create — sempre em um `updateUserById` separado.
- Se alguém ligar `force row level security` em peciclo_perfis, a recursão infinita volta e TODAS as policies quebram de uma vez, porque `peciclo_eh_admin()` e `peciclo_usuario_ativo()` dependem do dono da tabela não sofrer RLS. A migration 20260727120000 (linhas 94-95) já documentou essa escolha; ela virou dependência estrutural do modelo de auth.
- Circula na internet (post do DEV.to) que a função SECURITY DEFINER precisa ser `plpgsql` porque funções `sql` seriam inlined e perderiam o contexto do definer. É FALSO — o wiki do PostgreSQL lista 'the function is not SECURITY DEFINER' e 'the function has no SET clauses' entre as condições de inlining. `language sql security definer set search_path = ''` nunca é inlined.
- NÃO confirmei empiricamente que `auth.admin.createUser` funciona com o signup público desligado. É o comportamento esperado (endpoint /admin/users, autenticado por service_role, é diferente do /signup público) e é o padrão invite-only do Supabase, mas a doc não afirma em letra fria. Teste isso PRIMEIRO: é a premissa que sustenta o modelo inteiro.
- Papel/status no JWT (custom_access_token_hook ou app_metadata) fica CONGELADO até o token expirar. Se usar o claim como fonte de autorização, um admin rebaixado ou um cliente suspenso continua com o poder antigo por até 1 hora. Use o claim só para o front decidir o que renderizar; a policy no banco decide de verdade.
- createUser + insert em peciclo_perfis não são atômicos. Sem o rollback compensatório (deleteUser no erro) sobra um auth.users órfão: consegue autenticar, não lê nada por RLS e não aparece na área de gestão porque não tem perfil. A alternativa (trigger AFTER INSERT em auth.users) tem outro modo de falha: qualquer exceção no trigger faz o createUser estourar com 'Database error creating new user', mensagem que não diz nada sobre a causa real.
- Não dê grant em peciclo_gta_registros (2,3 mi de linhas). Se um dia expuser, a policy sem `(select ...)` vira 2,3 milhões de chamadas de função por query — é o cenário exato do benchmark 11.000ms -> 10ms da doc do Supabase.
- As chaves legadas anon/service_role serão descontinuadas até o fim de 2026 (doc oficial de API keys) — e hoje é agosto de 2026. `src/dados/cliente.ts:10` usa a service_role legada. Planeje a migração para sb_secret_.../sb_publishable_... junto com este trabalho, não depois.
- `email_confirm: true` no createUser não é detalhe: sem ele o usuário nasce pendente e, conforme `enable_confirmations`, não loga — ou pior, recebe e-mail de confirmação de uma conta que você criou à mão para ele.
- Se algum dia adicionar `[auth]` ao supabase/config.toml (hoje inexistente) e rodar `supabase config push`, tudo que não estiver declarado no bloco pode ser reposto ao default, incluindo o toggle de signup. Bloco parcial em config.toml é mais perigoso que nenhum.

---

## Stack e hospedagem do front-end Peciclo: Next.js 16 (App Router) na Vercel Pro + @supabase/ssr, com proteção no servidor via Data Access Layer e RLS
**Recomendação:** Next.js 16 (App Router, Node runtime) na Vercel Pro (US$20/mês — o plano Hobby proíbe uso comercial), autenticação com @supabase/ssr 0.12.4 usando createServerClient + cookies getAll/setAll e getClaims(), proteção real feita numa Data Access Layer server-only (não no proxy/middleware) somada a políticas RLS que hoje não existem, gráficos com Recharts 3 carregado via next/dynamic (112 KB gzip medidos), domínio apontado no Registro.br com um A no ápice e um CNAME no www; custo total ≈ US$45/mês (Vercel Pro + Supabase Pro que ele já paga).

### Achados

ACHADO 0 — peciclo.com.br NÃO ESTÁ REGISTRADO (verificado agora)
`whois -h whois.registro.br peciclo.com.br` → "% No match for peciclo.com.br" (consulta em 2026-08-05T13:43 -03:00). `dig NS peciclo.com.br` também volta vazio. O domínio precisa ser registrado antes de qualquer passo de DNS. Não testei se está em algum ticket/liberação pendente no painel dele.

1) AUTH — PACOTE E PADRÃO ATUAL (verificado no repositório oficial supabase/supabase e no npm)
- Pacote correto: `@supabase/ssr`, versão 0.12.4 (npm, publicado 2026-07-28). O `@supabase/auth-helpers-nextjs` está formalmente DEPRECADO ("Package no longer supported" no npm; o README do @supabase/ssr lista a consolidação).
- O código oficial vive em `supabase/supabase` → `examples/auth/nextjs/` (`lib/supabase/client.ts`, `lib/supabase/server.ts`, `proxy.ts`, `lib/supabase/proxy.ts`). Baixei os arquivos reais; estão colados na íntegra em `codigo_verificado`.
- MUDANÇA RECENTE 1: a API de cookies é `getAll` / `setAll`, e `setAll` agora recebe DOIS argumentos — `setAll(cookiesToSet, headers)`. O segundo traz `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0` e `Pragma: no-cache`. Confirmei lendo o `.d.ts` publicado (`dist/main/types.d.ts`, tipo `SetAllCookies`), que diz textualmente que sem esses headers "one user's session token can be served to a different user" por CDN/reverse proxy. No Server Component esses headers não podem ser setados — por isso o `setAll` lá é envolvido em try/catch vazio; quem escreve headers e cookies é o proxy.
- MUDANÇA RECENTE 2: a doc agora manda usar `supabase.auth.getClaims()`, não `getUser()` nem `getSession()`. Aviso literal da doc: "Never trust `supabase.auth.getSession()` inside server code such as Proxy." E: "It's safe to trust `getClaims()` because it validates the JWT signature against the project's published public keys every time."
- PEGADINHA DO getClaims: pela referência do supabase-js, ele só valida LOCALMENTE (contra o JWKS em `/.well-known/jwks.json`) se o projeto já usa chaves de assinatura ASSIMÉTRICAS (ECC/RSA). Projeto ainda no segredo simétrico HS256 legado faz uma requisição de rede ao Auth a cada verificação — igual ao `getUser()`. Migração: Dashboard → Auth → JWT Signing Keys → "Migrate JWT secret" → "Rotate keys" → revogar o legado só depois de ~1h15 (tempo de expirar os tokens de 1h).
- MUDANÇA RECENTE 3: o exemplo oficial usa `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, não mais `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As chaves legadas `anon`/`service_role` (JWT) estão marcadas para desativação até o fim de 2026, substituídas por `sb_publishable_...` e `sb_secret_...`. As duas convivem hoje; a `sb_secret_...` ainda devolve 401 se usada de um browser (checagem por User-Agent), o que a `service_role` não faz.
- Next.js 16.3.0 (versão atual no npm) RENOMEOU `middleware.ts` → `proxy.ts`: arquivo `proxy.ts`, função exportada `proxy`, e o objeto de config continua se chamando `export const config` (a skill local `next-best-practices/file-conventions.md` diz `proxyConfig` — está ERRADA, a doc oficial em nextjs.org/docs/app/api-reference/file-conventions/proxy mostra `config`). Codemod: `npx @next/codemod@canary middleware-to-proxy .`. Em v16 o proxy roda no runtime Node.js por padrão e o `runtime` config lança erro se setado.

2) DNS peciclo.com.br → Vercel (verificado na doc da Vercel + resolução DNS real)
- Ápice não aceita CNAME: tem que ser um registro A. A Vercel documenta `76.76.21.21` como "general-purpose anycast address" (legado, ainda válido) e diz que projetos novos recebem um IP de um pool anycast, "such as 216.198.79.1" — com a orientação explícita: "Always use the value shown in your project's domain card". Ou seja, NÃO chute o IP: copie o que aparecer no painel.
- Subdomínio (`www`) é CNAME. Projetos novos recebem um alvo por projeto, no formato `d1d4fc829fe7bc7c.vercel-dns-017.com` (exemplo da própria doc). O antigo `cname.vercel-dns.com` continua aparecendo em material mais velho.
- IPv6/AAAA: "IPv6 is not supported on Vercel" (doc de Working with DNS). Não crie AAAA.
- CAA: a Vercel adiciona CAA para Let's Encrypt automaticamente quando ela é a autoritativa. Com DNS no Registro.br, se você tiver qualquer CAA, ela precisa permitir `letsencrypt.org` — CAA que não permita bloqueia a emissão do certificado.
- Alternativa (delegar tudo): trocar os nameservers para os da Vercel. Resolvi na hora: `ns1.vercel-dns.com` → 198.51.44.13 e `ns2.vercel-dns.com` → 198.51.45.13 (existem e respondem). Obrigatório se você quiser wildcard (`*.peciclo.com.br`).
- Registro.br: o painel tem "Editar Zona" e um "Modo Avançado" (a ativação leva até ~10 min) onde se cria "Nova entrada". Detalhe operacional recorrente nos guias: entrada salva NÃO é editável — para corrigir, apaga e cria de novo. Os nameservers gratuitos do Registro.br existem e resolvem (`a.auto.dns.br` → 200.160.2.88, `b.auto.dns.br` → 200.160.2.89). Não testei o painel logado nem confirmei na doc oficial do Registro.br se o editor de zona aceita CAA — a página registro.br/tecnologia/dns/ voltou vazia no fetch.

3) GRÁFICOS — MEDI OS BUNDLES DE VERDADE
Instalei cada lib e empacotei com esbuild (--bundle --minify --format=esm, React marcado como external, NODE_ENV=production), importando o que um painel real usa. Resultado gzip -9:
- recharts 3.10.1 (LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer): 384.228 B min / 112.145 B gzip
- echarts 6.1.0 JÁ TREE-SHAKEN (line+bar+grid+tooltip+legend+dataZoom+CanvasRenderer): 592.483 B min / 200.964 B gzip
- lightweight-charts 5.2.0 (createChart, LineSeries, AreaSeries): 166.413 B min / 54.079 B gzip
- uplot 1.6.32: 51.994 B min / 23.026 B gzip
Contexto: Recharts 3 declara peer `react: ^16.8 || ^17 || ^18 || ^19` (roda com React 19), mas passou a depender internamente de `@reduxjs/toolkit`, `react-redux`, `immer`, `reselect` e `victory-vendor` — daí os 112 KB. Grepei o pacote: ele NÃO publica diretivas `use client`; quem consome precisa marcar o próprio componente com `'use client'`. O `shadcn/ui` chart é construído sobre Recharts v3 e todos os exemplos começam com `'use client'` — ou seja, é o mesmo custo.
Descartei ECharts: 201 KB gzip mesmo tree-shaken, quase o dobro do Recharts, sem ganho para 3 KPIs.
Reserva: lightweight-charts (54 KB) é excelente para candles de boi gordo, mas o eixo X dele é uma escala de TEMPO — curva de futuros da B3 é estrutura a termo (eixo = vencimento), então caberia mal. Não testei essa limitação empiricamente, é leitura do desenho da lib.

4) PROTEÇÃO DE ROTAS — O PROXY NÃO É A DEFESA
- A própria doc do Next 16 avisa: "Server Functions are not separate routes in this chain (…) Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone." E na doc de Data Security: "A page-level authentication check does not extend to the Server Actions defined within it."
- Precedente concreto: CVE-2025-29927 permitia pular o middleware inteiro forjando o header `x-middleware-subrequest`; corrigido em 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3. Quem tinha a autorização só no middleware ficou aberto.
- O padrão recomendado pela Vercel/Next é Data Access Layer: módulo com `import 'server-only'`, checagem de autorização dentro dele, `cache()` do React para deduplicar por requisição e DTOs mínimos ("only return the data relevant for this query and not everything").
- `forbidden()` / `unauthorized()` continuam EXPERIMENTAIS em 16.3 — a doc diz "not recommended for production" e exigem `experimental.authInterrupts: true`. Use `redirect()` e `notFound()`.
- FURO ATUAL NO BANCO: verifiquei as migrations (supabase/migrations/*.sql). As 5 tabelas têm `enable row level security` e ZERO `create policy`. Hoje isso é seguro porque só a service_role entra. No minuto em que o Next se conectar com a publishable key + sessão do usuário, TODA query devolve vazio, sem erro. Precisa criar as políticas — SQL pronto abaixo.

5) WHATSAPP — LER TELEFONES DA TABELA (li o código real)
- `src/config.ts` monta `whatsappDestinatarios` de `WHATSAPP_DESTINATARIOS` (split por vírgula) e o marca como OBRIGATÓRIO.
- `src/trigger/gerar-e-enviar.ts` itera `for (const numero of cfg.whatsappDestinatarios)` já com try/catch por destinatário ("Um destinatário com problema não pode impedir os outros de receber").
- `src/notificacao/evolution.ts` já expõe `normalizarNumero()` que aceita máscara e JID e devolve só dígitos DDI+DDD+numero, lançando se tiver <10 dígitos.
- `src/dados/cliente.ts` usa service_role, que ignora RLS — logo o job lê a tabela de perfis sem precisar de política nenhuma.
- Mudança mínima: um arquivo novo `src/dados/perfis.ts` + 3 linhas trocadas no job. Mantém o env como fallback, então se a tabela ainda não existir ou a query falhar, o job continua enviando exatamente como hoje.

6) CUSTO (números oficiais)
- Vercel Hobby: doc de Fair Use — "the Hobby plan restricts users to non-commercial, personal use only". SaaS pago não cabe. Pro é obrigatório.
- Vercel Pro: US$20/mês de platform fee, incluindo 1 assento de deploy e US$20 de crédito de uso; 1 TB de Fast Data Transfer e 10.000.000 de Edge Requests inclusos por mês. Assento extra (Owner/Member) US$20; assentos Viewer (só leitura) grátis. Spend management vem ligado por padrão em US$200/ciclo.
- Supabase Pro: US$25/mês, US$10 de compute credit (cobre uma instância Micro), 8 GB de disco, 250 GB de egress, 100 GB de storage e 100.000 MAUs INCLUSOS (extra a US$0,00325/MAU). Com "poucos usuários high-ticket" o Auth é custo zero.
- Total novo: US$20/mês (Vercel Pro). Supabase Pro US$25 ele já paga. ≈ US$45/mês. Domínio .com.br é anuidade do Registro.br. Trigger.dev e Evolution API não mudam — não verifiquei o plano atual dele nesses dois.
- REGIÃO: Vercel Functions default = `iad1` (Washington). `gru1` (sa-east-1, São Paulo) existe e Pro permite até 5 regiões. Mas a regra da doc é "Functions should be executed in the same region as your database". Não consegui descobrir a região do projeto qafcxvdrrwcmnyedvyts (o host está atrás de Cloudflare — 104.18.38.10). Confira no dashboard: se o Supabase estiver em us-east-1, DEIXE em iad1; só mude para gru1 se o Supabase estiver em sa-east-1.

O QUE NÃO TESTEI: não rodei nenhum app Next.js real contra este projeto Supabase; não executei nenhum SQL; não abri o painel da Vercel, do Registro.br, do Trigger.dev nem do Supabase; não verifiquei o IP/CNAME específico que a Vercel vai atribuir ao projeto dele (é por projeto); não medi o bundle final do app (só das libs isoladas); não confirmei se o editor de zona do Registro.br aceita CAA.

### Código / SQL verificado

```
═══════════════════════════════════════════
A) DEPENDÊNCIAS
═══════════════════════════════════════════
npx create-next-app@latest peciclo-web --ts --app --tailwind --eslint --src-dir
npm i @supabase/supabase-js @supabase/ssr recharts server-only
# Next 16.3.0 · @supabase/ssr 0.12.4 · recharts 3.10.1 (versões conferidas no npm em 05/08/2026)

.env.local
  NEXT_PUBLIC_SUPABASE_URL=https://qafcxvdrrwcmnyedvyts.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  # NUNCA colocar sb_secret_ / service_role aqui com prefixo NEXT_PUBLIC_

═══════════════════════════════════════════
B) CLIENTES SUPABASE — cópia literal de supabase/supabase @ master
   (examples/auth/nextjs/…)
═══════════════════════════════════════════

// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

// src/lib/supabase/proxy.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          // headers = Cache-Control/Expires/Pragma. Sem isto, um CDN pode
          // cachear a resposta com Set-Cookie e servir a sessão de um
          // usuário para outro.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse
}

// proxy.ts  (RAIZ do projeto, ao lado de src/ — Next 16 renomeou middleware→proxy)
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {   // <- é `config`, NÃO `proxyConfig`
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

═══════════════════════════════════════════
C) DATA ACCESS LAYER — a defesa de verdade (item 4)
═══════════════════════════════════════════

// src/lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Perfil = {
  id: string
  nome: string
  papel: 'cliente' | 'admin'
  status: 'ativo' | 'suspenso' | 'cancelado'
}

/** cache() = uma única verificação por requisição, mesmo chamada em 10 lugares. */
export const obterPerfil = cache(async (): Promise<Perfil | null> => {
  const supabase = await createClient()

  // getClaims valida a assinatura do JWT. getSession NÃO — nunca use getSession aqui.
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return null

  const { data: perfil } = await supabase
    .from('peciclo_perfis')
    .select('id, nome, papel, status')
    .eq('id', data.claims.sub as string)
    .maybeSingle()

  return (perfil as Perfil) ?? null
})

/** Use no layout do dashboard E dentro de toda Server Action. */
export const exigirClienteAtivo = cache(async (): Promise<Perfil> => {
  const p = await obterPerfil()
  if (!p) redirect('/login')
  if (p.status !== 'ativo') redirect('/conta-inativa')
  return p
})

/** notFound() em vez de forbidden(): forbidden() ainda é experimental em 16.3. */
export const exigirAdmin = cache(async (): Promise<Perfil> => {
  const p = await exigirClienteAtivo()
  if (p.papel !== 'admin') notFound()
  return p
})

// src/app/(painel)/layout.tsx
import { exigirClienteAtivo } from '@/lib/dal'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirClienteAtivo()
  return <section data-usuario={perfil.nome}>{children}</section>
}

// src/app/admin/layout.tsx
import { exigirAdmin } from '@/lib/dal'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await exigirAdmin()
  return <>{children}</>
}

// src/app/admin/acoes.ts  — RE-VERIFICAR DENTRO DA ACTION. O layout NÃO protege isto:
// uma Server Action é um POST direto na rota e o proxy pode nem rodar nela.
'use server'
import { exigirAdmin } from '@/lib/dal'
import { criarClienteAdmin } from '@/lib/admin-db'
import { revalidatePath } from 'next/cache'

export async function suspenderCliente(id: string) {
  await exigirAdmin()                       // <- linha crítica
  const admin = criarClienteAdmin()
  const { error } = await admin
    .from('peciclo_perfis')
    .update({ status: 'suspenso' })
    .eq('id', id)
  if (error) throw new Error('Falha ao suspender')
  revalidatePath('/admin/clientes')
  return { ok: true }                       // devolve só o necessário, nunca o registro cru
}

// src/lib/admin-db.ts  — chave secreta ISOLADA aqui, nunca importada por Client Component
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function criarClienteAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,       // sb_secret_...
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

═══════════════════════════════════════════
D) SQL — tabela de perfis + as políticas RLS QUE HOJE NÃO EXISTEM
   (supabase/migrations/20260805120000_perfis_e_rls.sql)
═══════════════════════════════════════════
create table if not exists public.peciclo_perfis (
  id                uuid primary key references auth.users(id) on delete cascade,
  nome              text not null,
  telefone_whatsapp text,                       -- DDI+DDD+numero, só dígitos
  papel             text not null default 'cliente'
                    check (papel in ('cliente','admin')),
  status            text not null default 'ativo'
                    check (status in ('ativo','suspenso','cancelado')),
  recebe_whatsapp   boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- índice que o job de WhatsApp usa todo dia
create index if not exists peciclo_perfis_envio_idx
  on public.peciclo_perfis (status, recebe_whatsapp)
  where telefone_whatsapp is not null;

alter table public.peciclo_perfis enable row level security;

-- SECURITY DEFINER é OBRIGATÓRIO aqui: uma policy em peciclo_perfis que
-- consultasse peciclo_perfis diretamente entraria em recursão infinita.
-- A função roda com os privilégios do dono da tabela e ignora a RLS do invocador.
create or replace function public.peciclo_e_ativo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.peciclo_perfis p
    where p.id = (select auth.uid()) and p.status = 'ativo'
  );
$$;

create or replace function public.peciclo_e_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.peciclo_perfis p
    where p.id = (select auth.uid()) and p.papel = 'admin' and p.status = 'ativo'
  );
$$;

-- (select auth.uid()) entre parênteses: avalia UMA vez por query em vez de
-- uma vez por linha — obrigatório em peciclo_gta_registros (2,3 mi de linhas).
create policy "perfil_proprio_leitura" on public.peciclo_perfis
  for select to authenticated using ((select auth.uid()) = id);

create policy "admin_gerencia_perfis" on public.peciclo_perfis
  for all to authenticated
  using (public.peciclo_e_admin()) with check (public.peciclo_e_admin());

-- Dados de mercado: iguais para todo cliente ATIVO. Só leitura.
create policy "ativo_le_abate_mensal" on public.peciclo_abate_mensal
  for select to authenticated using (public.peciclo_e_ativo());

create policy "ativo_le_precos" on public.peciclo_precos
  for select to authenticated using (public.peciclo_e_ativo());

create policy "ativo_le_abate_sif" on public.peciclo_abate_sif
  for select to authenticated using (public.peciclo_e_ativo());

-- peciclo_gta_registros e peciclo_coletas ficam SEM policy de propósito:
-- 2,3 mi de linhas de detalhe e auditoria não vão para o browser.
-- O painel lê agregados via Server Component / RPC.

═══════════════════════════════════════════
E) DNS NO REGISTRO.BR (item 2) — passo a passo
═══════════════════════════════════════════
0. REGISTRAR peciclo.com.br em registro.br (verificado hoje: ainda livre / sem NS).
1. Vercel → Projeto → Settings → Domains → Add Domain → `peciclo.com.br`.
   Aceite a sugestão de adicionar também `www.peciclo.com.br`.
2. ANOTE o que o card do domínio mostrar. NÃO chute:
     ápice  → registro A, IP do card (pode ser 76.76.21.21 OU um do pool anycast,
              ex.: 216.198.79.1)
     www    → registro CNAME, alvo do card (ex.: d1d4fc829fe7bc7c.vercel-dns-017.com)
3. registro.br → login → clique no domínio → seção DNS → "Editar Zona"
   → "Modo Avançado" → confirmar (a ativação pode levar até ~10 min).
4. "Nova entrada", uma por vez:

   NOME     TIPO    VALOR                                  TTL
   @        A       <IP do card da Vercel>                 3600
   www      CNAME   <alvo do card>.                        3600   (com ponto final)
   @        TXT     <valor de verificação>                 3600   (SÓ se a Vercel pedir)

   • Salvar cada entrada. Entrada salva NÃO é editável — errou, apaga e refaz.
   • NÃO crie AAAA: a Vercel não suporta IPv6.
   • Se já existir CAA na zona, ela precisa permitir letsencrypt.org, senão o
     certificado nunca é emitido.
5. Vercel → Domains → aguardar o status virar "Valid Configuration" (minutos a horas;
   a doc fala em até 24-48h no pior caso). Defina `peciclo.com.br` como domínio primário
   e deixe `www` redirecionando.

ALTERNATIVA (delegar tudo à Vercel — necessária se quiser *.peciclo.com.br):
   registro.br → "Alterar servidores DNS" → ns1.vercel-dns.com / ns2.vercel-dns.com
   (ambos resolvem: 198.51.44.13 e 198.51.45.13). Aí TODO registro que você quiser
   manter (MX de e-mail, TXT de SPF/DKIM) tem que ser recriado dentro da Vercel.

═══════════════════════════════════════════
F) TRIGGER.DEV — telefones vindos da tabela (item 5), mudança mínima
═══════════════════════════════════════════

// ARQUIVO NOVO: src/dados/perfis.ts
import { obterCliente } from "./cliente.js";
import { normalizarNumero } from "../notificacao/evolution.js";

/**
 * Telefones dos clientes ATIVOS que optaram por receber.
 * Usa service_role, então ignora RLS — não depende de policy nenhuma.
 * Nunca lança: se a tabela ainda não existe ou a query falha, devolve [] e
 * o job segue com os números do .env.
 */
export async function listarTelefonesAtivos(): Promise<string[]> {
  try {
    const { data, error } = await obterCliente()
      .from("peciclo_perfis")
      .select("telefone_whatsapp")
      .eq("status", "ativo")
      .eq("recebe_whatsapp", true)
      .not("telefone_whatsapp", "is", null);
    if (error) return [];
    return (data ?? [])
      .map((l) => {
        try { return normalizarNumero(l.telefone_whatsapp as string); }
        catch { return null; }               // número torto não derruba o lote
      })
      .filter((n): n is string => n !== null);
  } catch {
    return [];
  }
}

// EDIÇÃO em src/trigger/gerar-e-enviar.ts
// 1) novo import, junto dos outros:
import { listarTelefonesAtivos } from "../dados/perfis.js";

// 2) trocar a linha `for (const numero of cfg.whatsappDestinatarios) {` por:
    const doBanco = await listarTelefonesAtivos();
    const destinatarios = [
      ...new Set([
        ...cfg.whatsappDestinatarios.map((n) => normalizarNumero(n)),  // fallback do .env
        ...doBanco,
      ]),
    ];
    logger.info("destinatarios resolvidos", {
      env: cfg.whatsappDestinatarios.length,
      banco: doBanco.length,
      total: destinatarios.length,
    });

    for (const numero of destinatarios) {
// 3) o resto do laço (try/catch por destinatário) fica IGUAL.
// 4) adicionar `import { normalizarNumero } from "../notificacao/evolution.js";`
//    ao import já existente de evolution.js.

// src/config.ts NÃO muda. WHATSAPP_DESTINATARIOS continua obrigatório e vira a
// rede de segurança (o número do dono). Quando todos os clientes estiverem na
// tabela, basta deixar lá só o número dele.

═══════════════════════════════════════════
G) GRÁFICO — Recharts isolado num chunk próprio (item 3)
═══════════════════════════════════════════

// src/app/(painel)/page.tsx  — Server Component: consulta no servidor,
// manda para o cliente só o DTO mínimo (não o registro cru do banco).
import { exigirClienteAtivo } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import GraficoFemeas from './grafico-femeas'

export default async function Painel() {
  await exigirClienteAtivo()
  const supabase = await createClient()

  const { data } = await supabase
    .from('peciclo_abate_mensal')
    .select('ano, mes, sexo, quantidade')
    .eq('finalidade', 'ABATE')
    .order('ano').order('mes')

  const serie = agregarPercentualFemeas(data ?? [])   // { competencia, pct }[]
  return <GraficoFemeas serie={serie} />
}

// src/app/(painel)/grafico-femeas.tsx
'use client'                                   // recharts não publica 'use client'
import dynamic from 'next/dynamic'
// import direto do subcaminho: barrel do recharts arrasta o pacote inteiro
const ResponsiveContainer = dynamic(
  () => import('recharts').then((m) => m.ResponsiveContainer), { ssr: false }
)
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

export default function GraficoFemeas({ serie }: { serie: { competencia: string; pct: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={serie}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="competencia" />
        <YAxis unit="%" domain={[30, 55]} />
        <Tooltip />
        <Line type="monotone" dataKey="pct" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

### Armadilhas
- peciclo.com.br NÃO ESTÁ REGISTRADO. `whois -h whois.registro.br peciclo.com.br` devolveu 'No match' em 05/08/2026 e o domínio não tem NS delegado. Registre antes de qualquer coisa — e antes que alguém registre por cima, já que o produto está sendo nomeado em público.
- RLS ligada com ZERO policies: as 5 tabelas peciclo_* têm `enable row level security` e nenhum `create policy` nas migrations. Isso não dá erro — dá RESULTADO VAZIO. O painel vai renderizar gráficos em branco e você vai caçar bug no Next.js por horas. Rode o SQL da seção D antes de plugar o front.
- NÃO chute o IP da Vercel. A doc é explícita: 'Always use the value shown in your project's domain card'. Copiar 76.76.21.21 de um tutorial de 2023 num projeto novo que recebeu IP do pool anycast (ex.: 216.198.79.1) resulta em 'Invalid Configuration' permanente. Mesma coisa para o CNAME: projetos novos usam alvo por projeto (d1d4fc829fe7bc7c.vercel-dns-017.com), não `cname.vercel-dns.com`.
- No editor de zona do Registro.br a entrada salva NÃO pode ser editada — só apagada e recriada. E o 'Modo Avançado' leva até ~10 minutos para ativar. Confira o valor DUAS vezes antes de clicar em salvar.
- Vercel Hobby proíbe uso comercial ('the Hobby plan restricts users to non-commercial, personal use only'). SaaS high-ticket rodando no Hobby é violação de termos e pode ser derrubado sem aviso. Pro (US$20/mês) é obrigatório desde o dia 1.
- Nunca use `getSession()` em código de servidor — a doc do Supabase diz literalmente 'Never trust supabase.auth.getSession() inside server code such as Proxy'. Use `getClaims()`. E não rode NADA entre `createServerClient()` e `getClaims()` no proxy: a própria doc avisa que isso causa usuários deslogados aleatoriamente e é dificílimo de debugar.
- getClaims() só é rápido se o projeto já migrou para chaves de assinatura ASSIMÉTRICAS. No segredo HS256 legado, cada chamada vira uma requisição de rede ao Auth — em cada page load, em cada Server Action. Migre em Auth → JWT Signing Keys ANTES de medir performance. Cuidado: se algum código verificar JWT direto contra o segredo legado (jose/jsonwebtoken), a rotação quebra.
- O proxy/middleware NÃO é a proteção. A doc do Next 16 diz para verificar auth dentro de cada Server Function, e o CVE-2025-29927 (bypass via header x-middleware-subrequest) provou o ponto. Toda Server Action de admin precisa chamar `exigirAdmin()` na primeira linha — o layout não a protege.
- O segundo argumento de `setAll(cookiesToSet, headers)` é novo e não é decorativo: sem aplicar esses headers (Cache-Control: private, no-store...) na resposta do proxy, um CDN pode cachear a resposta com Set-Cookie e servir a SESSÃO DE UM CLIENTE PARA OUTRO. Tutoriais anteriores a 2026 mostram `setAll(cookiesToSet)` com um argumento só — estão desatualizados.
- A skill local `next-best-practices/file-conventions.md` afirma que Next 16 usa `export const proxyConfig`. Está ERRADA: a doc oficial (nextjs.org, v16.3.0) usa `export const config` dentro de `proxy.ts`. Se seguir a skill, o matcher é ignorado e o proxy roda em TODA requisição, inclusive assets.
- Chaves `anon` e `service_role` (JWT legado) estão marcadas para desativação até o fim de 2026. O job do Trigger.dev usa SUPABASE_SERVICE_ROLE_KEY hoje. Planeje a troca para `sb_secret_...` (que ainda tem a vantagem de retornar 401 se vazar para um browser) e use `sb_publishable_...` no front.
- `peciclo_gta_registros` tem 2,3 milhões de linhas. Não crie policy de SELECT nela nem deixe o browser consultá-la — nem paginada. Se criar policy, use `(select auth.uid())` entre parênteses: `auth.uid()` solto é reavaliado LINHA A LINHA.
- Região: o default da Vercel é `iad1` (Washington), não `gru1`. A regra da doc é colocar a function na mesma região do BANCO, não perto do usuário (o CDN já serve o estático de São Paulo). Não descobri em qual região está o projeto qafcxvdrrwcmnyedvyts — confira no dashboard antes de mexer. Mudar para gru1 com o Supabase em us-east-1 PIORA o painel.
- `forbidden()` e `unauthorized()` continuam experimentais no Next 16.3 ('not recommended for production') e exigem `experimental.authInterrupts: true`. Use `redirect()` e `notFound()`.
- Recharts 3 pesa 112 KB gzip MEDIDOS (ele arrasta @reduxjs/toolkit, react-redux, immer e victory-vendor internamente) e não publica diretiva 'use client' — seu componente tem que declarar. Importe direto e carregue via next/dynamic, senão isso cai no chunk compartilhado e todo login carrega gráfico que ninguém vê ainda.
- lightweight-charts (54 KB gzip) é tentador pelo tamanho, mas o eixo X dele é uma escala de TEMPO. Curva de futuros da B3 é estrutura a termo (eixo = vencimento), não série temporal — ia exigir gambiarra mapeando vencimento para data. Não testei isso na prática, mas é motivo suficiente para não adotá-la como lib principal.
- Suspensão de cliente via claim no JWT (Custom Access Token Hook) parece elegante e é mais rápido, MAS a claim só muda quando o token é renovado — até ~1h de atraso. Para 'suspender agora' funcionar de verdade, a checagem de status tem que consultar a tabela a cada requisição, como no DAL acima.
- Na mudança do WhatsApp, mantenha `WHATSAPP_DESTINATARIOS` como fallback e `listarTelefonesAtivos()` sem lançar exceção. Se você trocar direto para 'só o banco' e a tabela estiver vazia ou a migration não tiver rodado em produção, o job roda com sucesso, retorna `{ enviados: 0 }` e ninguém — nem o dono — recebe a planilha. Silêncio é a pior falha aqui.

---

## Chat de IA do Peciclo: tool use com ferramentas fechadas sobre os cálculos que já existem no repo
**Recomendação:** Tool use (opção b) com 6 ferramentas de leitura fechadas que reaproveitam `src/planilha/kpis.ts` e `src/planilha/mercado.ts`, em `claude-opus-5` com `effort: "medium"`, histórico guardado no servidor e um bloco de contexto pré-computado curto em cache de prompt — text-to-SQL está descartado porque o único papel que enxerga essas tabelas é a `service_role`, que também lê todas as tabelas dos outros sistemas do mesmo projeto Supabase.

### Achados

## 1. O que existe hoje (lido no repo, não suposto)

**Não existe app web.** Não há `next.config.*` nem diretório `app/`. `package.json` tem só `@supabase/supabase-js`, `@trigger.dev/sdk` 4.5.9, `exceljs`, `zod` — nenhum `@anthropic-ai/sdk`. O route handler do chat é código novo, num app Next.js que ainda vai nascer; nada disso toca a rotina do WhatsApp.

**O volume real é menor que "~900 linhas".** `peciclo_abate_mensal` tem PK `(uf, ano, mes, finalidade, sexo)` e `finalidade` entra na chave. Mas `src/dados/mensal.ts:95` lê **só** `.eq("finalidade", "ABATE")` — igualdade exata, com o comentário explicando que "ABATE SANITÁRIO" e "SACRIFÍCIO" são abate por determinação sanitária, não decisão econômica. O universo que alimenta o indicador é 4 UF × 2 sexos × meses. Pelo `referencias/planilha-abate-2025-2026.csv` a série semeada vai de jan/2025 a jun/2026 → **~150–170 linhas hoje, +8 por mês**. `peciclo_abate_sif` soma 4 linhas/mês (GO/SP). `peciclo_precos` são 3 séries diárias (`boi_gordo`, `bezerro_ms`, `bezerro_sp`) iniciadas em ago/2026 → ~750 linhas/ano.

**Os indicadores já estão calculados e testados.** `calcularKpis` (`src/planilha/kpis.ts`) devolve por escopo/mês: `femeas`, `machos`, `total`, `participacaoFemeas`, `variacaoMesAnteriorPp`, `variacaoAnoAnteriorPp`, `mediaMovel12m` e `estados`. `calcularRelacaoTroca`, `calcularPremioFuturos` e `ultimoPreco` estão em `src/planilha/mercado.ts`. Há testes em `tests/planilha/kpis.test.ts` e `mercado.test.ts`. **As ferramentas do chat devem chamar essas funções, não reimplementar** — assim planilha e chat nunca divergem.

**Lacuna crítica: a curva de futuros da B3 não é persistida.** `src/trigger/coleta-experimental.ts:69` diz literalmente "Curva de futuros da B3 (não persistida: é sempre o retrato do dia)" — `coletarFuturos()` roda e o resultado vai direto para o xlsx. Não existe tabela. A pergunta "o que os futuros estão dizendo?" hoje **não tem como ser respondida** sem (a) criar tabela e passar a gravar, ou (b) raspar ao vivo no request (Notícias Agrícolas, ~60s de timeout, HTML frágil). Recomendo (a).

## 2. Comparação das três arquiteturas

| | (a) text-to-SQL | (b) tool use fechado | (c) contexto pré-computado |
|---|---|---|---|
| **Precisão** | Alta em agregação simples, **baixa nas regras do domínio**: o modelo escreveria `finalidade like 'ABATE%'` (traz ABATE SANITÁRIO), somaria GO/SP com MT/MS/RO/PA, e trataria o mês corrente parcial como fechado. Cada uma dessas regras está hoje só em comentário de código. | Alta e **determinística**: as regras ficam no TS testado; o modelo só escolhe escopo e período | Alta para o que couber no bloco; zero para o resto |
| **Alucinação** | Média: SQL plausível e errado passa silencioso (não gera erro, gera número errado) | Baixa: schema `strict`, saída em JSON com `fonte`/`periodo`/`parcial`; se vazio, `vazio:true` + motivo | Baixa para o que está no bloco; **alta na borda** — o modelo extrapola o que não está lá |
| **Segurança** | **Inaceitável aqui.** RLS ligada e sem policy: só `service_role` lê. Uma migração do próprio projeto diz que "o projeto Supabase é compartilhado com outros sistemas e o prefixo isola os objetos deste". SQL arbitrário com `service_role` = prompt injection lê `auth.users` e as tabelas dos outros sistemas. Mitigar exige papel read-only dedicado + `search_path` + timeout + parser de SQL — muito trabalho para pouco ganho | Superfície fixa: 6 funções, sem SQL vindo do modelo | Nenhuma consulta em runtime |
| **Custo** | Menos tokens de schema, mas mais round-trips de retry quando o SQL erra | ~1.200 tokens de schema no prefixo, cacheáveis (0,1× na releitura) | Mais barato por pergunta simples; cresce com a série de preços e vira contexto morto |
| **Manutenção** | Prompt tem que reensinar as regras a cada mudança de schema | Uma função por conceito; o teste do repo já cobre a matemática | Refazer o bloco a cada indicador novo |

**Por que (b) e não (c), apesar de os dados serem pequenos:** hoje 170 linhas cabem em ~3k tokens, mas (c) responde só o que foi antecipado. "Compare MT com MS em 2025" e "qual foi o pior mês de fêmeas do PA" exigem recortes arbitrários; a série de preços diária cresce ~750 linhas/ano; e `peciclo_gta_registros` (2,3 mi de linhas, com município de origem/destino) fica permanentemente fora de alcance. (c) entra como **otimização dentro de (b)**: um briefing de ~400 tokens (último mês fechado, consolidado, participação, relação de troca, cobertura) no prefixo cacheado, para "como está o ciclo?" responder em 1 round-trip sem tool call.

## 3. Modelo e custo

`claude-opus-5` — 1M de contexto, 128k de saída, **US$ 5 / MTok entrada e US$ 25 / MTok saída** (confirmado na página de modelos de platform.claude.com em 05/08/2026). Alternativa documentada, se o dono quiser: `claude-sonnet-5`, US$ 3/US$ 15, com preço promocional de US$ 2/US$ 10 até 31/08/2026 — mas essa é decisão dele, não default.

Dois motivos técnicos para Opus 5 aqui, além da qualidade: **mensagens `system` no meio da conversa** (`{role:"system"}` dentro de `messages`) são suportadas em Opus 5 e **não** em Sonnet 5 — é como injetar "hoje é 05/08/2026" sem invalidar o cache do prefixo; e o **mínimo de prefixo cacheável cai para 512 tokens** no Opus 5 (contra 1024 no Opus 4.8), o que garante que system+tools entrem em cache.

Custo (estimativa, não medida com `count_tokens`), com prefixo de ~2.200 tokens (286 do system prompt interno de tool use no Opus 5 + ~1.200 de schemas + ~700 do prompt):

- pergunta simples com 1 tool call (2 chamadas de API): ~5,3k entrada + ~800 saída → **~US$ 0,046**; com cache de prefixo, **~US$ 0,026**
- conversa de 8 turnos: ~128k entrada + ~6,4k saída → **~US$ 0,80** sem cache, **~US$ 0,35** com cache
- 5 usuários × 10 conversas/mês ≈ **US$ 20–40/mês**. Irrelevante para um produto high-ticket — o teto de custo existe para conter erro de loop, não para economizar.

## 4. Anti-alucinação numérica: o prompt é a terceira linha de defesa

A ordem de eficácia é estrutural → formato → prompt:

1. **O modelo nunca faz aritmética.** Toda derivada (%, variação p.p., média móvel, relação de troca, prêmio dos futuros) vem pronta e arredondada do TS. O modelo lê e narra.
2. **O histórico vive no servidor.** Se o cliente postar o array `messages`, um usuário forja um `tool_result` com números inventados e o modelo relata com total confiança. O cliente manda só `{conversaId, texto}`.
3. **Toda ferramenta devolve metadados obrigatórios**: `fonte`, `periodo`, `parcial`, `estados_incluidos`, `observacoes`. Vazio nunca é `[]` — é `{vazio:true, motivo:"..."}`, que dá ao modelo uma frase pronta para dizer "não tenho esse dado".
4. **`strict: true`** nos schemas garante que o input da ferramenta case exatamente.
5. O prompt de sistema fecha o resto (abaixo).
6. Opcional, para eval: um guardrail que extrai os números da resposta final e confere contra os números presentes nos `tool_result` daquele turno; divergência vira log/alerta, não bloqueio.

## 5. O que eu NÃO testei

- Não executei nada: o `@anthropic-ai/sdk` não está instalado neste repo e não existe app Next.js. Todo o código abaixo é spec, não build verificado.
- Não consultei o banco. As contagens de linha são derivadas do CSV de referência e do schema, não de `select count(*)`. A cifra de ~900 linhas em `peciclo_abate_mensal` é sua, e é consistente com "ABATE" + outras finalidades da GTA.
- Não verifiquei `stream.controller.abort()` nem a opção `signal` na versão instalada do SDK (nenhuma está instalada). A doc do SDK TS descreve `stream.controller.abort()` para `messages.create({stream:true})`; por isso o código abaixo usa `break` no loop, que é o padrão documentado. `toReadableStream()` **não** aparece na doc atual — não conte com ele.
- Não rodei o RPC de cota contra Postgres real; a semântica de `on conflict do update ... where` + `returning` é a documentada, mas precisa de um teste.
- Não medi tokens com `messages.count_tokens` — os números de custo são estimativas.
- Não validei se o projeto Supabase já usa Supabase Auth para outro sistema (ver armadilhas).

### Código / SQL verificado

```
## A) SQL — o que falta no banco

```sql
-- 1. Curva de futuros da B3. Hoje coletarFuturos() roda e o resultado morre no
-- xlsx (coleta-experimental.ts:69). Sem isto, "o que os futuros estão dizendo?"
-- não tem resposta. Uma linha por contrato por dia de coleta.
create table if not exists public.peciclo_futuros_b3 (
  data_referencia date          not null,
  contrato        text          not null,
  fechamento      numeric(14,4) not null,
  fonte           text          not null default 'B3 via Noticias Agricolas',
  atualizado_em   timestamptz   not null default now(),
  constraint peciclo_futuros_b3_pkey primary key (data_referencia, contrato),
  constraint peciclo_futuros_b3_valor_check check (fechamento > 0),
  constraint peciclo_futuros_b3_contrato_check check (contrato ~ '^[A-Za-zÀ-ú]+/[0-9]{4}$')
);
create index if not exists peciclo_futuros_b3_data_idx
  on public.peciclo_futuros_b3 (data_referencia desc);

-- 2. Cota de uso do chat, por usuário e por dia (fuso de São Paulo, que é o
-- fuso em que o dono e o fazendeiro pensam "hoje").
create table if not exists public.peciclo_chat_uso (
  usuario_id    uuid          not null,
  dia           date          not null,
  mensagens     integer       not null default 0,
  tokens_in     bigint        not null default 0,
  tokens_out    bigint        not null default 0,
  tokens_cache  bigint        not null default 0,
  custo_usd     numeric(12,6) not null default 0,
  atualizado_em timestamptz   not null default now(),
  constraint peciclo_chat_uso_pkey primary key (usuario_id, dia)
);

-- 3. Histórico da conversa no SERVIDOR. O cliente nunca envia messages[]:
-- um tool_result forjado faria o modelo relatar número inventado com convicção.
create table if not exists public.peciclo_chat_mensagens (
  id          bigint      generated always as identity primary key,
  conversa_id uuid        not null,
  usuario_id  uuid        not null,
  papel       text        not null,
  conteudo    jsonb       not null,   -- content blocks crus da API
  criado_em   timestamptz not null default now(),
  constraint peciclo_chat_papel_check check (papel in ('user','assistant'))
);
create index if not exists peciclo_chat_mensagens_conversa_idx
  on public.peciclo_chat_mensagens (conversa_id, id);

-- Mesma política das outras tabelas: RLS ligada, ZERO policy. Só service_role
-- (que tem BYPASSRLS) acessa, e só pelo servidor.
alter table public.peciclo_futuros_b3      enable row level security;
alter table public.peciclo_chat_uso        enable row level security;
alter table public.peciclo_chat_mensagens  enable row level security;

do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.peciclo_futuros_b3, public.peciclo_chat_uso,
      public.peciclo_chat_mensagens from anon;
  end if;
  if to_regrole('authenticated') is not null then
    revoke all on table public.peciclo_futuros_b3, public.peciclo_chat_uso,
      public.peciclo_chat_mensagens from authenticated;
  end if;
  if to_regrole('service_role') is not null then
    grant select, insert, update, delete on table public.peciclo_futuros_b3,
      public.peciclo_chat_uso, public.peciclo_chat_mensagens to service_role;
  end if;
end $$;

-- 4. Reserva atômica de cota. O WHERE no DO UPDATE transforma a atualização em
-- no-op quando já bateu o teto; nesse caso o RETURNING não devolve linha e
-- v_usadas fica NULL. Um SELECT-depois-UPDATE aqui teria corrida entre duas
-- abas abertas do mesmo usuário.
create or replace function public.peciclo_chat_reservar(
  p_usuario    uuid,
  p_limite_dia integer default 40
) returns table (permitido boolean, usadas integer, limite integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_dia    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_usadas integer;
begin
  insert into public.peciclo_chat_uso as u (usuario_id, dia, mensagens)
  values (p_usuario, v_dia, 1)
  on conflict (usuario_id, dia) do update
    set mensagens = u.mensagens + 1, atualizado_em = now()
    where u.mensagens < p_limite_dia
  returning u.mensagens into v_usadas;

  if v_usadas is null then
    select u2.mensagens into v_usadas
      from public.peciclo_chat_uso u2
     where u2.usuario_id = p_usuario and u2.dia = v_dia;
    return query select false, coalesce(v_usadas, 0), p_limite_dia;
  end if;
  return query select true, v_usadas, p_limite_dia;
end;
$$;
```

E, em `src/trigger/coleta-experimental.ts`, depois de `coletarFuturos()`, gravar antes de gerar a planilha (a planilha continua recebendo o array em memória — comportamento inalterado):

```ts
await gravarFuturos(futuros, dataLocal); // upsert em peciclo_futuros_b3
```

## B) As 6 ferramentas

`strict: true` exige `additionalProperties: false` e **todos** os campos em `required`. Opcional se expressa com `anyOf` + `null`, não omitindo do `required`. Sem `minimum`/`maxLength` nos schemas: não são suportados em modo estrito — valide com zod no handler.

```ts
// lib/chat/ferramentas.ts
import type Anthropic from "@anthropic-ai/sdk";

const UF_GTA = ["MT", "MS", "RO", "PA"] as const;
const UF_SIF = ["GO", "SP"] as const;

export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "consultar_ciclo",
    description:
      "Série mensal da participação de fêmeas no abate — o indicador central do ciclo pecuário " +
      "(fêmeas ÷ total abatido). Use para 'como está o ciclo?', 'o abate de fêmeas está caindo?', " +
      "'qual a tendência?'. Devolve por mês: fêmeas, machos, total, % de fêmeas, variação contra o " +
      "mês anterior e contra o mesmo mês do ano anterior (em pontos percentuais), média móvel de 12 " +
      "meses e quantos estados entraram na linha. Escopo CONSOLIDADO soma apenas MT, MS, RO e PA " +
      "(GTA estadual). GO e SP vêm de metodologia diferente (inspeção federal SIGSIF) e só podem ser " +
      "consultados isolados: o nível absoluto deles não é comparável com os outros quatro.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        escopo: {
          type: "string",
          enum: ["CONSOLIDADO", ...UF_GTA, ...UF_SIF],
          description: "CONSOLIDADO = MT+MS+RO+PA. GO e SP são SIF federal, sempre isolados.",
        },
        de:  { type: "string", description: "Competência inicial no formato AAAA-MM." },
        ate: { type: "string", description: "Competência final no formato AAAA-MM." },
      },
      required: ["escopo", "de", "ate"],
      additionalProperties: false,
    },
  },
  {
    name: "comparar_estados",
    description:
      "Compara dois ou mais estados lado a lado numa mesma competência ou janela: participação de " +
      "fêmeas, volume e variações. Use para 'compare MT com MS', 'qual estado está descartando mais " +
      "matriz?'. Não misture UF de GTA (MT, MS, RO, PA) com UF de SIF (GO, SP) na mesma chamada — " +
      "a ferramenta recusa e explica por quê.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ufs: {
          type: "array",
          items: { type: "string", enum: [...UF_GTA, ...UF_SIF] },
          description: "Duas a seis UFs, todas da mesma metodologia.",
        },
        de:  { type: "string", description: "Competência inicial AAAA-MM." },
        ate: { type: "string", description: "Competência final AAAA-MM." },
      },
      required: ["ufs", "de", "ate"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_precos",
    description:
      "Preços de referência do CEPEA-ESALQ/USP e a relação de troca calculada a partir deles. " +
      "Use para 'qual a relação de troca hoje?', 'quanto está a arroba?', 'o bezerro subiu?'. " +
      "Séries: boi_gordo (R$/@, indicador CEPEA/B3), bezerro_ms (R$/cabeça, CEPEA/ESALQ-MS), " +
      "bezerro_sp (R$/cabeça). A relação de troca é quantas arrobas de boi gordo compram um bezerro " +
      "e usa boi_gordo com bezerro_ms, só em dias em que as duas séries existem. A série começou em " +
      "agosto de 2026: a fonte publica apenas o valor do dia, sem histórico anterior.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        series: {
          type: "array",
          items: { type: "string", enum: ["boi_gordo", "bezerro_ms", "bezerro_sp"] },
          description: "Séries desejadas. Vazio devolve todas.",
        },
        dias: {
          type: "integer",
          description: "Quantos dias corridos de histórico devolver, a contar do dado mais recente.",
        },
        incluir_relacao_troca: { type: "boolean", description: "Se true, devolve também a série da relação de troca." },
      },
      required: ["series", "dias", "incluir_relacao_troca"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_futuros",
    description:
      "Curva de futuros do boi gordo (BGI) da B3 na data mais recente coletada, com o prêmio de cada " +
      "contrato sobre o preço à vista do boi gordo. Use para 'o que os futuros estão dizendo?', " +
      "'o mercado espera alta?'. Curva subindo = alta já precificada; curva plana ou em queda com o " +
      "ciclo apontando retenção = fundamento ainda não refletido no preço. Devolve a data da coleta: " +
      "é um retrato diário, não intradiário.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        data_referencia: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Data AAAA-MM-DD da curva. null = a mais recente disponível.",
        },
      },
      required: ["data_referencia"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_cobertura",
    description:
      "O que existe no banco: última competência com dado por estado, meses faltantes, data da " +
      "última coleta bem-sucedida por UF, se o mês corrente é parcial e desde quando existe série de " +
      "preços. Chame antes de afirmar que um dado não existe, e sempre que a pergunta envolver 'o " +
      "dado mais recente' ou um período que pode estar incompleto.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "consultar_metodologia",
    description:
      "Regras de leitura e ressalvas de fonte, extraídas da referência do projeto. Use antes de " +
      "afirmar que um valor é alto ou baixo, ou de citar qualquer faixa histórica ou limiar. " +
      "Nunca cite um número de referência de memória: ele vem daqui.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        topico: {
          type: "string",
          enum: [
            "participacao_femeas", "relacao_troca", "futuros_b3", "fases_do_ciclo",
            "fonte_gta", "fonte_sif", "fonte_cepea", "prazos_do_ciclo",
          ],
        },
      },
      required: ["topico"],
      additionalProperties: false,
    },
  },
];
```

**Implementação de `consultar_ciclo` — reaproveitando o que já existe e é testado:**

```ts
// lib/chat/executar.ts
import { lerAbateMensal, type LinhaMensal } from "@/peciclo/dados/mensal";
import { lerAbateSif } from "@/peciclo/dados/experimental";
import { calcularKpis } from "@/peciclo/planilha/kpis";

export async function consultarCiclo(args: { escopo: string; de: string; ate: string }) {
  const ehSif = args.escopo === "GO" || args.escopo === "SP";

  // GTA e SIF são calculados SEPARADAMENTE, igual a gerar-experimental.ts:94.
  // Misturar as duas metodologias num consolidado único produz um percentual
  // sem significado. calcularKpis sempre emite uma linha "CONSOLIDADO": no
  // bloco SIF essa linha é GO+SP e precisa ser descartada aqui, senão o modelo
  // a lê como se fosse o consolidado do produto.
  const brutos: LinhaMensal[] = ehSif
    ? (await lerAbateSif()).map((d) => ({ ...d, uf: d.uf as LinhaMensal["uf"] }))
    : await lerAbateMensal();

  if (brutos.length === 0) {
    return { vazio: true, motivo: `Não há dado de abate carregado para ${args.escopo}.` };
  }

  const agora = new Date();
  const corrente = { ano: agora.getUTCFullYear(), mes: agora.getUTCMonth() + 1 };

  const linhas = calcularKpis(brutos)
    .filter((k) => k.uf === args.escopo)
    .filter((k) => dentroDaJanela(k, args.de, args.ate))
    .map((k) => ({
      competencia: `${k.ano}-${String(k.mes).padStart(2, "0")}`,
      femeas: k.femeas,
      machos: k.machos,
      total: k.total,
      // Já arredondado: o modelo não faz conta, só lê.
      pct_femeas: k.participacaoFemeas === null ? null : Number((k.participacaoFemeas * 100).toFixed(2)),
      var_mes_anterior_pp: arred(k.variacaoMesAnteriorPp),
      var_ano_anterior_pp: arred(k.variacaoAnoAnteriorPp),
      media_movel_12m_pct: k.mediaMovel12m === null ? null : Number((k.mediaMovel12m * 100).toFixed(2)),
      estados_incluidos: k.estados,
      parcial: k.ano === corrente.ano && k.mes === corrente.mes,
    }));

  if (linhas.length === 0) {
    return { vazio: true, motivo: `Sem dado de ${args.escopo} entre ${args.de} e ${args.ate}.` };
  }

  return {
    vazio: false,
    escopo: args.escopo,
    periodo: { de: args.de, ate: args.ate },
    fonte: ehSif
      ? "SIGSIF/MAPA — abate sob inspeção federal. Cobre só inspeção federal, então o nível absoluto é menor e NÃO é comparável com MT, MS, RO e PA. Use apenas a tendência."
      : "GTA dos órgãos estaduais (INDEA-MT, IAGRO-MS, IDARON-RO, ADEPARA-PA), finalidade ABATE.",
    observacoes: [
      "pct_femeas e as médias já vêm em porcentagem; as variações vêm em pontos percentuais.",
      "Linha com parcial=true é mês em andamento, somado dia a dia: não compare com meses fechados.",
      "No CONSOLIDADO, mês com estados_incluidos<4 não é comparável com os demais.",
    ],
    linhas,
  };
}
```

`arred` arredonda p.p. para 2 casas: `(v) => v === null ? null : Number((v * 100).toFixed(2))`.

## C) Prompt de sistema (o que garante "número nenhum sai da minha cabeça")

```ts
// lib/chat/prompt.ts
export const PROMPT_SISTEMA = `
Você é o analista do Peciclo. Conversa com pecuaristas e traders de boi gordo sobre o ciclo
pecuário brasileiro, usando os dados de abate, preço e futuros do próprio sistema.

## De onde vêm os números

Todo número que você escrever precisa ter vindo de um resultado de ferramenta desta conversa.
Você não tem números de abate, preço ou futuro na memória, e os que parecem estar são de outra
época. Se a resposta depende de um dado, chame a ferramenta antes de responder — inclusive
quando parece que você já sabe.

Você não faz contas. Percentuais, variações em pontos percentuais, médias móveis, relação de
troca e prêmio dos futuros já vêm calculados e arredondados nos resultados. Repasse o valor como
está. Se o usuário pedir um cálculo que nenhuma ferramenta entrega, diga que não tem esse número
em vez de derivá-lo.

Quando uma ferramenta devolve vazio:true, o dado não existe. Diga isso e diga o motivo que veio
junto. Não estime, não interpole, não use o mês anterior como se fosse o atual.

## Como ler os dados

Cite sempre o período e a fonte de cada número (GTA estadual, SIF federal, CEPEA, B3).

MT, MS, RO e PA vêm da GTA estadual e formam o consolidado. GO e SP vêm da inspeção federal
(SIGSIF): o nível absoluto é menor por construção e não é comparável com os outros quatro. Deles
use só a tendência da participação de fêmeas, e avise o usuário disso ao citá-los.

Linha com parcial:true é o mês em andamento, somado dia a dia. Nunca a compare com meses fechados
nem a use para afirmar tendência.

No consolidado, mês com estados_incluidos menor que 4 está faltando estado. Se falta um estado com
participação de fêmeas atípica, o percentual desloca sem que o mercado tenha mudado — avise.

Faixas históricas, limiares e prazos do ciclo vêm de consultar_metodologia. Não cite nenhum
número de referência de memória.

## Como responder

As fases do ciclo se sobrepõem e a virada é gradual. Um único mês fora da média não muda de fase;
o que conta é a direção sustentada contra a média histórica. Diga isso quando o dado for ambíguo,
em vez de escolher um lado.

Comece pela resposta: a primeira frase responde a pergunta. Detalhe e ressalva vêm depois.
Responda em português do Brasil, direto, no vocabulário de quem opera boi gordo. Sem preâmbulo.

Você mostra dado e leitura de mercado. Não faz recomendação de compra, venda ou posição em futuro.
Se pedirem, mostre o que os dados dizem e deixe a decisão com o usuário.
`.trim();
```

## D) Route handler Next.js — loop de tool use + streaming SSE

```ts
// app/api/chat/route.ts
import Anthropic from "@anthropic-ai/sdk";
import { FERRAMENTAS } from "@/lib/chat/ferramentas";
import { executarFerramenta } from "@/lib/chat/executar";
import { PROMPT_SISTEMA } from "@/lib/chat/prompt";
import { autenticar } from "@/lib/auth";
import { carregarHistorico, gravarTurno, registrarUso, reservarCota } from "@/lib/chat/persistencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELO = "claude-opus-5";
const MAX_TOKENS = 4096;   // teto de thinking + texto juntos, não só do texto
const MAX_ITERACOES = 6;   // trava do loop: cada volta é uma chamada paga

const anthropic = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente do servidor

export async function POST(request: Request) {
  const usuario = await autenticar(request);
  if (!usuario) return Response.json({ erro: "não autenticado" }, { status: 401 });

  const { conversaId, texto } = await request.json();
  if (typeof texto !== "string" || texto.trim() === "" || texto.length > 2000) {
    return Response.json({ erro: "mensagem inválida" }, { status: 400 });
  }

  const cota = await reservarCota(usuario.id);
  if (!cota.permitido) {
    return Response.json(
      { erro: `Limite diário atingido (${cota.usadas}/${cota.limite}). Volta amanhã.` },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }

  // O histórico vem do banco, nunca do cliente.
  const historico = await carregarHistorico(conversaId, usuario.id, { ultimosTurnos: 12 });

  const messages: Anthropic.MessageParam[] = [
    ...historico,
    { role: "user", content: texto },
    // Data do dia como mensagem system NO MEIO de messages (suportado no Opus 5,
    // sem beta header). Se fosse interpolada no prompt de sistema, o prefixo
    // mudaria de bytes todo dia e o cache nunca seria lido.
    { role: "system", content: `Hoje é ${hojeSaoPaulo()} (America/Sao_Paulo).` },
  ];

  const encoder = new TextEncoder();
  const uso = { entrada: 0, saida: 0, cache: 0 };

  const corpo = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (evento: string, dados: unknown) =>
        controller.enqueue(encoder.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));

      let concluiu = false;
      try {
        for (let i = 0; i < MAX_ITERACOES && !concluiu; i++) {
          const stream = anthropic.messages.stream({
            model: MODELO,
            max_tokens: MAX_TOKENS,
            // effort baixo/médio é o principal controle de custo e latência no
            // Opus 5. O pensamento fica LIGADO: desligá-lo neste modelo faz o
            // modelo às vezes escrever a chamada de ferramenta como TEXTO — o
            // turno termina com sucesso e a ferramenta nunca roda.
            output_config: { effort: "medium" },
            system: [
              // Único breakpoint de cache. A ordem de renderização é
              // tools -> system -> messages, então marcar o último bloco de
              // system guarda tools+system juntos. Prefixo ~2.2k tokens, acima
              // do mínimo de 512 do Opus 5.
              { type: "text", text: PROMPT_SISTEMA, cache_control: { type: "ephemeral" } },
            ],
            tools: FERRAMENTAS,
            messages,
          });

          for await (const evento of stream) {
            if (request.signal.aborted) break;
            if (evento.type === "content_block_start" && evento.content_block.type === "thinking") {
              enviar("pensando", { ativo: true });
            }
            if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
              enviar("texto", { delta: evento.delta.text });
            }
          }

          const resposta = await stream.finalMessage();
          uso.entrada += resposta.usage.input_tokens;
          uso.saida += resposta.usage.output_tokens;
          uso.cache += resposta.usage.cache_read_input_tokens ?? 0;

          messages.push({ role: "assistant", content: resposta.content });

          if (resposta.stop_reason !== "tool_use") {
            concluiu = true;
            enviar("fim", { motivo: resposta.stop_reason, uso });
            break;
          }

          const chamadas = resposta.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          // Paralelo de propósito: "compare MT com MS" vira duas chamadas no
          // mesmo turno. Os resultados voltam TODOS numa ÚNICA mensagem user —
          // dividir em várias ensina o modelo a parar de paralelizar.
          const resultados = await Promise.all(
            chamadas.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
              enviar("ferramenta", { nome: c.name, estado: "executando" });
              try {
                const saida = await executarFerramenta(c.name, c.input);
                return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(saida) };
              } catch (erro) {
                // Erro volta como tool_result com is_error, nunca é descartado:
                // um tool_use sem tool_result correspondente quebra o próximo request.
                return {
                  type: "tool_result",
                  tool_use_id: c.id,
                  is_error: true,
                  content: `Falha ao consultar: ${erro instanceof Error ? erro.message : String(erro)}`,
                };
              }
            }),
          );
          messages.push({ role: "user", content: resultados });
        }

        if (!concluiu) enviar("fim", { motivo: "limite_de_iteracoes", uso });
      } catch (erro) {
        enviar("erro", {
          mensagem:
            erro instanceof Anthropic.RateLimitError ? "Serviço ocupado, tente em instantes."
            : erro instanceof Anthropic.APIError ? `Falha na API (${erro.status}).`
            : "Falha interna.",
        });
      } finally {
        await gravarTurno(conversaId, usuario.id, messages);
        await registrarUso(usuario.id, uso);
        controller.close();
      }
    },
  });

  return new Response(corpo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no", // sem isto, proxy nginx/CDN bufferiza e o stream chega de uma vez
    },
  });
}
```

## E) Custo por conversa e ledger

```ts
// US$ por milhão de tokens — claude-opus-5, conferido em platform.claude.com em 2026-08-05
const PRECO = { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 };

export function custoUsd(u: Anthropic.Usage): number {
  return (
    ((u.input_tokens ?? 0) * PRECO.entrada +
     (u.output_tokens ?? 0) * PRECO.saida +
     (u.cache_read_input_tokens ?? 0) * PRECO.cacheLeitura +
     (u.cache_creation_input_tokens ?? 0) * PRECO.cacheEscrita) / 1_000_000
  );
}
```

Camadas de contenção, da mais barata para a mais cara de implementar: `max_tokens: 4096` → `MAX_ITERACOES: 6` → limite de 2.000 caracteres na pergunta → histórico truncado em 12 turnos → cota diária por usuário (RPC atômico acima) → teto mensal de custo em `peciclo_chat_uso.custo_usd` que devolve 402 e alerta o operador pela Evolution API (já existe `alertarOperador` em `src/notificacao/alertas.ts`).
```

### Armadilhas
- A curva de futuros da B3 NÃO existe no banco. src/trigger/coleta-experimental.ts:69 diz explicitamente 'não persistida: é sempre o retrato do dia' — coletarFuturos() alimenta só o xlsx. Sem criar peciclo_futuros_b3 e passar a gravar, a pergunta 'o que os futuros estão dizendo?' não tem fonte. Raspar ao vivo no request não é opção: é HTML de terceiro, com timeout de 60s no coletor atual.
- Text-to-SQL com service_role é vazamento cross-tenant, não só risco de query ruim. A migração 20260727120000 diz que 'o projeto Supabase é compartilhado com outros sistemas e o prefixo isola os objetos deste'. RLS está ligada sem policy, então o único papel que lê peciclo_* é service_role — que também lê auth.users e todas as tabelas dos outros sistemas. Um prompt injection numa pergunta do fazendeiro vira SELECT em tabela alheia. Se um dia quiserem text-to-SQL, precisa ser papel dedicado read-only, com GRANT só nas 5 tabelas peciclo_, statement_timeout e search_path fixo.
- finalidade = 'ABATE' é igualdade exata, nunca prefixo. src/dados/mensal.ts:94 registra o motivo: 'ABATE SANITÁRIO' e 'SACRIFÍCIO' são abate por determinação sanitária, não decisão econômica do pecuarista. Qualquer ferramenta nova que consulte peciclo_abate_mensal direto (em vez de chamar lerAbateMensal) tem que repetir esse filtro, ou o indicador do chat diverge do da planilha.
- calcularKpis SEMPRE emite uma linha de escopo CONSOLIDADO, inclusive quando você passa só dados do SIF — e aí ela é GO+SP. gerar-experimental.ts:94 evita isso rodando GTA e SIF em blocos separados e rotulando a fonte. A ferramenta consultar_ciclo tem que descartar (ou renomear) o CONSOLIDADO do bloco SIF; se vazar, o modelo lê como se fosse o consolidado do produto e o número está errado por construção.
- GO e SP são SIGSIF federal: o nível absoluto é menor por metodologia e não é comparável com MT/MS/RO/PA (forte em SP, segundo a própria migração). O modelo vai querer somar tudo num total nacional se a ferramenta deixar. Bloqueie na ferramenta (comparar_estados recusa mistura de metodologias), não só no prompt.
- peciclo_precos.valor é numeric(14,4) e o supabase-js devolve numeric como STRING. src/dados/experimental.ts:86 faz Number(p.valor) justamente por isso. Uma ferramenta nova que esqueça a conversão soma strings e produz relação de troca sem sentido, sem lançar erro.
- O Supabase corta em 1000 linhas silenciosamente e sem erro. src/dados/paginar.ts existe por isso (o comentário em mensal.ts:87 avisa que, com ordem crescente, seriam os meses RECENTES a sumir). Toda consulta nova do chat usa lerTudo ou um .limit() explícito e consciente.
- Se o cliente puder enviar o array messages, o usuário forja um tool_result com números inventados e o modelo os relata com total convicção — é a forma mais fácil de furar todo o esquema anti-alucinação. Histórico no servidor, cliente manda só {conversaId, texto}. O mesmo vale para o campo system: nunca aceite string vinda do navegador.
- Interpolar 'hoje é DD/MM' dentro do PROMPT_SISTEMA invalida o cache de prompt todo dia (o cache é match de prefixo por bytes). Use mensagem {role:'system'} dentro de messages — suportado no Opus 5 e no Opus 4.8, NÃO no Sonnet 5, que devolve 400 'role system is not supported on this model'. Se um dia trocarem para Sonnet 5, esse trecho quebra.
- Desligar o pensamento no Opus 5 (thinking: {type:'disabled'}) tem dois modos de falha conhecidos e silenciosos: o modelo às vezes escreve a chamada de ferramenta como texto visível — o turno termina com sucesso, a ferramenta nunca roda, e nada aparece no log — e às vezes vaza tags <thinking> na resposta. Além disso, disabled só é aceito com effort até 'high': com xhigh/max é 400. Deixe ligado e controle custo pelo effort.
- max_tokens no Opus 5 é teto de pensamento MAIS texto juntos, e o pensamento está ligado por padrão. Um max_tokens apertado trunca a resposta no meio (stop_reason 'max_tokens'). 4096 com effort medium é folgado para chat; 1024 não é.
- Com strict:true o schema não aceita minimum/maximum/minLength — valide faixa (ex.: dias entre 1 e 365, ufs entre 2 e 6) com zod dentro de executarFerramenta, não no input_schema.
- Todo tool_use precisa de um tool_result correspondente no próximo request, inclusive quando a ferramenta falhou (use is_error:true). Descartar um resultado por causa de exceção deixa a conversa em estado inválido e o request seguinte volta 400.
- Devolver os tool_result de chamadas paralelas em mensagens user separadas ensina o modelo a parar de paralelizar. Todos os resultados do mesmo turno vão numa única mensagem user.
- Sem 'x-accel-buffering: no' e 'cache-control: no-transform', proxy/CDN na frente do Next bufferiza o SSE e o usuário recebe a resposta inteira de uma vez — parece que o streaming não funciona, mas o servidor está correto.
- Se o projeto Supabase já usa Supabase Auth para outro sistema, ligar login do Peciclo em auth.users mistura as bases de usuário dos dois produtos e o desligamento de auto-cadastro é uma configuração do PROJETO inteiro, não do app. Confirme antes; se houver conflito, use uma tabela peciclo_usuarios própria com sessão assinada no servidor.
- A retenção de contexto do chat vira dado sensível: as conversas do fazendeiro ficam em peciclo_chat_mensagens. Defina prazo de expurgo antes de ligar, não depois.
- A rotina do WhatsApp é a receita que já paga o produto. Nada do chat deve importar, alterar ou compartilhar task com src/trigger/*. Reaproveite apenas as funções puras de src/planilha/kpis.ts e src/planilha/mercado.ts, que não têm efeito colateral.

---

## Texto diário do ciclo pecuário: o que os dados sustentam, as regras determinísticas que classificam o cenário, e por que a IA só pode redigir
**Recomendação:** Construa o texto com um motor de regras determinístico que produz um objeto de FATOS + CLASSIFICAÇÃO a partir de três blocos independentes (abate mensal com composição fixa e leitura só ano-a-ano; ritmo diário do mês corrente só para MS, que é o único com detalhe por dia e um ano de comparação; preços/futuros do dia contra o carrego do CDI), e use a IA apenas como redatora sob um contrato rígido — porque os dados verificados hoje mostram que o único sinal honesto de ciclo é a variação anual da média móvel de 3 meses (−4,13 p.p. em jun/26, quarto mês seguido de queda), enquanto tudo que muda diariamente no abate é ruído de calendário.

### Achados

## 1. O estado real dos dados (lido no banco de produção em 05/08/2026, somente SELECT)

| Tabela | O que tem de verdade |
|---|---|
| `peciclo_abate_mensal` | 887 linhas, jan/2025 → **ago/2026 parcial**. MT/MS/RO até jul/26; **PA parou em mai/2026** (3 meses de atraso) |
| `peciclo_gta_registros` | 2.299.852 linhas. **MS com detalhe diário de 2025-01-01 a 2026-08-04**; PA de 2024-05-14 a **2026-05-31** |
| `peciclo_precos` | **6 linhas, 2 datas apenas**: 31/07 e 04/08/2026 |
| `peciclo_abate_sif` | 1.166 linhas, **GO desde mar/2000 e SP desde out/2002** — 26 anos de histórico mensal |
| Futuros BGI | **não são persistidos** (`coleta-experimental.ts`: "não persistida: é sempre o retrato do dia") |

**Consequência imediata:** a série própria de preços tem 2 observações. Qualquer frase sobre "tendência de preço" hoje é invenção. Boi gordo foi de R$ 346,55 (31/07) para R$ 350,20 (04/08); bezerro MS de R$ 3.377,23 para R$ 3.369,17. A relação de troca "caiu" de 9,75 para 9,62 @/bezerro — dois pontos não são tendência.

## 2. O que É honestamente afirmável todo dia

**a) A fase do ciclo, pela variação ANUAL da média móvel de 3 meses.** Calculei sobre composição fixa MT+MS+RO (os 3 com 18 meses completos):

| Competência | mm3 %fêmeas | Δ a/a da mm3 |
|---|---|---|
| mar/2026 | 53,04% | −1,95 p.p. |
| abr/2026 | 54,02% | −2,26 p.p. |
| mai/2026 | 52,71% | −3,37 p.p. |
| **jun/2026** | **51,52%** | **−4,13 p.p.** |

Quatro meses seguidos de queda, monotonicamente crescente em intensidade. E o lado do volume confirma: em jun/26 saíram **9,7% menos fêmeas** e **9,5% mais machos** que jun/25. Isso é retenção de matrizes, e é afirmável.

**b) O nível de preços contra referências publicadas.** 9,62 @/bezerro hoje, contra 9,12 em abr/26 e 10,13 na média parcial de jul/26 — que o Cepea/Farmnews (31/07/2026) apontou como **2º maior valor da série desde jan/2020**, atrás só de out/2021.

**c) A curva da B3 contra o custo do dinheiro.** Esta é a leitura mais útil e a menos feita. Curva de 04/08 (Notícias Agrícolas, republicando B3), disponível a R$ 350,20, CDI a 14,15% a.a.:

| Contrato | Ajuste | Prêmio s/ à vista | Vs. carrego CDI |
|---|---|---|---|
| Ago/26 | 346,25 | −1,13% | **−2,09%** |
| Set/26 | 346,75 | −0,99% | **−3,01%** |
| Out/26 | 354,70 | +1,28% | **−1,86%** |
| Dez/26 | 361,40 | +3,20% | **−2,19%** |
| Fev/27 | 369,85 | +5,61% | **−1,99%** |

**Todos os sete vencimentos estão de 1,2% a 3,0% abaixo do carrego.** O prêmio nominal de +5,61% em 6 meses parece alta precificada; anualizado dá ~11,3%, contra CDI de 14,15%. A curva não está pagando para segurar boi. Isso é aritmética, não opinião — e é exatamente o que um operador de futuro precisa ouvir.

**d) O ritmo diário do mês corrente — mas só para MS.** É a única fonte com detalhe por `data_emissao` e um ano inteiro de comparação. MS, 01–04/ago:

- 2026: 33.455 cabeças, **49,60% fêmeas**
- 2025: 41.505 cabeças, **51,23% fêmeas** → Δ −1,63 p.p.

Isso muda todo dia e é comparação igual-com-igual. É a resposta para "como fazer o texto mudar sem inventar movimento".

## 3. O que NÃO é afirmável

**Nada sobre "o Brasil".** O IBGE mediu **49,9% de fêmeas no 1º tri/2026 — recorde da série, muito acima da média de 44,4% para 1ºs trimestres (2010–2026)** — e descreveu isso como *"retomada do crescimento do abate de fêmeas, após dois trimestres sucessivos de queda"*. Ou seja: o headline nacional diz o oposto do que os 4 estados de GTA dizem. As duas coisas podem ser verdade (metodologia diferente, composição de estados diferente, GTA é intenção na origem e IBGE é abate consumado). O texto precisa dizer **"nos quatro estados que medimos, pela GTA"** — sempre, sem exceção.

**Nenhum limiar de nível.** A série GTA dos 4 estados roda em **49%–58%** de fêmeas; o SIF de GO roda em 26% e o de SP em 22% (média 2013+). O "acima de 45% = liquidação" que circula é do agregado nacional do IBGE e **não se aplica a nenhuma dessas séries**. Só a direção contra a própria história tem significado.

**Nenhuma leitura mês-a-mês.** Medi o índice sazonal do %fêmeas nos 13 anos completos do SIF: **GO varia de +12,0 p.p. em fevereiro a −9,3 p.p. em outubro** (SP: +8,1 a −7,2), com desvio-padrão do próprio índice de 1,4 a 4,6 p.p. A amplitude sazonal é 3 a 8 vezes o ruído. A série GTA dos 4 estados tem a mesma forma (pico fev–abr, fundo set–dez). **A variação mês anterior que já está na aba "Ciclo" da planilha é majoritariamente calendário, não mercado** — e a mediana de |Δ m/m| por UF é 2,1–2,7 p.p. (PA chega a 27,4 p.p.).

**Nada sobre um dia isolado de abate.** Em jun/26, o %fêmeas diário do MS oscilou entre **35,6% e 58,2%** nos dias úteis, e entre 28,7% e 76,3% nos fins de semana (que são só 3,3% do volume). Um dia não diz nada. Feriado também distorce: 04/06/2026 (Corpus Christi) teve 3.088 cabeças contra ~16 mil de uma quinta normal.

**Nada sobre a curva de ontem.** Os futuros não são gravados. "A curva subiu hoje" é literalmente incomputável até isso mudar.

## 4. A armadilha que já está armada: julho/2026

| Competência | Total MT+MS+RO | vs. ano anterior |
|---|---|---|
| jun/2026 | 1.271.232 | **−1,0%** |
| **jul/2026** | **1.069.340** | **−22,3%** |

Julho/2026 tem 48,94% de fêmeas — e um texto ingênuo diria "queda forte, retenção acelerando". É falso: o mês está **22% incompleto**. MT e RO foram congelados na coleta de 31/07 09:01 e a `rejanela-semanal` só reprocessa MS, 10 dias para trás. Um gate de completude a 90% do mesmo mês do ano anterior reprova julho e aprova os 6 meses anteriores (−4,1%, −4,5%, +15,3%, +1,6%, −2,0%, −1,0%) — zero falsos positivos nos dados disponíveis.

E os meses continuam se mexendo depois de fechados: MS jun/26 estava em 358.726 cabeças no CSV de referência e está em 362.608 no banco hoje (+1,1%).

## 5. Divergência interna que o texto precisa respeitar

O SIF confirma parcialmente e diverge parcialmente: a média móvel de 12 meses de GO caiu **−1,41 p.p.** contra 12 meses atrás (31,59% → 30,18% na leitura invertida: 32,99% um ano antes, 31,59% agora), mas a de **SP subiu +1,12 p.p.** (19,91% → 21,03%). GO confirma retenção, SP não. Se a regra exigir unanimidade, ela nunca dispara; se ignorar a divergência, o texto mente. A saída é reportar o placar ("2 de 3 blocos confirmam") em vez de fingir consenso.

## Fontes consultadas
- [IBGE — abates 1º tri/2026, 49,9% de fêmeas, recorde](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/47167-abates-de-bovinos-suinos-e-frangos-tem-o-melhor-resultado-para-um-1-trimestre)
- [Farmnews 31/07/2026 — 10,13 @/bezerro, 2º maior desde jan/2020 (dados Cepea)](https://farmnews.com.br/mercado/arrobas-de-boi-gordo-por-bezerro-indicador-cai-em-julho-2/)
- [CEPEA — metodologia do Indicador do Boi Gordo ESALQ/B3 (SP, 5 regiões, média ponderada por cabeças, conversão a valor presente pelo CDI)](https://www.cepea.org.br/upload/kceditor/files/Metodologia_IndBOI_atualizada_mar_2019.pdf)
- [B3 — contrato futuro BGI: 330 arrobas líquidas, liquidação financeira pela média dos últimos pregões do Indicador CEPEA/B3, vencimento em todos os meses](https://edu.b3.com.br/w/futuro-boi-gordo)
- [Scot Consultoria — virada do ciclo e retenção escalonada até início de 2028](https://www.scotconsultoria.com.br/noticias/entrevistas/2025/02/714/)
- [CEPEA — sazonalidade: outubro em média 5,2% acima de maio (média de 10 anos)](https://www.canalrural.com.br/pecuaria/boi-gordo-sobe-no-primeiro-semestre-e-quebra-padrao-historico-aponta-cepea/)
- [Selic 14,25% / CDI 14,15% a.a. em ago/2026](https://investidor10.com.br/indices/selic/)

### Código / SQL verificado

```
## A. SQL — série de composição fixa e gate de completude

> Escritas contra o schema real (`peciclo_abate_mensal` tem `competencia` gerada). **NÃO executadas**: li os dados via PostgREST, não via SQL.

```sql
-- 1) Painel de composição FIXA. Um mês só entra se TODAS as UFs do painel
-- tiverem dado. Sem isso, jun/2026 (n=3, sem PA) cai para 49,84% e nov/2025
-- (n=3) para 53,15% — degraus que parecem mercado e são só composição.
create or replace view public.peciclo_v_ciclo_painel as
with painel(uf) as (values ('MT'),('MS'),('RO')),
base as (
  select m.competencia, m.uf,
         sum(m.quantidade) filter (where m.sexo = 'FEMEA') as femeas,
         sum(m.quantidade) filter (where m.sexo = 'MACHO') as machos
  from public.peciclo_abate_mensal m
  join painel p on p.uf = m.uf
  where m.finalidade = 'ABATE'          -- igualdade exata, nunca prefixo
  group by 1, 2
  having sum(m.quantidade) > 0
)
select competencia,
       count(*)                                            as ufs,
       sum(femeas)                                         as femeas,
       sum(machos)                                         as machos,
       sum(femeas + machos)                                as total,
       sum(femeas)::numeric / sum(femeas + machos)         as pct_femeas
from base
group by 1
having count(*) = (select count(*) from painel);

-- 2) Métricas: mm3, variação ANUAL da mm3, e o gate de completude.
create or replace view public.peciclo_v_ciclo_metricas as
with m as (
  select s.*,
         avg(pct_femeas) over w as mm3,
         count(*)        over w as n_janela
  from public.peciclo_v_ciclo_painel s
  window w as (order by competencia rows between 2 preceding and current row)
)
select a.competencia,
       a.total, a.pct_femeas, a.mm3,
       (a.pct_femeas - b.pct_femeas) * 100          as yoy_pp,
       (a.mm3        - b.mm3)        * 100          as yoy_mm3_pp,
       a.femeas::numeric / nullif(b.femeas,0) - 1   as femeas_yoy,
       a.machos::numeric / nullif(b.machos,0) - 1   as machos_yoy,
       a.total::numeric  / nullif(b.total,0)        as completude,
       -- gate: 3 meses cheios dos dois lados E volume >= 90% do ano anterior
       (a.n_janela = 3 and b.n_janela = 3
        and a.total >= 0.90 * b.total)              as utilizavel
from m a
left join m b
  on b.competencia = (a.competencia - interval '1 year')::date
order by a.competencia desc;
```

**Saída verificada (calculada fora do banco, com os mesmos números):**
```
competencia  total      pct_femeas  yoy_mm3_pp  completude  utilizavel
2026-07-01   1.069.340  48,94%      —           77,7%       FALSE   <-- reprovado
2026-06-01   1.271.232  49,84%*     -4,13       99,0%       TRUE    <-- mês de referência
2026-05-01   1.249.134  51,32%      -3,37       98,0%       TRUE
2026-04-01   1.207.183  53,40%      -3,95→-2,26 101,6%      TRUE
```
\* jun/2026 no painel MT+MS+RO = 49,84%; mm3 (abr–jun) = 51,52%.

```sql
-- 3) Ritmo do mês corrente — a parte que muda TODO DIA sem inventar nada.
-- Só MS: é a única UF com data_emissao diária e um ano de comparação.
with alvo as (
  select date_trunc('month', $1::date)::date as ini, $1::date as fim
),
janelas(rotulo, ini, fim) as (
  select 'atual', ini, fim from alvo
  union all
  select 'ano_anterior', (ini - interval '1 year')::date,
                         (fim - interval '1 year')::date from alvo
)
select j.rotulo,
       count(distinct r.data_emissao) filter (
         where extract(isodow from r.data_emissao) <= 5) as dias_uteis,
       sum(r.quantidade)                                  as cabecas,
       sum(r.quantidade) filter (where r.sexo = 'FEMEA')::numeric
         / nullif(sum(r.quantidade), 0)                   as pct_femeas
from janelas j
join public.peciclo_gta_registros r
  on r.uf = 'MS' and r.finalidade = 'ABATE'
 and r.data_emissao between j.ini and j.fim
group by j.rotulo;
```

**Saída verificada para `$1 = '2026-08-04'`:**
```
atual         33.455 cabeças  49,60% fêmeas
ano_anterior  41.505 cabeças  51,23% fêmeas   -> Δ -1,63 p.p.
```

## B. TypeScript — o motor de regras (decide O QUE dizer)

```ts
// src/texto/regras.ts  — 100% determinístico, zero IA, 100% testável.

export type Forca = "sem_sinal" | "inclinacao" | "claro";
export type Direcao = "retencao" | "liquidacao" | "lateral";

/** Limiares. Cada um justificado pelos dados medidos — ver comentários. */
export const LIMIARES = {
  // Ruído mensal medido: mediana |Δ m/m| = 2,1–2,7 p.p. por UF; amplitude
  // sazonal do %fêmeas = 21 p.p. (SIF GO, 13 anos). Por isso NUNCA usamos m/m:
  // só Δ a/a da média móvel de 3 meses, que anula sazonalidade e divide o
  // resíduo por ~raiz(3).
  SEM_SINAL_PP: 1.0,   // |Δ| < 1,0 p.p. -> não há sinal
  CLARO_PP: 2.5,       // |Δ| >= 2,5 p.p. -> sinal claro
  MESES_PERSISTENCIA: 3, // o IBGE teve "dois trimestres de queda" seguidos de
                         // recorde de alta: um mês virando não é fase.
  COMPLETUDE_MIN: 0.90,  // jul/26 ficou em 77,7% (reprova); os 6 meses
                         // anteriores ficaram entre 95,5% e 115,3% (aprovam).
  MIN_DIAS_RITMO: 7,     // abaixo disso o acumulado do mês é ruído de calendário
  BASE_CARREGO_PP: 1.0,  // banda neutra em torno do carrego do CDI
} as const;

export interface FatosCiclo {
  competencia: string; mm3: number; yoyMm3Pp: number;
  femeasYoy: number; machosYoy: number;
  mesesMesmoSinal: number; painel: string[];
}

export function classificarAbate(f: FatosCiclo): { direcao: Direcao; forca: Forca } {
  const d = f.yoyMm3Pp;
  const abs = Math.abs(d);
  if (abs < LIMIARES.SEM_SINAL_PP) return { direcao: "lateral", forca: "sem_sinal" };

  const direcao: Direcao = d < 0 ? "retencao" : "liquidacao";
  // Confirmação pelo VOLUME: retenção real = menos fêmea E não-menos macho.
  // Sem isso, uma queda no %fêmeas causada por colapso geral do abate
  // (frigorífico parado, embargo) seria lida como retenção.
  const volumeConfirma = direcao === "retencao"
    ? f.femeasYoy < 0 && f.machosYoy >= f.femeasYoy
    : f.femeasYoy > 0 && f.machosYoy <= f.femeasYoy;

  const persistente = f.mesesMesmoSinal >= LIMIARES.MESES_PERSISTENCIA;
  const forca: Forca =
    abs >= LIMIARES.CLARO_PP && persistente && volumeConfirma ? "claro" : "inclinacao";
  return { direcao, forca };
}

/** Futuros: o prêmio nominal engana. O que decide é o prêmio CONTRA o CDI. */
export function classificarCurva(
  spot: number, contratos: Array<{ nome: string; ajuste: number; dias: number }>, cdiAA: number,
) {
  const itens = contratos.map((c) => {
    const carrego = spot * Math.pow(1 + cdiAA, c.dias / 365);
    return { ...c, premioPct: (c.ajuste / spot - 1) * 100,
             vsCarregoPct: (c.ajuste / carrego - 1) * 100 };
  });
  const ref = itens.at(-1)!; // vencimento mais distante disponível
  const leitura =
    ref.vsCarregoPct < -LIMIARES.BASE_CARREGO_PP ? "abaixo_do_carrego"
    : ref.vsCarregoPct > LIMIARES.BASE_CARREGO_PP ? "acima_do_carrego" : "no_carrego";
  return { itens, leitura, todosAbaixo: itens.every((i) => i.vsCarregoPct < 0) };
}

/** Preço: com N < 20 observações próprias, PROIBIDO falar em tendência. */
export function classificarPreco(obs: number) {
  return obs >= 20 ? "tendencia_permitida" : "so_nivel";
}
```

## C. Objeto de fatos que o motor produz HOJE (05/08/2026)

Todos os campos abaixo foram **calculados a partir dos dados reais lidos do banco e da B3 hoje**:

```json
{
  "data": "2026-08-05",
  "abate": {
    "painel": ["MT","MS","RO"], "competencia": "2026-06",
    "mm3": 0.5152, "yoyMm3Pp": -4.13, "mesesMesmoSinal": 4,
    "femeasYoy": -0.097, "machosYoy": 0.095,
    "classificacao": { "direcao": "retencao", "forca": "claro" }
  },
  "ritmo_ms": { "ate": "2026-08-04", "dias": 4, "pctAtual": 0.4960,
                "pctAnoAnterior": 0.5123, "deltaPp": -1.63,
                "usavel": false, "motivo": "menos de 7 dias" },
  "precos": { "boiGordo": 350.20, "bezerroMs": 3369.17, "data": "2026-08-04",
              "arrobasPorBezerro": 9.62, "observacoes": 2, "modo": "so_nivel",
              "refExterna": { "abr26": 9.12, "jul26parcial": 10.13,
                              "posicaoHistorica": "2ª maior desde jan/2020" } },
  "futuros": { "spot": 350.20, "cdiAA": 0.1415,
               "curva": [["Ago/26",346.25,-2.09],["Set/26",346.75,-3.01],
                         ["Out/26",354.70,-1.86],["Nov/26",356.35,-2.51],
                         ["Dez/26",361.40,-2.19],["Jan/27",369.00,-1.22],
                         ["Fev/27",369.85,-1.99]],
               "leitura": "abaixo_do_carrego", "todosAbaixo": true },
  "ressalvas": [
    "jul/2026 reprovado no gate: volume 22,3% abaixo de jul/2025",
    "PA fora do painel: último dado mai/2026 (3 meses de atraso)",
    "série própria de preços com 2 observações",
    "curva de futuros não é persistida: sem comparação com ontem"
  ]
}
```

## D. Estrutura do texto — 5 frases fixas + 1 condicional + rodapé

**Frase 1 — Veredito.** Fase + força + escopo explícito. Nunca "no Brasil".
**Frase 2 — O fato do abate.** O número que sustenta o veredito, com mês e volume por sexo.
**Frase 3 — Preço hoje.** Nível de boi, bezerro e relação de troca, ancorado em referência externa datada.
**Frase 4 — O que o mercado já pagou.** Curva contra o carrego do CDI, em reais.
**Frase 5 — Ritmo do mês corrente** (só quando `usavel = true`).
**Frase 6 — Ressalvas** (só quando existem).
**Rodapé fixo** — data de cada insumo, fonte, e a linha "não é recomendação".

### Texto que as regras produzem HOJE, palavra por palavra

> **Ciclo — 05/08/2026**
>
> Nos quatro estados de GTA que acompanhamos, o sinal é de **retenção de matrizes, claro e persistente**: a média de 3 meses da participação de fêmeas fechou junho/2026 em 51,5%, **4,1 p.p. abaixo** do mesmo trimestre de 2025 — quarto mês seguido de queda na comparação anual.
>
> O movimento vem do lado certo: em junho saíram **9,7% menos fêmeas** para abate que em junho/2025, e **9,5% mais machos**. Menos matriz no frigorífico hoje é menos bezerro no mercado daqui a 18 a 24 meses.
>
> A arroba do boi gordo está em **R$ 350,20** e o bezerro MS em **R$ 3.369,17** — **9,62 arrobas por bezerro**. Em abril foram 9,12 e a média parcial de julho, 10,13, o 2º maior valor desde 2020 segundo o Cepea. Reposição cara é o preço que o mercado cobra pela escassez de cria.
>
> A curva da B3 fecha agosto a R$ 346,25 e fevereiro/27 a R$ 369,85 — 5,6% acima do disponível em seis meses, mas **2,0% abaixo do que renderia vender hoje e aplicar no CDI** (14,15% a.a.). Os sete vencimentos estão de 1,2% a 3,0% abaixo do carrego: **a curva não está pagando para segurar boi**.
>
> Ressalvas de hoje: julho/2026 ficou fora da conta — o volume dos três estados está 22% abaixo de julho/2025, o que é dado incompleto e não queda de mercado. O Pará está com 3 meses de atraso e não entra no consolidado. A série própria de preços tem 2 dias, então há leitura de nível, não de tendência.
>
> *Abate: GTA de MT, MS e RO, até jun/2026. Preços: CEPEA-ESALQ/USP, 04/08/2026. Futuros: BGI/B3, 04/08/2026. Não é recomendação de compra ou venda.*

**Tom:** número antes do adjetivo; nenhum "pode ser que"; nenhum ponto de exclamação; nenhum verbo no imperativo. Quem opera futuro quer saber o preço, a base e o carrego — não quer entusiasmo.

## E. Contrato da IA redatora (decide COMO dizer, nunca O QUE)

```
Você recebe um JSON de FATOS já classificados. Escreva 5 a 6 frases em
português do Brasil, na ordem exata dos campos.

PROIBIDO:
- inventar, arredondar ou omitir qualquer número do JSON;
- usar qualquer palavra de direção ("subindo", "caindo", "tendência") sobre
  um bloco cujo campo `modo` seja "so_nivel" ou cujo `usavel` seja false;
- escrever "no Brasil", "nacional" ou "no país" — o escopo é `abate.painel`;
- omitir qualquer item de `ressalvas`;
- recomendar comprar, vender, travar ou esperar.

OBRIGATÓRIO:
- força do sinal exatamente como em `classificacao.forca`:
  "sem_sinal" -> "sem sinal definido"; "inclinacao" -> "inclinação, ainda
  sem confirmação"; "claro" -> "claro e persistente";
- todo número aparece com a unidade e a data do JSON.
```

**Validador pós-IA (determinístico, roda antes de enviar):** extrai todo número do texto gerado e confere se cada um existe no JSON de fatos; conta as frases; procura os termos proibidos; verifica que cada item de `ressalvas` aparece. Falhou? Envia o **template sem IA**, montado por concatenação. O cliente nunca recebe erro nem alucinação.

## F. Por que regras + IA, e não IA decidindo

1. **Auditabilidade.** Quando o fazendeiro perguntar "por que hoje mudou para retenção?", a resposta é uma linha de log com o limiar, o valor e o mês. Com IA decidindo, a resposta é "o modelo achou".
2. **Estabilidade.** O mesmo insumo tem que gerar o mesmo veredito amanhã. Um LLM lendo os números crus oscila entre "retenção consolidada" e "sinais mistos" sem que nada tenha mudado — e num produto diário de alto ticket, isso destrói a confiança mais rápido do que um erro.
3. **Testabilidade.** `classificarAbate` cabe em vitest com os 18 meses reais como fixture, no mesmo padrão do projeto (`tests/fixtures/`, 63 testes que não tocam a rede). Um prompt não tem teste de regressão.
4. **É onde o LLM erra mais.** A parte difícil não é a prosa — é saber que julho está 22% incompleto, que o mês-a-mês é sazonal, que o prêmio de 5,6% é menor que o CDI e que o painel mudou de 4 para 3 estados. São exatamente as armadilhas que um modelo lendo uma tabela atropela com confiança.
5. **Custo e falha.** As regras rodam sempre. A IA é a única parte que pode cair — e o fallback é o template, que já é publicável.
```

### Armadilhas
- JULHO/2026 JÁ ESTÁ ENVENENADO. MT+MS+RO em jul/26 somam 1.069.340 cabeças contra 1.375.380 em jul/25 (−22,3%), enquanto jun/26 ficou em −1,0%. MT e RO foram congelados na coleta de 31/07 09:01 e a `rejanela-semanal` só reprocessa MS. Sem o gate de completude, o texto de hoje anunciaria uma aceleração da retenção que não existe. NÃO investiguei a causa (atraso da fonte vs. coletor congelado) — só confirmei o buraco.
- COMPOSIÇÃO VARIÁVEL DO CONSOLIDADO. `calcularKpis` produz uma linha CONSOLIDADO com 3 ou 4 estados conforme o mês. jun/2026 sem PA dá 49,84%; mai/2026 com PA dá 52,17%. A queda de 2,3 p.p. é o Pará saindo, não o mercado. Pior: `mediaMovel12m` exige 12 observações não-nulas e as encontra — misturando meses de 3 e de 4 estados numa mesma média. A `Kpi.estados` já expõe o problema, mas nada impede o consumo errado. O painel do texto tem que ser de composição FIXA.
- PARÁ CHEGA 3 MESES DEPOIS. Último dado é mai/2026 (`peciclo_gta_registros` para no 2026-05-31). Quando a planilha de setembro finalmente trouxer jun/jul/26 do PA, três meses do consolidado mudam de valor RETROATIVAMENTE. Se o texto diário já tiver afirmado algo sobre esses meses, ele se contradiz sozinho. Ou o PA fica fora do painel, ou o texto avisa que aquele mês ainda pode mudar.
- O MÊS-A-MÊS DA ABA "CICLO" É SAZONALIDADE. Medi o índice sazonal nos 13 anos completos do SIF: GO vai de +12,0 p.p. em fevereiro a −9,3 p.p. em outubro; SP de +8,1 a −7,2. A coluna `variacaoMesAnteriorPp` já entregue na planilha é, na maior parte, calendário. Se o texto usar esse campo, vai anunciar virada de ciclo toda vez que chegar setembro.
- UM DIA DE ABATE NÃO DIZ NADA. No MS em jun/26, o %fêmeas diário variou de 35,6% a 58,2% em dias úteis e de 28,7% a 76,3% nos fins de semana (3,3% do volume). E 04/06/2026 (Corpus Christi) teve 3.088 cabeças contra ~16 mil de uma quinta normal. Qualquer métrica diária tem que ser ACUMULADA no mês e comparada com a mesma janela do ano anterior — nunca o dia isolado.
- A RELAÇÃO DE TROCA NÃO TEM SÉRIE. `peciclo_precos` tem 6 linhas em 2 datas. Ela caiu de 9,75 para 9,62 @/bezerro entre 31/07 e 04/08 — e chamar isso de tendência seria a primeira mentira do produto. O código de `mercado.ts` já monta um "Histórico da relação de troca" com `.slice(0, 60)`, o que dá a impressão de série onde há dois pontos. Enquanto N < ~20 observações, só nível, e ancorado em referência externa datada.
- O PRÊMIO DOS FUTUROS ENGANA. `calcularPremioFuturos` devolve +5,61% para Fev/27, o que soa como alta precificada. Anualizado dá ~11,3% contra CDI de 14,15%: os SETE vencimentos estão de 1,2% a 3,0% ABAIXO do carrego. Publicar o prêmio nominal sem o carrego dá ao pecuarista exatamente a leitura invertida de uma decisão de hedge.
- A CURVA NÃO É PERSISTIDA. `coleta-experimental.ts` documenta a escolha ("é sempre o retrato do dia"), mas ela impede qualquer frase sobre movimento da curva e impede backtestar a base. Gravar `peciclo_futuros(contrato, data_pregao, ajuste)` é barato e destrava a métrica mais própria do produto: a base atual contra a base histórica no mesmo prazo até o vencimento.
- O HEADLINE NACIONAL DIZ O OPOSTO. O IBGE mediu 49,9% de fêmeas no 1º tri/26 — recorde, contra média de 44,4% para 1ºs trimestres — e descreveu como retomada de ALTA após duas quedas trimestrais. Nossos 4 estados dizem retenção. Se o cliente ler os dois no mesmo dia sem que o texto tenha delimitado o escopo, o produto perde credibilidade num parágrafo.
- GO E SP NÃO SÃO COMPARÁVEIS COM O RESTO, NEM ENTRE SI. GTA roda em 49–58% de fêmeas; SIF de GO em 26% e de SP em 22% (média 2013+). E hoje eles divergem: mm12 de GO caiu 1,41 p.p. no ano, a de SP subiu 1,12 p.p. Regra que exige unanimidade nunca dispara; regra que ignora a divergência mente. Reporte o placar.
- OS MESES CONTINUAM SE MEXENDO DEPOIS DE FECHADOS. MS jun/26 tinha 358.726 cabeças no CSV de referência e tem 362.608 no banco (+1,1%). Números publicados no texto de um dia não batem com os do dia seguinte. Ou o texto cita a data de corte, ou vira reclamação.
- RECOMENDAÇÃO PODE SER ATIVIDADE REGULADA. Os derivativos da B3 são valores mobiliários pela Lei 6.385/76 e a atividade de análise é regida pela Resolução CVM 20/2021, que exige credenciamento. Um produto pago que diga "trave 30% em Fev/27" a fazendeiros entra em terreno que eu NÃO consegui esclarecer com fonte definitiva. Fatos e classificação são muito mais defensáveis do que recomendação — e o rodapé "não é recomendação" deve ser fixo. Isto é observação, não parecer jurídico: confirme com advogado.
- SÓ 18 MESES DE HISTÓRICO DE GTA E 6 COMPARAÇÕES ANUAIS. Os limiares que propus (1,0 e 2,5 p.p.; gate de 90%) foram calibrados nesses 6 meses e no ruído medido — não foram backtestados num ciclo completo, que dura 6 a 8 anos. Trate-os como versão 1, registre a decisão de cada dia no banco e recalibre quando houver 24+ meses.
- O QUE EU NÃO TESTEI: não executei nenhum código nem teste do projeto; não rodei as views SQL contra o Postgres (li tudo via PostgREST); não determinei a causa do buraco de julho; não verifiquei estatisticamente que a sazonalidade do SIF de GO/SP vale para a GTA de MT/MS/RO/PA (a forma coincide nos 18 meses, só isso); a página do CEPEA devolveu HTTP 403, então os números da relação de troca vêm do Farmnews citando o CEPEA; a curva de futuros veio do Notícias Agrícolas, a mesma fonte secundária que o coletor já usa, e não da B3 direto; e não testei como o texto renderiza no WhatsApp pela Evolution.
