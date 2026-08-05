# Peciclo SaaS — Fatia 1 (acesso e painel) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar no ar `peciclo.com.br` com login sem cadastro público, painel do cliente mostrando a leitura do ciclo, e área administrativa para criar, suspender e cancelar clientes.

**Architecture:** Um app Next.js em `web/`, dentro do mesmo repositório, lendo o mesmo Supabase que os robôs alimentam. A raiz (robô de coleta) fica intocada. A lógica pura de leitura do ciclo mora em `src/ciclo/` — no projeto raiz, testada pela suíte que já existe — porque a Fatia 2 (narrativa por WhatsApp) vai precisar dela também. A proteção de acesso vive numa camada de dados server-only, não no proxy.

**Tech Stack:** Next.js 16.3.0 (App Router) · @supabase/ssr 0.12.4 · @supabase/supabase-js 2.112.1 · Recharts 3.10.1 · Vercel Pro · Vitest (já configurado na raiz)

**Spec:** [`docs/superpowers/specs/2026-08-05-saas-fatia1-acesso-e-painel-design.md`](../specs/2026-08-05-saas-fatia1-acesso-e-painel-design.md)
**Pesquisa de apoio:** [`referencias/saas-recon.md`](../../../referencias/saas-recon.md)

---

## Ordem e por quê

As tarefas 1 a 5 constroem uma **fatia vertical**: banco preparado → lógica do ciclo → app de pé → login → uma página protegida mostrando um número real. Ao fim da 5, o produto existe. As 6 a 10 enchem o painel e a administração. A 11 liga o WhatsApp à tabela. A 12 publica.

Isso é deliberado: se a integração Supabase↔Next falhar, descobrimos na tarefa 4, não na 12.

## Estrutura de arquivos

```
src/ciclo/leitura.ts            regras do ciclo (puro) — usado pelo site e, depois, pela narrativa
src/dados/perfis.ts             telefones dos clientes ativos (usado pelo robô)
tests/ciclo/leitura.test.ts
tests/dados/perfis.test.ts
supabase/migrations/20260805120000_perfis_e_permissoes.sql

web/
  package.json  tsconfig.json  next.config.ts  .env.local.example
  proxy.ts                       renova a sessão (NÃO é a proteção)
  src/lib/supabase/client.ts     navegador
  src/lib/supabase/server.ts     componentes de servidor
  src/lib/supabase/proxy.ts      renovação de sessão
  src/lib/admin-db.ts            chave privilegiada — server-only
  src/lib/dal.ts                 obterPerfil / exigirClienteAtivo / exigirAdmin
  src/lib/dados.ts               consultas do painel
  src/app/login/page.tsx         + acoes.ts
  src/app/conta-inativa/page.tsx
  src/app/(painel)/layout.tsx    page.tsx  grafico-femeas.tsx
  src/app/admin/page.tsx         acoes.ts
```

**Fronteiras:** `dal.ts` é a única porta de autorização. `admin-db.ts` é o único lugar com a chave privilegiada. `dados.ts` não sabe quem é o usuário — quem valida é quem chama.

## Pré-requisitos (bloqueiam tarefas específicas)

| Item | Bloqueia | Como obter |
|---|---|---|
| Domínio `peciclo.com.br` registrado | Tarefa 12 | registro.br |
| Conta Vercel plano Pro | Tarefa 12 | vercel.com (Hobby proíbe uso comercial) |
| Cadastro público desligado | Tarefa 4 | Supabase → Authentication → desligar "Allow new users to sign up" |
| `SUPABASE_SECRET_KEY` | Tarefa 9 | Supabase → Settings → API |

---

## Task 1: Banco — perfis e permissões

Sem esta tarefa, toda consulta do site volta **vazia sem erro**. As tabelas têm RLS ligada e `revoke all from authenticated`: o Postgres avalia o privilégio SQL antes da política, então `GRANT` vem primeiro.

**Files:**
- Create: `supabase/migrations/20260805120000_perfis_e_permissoes.sql`

- [ ] **Step 1: Escrever a migration**

```sql
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

-- índice do job de WhatsApp
create index if not exists peciclo_perfis_envio_idx
  on public.peciclo_perfis (status, recebe_whatsapp)
  where telefone_whatsapp is not null;

alter table public.peciclo_perfis enable row level security;

-- SECURITY DEFINER é obrigatório: uma política em peciclo_perfis que
-- consultasse peciclo_perfis entraria em recursão infinita.
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

-- GRANT vem ANTES da política: sem ele o usuário leva "permission denied"
-- e a política nem é avaliada.
grant select on table
  public.peciclo_abate_mensal,
  public.peciclo_abate_sif,
  public.peciclo_precos
  to authenticated;

grant select, update on table public.peciclo_perfis to authenticated;

-- (select auth.uid()) entre parênteses: avaliado uma vez por consulta,
-- não uma vez por linha.
create policy "perfil_proprio_leitura" on public.peciclo_perfis
  for select to authenticated using ((select auth.uid()) = id);

create policy "admin_gerencia_perfis" on public.peciclo_perfis
  for all to authenticated
  using (public.peciclo_e_admin()) with check (public.peciclo_e_admin());

create policy "ativo_le_abate_mensal" on public.peciclo_abate_mensal
  for select to authenticated using (public.peciclo_e_ativo());

create policy "ativo_le_abate_sif" on public.peciclo_abate_sif
  for select to authenticated using (public.peciclo_e_ativo());

create policy "ativo_le_precos" on public.peciclo_precos
  for select to authenticated using (public.peciclo_e_ativo());

-- peciclo_gta_registros (2,3 mi de linhas) e peciclo_coletas ficam SEM grant
-- e SEM política de propósito: detalhe bruto e auditoria não vão ao navegador.
```

- [ ] **Step 2: Validar a migration num Postgres real antes de aplicar**

```bash
cd /private/tmp/claude-501/*/scratchpad 2>/dev/null || cd /tmp
node --input-type=module -e '
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
// PGlite não tem o schema auth; criamos um stub só para a FK e auth.uid()
await db.exec("create schema if not exists auth; create table auth.users (id uuid primary key);");
await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
const sql = readFileSync("/Users/viniciusfontes/Documents/cursor_code/peciclo/supabase/migrations/20260805120000_perfis_e_permissoes.sql","utf8")
  .replace(/grant [\s\S]*?to authenticated;/g, "");  // roles do Supabase não existem no PGlite
await db.exec(sql);
console.log("migration aplica limpo (sem os GRANTs, que exigem as roles do Supabase)");
const t = await db.query("select tablename from pg_tables where schemaname=\x27public\x27 and tablename=\x27peciclo_perfis\x27");
console.log("peciclo_perfis criada:", t.rows.length === 1);
'
```
Expected: `migration aplica limpo` e `peciclo_perfis criada: true`

