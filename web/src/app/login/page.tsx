import { Fraunces } from "next/font/google";
import { entrar } from "./acoes";

/**
 * A porta de um produto vendido a quem opera mercado futuro. A estética é a de
 * relojoaria: um mostrador com 12 marcas (os meses do ciclo) e um ponto de
 * ouro que orbita devagar — o único movimento da tela. Verde-garrafa sobre
 * branco, uma serifa de peso no nome, e nada competindo com o formulário.
 */

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

export default function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  return (
    <main
      className={`${fraunces.variable} relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6`}
    >
      <style>{css}</style>

      {/* Eco do mostrador ao fundo: anéis quase invisíveis, fora do centro.
          Só de tablet para cima — em tela estreita eles passariam atrás do
          texto, e minimalismo em celular é branco de verdade. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-64 -top-64 hidden h-[42rem] w-[42rem] sm:block"
        viewBox="0 0 640 640"
        fill="none"
      >
        {[300, 240, 180, 120].map((r) => (
          <circle key={r} cx="320" cy="320" r={r} stroke="var(--verde)" strokeOpacity="0.05" />
        ))}
      </svg>

      <div className="lg-col relative flex w-full max-w-[21rem] flex-col items-center">
        {/* O mostrador do ciclo */}
        <svg aria-hidden className="lg-item h-[4.5rem] w-[4.5rem]" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" stroke="var(--verde)" strokeWidth="1.25" />
          {/* 12 pontos: um por mês. Comprimento de traço ~0 + linecap redondo = ponto. */}
          <circle
            cx="32"
            cy="32"
            r="24"
            stroke="var(--verde)"
            strokeOpacity="0.45"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray="0.1 12.466"
          />
          <g className="lg-orbita">
            <circle cx="32" cy="8" r="2.6" fill="var(--ouro)" />
          </g>
          <circle cx="32" cy="32" r="1.5" fill="var(--verde)" />
        </svg>

        <h1
          className="lg-item mt-5 text-[2rem] font-medium tracking-tight text-[var(--verde)]"
          style={{ fontFamily: "var(--font-fraunces), serif" }}
        >
          Peciclo
        </h1>
        <p className="lg-item mt-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-[#6b7a72]">
          Inteligência do ciclo pecuário
        </p>

        <div className="lg-item lg-fio mt-7" aria-hidden />

        <form action={entrar} className="lg-item mt-8 flex w-full flex-col">
          <label htmlFor="email" className="lg-rotulo">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="nome@fazenda.com.br"
            className="lg-campo"
          />

          <label htmlFor="senha" className="lg-rotulo mt-6">
            Senha
          </label>
          <input
            id="senha"
            name="senha"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="lg-campo"
          />

          <Erro searchParams={searchParams} />

          <button type="submit" className="lg-botao mt-9">
            Entrar
          </button>
        </form>

        <p className="lg-item mt-10 text-[0.6875rem] tracking-wide text-[#8a948d]">
          Acesso restrito a clientes
          <span className="mx-2 text-[var(--ouro)]">·</span>
          peciclo.com.br
        </p>
      </div>
    </main>
  );
}

async function Erro({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  if (!erro) return null;
  return (
    <p role="alert" className="mt-5 border-l-2 border-[#93402c] pl-3 text-[0.8125rem] text-[#93402c]">
      E-mail ou senha inválidos.
    </p>
  );
}

export const metadata = { title: "Entrar" };

const css = `
  .lg-orbita {
    transform-origin: 32px 32px;
    animation: lg-girar 28s linear infinite;
  }
  @keyframes lg-girar { to { transform: rotate(360deg); } }

  .lg-fio {
    width: 4.5rem;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--ouro) 30%, var(--ouro) 70%, transparent);
  }

  .lg-rotulo {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #47544d;
  }

  /* Campo sem caixa: só a linha de base, que engrossa e escurece no foco.
     O traço verde cresce da esquerda por background-size — sem pulo de layout. */
  .lg-campo {
    margin-top: 0.375rem;
    padding: 0.5rem 0 0.625rem;
    font-size: 1rem; /* 16px: iOS não dá zoom */
    color: #16211b;
    caret-color: var(--verde);
    background:
      linear-gradient(var(--verde), var(--verde)) no-repeat left bottom / 0% 1.5px,
      linear-gradient(#d3dad5, #d3dad5) no-repeat left bottom / 100% 1px;
    transition: background-size 320ms cubic-bezier(0.22, 1, 0.36, 1);
    outline: none;
  }
  .lg-campo::placeholder { color: #8a948d; }
  .lg-campo:focus { background-size: 100% 1.5px, 100% 1px; }
  .lg-campo:-webkit-autofill {
    -webkit-box-shadow: 0 0 0 1000px #fff inset;
    -webkit-text-fill-color: #16211b;
  }

  .lg-botao {
    height: 2.875rem;
    border-radius: 2px;
    background: var(--verde);
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition: background-color 200ms ease, box-shadow 200ms ease, transform 120ms ease;
  }
  .lg-botao:hover {
    background: var(--verde-escuro);
    box-shadow: 0 8px 24px -12px rgba(14, 58, 43, 0.5);
  }
  .lg-botao:active { transform: translateY(1px); }
  .lg-botao:focus-visible {
    outline: 2px solid var(--ouro);
    outline-offset: 2px;
  }

  /* Entrada em camadas: mostrador, nome, fio, formulário, rodapé. */
  .lg-col .lg-item {
    opacity: 0;
    transform: translateY(10px);
    animation: lg-surgir 640ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .lg-col .lg-item:nth-child(1) { animation-delay: 60ms; }
  .lg-col .lg-item:nth-child(2) { animation-delay: 140ms; }
  .lg-col .lg-item:nth-child(3) { animation-delay: 200ms; }
  .lg-col .lg-item:nth-child(4) { animation-delay: 260ms; }
  .lg-col .lg-item:nth-child(5) { animation-delay: 340ms; }
  .lg-col .lg-item:nth-child(6) { animation-delay: 460ms; }
  @keyframes lg-surgir { to { opacity: 1; transform: none; } }

  @media (prefers-reduced-motion: reduce) {
    .lg-orbita { animation: none; }
    .lg-col .lg-item { animation: none; opacity: 1; transform: none; }
  }
`;
