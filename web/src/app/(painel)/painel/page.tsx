import { exigirClienteAtivo } from "@/lib/dal";
import {
  lerCenarioMaisRecente,
  obterDadosPainel,
  PAINEL_CICLO,
  type Cenario,
  type LeituraCiclo,
  type PontoCiclo,
} from "@/lib/dados";
import Explorador from "./explorador";
import GraficoFemeas, { type PontoGrafico } from "./grafico-femeas";
import TabelaMensal from "./tabela";

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

// O rótulo diz a verdade sobre quem escreveu: texto de reserva não finge ser IA.
const ROTULO_ORIGEM: Record<Cenario["origem"], string> = {
  ia: "Escrito por IA a partir dos dados desta página, com conferência automática dos números",
  reserva: "Resumo automático",
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

/** "2026-08-06" -> "6 de agosto de 2026". Também sem `new Date`, pelo mesmo fuso. */
function dataExtenso(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${ano}`;
}

/** `{ ano: 2026, mes: 6 }` -> "06/26", o rótulo curto do eixo do gráfico. */
function paraPonto(p: PontoCiclo): PontoGrafico {
  return {
    competencia: `${String(p.mes).padStart(2, "0")}/${String(p.ano).slice(2)}`,
    pct: Number((p.pctFemeas * 100).toFixed(2)),
  };
}

export default async function Painel({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>;
}) {
  // O layout do grupo já exige cliente ativo, mas a autorização se confere em
  // cada página: um layout não roda de novo a cada navegação.
  await exigirClienteAtivo();
  const { ver } = await searchParams;

  // "2026-08" no fuso de Brasília. Calculado AQUI, no servidor, e passado como
  // prop: `new Date()` num componente de cliente renderizado no servidor
  // divergiria entre os dois lados (hydration mismatch). Os gráficos usam este
  // valor para deixar o mês em coleta de fora.
  const mesCorrente = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  const [{ leitura, serie, serieCiclo, precoBoi, precoBezerro }, cenario] = await Promise.all([
    obterDadosPainel(),
    lerCenarioMaisRecente(),
  ]);
  const troca = precoBoi && precoBezerro ? precoBezerro.valor / precoBoi.valor : null;
  const estados = PAINEL_CICLO.join(" + ");

  const pontos = serieCiclo.map(paraPonto);
  const media = pontos.length
    ? pontos.reduce((soma, p) => soma + p.pct, 0) / pontos.length
    : 0;

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

      {cenario && (
        <section className="rounded-lg border bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Cenário de hoje
          </p>
          <h2 className="mt-1 text-lg font-semibold">{dataExtenso(cenario.data)}</h2>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-neutral-800">
            {cenario.texto}
          </p>
          <p className="mt-3 border-t pt-3 text-xs text-neutral-500">
            {ROTULO_ORIGEM[cenario.origem]}
          </p>
        </section>
      )}

      <section className="rounded-lg border bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Participação de fêmeas ao longo do tempo
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          É exatamente a série que classifica a fase acima: consolidado de composição fixa de{" "}
          {estados}, terminando na competência da leitura. Um mês só vira ponto quando os{" "}
          {PAINEL_CICLO.length} estados publicaram e o volume passou no teste de completude — um
          estado ausente ou um mês ainda em coleta desenharia um degrau que parece mercado e não é.
          O Pará fica fora.
        </p>

        {pontos.length ? (
          <>
            <div className="mt-4">
              <GraficoFemeas serie={pontos} media={media} />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {pontos.length} meses, de {pontos.at(0)?.competencia} a {pontos.at(-1)?.competencia}.
              A linha tracejada é a média destes meses ({umaCasa.format(media)}%) — referência do
              próprio período, não meta nem normal histórico.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-neutral-600">
            Sem meses utilizáveis ({estados} juntos e volume completo) — nada para desenhar.
          </p>
        )}
      </section>

      <section className="rounded-lg border bg-white p-5">
        <Explorador
          serie={serie}
          mesCorrente={mesCorrente}
          // `graficos` é o valor antigo da URL, de quando só havia uma visão de
          // gráficos — links e favoritos com ele caem nas Linhas.
          verInicial={
            ver === "colunas" ? "colunas" : ver === "linhas" || ver === "graficos" ? "linhas" : "tabela"
          }
          cabecalho={
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                Abate mensal por estado
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                O dado cru por trás de tudo acima, estado por estado e sexo por sexo — aqui{" "}
                <strong>com o Pará</strong>, que só fica fora do consolidado do ciclo.
              </p>
            </>
          }
          tabela={<TabelaMensal serie={serie} />}
        />
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

export const metadata = { title: "Painel" };
