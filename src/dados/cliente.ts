import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lerConfig } from "../config.js";

let instancia: SupabaseClient | null = null;

/** Cliente com service_role: ignora RLS. Nunca exponha esta chave ao browser. */
export function obterCliente(): SupabaseClient {
  if (instancia) return instancia;
  const cfg = lerConfig();
  instancia = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return instancia;
}
