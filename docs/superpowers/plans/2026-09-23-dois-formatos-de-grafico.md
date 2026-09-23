# Dois formatos novos de gráfico + seletor mais evidente

Data: 23/09/2026

## O que se quer

1. Dois formatos novos além de Tabela | Linhas | Colunas: **Área empilhada** e
   **Barras 100%**, nos dois cartões (diário e mensal).
2. O seletor de formato **centralizado no topo** de cada cartão, mais evidente
   — hoje ele mora no canto direito e passa despercebido.
3. Título ("Abate diário por estado" / "Abate mensal por estado") com fonte
   maior, acima do seletor.
4. "Exportar imagem" vira botão de verdade, no mesmo lugar.
5. Os formatos novos precisam exportar imagem como os atuais.
6. **90% dos acessos são por celular.** Isso decide o desenho, não é enfeite.

## Decisões já tomadas

- Os dois gráficos empilham **macho e fêmea**, somando os estados selecionados.
- No celular o seletor fica em **duas linhas centralizadas** (3 + 2), tudo
  visível de uma vez. Rolagem horizontal foi descartada: quem não desliza nunca
  descobre os dois últimos, que é o oposto do pedido.

## Decisões que este plano toma, e por quê

**Somar os estados em vez de um empilhamento por estado.** Com 3 estados
selecionados, empilhar estado × sexo daria 6 faixas — ilegível em 360px. Somar
mantém 2 faixas. Os chips de estado continuam funcionando: eles passam a
escolher *o que entra na soma*, e o gráfico diz isso em texto, porque um
usuário que não perceba vai ler o total errado.

**Área e 100% desenham UMA seção, não duas.** Linhas e Colunas hoje desenham
duas (cabeças e % de fêmeas) com o mesmo componente. A Área já mostra volume e
composição na mesma figura; a 100% mostra só composição. Repetir a seção de %
embaixo da 100% seria dizer duas vezes a mesma coisa.

**Unificar o seletor antes de estendê-lo.** `ROTULO_VER` está escrito em dois
arquivos e a rota `/impressao-diario/[visao]` valida a mesma lista por fora.
Acrescentar duas opções sem unificar são três lugares para editar e um para
esquecer — e o esquecido quebra a imagem do WhatsApp, em silêncio, só no dia
seguinte de manhã.

## Fora de escopo, de propósito

- **O envio automático das 6h52 continua mandando 3 imagens**, não 5. Cinco
  imagens por dia no WhatsApp de um cliente é spam. A rota de impressão vai
  *aceitar* os formatos novos (para o export manual funcionar), mas a lista do
  robô não muda sem você pedir.
- Nenhuma mudança na coleta, no banco ou nas planilhas.

---

## Tarefas

### T1 — Unificar o contrato das visões

Files: `web/src/app/(painel)/painel/visoes.ts` (novo),
`web/src/app/(painel)/painel/explorador.tsx`,
`web/src/app/(painel)/painel/explorador-diario.tsx`,
`web/src/app/(impressao)/impressao-diario/[visao]/page.tsx`
Depends-on: —

Um módulo só com: o tipo `Ver` (5 valores), `ROTULO_VER`, a ordem de exibição e
`VISOES_COM_DUAS_SECOES`. Os três consumidores passam a importar dali.

Verificação: `grep -c "ROTULO_VER: Record" web/src` devolve `1`.

### T2 — Cores de sexo que passam no validador

Files: `web/src/app/(painel)/painel/estados.ts`
Depends-on: —

`COR_UF` é por estado; os gráficos novos precisam de duas cores por **sexo**.
Derivar da paleta da casa e rodar o validador da skill `dataviz` (o mesmo que
aprovou `COR_UF`): contraste entre as duas faixas e legibilidade sob
daltonismo. Fêmea e macho lado a lado numa barra empilhada é o par mais crítico
do site — se não separarem, o gráfico mente.

Verificação: validador da skill dataviz aprova o par (ΔE ≥ 8 sob daltonismo).

### T3 — Construtor de série por sexo

Files: `web/src/app/(painel)/painel/serie-sexo.ts` (novo),
`tests/painel/serie-sexo.test.ts` (novo)
Depends-on: —

