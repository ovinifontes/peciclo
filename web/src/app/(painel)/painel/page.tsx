import { exigirClienteAtivo } from "@/lib/dal";
import { obterDadosPainel, PAINEL_CICLO, type LeituraCiclo } from "@/lib/dados";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const TEXTO_FASE: Record<LeituraCiclo["fase"], string> = {
  retencao: "Retenção de matrizes",
  liquidacao: "Liquidação de matrizes",
  transicao: "Transição",
  indefinido: "Dados insuficientes",
};

const EXPLICACAO_FASE: Record<LeituraCiclo["fase"], string> = {
  retencao: "A participação de fêmeas no abate vem caindo: o pecuarista está segurando matriz.",
  liquidacao: "A participação de fêmeas no abate vem subindo: o pecuarista está descartando matriz.",
  transicao: "A participação de fêmeas no abate está estável — sem direção clara.",
  indefinido: "Ainda não há meses completos o suficiente para classificar a fase.",
};

const pp = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const umaCasa = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const duasCasas = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "2026-08-04" -> "04/08/2026". Sem `new Date`: evita virar o dia por fuso. */
function dataBr(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

export default async function Painel() {
  // O layout do grupo já exige cliente ativo, mas a autorização se confere em
  // cada página: um layout não roda de novo a cada navegação.
  await exigirClienteAtivo();

  const { leitura, precoBoi, precoBezerro } = await obterDadosPainel();
  const troca = precoBoi && precoBezerro ? precoBezerro.valor / precoBoi.valor : null;
  const estados = PAINEL_CICLO.join(" + ");

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Ciclo</p>
        <h2 className="mt-1 text-2xl font-semibold">{TEXTO_FASE[leitura.fase]}</h2>
        <p className="mt-1 text-neutral-600">{EXPLICACAO_FASE[leitura.fase]}</p>

        {leitura.yoyMm3Pp !== null && (
          <p className="mt-3 text-neutral-800">
            <strong>{pp.format(leitura.yoyMm3Pp)} p.p.</strong> na participação de fêmeas contra o
            mesmo mês do ano anterior (média móvel de 3 meses)
            {leitura.mesesNaDirecao > 1 && ` — ${leitura.mesesNaDirecao} meses seguidos na mesma direção`}.
          </p>
        )}

        {leitura.competencia && leitura.pctFemeas !== null ? (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t pt-3 text-sm">
            <Item
              rotulo="Competência"
              valor={`${MESES[leitura.competencia.mes - 1]} de ${leitura.competencia.ano}`}
            />
            <Item rotulo="Fêmeas no abate" valor={`${umaCasa.format(leitura.pctFemeas * 100)}%`} />
            <Item rotulo="Estados no cálculo" valor={estados} />
          </dl>
        ) : (
          <p className="mt-4 border-t pt-3 text-sm text-neutral-600">
            Nenhum mês passou no teste de completude — sem leitura de ciclo por enquanto.
          </p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          Consolidado de composição fixa: um mês só entra quando {estados} têm dado, e só vale se o
          volume estiver em pelo menos 90% do mesmo mês do ano anterior — por isso a competência
          acima costuma ficar um mês atrás do calendário. O Pará fica fora deste número (a ADEPARA
          publica com cerca de dois meses de atraso) e continua na tabela e no gráfico por estado.
          Logo, este percentual <strong>não é igual</strong> ao da planilha, que soma quatro estados:
          são recortes diferentes, os dois corretos.
        </p>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Mercado</p>
        <div className="mt-2 flex flex-wrap gap-8">
          <Numero rotulo="Boi gordo" valor={precoBoi ? `${reais.format(precoBoi.valor)}/@` : "—"} />
          <Numero rotulo="Bezerro (MS)" valor={precoBezerro ? reais.format(precoBezerro.valor) : "—"} />
          <Numero
            rotulo="Relação de troca"
            valor={troca ? `${duasCasas.format(troca)} @` : "—"}
            nota="arrobas de boi para comprar um bezerro"
          />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {precoBoi
            ? `Cotações de ${dataBr(precoBoi.data)} · Fonte: CEPEA-ESALQ/USP`
            : "Sem cotação disponível"}
        </p>
      </section>
    </div>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{rotulo}</dt>
      <dd className="font-medium text-neutral-900">{valor}</dd>
    </div>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{rotulo}</p>
      <p className="text-xl font-semibold">{valor}</p>
      {nota && <p className="text-xs text-neutral-400">{nota}</p>}
    </div>
  );
}
