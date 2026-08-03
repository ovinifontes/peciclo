-- Tabelas da planilha EXPERIMENTAL (fase 2). Ficam separadas de propósito:
-- se GO/SP entrassem em peciclo_abate_mensal, apareceriam no consolidado da
-- planilha atual e mudariam o indicador que já está validado. A pipeline de
-- produção não lê nenhuma destas tabelas.

-- peciclo_abate_sif — abate por sexo sob inspeção FEDERAL (SIGSIF/MAPA).
-- Metodologia diferente da GTA usada nos 4 estados: é fato consumado e cobre
-- só inspeção federal, então subestima o nível absoluto (forte em SP). O
-- percentual de fêmeas continua sendo sinal válido do ciclo.
create table if not exists public.peciclo_abate_sif (
  uf            text        not null,
  ano           smallint    not null,
  mes           smallint    not null,
  sexo          text        not null,
  quantidade    integer     not null,
  fonte         text        not null default 'sigsif',
  atualizado_em timestamptz not null default now(),
  competencia   date generated always as (make_date(ano::int, mes::int, 1)) stored,
  constraint peciclo_abate_sif_pkey primary key (uf, ano, mes, sexo),
  constraint peciclo_abate_sif_uf_check   check (uf ~ '^[A-Z]{2}$'),
  constraint peciclo_abate_sif_ano_check  check (ano between 2000 and 2100),
  constraint peciclo_abate_sif_mes_check  check (mes between 1 and 12),
  constraint peciclo_abate_sif_sexo_check check (sexo in ('MACHO', 'FEMEA')),
  constraint peciclo_abate_sif_qtd_check  check (quantidade >= 0)
);

create index if not exists peciclo_abate_sif_competencia_idx
  on public.peciclo_abate_sif (competencia desc);

-- peciclo_precos — série de preços de referência (boi gordo, bezerro).
-- `serie` identifica o indicador; `fonte` registra de onde veio, porque a
-- disponibilidade pública varia e a origem precisa ficar auditável.
create table if not exists public.peciclo_precos (
  serie         text        not null,
  data          date        not null,
  valor         numeric(14,4) not null,
  unidade       text        not null,
  fonte         text        not null,
  atualizado_em timestamptz not null default now(),
  constraint peciclo_precos_pkey primary key (serie, data),
  constraint peciclo_precos_valor_check check (valor > 0),
  constraint peciclo_precos_serie_check check (serie = btrim(serie) and serie <> '')
);

create index if not exists peciclo_precos_serie_data_idx
  on public.peciclo_precos (serie, data desc);

-- Mesma política das tabelas de produção: RLS ligada, sem policy pública.
alter table public.peciclo_abate_sif enable row level security;
alter table public.peciclo_precos    enable row level security;

do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.peciclo_abate_sif, public.peciclo_precos from anon;
  end if;
  if to_regrole('authenticated') is not null then
    revoke all on table public.peciclo_abate_sif, public.peciclo_precos from authenticated;
  end if;
  if to_regrole('service_role') is not null then
    grant select, insert, update, delete
      on table public.peciclo_abate_sif, public.peciclo_precos to service_role;
  end if;
end $$;
