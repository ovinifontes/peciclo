# Peciclo — Fatias 2 e 3: cenário diário por IA e chat sobre os dados

**Data:** 2026-08-06
**Status:** aprovado

## Contexto

A Fatia 1 está em produção: `peciclo.com.br` com login, painel (leitura do ciclo,
gráfico, tabela, planilhas) e administração; robô coletando às 06:00/06:30 e
enviando WhatsApp aos clientes ativos. Falta a camada de IA prometida no
projeto: um texto diário que explica o cenário e um chat sobre os dados.

Decisões do dono (2026-08-06): o texto vai para **site + WhatsApp**; o chat
responde **dados com exatidão + contexto geral rotulado**, sem recomendação de
compra/venda.

## O princípio que governa tudo

**A IA escreve, mas nunca inventa número.** O produto é vendido a quem opera
mercado futuro; um número errado numa frase bonita destrói a confiança na
primeira conferência. Toda a arquitetura serve a isso:

1. A IA só vê o **dossiê** — um retrato do dia montado por código determinístico
   a partir do banco. O que não está no dossiê não existe para ela.
2. Todo número no texto gerado é **validado automaticamente** contra o dossiê.
3. Se a validação falhar duas vezes, entra um **texto determinístico de
   reserva** (template, sem IA) e o operador é alertado. Cliente nunca recebe
   texto não verificado, e nunca fica sem texto.

## Escopo

**Nesta entrega:**
- Módulo puro do dossiê + validação numérica + texto de reserva (testáveis)
- Rotina `cenario-diario` no robô (~06:45), tabela `peciclo_cenarios`, envio
  por WhatsApp como mensagem de texto após as planilhas
- Bloco "Cenário de hoje" no painel
- Chat em `/painel/chat`: streaming, dossiê no sistema, conversas gravadas,
  limite diário por cliente

**Fora:**
- Tela de histórico dos cenários (dados ficam guardados desde já)
- Ferramentas/consultas dinâmicas no chat (o dossiê cobre; reavaliar depois)
- Personalização por cliente

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Modelo do texto diário | `claude-opus-5` | 1 chamada/dia; qualidade máxima custa centavos |
| Modelo do chat | `claude-sonnet-5` | latência de conversa e custo por mensagem |
| Cliente da API | `fetch` puro, sem SDK | zero dependência nova no robô e no site |
| WhatsApp | mensagem de texto separada, após as planilhas | legenda de arquivo tem limite e espreme o texto |
| Chat sem ferramentas | contexto completo no sistema | dados são pequenos (KBs); auditável; sem loop agêntico em serverless |
| Conversas gravadas | `peciclo_chat_mensagens` | cliente vê as suas; dono vê todas — termômetro do produto |
| Limite diário | 50 mensagens/cliente/dia | custo nunca surpreende |
| Compartilhamento raiz↔web | só módulos puros | regra da Fatia 1: o site só alcança arquivos sem dependência externa (o build da Vercel não instala a raiz) |

## Arquitetura

```
src/ia/dossie.ts        puro: monta o dossiê a partir de dados já lidos
src/ia/validacao.ts     puro: confere números do texto contra o dossiê
src/ia/reserva.ts       puro: texto determinístico de fallback
src/ia/anthropic.ts     fetch para /v1/messages (robô; o site tem o seu)
src/trigger/cenario-diario.ts   rotina nova, isolada
web/src/lib/ia.ts       cliente Anthropic do site (streaming)
web/src/app/(painel)/painel/chat/         página + rota da API
```

`dossie.ts`, `validacao.ts` e `reserva.ts` **não importam nada com dependência
externa** — o site os importa por caminho relativo, como faz com
`ciclo/leitura.ts`. A leitura do banco fica de cada lado (robô: `dados/*.ts`;
site: `lib/dados.ts`), e o dossiê recebe os dados prontos.

### O dossiê

Estrutura tipada com: leitura do ciclo (fase, competência, %, variação, meses),
série mensal consolidada, últimos preços com data, curva de futuros, relação de
troca, e **a data de cada dado** (o texto diz "cotações de ontem" quando for o
caso, como o painel já faz). Serializado como texto estruturado no prompt.

### Validação numérica

Extrai todo token numérico do texto gerado (tolerante a formatação pt-BR:
`49,8%`, `R$ 350,20`, `4 meses`) e exige que cada um exista no dossiê (com
arredondamento compatível). Anos e números por extenso pequenos (um a doze) são
isentos. Falhou → regenera com o erro no prompt; falhou de novo → reserva +
alerta. A validação é **pura e testada** — é o coração da confiança.

## Fatia 2 — cenário diário

### `peciclo_cenarios`

