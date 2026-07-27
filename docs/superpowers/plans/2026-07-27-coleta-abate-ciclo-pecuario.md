# Coleta de Abate Bovino — Plano de Implementação (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatizar a coleta diária de dados de abate bovino por sexo nos portais de MT, MS, RO e PA, armazenar com histórico auditável, gerar a planilha `.xlsx` no formato atual com uma aba de KPIs, e enviá-la pelo WhatsApp.

**Architecture:** Coletores isolados (um por estado, mesma interface) gravam o detalhe de cada GTA no Postgres; uma tabela canônica mensal alimenta o gerador de planilha; o Trigger.dev orquestra tudo em paralelo tolerando falha individual. Arquivos brutos são arquivados antes de qualquer parse, permitindo reprocessar sem tocar nos portais.

**Tech Stack:** TypeScript (ESM, Node 22) · Trigger.dev v4 · Supabase (Postgres + Storage) · ExcelJS (streaming) · Playwright (só descoberta do RO) · Evolution API · Vitest

**Spec:** [`docs/superpowers/specs/2026-07-27-coleta-abate-ciclo-pecuario-design.md`](../specs/2026-07-27-coleta-abate-ciclo-pecuario-design.md)

---

## Ordem de execução e por quê

As tarefas 1 a 11 constroem uma **fatia vertical completa** com um único estado (MS, o mais simples): coleta → banco → planilha → WhatsApp. Ao fim da tarefa 11 o sistema já entrega valor real todo dia. As tarefas 12 a 14 adicionam os outros três estados, cada um independente. As 15 e 16 endurecem a operação.

Isso é deliberado: se algo der errado na integração (Supabase, Trigger, Evolution), descobrimos na tarefa 5, não na 16.

---

## Estrutura de arquivos

```
src/
  config.ts                  # lê e valida variáveis de ambiente; falha alto se faltar
  tipos.ts                   # RegistroGta, Janela, ResultadoColeta, Sexo, UF
  xlsx/
    leitor.ts                # streaming, mapa de cabeçalho, serial→data UTC
  coletores/
    ms.ts                    # IAGRO — GET anônimo
    mt.ts                    # INDEA — login + export
    ro.ts                    # IDARON — Power BI
    pa.ts                    # ADEPARA — Google Drive
  dados/
    cliente.ts               # cliente Supabase (service_role)
    coletas.ts               # abrir/fechar registro de execução
    registros.ts             # upsert de gta_registros
    mensal.ts                # rollup e leitura de abate_mensal
    arquivos.ts              # arquivar bruto no Storage com hash
  planilha/
    gerar.ts                 # monta o .xlsx (2 abas)
    kpis.ts                  # cálculos do ciclo (funções puras)
  notificacao/
    evolution.ts             # enviarDocumento, instanciaConectada
    alertas.ts               # alerta técnico ao operador
  semente/
    importar-historico.ts    # semeia abate_mensal a partir do CSV de referência
  trigger/
    coleta-diaria.ts         # schedule 06:00, fan-out
    coletor-{ms,mt,ro,pa}.ts # wrappers de task
    gerar-e-enviar.ts
    rejanela-semanal.ts
    verificar-fontes.ts
supabase/migrations/
tests/
  fixtures/                  # arquivos reais dos portais — os testes nunca vão à rede
```

**Princípio de fronteira:** coletores não conhecem banco. O banco não conhece planilha. A planilha não conhece portal. Cada um é testável sozinho.

---

## Pré-requisitos (bloqueiam a execução)

Antes da Tarefa 1, tenha em mãos:

| Variável | Onde obter |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Dashboard do Supabase → Project Settings → API |
| `TRIGGER_PROJECT_REF` | Dashboard do Trigger.dev ao criar o projeto |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA` | Instância da Evolution já existente |
| `WHATSAPP_DESTINATARIOS` | Números em DDI+DDD+numero, separados por vírgula |
| `WHATSAPP_OPERADOR` | Número que recebe os alertas técnicos |
| `INDEA_CPF`, `INDEA_SENHA` | Credencial do sócio (autorizada) |
| `GOOGLE_API_KEY` | Google Cloud Console → API key com Drive API v3 habilitada |

A Tarefa 13 (MT) exige uma **sessão de mapeamento manual** antes de codificar — está descrita dentro dela.

---

## Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/tipos.ts`, `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "peciclo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev:trigger": "npx trigger.dev@latest dev",
    "deploy:trigger": "npx trigger.dev@latest deploy --env prod"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.110.9",
    "@trigger.dev/sdk": "^4.5.8",
    "exceljs": "^4.4.0",
    "playwright": "1.56.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@trigger.dev/build": "^4.5.8",
    "@types/node": "^22.0.0",
    "trigger.dev": "^4.5.8",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`playwright` fica em `dependencies` de propósito: a build extension do Trigger.dev lê a versão dali e falha se não achar.

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "trigger.config.ts"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    environment: "node",
  },
});
```

- [ ] **Step 4: Criar `src/tipos.ts`**

```ts
export type UF = "MT" | "MS" | "RO" | "PA";
export type Sexo = "MACHO" | "FEMEA";
export type FonteDado = "gta_agregada" | "powerbi" | "manual";
export type TipoColeta = "diaria" | "rejanela" | "mensal";
export type StatusColeta = "ok" | "falha" | "sem_dados";

/** Janela de datas em ISO (YYYY-MM-DD), inclusiva nas duas pontas. */
export interface Janela {
  inicio: string;
  fim: string;
}

/** Uma linha de GTA desnormalizada por sexo e faixa etária. */
export interface RegistroGta {
  uf: UF;
  documentoTipo: string;
  documentoNumero: string;
  /** String vazia quando a fonte não traz série. Faz parte da chave natural. */
  documentoSerie: string;
  /** ISO YYYY-MM-DD. */
  dataEmissao: string;
  finalidade: string;
  sexo: Sexo;
  /** null quando a fonte não informa faixa. */
  faixaEtaria: string | null;
  quantidade: number;
  municipioOrigem: string | null;
  municipioDestino: string | null;
  ufDestino: string | null;
}

/** Total já agregado — usado por fontes que só entregam o mês fechado (RO). */
export interface AgregadoMensal {
  uf: UF;
  ano: number;
  mes: number;
  finalidade: string;
  sexo: Sexo;
  quantidade: number;
}
```

- [ ] **Step 5: Escrever o teste do config (falhando)**

`tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lerConfig } from "../src/config.js";

describe("lerConfig", () => {
  it("lê as variáveis presentes", () => {
    const cfg = lerConfig({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "chave",
      EVOLUTION_BASE_URL: "https://evo.exemplo.com",
      EVOLUTION_API_KEY: "k",
      EVOLUTION_INSTANCIA: "peciclo",
      WHATSAPP_DESTINATARIOS: "5511999999999,5511888888888",
      WHATSAPP_OPERADOR: "5511777777777",
    });
    expect(cfg.supabaseUrl).toBe("https://x.supabase.co");
    expect(cfg.whatsappDestinatarios).toEqual(["5511999999999", "5511888888888"]);
  });

  it("falha alto quando falta variável obrigatória", () => {
    expect(() => lerConfig({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `npm install && npx vitest run tests/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.js"`

- [ ] **Step 7: Implementar `src/config.ts`**

```ts
export interface Config {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionInstancia: string;
  whatsappDestinatarios: string[];
  whatsappOperador: string;
}

const OBRIGATORIAS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EVOLUTION_BASE_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_INSTANCIA",
  "WHATSAPP_DESTINATARIOS",
  "WHATSAPP_OPERADOR",
] as const;

export function lerConfig(env: Record<string, string | undefined> = process.env): Config {
  const faltando = OBRIGATORIAS.filter((k) => !env[k]?.trim());
  if (faltando.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(", ")}`);
  }
  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    evolutionBaseUrl: env.EVOLUTION_BASE_URL!,
    evolutionApiKey: env.EVOLUTION_API_KEY!,
    evolutionInstancia: env.EVOLUTION_INSTANCIA!,
    whatsappDestinatarios: env
      .WHATSAPP_DESTINATARIOS!.split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    whatsappOperador: env.WHATSAPP_OPERADOR!,
  };
}
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS — 2 testes

- [ ] **Step 9: Criar `.env.example`**

```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_BASE_URL=https://evo.seudominio.com
EVOLUTION_API_KEY=
EVOLUTION_INSTANCIA=peciclo
WHATSAPP_DESTINATARIOS=5567999999999
WHATSAPP_OPERADOR=5567999999999
INDEA_CPF=
INDEA_SENHA=
GOOGLE_API_KEY=
```

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example src/ tests/
git commit -m "feat: scaffold do projeto com config validada"
```

---

## Task 2: Schema do banco

**Files:**
- Create: `supabase/migrations/20260727120000_coleta_abate_schema.sql`
- Create: `supabase/migrations/20260727120100_coleta_abate_rollup.sql`

- [ ] **Step 1: Inicializar e linkar o Supabase**

```bash
npx supabase init
npx supabase link --project-ref <seu-project-ref>
npx supabase migration new coleta_abate_schema
```

- [ ] **Step 2: Escrever o schema**

Conteúdo de `supabase/migrations/20260727120000_coleta_abate_schema.sql`:

```sql
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
  constraint abate_mensal_fonte_check check (fonte in ('gta_agregada','powerbi','manual')),
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
```

- [ ] **Step 3: Escrever a função de rollup**

```bash
npx supabase migration new coleta_abate_rollup
```

Conteúdo de `supabase/migrations/20260727120100_coleta_abate_rollup.sql`:

```sql
create or replace function public.rollup_abate_mensal(
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
    from public.gta_registros g
    where g.uf = p_uf
      -- Range fechado-aberto de propósito: envolver data_emissao numa função
      -- (extract, to_char) descartaria o índice e viraria Seq Scan em 12M linhas.
      and g.data_emissao >= date_trunc('month', p_competencia)::date
      and g.data_emissao <  (date_trunc('month', p_competencia) + interval '1 month')::date
    group by g.uf, 2, 3, g.finalidade, g.sexo
  ), gravado as (
    insert into public.abate_mensal as am
      (uf, ano, mes, finalidade, sexo, quantidade, fonte, coleta_id, atualizado_em)
    select a.uf, a.ano, a.mes, a.finalidade, a.sexo, a.quantidade,
           'gta_agregada', p_coleta_id, now()
    from agregado a
    on conflict on constraint abate_mensal_pkey do update
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
```

- [ ] **Step 4: Aplicar as migrations**

Run: `npx supabase db push --dry-run` e conferir a saída; depois `npx supabase db push`
Expected: as duas migrations aplicadas sem erro

- [ ] **Step 5: Verificar RLS e criar o bucket de arquivos**

No SQL Editor do dashboard:

```sql
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('coletas','gta_registros','abate_mensal');

insert into storage.buckets (id, name, public) values ('brutos', 'brutos', false)
on conflict (id) do nothing;
```

Expected: as três tabelas com `relrowsecurity = t` e `policies = 0`.

- [ ] **Step 6: Gerar os tipos TypeScript**

Run: `npx supabase gen types typescript --linked --schema public > src/dados/database.types.ts`
Expected: arquivo criado com os tipos das três tabelas

- [ ] **Step 7: Commit**

```bash
git add supabase/ src/dados/database.types.ts
git commit -m "feat: schema do banco com rollup mensal e RLS"
```

---

## Task 3: Leitor de XLSX por streaming

Os arquivos dos portais chegam a 16 MB e 120 MB de XML descompactado. `workbook.xlsx.readFile()` carrega tudo como DOM e leva mais de 3 minutos no arquivo do MS; a leitura por streaming leva 0,5 s. Esta tarefa isola isso, junto com as duas armadilhas de data e de células mescladas.

**Files:**
- Create: `src/xlsx/leitor.ts`, `tests/xlsx/leitor.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

`tests/xlsx/leitor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapearCabecalho, serialParaDataISO, textoCelula } from "../../src/xlsx/leitor.js";

describe("serialParaDataISO", () => {
  it("converte serial do Excel para data ISO", () => {
    expect(serialParaDataISO(46223.1893043403)).toBe("2026-07-20");
    expect(serialParaDataISO(46228.2823954)).toBe("2026-07-25");
  });

  it("usa UTC: meia-noite não escorrega para o dia anterior", () => {
    // Com getters locais em America/Cuiaba (UTC-4) isto viraria 2026-07-25
    // e, na virada do mês, jogaria a GTA no mês errado.
    expect(serialParaDataISO(46229)).toBe("2026-07-26");
  });

  it("aceita Date já convertido", () => {
    expect(serialParaDataISO(new Date(Date.UTC(2026, 4, 1)))).toBe("2026-05-01");
  });
});

describe("mapearCabecalho", () => {
  it("usa a primeira ocorrência de cada rótulo (células mescladas repetem)", () => {
    const mapa = mapearCabecalho([
      undefined, "Tipo de Documento", "Tipo de Documento", "Número", "Número", "Série",
    ]);
    expect(mapa["Tipo de Documento"]).toBe(1);
    expect(mapa["Número"]).toBe(3);
    expect(mapa["Série"]).toBe(5);
  });
});

describe("textoCelula", () => {
  it("extrai texto de célula rich text", () => {
    expect(textoCelula({ richText: [{ text: "ABA" }, { text: "TE" }] })).toBe("ABATE");
  });

  it("normaliza espaços nas bordas", () => {
    expect(textoCelula("  BOVINO ")).toBe("BOVINO");
  });

  it("devolve string vazia para nulo", () => {
    expect(textoCelula(null)).toBe("");
    expect(textoCelula(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/xlsx/leitor.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/xlsx/leitor.js"`

- [ ] **Step 3: Implementar `src/xlsx/leitor.ts`**

```ts
import ExcelJS from "exceljs";

/** Dias entre a época do Excel (1899-12-30) e a do Unix (1970-01-01). */
const EPOCA_EXCEL_EM_DIAS = 25569;
const MS_POR_DIA = 86_400_000;

/**
 * Converte o valor de uma célula de data para ISO YYYY-MM-DD.
 *
 * Na leitura por streaming o ExcelJS não aplica os estilos, então as datas
 * chegam como serial numérico. Os getters são UTC de propósito: o serial não
 * carrega fuso, e usar getters locais desloca a data em fusos negativos.
 */
export function serialParaDataISO(valor: number | Date): string {
  const data =
    valor instanceof Date
      ? valor
      : new Date(Math.round((valor - EPOCA_EXCEL_EM_DIAS) * MS_POR_DIA));
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Extrai o texto de uma célula, lidando com rich text e nulos. */
export function textoCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" && valor !== null && "richText" in valor) {
    const partes = (valor as { richText: Array<{ text: string }> }).richText;
    return partes.map((p) => p.text).join("").trim();
  }
  return String(valor).trim();
}

/**
 * Mapeia rótulo de coluna para índice, usando a PRIMEIRA ocorrência.
 * Células mescladas fazem o ExcelJS repetir o mesmo rótulo em colunas vizinhas.
 */
export function mapearCabecalho(valores: unknown[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  valores.forEach((valor, indice) => {
    const rotulo = textoCelula(valor);
    if (rotulo && !(rotulo in mapa)) mapa[rotulo] = indice;
  });
  return mapa;
}

export interface OpcoesLeitura {
  /** Rótulo que identifica a linha de cabeçalho. */
  marcadorCabecalho: string;
  /** Nome da aba. Quando omitido, usa a primeira que tiver dados. */
  nomeAba?: string;
}

/**
 * Percorre um XLSX por streaming, entregando cada linha de dados já com o
 * mapa de colunas resolvido. Nunca carrega o arquivo inteiro em memória.
 */
export async function* lerLinhas(
  caminho: string,
  opcoes: OpcoesLeitura,
): AsyncGenerator<{ valores: unknown[]; colunas: Record<string, number> }> {
  const leitor = new ExcelJS.stream.xlsx.WorkbookReader(caminho, {
    entries: "emit",
    sharedStrings: "cache",
    worksheets: "emit",
    styles: "ignore",
  });

  for await (const aba of leitor) {
    if (opcoes.nomeAba && aba.name !== opcoes.nomeAba) continue;
    let colunas: Record<string, number> | null = null;
    const marcador = opcoes.marcadorCabecalho.toLowerCase();

    for await (const linha of aba) {
      const valores = linha.values as unknown[];
      if (!colunas) {
        const achou = valores.some((v) => textoCelula(v).toLowerCase() === marcador);
        if (achou) colunas = mapearCabecalho(valores);
        continue;
      }
      yield { valores, colunas };
    }
    if (colunas) return;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/xlsx/leitor.test.ts`
Expected: PASS — 7 testes

- [ ] **Step 5: Commit**

```bash
git add src/xlsx tests/xlsx
git commit -m "feat: leitor de xlsx por streaming com conversão de data em UTC"
```

---

## Task 4: Coletor do MS (IAGRO)

O fixture `tests/fixtures/ms-iagro-2026-07-20-a-26.xlsx` já está no repositório — é um download real do portal, de 20 a 26/07/2026. Os testes usam ele e **nunca** vão à rede.

**Files:**
- Create: `src/coletores/ms.ts`, `tests/coletores/ms.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

`tests/coletores/ms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsearMs, urlRelatorioMs } from "../../src/coletores/ms.js";

