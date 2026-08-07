-- O cenário do dia ganha um resumo próprio para o WhatsApp (o texto completo
-- fica só no site) e a marca de envio único: rodar a rotina de novo no mesmo
-- dia atualiza os textos, mas nunca reenvia a mensagem.

alter table public.peciclo_cenarios add column if not exists resumo text;
alter table public.peciclo_cenarios add column if not exists enviado_em timestamptz;
comment on column public.peciclo_cenarios.enviado_em is
  'Quando o WhatsApp do dia saiu. Null = ainda não enviado; rodar a rotina de novo atualiza os textos mas não reenvia.';
