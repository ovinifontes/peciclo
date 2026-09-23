-- O mensal de MT passa a poder vir do DIÁRIO somado (SINDESA 2), e não só do
-- IMEA. Mesma fonte que já existe no diário: é o mesmo portal, a mesma leitura
-- GTA a GTA, só agregada por competência.
--
-- Fonte própria, e não 'gta_condensada': aquela é o relatório somado do portal
-- VELHO, que morreu em 07/08/2026. Confundir as duas faria uma fonte morta
-- parecer viva no `congeladoDesde`, que mede por fonte.
alter table public.peciclo_abate_mensal
  drop constraint peciclo_abate_mensal_fonte_check;
alter table public.peciclo_abate_mensal
  add constraint peciclo_abate_mensal_fonte_check
  check (fonte in ('gta_agregada','gta_condensada','powerbi','imea','sindesa2_gta','manual'));
