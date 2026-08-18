-- RO diário por DIFERENÇA de retratos — ideia do sócio: o painel da IDARON
-- mostra o acumulado do mês crescendo; guardando o total de cada manhã,
-- ontem = retrato de hoje − retrato de ontem. É uma ESTIMATIVA por fluxo de
-- publicação (guia atrasada cai na conta do dia em que apareceu), por isso a
-- fonte própria 'powerbi_diff' e o rótulo de estimado na tela. O mensal
-- continua canônico.

-- O cofre dos retratos: um por (mês, sexo, dia da captura). Interno ao robô —
-- sem grant para authenticated, de propósito.
create table if not exists public.peciclo_ro_snapshots (
  competencia  date        not null,  -- primeiro dia do mês retratado
  sexo         text        not null,
  capturado_em date        not null,  -- o dia (America/Sao_Paulo) da captura
  quantidade   integer     not null,
  criado_em    timestamptz not null default now(),
  constraint peciclo_ro_snapshots_pkey primary key (competencia, sexo, capturado_em),
  constraint peciclo_ro_snapshots_sexo_check check (sexo in ('MACHO','FEMEA')),
  constraint peciclo_ro_snapshots_qtd_check  check (quantidade >= 0)
);
alter table public.peciclo_ro_snapshots enable row level security;
-- RLS ligada e zero políticas: só a service_role passa.

-- A fonte nova entra no check do diário.
alter table public.peciclo_abate_diario
  drop constraint peciclo_abate_diario_fonte_check;
alter table public.peciclo_abate_diario
  add constraint peciclo_abate_diario_fonte_check
  check (fonte in ('gta_agregada','gta_condensada_dia','powerbi_diff','manual'));

-- Guarda mais forte no rollup: ele só pode sobrescrever LINHA DELE MESMO
-- ('gta_agregada'). Antes a guarda listava só o MT; com o RO entrando, a
-- lista viraria manutenção — o invariante certo é "cada fonte é dona das
-- suas linhas".
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
      and g.data_emissao >= p_de
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
      where ad.fonte = 'gta_agregada'
        and (ad.quantidade, ad.fonte) is distinct from (excluded.quantidade, excluded.fonte)
    returning 1
  )
  select coalesce(count(*), 0)::integer from gravado;
$$;
