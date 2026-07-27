# Ciclo Pecuário — Referência do Projeto

> Documento de referência para não perder o contexto da conversa.
> Fonte: explicação do Vinicius em 2026-07-27, **validada por pesquisa** (Cepea, IBGE, Scot Consultoria, Rabobank, IEA-SP, Itaú BBA) — ver seção "Validação e complementos".

## O que é

Estudo de mercado que analisa, com base na oferta e na demanda, os preços na pecuária — que seguem um padrão cíclico.

## As fases do ciclo

1. **Preço alto do bezerro** — houve antes um aumento no abate de fêmeas, o que reduziu a produção de bezerros; menos oferta → preço sobe.
2. **Retenção de matrizes** — com bezerro caro, pecuaristas retêm fêmeas (abatem menos) para aumentar a produção de bezerros.
3. **Preço do boi gordo aumenta** — abatendo menos fêmeas, há menos carne no mercado.
4. **Produção de bezerros aumenta** — ocorre ~18 a 24 meses após a retenção das fêmeas.
5. **Preço baixo do bezerro** — a oferta de bezerros cresce até superar a demanda; preço cai.
6. **Venda de matrizes** — com bezerro barato, pecuaristas voltam a abater fêmeas.
7. **Preço do boi gordo diminui** — mais fêmeas/carne no mercado.
8. **Produção de bezerros diminui** — consequência do abate de matrizes.
9. **Reinicia o ciclo.**

**Indicador central acompanhado na planilha:** participação de fêmeas no abate (fêmeas ÷ total abatido). Alta participação = fase de descarte/venda de matrizes; queda = fase de retenção.

## Validação e complementos (pesquisa 2026-07-27)

A explicação acima está **correta** como modelo. Complementos que importam para o produto:

1. **As fases se sobrepõem** — a virada é gradual, não discreta. Em 2024–2025, preço alto do bezerro (+50% desde jul/2024) coexistiu com abate recorde de fêmeas (46,8% em 2025, IBGE) por mais de um ano. Um alerta automático não pode declarar "mudou de fase" por um único mês fora da média.
2. **Prazos:** os 18–24 meses valem para a oferta de *bezerros* (9 meses de gestação + 7–8 até a desmama). O efeito completo sobre a oferta de *boi gordo* leva 3–4 anos (IEA-SP).
3. **A demanda pesa tanto quanto a oferta** — sobretudo exportação (China, EUA). Em 2024–25 houve abate recorde *e* preço recorde ao mesmo tempo. Os passos 3 e 7 do modelo (preço da carne sobe/cai só pela oferta) são simplificações.
4. **Choques exógenos** alteram a duração: seca antecipa descarte de matrizes, custo de grãos, crédito e juros.
5. **Ganhos de produtividade** (IATF, confinamento, abate precoce) amortecem o ciclo e derrubam estruturalmente a relação de troca boi/bezerro → **ler indicadores contra a média histórica, nunca em nível absoluto**.

**Duração típica:** 6 a 8 anos o ciclo completo (fases de alta e baixa de ~3–4 anos cada).

**Fase atual (2025–2026):** 2025 fechou a fase de **descarte/liquidação** com participação recorde de fêmeas (46,8%) e abate total recorde (42,94 mi de cabeças). Analistas situam a virada entre o fim de 2025 e 2026, com **início da retenção de matrizes** — abate de fêmeas caiu 12,7% em jan/26 vs jan/25 e ~15% em abr/26 no SIF. Retenção projetada de forma escalonada até o início de 2028.

### Indicadores que o mercado usa

| Indicador | Leitura |
|---|---|
| **% de fêmeas no abate** (o da planilha) | Média histórica ~40–45%. Acima de ~45% sustentado = descarte/liquidação; caindo rumo a ~40% = retenção. Não há limiar oficial — lê-se o desvio versus a média e a direção da tendência. |
| **Relação de troca boi gordo/bezerro** (Cepea) | Quantos bezerros um boi gordo compra. Caiu de ~2,10 para ~1,80 em 2025 (sinal de virada). Em abr/26: 9,12 arrobas por animal de reposição. |
| **Ágio do bezerro sobre o boi gordo** | ~27% em SP no início de 2026 vs média histórica de ~14% desde 2001 = escassez de cria. |
| **Indicador do Bezerro Cepea/Esalq (MS)** | Bezerro subindo mais que o boi = assinatura da virada. |
| **Indicador do Boi Gordo Cepea/Esalq (SP)** | Referência da arroba. |
| **Volume total de abates** (IBGE trimestral, SIF mensal) | Queda de 7% no 1º tri/26 confirma menor oferta. |
| **Abate e preço da vaca gorda** | Mede diretamente a intensidade do descarte de matrizes. |

