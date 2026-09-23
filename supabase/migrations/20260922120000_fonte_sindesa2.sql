-- O SINDESA 2 (portal novo do INDEA, no ar em 09/2026) entra como fonte
-- própria do diário de MT.
--
-- Fonte separada de propósito, e não reaproveitando 'gta_condensada_dia': as
-- duas são leituras do MESMO universo por caminhos diferentes — o velho lê o
-- relatório GTA Condensado já somado, o novo soma a Estratificação de cada
-- GTA, uma por uma. Quando um dia vier pelos dois, é preciso saber de qual
-- veio. `congeladoDesde` também mede congelamento POR FONTE: misturadas, uma
-- fonte viva mascararia a outra morta e o alerta nunca sairia.
--
-- O rollup diário não precisa mudar: a guarda dele já é `ad.fonte =
-- 'gta_agregada'` (cada fonte é dona das suas linhas), então estas linhas
-- ficam protegidas por construção.
alter table public.peciclo_abate_diario
  drop constraint peciclo_abate_diario_fonte_check;
alter table public.peciclo_abate_diario
  add constraint peciclo_abate_diario_fonte_check
  check (fonte in ('gta_agregada','gta_condensada_dia','powerbi_diff','sindesa2_gta','manual'));
