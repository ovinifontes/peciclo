# Reconhecimento técnico dos portais (2026-07-27)

Levantamento feito por pesquisa automatizada, **somente leitura** (nenhum login realizado, nenhum formulário de escrita submetido). Serve de base para decidir a arquitetura de coleta.

## Resumo executivo

| Portal | Dificuldade | Estratégia | Login? | Granularidade |
|---|---|---|---|---|
| **IAGRO (MS)** | 🟢 Trivial | 1 GET → XLSX | Não | Por GTA, por data |
| **ADEPARA (PA)** | 🟢 Fácil | Google Drive público | Não | Planilha mensal (atrasada) |
| **INDEA (MT)** | 🟡 Média | POST login + export | **Sim** | Por GTA, por data |
| **IDARON (RO)** | 🔴 Difícil | Power BI publish-to-web | Não | Agregado mês/ano |

---

## IAGRO — Mato Grosso do Sul 🟢

**Descoberta principal: existe um endpoint anônimo que devolve o XLSX direto.** A tela é um SPA Angular, mas o relatório é servido por um único GET sem token:

```
GET https://api.ms.gov.br/api-esaniagro/v1/relatorio/DocumentosDeTransitoRel
  ?especieAnimalID=1          # 1 = BOVINO (confirmado)
  &periodoInicial=2026-07-25  # aceita ISO
  &periodoFinal=2026-07-26
  &municipioIDOrigem=&municipioIDDestino=&municipioUFDestino=&finalidadeID=
```

Testado: HTTP 200, XLSX válido de ~330 KB, sem `Authorization`, sem cookie, sem browser.

- **Colunas úteis:** `Finalidade`, `Total Femêa` (sic, com typo no original), `Total Macho`, `Total Animais`, mais 8 colunas de faixa etária por sexo.
- Cabeçalho da tabela na linha ~19 do Excel — **localizar pela string "Tipo de Documento"**, não fixar o índice.
- `Data Emissão` vem como serial numérico do Excel (epoch 1899-12-30).
- **Não passar `finalidadeID`**: deixar vazio e filtrar `Finalidade == "ABATE"` localmente (o lookup de IDs exige token, e assim vem ENGORDA/REPRODUÇÃO de brinde).
- Teste real em 25–26/07/2026: 1.584 fêmeas e 1.055 machos com finalidade ABATE.
- **Rejanela necessária:** GTAs são lançadas com atraso — reprocessar os últimos 7–10 dias semanalmente.

## ADEPARA — Pará 🟢

Cadeia confirmada: [node/313](https://www.adepara.pa.gov.br/node/313) → pasta pública no Drive `1Sb-90n2n_NtTAOC_z60OB1TQG7kZin_l` → subpasta "GTAs 2026 dados públicos" `18gGTO1UgZP3nu1YqblX8ipWWCTKxsKdc`.

- Download anônimo: `https://drive.google.com/uc?export=download&id=<fileId>` (arquivos de ~16 MB baixam direto, sem token de antivírus).
- Listagem: **preferir Google Drive API v3 com API key** (`files?q='<folderId>'+in+parents&fields=files(id,name,modifiedTime,md5Checksum)`); o parse do HTML da pasta funciona hoje mas é frágil e pagina a cada ~50 itens.
- **Sexo não é coluna própria** — vem embutido em `taxonomia`: `"BOVINO, MACHO, 13 A 24 MESES"`. Parsear por vírgula.
- `finalidade` tem `ABATE` **e** `ABATE SANITÁRIO` — decidir explicitamente se o sanitário entra.
- Confirmado o atraso: em 27/07/2026 o último mês publicado é **Maio/2026** (subido em 23/jun). O job precisa tolerar meses faltantes e chegadas fora de ordem.
- Virada de ano cria nova subpasta (`GTAs 2027 dados públicos`) que precisa ser detectada.

## INDEA — Mato Grosso 🟡

Java + Struts2 (rotas `.action`), atrás de F5 BIG-IP com WAF, charset **ISO-8859-1**.

- Login é um `<form>` HTML clássico: `POST Login.action` com `usuario` (CPF) e `senha`. **Sem captcha, sem CSRF token, sem hash client-side** → reproduzível com HTTP puro + cookie jar (JSESSIONID).
- Confirmado que `exportar_gta_condensado_input.action` é protegido: sem sessão, redireciona 302 por `Logout.action` → login.
- **Pendente:** o nome exato da action de export, os parâmetros de data e o formato do arquivo só podem ser mapeados dentro de uma sessão autenticada. Provável `exportar_gta_condensado.action` (convenção Struts), datas em `dd/MM/yyyy`.
- A automação deve detectar redirect para a tela de login e refazer o login (sessão expira).
- WAF pode aplicar rate-limit — manter poucas requisições e User-Agent identificável.

## IDARON — Rondônia 🔴

O dado **não** está em um sistema próprio: está num **Power BI "publish to web"** linkado da página WordPress.

- Relatório: `app.powerbi.com/view?r=...` → resource key `31c7b0f6-5ede-4358-be35-b8fc49ac0ab1`, tenant `2a9abb1a-5f36-4057-a75c-20b4296c5842`.
- Por baixo: `POST https://wabi-brazil-south-redirect.analysis.windows.net/public/reports/querydata?synchronous=true` com header `X-PowerBI-ResourceKey` — **sem autenticação**. Resposta em formato DSR (dicionários + deltas, chato de parsear).
- **Duas estratégias:** (a) replicar o POST `querydata` com HTTP puro — mais barato, precisa capturar o corpo `SemanticQuery` uma vez no DevTools; (b) Playwright interceptando o XHR — mais robusto a mudanças.
- Scrapers genéricos (just-scrape) **não funcionam**: capturam só o spinner (render leva 15–30s).
- Risco: o IDARON pode republicar o relatório e invalidar a resource key → re-raspar a página WordPress periodicamente para reextrair o `r=`.
- Cadência de atualização do dataset é desconhecida — o valor do mês corrente pode estar defasado.

---

## Goiás e São Paulo (colunas vazias da planilha)

**Não existe fonte estadual pública equivalente.** A AGRODEFESA (GO) publica só a contagem de GTAs por espécie do ano corrente, sem sexo e sem finalidade. O painel de estatísticas da Defesa Agropecuária de SP está oficialmente vazio e o GEDAVE é transacional com login. Obter a série real exigiria pedido via LAI.

**Alternativa viável — SIGSIF/MAPA (dados abertos):**
CSV "Quantitativo de Animais Abatidos por Categoria e UF" com `ANO;MES;UF_PROCEDENCIA;MUNICIPIO;CATEGORIA;QUANTIDADE`, categorias `Bovino Macho` / `Bovino Femea`, série mensal, **dados já disponíveis até julho/2026**. Público, sem login, automatizável.

⚠️ **Quebra metodológica importante:** MT/MS/RO/PA usam **GTA** (intenção de abate, na origem) e GO/SP usariam **abate inspecionado SIF** (fato consumado, e só inspeção federal — subestima SP, que tem muito abate estadual/municipal). O *percentual* de fêmeas continua sendo bom proxy, mas o nível absoluto não é comparável. Se entrar na planilha, tem que vir rotulado como fonte diferente.

**Validador independente — IBGE/SIDRA tabela 1092** (API REST pública, sem auth): abate mensal por UF e por tipo de rebanho (bois, vacas, novilhos, novilhas), cobrindo inspeção federal + estadual + municipal. Atraso de 2,5 a 4,5 meses — serve para **auditar trimestralmente** a qualidade da coleta dos 4 estados, não para o dia a dia.
