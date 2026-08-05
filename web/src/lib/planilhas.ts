import "server-only";

import { criarClienteAdmin } from "@/lib/admin-db";
import { exigirClienteAtivo } from "@/lib/dal";

/**
 * As planilhas que o robô envia por WhatsApp já são arquivadas no Storage a
 * cada rodada. Este módulo as devolve para o painel.
 *
 * O bucket é PRIVADO e não tem política de Storage para `authenticated`, então
 * a leitura passa pela chave secreta (`admin-db.ts`). Como essa chave ignora o
 * RLS, cada função exportada aqui reverifica o acesso na PRIMEIRA linha: um
 * Route Handler é uma requisição direta e o layout do painel não protege.
 */
const BUCKET = "peciclo_brutos";

export interface Pasta {
  /** Prefixo real dentro do bucket, conferido no Storage em 05/08/2026. */
  prefixo: string;
  titulo: string;
  descricao: string;
}

/**
 * As duas rotinas que geram planilha, com o prefixo que cada uma usa:
 * `planilhas/` vem de `gerar-e-enviar` (06:00) e `planilhas-completa/` de
 * `coleta-experimental` (06:30). O bucket também tem `planilhas-experimental/`,
 * `mt/`, `ms/` e `pa/` — nome antigo da rotina das 06:30 e os arquivos crus dos
 * portais. Nada disso é entregável ao cliente, então não entra nesta lista.
 */
export const PASTAS: Pasta[] = [
  {
    prefixo: "planilhas",
    titulo: "Planilha diária",
    descricao: "A mesma que sai por WhatsApp às 06:00: abate mensal por estado e sexo.",
  },
  {
    prefixo: "planilhas-completa",
    titulo: "Planilha completa",
    descricao: "A das 06:30, com Goiás e São Paulo, preços do CEPEA e futuros da B3.",
  },
];

export interface Planilha {
  /** Chave completa no bucket, ex.: `planilhas/abate-ciclo-pecuario-2026-08-05.xlsx`. */
  chave: string;
  nome: string;
  /** Tamanho em bytes, quando o Storage informa. */
  tamanho: number | null;
  /** ISO da última gravação, quando o Storage informa. */
  atualizadoEm: string | null;
}

/**
 * Só estes prefixos, e o nome do arquivo sem "/" nem caractere exótico. É o
 * que impede alguém logado de pedir `?arquivo=pa/qualquer-coisa.xlsx` — ou
 * de escapar da pasta com `..` — e receber um arquivo que não é dele.
 */
function ehChavePermitida(chave: string): boolean {
  const barra = chave.indexOf("/");
  if (barra < 0) return false;

  const prefixo = chave.slice(0, barra);
  const nome = chave.slice(barra + 1);
  if (!PASTAS.some((p) => p.prefixo === prefixo)) return false;
  if (nome.includes("..")) return false;
  return /^[A-Za-z0-9._-]+\.xlsx$/.test(nome);
}

/**
 * Arquivos de uma pasta, do mais recente para o mais antigo. O nome carrega a
 * data (`abate-ciclo-pecuario-2026-08-05.xlsx`), então ordenar por nome
 * decrescente é ordenar por data decrescente.
 */
export async function listarPlanilhas(prefixo: string): Promise<Planilha[]> {
  await exigirClienteAtivo();

  const admin = criarClienteAdmin();
  const { data, error } = await admin.storage.from(BUCKET).list(prefixo, {
    // Uma planilha por dia: 180 cobre meio ano de histórico numa tela só.
    limit: 180,
    sortBy: { column: "name", order: "desc" },
  });

  if (error) throw new Error(`Falha ao listar ${prefixo}: ${error.message}`);

  return (data ?? [])
    // O `list` devolve subpastas e o `.emptyFolderPlaceholder` misturados com
    // os arquivos; filtrar pela extensão deixa só o que é planilha de verdade.
    .filter((item) => item.name.endsWith(".xlsx"))
    .map((item) => ({
      chave: `${prefixo}/${item.name}`,
      nome: item.name,
      tamanho: typeof item.metadata?.size === "number" ? item.metadata.size : null,
      atualizadoEm: item.updated_at ?? item.created_at ?? null,
    }));
}

export interface ArquivoBaixado {
  nome: string;
  conteudo: ArrayBuffer;
}

/**
 * Baixa uma planilha e devolve os bytes, ou `null` se a chave não for
 * permitida ou o arquivo não existir.
 *
 * Os bytes passam pelo servidor de propósito, em vez de o painel redirecionar
 * para uma URL assinada: assim o endereço do bucket nunca chega ao navegador
 * e não há link que continue valendo depois. O custo é irrelevante no tamanho
 * real destes arquivos — 17 KB a 105 KB em 05/08/2026, duas ordens de grandeza
 * abaixo do limite de resposta da Vercel.
 */
export async function baixarPlanilha(chave: string): Promise<ArquivoBaixado | null> {
  await exigirClienteAtivo();

  if (!ehChavePermitida(chave)) return null;

  const admin = criarClienteAdmin();
  const { data, error } = await admin.storage.from(BUCKET).download(chave);
  if (error || !data) return null;

  return { nome: chave.slice(chave.indexOf("/") + 1), conteudo: await data.arrayBuffer() };
}
