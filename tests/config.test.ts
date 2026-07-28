import { describe, expect, it } from "vitest";
import { lerConfig } from "../src/config.js";

describe("lerConfig", () => {
  it("lê as variáveis presentes", () => {
    const cfg = lerConfig({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "chave",
      EVOLUTION_BASE_URL: "https://evo.exemplo.com",
      EVOLUTION_API_KEY: "k",
      EVOLUTION_INSTANCIA: "peciclo",
      WHATSAPP_DESTINATARIOS: "5511999999999,5511888888888",
      WHATSAPP_OPERADOR: "5511777777777",
    });
    expect(cfg.supabaseUrl).toBe("https://x.supabase.co");
    expect(cfg.whatsappDestinatarios).toEqual(["5511999999999", "5511888888888"]);
  });

  it("falha alto quando falta variável obrigatória", () => {
    expect(() => lerConfig({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