Função que recebe a série crua e os estados ativos e devolve
`{ competencia, femeas, machos }` por mês/dia, somando os estados. Tem de
respeitar as mesmas regras dos gráficos atuais: mês corrente fora, mês sem dado
nos estados selecionados fora.

Verificação: teste cobrindo (a) soma de dois estados, (b) mês corrente
excluído, (c) estado sem dado no mês não zera o mês dos outros.

### T4 — Os dois componentes de gráfico

Files: `web/src/app/(painel)/painel/area-sexo-recharts.tsx` (novo),
`web/src/app/(painel)/painel/cem-por-cento-recharts.tsx` (novo)
Depends-on: T2, T3

Recharts, carregados por `dynamic` com `ssr: false`, como os atuais. Altura
280px. Rótulos e tooltip em português, número no formato pt-BR.

No celular: eixo X com menos marcas (um a cada 2 ou 3 meses), sem rótulo
rotacionado — rótulo em pé em 360px vira borrão.

Verificação: `npm run build` no `web/` passa e as duas visões renderizam com 1
estado e com 3.

### T5 — Ligar as visões nos dois exploradores

Files: `web/src/app/(painel)/painel/explorador.tsx`,
`web/src/app/(painel)/painel/explorador-diario.tsx`
Depends-on: T1, T4

Acrescentar as duas opções ao seletor e ao roteamento de `?ver=` / `?verDiario=`.
`SecoesGrafico` passa a decidir 1 ou 2 seções pela visão (T1).

O cartão de exportação já renderiza o mesmo componente — a exportação das
visões novas sai de graça, desde que o cartão use a mesma lógica de seções.

Verificação: abrir `?ver=area` e `?ver=cemPorCento` e conferir que o botão
correspondente aparece marcado; clicar em Exportar imagem nas cinco visões e
receber cinco PNGs diferentes.

### T6 — Cabeçalho: título maior, seletor centralizado, botão de exportar

Files: `web/src/app/(painel)/painel/explorador.tsx`,
`web/src/app/(painel)/painel/explorador-diario.tsx`,
`web/src/app/(painel)/painel/page.tsx`
Depends-on: T5

Ordem no cartão: título (fonte maior) → seletor centralizado → texto
explicativo → conteúdo. "Exportar imagem" vira botão secundário, com borda,
seguindo o desenho do site; continua onde está.

Celular: seletor em duas linhas centralizadas (3 + 2), alvo de toque mínimo de
44px de altura. Desktop: uma linha só.

Verificação: medir em 360px e 390px de largura — nenhum corte, nenhuma rolagem
horizontal, todos os cinco botões visíveis sem gesto.

### T7 — Rota de impressão aceita as visões novas

Files: `web/src/app/(impressao)/impressao-diario/[visao]/page.tsx`,
`web/src/app/(impressao)/impressao-diario/[visao]/cartao-impressao.tsx`
Depends-on: T1, T5

`[visao]` passa a aceitar os cinco valores. A lista que o robô das 6h52 envia
**não muda** (continua tabela/linhas/colunas).

Verificação: abrir `/impressao-diario/area` logado e ver o cartão montado;
`enviar-diario-imagens` continua com 3 visões.

### T8 — Revisão final

Files: —
Depends-on: T6, T7

`npm test`, `npm run typecheck` na raiz, `npx tsc --noEmit` e `npm run build`
no `web/`. Conferir no celular de verdade, não só no simulador.

---

## Ondas

- Onda 1 (paralelas, arquivos disjuntos): T1, T2, T3
- Onda 2: T4
- Onda 3: T5
- Onda 4: T6, T7
- Onda 5: T8

## Risco conhecido

O cartão de exportação tem largura fixa de 1080px e leiaute de desktop. Os
gráficos novos precisam ficar bons **nas duas** larguras: 360px na tela e
1080px no PNG. É o mesmo problema que já existe hoje, mas barra empilhada com
muitos meses sofre mais que linha — se ficar apertado, a saída é a mesma das
Colunas: cortar a janela para os últimos 12 meses no PNG.
