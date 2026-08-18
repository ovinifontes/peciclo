import { Fragment } from "react";

import { diaSemana, rotuloDia, ufsComDado, type DiaUf } from "@/lib/dados";

const numero = new Intl.NumberFormat("pt-BR");
const umaCasa = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Tabela do abate diário por estado, do dia mais recente para o mais antigo —
 * quem abre quer ver ontem, não março. Só entram os estados que TÊM dado por
 * dia (MS hoje; o MT ganha as colunas dele sozinho quando o INDEA voltar):
 * coluna inteira de travessão seria mobília, não informação. Últimos 60 dias
 * — para trás disso a pergunta vira tendência, e tendência é das Linhas.
 *
 * Componente de servidor, como a tabela mensal: recebe os dias já agrupados
 * pela lógica pura da raiz e não manda JavaScript nenhum para o navegador.
 */
export default function TabelaDiaria({
  dias,
  corte60,
  corteAssentando,
}: {
  dias: DiaUf[];
  /** ISO do corte de 60 dias, calculado no servidor (fuso de Brasília). */
  corte60: string;
  /** ISO do início da janela que a recoleta ainda reprocessa (últimos 7 dias). */
  corteAssentando: string;
}) {
  const ufs = ufsComDado(dias);
  const recorte = dias.filter((d) => d.data >= corte60);

  const porDia = new Map<string, Map<string, DiaUf>>();
  for (const dia of recorte) {
    const estados = porDia.get(dia.data) ?? new Map<string, DiaUf>();
    estados.set(dia.uf, dia);
    porDia.set(dia.data, estados);
  }

  const datas = [...porDia.keys()].sort().reverse();

  if (datas.length === 0) {
    return <p className="text-sm text-neutral-600">Nenhum dia coletado ainda.</p>;
  }

  return (
    <>
      {/* `data-exportar-expandir`: o mesmo gancho da tabela mensal — o cartão
          de exportação solta esta rolagem via CSS e o PNG sai com a tabela
          inteira, sem o corte de 26rem que a tela precisa ter. */}
      <div data-exportar-expandir className="max-h-[26rem] overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Dia</th>
              {/* As colunas de cada estado andam JUNTAS (fêmeas/machos, total,
                  % fêmeas): quando o MT entrar, cada bloco continua legível. */}
              {ufs.map((uf) => (
                <Fragment key={uf}>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {uf} <span className="font-normal">fêmeas / machos</span>
                  </th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {uf} <span className="font-normal">total</span>
                  </th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {uf} <span className="font-normal">% fêmeas</span>
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {datas.map((data) => {
              const estados = porDia.get(data)!;
              const assentando = data >= corteAssentando;
              return (
                <tr key={data} className="border-b last:border-0 even:bg-neutral-50/60">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {diaSemana(data)}, {rotuloDia(data)}
                    {assentando && (
                      <span className="text-neutral-400"> · assentando</span>
                    )}
                  </td>
                  {ufs.map((uf) => {
                    const dia = estados.get(uf);
                    return (
                      <Fragment key={uf}>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {dia ? (
                            <>
                              {numero.format(dia.femeas)}
                              <span className="text-neutral-400"> / </span>
                              {numero.format(dia.machos)}
                            </>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {dia ? (
                            numero.format(dia.total)
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {dia && dia.pctFemeas !== null ? (
                            `${umaCasa.format(dia.pctFemeas)}%`
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        Últimos {datas.length} dias com dado, do mais recente para o mais antigo. Cabeças
        abatidas com finalidade <strong>ABATE</strong> — abate sanitário e sacrifício ficam de
        fora, porque não são decisão do pecuarista. O dia de HOJE não aparece: ainda está em
        coleta. Os dias marcados <strong>assentando</strong> (os 7 mais recentes) ainda são
        reprocessados pela recoleta semanal e podem mexer um pouco antes de firmar. Fim de
        semana quase não abate — o serrote é do calendário, não do mercado.
      </p>
    </>
  );
}
