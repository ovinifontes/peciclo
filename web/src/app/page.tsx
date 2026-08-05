import { redirect } from "next/navigation";

/**
 * A raiz não tem tela própria: quem chega em `/` vai para o painel. O layout
 * do cliente mora no route group `(painel)`, cujos parênteses não entram na
 * URL, então quem dá o endereço `/painel` é a pasta `(painel)/painel/`.
 */
export default function Raiz() {
  redirect("/painel");
}
