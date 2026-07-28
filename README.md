# Peciclo — Coleta de Abate Bovino para Análise do Ciclo Pecuário

Automatiza a coleta diária de dados de abate bovino por sexo nos portais de
defesa agropecuária de **MT, MS, RO e PA**, armazena com histórico auditável,
gera a planilha `.xlsx` no formato que o fazendeiro já conhece (com uma aba de
KPIs do ciclo) e envia pelo WhatsApp.

Documentos de referência:
- Design: [`docs/superpowers/specs/2026-07-27-coleta-abate-ciclo-pecuario-design.md`](docs/superpowers/specs/2026-07-27-coleta-abate-ciclo-pecuario-design.md)
- Plano de implementação: [`docs/superpowers/plans/2026-07-27-coleta-abate-ciclo-pecuario.md`](docs/superpowers/plans/2026-07-27-coleta-abate-ciclo-pecuario.md)
- Ciclo pecuário: [`referencias/ciclo-pecuario.md`](referencias/ciclo-pecuario.md)
- Reconhecimento dos portais: [`referencias/portais-recon.md`](referencias/portais-recon.md)

## Como cada estado é coletado

| Estado | Fonte | Granularidade | Como |
|---|---|---|---|
| **MS** | IAGRO (endpoint anônimo) | detalhe por GTA | 1 GET → XLSX → `gta_registros` → rollup |
| **PA** | ADEPARA (Google Drive) | planilha mensal | detecta arquivo novo → `gta_registros` → rollup |
| **MT** | INDEA (GTA Condensado, login) | agregado mensal | login + export → soma → `abate_mensal` |
| **RO** | IDARON (Power BI) | agregado mensal | query DSR → `abate_mensal` *(ver pendência)* |

MS e PA dão detalhe por GTA e passam pela tabela `gta_registros`; MT e RO já vêm
agregados por competência e gravam direto em `abate_mensal`. O gerador de
planilha lê só `abate_mensal`, então não sabe dessa diferença.

## Rodar os testes

```bash
npm install
npm test            # vitest, 63 testes — nenhum toca a rede
npm run typecheck   # tsc --noEmit
```

Os parsers são testados contra arquivos reais salvos em `tests/fixtures/`, nunca
contra os portais ao vivo. Os totais esperados foram medidos nos arquivos reais
(ex.: PA maio/2026 = fêmea 188.406, macho 152.453, idêntico à planilha manual).

## Rodar localmente (precisa de credenciais)

Copie `.env.example` para `.env` e preencha. Depois:

```bash
npm run dev:trigger   # sobe o Trigger.dev em modo dev
```

No dashboard, dispare `coleta-diaria` manualmente.

## Variáveis de ambiente

| Variável | Onde obter |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `TRIGGER_PROJECT_REF` | Dashboard do Trigger.dev |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA` | Instância da Evolution |
| `WHATSAPP_DESTINATARIOS` | Números DDI+DDD+numero, separados por vírgula |
| `WHATSAPP_OPERADOR` | Número que recebe os alertas técnicos |
| `INDEA_CPF`, `INDEA_SENHA` | Credencial do INDEA (MT) |
| `GOOGLE_API_KEY` | Google Cloud → API key com Drive API v3 habilitada |

## Pendências antes de ir para produção

1. **Aplicar o banco** — `supabase link --project-ref <ref>` e `supabase db push`. As
   migrations em `supabase/migrations/` já foram validadas contra um Postgres real.
2. **Semear o histórico** — depois do banco:
   ```bash
   npx tsx -e "import('./src/semente/importar-historico.js').then(m => m.semearHistorico('referencias/planilha-abate-2025-2026.csv')).then(n => console.log('linhas:', n))"
   ```
3. **Finalizar o RO** — o cluster do Power BI (`*.analysis.windows.net`) é bloqueado na
   rede de desenvolvimento. Num ambiente com acesso, rode `npx tsx
   scripts/descobrir-consulta-ro.ts`, cole o corpo capturado em `montarConsulta`
   (em `src/coletores/ro.ts`), valide `parsearRespostaPowerBi` contra a resposta
   real e ligue `coletorRo` ao batch em `src/trigger/coleta-diaria.ts`. Até lá, a
   planilha mostra o RO com a semente histórica (`fonte = manual`).
4. **Deploy** — cadastrar as variáveis no Trigger.dev e `npm run deploy:trigger`.

## Operação

**Reprocessar um período.** Todo arquivo bruto fica no bucket `brutos` do Storage
com hash. Para corrigir um parser e reprocessar sem tocar nos portais, dispare
`coletor-<uf>` com a janela desejada.

**Quando um portal muda de layout.** A validação de cabeçalho falha alto de
propósito — melhor parar e alertar do que gravar dado errado. O arquivo bruto do
dia da quebra serve de novo fixture.

**O que o fazendeiro nunca vê.** Erros técnicos vão só para o operador. Se algum
coletor falha, a planilha vai assim mesmo com os dados que há; se tudo falha, ele
recebe a planilha de ontem — nunca uma mensagem de erro.

**Limites de gentileza.** MT tem 1 login por dia e sem paralelismo. Os portais são
serviços públicos e não devem ser sobrecarregados.
