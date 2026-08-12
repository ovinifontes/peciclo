# Gráfico de colunas + exportar como imagem — Plano

> **For agentic workers:** executar como uma task única, com os portões da casa.

**Goal:** a seção "Abate mensal por estado" ganha uma terceira visão (colunas) e um botão **Exportar** em cada visão, que baixa um PNG caprichado — para o dono/tio mandar por WhatsApp a um cliente idoso.

**Decisões já tomadas (não rediscutir):**

| Decisão | Escolha | Motivo |
|---|---|---|
| Rótulos do seletor | **Tabela · Linhas · Colunas** | mais claro que "Gráfico 1/2" para leigo e idoso; o dono deu liberdade |
| URL | `?ver=linhas` e `?ver=colunas` (`graficos` legado = `linhas`) | favoritável; não quebra link existente |
| Formato do export | **PNG 2x** (não PDF) | abre inline no WhatsApp; PDF exige abrir anexo |
| Biblioteca | `html-to-image` via **import dinâmico no clique** | pequena; nunca entra no bundle inicial |
| Visão Colunas | as MESMAS duas métricas das Linhas (total e % fêmeas), em barras agrupadas por estado | "o mesmo que o gráfico 1 mas em colunas" — pedido literal |
| Densidade das Colunas | limitar aos **últimos 12 meses fechados**, com nota | 4 estados × 18 meses = 72 barras ilegíveis; 12 meses mantém a leitura |
| Futuro (fora do escopo) | envio automático dos PNGs entre a 2ª planilha e o resumo | anotado; exigirá render no servidor — não desenhar agora |

## O que NÃO pode quebrar (regressões a verificar)

- Tabela default intacta; `?ver=graficos` antigo continua funcionando (vira Linhas)
- Filtro de estados e KPIs continuam valendo para Linhas E Colunas
- Regra de honestidade: mês corrente fora de gráficos e KPIs; PA com lacunas honestas (nas colunas, mês sem PA simplesmente não tem a barra do PA)
- First Load JS de `/login` idêntico; Recharts e html-to-image fora do bundle inicial (conferir chunks)
- 173 testes da raiz intocados

## Task única: implementação

**Files:**
- Modify: `web/src/app/(painel)/painel/explorador.tsx` (seletor de 3, botão Exportar, refs dos contêineres)
- Modify: `web/src/app/(painel)/painel/graficos-estados-recharts.tsx` (ganha os BarCharts OU novo módulo irmão — decidir pelo menor chunk; ambos dinâmicos)
- Modify: `web/src/app/(painel)/painel/page.tsx` (normalizar `ver`)
- Create: `web/src/app/(painel)/painel/exportar.ts` (função de captura: recebe o nó, aplica moldura de marca, baixa PNG)
- `web/package.json`: + `html-to-image` (pin exato)

**Steps:**

1. Seletor de 3 posições; estado `ver` normalizado (`graficos`→`linhas`; default tabela).
2. BarCharts agrupados (mesmas cores fixas de `estados.ts`, mesmo tooltip pt-BR, referência de 50% na de fêmeas, últimos 12 meses fechados + nota "últimos 12 meses — a visão Linhas mostra a série inteira").
3. `exportar.ts`: `exportarPng(no, titulo)` — import dinâmico de `html-to-image`, `toPng(no, { pixelRatio: 2, backgroundColor: "#ffffff" })`, download `peciclo-<visao>-<data>.png`. Durante a captura, o contêiner ganha (via classe) um cabeçalho de marca (mostrador + "Peciclo" + data) e um rodapé "peciclo.com.br" que NÃO aparecem na tela — elementos presentes no DOM com `hidden`, revelados só na captura (html-to-image clona o nó; usar o parâmetro `filter`/estilo no clone ou alternar classe antes/depois com try/finally).
4. Botão "Exportar imagem" discreto (canto da seção, estilo LINK da casa) nas três visões; estado "gerando…" enquanto captura; erro vira recado curto, nunca quebra a tela.
5. Portões: typegen, tsc, build, eslint no web; tsc raiz; vitest raiz (173). First Load `/login` byte a byte. Grep: `html-to-image` ausente dos chunks iniciais do painel (só no chunk assíncrono).
6. Teste real (HTTP + DOM): login curl; `?ver=colunas` renderiza barras (payload RSC com os 12 meses); `?ver=graficos` cai em Linhas; clique de Exportar — se o Chrome desta máquina cooperar via CDP, validar que o download dispara e o PNG tem cabeçalho de marca; senão, validar por unit da função de nome de arquivo + revisão manual do fluxo, e RELATAR o que não foi coberto.
7. Commit: `feat: visão de colunas e exportação em imagem por seção`.

## Riscos e mitigação

- **Fontes no PNG** (next/font + html-to-image): testar; se o clone perder a fonte, embutir `font-family` fallback no contêiner exportado — legibilidade > fidelidade tipográfica.
- **Captura em mobile** sai estreita: aceitável nesta fase (o tio exporta do computador); anotar como melhoria junto do envio automático.
- **iOS Safari** não baixa `download=` direto: fallback `window.open` do dataURL; anotar se não testável.
