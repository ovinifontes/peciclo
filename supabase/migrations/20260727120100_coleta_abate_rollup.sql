create or replace function public.peciclo_rollup_abate_mensal(
  p_uf          text,
  p_competencia date,
  p_coleta_id   bigint
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with agregado as (
    select
      g.uf,
      extract(year  from g.data_emissao)::smallint as ano,
      extract(month from g.data_emissao)::smallint as mes,
      g.finalidade,
      g.sexo,
      sum(g.quantidade)::integer as quantidade
    from public.peciclo_gta_registros g
    where g.uf = p_uf
      -- Range fechado-aberto de propósito: envolver data_emissao numa função
      -- (extract, to_char) descartaria o índice e viraria Seq Scan em 12M linhas.
      and g.data_emissao >= date_trunc('month', p_competencia)::date
      and g.data_emissao <  (date_trunc('month', p_competencia) + interval '1 month')::date
    group by g.uf, 2, 3, g.finalidade, g.sexo
  ), gravado as (
    insert into public.peciclo_abate_mensal as am
      (uf, ano, mes, finalidade, sexo, quantidade, fonte, coleta_id, atualizado_em)
    select a.uf, a.ano, a.mes, a.finalidade, a.sexo, a.quantidade,
           'gta_agregada', p_coleta_id, now()
    from agregado a
    on conflict on constraint peciclo_abate_mensal_pkey do update
      set quantidade = excluded.quantidade,
          fonte = excluded.fonte,
          coleta_id = excluded.coleta_id,
          atualizado_em = now()
      -- nunca sobrescreve o número direto do Power BI (RO)
      where am.fonte <> 'powerbi'
        and (am.quantidade, am.fonte) is distinct from (excluded.quantidade, excluded.fonte)
    returning 1
  )
  select coalesce(count(*), 0)::integer from gravado;
$$;
