# Automação da coleta de abate bovino para análise do ciclo pecuário

**Data:** 2026-07-27
**Status:** aprovado (fase 1)

## Contexto

Um pecuarista acompanha o ciclo pecuário através de uma planilha de abate mensal de bovinos, separado por sexo, em quatro estados: Mato Grosso, Mato Grosso do Sul, Rondônia e Pará. Hoje um sócio alimenta essa planilha **manualmente, todos os dias**, entrando em quatro portais estaduais de defesa agropecuária, baixando arquivos, filtrando por espécie e finalidade, e copiando os totais. Depois envia a planilha pronta pelo WhatsApp.

O trabalho é inteiramente mecânico e diário. Esta fase automatiza a coleta, o cálculo e o envio, preservando o formato que o fazendeiro já conhece.

Referências de domínio: [ciclo pecuário](../../../referencias/ciclo-pecuario.md) e [reconhecimento técnico dos portais](../../../referencias/portais-recon.md).

## Escopo

**Nesta fase:**
- Coleta diária automatizada nos quatro portais (MT, MS, RO, PA)
- Armazenamento com histórico e auditoria
- Geração da planilha no layout atual, com uma aba adicional de KPIs
- Envio diário pelo WhatsApp via Evolution API
- Alerta técnico ao operador quando algo falha

**Fora desta fase (registrado para depois):**
- Goiás e São Paulo — só após a fase 2, via CSV do MAPA/SIGSIF (não existe fonte estadual pública equivalente; ver [recon](../../../referencias/portais-recon.md))
- Preços do Cepea (bezerro, boi gordo, relação de troca) — necessários para as afirmações de fase do ciclo na fase 2
- Dashboard web, autenticação, IA conversacional — fase 2
- Auditoria trimestral contra o IBGE/SIDRA

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Granularidade do banco | Linha por GTA, sexo e faixa etária | O arquivo já é baixado inteiro; guardar o detalhe custa quase nada e destrava a fase 2 sem re-raspar |
| Espécie | Somente bovino | Único relevante ao ciclo |
| Finalidade — entrega | Somente `ABATE` | O que o fazendeiro usa hoje e o que sustenta o indicador |
| Finalidade — armazenamento | Todas (engorda, reprodução, etc.) | Engorda é indicador antecedente do abate futuro; custo marginal zero |
| `ABATE SANITÁRIO` (PA) | Excluído do indicador, armazenado | É abate por determinação sanitária, não decisão econômica — poluiria o sinal do ciclo |
| Linguagem | TypeScript | Trigger.dev é nativo em TS e a fase 2 é um app web; um stack só |
| Entregável | `.xlsx` no layout atual + aba de KPIs | Zero mudança de hábito para o fazendeiro |
| Cadência | Coleta diária, envio diário | Mantém o ritmo atual |
| Credencial do INDEA | Conta do sócio, 1 login/dia | Autorizada; mesma conta que ele já usa manualmente |
| Plano do Supabase | Pro (já contratado) | Volume medido de ~3,1 GB/ano (1,9 de dados + 1,2 de índices) excede o gratuito; os 8 GB do Pro dão ~2,5 anos de folga |

## Arquitetura

```
06:00  coleta-diaria  ──┬── coletor MS  ─┐
                        ├── coletor MT  ─┤  baixa → arquiva bruto no Storage
                        ├── coletor RO  ─┤  → valida → parseia → grava → registra execução
                        └── coletor PA  ─┘
06:20  gerar-planilha   lê abate_mensal → escreve .xlsx (2 abas)
06:25  enviar-planilha  Evolution API envia o documento
                        + alerta ao operador se algum coletor falhou

semanal: rejanela      reprocessa os últimos 10 dias de MT e MS
semanal: verificar-fontes  reconfirma o link do Power BI (RO) e o ID da pasta do Drive (PA)
```

**Componentes:**

- **Coletores** (`src/coletores/{ms,mt,ro,pa}.ts`) — cada um implementa a mesma interface: recebe uma janela de datas, devolve registros normalizados. Não conhecem banco nem planilha. Testáveis isoladamente contra arquivos salvos.
- **Repositório** (`src/dados/`) — grava registros, faz o rollup mensal, registra execuções. Única camada que fala com o Supabase.
- **Gerador de planilha** (`src/planilha/`) — lê `abate_mensal`, escreve o `.xlsx`. Não sabe de onde os dados vieram.
- **Notificador** (`src/notificacao/`) — envia pela Evolution. Não sabe o que está enviando.
- **Tasks do Trigger.dev** (`src/trigger/`) — orquestram os componentes acima e nada mais.

Os coletores rodam em paralelo e isolados: a falha de um não impede os outros nem o envio.

## Modelo de dados

### `gta_registros` — o detalhe

