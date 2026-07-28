-- Bucket privado onde ficam os arquivos brutos baixados dos portais, antes de
-- qualquer parse (auditoria e reprocessamento). Prefixo peciclo_ como o resto.
insert into storage.buckets (id, name, public)
values ('peciclo_brutos', 'peciclo_brutos', false)
on conflict (id) do nothing;
