-- Abate agregado POR DIA — a base da seção diária do painel.
--
-- O detalhe por GTA (peciclo_gta_registros, milhões de linhas) continua SEM
-- grant para authenticated; o site lê só este agregado, como faz com o mensal.
--
-- Fontes possíveis de uma linha:
--   'gta_agregada'        rollup a partir de peciclo_gta_registros (MS, e PA se um dia quisermos)
--   'gta_condensada_dia'  MT direto do INDEA, consultado com janela de 1 dia
--   'manual'              importação excepcional
--
-- Limitação aceita (a mesma do rollup mensal): se um (dia, finalidade, sexo)
-- sumir por completo numa recoleta, a linha antiga fica órfã — o upsert não
-- apaga. Nunca aconteceu no mensal; monitorável pelo fechamento cruzado
-- (soma do diário do mês == linha mensal).

create table if not exists public.peciclo_abate_diario (
  uf            text        not null,
  data          date        not null,
  finalidade    text        not null,
  sexo          text        not null,
  quantidade    integer     not null,
  fonte         text        not null,
  coleta_id     bigint,
  atualizado_em timestamptz not null default now(),
  constraint peciclo_abate_diario_pkey primary key (uf, data, finalidade, sexo),
  constraint peciclo_abate_diario_coleta_id_fkey foreign key (coleta_id)
    references public.peciclo_coletas (id) on delete set null,
  constraint peciclo_abate_diario_uf_check    check (uf in ('MT','MS','RO','PA')),
  constraint peciclo_abate_diario_sexo_check  check (sexo in ('MACHO','FEMEA')),
  constraint peciclo_abate_diario_fonte_check check (fonte in ('gta_agregada','gta_condensada_dia','manual')),
  constraint peciclo_abate_diario_qtd_check   check (quantidade >= 0),
  constraint peciclo_abate_diario_data_check  check (data between date '2015-01-01' and date '2100-12-31')
);
comment on table public.peciclo_abate_diario is
  'Abate por dia, UF, finalidade e sexo. Alimentado pelo rollup diário (MS) e pelo INDEA por janela de 1 dia (MT, quando a fonte voltar).';
-- Sem índice além da PK de propósito: dezenas de linhas por dia; a PK
-- (uf, data, finalidade, sexo) cobre o upsert e a leitura do site.

alter table public.peciclo_abate_diario enable row level security;

create or replace function public.peciclo_rollup_abate_diario(
  p_uf text, p_de date, p_ate date, p_coleta_id bigint
) returns integer
language sql volatile security invoker set search_path = ''
as $$
  with agregado as (
    select g.uf, g.data_emissao as data, g.finalidade, g.sexo,
           sum(g.quantidade)::integer as quantidade
    from public.peciclo_gta_registros g
    where g.uf = p_uf
      and g.data_emissao >= p_de   -- range direto: usa o índice de rollup existente
      and g.data_emissao <= p_ate
    group by g.uf, g.data_emissao, g.finalidade, g.sexo
  ), gravado as (
    insert into public.peciclo_abate_diario as ad
      (uf, data, finalidade, sexo, quantidade, fonte, coleta_id, atualizado_em)
    select a.uf, a.data, a.finalidade, a.sexo, a.quantidade,
           'gta_agregada', p_coleta_id, now()
    from agregado a
    on conflict on constraint peciclo_abate_diario_pkey do update
      set quantidade = excluded.quantidade, fonte = excluded.fonte,
          coleta_id = excluded.coleta_id, atualizado_em = now()
      -- o dia que veio DIRETO do INDEA (MT) nunca é sobrescrito pelo rollup —
      -- espelho da guarda `fonte <> 'powerbi'` do rollup mensal
      where ad.fonte <> 'gta_condensada_dia'
        and (ad.quantidade, ad.fonte) is distinct from (excluded.quantidade, excluded.fonte)
    returning 1
  )
  select coalesce(count(*), 0)::integer from gravado;
$$;

-- GRANT antes da política (o Postgres avalia privilégio primeiro).
do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.peciclo_abate_diario from anon;
  end if;
  if to_regrole('authenticated') is not null then
    grant select on table public.peciclo_abate_diario to authenticated;
  end if;
  if to_regrole('service_role') is not null then
    grant select, insert, update, delete on table public.peciclo_abate_diario to service_role;
  end if;
end $$;

drop policy if exists "ativo_le_abate_diario" on public.peciclo_abate_diario;
create policy "ativo_le_abate_diario" on public.peciclo_abate_diario
  for select to authenticated using (public.peciclo_e_ativo());
