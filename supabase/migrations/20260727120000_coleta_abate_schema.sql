-- coletas — auditoria de cada execução de coletor
create table if not exists public.coletas (
  id              bigint      generated always as identity primary key,
  uf              text        not null,
  tipo            text        not null,
  janela_inicio   date        not null,
  janela_fim      date        not null,
  status          text        not null,
  arquivo_path    text,
  arquivo_hash    text,
  linhas_afetadas integer,
  erro            text,
  iniciado_em     timestamptz not null default now(),
  concluido_em    timestamptz,
  constraint coletas_uf_check     check (uf in ('MT','MS','RO','PA')),
  constraint coletas_tipo_check   check (tipo in ('diaria','rejanela','mensal')),
  constraint coletas_status_check check (status in ('ok','falha','sem_dados')),
  constraint coletas_janela_check check (janela_fim >= janela_inicio),
  constraint coletas_hash_check   check (arquivo_hash is null or arquivo_hash ~ '^[0-9a-f]{64}$'),
  constraint coletas_erro_check   check (status <> 'falha' or erro is not null)
);

create index if not exists coletas_uf_iniciado_em_idx on public.coletas (uf, iniciado_em desc);
create index if not exists coletas_uf_tipo_ok_idx     on public.coletas (uf, tipo, janela_fim desc) where status = 'ok';
create index if not exists coletas_arquivo_hash_idx   on public.coletas (arquivo_hash) where arquivo_hash is not null;

-- gta_registros — detalhe: uma linha por GTA + sexo + faixa etária
create table if not exists public.gta_registros (
  id                bigint      generated always as identity primary key,
  coleta_id         bigint      not null,
  criado_em         timestamptz not null default now(),
  data_emissao      date        not null,
  quantidade        integer     not null,
  uf                text        not null,
  documento_tipo    text        not null,
  documento_numero  text        not null,
  documento_serie   text        not null,
  finalidade        text        not null,
  sexo              text        not null,
  faixa_etaria      text,
  municipio_origem  text,
  municipio_destino text,
  uf_destino        text,
  -- NULLS NOT DISTINCT (PG15+): sem isto, faixa_etaria NULL nunca conflita
  -- consigo mesma e todo reprocessamento duplicaria linhas silenciosamente.
  constraint gta_registros_chave_natural
    unique nulls not distinct (uf, documento_numero, documento_serie, sexo, faixa_etaria),
  constraint gta_registros_coleta_id_fkey foreign key (coleta_id) references public.coletas (id) on delete restrict,
  constraint gta_registros_uf_check         check (uf in ('MT','MS','RO','PA')),
  constraint gta_registros_sexo_check       check (sexo in ('MACHO','FEMEA')),
  constraint gta_registros_quantidade_check check (quantidade >= 0),
  constraint gta_registros_finalidade_check check (finalidade = btrim(finalidade) and finalidade <> '')
);

-- Índice do rollup. `quantidade` é COLUNA-CHAVE, não INCLUDE: INCLUDE desliga
-- a deduplicação de btree e o índice fica ~6x maior sem ficar mais rápido.
create index if not exists gta_registros_rollup_idx
  on public.gta_registros (uf, data_emissao, finalidade, sexo, quantidade);
create index if not exists gta_registros_coleta_id_idx on public.gta_registros (coleta_id);

alter table public.gta_registros set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- abate_mensal — canônica, única fonte da planilha
create table if not exists public.abate_mensal (
  uf            text        not null,
  ano           smallint    not null,
  mes           smallint    not null,
  finalidade    text        not null,
  sexo          text        not null,
  quantidade    integer     not null,
  fonte         text        not null,
  coleta_id     bigint,
  atualizado_em timestamptz not null default now(),
  competencia   date generated always as (make_date(ano::int, mes::int, 1)) stored,
  constraint abate_mensal_pkey primary key (uf, ano, mes, finalidade, sexo),
  constraint abate_mensal_coleta_id_fkey foreign key (coleta_id) references public.coletas (id) on delete set null,
  constraint abate_mensal_uf_check    check (uf in ('MT','MS','RO','PA')),
  constraint abate_mensal_ano_check   check (ano between 2015 and 2100),
  constraint abate_mensal_mes_check   check (mes between 1 and 12),
  constraint abate_mensal_sexo_check  check (sexo in ('MACHO','FEMEA')),
  constraint abate_mensal_fonte_check check (fonte in ('gta_agregada','gta_condensada','powerbi','manual')),
  constraint abate_mensal_qtd_check   check (quantidade >= 0)
);

-- RLS ligada, ZERO policies: sem policy o USING default é falso, então
-- anon/authenticated não leem nada. service_role tem BYPASSRLS e passa.
-- FORCE ROW LEVEL SECURITY fica de fora de propósito: trancaria o próprio
-- dono fora da tabela no SQL Editor sem barrar mais ninguém.
alter table public.coletas       enable row level security;
alter table public.gta_registros enable row level security;
alter table public.abate_mensal  enable row level security;

do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.coletas, public.gta_registros, public.abate_mensal from anon;
  end if;
  if to_regrole('authenticated') is not null then
    revoke all on table public.coletas, public.gta_registros, public.abate_mensal from authenticated;
  end if;
  if to_regrole('service_role') is not null then
    grant select, insert, update, delete
      on table public.coletas, public.gta_registros, public.abate_mensal to service_role;
  end if;
end $$;