⚠️ **Implicação para o produto:** a planilha atual cobre apenas o lado do *abate* (metade do ciclo). As afirmações automáticas do tipo "tendência de início do ciclo de baixo preço do bezerro" dependem também dos **preços** (bezerro, boi gordo, relação de troca) — decidir se entram no escopo.

Fontes principais: [Scot Consultoria](https://www.scotconsultoria.com.br/noticias/entrevistas/2025/02/714/a-fase-do-ciclo-pecu%C3%A1rio-virou-uma-an%C3%A1lise-sobre-o-mercado-do-boi-e-perspectivas-para-a-reposi%C3%A7%C3%A3o) · [The AgriBiz](https://www.theagribiz.com/empresas/pecuaria/a-virada-do-ciclo-da-pecuaria-comecou-os-indicadores-dizem-sim/) · [IBGE](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/46124-producao-pecuaria-atinge-recordes-historicos-em-2025) · [IEA-SP](https://iea.agricultura.sp.gov.br/out/TerTexto.php?codTexto=13535) · [Cepea](https://www.cepea.org.br/br/diarias-de-mercado/boi-cepea-relacao-de-troca-de-boi-gordo-por-bezerro-aumenta-em-agosto.aspx)

## Fontes de dados (portais estaduais de GTA — Guia de Trânsito Animal)

Coleta feita hoje manualmente, **todos os dias**, pelo sócio.

### IAGRO (Mato Grosso do Sul)
- URL: https://www.servicos.iagro.ms.gov.br/docoficiais/documentodetransito
- Filtrar: espécie **BOVINO**, finalidade **ABATE**
- Baixa um `.xlsx`; separar quantidade **macho** e **fêmea**

### IDARON (Rondônia)
- URL: https://www.idaron.ro.gov.br/index.php/relatorios-e-formularios/
- Espécie: **BOVINO** · Finalidade: **ABATE** · Ano e mês: **atual**
- Coletar **macho** e **fêmea**

### INDEA / Sistemas FronteiraWeb (Mato Grosso)
- URL: https://sistemas.indea.mt.gov.br/FronteiraWeb/
- **Requer login** (⚠️ credencial fornecida pelo sócio — mover para `.env` na implementação; não commitar):
  - usuário: `77195531104` · senha: `77195531104`
- Menu **Relatório → GTA Condensado**: https://sistemas.indea.mt.gov.br/FronteiraWeb/exportar_gta_condensado_input.action
- Data inicial e final: **hoje e hoje**
- Exporta tudo; filtrar espécie **BOVINO**, finalidade **ABATE**, separado **macho/fêmea**

### ADEPARA (Pará)
- Site: https://www.adepara.pa.gov.br/ → link "GTAGRO" → https://www.adepara.pa.gov.br/node/313 (pasta no Google Drive)
- Entrar na pasta **"GTAs 2026 dados públicos"** e baixar apenas as planilhas ainda não baixadas
- Publicação é atrasada/desorganizada (ex.: em julho ainda não havia a planilha de junho)
- Filtrar: espécie **BOVINO**, finalidade **ABATE**, conferir ano/mês da planilha, pegar **macho** e **fêmea**

## A planilha atual

Arquivo de referência: [planilha-abate-2025-2026.csv](planilha-abate-2025-2026.csv) (export de "Planilha Abate para IA.xlsx").

Estrutura: linhas = mês/ano (jan/2025 → dez/2026); colunas = pares **Fêmea/Macho** por estado, na ordem: Mato Grosso, Mato Grosso do Sul, Rondônia, Pará, Goiás, São Paulo.

Observações sobre os dados:
- **Goiás e São Paulo estão vazios** — colunas existem mas nunca foram preenchidas (possível expansão futura; confirmar fonte de dados desses estados).
- **Pará sem nov/dez 2025** e com atraso recorrente (reflexo da publicação via Drive).
- Valor `186.830` (MS, fev/2025, fêmea) tem separador de milhar inconsistente com o resto — na implementação, normalizar.
- Pará jul/2025 (fêmea 86.612 < macho 138.294) destoa do padrão dos demais meses do PA (fêmea > macho) — verificar se houve inversão de colunas na coleta manual.

## O produto

**Fase 1 (foco atual):** automatizar a coleta diária nos 4 portais, preencher os dados, calcular os KPIs do ciclo e enviar o resultado pronto via WhatsApp (mantendo o fluxo que o sócio já tem com o fazendeiro).

**Fase 2 (futura):** SaaS high-ticket exclusivo — login criado manualmente para cada cliente (inicialmente: Vinicius, sócio e fazendeiro, todos vendo o mesmo conteúdo), dashboard com as informações da planilha bem apresentadas, IA integrada para perguntas e afirmações diárias automáticas do tipo "alta tendência de início do ciclo de baixo preço do bezerro".
