-- Perfis dos usuários do SaaS e as permissões de leitura que hoje não existem.
--
-- IMPORTANTE: as tabelas de dados têm RLS ligada E `revoke all from
-- authenticated` (migrations anteriores). O Postgres avalia o privilégio SQL
-- ANTES da política, então política sozinha não basta: sem GRANT, o usuário
-- logado leva "permission denied" e a política nem é considerada.

-- Perfis: uma linha por usuário do Auth.
create table if not exists public.peciclo_perfis (
  id                uuid primary key references auth.users(id) on delete cascade,
  nome              text not null,
  telefone_whatsapp text,
  papel             text not null default 'cliente' check (papel in ('cliente','admin')),
  status            text not null default 'ativo'   check (status in ('ativo','suspenso','cancelado')),
  recebe_whatsapp   boolean not null default true,
  motivo_status     text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  -- mesmo formato que a Evolution já usa: DDI+DDD+numero, só dígitos
  constraint peciclo_perfis_telefone_check
    check (telefone_whatsapp is null or telefone_whatsapp ~ '^\d{12,13}$')
);

comment on table public.peciclo_perfis is
  'Usuários do SaaS. Criados só pelo admin — não há cadastro público.';

-- índice que o job de WhatsApp usa todo dia
create index if not exists peciclo_perfis_envio_idx
  on public.peciclo_perfis (status, recebe_whatsapp)
  where telefone_whatsapp is not null;

alter table public.peciclo_perfis enable row level security;

-- SECURITY DEFINER é obrigatório: uma política em peciclo_perfis que
-- consultasse peciclo_perfis diretamente entraria em recursão infinita.
-- A função roda com os privilégios do dono e não dispara a política do
-- invocador.
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

-- GRANT vem ANTES das políticas (ver comentário do topo).
do $$
begin
  if to_regrole('authenticated') is not null then
    grant select on table
      public.peciclo_abate_mensal,
      public.peciclo_abate_sif,
      public.peciclo_precos
      to authenticated;
    grant select, update on table public.peciclo_perfis to authenticated;
  end if;
end $$;

-- (select auth.uid()) entre parênteses: avaliado uma vez por consulta em vez
-- de uma vez por linha.
drop policy if exists "perfil_proprio_leitura" on public.peciclo_perfis;
create policy "perfil_proprio_leitura" on public.peciclo_perfis
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "admin_gerencia_perfis" on public.peciclo_perfis;
create policy "admin_gerencia_perfis" on public.peciclo_perfis
  for all to authenticated
  using (public.peciclo_e_admin()) with check (public.peciclo_e_admin());

drop policy if exists "ativo_le_abate_mensal" on public.peciclo_abate_mensal;
create policy "ativo_le_abate_mensal" on public.peciclo_abate_mensal
  for select to authenticated using (public.peciclo_e_ativo());

drop policy if exists "ativo_le_abate_sif" on public.peciclo_abate_sif;
create policy "ativo_le_abate_sif" on public.peciclo_abate_sif
  for select to authenticated using (public.peciclo_e_ativo());

drop policy if exists "ativo_le_precos" on public.peciclo_precos;
create policy "ativo_le_precos" on public.peciclo_precos
  for select to authenticated using (public.peciclo_e_ativo());

-- peciclo_gta_registros (2,3 mi de linhas de detalhe) e peciclo_coletas
-- (auditoria) ficam SEM grant e SEM política de propósito: não vão ao
-- navegador. O painel lê os agregados.