const FIXTURE = "tests/fixtures/ms-iagro-2026-07-20-a-26.xlsx";

describe("urlRelatorioMs", () => {
  it("monta a URL com espécie bovina e sem filtro de finalidade", () => {
    const url = urlRelatorioMs({ inicio: "2026-07-20", fim: "2026-07-26" });
    expect(url).toContain("especieAnimalID=1");
    expect(url).toContain("periodoInicial=2026-07-20");
    expect(url).toContain("periodoFinal=2026-07-26");
    // finalidadeID vazio de propósito: o lookup de IDs exige token, e filtrar
    // localmente traz engorda e reprodução de graça no mesmo download.
    expect(url).toContain("finalidadeID=");
  });
});

describe("parsearMs", () => {
  it("extrai os registros de abate com os totais conhecidos do arquivo real", async () => {
    const registros = await parsearMs(FIXTURE);
    const abate = registros.filter((r) => r.finalidade === "ABATE");

    const femeas = abate.filter((r) => r.sexo === "FEMEA").reduce((s, r) => s + r.quantidade, 0);
    const machos = abate.filter((r) => r.sexo === "MACHO").reduce((s, r) => s + r.quantidade, 0);

    expect(femeas).toBe(29991);
    expect(machos).toBe(30644);
  });

  it("guarda também as outras finalidades", async () => {
    const registros = await parsearMs(FIXTURE);
    const finalidades = new Set(registros.map((r) => r.finalidade));
    expect(finalidades.has("ENGORDA")).toBe(true);
    expect(finalidades.has("REPRODUÇÃO")).toBe(true);
  });

  it("desnormaliza por faixa etária e preenche os campos da chave natural", async () => {
    const registros = await parsearMs(FIXTURE);
    const comFaixa = registros.filter((r) => r.faixaEtaria !== null);
    expect(comFaixa.length).toBeGreaterThan(0);
    for (const r of registros.slice(0, 50)) {
      expect(r.uf).toBe("MS");
      expect(r.documentoNumero).not.toBe("");
      expect(r.dataEmissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.quantidade).toBeGreaterThan(0);
    }
  });

  it("não emite registros com quantidade zero", async () => {
    const registros = await parsearMs(FIXTURE);
    expect(registros.every((r) => r.quantidade > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/coletores/ms.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/coletores/ms.ts`**

```ts
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Janela, RegistroGta, Sexo } from "../tipos.js";
import { lerLinhas, serialParaDataISO, textoCelula } from "../xlsx/leitor.js";

const BASE = "https://api.ms.gov.br/api-esaniagro/v1/relatorio/DocumentosDeTransitoRel";
const ESPECIE_BOVINO = 1;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** As 4 faixas etárias que o relatório do MS traz, por sexo. */
const FAIXAS = ["0 A 12 MESES", "13 A 24 MESES", "25 A 36 MESES", "ACIMA DE 36 MESES"] as const;
const ROTULO_SEXO: Record<Sexo, string> = { FEMEA: "FÊMEA", MACHO: "MACHO" };

export function urlRelatorioMs(janela: Janela): string {
  const p = new URLSearchParams({
    especieAnimalID: String(ESPECIE_BOVINO),
    periodoInicial: janela.inicio,
    periodoFinal: janela.fim,
    municipioIDOrigem: "",
    municipioIDDestino: "",
    municipioUFDestino: "",
    finalidadeID: "",
  });
  return `${BASE}?${p.toString()}`;
}

export class RespostaInesperadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RespostaInesperadaError";
  }
}

/** Baixa o relatório e devolve o buffer, validando que é mesmo um XLSX. */
export async function baixarMs(janela: Janela, signal?: AbortSignal): Promise<Buffer> {
  const resposta = await fetch(urlRelatorioMs(janela), {
    headers: { "user-agent": USER_AGENT, "accept-encoding": "gzip, deflate" },
    signal: signal ?? AbortSignal.timeout(120_000),
  });

  if (!resposta.ok) {
    throw new RespostaInesperadaError(`IAGRO respondeu HTTP ${resposta.status}`);
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());

  // Assinatura de ZIP. Uma página de erro ou de manutenção jamais deve ser
  // gravada como se fosse dado: é falha, não zero.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new RespostaInesperadaError(
      `IAGRO devolveu conteúdo que não é XLSX (${buffer.length} bytes, início ${buffer.subarray(0, 8).toString("hex")})`,
    );
  }
  return buffer;
}

/** Lê o XLSX do MS e devolve os registros desnormalizados por sexo e faixa. */
export async function parsearMs(caminho: string): Promise<RegistroGta[]> {
  const registros: RegistroGta[] = [];

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "Tipo de Documento",
  })) {
    const especie = textoCelula(valores[colunas["Espécie"]!]);
    const finalidade = textoCelula(valores[colunas["Finalidade"]!]);
    if (especie !== "BOVINO" || !finalidade) continue;

    const bruto = valores[colunas["Data Emissão"]!];
    if (typeof bruto !== "number" && !(bruto instanceof Date)) continue;

    const comum = {
      uf: "MS" as const,
      documentoTipo: textoCelula(valores[colunas["Tipo de Documento"]!]),
      documentoNumero: textoCelula(valores[colunas["Número"]!]),
      documentoSerie: textoCelula(valores[colunas["Série"]!]),
      dataEmissao: serialParaDataISO(bruto),
      finalidade,
      municipioOrigem: textoCelula(valores[colunas["Município Origem"]!]) || null,
      municipioDestino: textoCelula(valores[colunas["Município Destino"]!]) || null,
      ufDestino: textoCelula(valores[colunas["UF Destino"]!]) || null,
    };

    for (const sexo of ["FEMEA", "MACHO"] as const) {
      for (const faixa of FAIXAS) {
        const indice = colunas[`${ROTULO_SEXO[sexo]} ${faixa}`];
        if (indice === undefined) continue;
        const quantidade = Number(valores[indice]) || 0;
        if (quantidade <= 0) continue;
        registros.push({ ...comum, sexo, faixaEtaria: faixa, quantidade });
      }
    }
  }

  return registros;
}

export interface ColetaMs {
  registros: RegistroGta[];
  arquivo: Buffer;
  hash: string;
  nomeArquivo: string;
}

/** Baixa, valida, arquiva em disco temporário e parseia. */
export async function coletarMs(janela: Janela, signal?: AbortSignal): Promise<ColetaMs> {
  const arquivo = await baixarMs(janela, signal);
  const hash = createHash("sha256").update(arquivo).digest("hex");
  const nomeArquivo = `ms/${janela.inicio}_a_${janela.fim}.xlsx`;
  const temporario = join(tmpdir(), `ms-${hash.slice(0, 12)}.xlsx`);
  await writeFile(temporario, arquivo);
  const registros = await parsearMs(temporario);
  return { registros, arquivo, hash, nomeArquivo };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/coletores/ms.test.ts`
Expected: PASS — 5 testes, com fêmeas 29.991 e machos 30.644

- [ ] **Step 5: Commit**

```bash
git add src/coletores/ms.ts tests/coletores/ms.test.ts
git commit -m "feat: coletor do MS validado contra arquivo real do IAGRO"
```

---

## Task 5: Camada de dados

**Files:**
- Create: `src/dados/cliente.ts`, `src/dados/coletas.ts`, `src/dados/registros.ts`, `src/dados/arquivos.ts`
- Create: `tests/dados/registros.test.ts`

- [ ] **Step 1: Implementar o cliente**

`src/dados/cliente.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lerConfig } from "../config.js";

let instancia: SupabaseClient | null = null;

