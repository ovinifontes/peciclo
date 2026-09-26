-- Abate diário por sexo vindo da consulta pública do MAPA (PGA-SIGSIF).
--
-- Fonte PRÓPRIA, nunca misturada com 'powerbi_diff': o MAPA conta só inspeção
-- federal e agrega pela UF da GTA, enquanto o painel do IDARON conta todas as
-- inspeções pela UF da planta. Medido em RO, 01-11/09/2026: IDARON 112.453,
-- MAPA 84.181 — 75%. Somar as duas, ou comparar nível entre elas, inventaria
-- uma queda de 25% que não existe no mercado.
--
-- Entrou porque o IDARON congelou em 11/09/2026 na migração de plataforma do
-- órgão e Rondônia ficou sem diário. Quando o painel voltar, as duas séries
-- coexistem: cada uma com a sua fonte, e quem lê sabe qual está vendo.
alter table public.peciclo_abate_diario
  drop constraint peciclo_abate_diario_fonte_check;
alter table public.peciclo_abate_diario
  add constraint peciclo_abate_diario_fonte_check
  check (fonte in ('gta_agregada','gta_condensada_dia','powerbi_diff','sindesa2_gta','sigsif_dia','manual'));
