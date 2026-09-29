import { UFS_GRAFICO, type UF } from "@/app/(painel)/painel/estados";

/**
 * Lê `?ufs=MT,MS,RO`. Ausente ou vazio = todos os estados visíveis, que é o
 * estado inicial dos chips e o que o export manual fotografa por padrão.
 * A ORDEM devolvida é a de `UFS_GRAFICO`, nunca a da URL: a cor segue o
 * estado, e a legenda tem de sair na mesma ordem de sempre.
 */
export function ufsDaBusca(bruto: string | undefined): UF[] | null {
  if (!bruto?.trim()) return [...UFS_GRAFICO];
  const pedidos = new Set(bruto.toUpperCase().split(",").map((u) => u.trim()).filter(Boolean));
  const ufs = UFS_GRAFICO.filter((uf) => pedidos.has(uf));
  // Um estado que não existe (ou está escondido) é erro de quem montou a URL,
  // não motivo para desenhar um recorte diferente do pedido em silêncio.
  if (ufs.length !== pedidos.size) return null;
  return ufs;
}
