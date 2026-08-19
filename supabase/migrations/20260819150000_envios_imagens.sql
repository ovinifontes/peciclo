-- Trava de envio único do dia para as imagens da seção diária — a mesma lição
-- do cenário duplicado: redisparo manual regenera, mas nunca reenvia.
create table if not exists public.peciclo_envios_imagens (
  data       date        primary key,
  enviado_em timestamptz not null default now()
);
alter table public.peciclo_envios_imagens enable row level security;
-- RLS ligada e zero políticas: interna ao robô, só a service_role passa.
