// Tipos mínimos para o pdf-parse 1.1.1, que não publica os seus.
//
// A importação é de "pdf-parse/lib/pdf-parse.js" DE PROPÓSITO: o index do
// pacote tem um "modo debug" que dispara quando `module.parent` é falso — o
// caso de todo import ESM de CJS — e aí ele tenta ler um PDF de teste do
// próprio pacote e quebra. O módulo interno é a função pura, sem essa mina.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface ItemPdfJs {
    str: string;
    /** Matriz do pdf.js: [a, b, c, d, x, y]. */
    transform: [number, number, number, number, number, number];
  }
  interface PaginaPdfJs {
    getTextContent(): Promise<{ items: ItemPdfJs[] }>;
  }
  interface OpcoesPdfParse {
    /** Chamado por página; o retorno vira o `text` (irrelevante quando se coleta os itens). */
    pagerender?: (pageData: PaginaPdfJs) => Promise<string>;
    max?: number;
  }
  function pdfParse(
    buffer: Buffer,
    opcoes?: OpcoesPdfParse,
  ): Promise<{ text: string; numpages: number }>;
  export default pdfParse;
}