- [ ] **Step 3: Aplicar no Supabase**

```bash
cd /Users/viniciusfontes/Documents/cursor_code/peciclo
export SUPABASE_ACCESS_TOKEN=<sbp_...>
npx -y supabase@latest db push --include-all
```
Expected: `Applying migration 20260805120000_perfis_e_permissoes.sql...` e `Finished supabase db push.`

- [ ] **Step 4: Conferir que os dados existentes continuam intactos**

No SQL Editor do Supabase:
```sql
select count(*) from public.peciclo_abate_mensal;   -- deve continuar 882+
select count(*) from public.peciclo_gta_registros;  -- deve continuar 2.3M+
select count(*) from public.peciclo_perfis;         -- 0, tabela nova
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805120000_perfis_e_permissoes.sql
git commit -m "feat: tabela de perfis e permissões de leitura para usuários logados"
```

---

## Task 2: Leitura do ciclo (lógica pura)

Mora na raiz porque a Fatia 2 (narrativa no WhatsApp) vai usar a mesma função. Puro, sem banco, testável.

**Files:**
- Create: `src/ciclo/leitura.ts`, `tests/ciclo/leitura.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

`tests/ciclo/leitura.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lerCiclo, serieComposicaoFixa } from "../../src/ciclo/leitura.js";
import type { LinhaMensal } from "../../src/dados/mensal.js";

/** Gera um mês completo do painel (MT, MS, RO) com o pct de fêmeas pedido. */
function mes(ano: number, m: number, pct: number, ufs: Array<"MT" | "MS" | "RO"> = ["MT", "MS", "RO"]): LinhaMensal[] {
  return ufs.flatMap((uf) => [
    { uf, ano, mes: m, sexo: "FEMEA" as const, quantidade: Math.round(100_000 * pct) },
    { uf, ano, mes: m, sexo: "MACHO" as const, quantidade: Math.round(100_000 * (1 - pct)) },
  ]);
}

describe("serieComposicaoFixa", () => {
  it("exclui mês em que falta um estado do painel", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      ...mes(2026, 2, 0.5, ["MT", "MS"]), // sem RO
    ];
    const serie = serieComposicaoFixa(dados);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.mes).toBe(1);
  });

  it("ignora estados fora do painel (o PA não entra no consolidado)", () => {
    const dados = [
      ...mes(2026, 1, 0.5),
      { uf: "PA" as const, ano: 2026, mes: 1, sexo: "FEMEA" as const, quantidade: 999_999 },
    ];
    const serie = serieComposicaoFixa(dados);
    expect(serie[0]!.femeas).toBe(150_000); // 3 estados × 50.000, sem o PA
  });

  it("calcula a participação de fêmeas do mês", () => {
    const serie = serieComposicaoFixa(mes(2026, 1, 0.4));
    expect(serie[0]!.pctFemeas).toBeCloseTo(0.4, 4);
  });
});

