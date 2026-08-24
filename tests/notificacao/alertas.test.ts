import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memoria = vi.hoisted(() => ({
  deveAlertar: vi.fn(async () => true),
  registrarAlerta: vi.fn(async () => {}),
}));
vi.mock("../../src/dados/alertas-enviados.js", () => ({
  JANELA_REPETICAO_DIAS: 3,
  chaveAlerta: (assunto: string, detalhe: string) => `${assunto}\n${detalhe}`,
  deveAlertar: memoria.deveAlertar,
  registrarAlerta: memoria.registrarAlerta,
}));

import { alertarOperador } from "../../src/notificacao/alertas.js";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  EVOLUTION_BASE_URL: "https://evo.exemplo.com",
  EVOLUTION_API_KEY: "k",
  EVOLUTION_INSTANCIA: "peciclo",
  WHATSAPP_DESTINATARIOS: "5567999999999",
  WHATSAPP_OPERADOR: "5567988888888",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  memoria.deveAlertar.mockResolvedValue(true);
  memoria.registrarAlerta.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ok = async (..._args: Parameters<typeof fetch>) => new Response("{}", { status: 201 });

describe("alertarOperador nunca derruba a coleta que reporta", () => {
  it("não lança quando o fetch estoura (timeout, DNS, ECONNRESET)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    await expect(alertarOperador("assunto", "detalhe")).resolves.toBeUndefined();
  });

  it("não lança quando a Evolution recusa com HTTP de erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: Parameters<typeof fetch>) => new Response("nope", { status: 500 })),
    );
    await expect(alertarOperador("assunto", "detalhe")).resolves.toBeUndefined();
  });

  it("não lança quando falta variável de ambiente", async () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "");
    vi.stubGlobal("fetch", vi.fn(ok));
    await expect(alertarOperador("assunto", "detalhe")).resolves.toBeUndefined();
  });

  it("envia com o path, header e corpo corretos", async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal("fetch", fetchMock);
    await alertarOperador("MT parou", "detalhe do erro");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://evo.exemplo.com/message/sendText/peciclo");
    expect((init as RequestInit).headers).toMatchObject({ apikey: "k" });
    const corpo = JSON.parse((init as RequestInit).body as string);
    expect(corpo.number).toBe("5567988888888");
    expect(corpo.text).toContain("MT parou");
    expect(corpo.text).toContain("detalhe do erro");
  });
});

describe("supressão de alerta repetido", () => {
  it("não reenvia alerta de conteúdo idêntico dentro da janela", async () => {
    memoria.deveAlertar.mockResolvedValue(false);
    const fetchMock = vi.fn(ok);
    vi.stubGlobal("fetch", fetchMock);

    await alertarOperador("Valores fora do padrão", "MT 07/2026 congelado");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(memoria.registrarAlerta).not.toHaveBeenCalled();
  });

  it("registra o envio para que a próxima repetição seja suprimida", async () => {
    vi.stubGlobal("fetch", vi.fn(ok));
    await alertarOperador("MT parou", "detalhe");
    expect(memoria.registrarAlerta).toHaveBeenCalledWith("MT parou\ndetalhe", "MT parou");
  });

  it("alerta que não chegou NÃO é registrado — o próximo tem que sair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: Parameters<typeof fetch>) => new Response("nope", { status: 500 })),
    );
    await alertarOperador("MT parou", "detalhe");
    expect(memoria.registrarAlerta).not.toHaveBeenCalled();
  });

  it("`sempre: true` fura a supressão (boa notícia nunca é calada)", async () => {
    memoria.deveAlertar.mockResolvedValue(false);
    const fetchMock = vi.fn(ok);
    vi.stubGlobal("fetch", fetchMock);

    await alertarOperador("✅ Recoleta: MT recuperado", "detalhe", { sempre: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(memoria.deveAlertar).not.toHaveBeenCalled();
  });
});
