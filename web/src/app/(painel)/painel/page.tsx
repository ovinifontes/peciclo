import { createClient } from "@/lib/supabase/server";

export default async function Painel() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("peciclo_abate_mensal")
    .select("*", { count: "exact", head: true })
    .eq("finalidade", "ABATE");

  return (
    <div>
      <h1 className="text-lg font-semibold">Painel</h1>
      <p className="text-neutral-600">Linhas de abate visíveis: {count ?? 0}</p>
    </div>
  );
}