Uma linha por GTA, sexo e faixa etária.

Campos: `uf`, `documento_tipo`, `documento_numero`, `documento_serie`, `data_emissao`, `finalidade`, `sexo`, `faixa_etaria`, `quantidade`, `municipio_origem`, `municipio_destino`, `uf_destino`, `coleta_id`, `criado_em`.

Chave natural única: `(uf, documento_numero, documento_serie, sexo, faixa_etaria)` — permite `upsert` no reprocessamento sem duplicar.

Índices: `(uf, data_emissao, finalidade)` para os rollups.

Aplica-se apenas a MS e PA (os únicos que publicam detalhe por GTA). MT e RO são agregados por competência e gravam direto em `abate_mensal`.

### `abate_mensal` — a tabela canônica

Chave primária: `(uf, ano, mes, finalidade, sexo)`. Campos: `quantidade`, `fonte`, `coleta_id`, `atualizado_em`.

A finalidade faz parte da chave para que o rollup de engorda e reprodução conviva com o de abate sem sobrescrevê-lo. O gerador de planilha filtra `finalidade = 'ABATE'`; as demais ficam disponíveis para a fase 2.

Valores de `fonte`: `gta_agregada` (MS e PA — calculada de `gta_registros`), `gta_condensada` (MT — o relatório GTA Condensado do INDEA já vem somado por mês), `powerbi` (RO — número direto do relatório, disponível apenas para `ABATE`), `manual` (semente histórica da planilha do sócio).

O gerador de planilha lê **apenas esta tabela**, e por isso não precisa saber que os portais têm granularidades diferentes.

### `coletas` — auditoria

Campos: `uf`, `tipo` (`diaria` | `rejanela` | `mensal`), `janela_inicio`, `janela_fim`, `status` (`ok` | `falha` | `sem_dados`), `arquivo_path` (Supabase Storage), `arquivo_hash`, `linhas_afetadas`, `erro`, `iniciado_em`, `concluido_em`.

Responde "por que o número do MT mudou ontem?" sem adivinhação.

**RLS:** habilitada em todas as tabelas, sem policies públicas nesta fase — acesso apenas pela `service_role` dos jobs. A fase 2 adiciona as policies de leitura por usuário.

### Semente histórica

Importar a planilha atual (jan/2025 a jun/2026) como `abate_mensal` com `fonte = manual`, aplicando duas correções confirmadas com o sócio:

- **PA, jul/2025:** colunas invertidas na cópia manual. A planilha traz fêmea = 86.612 e macho = 138.294; corrigir para fêmea = 138.294 e macho = 86.612, restaurando o padrão de todos os outros meses do estado.
- **MS, fev/2025:** a célula está gravada como texto `"186.830"` em vez de número, ao contrário de todas as outras. O valor correto é o inteiro `186830`.

## Os coletores

### MS — IAGRO 🟢

Endpoint anônimo, verificado e funcionando:

```
GET https://api.ms.gov.br/api-esaniagro/v1/relatorio/DocumentosDeTransitoRel
    ?especieAnimalID=1&periodoInicial=<ISO>&periodoFinal=<ISO>
    &municipioIDOrigem=&municipioIDDestino=&municipioUFDestino=&finalidadeID=
```

Sem token, sem cookie, sem browser. `especieAnimalID=1` é BOVINO.

- **Não** enviar `finalidadeID` — o lookup de IDs exige token, e filtrar pela coluna localmente traz as outras finalidades de graça.
- Localizar o cabeçalho pela string `"Tipo de Documento"`, nunca por índice fixo de linha (está na linha 19 hoje).
- **Há células mescladas**, então rótulos se repetem em colunas vizinhas: montar o mapa de colunas pela **primeira ocorrência** de cada rótulo.
- A coluna vem escrita **`Total Femêa`** (typo no arquivo original).
- `Data Emissão` chega como **serial numérico do Excel** na leitura por streaming (epoch 1899-12-30) — converter manualmente e extrair a data com **getters UTC**. Com getters locais, uma GTA emitida à meia-noite cai no dia anterior e, na virada do mês, no mês errado.
- Desnormalizar as 8 colunas de faixa etária em linhas por `(sexo, faixa)`. Verificado: a soma das faixas bate exatamente com `Total Femêa` e `Total Macho`.
- O arquivo contém finalidades com **texto corrompido** na origem (uma linha traz `AGLOMERA<?>ÃO SEM FINALIDADE COMERCIAL`). Como o filtro é por igualdade exata com `ABATE`, isso não afeta o indicador — mas não normalizar nem "consertar" acentos, para não criar falsos positivos.

Amostra verificada (20 a 26/07/2026, bovino, finalidade ABATE): fêmea 29.991, macho 30.644.

### MT — INDEA 🟡