describe("lerCiclo", () => {
  /** 24 meses: ano 1 estável em `base`, ano 2 em `atual`. */
  function doisAnos(base: number, atual: number): LinhaMensal[] {
    const dados: LinhaMensal[] = [];
    for (let m = 1; m <= 12; m++) dados.push(...mes(2025, m, base));
    for (let m = 1; m <= 12; m++) dados.push(...mes(2026, m, atual));
    return dados;
  }

  it("classifica como retenção quando a participação de fêmeas cai no ano", () => {
    const leitura = lerCiclo(doisAnos(0.5, 0.44)); // −6 p.p.
    expect(leitura.fase).toBe("retencao");
    expect(leitura.yoyMm3Pp).toBeLessThan(-1);
  });

  it("classifica como liquidação quando sobe no ano", () => {
    expect(lerCiclo(doisAnos(0.44, 0.5)).fase).toBe("liquidacao");
  });

  it("classifica como transição quando a variação é pequena", () => {
    expect(lerCiclo(doisAnos(0.5, 0.495)).fase).toBe("transicao"); // −0,5 p.p.
  });

  it("reprova mês com volume muito abaixo do mesmo mês do ano anterior", () => {
    const dados = doisAnos(0.5, 0.44);
    // dezembro/2026 com 10% do volume: mês corrente parcial
    const parcial = dados.filter((d) => !(d.ano === 2026 && d.mes === 12));
    for (const uf of ["MT", "MS", "RO"] as const) {
      parcial.push(
        { uf, ano: 2026, mes: 12, sexo: "FEMEA", quantidade: 4_400 },
        { uf, ano: 2026, mes: 12, sexo: "MACHO", quantidade: 5_600 },
      );
    }
    const leitura = lerCiclo(parcial);
    expect(leitura.competencia).toEqual({ ano: 2026, mes: 11 }); // usa o último utilizável
  });

  it("conta há quantos meses o movimento se mantém", () => {
    const leitura = lerCiclo(doisAnos(0.5, 0.44));
    expect(leitura.mesesNaDirecao).toBeGreaterThanOrEqual(3);
  });

  it("devolve indefinido quando não há histórico suficiente", () => {
    const leitura = lerCiclo(mes(2026, 1, 0.5));
    expect(leitura.fase).toBe("indefinido");
    expect(leitura.yoyMm3Pp).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/ciclo/leitura.test.ts`
Expected: FAIL — `Failed to load url ../../src/ciclo/leitura.js`

- [ ] **Step 3: Implementar `src/ciclo/leitura.ts`**

```ts
import type { LinhaMensal } from "../dados/mensal.js";
import type { UF } from "../tipos.js";

/**
 * Estados que compõem o consolidado do ciclo. O Pará fica FORA de propósito:
 * a ADEPARA publica com ~2 meses de atraso, e incluí-lo faria a leitura
 * inteira esperar por ele — três meses de defasagem em vez de um.
 * O PA continua aparecendo na tabela e no gráfico por estado.
 */
export const PAINEL_CICLO: UF[] = ["MT", "MS", "RO"];

/** Fora desta faixa (em pontos percentuais no ano), o movimento é direcional. */
const LIMITE_DIRECIONAL_PP = 1;
/** Volume mínimo em relação ao mesmo mês do ano anterior para o mês valer. */
const COMPLETUDE_MINIMA = 0.9;

export interface PontoCiclo {
  ano: number;
  mes: number;
  femeas: number;
  machos: number;
  total: number;
  pctFemeas: number;
}

/**
 * Série de composição fixa: um mês só entra se TODOS os estados do painel
 * tiverem dado. Sem isso, a ausência de um estado vira um degrau que parece
 * mercado — junho/2026 sem o PA cai de ~54% para 49,8% sem nada ter mudado.
 */
export function serieComposicaoFixa(dados: LinhaMensal[], painel: UF[] = PAINEL_CICLO): PontoCiclo[] {
  const porMes = new Map<string, { femeas: number; machos: number; ufs: Set<string> }>();

  for (const linha of dados) {
    if (!painel.includes(linha.uf)) continue;
    const chave = `${linha.ano}-${linha.mes}`;
    const atual = porMes.get(chave) ?? { femeas: 0, machos: 0, ufs: new Set<string>() };
    if (linha.sexo === "FEMEA") atual.femeas += linha.quantidade;
    else atual.machos += linha.quantidade;
    atual.ufs.add(linha.uf);
    porMes.set(chave, atual);
  }

  return [...porMes.entries()]
    .filter(([, v]) => v.ufs.size === painel.length)
    .map(([chave, v]) => {
      const [ano, mes] = chave.split("-").map(Number);
      const total = v.femeas + v.machos;
      return { ano: ano!, mes: mes!, femeas: v.femeas, machos: v.machos, total, pctFemeas: total ? v.femeas / total : 0 };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

export type FaseCiclo = "retencao" | "liquidacao" | "transicao" | "indefinido";

export interface LeituraCiclo {
  fase: FaseCiclo;
  /** Mês de referência: o mais recente que passou no teste de completude. */
  competencia: { ano: number; mes: number } | null;
  pctFemeas: number | null;
  /** Variação anual da média móvel de 3 meses, em pontos percentuais. */
  yoyMm3Pp: number | null;
  /** Há quantos meses seguidos o movimento aponta na mesma direção. */
  mesesNaDirecao: number;
}

/** Média móvel de 3 meses terminando no índice i; null se não houver 3 meses. */
function mediaMovel3(serie: PontoCiclo[], i: number): number | null {
  if (i < 2) return null;
  return (serie[i]!.pctFemeas + serie[i - 1]!.pctFemeas + serie[i - 2]!.pctFemeas) / 3;
}

function indiceDoMesmoMesAnoAnterior(serie: PontoCiclo[], i: number): number {
  const alvo = serie[i]!;
  return serie.findIndex((p) => p.ano === alvo.ano - 1 && p.mes === alvo.mes);
}

/**
 * Lê o ciclo a partir da variação ANUAL da média móvel de 3 meses. Comparar
 * com o mesmo mês do ano anterior neutraliza a sazonalidade (safra, chuvas),
 * e a média de 3 meses tira o ruído de calendário de um mês isolado.
 */
export function lerCiclo(dados: LinhaMensal[], painel: UF[] = PAINEL_CICLO): LeituraCiclo {
  const serie = serieComposicaoFixa(dados, painel);
  const vazio: LeituraCiclo = { fase: "indefinido", competencia: null, pctFemeas: null, yoyMm3Pp: null, mesesNaDirecao: 0 };

  /** Variação anual da mm3 no índice i, ou null se não der para calcular. */
  const yoy = (i: number): number | null => {
    const j = indiceDoMesmoMesAnoAnterior(serie, i);
    if (j < 0) return null;
    const atual = mediaMovel3(serie, i);
    const anterior = mediaMovel3(serie, j);
    if (atual === null || anterior === null) return null;
    // mês corrente parcial reprova aqui
    if (serie[i]!.total < COMPLETUDE_MINIMA * serie[j]!.total) return null;
    return (atual - anterior) * 100;
  };

  // do mais recente para trás, até achar um mês utilizável
  let i = serie.length - 1;
  let variacao: number | null = null;
  while (i >= 0 && (variacao = yoy(i)) === null) i--;
  if (i < 0 || variacao === null) return vazio;

  const fase: FaseCiclo =
    variacao <= -LIMITE_DIRECIONAL_PP ? "retencao"
    : variacao >= LIMITE_DIRECIONAL_PP ? "liquidacao"
    : "transicao";

  // há quantos meses a variação mantém o mesmo sinal
  let meses = 0;
  for (let k = i; k >= 0; k--) {
    const v = yoy(k);
    if (v === null || Math.sign(v) !== Math.sign(variacao)) break;
    meses++;
  }

  return {
    fase,
    competencia: { ano: serie[i]!.ano, mes: serie[i]!.mes },
    pctFemeas: serie[i]!.pctFemeas,
    yoyMm3Pp: Number(variacao.toFixed(2)),
    mesesNaDirecao: meses,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/ciclo/leitura.test.ts && npx tsc --noEmit`
Expected: PASS — 9 testes; typecheck limpo

- [ ] **Step 5: Conferir contra os dados reais**

```bash
cat > /tmp/_ciclo.ts <<'EOF'
import { lerCiclo } from "./src/ciclo/leitura.js";
import { lerAbateMensal } from "./src/dados/mensal.js";
const l = lerCiclo(await lerAbateMensal());
console.log(JSON.stringify(l, null, 1));
EOF
cp /tmp/_ciclo.ts . && set -a && . ./.env && set +a && npx -y tsx _ciclo.ts; rm -f _ciclo.ts
```
Expected: `fase: "retencao"`, competência jun/2026, `yoyMm3Pp` próximo de −4,1 (a pesquisa mediu −4,13)

- [ ] **Step 6: Commit**

```bash
git add src/ciclo tests/ciclo
git commit -m "feat: leitura do ciclo por variação anual da média móvel, com composição fixa"
```

---

## Task 3: Scaffold do app web

**Files:**
- Create: `web/` (projeto Next.js), `web/.env.local`, `web/.gitignore`

- [ ] **Step 1: Criar o projeto**

```bash
cd /Users/viniciusfontes/Documents/cursor_code/peciclo
npx -y create-next-app@16.3.0 web --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --no-turbopack --skip-install
cd web && npm i next@16.3.0 react react-dom @supabase/ssr@0.12.4 @supabase/supabase-js@2.112.1 recharts@3.10.1 server-only
npm i -D typescript @types/node @types/react
```

- [ ] **Step 2: Criar `web/.env.local`**

Pegue os valores em Supabase → Settings → API.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://qafcxvdrrwcmnyedvyts.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

⚠️ `SUPABASE_SECRET_KEY` **nunca** pode ganhar o prefixo `NEXT_PUBLIC_` — isso a enviaria ao navegador.

- [ ] **Step 3: Garantir que o `.env.local` não vai para o git**

```bash
cd /Users/viniciusfontes/Documents/cursor_code/peciclo
grep -q "^web/.env" .gitignore || printf '\n# Segredos do app web\nweb/.env.local\nweb/.env*.local\n' >> .gitignore
git check-ignore web/.env.local && echo "ignorado corretamente"
```
Expected: `ignorado corretamente`

- [ ] **Step 4: Confirmar que o robô da raiz não foi afetado**

```bash
cd /Users/viniciusfontes/Documents/cursor_code/peciclo
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit && echo "raiz intacta"
```
Expected: todos os testes da raiz passando, typecheck limpo

- [ ] **Step 5: Commit**

```bash
git add web .gitignore
git commit -m "feat: scaffold do app web em web/, isolado do robô da raiz"
```

---

## Task 4: Sessão e login

**Files:**
- Create: `web/src/lib/supabase/client.ts`, `server.ts`, `proxy.ts`, `web/proxy.ts`

- [ ] **Step 1: Cliente de navegador** — `web/src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 2: Cliente de servidor** — `web/src/lib/supabase/server.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Chamado de um Server Component; o proxy renova a sessão.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Renovação de sessão** — `web/src/lib/supabase/proxy.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Sem estes cabeçalhos (Cache-Control/no-store), um CDN pode cachear
          // a resposta com Set-Cookie e servir a sessão de um usuário a outro.
          Object.entries(headers ?? {}).forEach(([k, v]) => supabaseResponse.headers.set(k, v as string));
        },
      },
    },
  );

  // Não coloque NADA entre createServerClient e getClaims: a doc do Supabase
  // avisa que isso causa usuários deslogados aleatoriamente.
  const { data } = await supabase.auth.getClaims();
  const usuario = data?.claims;

  const publica = ["/login", "/auth"].some((p) => request.nextUrl.pathname.startsWith(p));
  if (!usuario && !publica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

- [ ] **Step 4: O proxy** — `web/proxy.ts` (raiz do `web/`)

Nome e exports conferidos na doc do Next 16.3: o arquivo é `proxy.ts`, a função é `proxy`, e a config é `config` (não `proxyConfig`).

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 5: Página de login** — `web/src/app/login/page.tsx`

```tsx
import { entrar } from "./acoes";

export default function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-emerald-900">Peciclo</h1>
        <p className="text-sm text-neutral-500">Ciclo pecuário em tempo real</p>
      </div>
      <form action={entrar} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="e-mail"
          className="rounded border border-neutral-300 px-3 py-2" />
        <input name="senha" type="password" required placeholder="senha"
          className="rounded border border-neutral-300 px-3 py-2" />
        <button type="submit" className="rounded bg-emerald-700 px-3 py-2 font-medium text-white">
          Entrar
        </button>
      </form>
      <Erro searchParams={searchParams} />
    </main>
  );
}

async function Erro({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  if (!erro) return null;
  return <p className="text-sm text-red-600">E-mail ou senha inválidos.</p>;
}
```

- [ ] **Step 6: Ação de login** — `web/src/app/login/acoes.ts`

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function entrar(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("senha")),
  });

  // Mensagem genérica de propósito: não revelar quais e-mails existem.
  if (error) redirect("/login?erro=1");
  redirect("/painel");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 7: Subir e conferir o redirecionamento**

```bash
cd web && npm run dev
```
Abra `http://localhost:3000/painel` — deve redirecionar para `/login`.
Expected: a tela de login aparece; `/painel` não é acessível sem sessão.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib web/proxy.ts web/src/app/login
git commit -m "feat: sessão do Supabase e tela de login"
```

---

## Task 5: Camada de autorização e primeira página protegida

Fecha a fatia vertical: login → autorização → um número real na tela.

**Files:**
- Create: `web/src/lib/dal.ts`, `web/src/app/(painel)/layout.tsx`, `web/src/app/(painel)/page.tsx`, `web/src/app/conta-inativa/page.tsx`

- [ ] **Step 1: A camada de autorização** — `web/src/lib/dal.ts`

```ts
import "server-only";
import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Perfil = {
  id: string;
  nome: string;
  papel: "cliente" | "admin";
  status: "ativo" | "suspenso" | "cancelado";
};

/** cache(): uma verificação por requisição, mesmo chamada em vários lugares. */
export const obterPerfil = cache(async (): Promise<Perfil | null> => {
  const supabase = await createClient();

  // getClaims valida a assinatura do JWT. Nunca use getSession no servidor.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const { data: perfil } = await supabase
    .from("peciclo_perfis")
    .select("id, nome, papel, status")
    .eq("id", data.claims.sub as string)
    .maybeSingle();

  return (perfil as Perfil) ?? null;
});

export const exigirClienteAtivo = cache(async (): Promise<Perfil> => {
  const p = await obterPerfil();
  if (!p) redirect("/login");
  if (p.status !== "ativo") redirect("/conta-inativa");
  return p;
});

/**
 * notFound() em vez de forbidden(): forbidden() ainda é experimental no
 * Next 16.3 e a doc não recomenda em produção.
 */
export const exigirAdmin = cache(async (): Promise<Perfil> => {
  const p = await exigirClienteAtivo();
  if (p.papel !== "admin") notFound();
  return p;
});
```

- [ ] **Step 2: Layout do painel** — `web/src/app/(painel)/layout.tsx`

```tsx
import Link from "next/link";
import { exigirClienteAtivo } from "@/lib/dal";
import { sair } from "@/app/login/acoes";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirClienteAtivo();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <Link href="/painel" className="font-semibold text-emerald-900">Peciclo</Link>
        <nav className="flex items-center gap-4 text-sm">
          {perfil.papel === "admin" && (
            <Link href="/admin" className="text-emerald-700">Clientes</Link>
          )}
          <span className="text-neutral-500">{perfil.nome}</span>
          <form action={sair}><button className="text-neutral-500 underline">sair</button></form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Página de conta inativa** — `web/src/app/conta-inativa/page.tsx`

```tsx
export default function ContaInativa() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold text-emerald-900">Acesso indisponível</h1>
      <p className="text-neutral-600">
        Sua conta não está ativa no momento. Fale com quem administra o seu acesso.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Painel provisório** — `web/src/app/(painel)/page.tsx`

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function Painel() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("peciclo_abate_mensal")
    .select("*", { count: "exact", head: true })
    .eq("finalidade", "ABATE");

  return (
    <div>
      <h1 className="text-lg font-semibold">Painel</h1>
      <p className="text-neutral-600">Linhas de abate visíveis: {count ?? 0}</p>
    </div>
  );
}
```

- [ ] **Step 5: Criar o primeiro usuário admin (você)**

```bash
cd /Users/viniciusfontes/Documents/cursor_code/peciclo
cat > /tmp/_criar_admin.ts <<'EOF'
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const email = process.argv[2]!, senha = process.argv[3]!, nome = process.argv[4]!;
const { data, error } = await db.auth.admin.createUser({ email, password: senha, email_confirm: true });
if (error) throw error;
const { error: e2 } = await db.from("peciclo_perfis").insert({ id: data.user!.id, nome, papel: "admin", status: "ativo" });
if (e2) throw e2;
console.log("admin criado:", email, data.user!.id);
EOF
cp /tmp/_criar_admin.ts . && set -a && . ./.env && set +a && npx -y tsx _criar_admin.ts "seu@email.com" "umaSenhaForte" "Vinicius"; rm -f _criar_admin.ts
```
Expected: `admin criado: seu@email.com <uuid>`

- [ ] **Step 6: Testar o fluxo inteiro**

Com `npm run dev` rodando em `web/`, acesse `http://localhost:3000/login`, entre com o e-mail criado.
Expected: cai em `/painel` e vê **"Linhas de abate visíveis: 148"** (ou o número atual). Se aparecer `0`, a Task 1 não foi aplicada.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/dal.ts web/src/app
git commit -m "feat: autorização server-side e primeira página protegida"
```

---

## Task 6: A leitura do ciclo na tela

**Files:**
- Create: `web/src/lib/dados.ts`
- Modify: `web/src/app/(painel)/page.tsx`

- [ ] **Step 1: Consultas do painel** — `web/src/lib/dados.ts`

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { lerCiclo, type LeituraCiclo } from "../../../src/ciclo/leitura";
import type { LinhaMensal } from "../../../src/dados/mensal";

const PAGINA = 1000;

/** Lê tudo em páginas: o Supabase corta em 1000 linhas sem erro. */
async function lerAbateMensal(): Promise<LinhaMensal[]> {
  const supabase = await createClient();
  const tudo: LinhaMensal[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from("peciclo_abate_mensal")
      .select("uf, ano, mes, sexo, quantidade")
      .eq("finalidade", "ABATE")
      .order("ano").order("mes")
      .range(p * PAGINA, (p + 1) * PAGINA - 1);
    if (error) throw new Error(`Falha ao ler abate: ${error.message}`);
    const lote = (data ?? []) as LinhaMensal[];
    tudo.push(...lote);
    if (lote.length < PAGINA) return tudo;
  }
}

export interface DadosPainel {
  leitura: LeituraCiclo;
  serie: LinhaMensal[];
  precoBoi: { valor: number; data: string } | null;
  precoBezerro: { valor: number; data: string } | null;
}

export async function obterDadosPainel(): Promise<DadosPainel> {
  const supabase = await createClient();
  const serie = await lerAbateMensal();

  const ultimo = async (nome: string) => {
    const { data } = await supabase
      .from("peciclo_precos")
      .select("valor, data")
      .eq("serie", nome)
      .order("data", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? { valor: Number(data.valor), data: data.data as string } : null;
  };

  return {
    leitura: lerCiclo(serie),
    serie,
    precoBoi: await ultimo("boi_gordo"),
    precoBezerro: await ultimo("bezerro_ms"),
  };
}
```

- [ ] **Step 2: Permitir importar da raiz** — `web/tsconfig.json`

Adicione `"../src/**/*.ts"` ao `include` para o TypeScript enxergar a lógica compartilhada:

```json
{
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "../src/**/*.ts"]
}
```

- [ ] **Step 3: A leitura na tela** — `web/src/app/(painel)/page.tsx`

```tsx
import { obterDadosPainel } from "@/lib/dados";
import { PAINEL_CICLO } from "../../../../src/ciclo/leitura";

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

const TEXTO_FASE: Record<string, string> = {
  retencao: "Retenção de matrizes",
  liquidacao: "Liquidação de matrizes",
  transicao: "Transição",
  indefinido: "Dados insuficientes",
};

export default async function Painel() {
  const { leitura, precoBoi, precoBezerro } = await obterDadosPainel();
  const troca = precoBoi && precoBezerro ? precoBezerro.valor / precoBoi.valor : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Ciclo</p>
        <h2 className="mt-1 text-2xl font-semibold">{TEXTO_FASE[leitura.fase]}</h2>
        {leitura.yoyMm3Pp !== null && (
          <p className="mt-1 text-neutral-600">
            {leitura.yoyMm3Pp > 0 ? "+" : ""}{leitura.yoyMm3Pp.toFixed(1)} p.p. na participação de fêmeas
            contra o ano anterior{leitura.mesesNaDirecao > 1 && `, ${leitura.mesesNaDirecao}º mês seguido`}.
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          {leitura.competencia
            ? `Abate até ${MESES[leitura.competencia.mes - 1]} de ${leitura.competencia.ano} · ${PAINEL_CICLO.join(", ")}`
            : "Sem mês completo o suficiente para leitura"}
        </p>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Mercado</p>
        <div className="mt-2 flex flex-wrap gap-6">
          <Numero rotulo="Boi gordo" valor={precoBoi ? `R$ ${precoBoi.valor.toFixed(2)}/@` : "—"} />
          <Numero rotulo="Bezerro" valor={precoBezerro ? `R$ ${precoBezerro.valor.toLocaleString("pt-BR")}` : "—"} />
          <Numero rotulo="Relação de troca" valor={troca ? `${troca.toFixed(2)} @` : "—"} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {precoBoi ? `Preços de ${precoBoi.data.split("-").reverse().join("/")} · Fonte: CEPEA-ESALQ/USP` : "Sem preço disponível"}
        </p>
      </section>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{rotulo}</p>
      <p className="text-xl font-semibold">{valor}</p>
    </div>
  );
}
```

- [ ] **Step 4: Conferir na tela**

Recarregue `http://localhost:3000/painel`.
Expected: "Retenção de matrizes", "−4.1 p.p. …", "Abate até junho de 2026 · MT, MS, RO", e os três números de mercado preenchidos.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/dados.ts web/src/app/\(painel\)/page.tsx web/tsconfig.json
git commit -m "feat: leitura do ciclo e bloco de mercado no painel"
```

---

## Task 7: Gráfico da participação de fêmeas

**Files:**
- Create: `web/src/app/(painel)/grafico-femeas.tsx`
- Modify: `web/src/app/(painel)/page.tsx`

- [ ] **Step 1: O gráfico** — `web/src/app/(painel)/grafico-femeas.tsx`

```tsx
"use client";

import dynamic from "next/dynamic";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";

// Recharts pesa ~112 KB gzip. Carregado sob demanda para não entrar no
// bundle do login, que nenhum usuário deslogado precisa baixar.
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false, loading: () => <div className="h-[320px] animate-pulse rounded bg-neutral-100" /> },
);

export interface PontoGrafico {
  competencia: string;
  pct: number;
}

export default function GraficoFemeas({ serie, media }: { serie: PontoGrafico[]; media: number }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="competencia" tick={{ fontSize: 12 }} />
        <YAxis unit="%" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "fêmeas"]} />
        <ReferenceLine y={media} stroke="#a3a3a3" strokeDasharray="4 4"
          label={{ value: "média", position: "right", fontSize: 11 }} />
        <Line type="monotone" dataKey="pct" stroke="#047857" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Alimentar o gráfico** — em `web/src/app/(painel)/page.tsx`

Acrescente aos imports do topo:
```tsx
import GraficoFemeas from "./grafico-femeas";
import { PAINEL_CICLO, serieComposicaoFixa } from "../../../../src/ciclo/leitura";
```

Troque a primeira linha do corpo do componente. Era:
```tsx
  const { leitura, precoBoi, precoBezerro } = await obterDadosPainel();
```
Passa a ser — uma chamada só, reaproveitando `dados.serie` para o gráfico:
```tsx
  const dados = await obterDadosPainel();
  const { leitura, precoBoi, precoBezerro } = dados;

  const pontos = serieComposicaoFixa(dados.serie).map((p) => ({
    competencia: `${String(p.mes).padStart(2, "0")}/${String(p.ano).slice(2)}`,
    pct: Number((p.pctFemeas * 100).toFixed(2)),
  }));
  const media = pontos.length ? pontos.reduce((s, p) => s + p.pct, 0) / pontos.length : 0;
```

E acrescente esta seção depois do bloco "Mercado":
```tsx
      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 text-sm font-medium">Participação de fêmeas no abate</h3>
        <GraficoFemeas serie={pontos} media={media} />
      </section>
```

- [ ] **Step 3: Conferir**

Recarregue `/painel`.
Expected: gráfico com a curva descendente nos últimos meses e a linha tracejada da média.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(painel\)
git commit -m "feat: gráfico da participação de fêmeas com média de referência"
```

---

## Task 8: Tabela mensal e download das planilhas

**Files:**
- Create: `web/src/lib/admin-db.ts`, `web/src/app/(painel)/tabela.tsx`, `web/src/app/(painel)/planilhas/page.tsx`

- [ ] **Step 1: A tabela** — `web/src/app/(painel)/tabela.tsx`

```tsx
import type { LinhaMensal } from "../../../../src/dados/mensal";

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const UFS = ["MT", "MS", "RO", "PA"] as const;

export default function TabelaMensal({ serie }: { serie: LinhaMensal[] }) {
  const indice = new Map(serie.map((l) => [`${l.uf}-${l.ano}-${l.mes}-${l.sexo}`, l.quantidade]));
  const meses = [...new Set(serie.map((l) => `${l.ano}-${l.mes}`))]
    .map((c) => c.split("-").map(Number) as [number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-neutral-500">
            <th className="py-2 pr-4">Mês</th>
            {UFS.map((uf) => <th key={uf} className="py-2 pr-4 text-right">{uf} ♀ / ♂</th>)}
          </tr>
        </thead>
        <tbody>
          {meses.map(([ano, mes]) => (
            <tr key={`${ano}-${mes}`} className="border-b last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">{MESES[mes - 1]}/{String(ano).slice(2)}</td>
              {UFS.map((uf) => {
                const f = indice.get(`${uf}-${ano}-${mes}-FEMEA`);
                const m = indice.get(`${uf}-${ano}-${mes}-MACHO`);
                return (
                  <td key={uf} className="py-2 pr-4 text-right tabular-nums">
                    {f ? f.toLocaleString("pt-BR") : "—"} / {m ? m.toLocaleString("pt-BR") : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Ligar no painel** — em `web/src/app/(painel)/page.tsx`

Import:
```tsx
import TabelaMensal from "./tabela";
```

Nova seção ao final:
```tsx
      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 text-sm font-medium">Abate mensal por estado</h3>
        <TabelaMensal serie={dados.serie} />
      </section>
```

- [ ] **Step 3: Cliente privilegiado** — `web/src/lib/admin-db.ts`

Necessário aqui porque listar o Storage e assinar URLs exige a chave privilegiada. A Task 9 reutiliza este mesmo módulo.

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Chave privilegiada: ignora RLS, lista o Storage e cria usuários. Este módulo
 * é server-only e NUNCA pode ser importado por um Client Component — se for,
 * o build quebra de propósito.
 */
export function criarClienteAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Página de planilhas** — `web/src/app/(painel)/planilhas/page.tsx`

As planilhas já são arquivadas no bucket `peciclo_brutos` a cada envio. O link é assinado e expira em 5 minutos, então não vaza.

```tsx
import { exigirClienteAtivo } from "@/lib/dal";
import { criarClienteAdmin } from "@/lib/admin-db";

export default async function Planilhas() {
  await exigirClienteAtivo();
  const admin = criarClienteAdmin();

  const { data } = await admin.storage.from("peciclo_brutos").list("planilhas", {
    limit: 30,
    sortBy: { column: "name", order: "desc" },
  });

  const arquivos = data ?? [];
  const links = await Promise.all(
    arquivos.map(async (a) => {
      const { data: url } = await admin.storage
        .from("peciclo_brutos")
        .createSignedUrl(`planilhas/${a.name}`, 300);
      return { nome: a.name, url: url?.signedUrl ?? null };
    }),
  );

  return (
    <div className="rounded-lg border bg-white p-5">
      <h1 className="mb-3 text-sm font-medium">Planilhas enviadas</h1>
      <ul className="flex flex-col gap-2 text-sm">
        {links.map((l) => (
          <li key={l.nome}>
            {l.url ? <a className="text-emerald-700 underline" href={l.url}>{l.nome}</a> : l.nome}
          </li>
        ))}
        {links.length === 0 && <li className="text-neutral-500">Nenhuma planilha arquivada ainda.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Link no menu** — em `web/src/app/(painel)/layout.tsx`, antes do nome do usuário:

```tsx
          <Link href="/painel/planilhas" className="text-emerald-700">Planilhas</Link>
```

- [ ] **Step 6: Conferir e commitar**

Recarregue `/painel` e `/painel/planilhas`.
Expected: tabela preenchida; lista de planilhas com links que abrem o arquivo.

```bash
git add web/src/lib/admin-db.ts web/src/app/\(painel\)
git commit -m "feat: tabela mensal e download das planilhas arquivadas"
```

---

## Task 9: Administração — listar e criar clientes

**Files:**
- Create: `web/src/app/admin/page.tsx`, `web/src/app/admin/acoes.ts`
- Usa: `web/src/lib/admin-db.ts` (criado na Task 8)

- [ ] **Step 1: Ações administrativas** — `web/src/app/admin/acoes.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/dal";
import { criarClienteAdmin } from "@/lib/admin-db";

/** ~100 anos: o formato é o de duração do Go, e 'none' levanta o bloqueio. */
const BLOQUEIO_LONGO = "876000h";

export async function criarCliente(formData: FormData) {
  await exigirAdmin(); // primeira linha, sempre: o layout NÃO protege uma action

  const email = String(formData.get("email")).trim();
  const senha = String(formData.get("senha"));
  const nome = String(formData.get("nome")).trim();
  const telefone = String(formData.get("telefone")).replace(/\D/g, "");

  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // criado pelo dono: não faz sentido pedir confirmação
  });
  if (error) throw new Error(`Falha ao criar usuário: ${error.message}`);

  const { error: erroPerfil } = await admin.from("peciclo_perfis").insert({
    id: data.user!.id,
    nome,
    telefone_whatsapp: telefone || null,
    papel: "cliente",
    status: "ativo",
  });
  if (erroPerfil) {
    // não deixa usuário órfão no Auth sem perfil
    await admin.auth.admin.deleteUser(data.user!.id);
    throw new Error(`Falha ao criar perfil: ${erroPerfil.message}`);
  }

  revalidatePath("/admin");
}

async function mudarStatus(id: string, status: "ativo" | "suspenso" | "cancelado") {
  await exigirAdmin();
  const admin = criarClienteAdmin();

  // Duas camadas. O bloqueio no Auth impede entrar e renovar; o status corta
  // o acesso ao dado AGORA. Só o bloqueio deixaria a sessão aberta valer
  // até o token expirar (até 1h).
  const { error: erroBan } = await admin.auth.admin.updateUserById(id, {
    ban_duration: status === "ativo" ? "none" : BLOQUEIO_LONGO,
  });
  if (erroBan) throw new Error(`Falha no bloqueio: ${erroBan.message}`);

  const { error } = await admin
    .from("peciclo_perfis")
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Falha ao mudar status: ${error.message}`);

  revalidatePath("/admin");
}

export async function suspender(id: string) { await mudarStatus(id, "suspenso"); }
export async function reativar(id: string)  { await mudarStatus(id, "ativo"); }
export async function cancelar(id: string)  { await mudarStatus(id, "cancelado"); }

export async function editarTelefone(formData: FormData) {
  await exigirAdmin();
  const id = String(formData.get("id"));
  const telefone = String(formData.get("telefone")).replace(/\D/g, "");
  const admin = criarClienteAdmin();
  const { error } = await admin
    .from("peciclo_perfis")
    .update({ telefone_whatsapp: telefone || null, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Falha ao editar telefone: ${error.message}`);
  revalidatePath("/admin");
}

export async function trocarSenha(formData: FormData) {
  await exigirAdmin();
  const id = String(formData.get("id"));
  const senha = String(formData.get("senha"));
  const admin = criarClienteAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) throw new Error(`Falha ao trocar senha: ${error.message}`);
  revalidatePath("/admin");
}
```

- [ ] **Step 2: A tela** — `web/src/app/admin/page.tsx`

```tsx
import { exigirAdmin } from "@/lib/dal";
import { criarClienteAdmin } from "@/lib/admin-db";
import { cancelar, criarCliente, editarTelefone, reativar, suspender, trocarSenha } from "./acoes";

const CORES: Record<string, string> = {
  ativo: "text-emerald-700",
  suspenso: "text-amber-700",
  cancelado: "text-neutral-400",
};

export default async function Admin() {
  await exigirAdmin();
  const admin = criarClienteAdmin();
  const { data: perfis } = await admin
    .from("peciclo_perfis")
    .select("id, nome, telefone_whatsapp, papel, status")
    .order("criado_em");

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-medium">Novo cliente</h2>
        <form action={criarCliente} className="flex flex-wrap gap-2">
          <input name="nome" required placeholder="nome" className="rounded border px-2 py-1 text-sm" />
          <input name="email" type="email" required placeholder="e-mail" className="rounded border px-2 py-1 text-sm" />
          <input name="senha" required minLength={8} placeholder="senha inicial" className="rounded border px-2 py-1 text-sm" />
          <input name="telefone" placeholder="5565999999999" className="rounded border px-2 py-1 text-sm" />
          <button className="rounded bg-emerald-700 px-3 py-1 text-sm text-white">Criar</button>
        </form>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-medium">Clientes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-neutral-500">
              <th className="py-2">Nome</th><th>Telefone</th><th>Status</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {(perfis ?? []).map((p) => (
              <tr key={p.id} className="border-b last:border-0 align-top">
                <td className="py-2">{p.nome}{p.papel === "admin" && " (admin)"}</td>
                <td>
                  <form action={editarTelefone} className="flex gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <input name="telefone" defaultValue={p.telefone_whatsapp ?? ""}
                      className="w-36 rounded border px-1 text-sm" />
                    <button className="text-xs text-emerald-700 underline">salvar</button>
                  </form>
                </td>
                <td className={CORES[p.status]}>{p.status}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  {p.status === "ativo"
                    ? <Botao acao={suspender} id={p.id} rotulo="suspender" />
                    : <Botao acao={reativar} id={p.id} rotulo="reativar" />}
                  {p.status !== "cancelado" && <Botao acao={cancelar} id={p.id} rotulo="cancelar" />}
                  <form action={trocarSenha} className="flex gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <input name="senha" placeholder="nova senha" minLength={8}
                      className="w-28 rounded border px-1 text-sm" />
                    <button className="text-xs text-emerald-700 underline">trocar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Botao({ acao, id, rotulo }: { acao: (id: string) => Promise<void>; id: string; rotulo: string }) {
  const comId = acao.bind(null, id);
  return <form action={comId}><button className="text-xs text-emerald-700 underline">{rotulo}</button></form>;
}
```

- [ ] **Step 3: Testar o ciclo completo de um cliente**

1. Em `/admin`, crie um cliente de teste com o seu segundo e-mail
2. Numa janela anônima, entre com ele → deve ver o painel
3. Em `/admin`, suspenda esse cliente
4. Na janela anônima, recarregue → deve cair em `/conta-inativa` **imediatamente**
5. Reative → recarregue → volta a ver o painel

Expected: a suspensão vale na hora, não depois de 1 hora.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin
git commit -m "feat: administração de clientes com suspensão em duas camadas"
```

---

## Task 10: Impedir que cliente comum alcance a administração

**Files:**
- Create: `web/src/app/admin/layout.tsx`

- [ ] **Step 1: Layout do admin** — `web/src/app/admin/layout.tsx`

```tsx
import { exigirAdmin } from "@/lib/dal";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await exigirAdmin();
  return <>{children}</>;
}
```

- [ ] **Step 2: Verificar na prática**

Com o cliente de teste (não admin) logado, acesse `/admin`.
Expected: página 404. E, como cada ação já chama `exigirAdmin()` na primeira linha, um POST direto na action também é recusado — o layout sozinho não protegeria, porque uma Server Action é uma requisição à própria rota.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/layout.tsx
git commit -m "feat: bloqueia acesso de cliente comum à administração"
```

---

## Task 11: WhatsApp lendo os telefones da tabela

**Files:**
- Create: `src/dados/perfis.ts`, `tests/dados/perfis.test.ts`
- Modify: `src/trigger/gerar-e-enviar.ts`

- [ ] **Step 1: Escrever o teste (falhando)** — `tests/dados/perfis.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { unirDestinatarios } from "../../src/dados/perfis.js";

describe("unirDestinatarios", () => {
  it("junta os telefones do banco com os da configuração, sem repetir", () => {
    expect(unirDestinatarios(["5565992249488"], ["5565996210067", "5565992249488"]))
      .toEqual(["5565992249488", "5565996210067"]);
  });

  it("mantém os da configuração quando o banco está vazio", () => {
    // Rede de segurança: se a tabela estiver vazia ou a query falhar, o envio
    // NÃO pode terminar em zero destinatários — silêncio é a pior falha aqui.
    expect(unirDestinatarios(["5565992249488"], [])).toEqual(["5565992249488"]);
  });

  it("normaliza máscara e descarta número inválido sem derrubar o resto", () => {
    expect(unirDestinatarios(["+55 (65) 99224-9488"], ["123", "5565996210067"]))
      .toEqual(["5565992249488", "5565996210067"]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/dados/perfis.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar** — `src/dados/perfis.ts`

```ts
import { obterCliente } from "./cliente.js";
import { normalizarNumero } from "../notificacao/evolution.js";

/**
 * Une os destinatários da configuração com os do banco, normalizando e
 * descartando os inválidos. A configuração permanece como rede de segurança:
 * se a lista viesse só do banco e a tabela estivesse vazia, o job rodaria com
 * sucesso, reportaria "0 enviados" e ninguém receberia nada — nem o dono.
 */
export function unirDestinatarios(daConfiguracao: string[], doBanco: string[]): string[] {
  const validos = [...daConfiguracao, ...doBanco]
    .map((n) => {
      try {
        return normalizarNumero(n);
      } catch {
        return null; // número torto não derruba o lote
      }
    })
    .filter((n): n is string => n !== null);
  return [...new Set(validos)];
}

/**
 * Telefones dos clientes ativos que optaram por receber.
 * Usa a service_role, que ignora RLS — não depende de policy nenhuma.
 * Nunca lança: qualquer falha devolve lista vazia e o job segue.
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
    return (data ?? []).map((l) => String(l.telefone_whatsapp));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/dados/perfis.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 5: Ligar no job** — `src/trigger/gerar-e-enviar.ts`

Adicione o import junto dos outros:
```ts
import { listarTelefonesAtivos, unirDestinatarios } from "../dados/perfis.js";
```

Troque a linha `for (const numero of cfg.whatsappDestinatarios) {` por:
```ts
      const doBanco = await listarTelefonesAtivos();
      const destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, doBanco);
      logger.info("destinatários resolvidos", {
        configuracao: cfg.whatsappDestinatarios.length,
        banco: doBanco.length,
        total: destinatarios.length,
      });

      for (const numero of destinatarios) {
```

O resto do laço (o try/catch por destinatário) fica idêntico.

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: todos os testes passando, typecheck limpo

- [ ] **Step 7: Verificar na nuvem**

```bash
set -a && . ./.env && set +a && npx -y trigger.dev@4.5.9 deploy
```
Depois dispare `gerar-e-enviar` pelo painel do Trigger e confira no log a linha `destinatários resolvidos` com `banco: N`.

- [ ] **Step 8: Commit**

```bash
git add src/dados/perfis.ts tests/dados/perfis.test.ts src/trigger/gerar-e-enviar.ts
git commit -m "feat: envio lê telefones dos clientes ativos, mantendo a configuração como fallback"
```

---

## Task 12: Publicar

**Files:**
- Create: `web/vercel.json`

- [ ] **Step 1: Descobrir a região do banco**

No painel do Supabase → Settings → General, veja a região do projeto. A regra é colocar a função **na mesma região do banco** (o CDN já serve o estático perto do usuário).

- [ ] **Step 2: Fixar a região** — `web/vercel.json`

Se o Supabase estiver em `us-east-1`, use `iad1`; se estiver em `sa-east-1`, use `gru1`.

```json
{
  "regions": ["iad1"]
}
```

- [ ] **Step 3: Criar o projeto na Vercel**

1. vercel.com → Add New → Project → importar `ovinifontes/peciclo`
2. **Root Directory: `web`** (crítico — senão ela tenta buildar o robô)
3. Framework: Next.js (detecta sozinho)
4. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
5. Deploy

Expected: build conclui e a URL `*.vercel.app` abre a tela de login.

- [ ] **Step 4: Evitar build desnecessário do site quando só o robô mudar**

Em Settings → Git → Ignored Build Step:
```bash
git diff --quiet HEAD^ HEAD -- web/ || exit 1; exit 0
```

- [ ] **Step 5: Apontar o domínio**

1. Vercel → Settings → Domains → adicionar `peciclo.com.br` e `www.peciclo.com.br`
2. **Anote os valores exatos do card** — não copie IP de tutorial; projetos novos recebem IP de pool
3. registro.br → o domínio → DNS → Editar Zona → Modo Avançado
4. Criar: `@` tipo **A** com o IP do card; `www` tipo **CNAME** com o alvo do card (com ponto final)
5. Aguardar o status virar "Valid Configuration"

⚠️ No registro.br, entrada salva **não é editável** — errou, apaga e refaz. E não crie AAAA: a Vercel não suporta IPv6.

- [ ] **Step 6: Verificação final em produção**

1. `https://peciclo.com.br` → tela de login com HTTPS válido
2. Entrar com o admin → painel com a leitura do ciclo e os números
3. `/admin` acessível; com o cliente de teste, `/admin` dá 404
4. Suspender o cliente de teste e confirmar o bloqueio imediato

- [ ] **Step 7: Commit**

```bash
git add web/vercel.json
git commit -m "chore: fixa a região da Vercel na mesma do banco"
```

---

## Notas de operação

**Criar o primeiro admin** só pode ser feito pelo script da Task 5 (não há cadastro público). Admins seguintes: crie como cliente pela tela e mude `papel` para `admin` no SQL Editor.

**Se o painel vier vazio** — gráfico em branco, tabela sem linhas, sem erro: é a Task 1 não aplicada. O Postgres devolve zero linhas em vez de erro quando falta permissão.

**Chave privilegiada** só em `web/src/lib/admin-db.ts`. Se algum dia um Client Component importar esse módulo, o build falha por causa do `server-only` — é proposital.

**Cancelar não apaga.** O usuário continua no Auth e no banco, bloqueado. Apagar de verdade libera o e-mail para recriação e perde o histórico.
