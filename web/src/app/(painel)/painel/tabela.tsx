import type { LinhaMensal } from "@/lib/dados";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Todos os quatro estados coletados, o Pará incluído. O PA fica fora do
 * consolidado do ciclo (a ADEPARA publica com ~2 meses de atraso e faria a
 * leitura inteira esperar por ele), mas o dado dele existe e é do cliente —
 * esconder da tabela seria esconder coleta feita.
 */
const UFS = ["MT", "MS", "RO", "PA"] as const;

const numero = new Intl.NumberFormat("pt-BR");

/** Uma célula da tabela: fêmeas e machos de um estado num mês. */
interface Celula {
  femeas: number | null;
  machos: number | null;
}

/**
 * Tabela do abate mensal por estado, do mês mais recente para o mais antigo —
 * quem abre o painel quer ver o mês passado, não janeiro de 2025.
 *
 * Componente de servidor: recebe as linhas já lidas por `dados.ts` (que pagina
 * com `lerTudo`, então nenhum mês some no corte silencioso de 1000 linhas do
 * Supabase) e não manda JavaScript nenhum para o navegador.
 */
export default function TabelaMensal({ serie }: { serie: LinhaMensal[] }) {
  const porMes = new Map<string, Map<string, Celula>>();

  for (const linha of serie) {
    const chave = `${linha.ano}-${String(linha.mes).padStart(2, "0")}`;
    const estados = porMes.get(chave) ?? new Map<string, Celula>();
    const celula = estados.get(linha.uf) ?? { femeas: null, machos: null };
    if (linha.sexo === "FEMEA") celula.femeas = (celula.femeas ?? 0) + linha.quantidade;
    else celula.machos = (celula.machos ?? 0) + linha.quantidade;
    estados.set(linha.uf, celula);
    porMes.set(chave, estados);
  }

  const meses = [...porMes.keys()].sort().reverse();

  if (meses.length === 0) {
    return <p className="text-sm text-neutral-600">Nenhum mês coletado ainda.</p>;
  }

  return (
    <>
      {/* `data-exportar-expandir`: o gancho que o cartão de exportação usa
          para soltar esta rolagem via CSS — no PNG a tabela sai INTEIRA, sem
          o corte de 26rem que a tela precisa ter. Ver exportavel.tsx. */}
      <div data-exportar-expandir className="max-h-[26rem] overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Mês</th>
              {UFS.map((uf) => (
                <th key={uf} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {uf} <span className="font-normal">fêmeas / machos</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meses.map((chave) => {
              const [ano, mes] = chave.split("-").map(Number);
              const estados = porMes.get(chave)!;
              return (
                <tr key={chave} className="border-b last:border-0 even:bg-neutral-50/60">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {MESES[mes! - 1]}/{String(ano).slice(2)}
                  </td>
                  {UFS.map((uf) => {
                    const celula = estados.get(uf);
                    return (
                      <td
                        key={uf}
                        className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                      >
                        {celula ? (
                          <>
                            {celula.femeas === null ? "—" : numero.format(celula.femeas)}
                            <span className="text-neutral-400"> / </span>
                            {celula.machos === null ? "—" : numero.format(celula.machos)}
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        {meses.length} meses coletados nos {UFS.length} estados: {UFS.join(", ")}. Cabeças abatidas
        com finalidade <strong>ABATE</strong> — abate sanitário e sacrifício ficam de fora, porque
        não são decisão do pecuarista. Um travessão (—) quer dizer que o estado ainda não publicou
        aquele mês: o Pará costuma ficar dois meses atrás dos outros, e é por isso que ele aparece
        aqui mas não entra no consolidado do ciclo lá em cima. O mês corrente aparece parcial, com
        os dias já coletados.
      </p>
    </>
  );
}
