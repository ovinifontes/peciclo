import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionApiError, enviarDocumento, normalizarNumero } from "../../src/notificacao/evolution.js";

afterEach(() => vi.unstubAllGlobals());

describe("normalizarNumero", () => {
  it("remove máscara e sufixo de JID", () => {
    expect(normalizarNumero("+55 (67) 99999-9999")).toBe("5567999999999");
    expect(normalizarNumero("5567999999999@s.whatsapp.net")).toBe("5567999999999");
  });

  it("rejeita número curto demais", () => {
    expect(() => normalizarNumero("1234")).toThrow(/inválido/i);
  });
});

describe("enviarDocumento", () => {
  const base = {
    instancia: "peciclo",
    apiKey: "k",
    baseUrl: "https://evo.exemplo.com",
    numero: "5567999999999",
    arquivo: Buffer.from("PKconteudo"),
    nomeArquivo: "abate-2026-07-27.xlsx",
  };

  it("envia com o path, header e corpo corretos", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify({ key: { id: "BAE5", remoteJid: "x", fromMe: true } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await enviarDocumento(base);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://evo.exemplo.com/message/sendMedia/peciclo");
    expect((init as RequestInit).headers).toMatchObject({ apikey: "k" });
    const corpo = JSON.parse((init as RequestInit).body as string);
    expect(corpo.mediatype).toBe("document");
    expect(corpo.fileName).toBe("abate-2026-07-27.xlsx");
    expect(corpo.number).toBe("5567999999999");
    expect(typeof corpo.media).toBe("string");
  });

  it("exige extensão .xlsx porque o servidor deriva o mimetype do nome", async () => {
    await expect(enviarDocumento({ ...base, nomeArquivo: "abate" })).rejects.toThrow(/\.xlsx/);
  });

  it("lança EvolutionApiError quando a API recusa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ response: { message: ["número não existe no WhatsApp"] } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ));
    await expect(enviarDocumento(base)).rejects.toThrow(EvolutionApiError);
  });

  it("recusa buffer vazio", async () => {
    await expect(enviarDocumento({ ...base, arquivo: Buffer.alloc(0) })).rejects.toThrow(/vazio/i);
  });
});
