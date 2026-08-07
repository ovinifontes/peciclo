# IA: cenário diário e chat — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** texto diário escrito por IA (validado número a número, com reserva determinística) no painel e no WhatsApp; chat sobre os dados em `/painel/chat`.

**Architecture:** módulos puros em `src/ia/` compartilhados raiz↔web (mesma regra da Fatia 1: nada com dependência externa); rotina isolada no Trigger; rota de streaming no Next.

**Tech Stack:** TypeScript, Trigger.dev 4.5.9, Supabase, Next 16, API Anthropic via `fetch` (sem SDK).

**Spec:** `docs/superpowers/specs/2026-08-06-ia-cenario-e-chat-design.md`

**Regras herdadas da Fatia 1 (valem para todas as tasks):**
- O site só pode alcançar arquivos da raiz SEM dependência externa. Conferir com `cd web && npx tsc --noEmit --listFiles | grep peciclo/src/`.
- Caminhos reais: painel em `web/src/app/(painel)/painel/`, proxy em `web/src/proxy.ts`.
- Toda leitura de tabela usa `lerTudo` (limite silencioso de 1000).
- Portões antes de cada commit: raiz `npx tsc --noEmit` + `npx vitest run`; web `npx next typegen && npx tsc --noEmit && npx next build && npx eslint .`.
- Números em pt-BR na tela (`Intl.NumberFormat("pt-BR")`).

---

## Task 1: Migração — cenários e mensagens do chat

**Files:** Create `supabase/migrations/20260806150000_cenarios_e_chat.sql`

Executor: o orquestrador (banco de produção). Validar em PGlite antes (harness de `tests/` já cria os role-stubs), aplicar com `npx supabase db push --include-all`, conferir contagens das tabelas existentes depois.

- [ ] **Step 1: escrever a migração**

```sql
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
```

- [ ] **Step 2:** validar em PGlite (mesmo harness da migração de perfis)
- [ ] **Step 3:** `npx supabase db push --include-all`; conferir que `peciclo_perfis` continua com 1 linha e as tabelas de dados intactas
- [ ] **Step 4:** commit `feat: tabelas do cenário diário e do chat`

---

## Task 2: O dossiê e a validação numérica (puros, TDD)

**Files:** Create `src/ia/dossie.ts`, `src/ia/validacao.ts`, `tests/ia/dossie.test.ts`, `tests/ia/validacao.test.ts`

REGRA DURA: nenhum import além de `../tipos.js`, `../ciclo/leitura.js` e tipos. Nada de cliente Supabase, nada de `Intl` problemático (Node e navegador têm `Intl` — pode usar).

- [ ] **Step 1: tipos e montagem** — `src/ia/dossie.ts`

```ts
import type { LeituraCiclo, PontoCiclo } from "../ciclo/leitura.js";

export interface PrecoDia {
  serie: string;        // "boi_gordo" | "bezerro_ms" | "bezerro_sp" | ...
  data: string;         // "2026-08-05"
  valor: number;
}
export interface FuturoDia {
  vencimento: string;   // "out/26"
  preco: number;
}
export interface Dossie {
  geradoEm: string;                 // "2026-08-06"
  ciclo: LeituraCiclo;
  serie: PontoCiclo[];              // cortada na competência da leitura
  precos: PrecoDia[];               // o mais recente de cada série
  variacaoBoiDia: number | null;    // R$ vs pregão anterior, se houver
  futuros: FuturoDia[];
  relacaoTroca: number | null;      // arrobas de boi por bezerro (MS)
  estadosPainel: string;            // "MT + MS + RO"
}

export function montarDossie(entrada: {
  hoje: string;
  ciclo: LeituraCiclo;
  serie: PontoCiclo[];
  precos: PrecoDia[];               // série completa; a função pega os últimos
  futuros: FuturoDia[];
}): Dossie
```

`montarDossie`: corta `serie` até a competência de `ciclo`; para cada série de
preço pega o registro mais recente; `variacaoBoiDia` = último boi_gordo −
penúltimo (null se não houver dois); `relacaoTroca` = bezerro_ms/boi_gordo
(null se faltar um). `dossieParaTexto(d): string` — bloco estruturado pt-BR
para o prompt, com a data de cada preço e a competência do ciclo por extenso.

- [ ] **Step 2: testes do dossiê primeiro** (dados completos; sem preço do dia; sem bezerro → relação null; série cortada na competência). Rodar, ver falhar, implementar, ver passar.

- [ ] **Step 3: validação** — `src/ia/validacao.ts`

```ts
import type { Dossie } from "./dossie.js";

/** Todos os valores numéricos que o texto tem permissão de citar. */
export function valoresPermitidos(d: Dossie): number[]
// pctFemeas*100, yoyMm3Pp (e valor absoluto), mesesNaDirecao, cada preço,
// variacaoBoiDia (e absoluto), relacaoTroca, cada futuro, cada ponto da série
// (pct*100), ano/mes da competência.

export interface Validacao { ok: boolean; invalidos: string[] }
export function validarTexto(texto: string, d: Dossie): Validacao
```

