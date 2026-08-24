-- Memória curta dos alertas ao operador: o mesmo aviso, palavra por palavra,
-- não volta dentro de 3 dias. Alerta repetido todo dia treina o dono a ignorar
-- alerta — e aí o dia em que algo novo quebra passa despercebido.
-- A chave é o sha1 de "assunto\ndetalhe"; `assunto` fica só para leitura humana.
create table if not exists public.peciclo_alertas_enviados (
  chave      text        primary key,
  assunto    text        not null,
  enviado_em timestamptz not null default now()
);
alter table public.peciclo_alertas_enviados enable row level security;
-- RLS ligada e zero políticas: interna ao robô, só a service_role passa.
