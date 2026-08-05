# Peciclo SaaS — Fatia 1: acesso e painel

**Data:** 2026-08-05
**Status:** aprovado

## Contexto

O sistema de coleta está em produção: quatro portais estaduais, banco no Supabase, duas planilhas enviadas por WhatsApp todo dia. O passo seguinte é vender **acesso** a esses dados — um SaaS high-ticket em `peciclo.com.br`, com contas criadas manualmente pelo dono.

Esta spec cobre **apenas a Fatia 1**. O projeto inteiro foi decomposto em três, porque desenhar tudo junto levaria a decidir detalhe do chat de IA antes de saber como o login funciona.

| Fatia | Conteúdo | Status |
|---|---|---|
| **1** | Acesso (login, admin, suspensão) + painel com KPIs | **esta spec** |
| 2 | Texto do cenário redigido por IA | depois |
| 3 | Chat de IA sobre os dados | depois |

Identidade visual corre em paralelo e não bloqueia nada; a Fatia 1 nasce com visual neutro.

Pesquisa técnica de apoio: [`referencias/saas-recon.md`](../../../referencias/saas-recon.md).

## Escopo

**Nesta fatia:**
- Login por e-mail e senha, **sem cadastro público**
- Painel administrativo: criar, suspender, reativar, cancelar cliente; editar telefone e senha
- Painel do cliente: leitura do ciclo, gráfico da participação de fêmeas, tabela mensal, download das planilhas
- Envio diário de WhatsApp passa a ler os telefones dos clientes ativos
- Permissões de leitura no banco (hoje inexistentes)

**Fora desta fatia:**
- Chat de IA e texto redigido por IA (fatias 2 e 3)
- Cobrança e pagamento — o dono controla acesso manualmente
- Autoatendimento (recuperação de senha pelo próprio cliente): nesta fatia o dono troca a senha
- Conteúdo diferente por cliente: hoje todos veem os mesmos dados de mercado

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Repositório | Mesmo repo, em `web/` | Um histórico só; o robô continua na raiz, intocado |
| Banco | O mesmo Supabase | Os dados já estão lá |
| Stack | Next.js (App Router) na Vercel | Auth e banco integrados; o dono já usa Supabase |
| Plano da Vercel | **Pro (US$ 20/mês)** | O plano gratuito **proíbe uso comercial** |
| Gráficos | Recharts, carregado sob demanda | 112 KB gzip; não pode entrar no bundle do login |
| Leitura do ciclo | **Regra determinística**, sem IA | Auditável, sem risco de número inventado |
| Suspensão | **Duas camadas** | Bloquear só o login deixa a sessão aberta valer até 1h |
| Primeiros usuários | Dono e sócio | Testar antes de expor ao cliente |

## Arquitetura

```
repositório peciclo/
├── src/            robô de coleta (Trigger.dev) — INTOCADO
├── web/            aplicação Next.js  ← novo
└── supabase/migrations/   + migration de perfis e permissões
```

O site e o robô compartilham **o banco** e a **lógica pura de cálculo** (`src/planilha/kpis.ts`, `src/planilha/mercado.ts`), importada por caminho relativo. Não compartilham build, dependências nem deploy: a Action do robô roda na raiz e não é afetada; a Vercel aponta para `web/`.

**Três camadas no site, com fronteiras claras:**

- **Porta** (`/login`) — autenticação. Não conhece regra de negócio.
- **Painel** (`/painel`) — o que todo usuário ativo vê. Não conhece administração.
- **Gestão** (`/admin`) — só o dono. Única camada que usa a chave privilegiada do banco.

**A proteção vive junto do dado, não no porteiro.** Toda página e toda ação verificam de novo quem é o usuário e se está ativo, através de uma camada única de acesso a dados. O "porteiro" (middleware) só renova a sessão. Isso é resposta a uma falha real do Next.js (CVE-2025-29927) em que a checagem feita apenas no middleware podia ser burlada por um cabeçalho HTTP.

## Modelo de dados

### `peciclo_perfis`

Uma linha por usuário, ligada ao sistema de login.

