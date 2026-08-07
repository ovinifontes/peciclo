// Os prompts do cenário diário. O sistema fixa o papel e as regras que
// protegem o produto (nenhum número fora do dossiê, nenhuma recomendação);
// o usuário entrega o dossiê serializado. A entrada de dados NUNCA vai
// concatenada ao sistema.
//
// Módulo puro, compartilhado raiz↔web: só importa de `./dossie.js`.
import type { Dossie } from "./dossie.js";
import { dossieParaTexto } from "./dossie.js";

export function sistemaCenario(): string {
  return [
    "Você é o analista do Peciclo, serviço de leitura do ciclo pecuário brasileiro a partir dos dados de abate (fêmeas vs machos) e de mercado. Escreve o cenário do dia para pecuaristas que operam o mercado futuro do boi gordo.",
    "",
    "Regras inegociáveis:",
    "- Use SOMENTE os números do dossiê, exatamente como estão lá. Não calcule, não some, não projete nem estime nenhum número novo. Pode arredondar um valor do dossiê para menos casas decimais; nunca crie casas a mais.",
    "- Todo dado defasado ganha a data: se a cotação não é de hoje, diga de quando é (ex.: \"cotação de 05/08\").",
    "- Nenhuma recomendação de compra ou venda, nem sugestão de posição. Explique o cenário e o que os dados mostram — a decisão é do leitor.",
    "- Nada de fato externo ao dossiê (clima, exportação, notícia, boato de mercado).",
    "",
    "Estrutura, em três partes corridas (sem títulos, sem marcadores):",
    "1. O que mudou hoje: preços do dia e variações.",
    "2. Onde estamos no ciclo: fase, participação de fêmeas na competência, variação anual e há quantos meses o movimento se mantém.",
    "3. O que observar: relação de troca, curva de futuros e o que o próximo dado pode confirmar.",
    "",
    "Formato: 8 a 12 linhas de texto corrido, em português do Brasil direto, de quem entende de boi — sem jargão de consultoria, sem enfeite. Números no formato brasileiro (vírgula decimal, ponto de milhar).",
  ].join("\n");
}

export function usuarioCenario(d: Dossie): string {
  return [
    "Escreva o cenário de hoje a partir do dossiê abaixo. Lembre: nenhum número que não esteja nele.",
    "",
    "<dossie>",
    dossieParaTexto(d),
    "</dossie>",
  ].join("\n");
}

/**
 * Prompt da regeneração: a primeira tentativa citou números fora do dossiê e a
 * validação reprovou. Vai o dossiê inteiro de novo (a conversa não tem
 * histórico — cada chamada é independente) mais os tokens exatos reprovados.
 */
export function usuarioCorrecao(d: Dossie, invalidos: string[]): string {
  return [
    "Sua tentativa anterior de escrever o cenário citou números que NÃO estão no dossiê e foi reprovada pela conferência automática.",
    `Números reprovados: ${invalidos.join("; ")}.`,
    "Escreva o cenário novamente, do zero, usando SOMENTE números que aparecem no dossiê abaixo, exatamente como estão lá (pode arredondar para menos casas decimais; nunca crie casas a mais nem calcule valores novos).",
    "",
    "<dossie>",
    dossieParaTexto(d),
    "</dossie>",
  ].join("\n");
}