/** Cliente com service_role: ignora RLS. Nunca exponha esta chave ao browser. */
export function obterCliente(): SupabaseClient {
  if (instancia) return instancia;
  const cfg = lerConfig();
  instancia = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return instancia;
}
```

- [ ] **Step 2: Implementar o registro de coletas**

`src/dados/coletas.ts`:

```ts
import type { Janela, StatusColeta, TipoColeta, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

export async function abrirColeta(args: {
  uf: UF;
  tipo: TipoColeta;
  janela: Janela;
}): Promise<number> {
  const { data, error } = await obterCliente()
    .from("coletas")
    .insert({
      uf: args.uf,
      tipo: args.tipo,
      janela_inicio: args.janela.inicio,
      janela_fim: args.janela.fim,
      status: "sem_dados",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao abrir coleta: ${error.message}`);
  return data.id as number;
}

export async function fecharColeta(args: {
  id: number;
  status: StatusColeta;
  arquivoPath?: string | null;
  arquivoHash?: string | null;
  linhasAfetadas?: number | null;
  erro?: string | null;
}): Promise<void> {
  const { error } = await obterCliente()
    .from("coletas")
    .update({
      status: args.status,
      arquivo_path: args.arquivoPath ?? null,
      arquivo_hash: args.arquivoHash ?? null,
      linhas_afetadas: args.linhasAfetadas ?? null,
      erro: args.erro ?? null,
      concluido_em: new Date().toISOString(),
    })
    .eq("id", args.id);

  if (error) throw new Error(`Falha ao fechar coleta ${args.id}: ${error.message}`);
}

/** Hashes de arquivos já processados com sucesso — usado pelo coletor do PA. */
export async function hashesProcessados(uf: UF): Promise<Set<string>> {
  const { data, error } = await obterCliente()
    .from("coletas")
    .select("arquivo_hash")
    .eq("uf", uf)
    .eq("status", "ok")
    .not("arquivo_hash", "is", null);

  if (error) throw new Error(`Falha ao ler hashes de ${uf}: ${error.message}`);
  return new Set((data ?? []).map((l) => l.arquivo_hash as string));
}
```

- [ ] **Step 3: Escrever o teste da deduplicação (falhando)**

O `ON CONFLICT` do Postgres quebra com erro 21000 se o mesmo lote trouxer a chave duas vezes. O arquivo do MS desnormaliza 8 colunas e o do PA quebra por categoria, então isso acontece na prática. `deduplicar` é a rede de segurança.

`tests/dados/registros.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deduplicar } from "../../src/dados/registros.js";
import type { RegistroGta } from "../../src/tipos.js";

const base: RegistroGta = {
  uf: "MS",
  documentoTipo: "GTA",
  documentoNumero: "123",
  documentoSerie: "A",
  dataEmissao: "2026-07-20",
  finalidade: "ABATE",
  sexo: "FEMEA",
  faixaEtaria: "13 A 24 MESES",
  quantidade: 10,
  municipioOrigem: "CAMPO GRANDE",
  municipioDestino: "DOURADOS",
  ufDestino: "MS",
};

describe("deduplicar", () => {
  it("soma quantidades de registros com a mesma chave natural", () => {
    const saida = deduplicar([base, { ...base, quantidade: 5 }]);
    expect(saida).toHaveLength(1);
    expect(saida[0]!.quantidade).toBe(15);
  });

  it("trata faixa nula como chave própria e não a mistura com outra faixa", () => {
    const saida = deduplicar([
      { ...base, faixaEtaria: null, quantidade: 3 },
      { ...base, faixaEtaria: null, quantidade: 4 },
      { ...base, faixaEtaria: "0 A 12 MESES", quantidade: 7 },
    ]);
    expect(saida).toHaveLength(2);
    expect(saida.find((r) => r.faixaEtaria === null)!.quantidade).toBe(7);
    expect(saida.find((r) => r.faixaEtaria === "0 A 12 MESES")!.quantidade).toBe(7);
  });

  it("mantém separados registros de sexos diferentes", () => {
    expect(deduplicar([base, { ...base, sexo: "MACHO" }])).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `npx vitest run tests/dados/registros.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 5: Implementar `src/dados/registros.ts`**

```ts
import type { RegistroGta, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

const TAMANHO_LOTE = 1000;

/**
 * Chave natural, igual à constraint `gta_registros_chave_natural` do banco.
 * Usa JSON para que `null` em faixaEtaria nunca colida com uma faixa real.
 */
export function chaveNatural(r: RegistroGta): string {
  return JSON.stringify([r.uf, r.documentoNumero, r.documentoSerie, r.sexo, r.faixaEtaria]);
}

/**
 * Soma registros que compartilham a chave natural do banco.
 * Sem isto, o ON CONFLICT falha com "cannot affect row a second time" (21000)
 * quando o arquivo do portal traz a mesma combinação duas vezes — o que
 * acontece na prática, já que MS e PA desnormalizam colunas em linhas.
 */
export function deduplicar(registros: RegistroGta[]): RegistroGta[] {
  const porChave = new Map<string, RegistroGta>();
  for (const r of registros) {
    const chave = chaveNatural(r);
    const existente = porChave.get(chave);
    if (existente) existente.quantidade += r.quantidade;
    else porChave.set(chave, { ...r });
  }
  return [...porChave.values()];
}

/** Grava os registros em lotes, atualizando os que já existem. */
export async function gravarRegistros(
  registros: RegistroGta[],
  coletaId: number,
): Promise<number> {
  const unicos = deduplicar(registros);
  const cliente = obterCliente();
  let gravados = 0;

  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE).map((r) => ({
      coleta_id: coletaId,
      uf: r.uf,
      documento_tipo: r.documentoTipo,
      documento_numero: r.documentoNumero,
      documento_serie: r.documentoSerie,
      data_emissao: r.dataEmissao,
      finalidade: r.finalidade,
      sexo: r.sexo,
      faixa_etaria: r.faixaEtaria,
      quantidade: r.quantidade,
      municipio_origem: r.municipioOrigem,
      municipio_destino: r.municipioDestino,
      uf_destino: r.ufDestino,
    }));

    const { error } = await cliente
      .from("gta_registros")
      .upsert(lote, { onConflict: "uf,documento_numero,documento_serie,sexo,faixa_etaria" });

    if (error) throw new Error(`Falha ao gravar registros: ${error.message}`);
    gravados += lote.length;
  }

  return gravados;
}
```

Note que `gravarRegistros` **atualiza e insere, mas nunca apaga**. Se um portal corrigir uma GTA e uma combinação de sexo e faixa deixar de existir, a linha antiga permanece e infla o total daquele mês. Isso é raro e não vale a complexidade de resolver agora, mas está registrado nas Notas de Operação no fim deste plano.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/dados/registros.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 7: Implementar o arquivamento de brutos**

`src/dados/arquivos.ts`:

```ts
import { obterCliente } from "./cliente.js";

const BUCKET = "brutos";

/**
 * Arquiva o arquivo bruto antes de qualquer parse. Um parser com bug pode ser
 * corrigido e reexecutado sobre todo o histórico sem tocar nos portais — que
 * não guardam dados acessíveis indefinidamente.
 */
export async function arquivarBruto(args: {
  caminho: string;
  conteudo: Buffer;
  contentType?: string;
}): Promise<string> {
  const { error } = await obterCliente()
    .storage.from(BUCKET)
    .upload(args.caminho, args.conteudo, {
      contentType:
        args.contentType ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (error) throw new Error(`Falha ao arquivar ${args.caminho}: ${error.message}`);
  return args.caminho;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/dados tests/dados
git commit -m "feat: camada de dados com upsert idempotente e arquivamento de brutos"
```

---

## Task 6: Rollup mensal

**Files:**
- Create: `src/dados/mensal.ts`
- Create: `tests/dados/mensal.test.ts`

- [ ] **Step 1: Escrever o teste do cálculo de competência (falhando)**

`tests/dados/mensal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { competenciasDaJanela } from "../../src/dados/mensal.js";

describe("competenciasDaJanela", () => {
  it("devolve uma competência para janela dentro do mesmo mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-20", fim: "2026-07-26" })).toEqual([
      "2026-07-01",
    ]);
  });

  it("devolve as duas competências quando a janela cruza a virada do mês", () => {
    expect(competenciasDaJanela({ inicio: "2026-07-28", fim: "2026-08-03" })).toEqual([
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("cobre a virada de ano", () => {
    expect(competenciasDaJanela({ inicio: "2026-12-30", fim: "2027-01-02" })).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/dados/mensal.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/dados/mensal.ts`**

```ts
import type { AgregadoMensal, Janela, UF } from "../tipos.js";
import { obterCliente } from "./cliente.js";

/**
 * Lista os primeiros dias de cada mês tocado pela janela.
 * Uma janela de rejanela pode cruzar a virada, e nesse caso os dois meses
 * precisam ser reagregados.
 */
export function competenciasDaJanela(janela: Janela): string[] {
  const competencias: string[] = [];
  const inicio = new Date(`${janela.inicio}T00:00:00Z`);
  const fim = new Date(`${janela.fim}T00:00:00Z`);
  const cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));

  while (cursor <= fim) {
    const ano = cursor.getUTCFullYear();
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    competencias.push(`${ano}-${mes}-01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return competencias;
}

/** Reagrega gta_registros nos meses tocados pela janela. */
export async function rollupJanela(args: {
  uf: UF;
  janela: Janela;
  coletaId: number;
}): Promise<number> {
  const cliente = obterCliente();
  let alteradas = 0;

  for (const competencia of competenciasDaJanela(args.janela)) {
    const { data, error } = await cliente.rpc("rollup_abate_mensal", {
      p_uf: args.uf,
      p_competencia: competencia,
      p_coleta_id: args.coletaId,
    });
    if (error) throw new Error(`Falha no rollup de ${args.uf} ${competencia}: ${error.message}`);
    alteradas += Number(data ?? 0);
  }
  return alteradas;
}

/** Grava um agregado que já vem pronto da fonte (caso do RO). */
export async function gravarAgregados(
  agregados: AgregadoMensal[],
  coletaId: number,
): Promise<void> {
  if (agregados.length === 0) return;
  const { error } = await obterCliente()
    .from("abate_mensal")
    .upsert(
      agregados.map((a) => ({
        uf: a.uf,
        ano: a.ano,
        mes: a.mes,
        finalidade: a.finalidade,
        sexo: a.sexo,
        quantidade: a.quantidade,
        fonte: "powerbi",
        coleta_id: coletaId,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,ano,mes,finalidade,sexo" },
    );
  if (error) throw new Error(`Falha ao gravar agregados: ${error.message}`);
}

export interface LinhaMensal {
  uf: UF;
  ano: number;
  mes: number;
  sexo: "MACHO" | "FEMEA";
  quantidade: number;
}

/** Lê o abate mensal que alimenta a planilha. Igualdade exata em ABATE. */
export async function lerAbateMensal(): Promise<LinhaMensal[]> {
  const { data, error } = await obterCliente()
    .from("abate_mensal")
    .select("uf, ano, mes, sexo, quantidade")
    // Igualdade exata, nunca prefixo: "ABATE SANITÁRIO" e "SACRIFÍCIO" são
    // abate por determinação sanitária, não decisão econômica do pecuarista.
    .eq("finalidade", "ABATE")
    .order("ano")
    .order("mes");

  if (error) throw new Error(`Falha ao ler abate mensal: ${error.message}`);
  return (data ?? []) as LinhaMensal[];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/dados/mensal.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 5: Commit**

```bash
git add src/dados/mensal.ts tests/dados/mensal.test.ts
git commit -m "feat: rollup mensal com cobertura de virada de mês"
```

---

## Task 7: Semente do histórico

Importa a planilha atual do sócio (jan/2025 a jun/2026) como ponto de partida, com as duas correções que ele confirmou.

**Files:**
- Create: `src/semente/importar-historico.ts`, `tests/semente/importar-historico.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

`tests/semente/importar-historico.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lerCsvHistorico } from "../../src/semente/importar-historico.js";

const CSV = "referencias/planilha-abate-2025-2026.csv";

describe("lerCsvHistorico", () => {
  it("lê os valores de um mês completo", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const mtJan = linhas.filter((l) => l.uf === "MT" && l.ano === 2025 && l.mes === 1);
    expect(mtJan.find((l) => l.sexo === "FEMEA")!.quantidade).toBe(333650);
    expect(mtJan.find((l) => l.sexo === "MACHO")!.quantidade).toBe(288211);
  });

  it("normaliza o separador de milhar de MS fev/2025", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const msFev = linhas.find(
      (l) => l.uf === "MS" && l.ano === 2025 && l.mes === 2 && l.sexo === "FEMEA",
    );
    // A célula está gravada como texto "186.830" ao contrário de todas as outras.
    expect(msFev!.quantidade).toBe(186830);
  });

  it("corrige as colunas invertidas de PA jul/2025", async () => {
    const linhas = await lerCsvHistorico(CSV);
    const paJul = linhas.filter((l) => l.uf === "PA" && l.ano === 2025 && l.mes === 7);
    // No CSV está fêmea 86.612 e macho 138.294, invertido em relação a todos
    // os outros meses do estado. O sócio confirmou que foi erro de cópia.
    expect(paJul.find((l) => l.sexo === "FEMEA")!.quantidade).toBe(138294);
    expect(paJul.find((l) => l.sexo === "MACHO")!.quantidade).toBe(86612);
  });

  it("ignora meses vazios e as colunas de GO e SP", async () => {
    const linhas = await lerCsvHistorico(CSV);
    expect(linhas.some((l) => l.ano === 2026 && l.mes === 12)).toBe(false);
    expect(linhas.every((l) => ["MT", "MS", "RO", "PA"].includes(l.uf))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/semente/importar-historico.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/semente/importar-historico.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { Sexo, UF } from "../tipos.js";
import { obterCliente } from "../dados/cliente.js";

/** Ordem das colunas na planilha do sócio: pares Fêmea/Macho por estado. */
const ORDEM_ESTADOS: Array<UF | null> = ["MT", "MS", "RO", "PA", null, null];

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Correções confirmadas com o sócio antes de semear o banco. */
const COLUNAS_INVERTIDAS = new Set(["PA-2025-7"]);

export interface LinhaHistorico {
  uf: UF;
  ano: number;
  mes: number;
  sexo: Sexo;
  quantidade: number;
}

function parsearNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\./g, "").replace(/,/g, "");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function lerCsvHistorico(caminho: string): Promise<LinhaHistorico[]> {
  const texto = await readFile(caminho, "utf8");
  const linhas = texto.split("\n").slice(2); // pula as duas linhas de cabeçalho
  const saida: LinhaHistorico[] = [];

  for (const linha of linhas) {
    const celulas = linha.split(",");
    const mes = MESES[(celulas[0] ?? "").trim().toLowerCase()];
    const ano = Number((celulas[1] ?? "").trim());
    if (!mes || !Number.isFinite(ano)) continue;

    ORDEM_ESTADOS.forEach((uf, i) => {
      if (!uf) return;
      let femea = parsearNumero(celulas[2 + i * 2] ?? "");
      let macho = parsearNumero(celulas[3 + i * 2] ?? "");
      if (femea === null && macho === null) return;

      if (COLUNAS_INVERTIDAS.has(`${uf}-${ano}-${mes}`)) {
        [femea, macho] = [macho, femea];
      }

      if (femea !== null) saida.push({ uf, ano, mes, sexo: "FEMEA", quantidade: femea });
      if (macho !== null) saida.push({ uf, ano, mes, sexo: "MACHO", quantidade: macho });
    });
  }

  return saida;
}

/** Semeia abate_mensal. Não sobrescreve dado já coletado automaticamente. */
export async function semearHistorico(caminho: string): Promise<number> {
  const linhas = await lerCsvHistorico(caminho);
  const { error } = await obterCliente()
    .from("abate_mensal")
    .upsert(
      linhas.map((l) => ({
        uf: l.uf,
        ano: l.ano,
        mes: l.mes,
        finalidade: "ABATE",
        sexo: l.sexo,
        quantidade: l.quantidade,
        fonte: "manual",
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: "uf,ano,mes,finalidade,sexo", ignoreDuplicates: true },
    );

  if (error) throw new Error(`Falha ao semear histórico: ${error.message}`);
  return linhas.length;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/semente/importar-historico.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Executar a semeadura e conferir**

Run: `npx tsx -e "import('./src/semente/importar-historico.js').then(m => m.semearHistorico('referencias/planilha-abate-2025-2026.csv')).then(n => console.log('linhas:', n))"`
Expected: imprime o número de linhas semeadas (144 para 18 meses × 4 estados × 2 sexos)

- [ ] **Step 6: Commit**

```bash
git add src/semente tests/semente
git commit -m "feat: semente do histórico com as duas correções confirmadas"
```

---

## Task 8: Geração da planilha — aba de dados

**Files:**
- Create: `src/planilha/gerar.ts`, `tests/planilha/gerar.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

`tests/planilha/gerar.test.ts`:

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { montarGradeDados } from "../../src/planilha/gerar.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

const dados: LinhaMensal[] = [
  { uf: "MT", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 333650 },
  { uf: "MT", ano: 2025, mes: 1, sexo: "MACHO", quantidade: 288211 },
  { uf: "MS", ano: 2025, mes: 1, sexo: "FEMEA", quantidade: 185419 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "FEMEA", quantidade: 188406 },
  { uf: "PA", ano: 2026, mes: 5, sexo: "MACHO", quantidade: 152453 },
];

describe("montarGradeDados", () => {
  it("preserva a ordem de colunas da planilha original, com GO e SP vazios", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.cabecalhoEstados).toEqual([
      "Mato Grosso", "Mato Grosso do Sul", "Rondonia", "Pará", "Goias", "São Paulo",
    ]);
    expect(grade.cabecalhoSexos).toHaveLength(12);
  });

  it("posiciona cada valor na célula certa", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const jan2025 = grade.linhas.find((l) => l.ano === 2025 && l.mes === 1)!;
    expect(jan2025.rotuloMes).toBe("Janeiro");
    expect(jan2025.valores[0]).toBe(333650); // MT fêmea
    expect(jan2025.valores[1]).toBe(288211); // MT macho
    expect(jan2025.valores[2]).toBe(185419); // MS fêmea
    expect(jan2025.valores[3]).toBeNull();   // MS macho ausente
    expect(jan2025.valores[8]).toBeNull();   // Goiás fêmea, sempre vazio
  });

  it("gera todos os meses do intervalo, mesmo sem dados", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    expect(grade.linhas).toHaveLength(24);
    expect(grade.linhas[23]!.rotuloMes).toBe("Dezembro");
    expect(grade.linhas[23]!.ano).toBe(2026);
  });

  it("coloca o valor do PA de maio/2026 na posição correta", () => {
    const grade = montarGradeDados(dados, 2025, 2026);
    const maio = grade.linhas.find((l) => l.ano === 2026 && l.mes === 5)!;
    expect(maio.valores[6]).toBe(188406); // PA fêmea
    expect(maio.valores[7]).toBe(152453); // PA macho
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/planilha/gerar.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/planilha/gerar.ts`**

```ts
import ExcelJS from "exceljs";
import type { LinhaMensal } from "../dados/mensal.js";
import type { Sexo, UF } from "../tipos.js";

/**
 * Ordem das colunas na planilha que o fazendeiro já conhece.
 * Goiás e São Paulo continuam presentes e vazios de propósito: não existe
 * fonte estadual pública equivalente, e mudar o formato agora atrapalharia.
 */
const ESTADOS: Array<{ rotulo: string; uf: UF | null }> = [
  { rotulo: "Mato Grosso", uf: "MT" },
  { rotulo: "Mato Grosso do Sul", uf: "MS" },
  { rotulo: "Rondonia", uf: "RO" },
  { rotulo: "Pará", uf: "PA" },
  { rotulo: "Goias", uf: null },
  { rotulo: "São Paulo", uf: null },
];

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const SEXOS: Sexo[] = ["FEMEA", "MACHO"];

export interface LinhaGrade {
  rotuloMes: string;
  ano: number;
  mes: number;
  /** 12 posições: pares fêmea/macho na ordem de ESTADOS. */
  valores: Array<number | null>;
}

export interface Grade {
  cabecalhoEstados: string[];
  cabecalhoSexos: string[];
  linhas: LinhaGrade[];
}

export function montarGradeDados(
  dados: LinhaMensal[],
  anoInicial: number,
  anoFinal: number,
): Grade {
  const indice = new Map<string, number>();
  for (const d of dados) indice.set(`${d.uf}-${d.ano}-${d.mes}-${d.sexo}`, d.quantidade);

  const linhas: LinhaGrade[] = [];
  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const valores: Array<number | null> = [];
      for (const estado of ESTADOS) {
        for (const sexo of SEXOS) {
          valores.push(estado.uf ? indice.get(`${estado.uf}-${ano}-${mes}-${sexo}`) ?? null : null);
        }
      }
      linhas.push({ rotuloMes: NOMES_MESES[mes - 1]!, ano, mes, valores });
    }
  }

  return {
    cabecalhoEstados: ESTADOS.map((e) => e.rotulo),
    cabecalhoSexos: ESTADOS.flatMap(() => ["Fêmea", "Macho"]),
    linhas,
  };
}

/** Escreve a aba de dados no formato que o fazendeiro já conhece. */
export function escreverAbaDados(planilha: ExcelJS.Workbook, grade: Grade): void {
  const aba = planilha.addWorksheet("Abate");

  const linhaEstados: Array<string | null> = [null, null];
  for (const rotulo of grade.cabecalhoEstados) linhaEstados.push(rotulo, null);
  aba.addRow(linhaEstados);

  aba.addRow(["Mês", "Ano", ...grade.cabecalhoSexos]);

  for (const linha of grade.linhas) {
    aba.addRow([linha.rotuloMes, linha.ano, ...linha.valores]);
  }

  // mescla o rótulo de cada estado sobre o par fêmea/macho
  grade.cabecalhoEstados.forEach((_, i) => {
    const coluna = 3 + i * 2;
    aba.mergeCells(1, coluna, 1, coluna + 1);
  });

  aba.getRow(1).font = { bold: true };
  aba.getRow(2).font = { bold: true };
  aba.getColumn(1).width = 12;
  aba.getColumn(2).width = 8;
  for (let c = 3; c <= 14; c++) {
    aba.getColumn(c).width = 12;
    aba.getColumn(c).numFmt = "#,##0";
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/planilha/gerar.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Commit**

```bash
git add src/planilha tests/planilha
git commit -m "feat: aba de dados da planilha no layout original"
```

---

## Task 9: KPIs e aba do ciclo

Os indicadores são lidos **contra a média histórica**, nunca em nível absoluto: ganhos de produtividade deslocam os patamares ao longo do tempo, e as fases do ciclo se sobrepõem.

**Files:**
- Create: `src/planilha/kpis.ts`, `tests/planilha/kpis.test.ts`
- Modify: `src/planilha/gerar.ts` (adicionar `escreverAbaCiclo` e `gerarPlanilha`)

- [ ] **Step 1: Escrever o teste (falhando)**

`tests/planilha/kpis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calcularKpis, participacaoFemeas } from "../../src/planilha/kpis.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

describe("participacaoFemeas", () => {
  it("calcula a fração de fêmeas no total", () => {
    expect(participacaoFemeas(40, 60)).toBeCloseTo(0.4, 6);
  });

  it("devolve null quando não há abate", () => {
    expect(participacaoFemeas(0, 0)).toBeNull();
  });
});

describe("calcularKpis", () => {
  const dados: LinhaMensal[] = [
    { uf: "MT", ano: 2026, mes: 5, sexo: "FEMEA", quantidade: 300 },
    { uf: "MT", ano: 2026, mes: 5, sexo: "MACHO", quantidade: 700 },
    { uf: "MT", ano: 2026, mes: 6, sexo: "FEMEA", quantidade: 450 },
    { uf: "MT", ano: 2026, mes: 6, sexo: "MACHO", quantidade: 550 },
    { uf: "MS", ano: 2026, mes: 6, sexo: "FEMEA", quantidade: 500 },
    { uf: "MS", ano: 2026, mes: 6, sexo: "MACHO", quantidade: 500 },
  ];

  it("calcula participação por estado e consolidada", () => {
    const kpis = calcularKpis(dados);
    const junhoMt = kpis.find((k) => k.uf === "MT" && k.ano === 2026 && k.mes === 6)!;
    expect(junhoMt.participacaoFemeas).toBeCloseTo(0.45, 6);

    const junhoTotal = kpis.find((k) => k.uf === "CONSOLIDADO" && k.mes === 6)!;
    expect(junhoTotal.participacaoFemeas).toBeCloseTo(0.475, 6);
  });

  it("calcula a variação contra o mês anterior em pontos percentuais", () => {
    const kpis = calcularKpis(dados);
    const junhoMt = kpis.find((k) => k.uf === "MT" && k.mes === 6)!;
    // 45% contra 30% no mês anterior
    expect(junhoMt.variacaoMesAnteriorPp).toBeCloseTo(0.15, 6);
  });

  it("deixa a variação nula quando não há mês anterior", () => {
    const kpis = calcularKpis(dados);
    const maioMt = kpis.find((k) => k.uf === "MT" && k.mes === 5)!;
    expect(maioMt.variacaoMesAnteriorPp).toBeNull();
    expect(maioMt.variacaoAnoAnteriorPp).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/planilha/kpis.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/planilha/kpis.ts`**

```ts
import type { LinhaMensal } from "../dados/mensal.js";
import type { UF } from "../tipos.js";

export type EscopoKpi = UF | "CONSOLIDADO";

export interface Kpi {
  uf: EscopoKpi;
  ano: number;
  mes: number;
  femeas: number;
  machos: number;
  total: number;
  /** Fração de 0 a 1, ou null quando não houve abate. */
  participacaoFemeas: number | null;
  /** Diferença em pontos percentuais (0,15 = 15 p.p.). */
  variacaoMesAnteriorPp: number | null;
  variacaoAnoAnteriorPp: number | null;
  /** Média móvel de 12 meses da participação; null antes de 12 observações. */
  mediaMovel12m: number | null;
}

export function participacaoFemeas(femeas: number, machos: number): number | null {
  const total = femeas + machos;
  return total === 0 ? null : femeas / total;
}

export function calcularKpis(dados: LinhaMensal[]): Kpi[] {
  const acumulado = new Map<string, { femeas: number; machos: number }>();

  const somar = (escopo: EscopoKpi, ano: number, mes: number, sexo: string, qtd: number) => {
    const chave = `${escopo}|${ano}|${mes}`;
    const atual = acumulado.get(chave) ?? { femeas: 0, machos: 0 };
    if (sexo === "FEMEA") atual.femeas += qtd;
    else atual.machos += qtd;
    acumulado.set(chave, atual);
  };

  for (const d of dados) {
    somar(d.uf, d.ano, d.mes, d.sexo, d.quantidade);
    somar("CONSOLIDADO", d.ano, d.mes, d.sexo, d.quantidade);
  }

  const kpis: Kpi[] = [...acumulado.entries()]
    .map(([chave, { femeas, machos }]) => {
      const [uf, ano, mes] = chave.split("|");
      return {
        uf: uf as EscopoKpi,
        ano: Number(ano),
        mes: Number(mes),
        femeas,
        machos,
        total: femeas + machos,
        participacaoFemeas: participacaoFemeas(femeas, machos),
        variacaoMesAnteriorPp: null as number | null,
        variacaoAnoAnteriorPp: null as number | null,
        mediaMovel12m: null as number | null,
      };
    })
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.ano - b.ano || a.mes - b.mes);

  const porChave = new Map(kpis.map((k) => [`${k.uf}|${k.ano}|${k.mes}`, k]));

  for (const kpi of kpis) {
    if (kpi.participacaoFemeas === null) continue;

    const anterior = kpi.mes === 1
      ? porChave.get(`${kpi.uf}|${kpi.ano - 1}|12`)
      : porChave.get(`${kpi.uf}|${kpi.ano}|${kpi.mes - 1}`);
    if (anterior?.participacaoFemeas != null) {
      kpi.variacaoMesAnteriorPp = kpi.participacaoFemeas - anterior.participacaoFemeas;
    }

    const anoPassado = porChave.get(`${kpi.uf}|${kpi.ano - 1}|${kpi.mes}`);
    if (anoPassado?.participacaoFemeas != null) {
      kpi.variacaoAnoAnteriorPp = kpi.participacaoFemeas - anoPassado.participacaoFemeas;
    }

    const janela: number[] = [];
    for (let i = 0; i < 12; i++) {
      const total = kpi.mes - 1 - i;
      const ano = kpi.ano + Math.floor(total / 12);
      const mes = ((total % 12) + 12) % 12 + 1;
      const p = porChave.get(`${kpi.uf}|${ano}|${mes}`)?.participacaoFemeas;
      if (p != null) janela.push(p);
    }
    if (janela.length === 12) {
      kpi.mediaMovel12m = janela.reduce((s, v) => s + v, 0) / 12;
    }
  }

  return kpis;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/planilha/kpis.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Adicionar a aba do ciclo em `src/planilha/gerar.ts`**

Acrescente estes dois imports junto dos que já existem no **topo** do arquivo:

```ts
import { calcularKpis, type Kpi } from "./kpis.js";
import { lerAbateMensal } from "../dados/mensal.js";
```

E acrescente o restante ao final do arquivo:

```ts
const ROTULO_ESCOPO: Record<string, string> = {
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  RO: "Rondônia",
  PA: "Pará",
  CONSOLIDADO: "Consolidado",
};

/** Aba de leitura do ciclo: participação de fêmeas e suas variações. */
export function escreverAbaCiclo(planilha: ExcelJS.Workbook, kpis: Kpi[]): void {
  const aba = planilha.addWorksheet("Ciclo");

  aba.addRow([
    "Estado", "Ano", "Mês", "Fêmeas", "Machos", "Total",
    "% Fêmeas", "Var. mês anterior (p.p.)", "Var. ano anterior (p.p.)", "Média móvel 12m",
  ]);
  aba.getRow(1).font = { bold: true };

  const ordenados = [...kpis].sort(
    (a, b) => b.ano - a.ano || b.mes - a.mes || a.uf.localeCompare(b.uf),
  );

  for (const k of ordenados) {
    aba.addRow([
      ROTULO_ESCOPO[k.uf] ?? k.uf,
      k.ano,
      NOMES_MESES[k.mes - 1],
      k.femeas,
      k.machos,
      k.total,
      k.participacaoFemeas,
      k.variacaoMesAnteriorPp,
      k.variacaoAnoAnteriorPp,
      k.mediaMovel12m,
    ]);
  }

  aba.getColumn(1).width = 20;
  for (const c of [4, 5, 6]) aba.getColumn(c).numFmt = "#,##0";
  for (const c of [7, 8, 9, 10]) {
    aba.getColumn(c).numFmt = "0.0%";
    aba.getColumn(c).width = 22;
  }
}

/** Monta a planilha completa a partir do banco. */
export async function gerarPlanilha(): Promise<Buffer> {
  const dados = await lerAbateMensal();
  const anos = dados.map((d) => d.ano);
  const anoInicial = anos.length ? Math.min(...anos) : new Date().getUTCFullYear();
  const anoFinal = Math.max(anoInicial, new Date().getUTCFullYear());

  const planilha = new ExcelJS.Workbook();
  planilha.created = new Date();
  escreverAbaDados(planilha, montarGradeDados(dados, anoInicial, anoFinal));
  escreverAbaCiclo(planilha, calcularKpis(dados));

  return Buffer.from(await planilha.xlsx.writeBuffer());
}
```

- [ ] **Step 6: Rodar toda a suíte**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em todos os testes, sem erro de tipo

- [ ] **Step 7: Commit**

```bash
git add src/planilha tests/planilha
git commit -m "feat: aba de KPIs do ciclo com participação de fêmeas e médias móveis"
```

---

## Task 10: Envio pela Evolution API

**Files:**
- Create: `src/notificacao/evolution.ts`, `src/notificacao/alertas.ts`, `tests/notificacao/evolution.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

`tests/notificacao/evolution.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionApiError, enviarDocumento, normalizarNumero } from "../../src/notificacao/evolution.js";

afterEach(() => vi.unstubAllGlobals());

describe("normalizarNumero", () => {
  it("remove máscara e sufixo de JID", () => {
    expect(normalizarNumero("+55 (67) 99999-9999")).toBe("5567999999999");
    expect(normalizarNumero("5567999999999@s.whatsapp.net")).toBe("5567999999999");
  });

  it("rejeita número curto demais", () => {
    expect(() => normalizarNumero("1234")).toThrow(/inválido/i);
  });
});

describe("enviarDocumento", () => {
  const base = {
    instancia: "peciclo",
    apiKey: "k",
    baseUrl: "https://evo.exemplo.com",
    numero: "5567999999999",
    arquivo: Buffer.from("PKconteudo"),
    nomeArquivo: "abate-2026-07-27.xlsx",
  };

  it("envia com o path, header e corpo corretos", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ key: { id: "BAE5", remoteJid: "x", fromMe: true } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await enviarDocumento(base);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://evo.exemplo.com/message/sendMedia/peciclo");
    expect((init as RequestInit).headers).toMatchObject({ apikey: "k" });
    const corpo = JSON.parse((init as RequestInit).body as string);
    expect(corpo.mediatype).toBe("document");
    expect(corpo.fileName).toBe("abate-2026-07-27.xlsx");
    expect(corpo.number).toBe("5567999999999");
    expect(typeof corpo.media).toBe("string");
  });

  it("exige extensão .xlsx porque o servidor deriva o mimetype do nome", async () => {
    await expect(enviarDocumento({ ...base, nomeArquivo: "abate" })).rejects.toThrow(/\.xlsx/);
  });

  it("lança EvolutionApiError quando a API recusa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ response: { message: ["número não existe no WhatsApp"] } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ));
    await expect(enviarDocumento(base)).rejects.toThrow(EvolutionApiError);
  });

  it("recusa buffer vazio", async () => {
    await expect(enviarDocumento({ ...base, arquivo: Buffer.alloc(0) })).rejects.toThrow(/vazio/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/notificacao/evolution.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/notificacao/evolution.ts`**

```ts
export const XLSX_MIMETYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class EvolutionApiError extends Error {
  status: number;
  corpo: unknown;
  constructor(mensagem: string, status: number, corpo: unknown) {
    super(mensagem);
    this.name = "EvolutionApiError";
    this.status = status;
    this.corpo = corpo;
  }
}

/** Aceita máscara e JID; devolve só dígitos, no formato DDI+DDD+numero. */
export function normalizarNumero(numero: string): string {
  const limpo = numero.split("@")[0]!.replace(/\D/g, "");
  if (limpo.length < 10) {
    throw new EvolutionApiError(
      `Número inválido: "${numero}". Use DDI+DDD+numero (ex.: 5567999999999).`,
      0,
      null,
    );
  }
  return limpo;
}

function extrairMensagemErro(corpo: unknown, padrao: string): string {
  const achatar = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  if (corpo && typeof corpo === "object") {
    const c = corpo as Record<string, any>;
    const msg = c.response?.message ?? c.message ?? c.error;
    if (Array.isArray(msg)) return msg.map(achatar).join("; ");
    if (msg != null) return achatar(msg);
  }
  if (typeof corpo === "string" && corpo.trim()) return corpo.slice(0, 500);
  return padrao;
}

/** Confere se a instância está conectada antes de tentar enviar. */
export async function instanciaConectada(args: {
  instancia: string;
  apiKey: string;
  baseUrl: string;
}): Promise<boolean> {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/instance/connectionState/${encodeURIComponent(args.instancia)}`;
  const resposta = await fetch(url, {
    headers: { apikey: args.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resposta.ok) return false;
  const json = (await resposta.json()) as any;
  return (json?.instance?.state ?? json?.state) === "open";
}

export async function enviarDocumento(params: {
  instancia: string;
  apiKey: string;
  baseUrl: string;
  numero: string;
  arquivo: Buffer;
  nomeArquivo: string;
  legenda?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  if (!Buffer.isBuffer(params.arquivo) || params.arquivo.length === 0) {
    throw new EvolutionApiError("Buffer do arquivo vazio ou inválido.", 0, null);
  }
  // O servidor deriva o mimetype de fileName e ignora o mimetype enviado.
  // Sem extensão conhecida, o lookup falha e o arquivo chega quebrado.
  if (!/\.xlsx$/i.test(params.nomeArquivo)) {
    throw new EvolutionApiError(
      `nomeArquivo precisa terminar em .xlsx (recebido: "${params.nomeArquivo}").`,
      0,
      null,
    );
  }

  const url = `${params.baseUrl.replace(/\/+$/, "")}/message/sendMedia/${encodeURIComponent(params.instancia)}`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: { apikey: params.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      number: normalizarNumero(params.numero),
      mediatype: "document",
      mimetype: XLSX_MIMETYPE,
      fileName: params.nomeArquivo,
      caption: params.legenda ?? "",
      media: params.arquivo.toString("base64"),
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
  });

  const tipo = resposta.headers.get("content-type") ?? "";
  const corpo = tipo.includes("application/json") ? await resposta.json() : await resposta.text();

  if (!resposta.ok) {
    throw new EvolutionApiError(
      extrairMensagemErro(corpo, `Evolution respondeu HTTP ${resposta.status}`),
      resposta.status,
      corpo,
    );
  }
  return corpo;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/notificacao/evolution.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Implementar `src/notificacao/alertas.ts`**

```ts
import { lerConfig } from "../config.js";
import { normalizarNumero } from "./evolution.js";

/**
 * Alerta técnico, só para o operador. O fazendeiro nunca recebe mensagem de
 * erro: ele recebe a planilha, e quem sabe que algo quebrou é a operação.
 */
export async function alertarOperador(assunto: string, detalhe: string): Promise<void> {
  const cfg = lerConfig();
  const url = `${cfg.evolutionBaseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.evolutionInstancia)}`;

  const resposta = await fetch(url, {
    method: "POST",
    headers: { apikey: cfg.evolutionApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      number: normalizarNumero(cfg.whatsappOperador),
      text: `⚠️ ${assunto}\n\n${detalhe}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  // Falha de alerta nunca deve derrubar a coleta que ela está reportando.
  if (!resposta.ok) {
    console.error(`Falha ao alertar operador: HTTP ${resposta.status}`);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/notificacao tests/notificacao
git commit -m "feat: envio de documento e alerta técnico pela Evolution API"
```

---

## Task 11: Orquestração — primeira fatia de ponta a ponta

Ao fim desta tarefa o sistema roda sozinho todo dia com o MS. Os outros estados entram depois, sem mexer nesta estrutura.

**Files:**
- Create: `trigger.config.ts`, `src/trigger/coletor-ms.ts`, `src/trigger/gerar-e-enviar.ts`, `src/trigger/coleta-diaria.ts`

- [ ] **Step 1: Criar `trigger.config.ts` na raiz**

```ts
import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  runtime: "node-22",
  dirs: ["./src/trigger"],
  logLevel: "info",
  maxDuration: 600,
  machine: "small-2x",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 10_000,
      maxTimeoutInMs: 120_000,
      randomize: true,
    },
  },
  build: {
    external: ["playwright"],
    extensions: [playwright({ browsers: ["chromium"], headless: true })],
  },
});
```

- [ ] **Step 2: Criar a task do coletor do MS**

`src/trigger/coletor-ms.ts`:

```ts
import { logger, task } from "@trigger.dev/sdk";
import { coletarMs } from "../coletores/ms.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";
import type { Janela, TipoColeta } from "../tipos.js";

export const coletorMs = task({
  id: "coletor-ms",
  machine: "small-2x",
  maxDuration: 300,
  run: async (payload: { janela: Janela; tipo?: TipoColeta }) => {
    const tipo = payload.tipo ?? "diaria";
    const coletaId = await abrirColeta({ uf: "MS", tipo, janela: payload.janela });

    try {
      const { registros, arquivo, hash, nomeArquivo } = await coletarMs(payload.janela);
      await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
      const gravados = await gravarRegistros(registros, coletaId);
      const alteradas = await rollupJanela({ uf: "MS", janela: payload.janela, coletaId });

      await fecharColeta({
        id: coletaId,
        status: registros.length > 0 ? "ok" : "sem_dados",
        arquivoPath: nomeArquivo,
        arquivoHash: hash,
        linhasAfetadas: gravados,
      });

      logger.info("coletor MS concluído", { gravados, alteradas });
      return { uf: "MS" as const, registros: registros.length, gravados, alteradas };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
```

- [ ] **Step 3: Criar a task de geração e envio**

`src/trigger/gerar-e-enviar.ts`:

```ts
import { logger, task } from "@trigger.dev/sdk";
import { lerConfig } from "../config.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gerarPlanilha } from "../planilha/gerar.js";
import { enviarDocumento, instanciaConectada } from "../notificacao/evolution.js";
import { alertarOperador } from "../notificacao/alertas.js";

export const gerarEEnviar = task({
  id: "gerar-e-enviar",
  machine: "small-2x",
  maxDuration: 600,
  run: async (payload: { dataReferencia: string; ufsComFalha: string[] }) => {
    const cfg = lerConfig();
    const arquivo = await gerarPlanilha();
    const nomeArquivo = `abate-ciclo-pecuario-${payload.dataReferencia}.xlsx`;

    await arquivarBruto({ caminho: `planilhas/${nomeArquivo}`, conteudo: arquivo });

    if (!(await instanciaConectada({
      instancia: cfg.evolutionInstancia,
      apiKey: cfg.evolutionApiKey,
      baseUrl: cfg.evolutionBaseUrl,
    }))) {
      await alertarOperador(
        "Instância da Evolution desconectada",
        `A planilha de ${payload.dataReferencia} foi gerada e arquivada, mas não pôde ser enviada.`,
      );
      return { enviados: 0, arquivada: true };
    }

    let enviados = 0;
    for (const numero of cfg.whatsappDestinatarios) {
      try {
        await enviarDocumento({
          instancia: cfg.evolutionInstancia,
          apiKey: cfg.evolutionApiKey,
          baseUrl: cfg.evolutionBaseUrl,
          numero,
          arquivo,
          nomeArquivo,
          legenda: `Abate bovino — atualizado em ${payload.dataReferencia}`,
        });
        enviados++;
      } catch (erro) {
        // Um destinatário com problema não pode impedir os outros de receber.
        logger.error("falha ao enviar para destinatário", {
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    return { enviados, arquivada: true };
  },
});
```

- [ ] **Step 4: Criar a task agendada**

`src/trigger/coleta-diaria.ts`:

```ts
import { batch, logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { gerarEEnviar } from "./gerar-e-enviar.js";
import { alertarOperador } from "../notificacao/alertas.js";

export const coletaDiaria = schedules.task({
  id: "coleta-diaria",
  cron: {
    pattern: "0 6 * * *",
    // Sem timezone explícito o Trigger.dev agenda em UTC, o que dispararia
    // às 3h da manhã no Brasil.
    timezone: "America/Sao_Paulo",
    environments: ["PRODUCTION"],
  },
  machine: "small-1x",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const dataLocal = payload.timestamp.toLocaleDateString("en-CA", {
      timeZone: payload.timezone,
    });
    const janela = { inicio: dataLocal, fim: dataLocal };

    // batch.triggerByTaskAndWait roda em paralelo e espera todos; um filho que
    // falha não derruba o pai, então a planilha sai com o que temos.
    const { runs } = await batch.triggerByTaskAndWait([
      { task: coletorMs, payload: { janela } },
    ]);

    const ufs = ["MS"] as const;
    const falhas: Array<{ uf: string; erro: string }> = [];

    runs.forEach((r, i) => {
      if (r.ok) {
        logger.info(`coletor ${ufs[i]} ok`, { saida: r.output });
      } else {
        const erro = r.error instanceof Error ? r.error.message : String(r.error);
        falhas.push({ uf: ufs[i]!, erro });
        logger.error(`coletor ${ufs[i]} falhou`, { erro });
      }
    });

    await gerarEEnviar.triggerAndWait({
      dataReferencia: dataLocal,
      ufsComFalha: falhas.map((f) => f.uf),
    });

    if (falhas.length > 0) {
      await alertarOperador(
        `Coleta ${dataLocal}: ${falhas.length} de ${ufs.length} coletores falharam`,
        falhas.map((f) => `${f.uf}: ${f.erro}`).join("\n"),
      );
    }

    return { data: dataLocal, falhas };
  },
});
```

- [ ] **Step 5: Rodar localmente e disparar uma execução**

Run: `npx trigger.dev@latest dev`
No dashboard, dispare `coleta-diaria` manualmente.
Expected: a run conclui, o Storage tem o arquivo bruto do MS e a planilha, e o WhatsApp recebe o documento.

- [ ] **Step 6: Conferir os dados no banco**

```sql
select uf, ano, mes, sexo, quantidade, fonte
from public.abate_mensal
where uf = 'MS' and finalidade = 'ABATE'
order by ano desc, mes desc limit 10;
```

Expected: a linha do mês corrente com `fonte = 'gta_agregada'`; os meses históricos permanecem com `fonte = 'manual'`.

- [ ] **Step 7: Commit**

```bash
git add trigger.config.ts src/trigger
git commit -m "feat: orquestração diária com o MS de ponta a ponta"
```

---

## Task 12: Coletor do PA (ADEPARA)

O arquivo é **wide**: `taxonomia` traz só a espécie e as categorias de sexo/idade são 48 colunas. O teste de aceitação é reproduzir exatamente os números que o sócio tem para maio/2026.

**Files:**
- Create: `src/coletores/pa.ts`, `src/trigger/coletor-pa.ts`, `tests/coletores/pa.test.ts`
- Modify: `src/trigger/coleta-diaria.ts`

- [ ] **Step 1: Baixar o fixture do PA e reduzi-lo**

```bash
mkdir -p tests/fixtures
curl -sL -o /tmp/pa-maio-2026-completo.xlsx \
  "https://drive.google.com/uc?export=download&id=1lRjC-QXWZPHCgc9NlWV9SBq4Gn_XKb8I"
ls -la /tmp/pa-maio-2026-completo.xlsx
```

Expected: ~16 MB. Guarde este arquivo completo fora do repositório para o teste de aceitação da Etapa 6; o repositório recebe só a versão reduzida gerada no Step 5.

- [ ] **Step 2: Escrever o teste (falhando)**

`tests/coletores/pa.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { interpretarCategoria, parsearPa } from "../../src/coletores/pa.js";

describe("interpretarCategoria", () => {
  it("separa espécie, sexo e faixa etária do rótulo da coluna", () => {
    expect(interpretarCategoria("BOVINO, FÊMEA, ACIMA DE 36 MESES")).toEqual({
      especie: "BOVINO",
      sexo: "FEMEA",
      faixaEtaria: "ACIMA DE 36 MESES",
    });
    expect(interpretarCategoria("BOVINO, MACHO, 0 A 12 MESES")).toEqual({
      especie: "BOVINO",
      sexo: "MACHO",
      faixaEtaria: "0 A 12 MESES",
    });
  });

  it("devolve null para categorias sem sexo", () => {
    expect(interpretarCategoria("GALINHA, ADULTO")).toBeNull();
    expect(interpretarCategoria("SUÍNO, SEXO E IDADE NÃO RELEVANTES")).toBeNull();
  });

  it("ignora espécies que não são bovino", () => {
    expect(interpretarCategoria("BUBALINO, MACHO, 0 A 12 MESES")).toBeNull();
  });
});

describe("parsearPa", () => {
  const FIXTURE = "tests/fixtures/pa-adepara-maio-2026-reduzido.xlsx";

  it("só considera abate com igualdade exata, nunca prefixo", async () => {
    const registros = await parsearPa(FIXTURE);
    const finalidades = new Set(registros.map((r) => r.finalidade));
    // "ABATE SANITÁRIO" e "SACRIFÍCIO" existem no arquivo e são armazenados,
    // mas jamais devem ser confundidos com "ABATE" pelo filtro.
    expect(finalidades.has("ABATE")).toBe(true);
    const abate = registros.filter((r) => r.finalidade === "ABATE");
    expect(abate.every((r) => r.finalidade === "ABATE")).toBe(true);
  });

  it("preenche os campos da chave natural", async () => {
    const registros = await parsearPa(FIXTURE);
    for (const r of registros.slice(0, 50)) {
      expect(r.uf).toBe("PA");
      expect(r.documentoNumero).not.toBe("");
      expect(r.dataEmissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.quantidade).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/coletores/pa.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 4: Implementar `src/coletores/pa.ts`**

```ts
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistroGta, Sexo } from "../tipos.js";
import { lerLinhas, serialParaDataISO, textoCelula } from "../xlsx/leitor.js";

const PAGINA_ADEPARA = "https://www.adepara.pa.gov.br/node/313";
const PASTA_RAIZ = "1Sb-90n2n_NtTAOC_z60OB1TQG7kZin_l";

export interface ArquivoDrive {
  id: string;
  nome: string;
  modificadoEm: string;
  md5: string | null;
}

/** Lista arquivos de uma pasta pública do Drive via API v3 com API key. */
export async function listarPasta(pastaId: string, apiKey: string): Promise<ArquivoDrive[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${pastaId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,md5Checksum)");
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("key", apiKey);

  const resposta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) throw new Error(`Drive respondeu HTTP ${resposta.status}`);

  const json = (await resposta.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime: string; md5Checksum?: string }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    nome: f.name,
    modificadoEm: f.modifiedTime,
    md5: f.md5Checksum ?? null,
  }));
}

/**
 * Encontra a subpasta do ano. O padrão é "GTAs 2026 dados públicos", mas a
 * ADEPARA já variou a nomenclatura, então o casamento é tolerante.
 */
export async function encontrarPastaDoAno(
  ano: number,
  apiKey: string,
): Promise<string | null> {
  const itens = await listarPasta(PASTA_RAIZ, apiKey);
  const alvo = itens.find((i) => i.nome.includes(String(ano)) && /gta/i.test(i.nome));
  return alvo?.id ?? null;
}

export async function baixarArquivoDrive(id: string): Promise<Buffer> {
  const resposta = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
  });
  if (!resposta.ok) throw new Error(`Download do Drive falhou: HTTP ${resposta.status}`);

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(`Drive devolveu conteúdo que não é XLSX (${buffer.length} bytes)`);
  }
  return buffer;
}

export interface Categoria {
  especie: string;
  sexo: Sexo;
  faixaEtaria: string;
}

/**
 * Interpreta o rótulo de uma coluna de categoria: "ESPÉCIE, SEXO, FAIXA".
 * Devolve null para categorias sem sexo (aves, suínos) e para espécies que
 * não são bovino.
 */
export function interpretarCategoria(rotulo: string): Categoria | null {
  const partes = rotulo.split(",").map((p) => p.trim());
  if (partes.length !== 3) return null;

  const [especie, sexoBruto, faixaEtaria] = partes as [string, string, string];
  if (especie !== "BOVINO") return null;
  if (sexoBruto !== "MACHO" && sexoBruto !== "FÊMEA") return null;

  return { especie, sexo: sexoBruto === "FÊMEA" ? "FEMEA" : "MACHO", faixaEtaria };
}

/**
 * Lê a planilha mensal do PA. O formato é wide: uma linha por GTA, com 48
 * colunas de categoria. A coluna `taxonomia` traz apenas a espécie, então o
 * sexo vem do NOME da coluna, não do conteúdo dela.
 */
export async function parsearPa(caminho: string): Promise<RegistroGta[]> {
  const registros: RegistroGta[] = [];
  let categorias: Array<{ indice: number; categoria: Categoria }> | null = null;

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "finalidade",
  })) {
    if (!categorias) {
      categorias = Object.entries(colunas)
        .map(([rotulo, indice]) => {
          const categoria = interpretarCategoria(rotulo);
          return categoria ? { indice, categoria } : null;
        })
        .filter((c): c is { indice: number; categoria: Categoria } => c !== null);
    }

    const finalidade = textoCelula(valores[colunas["finalidade"]!]);
    const taxonomia = textoCelula(valores[colunas["taxonomia"]!]);
    if (!finalidade || taxonomia !== "BOVINO") continue;

    const bruto = valores[colunas["data_emissao"]!];
    if (typeof bruto !== "number" && !(bruto instanceof Date)) continue;

    const comum = {
      uf: "PA" as const,
      documentoTipo: "GTA",
      documentoNumero: textoCelula(valores[colunas["gta_numero"]!]),
      documentoSerie: "",
      dataEmissao: serialParaDataISO(bruto),
      finalidade,
      municipioOrigem: textoCelula(valores[colunas["origem_cidade_nome"]!]) || null,
      municipioDestino: textoCelula(valores[colunas["destinatario_cidade_nome"]!]) || null,
      ufDestino: null,
    };

    for (const { indice, categoria } of categorias) {
      const quantidade = Number(valores[indice]) || 0;
      if (quantidade <= 0) continue;
      registros.push({
        ...comum,
        sexo: categoria.sexo,
        faixaEtaria: categoria.faixaEtaria,
        quantidade,
      });
    }
  }

  return registros;
}

export interface ArquivoNovo {
  arquivo: ArquivoDrive;
  conteudo: Buffer;
  hash: string;
  registros: RegistroGta[];
}

/** Baixa e parseia apenas os arquivos ainda não processados. */
export async function coletarPa(args: {
  ano: number;
  apiKey: string;
  hashesJaProcessados: Set<string>;
}): Promise<ArquivoNovo[]> {
  const pastaId = await encontrarPastaDoAno(args.ano, args.apiKey);
  if (!pastaId) return [];

  const itens = (await listarPasta(pastaId, args.apiKey)).filter((i) => /\.xlsx$/i.test(i.nome));
  const novos: ArquivoNovo[] = [];

  for (const item of itens) {
    const conteudo = await baixarArquivoDrive(item.id);
    const hash = createHash("sha256").update(conteudo).digest("hex");
    if (args.hashesJaProcessados.has(hash)) continue;

    const temporario = join(tmpdir(), `pa-${hash.slice(0, 12)}.xlsx`);
    await writeFile(temporario, conteudo);
    novos.push({ arquivo: item, conteudo, hash, registros: await parsearPa(temporario) });
  }

  return novos;
}
```

- [ ] **Step 5: Gerar o fixture reduzido**

O arquivo completo tem 60.936 linhas e 16 MB — grande demais para versionar. Este script mantém a estrutura e as primeiras 3.000 linhas:

```bash
node --input-type=module -e '
import ExcelJS from "exceljs";
const origem = new ExcelJS.stream.xlsx.WorkbookReader("/tmp/pa-maio-2026-completo.xlsx", {
  entries: "emit", sharedStrings: "cache", worksheets: "emit", styles: "cache",
});
const destino = new ExcelJS.Workbook();
const saida = destino.addWorksheet("GTAs MAIO 2026");
let n = 0;
for await (const aba of origem) {
  for await (const linha of aba) {
    saida.addRow(linha.values.slice(1));
    if (++n >= 3000) break;
  }
  break;
}
await destino.xlsx.writeFile("tests/fixtures/pa-adepara-maio-2026-reduzido.xlsx");
console.log("linhas gravadas:", n);
'
```

Expected: `linhas gravadas: 3000`

- [ ] **Step 6: Rodar o teste de aceitação contra o arquivo completo**

Este é o teste que prova que a automação reproduz o trabalho manual. Rode uma vez, manualmente:

```bash
node --input-type=module -e '
import { parsearPa } from "./src/coletores/pa.js";
const r = await parsearPa("/tmp/pa-maio-2026-completo.xlsx");
const abate = r.filter(x => x.finalidade === "ABATE");
const f = abate.filter(x => x.sexo === "FEMEA").reduce((s,x) => s+x.quantidade, 0);
const m = abate.filter(x => x.sexo === "MACHO").reduce((s,x) => s+x.quantidade, 0);
console.log("FEMEA:", f, "(esperado 188406)", f === 188406 ? "OK" : "DIVERGE");
console.log("MACHO:", m, "(esperado 152453)", m === 152453 ? "OK" : "DIVERGE");
'
```

Expected: `FEMEA: 188406 OK` e `MACHO: 152453 OK` — os mesmos números da planilha do sócio.

- [ ] **Step 7: Rodar a suíte**

Run: `npx vitest run tests/coletores/pa.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 8: Criar a task e ligá-la ao agendamento**

`src/trigger/coletor-pa.ts`:

```ts
import { logger, task } from "@trigger.dev/sdk";
import { coletarPa } from "../coletores/pa.js";
import { abrirColeta, fecharColeta, hashesProcessados } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";

export const coletorPa = task({
  id: "coletor-pa",
  machine: "medium-1x",
  maxDuration: 900,
  run: async (payload: { ano: number }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY ausente no ambiente");

    const jaProcessados = await hashesProcessados("PA");
    const novos = await coletarPa({ ano: payload.ano, apiKey, hashesJaProcessados: jaProcessados });

    // Nenhum arquivo novo é o caso comum: o PA publica uma vez por mês, com
    // cerca de dois meses de atraso. Não é falha.
    if (novos.length === 0) {
      logger.info("PA sem arquivos novos");
      return { arquivosNovos: 0, registros: 0 };
    }

    let total = 0;
    for (const novo of novos) {
      const datas = novo.registros.map((r) => r.dataEmissao).sort();
      const janela = { inicio: datas[0] ?? `${payload.ano}-01-01`, fim: datas.at(-1) ?? `${payload.ano}-12-31` };
      const coletaId = await abrirColeta({ uf: "PA", tipo: "mensal", janela });

      try {
        await arquivarBruto({ caminho: `pa/${novo.arquivo.nome}`, conteudo: novo.conteudo });
        const gravados = await gravarRegistros(novo.registros, coletaId);
        await rollupJanela({ uf: "PA", janela, coletaId });
        await fecharColeta({
          id: coletaId,
          status: "ok",
          arquivoPath: `pa/${novo.arquivo.nome}`,
          arquivoHash: novo.hash,
          linhasAfetadas: gravados,
        });
        total += gravados;
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
        throw erro;
      }
    }

    return { arquivosNovos: novos.length, registros: total };
  },
});
```

Em `src/trigger/coleta-diaria.ts`, importe `coletorPa` e acrescente ao batch:

```ts
import { coletorPa } from "./coletor-pa.js";
// ...
const { runs } = await batch.triggerByTaskAndWait([
  { task: coletorMs, payload: { janela } },
  { task: coletorPa, payload: { ano: Number(dataLocal.slice(0, 4)) } },
]);
const ufs = ["MS", "PA"] as const;
```

- [ ] **Step 9: Commit**

```bash
git add src/coletores/pa.ts src/trigger/coletor-pa.ts src/trigger/coleta-diaria.ts tests/coletores/pa.test.ts tests/fixtures/pa-adepara-maio-2026-reduzido.xlsx
git commit -m "feat: coletor do PA validado contra os números reais de maio/2026"
```

---

## Task 13: Coletor do MT (INDEA)

**Este é o único ponto do plano que exige um passo manual antes de codificar.** O formulário de export vive atrás do login e não pode ser mapeado de fora.

**Files:**
- Create: `src/coletores/mt.ts`, `src/trigger/coletor-mt.ts`, `tests/coletores/mt.test.ts`
- Modify: `src/trigger/coleta-diaria.ts`

- [ ] **Step 1: Sessão de mapeamento (manual, uma vez)**

Com as credenciais em ambiente, execute e **guarde as saídas**:

```bash
export INDEA_CPF=... INDEA_SENHA=...
cd /tmp && rm -f cookies.txt

curl -s -c cookies.txt -b cookies.txt \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" \
  "https://sistemas.indea.mt.gov.br/FronteiraWeb/" -o login.html

curl -s -c cookies.txt -b cookies.txt -L \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" \
  -X POST --data-urlencode "usuario=$INDEA_CPF" --data-urlencode "senha=$INDEA_SENHA" \
  "https://sistemas.indea.mt.gov.br/FronteiraWeb/Login.action" -o pos-login.html

curl -s -b cookies.txt -L \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" \
  "https://sistemas.indea.mt.gov.br/FronteiraWeb/exportar_gta_condensado_input.action" -o form-export.html

# o que precisamos descobrir:
grep -oE '<form[^>]*>' form-export.html
grep -oE '<input[^>]*>' form-export.html
grep -oE '<select[^>]*name="[^"]*"' form-export.html
```

Anote: o `action` do formulário, o `method`, o nome exato de cada campo de data, o formato esperado (provavelmente `dd/MM/yyyy`), e quaisquer campos ocultos. Faça **um** export manual e guarde o arquivo em `tests/fixtures/mt-indea-<data>.<ext>` — ele vira o fixture do parser.

Se `pos-login.html` ainda contiver o formulário de login, a credencial foi rejeitada: pare e avise o operador antes de continuar.

- [ ] **Step 2: Escrever o teste do parser (falhando)**

Ajuste os nomes de coluna conforme o arquivo real obtido no Step 1. `tests/coletores/mt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsearMt, sessaoExpirada } from "../../src/coletores/mt.js";

describe("sessaoExpirada", () => {
  it("detecta que a resposta é a tela de login", () => {
    expect(sessaoExpirada('<form name="login" action="Login.action">')).toBe(true);
    expect(sessaoExpirada("<table><tr><td>BOVINO</td></tr></table>")).toBe(false);
  });
});

describe("parsearMt", () => {
  const FIXTURE = "tests/fixtures/mt-indea-2026-07-27.xlsx";

  it("extrai apenas bovinos com os campos da chave natural preenchidos", async () => {
    const registros = await parsearMt(FIXTURE);
    expect(registros.length).toBeGreaterThan(0);
    for (const r of registros) {
      expect(r.uf).toBe("MT");
      expect(r.documentoNumero).not.toBe("");
      expect(r.dataEmissao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.quantidade).toBeGreaterThan(0);
      expect(["MACHO", "FEMEA"]).toContain(r.sexo);
    }
  });

  it("preserva os acentos apesar do ISO-8859-1 da fonte", async () => {
    const registros = await parsearMt(FIXTURE);
    const finalidades = new Set(registros.map((r) => r.finalidade));
    // Se a decodificação estiver errada, aparecem caracteres corrompidos
    expect([...finalidades].some((f) => /[A-ZÇÃÕÁÉÍÓÚÂÊÔ ]+/.test(f))).toBe(true);
    expect([...finalidades].every((f) => !f.includes("�"))).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/coletores/mt.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 4: Implementar `src/coletores/mt.ts`**

Preencha `ACTION_EXPORT` e `CAMPO_DATA_INICIAL`/`CAMPO_DATA_FINAL` com o que foi observado no Step 1.

```ts
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Janela, RegistroGta } from "../tipos.js";
import { lerLinhas, serialParaDataISO, textoCelula } from "../xlsx/leitor.js";

const BASE = "https://sistemas.indea.mt.gov.br/FronteiraWeb";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Preenchidos a partir da sessão de mapeamento (Task 13, Step 1).
const ACTION_EXPORT = "/exportar_gta_condensado.action";
const CAMPO_DATA_INICIAL = "dataInicial";
const CAMPO_DATA_FINAL = "dataFinal";

export class CredencialInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CredencialInvalidaError";
  }
}

/** Converte YYYY-MM-DD para o dd/MM/yyyy que o formulário espera. */
export function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Detecta que a resposta voltou sendo a tela de login. */
export function sessaoExpirada(html: string): boolean {
  return /Login\.action/i.test(html) && /name="senha"/i.test(html);
}

function extrairCookies(resposta: Response, jar: Map<string, string>): void {
  for (const linha of resposta.headers.getSetCookie?.() ?? []) {
    const [par] = linha.split(";");
    const [nome, valor] = (par ?? "").split("=");
    if (nome && valor) jar.set(nome.trim(), valor.trim());
  }
}

const serializar = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** Semeia cookies, autentica e devolve o cookie jar da sessão. */
export async function autenticar(cpf: string, senha: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();

  const inicial = await fetch(`${BASE}/`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  extrairCookies(inicial, jar);

  const login = await fetch(`${BASE}/Login.action`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializar(jar),
    },
    body: new URLSearchParams({ usuario: cpf, senha }),
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  extrairCookies(login, jar);

  if (login.status === 401 || login.status === 403) {
    throw new CredencialInvalidaError(`INDEA rejeitou a credencial (HTTP ${login.status})`);
  }
  return jar;
}

/** Baixa o export do GTA Condensado para a janela informada. */
export async function baixarMt(janela: Janela, cpf: string, senha: string): Promise<Buffer> {
  const jar = await autenticar(cpf, senha);

  const parametros = new URLSearchParams({
    [CAMPO_DATA_INICIAL]: formatarDataBr(janela.inicio),
    [CAMPO_DATA_FINAL]: formatarDataBr(janela.fim),
  });

  const resposta = await fetch(`${BASE}${ACTION_EXPORT}`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializar(jar),
    },
    body: parametros,
    signal: AbortSignal.timeout(180_000),
  });

  if (!resposta.ok) throw new Error(`INDEA respondeu HTTP ${resposta.status} no export`);

  const buffer = Buffer.from(await resposta.arrayBuffer());

  // Se voltou HTML, é a tela de login: a sessão caiu. Nunca gravar isso.
  const inicio = buffer.subarray(0, 512).toString("latin1");
  if (sessaoExpirada(inicio) || inicio.trimStart().startsWith("<")) {
    throw new CredencialInvalidaError("INDEA devolveu a tela de login em vez do arquivo");
  }
  return buffer;
}

export async function parsearMt(caminho: string): Promise<RegistroGta[]> {
  const registros: RegistroGta[] = [];

  for await (const { valores, colunas } of lerLinhas(caminho, {
    marcadorCabecalho: "Espécie",
  })) {
    const especie = textoCelula(valores[colunas["Espécie"]!]);
    const finalidade = textoCelula(valores[colunas["Finalidade"]!]);
    if (especie !== "BOVINO" || !finalidade) continue;

    const bruto = valores[colunas["Data Emissão"]!];
    if (typeof bruto !== "number" && !(bruto instanceof Date)) continue;

    const comum = {
      uf: "MT" as const,
      documentoTipo: "GTA",
      documentoNumero: textoCelula(valores[colunas["Número"]!]),
      documentoSerie: textoCelula(valores[colunas["Série"]!] ?? ""),
      dataEmissao: serialParaDataISO(bruto),
      finalidade,
      municipioOrigem: textoCelula(valores[colunas["Município Origem"]!] ?? "") || null,
      municipioDestino: textoCelula(valores[colunas["Município Destino"]!] ?? "") || null,
      ufDestino: null,
    };

    for (const [rotulo, sexo] of [["Fêmea", "FEMEA"], ["Macho", "MACHO"]] as const) {
      const indice = colunas[rotulo];
      if (indice === undefined) continue;
      const quantidade = Number(valores[indice]) || 0;
      if (quantidade <= 0) continue;
      registros.push({ ...comum, sexo, faixaEtaria: null, quantidade });
    }
  }

  return registros;
}

export async function coletarMt(janela: Janela, cpf: string, senha: string) {
  const arquivo = await baixarMt(janela, cpf, senha);
  const hash = createHash("sha256").update(arquivo).digest("hex");
  const nomeArquivo = `mt/${janela.inicio}_a_${janela.fim}.xlsx`;
  const temporario = join(tmpdir(), `mt-${hash.slice(0, 12)}.xlsx`);
  await writeFile(temporario, arquivo);
  return { registros: await parsearMt(temporario), arquivo, hash, nomeArquivo };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run tests/coletores/mt.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 6: Criar a task com limite de concorrência**

`src/trigger/coletor-mt.ts`:

```ts
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { CredencialInvalidaError, coletarMt } from "../coletores/mt.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { arquivarBruto } from "../dados/arquivos.js";
import { gravarRegistros } from "../dados/registros.js";
import { rollupJanela } from "../dados/mensal.js";
import type { Janela, TipoColeta } from "../tipos.js";

export const coletorMt = task({
  id: "coletor-mt",
  // Um login por vez: é portal de governo atrás de WAF.
  queue: { concurrencyLimit: 1 },
  machine: "small-2x",
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 300_000,
    randomize: true,
  },
  run: async (payload: { janela: Janela; tipo?: TipoColeta }) => {
    const cpf = process.env.INDEA_CPF;
    const senha = process.env.INDEA_SENHA;
    // Credencial ausente nunca melhora com retry.
    if (!cpf || !senha) throw new AbortTaskRunError("INDEA_CPF/INDEA_SENHA ausentes");

    const coletaId = await abrirColeta({ uf: "MT", tipo: payload.tipo ?? "diaria", janela: payload.janela });

    try {
      const { registros, arquivo, hash, nomeArquivo } = await coletarMt(payload.janela, cpf, senha);
      await arquivarBruto({ caminho: nomeArquivo, conteudo: arquivo });
      const gravados = await gravarRegistros(registros, coletaId);
      await rollupJanela({ uf: "MT", janela: payload.janela, coletaId });
      await fecharColeta({
        id: coletaId,
        status: registros.length > 0 ? "ok" : "sem_dados",
        arquivoPath: nomeArquivo,
        arquivoHash: hash,
        linhasAfetadas: gravados,
      });
      logger.info("coletor MT concluído", { gravados });
      return { uf: "MT" as const, registros: registros.length, gravados };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      // Credencial rejeitada também não melhora com retry.
      if (erro instanceof CredencialInvalidaError) throw new AbortTaskRunError(mensagem);
      throw erro;
    }
  },
});
```

Adicione ao batch em `src/trigger/coleta-diaria.ts`, junto com `{ task: coletorMt, payload: { janela } }` e `"MT"` em `ufs`.

- [ ] **Step 7: Commit**

```bash
git add src/coletores/mt.ts src/trigger/coletor-mt.ts src/trigger/coleta-diaria.ts tests/coletores/mt.test.ts tests/fixtures/mt-indea-*
git commit -m "feat: coletor do MT com sessão autenticada e erros não-retentáveis"
```

---

## Task 14: Coletor do RO (IDARON)

O dado vem de um Power BI publicado na web. A estratégia usa o browser **só na descoberta** e HTTP puro em produção.

**Files:**
- Create: `src/coletores/ro.ts`, `src/trigger/coletor-ro.ts`, `tests/coletores/ro.test.ts`
- Create: `scripts/descobrir-consulta-ro.ts`
- Modify: `src/trigger/coleta-diaria.ts`

- [ ] **Step 1: Escrever o script de descoberta**

`scripts/descobrir-consulta-ro.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const RELATORIO =
  "https://app.powerbi.com/view?r=eyJrIjoiMzFjN2IwZjYtNWVkZS00MzU4LWJlMzUtYjhmYzQ5YWMwYWIxIiwidCI6IjJhOWFiYjFhLTVmMzYtNDA1Ny1hNzVjLTIwYjQyOTZjNTg0MiJ9";

const navegador = await chromium.launch({ headless: false });
const pagina = await navegador.newPage();
const capturadas: unknown[] = [];

pagina.on("request", (req) => {
  if (req.url().includes("querydata")) {
    capturadas.push({ url: req.url(), headers: req.headers(), body: req.postData() });
  }
});

await pagina.goto(RELATORIO, { waitUntil: "networkidle", timeout: 120_000 });
console.log("Selecione BOVINO, ABATE e o mês/ano desejado. 90s para interagir.");
await pagina.waitForTimeout(90_000);

await writeFile("scripts/ro-consultas-capturadas.json", JSON.stringify(capturadas, null, 2));
console.log(`capturadas: ${capturadas.length}`);
await navegador.close();
```

- [ ] **Step 2: Executar a descoberta**

Run: `npx tsx scripts/descobrir-consulta-ro.ts`
Interaja com os filtros no browser que abrir.
Expected: `scripts/ro-consultas-capturadas.json` com pelo menos uma requisição contendo o corpo `SemanticQuery`.

- [ ] **Step 3: Escrever o teste do parser de resposta (falhando)**

Salve uma resposta real capturada como `tests/fixtures/ro-powerbi-resposta.json`. `tests/coletores/ro.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extrairChaveRecurso, parsearRespostaPowerBi } from "../../src/coletores/ro.js";

describe("extrairChaveRecurso", () => {
  it("decodifica a resource key do parâmetro r=", () => {
    const url =
      "https://app.powerbi.com/view?r=eyJrIjoiMzFjN2IwZjYtNWVkZS00MzU4LWJlMzUtYjhmYzQ5YWMwYWIxIiwidCI6IjJhOWFiYjFhLTVmMzYtNDA1Ny1hNzVjLTIwYjQyOTZjNTg0MiJ9";
    expect(extrairChaveRecurso(url)).toBe("31c7b0f6-5ede-4358-be35-b8fc49ac0ab1");
  });

  it("devolve null quando não há parâmetro r", () => {
    expect(extrairChaveRecurso("https://app.powerbi.com/view")).toBeNull();
  });
});

describe("parsearRespostaPowerBi", () => {
  it("extrai os totais de macho e fêmea da resposta real", async () => {
    const json = JSON.parse(await readFile("tests/fixtures/ro-powerbi-resposta.json", "utf8"));
    const totais = parsearRespostaPowerBi(json);
    expect(totais.femeas).toBeGreaterThan(0);
    expect(totais.machos).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `npx vitest run tests/coletores/ro.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 5: Implementar `src/coletores/ro.ts`**

Ajuste `montarConsulta` colando o corpo capturado no Step 2, trocando os valores de ano e mês por interpolação.

```ts
import type { AgregadoMensal } from "../tipos.js";

const PAGINA_IDARON = "https://www.idaron.ro.gov.br/index.php/relatorios-e-formularios/";
const CLUSTER = "https://wabi-brazil-south-redirect.analysis.windows.net";

/** Decodifica a resource key pública embutida no parâmetro `r=` da URL. */
export function extrairChaveRecurso(url: string): string | null {
  const r = new URL(url).searchParams.get("r");
  if (!r) return null;
  try {
    const json = JSON.parse(Buffer.from(r, "base64").toString("utf8")) as { k?: string };
    return json.k ?? null;
  } catch {
    return null;
  }
}

/**
 * Redescobre o link do relatório na página do IDARON.
 * Se o órgão republicar o relatório a chave muda, e sem esta verificação a
 * coleta pararia silenciosamente.
 */
export async function descobrirRelatorio(): Promise<string | null> {
  const resposta = await fetch(PAGINA_IDARON, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) return null;
  const html = await resposta.text();
  const achado = html.match(/https:\/\/app\.powerbi\.com\/view\?r=[A-Za-z0-9%._-]+/);
  return achado?.[0] ?? null;
}

export interface TotaisRo {
  femeas: number;
  machos: number;
}

/**
 * Extrai os totais do formato DSR do Power BI, que devolve os valores em
 * dicionários com deltas em vez de linhas planas.
 */
export function parsearRespostaPowerBi(json: unknown): TotaisRo {
  const numeros: number[] = [];

  const percorrer = (no: unknown): void => {
    if (Array.isArray(no)) {
      for (const item of no) percorrer(item);
      return;
    }
    if (no && typeof no === "object") {
      const obj = no as Record<string, unknown>;
      // "C" carrega os valores da linha no formato DSR
      if (Array.isArray(obj.C)) {
        for (const v of obj.C) if (typeof v === "number") numeros.push(v);
      }
      for (const valor of Object.values(obj)) percorrer(valor);
    }
  };

  percorrer(json);

  if (numeros.length < 2) {
    throw new Error(`Resposta do Power BI sem os totais esperados (${numeros.length} números)`);
  }
  const [femeas, machos] = numeros.slice(-2) as [number, number];
  return { femeas, machos };
}

/** Corpo SemanticQuery capturado na descoberta, parametrizado por ano e mês. */
function montarConsulta(ano: number, mes: number): unknown {
  // COLE AQUI o objeto capturado em scripts/ro-consultas-capturadas.json,
  // substituindo os literais de ano e mês pelas variáveis.
  return { ano, mes };
}

export async function coletarRo(args: {
  ano: number;
  mes: number;
  chaveRecurso: string;
}): Promise<AgregadoMensal[]> {
  const resposta = await fetch(`${CLUSTER}/public/reports/querydata?synchronous=true`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "x-powerbi-resourcekey": args.chaveRecurso,
    },
    body: JSON.stringify(montarConsulta(args.ano, args.mes)),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resposta.ok) throw new Error(`Power BI respondeu HTTP ${resposta.status}`);

  const { femeas, machos } = parsearRespostaPowerBi(await resposta.json());
  return [
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "FEMEA", quantidade: femeas },
    { uf: "RO", ano: args.ano, mes: args.mes, finalidade: "ABATE", sexo: "MACHO", quantidade: machos },
  ];
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/coletores/ro.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 7: Criar a task**

`src/trigger/coletor-ro.ts`:

```ts
import { logger, task } from "@trigger.dev/sdk";
import { coletarRo, descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { abrirColeta, fecharColeta } from "../dados/coletas.js";
import { gravarAgregados } from "../dados/mensal.js";

const CHAVE_PADRAO = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

export const coletorRo = task({
  id: "coletor-ro",
  machine: "small-2x",
  maxDuration: 300,
  run: async (payload: { ano: number; mes: number }) => {
    const janela = {
      inicio: `${payload.ano}-${String(payload.mes).padStart(2, "0")}-01`,
      fim: `${payload.ano}-${String(payload.mes).padStart(2, "0")}-28`,
    };
    const coletaId = await abrirColeta({ uf: "RO", tipo: "mensal", janela });

    try {
      const url = await descobrirRelatorio();
      const chave = (url && extrairChaveRecurso(url)) ?? CHAVE_PADRAO;
      if (chave !== CHAVE_PADRAO) {
        logger.warn("resource key do IDARON mudou", { chave });
      }

      const agregados = await coletarRo({ ano: payload.ano, mes: payload.mes, chaveRecurso: chave });
      await gravarAgregados(agregados, coletaId);
      await fecharColeta({ id: coletaId, status: "ok", linhasAfetadas: agregados.length });

      return { uf: "RO" as const, agregados: agregados.length };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await fecharColeta({ id: coletaId, status: "falha", erro: mensagem });
      throw erro;
    }
  },
});
```

Em `src/trigger/coleta-diaria.ts`, importe `coletorRo` e deixe o batch com os quatro estados:

```ts
import { coletorRo } from "./coletor-ro.js";
// ...
const ano = Number(dataLocal.slice(0, 4));
const mes = Number(dataLocal.slice(5, 7));

const { runs } = await batch.triggerByTaskAndWait([
  { task: coletorMs, payload: { janela } },
  { task: coletorMt, payload: { janela } },
  { task: coletorRo, payload: { ano, mes } },
  { task: coletorPa, payload: { ano } },
]);

const ufs = ["MS", "MT", "RO", "PA"] as const;
```

- [ ] **Step 8: Commit**

```bash
git add src/coletores/ro.ts src/trigger/coletor-ro.ts scripts/ tests/coletores/ro.test.ts tests/fixtures/ro-powerbi-resposta.json
git commit -m "feat: coletor do RO com descoberta por browser e produção em HTTP puro"
```

---

## Task 15: Rejanela e verificação de fontes

GTAs são lançadas com atraso: o total de ontem muda depois de ontem. Sem a rejanela, o total do mês fica sistematicamente subestimado — provavelmente um erro que a coleta manual já comete.

**Files:**
- Create: `src/trigger/rejanela-semanal.ts`, `src/trigger/verificar-fontes.ts`

- [ ] **Step 1: Criar a rejanela**

`src/trigger/rejanela-semanal.ts`:

```ts
import { logger, schedules } from "@trigger.dev/sdk";
import { coletorMs } from "./coletor-ms.js";
import { coletorMt } from "./coletor-mt.js";
import { alertarOperador } from "../notificacao/alertas.js";

const DIAS_REJANELA = 10;

export const rejanelaSemanal = schedules.task({
  id: "rejanela-semanal",
  cron: { pattern: "0 5 * * 0", timezone: "America/Sao_Paulo", environments: ["PRODUCTION"] },
  machine: "small-1x",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const hoje = payload.timestamp.toLocaleDateString("en-CA", { timeZone: payload.timezone });
    const datas: string[] = [];
    for (let i = 1; i <= DIAS_REJANELA; i++) {
      const d = new Date(`${hoje}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      datas.push(d.toISOString().slice(0, 10));
    }

    const lotes = datas.map((data) => ({
      payload: { janela: { inicio: data, fim: data }, tipo: "rejanela" as const },
    }));

    const ms = await coletorMs.batchTriggerAndWait(lotes);
    const mt = await coletorMt.batchTriggerAndWait(lotes);

    const falhas = [...ms.runs, ...mt.runs].filter((r) => !r.ok).length;
    logger.info("rejanela concluída", { dias: DIAS_REJANELA, falhas });

    if (falhas > 0) {
      await alertarOperador(
        "Rejanela semanal com falhas",
        `${falhas} de ${lotes.length * 2} execuções falharam nos últimos ${DIAS_REJANELA} dias.`,
      );
    }
    return { dias: DIAS_REJANELA, falhas };
  },
});
```

- [ ] **Step 2: Criar a verificação de fontes**

`src/trigger/verificar-fontes.ts`:

```ts
import { logger, schedules } from "@trigger.dev/sdk";
import { descobrirRelatorio, extrairChaveRecurso } from "../coletores/ro.js";
import { encontrarPastaDoAno } from "../coletores/pa.js";
import { alertarOperador } from "../notificacao/alertas.js";

const CHAVE_RO_CONHECIDA = "31c7b0f6-5ede-4358-be35-b8fc49ac0ab1";

/**
 * Os dois portais que dependem de identificadores externos podem mudá-los sem
 * aviso, e a coleta pararia em silêncio. Esta verificação transforma um
 * silêncio em alerta.
 */
export const verificarFontes = schedules.task({
  id: "verificar-fontes",
  cron: { pattern: "0 7 * * 1", timezone: "America/Sao_Paulo", environments: ["PRODUCTION"] },
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async () => {
    const problemas: string[] = [];

    const urlRo = await descobrirRelatorio();
    const chaveRo = urlRo ? extrairChaveRecurso(urlRo) : null;
    if (!chaveRo) problemas.push("IDARON: não encontrei o link do Power BI na página");
    else if (chaveRo !== CHAVE_RO_CONHECIDA) {
      problemas.push(`IDARON: resource key mudou para ${chaveRo} — atualizar CHAVE_PADRAO`);
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      const ano = new Date().getUTCFullYear();
      if (!(await encontrarPastaDoAno(ano, apiKey))) {
        problemas.push(`ADEPARA: não encontrei a pasta de ${ano} no Drive`);
      }
    }

    if (problemas.length > 0) {
      await alertarOperador("Verificação de fontes encontrou problemas", problemas.join("\n"));
    }
    logger.info("verificação de fontes concluída", { problemas: problemas.length });
    return { problemas };
  },
});
```

- [ ] **Step 3: Rodar a suíte completa e o typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em tudo, sem erro de tipo

- [ ] **Step 4: Commit**

```bash
git add src/trigger/rejanela-semanal.ts src/trigger/verificar-fontes.ts
git commit -m "feat: rejanela semanal e verificação de fontes externas"
```

---

## Task 16: Detecção de anomalia e testes de integração

Fecha três exigências do spec que ainda não têm cobertura: alerta de variação anômala, prova de idempotência e prova de que a falha parcial não derruba a entrega.

**Files:**
- Create: `src/planilha/anomalias.ts`, `tests/planilha/anomalias.test.ts`
- Create: `tests/integracao/idempotencia.test.ts`
- Modify: `src/trigger/gerar-e-enviar.ts`

- [ ] **Step 1: Escrever o teste da detecção de anomalia (falhando)**

`tests/planilha/anomalias.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectarAnomalias } from "../../src/planilha/anomalias.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

/** Doze meses estáveis em torno de 100.000, mais o mês que queremos testar. */
function serie(ultimaQuantidade: number): LinhaMensal[] {
  const linhas: LinhaMensal[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    linhas.push({ uf: "MT", ano: 2025, mes, sexo: "FEMEA", quantidade: 100_000 });
  }
  linhas.push({ uf: "MT", ano: 2026, mes: 1, sexo: "FEMEA", quantidade: ultimaQuantidade });
  return linhas;
}

describe("detectarAnomalias", () => {
  it("não acusa nada quando o valor está próximo da média", () => {
    expect(detectarAnomalias(serie(105_000))).toEqual([]);
  });

  it("acusa valor muito acima da média histórica", () => {
    const anomalias = detectarAnomalias(serie(400_000));
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0]!.uf).toBe("MT");
    expect(anomalias[0]!.mensagem).toMatch(/acima/i);
  });

  it("acusa valor muito abaixo da média histórica", () => {
    const anomalias = detectarAnomalias(serie(10_000));
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0]!.mensagem).toMatch(/abaixo/i);
  });

  it("não acusa nada sem histórico suficiente", () => {
    const curta: LinhaMensal[] = [
      { uf: "MT", ano: 2026, mes: 1, sexo: "FEMEA", quantidade: 999_999 },
    ];
    expect(detectarAnomalias(curta)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/planilha/anomalias.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `src/planilha/anomalias.ts`**

```ts
import type { LinhaMensal } from "../dados/mensal.js";
import type { Sexo, UF } from "../tipos.js";

/** Mínimo de meses anteriores para a média ter significado. */
const HISTORICO_MINIMO = 6;
/** Fora desta faixa em relação à média, o valor vira alerta. */
const LIMITE_INFERIOR = 0.4;
const LIMITE_SUPERIOR = 2.5;

export interface Anomalia {
  uf: UF;
  ano: number;
  mes: number;
  sexo: Sexo;
  quantidade: number;
  media: number;
  mensagem: string;
}

/**
 * Compara o mês mais recente de cada série contra a média dos anteriores.
 * Alerta, nunca bloqueia: uma virada real de ciclo também produz variação
 * grande, e travar o envio por isso seria pior que avisar.
 */
export function detectarAnomalias(dados: LinhaMensal[]): Anomalia[] {
  const series = new Map<string, LinhaMensal[]>();
  for (const linha of dados) {
    const chave = `${linha.uf}|${linha.sexo}`;
    const lista = series.get(chave) ?? [];
    lista.push(linha);
    series.set(chave, lista);
  }

  const anomalias: Anomalia[] = [];

  for (const linhas of series.values()) {
    const ordenadas = [...linhas].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
    const atual = ordenadas.at(-1);
    const anteriores = ordenadas.slice(0, -1);
    if (!atual || anteriores.length < HISTORICO_MINIMO) continue;

    const media = anteriores.reduce((s, l) => s + l.quantidade, 0) / anteriores.length;
    if (media === 0) continue;

    const razao = atual.quantidade / media;
    if (razao >= LIMITE_INFERIOR && razao <= LIMITE_SUPERIOR) continue;

    const direcao = razao > LIMITE_SUPERIOR ? "acima" : "abaixo";
    anomalias.push({
      uf: atual.uf,
      ano: atual.ano,
      mes: atual.mes,
      sexo: atual.sexo,
      quantidade: atual.quantidade,
      media,
      mensagem:
        `${atual.uf} ${String(atual.mes).padStart(2, "0")}/${atual.ano} ${atual.sexo}: ` +
        `${atual.quantidade.toLocaleString("pt-BR")} está muito ${direcao} da média ` +
        `dos ${anteriores.length} meses anteriores (${Math.round(media).toLocaleString("pt-BR")}).`,
    });
  }

  return anomalias;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/planilha/anomalias.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Ligar a detecção ao envio**

Em `src/trigger/gerar-e-enviar.ts`, adicione os imports no topo:

```ts
import { detectarAnomalias } from "../planilha/anomalias.js";
import { lerAbateMensal } from "../dados/mensal.js";
```

E, logo depois de `const arquivo = await gerarPlanilha();`, insira:

```ts
    // Alerta, nunca bloqueia: a planilha vai de qualquer forma.
    const anomalias = detectarAnomalias(await lerAbateMensal());
    if (anomalias.length > 0) {
      await alertarOperador(
        `Valores fora do padrão em ${anomalias.length} série(s)`,
        anomalias.map((a) => a.mensagem).join("\n"),
      );
    }
```

- [ ] **Step 6: Escrever o teste de idempotência**

`tests/integracao/idempotencia.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chaveNatural, deduplicar } from "../../src/dados/registros.js";
import { parsearMs } from "../../src/coletores/ms.js";

const FIXTURE = "tests/fixtures/ms-iagro-2026-07-20-a-26.xlsx";

describe("idempotência do parse", () => {
  it("parsear duas vezes produz exatamente o mesmo resultado", async () => {
    const primeira = await parsearMs(FIXTURE);
    const segunda = await parsearMs(FIXTURE);
    expect(segunda).toEqual(primeira);
  });

  it("deduplicar é idempotente: aplicar de novo não muda nada", async () => {
    const registros = await parsearMs(FIXTURE);
    const umaVez = deduplicar(registros);
    const duasVezes = deduplicar(umaVez);
    expect(duasVezes).toEqual(umaVez);
  });

  it("todas as chaves naturais são únicas após deduplicar", async () => {
    const unicos = deduplicar(await parsearMs(FIXTURE));
    const chaves = unicos.map(chaveNatural);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("deduplicar preserva o total de animais", async () => {
    const registros = await parsearMs(FIXTURE);
    const soma = (lista: typeof registros) => lista.reduce((s, r) => s + r.quantidade, 0);
    expect(soma(deduplicar(registros))).toBe(soma(registros));
  });
});
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npx vitest run tests/integracao/idempotencia.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 8: Verificar falha parcial na prática**

O comportamento sob falha parcial depende do Trigger.dev, então a verificação é manual e vale mais que um teste unitário. Com o `npm run dev:trigger` rodando, quebre um coletor de propósito:

```bash
INDEA_SENHA=senha-errada npx trigger.dev@latest dev
```

Dispare `coleta-diaria` no dashboard.

Expected: `coletor-mt` falha e **não retenta** (é `AbortTaskRunError`), os outros três concluem, `gerar-e-enviar` executa mesmo assim, a planilha chega no WhatsApp com os dados dos três estados, e o operador recebe o alerta citando o MT. O fazendeiro não recebe nenhuma mensagem de erro.

- [ ] **Step 9: Commit**

```bash
git add src/planilha/anomalias.ts tests/planilha/anomalias.test.ts tests/integracao src/trigger/gerar-e-enviar.ts
git commit -m "feat: alerta de valores fora do padrão e testes de idempotência"
```

---

## Task 17: Deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Configurar as variáveis de ambiente no Trigger.dev**

No dashboard, em Environment Variables (ambiente PRODUCTION), cadastre todas as chaves de `.env.example` com os valores reais.

- [ ] **Step 2: Fazer o deploy**

Run: `npx trigger.dev@latest deploy --env prod`
Expected: o build conclui e as oito tasks aparecem no dashboard — `coleta-diaria`, `coletor-ms`, `coletor-mt`, `coletor-ro`, `coletor-pa`, `gerar-e-enviar`, `rejanela-semanal` e `verificar-fontes`

- [ ] **Step 3: Disparar uma execução manual e conferir**

No dashboard, dispare `coleta-diaria`.
Expected: os quatro coletores executam, a planilha chega no WhatsApp com duas abas, e o Storage tem os arquivos brutos.

- [ ] **Step 4: Conferir a consistência com o histórico**

```sql
select uf, ano, mes, fonte,
       max(case when sexo = 'FEMEA' then quantidade end) as femeas,
       max(case when sexo = 'MACHO' then quantidade end) as machos
from public.abate_mensal
where finalidade = 'ABATE' and (ano, mes) >= (2026, 5)
group by uf, ano, mes, fonte
order by ano, mes, uf;
```

Expected: os meses coletados automaticamente têm ordem de grandeza compatível com os meses semeados manualmente. Uma diferença grande indica erro de parser, não dado novo — investigue antes de seguir.

- [ ] **Step 5: Escrever o README**

Documente: o que o sistema faz, como rodar os testes, como rodar localmente (`npm run dev:trigger`), como reprocessar um período, e o que fazer quando cada portal falhar.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: instruções de operação e deploy"
```

---

## Notas de operação

**Reprocessar um período.** Todos os arquivos brutos estão no bucket `brutos` com hash. Para corrigir um parser e reprocessar sem tocar nos portais, dispare `coletor-<uf>` com a janela desejada e tipo `rejanela`.

**Quando um portal muda de layout.** A validação de cabeçalho falha alto de propósito: é melhor a coleta parar e alertar do que gravar dado errado silenciosamente. O arquivo bruto do dia da quebra fica arquivado e serve como novo fixture.

**Limites de gentileza.** MT tem `concurrencyLimit: 1` e um login por dia. Os portais são serviços públicos e não devem ser sobrecarregados.

**Limitação conhecida: linhas órfãs.** O upsert atualiza e insere, mas nunca apaga. Se um portal corrigir uma GTA e uma combinação de sexo e faixa deixar de existir, a linha antiga permanece e infla o total daquele mês. É raro e o alerta de anomalia da Task 16 pegaria um caso grande. A correção, se um dia for necessária, é apagar as linhas da janela cujo `coleta_id` seja anterior ao da última coleta bem-sucedida que cobriu a janela inteira — e só nesse caso, senão apagaria dados válidos de uma coleta parcial.

**O que o fazendeiro nunca vê.** Erros técnicos vão só para o operador. Se tudo falhar, ele recebe a planilha com os dados de ontem — nunca uma mensagem de erro.