Campos: `id` (referencia o usuário do Auth), `nome`, `telefone_whatsapp`, `papel` (`cliente` | `admin`), `status` (`ativo` | `suspenso` | `cancelado`), `recebe_whatsapp`, `motivo_status`, `criado_em`, `atualizado_em`.

O telefone segue o formato que a Evolution já usa: DDI+DDD+número, só dígitos.

**Três status, não um booleano.** `suspenso` é reversível (inadimplência); `cancelado` encerra a relação preservando histórico e e-mail, para que o endereço não seja reciclado por engano.

### Permissões — a correção mais importante

As cinco tabelas de dados têm segurança de linha **ligada** e `revoke all ... from authenticated` nas migrations. Consequência: escrever política de acesso **não basta** — o Postgres avalia o privilégio SQL antes da política, então sem `GRANT SELECT` o usuário logado recebe erro de permissão e a política sequer é considerada.

E, no estado atual, o efeito visível seria pior: consulta **devolve vazio, sem erro**. Gráfico em branco e nenhuma pista.

A migration precisa, nesta ordem:
1. `GRANT SELECT` nas tabelas de leitura para `authenticated`
2. Políticas liberando leitura só a usuário **ativo**
3. Funções auxiliares `SECURITY DEFINER` para "é ativo?" e "é admin?"

As funções auxiliares são obrigatórias: uma política em `peciclo_perfis` que consultasse `peciclo_perfis` entraria em **recursão infinita**. A função roda com privilégios do dono e não dispara a política do invocador.

Nas políticas, `auth.uid()` deve aparecer como `(select auth.uid())` — assim é avaliado uma vez por consulta em vez de uma vez por linha.

**Tabelas que ficam fora do alcance do navegador:** `peciclo_gta_registros` (2,3 milhões de linhas de detalhe) e `peciclo_coletas` (auditoria). O site lê agregados. Detalhe bruto é matéria-prima, não conteúdo de tela.

**A `service_role` dos robôs não é afetada** — ela ignora políticas por definição. O sistema de coleta continua funcionando sem nenhuma alteração.

## A leitura do ciclo

O pedido original era um texto que muda todo dia. Os dados de abate são **mensais** — um texto que "mudasse todo dia" estaria inventando movimento. Num produto vendido a quem opera mercado futuro, isso destrói a confiança na primeira conferência.

A solução é mostrar **duas velocidades**, cada uma rotulada com a data do dado:

**Bloco CICLO (muda no mês).** Classificação a partir da variação **anual** da média móvel de 3 meses da participação de fêmeas:

- queda sustentada → **retenção** (pecuarista segurando matriz)
- alta sustentada → **liquidação** (descarte de matriz)
- variação pequena → **transição/estável**

Acompanha há quantos meses o movimento se mantém.

**Bloco MERCADO (muda no dia).** Boi gordo, bezerro, relação de troca e a direção da curva de futuros, com variação.

### Composição fixa — a regra que evita um erro grave

O consolidado só pode somar meses em que **todos os estados do painel têm dado**. Sem isso, junho/2026 (sem o Pará) cai para 49,84% e parece uma queda de mercado — quando é apenas ausência de um estado. Já vimos esse artefato antes, na coluna "Estados no cálculo" da planilha.

**O painel do ciclo é MT + MS + RO.** O Pará fica **fora da série consolidada** — e a razão é o atraso: a ADEPARA publica com cerca de dois meses de defasagem, então incluí-lo faria a leitura do ciclo inteira esperar por ele. Com três estados, a leitura fica a um mês do presente; com quatro, a três meses. Para um produto onde o cliente decide posição, um mês de defasagem é aceitável e três não são.

O Pará continua aparecendo normalmente na **tabela** e no **gráfico por estado** — ele só não entra no número consolidado que classifica a fase do ciclo.

Consequência honesta a registrar na tela: o percentual consolidado do painel **não é igual** ao da planilha (que soma quatro estados). São recortes diferentes, ambos corretos. A tela informa quais estados compõem o número.