Algoritmo de `validarTexto`:
1. Extrair tokens numéricos pt-BR: regex `/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g`; converter (`.` milhar, `,` decimal).
2. Isenções: inteiros 0–12; anos 1900–2100; token imediatamente precedido ou seguido de `/` (datas e vencimentos: `04/08`, `out/26`); horários `\d+:\d+`.
3. Cada token restante é válido se existe `v` permitido tal que, com `d` casas decimais do token, `|token − round(v, d)| < 10^-d / 2 + 1e-9` — assim "49,8" casa com 49,84 e "50" também.
4. `invalidos` traz os tokens reprovados como aparecem no texto.

- [ ] **Step 4: testes da validação primeiro** — casos mínimos:
  - texto citando 49,8%, R$ 350,20, 9,62 @, −4,17 p.p. com dossiê compatível → ok
  - "o abate somou 152.596 cabeças" sem esse valor no dossiê → reprova e lista `152.596`
  - "queda de 4,17 p.p." (sem sinal) → ok (valor absoluto permitido)
  - datas `04/08/2026`, vencimento `out/26`, "há 4 meses", "às 06:45" → isentos
  - "50% de fêmeas" com pctFemeas 0,4984 → ok (arredondamento na casa do token)
- [ ] **Step 5:** implementar até verde; `npx tsc --noEmit`; commit `feat: dossiê do dia e validação numérica do texto`

---

## Task 3: Texto de reserva e prompts (puros, TDD)

**Files:** Create `src/ia/reserva.ts`, `src/ia/prompt.ts`, `tests/ia/reserva.test.ts`

- [ ] **Step 1:** `reserva.ts` — `export function textoReserva(d: Dossie): string`. Template determinístico de ~8 linhas nas três fases (retencao/liquidacao/transicao), com competência, %, variação, preços datados e relação de troca. Testes: as três fases geram texto com os números certos e sem "undefined"/"NaN".
- [ ] **Step 2:** `prompt.ts` — `export function sistemaCenario(): string` e `export function usuarioCenario(d: Dossie): string` (embute `dossieParaTexto`). O sistema fixa: analista do Peciclo escrevendo para pecuarista que opera mercado futuro; 3 partes (o que mudou hoje / onde estamos no ciclo / o que observar); 8–12 linhas; só números do dossiê, sem calcular nada novo; datar dado defasado; sem recomendação de compra/venda; pt-BR direto, sem jargão de consultoria.
- [ ] **Step 3:** commit `feat: texto de reserva e prompts do cenário`

---

## Task 4: Cliente Anthropic do robô + rotina cenario-diario

**Files:** Create `src/ia/anthropic.ts`, `src/dados/cenarios.ts`, `src/trigger/cenario-diario.ts`; Modify `src/notificacao/evolution.ts` (função `enviarTexto`), `src/config.ts` (se necessário para a chave)

- [ ] **Step 1:** `anthropic.ts` — `gerarTexto({ modelo, sistema, usuario, maxTokens })`: POST `https://api.anthropic.com/v1/messages` com `x-api-key: process.env.ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`; corpo `{ model, max_tokens, system, messages: [{role:"user",content:usuario}] }`; junta os blocos `text` da resposta; lança com corpo do erro em falha HTTP.
- [ ] **Step 2:** `evolution.ts` ganha `enviarTexto({ instancia, apiKey, baseUrl, numero, texto })` → POST `/message/sendText/{instancia}` corpo `{ number, text }` — mesmo padrão de erro de `enviarDocumento`.
- [ ] **Step 3:** `cenarios.ts` — `gravarCenario(linha)` (upsert por `data`) e `lerCenarioDoDia(data)`, via `obterCliente()`.
- [ ] **Step 4:** a rotina, cron `45 6 * * *` timezone `America/Sao_Paulo`, id `cenario-diario`, isolada:

```
dados = lerAbateMensal() + preços + futuros (mesmas leituras da experimental)
dossie = montarDossie(...)
texto = gerarTexto(opus) → validarTexto
  reprovou → regenera 1x com os tokens inválidos apontados no prompt
  reprovou de novo → texto = textoReserva(dossie); origem = 'reserva'; alertarOperador
gravarCenario({ data, texto, origem, modelo, dossie })
destinatarios = unirDestinatarios(cfg.whatsappDestinatarios, await listarTelefonesAtivos())
enviarTexto para cada um (try/catch por destinatário, como as planilhas)
payload defensivo (timestamp opcional) e NUNCA lançar: falha → alerta + return
```

