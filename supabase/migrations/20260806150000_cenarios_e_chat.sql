-- Cenário diário escrito por IA (ou pela reserva determinística) e as
-- conversas do chat. Escrita: só service_role — sem GRANT de INSERT.

create table if not exists public.peciclo_cenarios (
  data      date primary key,
  texto     text not null,
  origem    text not null check (origem in ('ia','reserva')),
  modelo    text,
  dossie    jsonb not null,
  criado_em timestamptz not null default now()
);
comment on table public.peciclo_cenarios is
  'Um cenário por dia. O dossiê gravado junto torna cada texto auditável para sempre.';
alter table public.peciclo_cenarios enable row level security;

create table if not exists public.peciclo_chat_mensagens (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references public.peciclo_perfis(id) on delete cascade,
  papel      text not null check (papel in ('usuario','assistente')),
  conteudo   text not null,
  criado_em  timestamptz not null default now()
);
create index if not exists peciclo_chat_msgs_usuario_dia
  on public.peciclo_chat_mensagens (usuario_id, criado_em);
alter table public.peciclo_chat_mensagens enable row level security;

-- GRANT antes das políticas (o Postgres avalia privilégio primeiro).
do $$
begin
  if to_regrole('authenticated') is not null then
    grant select on table public.peciclo_cenarios, public.peciclo_chat_mensagens
      to authenticated;
  end if;
end $$;

drop policy if exists "ativo_le_cenarios" on public.peciclo_cenarios;
create policy "ativo_le_cenarios" on public.peciclo_cenarios
  for select to authenticated using (public.peciclo_e_ativo());

drop policy if exists "proprias_mensagens" on public.peciclo_chat_mensagens;
create policy "proprias_mensagens" on public.peciclo_chat_mensagens
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists "admin_le_chat" on public.peciclo_chat_mensagens;
create policy "admin_le_chat" on public.peciclo_chat_mensagens
  for select to authenticated using (public.peciclo_e_admin());