Java/Struts2 com login, atrás de WAF F5. **Mapeado em sessão autenticada (28/07/2026); os fatos abaixo são observados, não inferidos.**

1. `GET /FronteiraWeb/` — semeia cookies (JSESSIONID + BIG-IP + WAF)
2. `POST /FronteiraWeb/Login.action` com `usuario=<CPF>` e `senha=<senha>` (form clássico, sem captcha nem CSRF)
3. `POST /FronteiraWeb/exportar_gta_condensado.action` com **multipart/form-data**, campos `dataIni` e `dataFim` no formato `dd/MM/yyyy`
4. Filtrar bovino + abate, somar por sexo

Se a resposta for a tela de login (HTML em vez de XLSX), a sessão caiu: tratar como falha e realertar.

**Correção importante ao modelo de dados — o MT é agregado, não detalhe.** O relatório se chama "GTA **Condensado**" e é exatamente isso: já vem somado. Colunas: `UF ORIGEM | MUNICÍPIO ORIGEM | UF DESTINO | MUNICÍPIO DESTINO | MÊS | ESPÉCIE | FINALIDADE | FAIXA ETÁRIA | SEXO | QNT`. **Não há número de GTA, série nem data de emissão** — só o mês (`MM/YYYY`) e a quantidade já agregada.

Consequências:
- O MT **não entra em `gta_registros`** (não há chave de GTA). Grava direto em `abate_mensal`, como o RO, com **`fonte = 'gta_condensada'`**.
- Verificado que uma consulta por intervalo **soma o intervalo inteiro** (dia 20 + dia 21 = intervalo 20–21, exato). Então a coleta diária consulta do 1º dia do mês até hoje e sobrescreve o total do mês — reconsultar captura GTAs atrasadas sem rejanela separada.
- `SEXO` vem como `M`/`F` (e `A` sem sexo, ignorado). `FINALIDADE` tem `ABATE` exato e também `RETORNO DE ABATEDOURO` — igualdade exata, nunca prefixo.
- O arquivo é XLSX (UTF-8 interno); o `ISO-8859-1` do content-type HTTP é irrelevante — **não precisa de decode**.
- A riqueza por município/faixa fica preservada no arquivo bruto arquivado, para a fase 2 se necessário.

**Validação (arquivo real de 20/07/2026):** bovino + abate = fêmea 11.365, macho 14.930.

**Limites:** 1 login por dia, User-Agent identificável, sem paralelismo — é um portal público de governo atrás de WAF.

### RO — IDARON 🔴

O dado vem de um relatório **Power BI publish-to-web**, sem login.

Estratégia em dois papéis:
- **Descoberta (uma vez):** browser headless abre o relatório, aciona os filtros de espécie/finalidade/mês, e intercepta o `POST .../public/reports/querydata?synchronous=true`. O corpo dessa requisição (`SemanticQuery`) é salvo.
- **Produção (diário):** repetir esse POST por HTTP puro com o header `X-PowerBI-ResourceKey`, trocando ano e mês. Sem browser.
- **Fallback:** se o POST direto falhar, cair para o browser headless.

O parse da resposta é do formato DSR do Power BI (dicionários de valores com deltas) — precisa ser desenvolvido contra respostas reais salvas.

**Verificação semanal:** re-raspar https://www.idaron.ro.gov.br/index.php/relatorios-e-formularios/ para reextrair o parâmetro `r=`. Se o IDARON republicar o relatório, a chave muda e a coleta pararia silenciosamente.

Granularidade mensal: escreve direto em `abate_mensal` com `fonte = powerbi`. A cadência de atualização do dataset é desconhecida — registrar o valor observado a cada dia permite detectar quando ele muda.

### PA — ADEPARA 🟢

Vigia de pasta pública no Google Drive.

- Listar a subpasta do ano via **Drive API v3 com API key** (o parse do HTML funciona mas é frágil e pagina a cada ~50 itens).
- Comparar `(nome, id, modifiedTime, md5Checksum)` com o registrado em `coletas`; baixar apenas o novo ou alterado via `https://drive.google.com/uc?export=download&id=<fileId>` (~16 MB por mês).
- **Não assumir ordem nem continuidade**: o Pará publica com cerca de dois meses de atraso e fora de sequência. Em 27/07/2026 o último mês disponível era maio (publicado em 23/06, ~23 dias após o fim do mês).
- Detectar a subpasta do ano novo (`GTAs 2027 dados públicos`) na virada.

**Formato do arquivo (verificado no arquivo real de maio/2026):** a planilha é **wide**, não long. São 60.936 linhas (1 cabeçalho + 60.935 dados) e 65 colunas, com **uma linha por GTA** (`gta_numero` é único).