Regra completa: um mês entra na série do ciclo apenas se **MT, MS e RO** estiverem todos presentes, e só é considerado utilizável se o volume estiver em pelo menos 90% do mesmo mês do ano anterior (o que reprova mês corrente parcial).

Quando o mês mais recente é reprovado por esse teste, o painel mostra o **último mês utilizável** e diz isso — em vez de exibir um número que parece novo e está incompleto.

## As telas

### `/login`
E-mail e senha. Sem link de cadastro. Erro genérico ("e-mail ou senha inválidos") para não revelar quais e-mails existem.

### `/painel` — todo usuário ativo
1. **Leitura** — os dois blocos acima, cada um com a data do dado
2. **Gráfico** — participação de fêmeas ao longo do tempo, com a média histórica marcada
3. **Tabela** — números mês a mês por estado
4. **Planilhas** — download das planilhas já arquivadas no Storage

### `/admin` — só o dono
Lista de clientes com nome, e-mail, telefone e status; formulário de criação; ações de suspender, reativar, cancelar, editar telefone e trocar senha.

O dono vê o painel do cliente normalmente — precisa ver o que o cliente vê. A gestão é um item a mais no menu.

### `/conta-inativa`
Destino de quem está suspenso ou cancelado. Mensagem neutra com contato, sem detalhe técnico.

## Envio de WhatsApp

O job passa a compor a lista de destinatários assim:

```
destinatários = telefones dos clientes ativos (banco)
              ∪ WHATSAPP_DESTINATARIOS (configuração atual)
```

**A configuração atual permanece como rede de segurança.** Se a lista viesse só do banco e a tabela estivesse vazia — migration não aplicada, coluna errada — o job rodaria com sucesso, reportaria "0 enviados" e **ninguém receberia nada, nem o dono**. Silêncio é a pior falha possível: só se descobre quando o cliente reclama. Com a união, o pior caso é envio duplicado — chato, mas visível.

A função que lê o banco **nunca lança exceção**: qualquer falha devolve lista vazia e o job segue com a configuração. Números malformados são descartados individualmente, sem derrubar o lote.

Mudança no robô: um arquivo novo (`src/dados/perfis.ts`) e a montagem da lista em `gerar-e-enviar.ts`. O tratamento de erro por destinatário continua idêntico.

## Segurança

- **Chave privilegiada do banco** só em módulos marcados como exclusivos de servidor, nunca importada por componente de cliente
- **Toda ação administrativa reverifica** que o usuário é admin na primeira linha — o layout não protege uma ação, que é uma requisição direta
- **Validação de sessão** por `getClaims()` (valida a assinatura), nunca `getSession()` em código de servidor
- **Suspensão em duas camadas**: bloqueio no Auth (impede entrar e renovar) e status no banco (corta o acesso ao dado imediatamente)

## Testes

- **Regras do ciclo** — funções puras, testadas com séries construídas: retenção, liquidação, transição, mês incompleto reprovado, mês sem todos os estados excluído
- **Composição fixa** — um mês sem um dos estados não pode entrar no consolidado
- **Lista de WhatsApp** — união com a configuração, descarte de número inválido, tabela vazia não zera a lista
- **Permissões** — verificar em Postgres real que usuário ativo lê, suspenso não lê, e que a `service_role` continua lendo tudo
- **Acesso** — cliente não alcança `/admin`; ação administrativa recusa quem não é admin mesmo chamada diretamente

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Consulta vazia por falta de permissão | Migration de `GRANT` + políticas antes de ligar o site |
| Recursão infinita na política de perfis | Funções `SECURITY DEFINER` |
| Sessão de um usuário servida a outro por cache | Aplicar os cabeçalhos de cache que a biblioteca fornece |
| Cliente suspenso continua vendo dados | Suspensão em duas camadas |
| Envio silencioso para ninguém | Configuração atual como rede de segurança |
| Deploy do robô quebrar por causa do site | `web/` isolado, com dependências próprias |

## Pendências do dono

1. **Registrar `peciclo.com.br`** — verificado em 05/08/2026: livre e não registrado
2. Criar a conta na Vercel (plano Pro)
3. Desligar o cadastro público no painel do Supabase