Modelo: `claude-opus-5`, `maxTokens: 1200`. Os futuros vêm do coletor já
existente (`coletarFuturos`); se falhar, dossiê segue sem futuros (o texto não
os menciona).

- [ ] **Step 5:** `npx tsc --noEmit` + suíte inteira verde; commit `feat: rotina do cenário diário com validação e reserva`

---

## Task 5: Deploy e prova real na nuvem

Executor: o orquestrador (envia WhatsApp de verdade).

- [ ] `npx trigger.dev@4.5.9 deploy`; disparar `POST /api/v1/tasks/cenario-diario/trigger` com `{payload:{timestamp:<ISO>,timezone:"America/Sao_Paulo"}}`; conferir run COMPLETED, linha em `peciclo_cenarios` com `origem='ia'`, texto plausível (ler!), validação de números manual por amostragem, WhatsApp recebido. Commit de eventuais ajustes.

---

## Task 6: Cenário do dia no painel

**Files:** Modify `web/src/lib/dados.ts`, `web/src/app/(painel)/painel/page.tsx`

- [ ] `dados.ts`: ler o cenário mais recente (`peciclo_cenarios` order `data` desc limit 1 — leitura direta, sem `lerTudo`: é 1 linha). Bloco "Cenário de hoje" entre a leitura e o gráfico: texto com quebras respeitadas (`whitespace-pre-line`), data por extenso, rótulo conforme `origem` (spec). Sem linha → bloco ausente. Portões do web; commit `feat: cenário do dia no painel`.

---

## Task 7: Rota do chat com streaming

**Files:** Create `web/src/lib/ia.ts`, `web/src/app/(painel)/painel/chat/api/route.ts`

- [ ] **Step 1:** `ia.ts` (server-only): `streamChat({ sistema, mensagens })` — fetch à API com `stream: true`; devolve `ReadableStream<Uint8Array>` que emite SÓ o texto (parsear eventos SSE `content_block_delta`, extrair `delta.text`). `ANTHROPIC_API_KEY` do `process.env`; `import "server-only"`.
- [ ] **Step 2:** a rota POST:

```
exigirClienteAtivo() na primeira linha (guarda o perfil)
corpo: { mensagens: [{ papel: "usuario"|"assistente", conteudo: string }] }
  (histórico do cliente; validar formato, limitar a 40 itens e 4k chars cada)
limite: contar peciclo_chat_mensagens do usuário com papel='usuario' hoje
  (America/Sao_Paulo) via admin-db; ≥50 → 429 JSON { erro: "limite" }
sistema = regras da spec + dossieParaTexto(dossie montado das leituras de
  dados.ts) + cenário do dia (se houver)
stream Sonnet 5 → repassar como Response(stream, text/plain; charset=utf-8)
ao terminar o stream (finally): gravar pergunta + resposta completa via
  admin-db (service_role)
```

Modelo: `claude-sonnet-5`, `maxTokens: 1500`. O dossiê aqui reusa
`montarDossie`/`dossieParaTexto` — importados por `@/lib/dados` (que já
importa da raiz; manter TODOS os imports da raiz concentrados lá).

- [ ] **Step 3:** conferir com `--listFiles` que a raiz alcançada continua sem dependência externa; portões; commit `feat: rota do chat com streaming e limite diário`

---

## Task 8: Tela do chat

**Files:** Create `web/src/app/(painel)/painel/chat/page.tsx`, `web/src/app/(painel)/painel/chat/conversa.tsx`; Modify `web/src/app/(painel)/layout.tsx` (link "Chat")

- [ ] Página (servidor): `exigirClienteAtivo()`; carrega as mensagens do próprio usuário de hoje (RLS cuida do recorte por usuário; filtrar o dia na consulta) e passa ao componente. `conversa.tsx` ("use client"): lista de mensagens (cliente à direita em verde suave, assistente à esquerda), textarea + botão no padrão visual da casa, POST ao `/painel/chat/api`, lê o stream com `res.body.getReader()` appendando na última bolha; desabilita o envio enquanto responde; erro 429 → recado do limite; erro genérico → "não consegui responder agora". Rodapé fixo discreto: "Respostas geradas por IA sobre os dados do Peciclo. Não é recomendação de investimento." Link "Chat" no cabeçalho entre "Planilhas" e o nome. Portões; commit `feat: tela do chat`.

---

## Task 9: Prova em produção

Executor: o orquestrador.

- [ ] Push → Vercel publica. Pré-requisito: `ANTHROPIC_API_KEY` nas variáveis da Vercel (pendência do dono — sem ela o chat responde 500; o painel e o cenário funcionam mesmo assim). Verificar por HTTP com login real: bloco do cenário no painel, chat respondendo em streaming com número correto (perguntar "qual a participação de fêmeas?" e conferir com o painel), limite e RLS (cliente não lê mensagem de outro), `sb_secret`/`sk-ant` ausentes do HTML e dos bundles de `.next/static`.