`data date primary key`, `texto text`, `origem text check ('ia','reserva')`,
`modelo text`, `dossie jsonb`, `criado_em timestamptz`. RLS: cliente ativo lê
(GRANT SELECT + política `peciclo_e_ativo()`); escrita só pela service_role.
Guardar o dossiê junto ao texto torna cada cenário auditável para sempre.

### Rotina `cenario-diario` (06:45 America/Sao_Paulo)

1. Lê banco → monta dossiê → Opus 5 (prompt: papel, estrutura em 3 partes —
   o que mudou hoje, onde estamos no ciclo, o que observar — 8–12 linhas,
   pt-BR direto de quem entende de boi, sem recomendação de posição, números
   exatamente como o dossiê dá)
2. Valida → retry → reserva (conforme o princípio)
3. Grava em `peciclo_cenarios` (upsert por data: rodar duas vezes no dia
   sobrescreve, não duplica)
4. Envia por WhatsApp (texto) para `clientes ativos ∪ configuração` — mesma
   `unirDestinatarios` das planilhas; falha por destinatário não derruba o lote
5. Nunca lança para o agendador: qualquer falha vira alerta ao operador

### No painel

Bloco "Cenário de hoje" entre a leitura e o gráfico: o texto do dia, a data e o
rótulo — IA: "Escrito por IA a partir dos dados desta página, com conferência
automática dos números"; reserva: "Resumo automático" (sem fingir que é IA).
Sem cenário na tabela (primeiro dia, falha total): o bloco simplesmente não
aparece.

## Fatia 3 — chat

### Rota `POST /painel/chat/api`

Primeira linha: `exigirClienteAtivo()`. Depois: limite diário (conta mensagens
do usuário no dia; ≥50 → 429 com recado); monta contexto (dossiê + série +
cenário do dia + regras); chama Sonnet 5 com `stream: true`; repassa o stream;
ao final grava pergunta e resposta em `peciclo_chat_mensagens` (via
service_role — o navegador não escreve nessa tabela).

Regras do sistema (fixas): números do Peciclo com exatidão e sem inventar;
conhecimento geral de mercado sempre rotulado ("contexto geral, não é dado
Peciclo"); sem recomendação de compra/venda — explica cenário e mostra o que
os dados dizem, a decisão é do cliente; responde em português; recusa temas
fora de pecuária/mercado com uma frase simpática.

### `peciclo_chat_mensagens`

`id bigint identity pk`, `usuario_id uuid references peciclo_perfis(id) on
delete cascade`, `papel text check ('usuario','assistente')`, `conteudo text`,
`criado_em timestamptz`. RLS: cliente lê as próprias (GRANT SELECT + política
por `usuario_id`); admin lê todas (política `peciclo_e_admin()`); INSERT só
service_role (sem GRANT de insert a authenticated).

### Página `/painel/chat`

Visual da casa. Cliente carrega o histórico do próprio dia, manda mensagem,
vê a resposta chegar em streaming. Aviso permanente e discreto no rodapé:
"Respostas geradas por IA sobre os dados do Peciclo. Não é recomendação de
investimento." Link "Chat" no cabeçalho do painel.

## Segurança

- `ANTHROPIC_API_KEY` só no servidor (Trigger e Vercel); nunca com prefixo
  `NEXT_PUBLIC_`, nunca importada por componente de cliente
- Rota do chat revalida cliente ativo a cada requisição; suspenso no meio da
  conversa → 401 na próxima mensagem
- O prompt do sistema não contém segredo nenhum (só dados que o cliente já vê
  no painel — vazamento de prompt não vaza nada)
- Entrada do usuário vai como mensagem, nunca concatenada ao sistema

## Testes

- **Dossiê**: montagem com dados completos, sem preços do dia, sem PA
- **Validação**: texto fiel passa; número inventado reprova; formatos pt-BR
  (`49,8%`, `R$ 3.369,17`, `9,62`); isenções (anos, extenso)
- **Reserva**: gera texto coerente nas três fases do ciclo
- **Limite diário**: 49ª passa, 50ª passa, 51ª recusa
- **Rota do chat**: sem sessão → 401; suspenso → bloqueado; ativa → responde
- **Rotina**: validação reprovada duas vezes → grava `origem='reserva'` e alerta

## Pendências do dono

1. ~~Chave da API~~ — feita, validada, já no `.env` e no Trigger
2. **`ANTHROPIC_API_KEY` na Vercel** (o token de ontem foi revogado):
   Settings → Environment Variables do projeto `peciclo`, colar a mesma chave,
   marcar os 3 ambientes — ou me dar um token novo de 1 dia que eu cadastro