- A coluna `taxonomia` contém **apenas a espécie** (`"BOVINO"`), não sexo nem idade.
- Sexo e faixa etária são **nomes de coluna**: 48 colunas de categoria no formato `ESPÉCIE, SEXO, FAIXA` (ex.: `BOVINO, FÊMEA, ACIMA DE 36 MESES`), cada uma com a quantidade de animais daquela categoria, zero quando não se aplica.
- Portanto, para separar macho de fêmea somam-se as **4 colunas MACHO** e as **4 colunas FÊMEA** de bovino — não se lê `taxonomia`.
- Não há células mescladas. Cabeçalho na linha 1.

**Filtro de finalidade — igualdade exata, nunca prefixo.** O arquivo tem `ABATE` (20.905 linhas), `ABATE SANITÁRIO` (3) e também `SACRIFÍCIO` (1). Um filtro por prefixo `ABATE%` incluiria o sanitário; ambos ficam armazenados mas fora do indicador.

Roda diariamente, mas quase todo dia não faz nada — é o comportamento esperado, não uma falha.

### Validação de ponta a ponta (confirmada)

Aplicando a regra acima ao arquivo real de maio/2026 (`finalidade = 'ABATE'` exato, espécie bovina, somando as colunas de categoria por sexo), o resultado é **fêmea 188.406 e macho 152.453** — **idêntico** ao que o sócio tem na planilha dele para PA/maio/2026.

Isso é a evidência mais forte que temos de que a automação reproduz o trabalho manual sem desvio, e vira o teste de aceitação do coletor do Pará.

## Planilha e envio

**Geração:** a planilha é escrita do zero a cada execução a partir de `abate_mensal`, nunca editada em cima da anterior.

- **Aba 1 — dados:** layout idêntico ao atual. Linhas de mês/ano, colunas em pares Fêmea/Macho na ordem MT, MS, RO, PA, GO, SP. Goiás e São Paulo permanecem vazios, preservando o formato.
- **Aba 2 — ciclo:** participação de fêmeas no abate por estado e consolidada, variação contra o mês anterior e contra o mesmo mês do ano anterior, e média móvel de 12 meses. A leitura é sempre relativa à média histórica, nunca ao nível absoluto — ganhos de produtividade deslocam os patamares ao longo do tempo.

Cada versão enviada é arquivada no Storage.

**Envio:** documento via Evolution API com legenda curta. Destinatários configurados fora do código.

**Comportamento em falha parcial:** a planilha é enviada com os dados disponíveis; o alerta técnico vai apenas para o operador. O fazendeiro nunca recebe mensagem de erro.

## Confiabilidade

**O arquivo bruto é sagrado.** Todo download é arquivado no Storage com hash antes de qualquer parse. Um parser com bug pode ser corrigido e reexecutado sobre dois anos de histórico sem tocar nos portais — o que importa porque eles não mantêm histórico acessível indefinidamente.

**Validação antes de gravar.** Cada coletor confere que a resposta é do tipo esperado (content-type, assinatura do arquivo, cabeçalho, período coincidindo com o solicitado). Uma página de erro ou tela de login nunca deve entrar no banco como se fosse dado — é falha, não zero.

**Rejanela semanal.** MT e MS são reprocessados nos últimos 10 dias porque GTAs são emitidas e lançadas com atraso: o total de ontem muda depois de ontem. Sem isso o total do mês fica sistematicamente subestimado — um erro que a coleta manual atual provavelmente já comete.

**Detecção de anomalia.** Variação muito fora do padrão histórico gera alerta ao operador, sem bloquear o envio.

**Retentativas.** Delegadas ao Trigger.dev, com backoff exponencial.

## Testes

- **Parsers:** cada um testado contra arquivos reais salvos como fixtures, nunca contra o portal ao vivo.
- **Gerador de planilha:** deve reproduzir a planilha atual do sócio, número por número, a partir da semente histórica.
- **Idempotência:** executar a mesma coleta duas vezes não duplica linhas nem altera totais.
- **Falha parcial:** com um coletor derrubado artificialmente, a planilha ainda é gerada e enviada, e o alerta é disparado.

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| INDEA muda o layout do export ou endurece o WAF | Arquivo bruto arquivado permite diagnóstico; fallback para browser headless |
| IDARON republica o relatório e invalida a resource key | Verificação semanal do link na página de origem |
| ADEPARA reorganiza a pasta ou muda o ID | Reconfirmação semanal do ID a partir da página node/313 |
| Google aplica quota de download no Drive | Baixar apenas deltas, cache local |
| Parsers quebram com mudança de layout | Validação de cabeçalho falha alto em vez de gravar lixo |
| Dataset do Power BI atualiza em cadência desconhecida | Registrar o valor observado diariamente para detectar mudanças |
| Credencial do INDEA expira ou é trocada | Alerta imediato ao operador; coleta dos outros estados segue |
