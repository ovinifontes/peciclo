# Envio diário das 3 imagens da seção diária por WhatsApp — Plano

**Pedido do dono:** o cliente quer receber, todo dia, as MESMAS três imagens que o
"Exportar imagem" da seção DIÁRIA gera (Tabela, Linhas, Colunas), logo depois do
que já enviamos (planilhas 06:00/06:30 e resumo 06:45). Só o diário — o mensal
não muda todo dia.

**Princípio:** as imagens automáticas têm de ser **pixel por pixel as mesmas** do
clique manual. Nada de recriar visual no servidor: um navegador de verdade
(Chromium via Playwright, extensão oficial do Trigger.dev) abre o site real,
renderiza o mesmo cartão de 1080px e fotografa em 2x.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Renderização | Chromium headless na task (extensão `playwright` do @trigger.dev/build 4.5.9, presente no lockfile) | fidelidade total; uma só fonte de verdade visual |
| Autenticação | **conta-robô** (`robo-imagens@peciclo.com.br`, papel cliente, ativa, SEM telefone, recebe_whatsapp=false) logando pelo formulário real | zero mudança na Vercel (o token dela foi revogado); RLS já protege tudo |
| Página fotografada | `/impressao-diario/[visao]` — página standalone (SEM o cabeçalho do painel), `exigirClienteAtivo()` na primeira linha, que renderiza SÓ o cartão exportável a 1080px | reusa o MESMO componente do export manual |
| Horário | 06:52 America/Sao_Paulo | depois do resumo das 06:45 |
| Envio | Evolution `sendMedia` tipo imagem (base64), legenda curta por imagem | imagem abre inline no WhatsApp |
| Destinatários | clientes ativos ∪ WHATSAPP_DESTINATARIOS (mesma `unirDestinatarios`) | regra da casa |
| Envio único/dia | tabela `peciclo_envios_imagens (data date pk, enviado_em)` | lição do cenário duplicado |
| Falha | nunca lança; alerta ao operador; sem imagem ≠ sem planilha (rotinas isoladas) | regra da casa |

## Tasks

**T1 (orquestrador):** migração `peciclo_envios_imagens` (RLS ligada, zero
políticas — interna) + criar a conta-robô via service_role (senha forte só no
env do Trigger: `ROBO_IMAGENS_EMAIL`, `ROBO_IMAGENS_SENHA`; também no .env local).

**T2 (web):** extrair de `exportavel.tsx` o miolo (o cartão em si) para
`cartao-exportavel.tsx` — o exportável offscreen do clique manual passa a
envolvê-lo (zero mudança de comportamento; portões + First Load intactos).
Nova rota `web/src/app/(impressao)/impressao-diario/[visao]/page.tsx` com layout
mínimo próprio: `exigirClienteAtivo()`, valida `visao ∈ {tabela,linhas,colunas}`
(inválido → notFound), lê os dados diários como o painel, renderiza o cartão a
1080px VISÍVEL, com `animar=false` nos gráficos e um marcador de prontidão
`data-impressao-pronta` que o componente seta quando os SVGs montarem (a tabela
marca direto). Título "Impressão · Peciclo".

**T3 (robô):** `trigger.config.ts` ganha a extensão `playwright` (só chromium);
`src/notificacao/evolution.ts` ganha `enviarImagem` (sendMedia base64 — conferir
formato exato na skill/documentação da Evolution v2 e no padrão dos irmãos);
`src/trigger/enviar-diario-imagens.ts` (schedule 06:52, PRODUCTION):
1. trava: linha de hoje em `peciclo_envios_imagens` → sai com `jaEnviado`
2. chromium: login no site com a conta-robô (formulário real), depois para cada
   visao: goto `/impressao-diario/{visao}` → espera `[data-impressao-pronta]` →
   screenshot do cartão (`deviceScaleFactor 2`, PNG)
3. envia as 3 imagens em ordem (Tabela, Linhas, Colunas) com legendas curtas
   (`📊 Abate diário — Tabela · dd/mm`) aos destinatários da união, try/catch
   por destinatário/imagem
4. ≥1 envio → grava a trava; alerta em falha; NUNCA lança
- payload defensivo; `SITE_URL` do env (default https://peciclo.com.br);
  `maxDuration` generoso (Chromium + 3 páginas)

**T4 (orquestrador):** envs no Trigger; deploy; disparo real (vai aos
destinatários de verdade — é o teste de aceitação; a trava fica marcada e o
agendado de amanhã segue normal); conferir imagens recebidas + trava; push;
memória.

## O que NÃO muda
Rotinas 06:00/06:30/06:45, seção mensal, exportar manual (só ganha o miolo
extraído), grants existentes, chat.
