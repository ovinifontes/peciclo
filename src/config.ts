export interface Config {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionInstancia: string;
  whatsappDestinatarios: string[];
  whatsappOperador: string;
}

const OBRIGATORIAS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EVOLUTION_BASE_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_INSTANCIA",
  "WHATSAPP_DESTINATARIOS",
  "WHATSAPP_OPERADOR",
] as const;

export function lerConfig(env: Record<string, string | undefined> = process.env): Config {
  const faltando = OBRIGATORIAS.filter((k) => !env[k]?.trim());
  if (faltando.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(", ")}`);
  }
  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    evolutionBaseUrl: env.EVOLUTION_BASE_URL!,
    evolutionApiKey: env.EVOLUTION_API_KEY!,
    evolutionInstancia: env.EVOLUTION_INSTANCIA!,
    whatsappDestinatarios: env
      .WHATSAPP_DESTINATARIOS!.split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    whatsappOperador: env.WHATSAPP_OPERADOR!,
  };
}
