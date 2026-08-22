-- IMEA como fonte substituta do MT: os relatórios mensais do IMEA publicam o
-- número CHEIO do INDEA (origem MT, todas as inspeções) com ~2 semanas de
-- atraso — enquanto o InfoSindesa estiver congelado, é o melhor mensal de MT.
alter table public.peciclo_abate_mensal
  drop constraint peciclo_abate_mensal_fonte_check;
alter table public.peciclo_abate_mensal
  add constraint peciclo_abate_mensal_fonte_check
  check (fonte in ('gta_agregada','gta_condensada','powerbi','manual','imea'));
