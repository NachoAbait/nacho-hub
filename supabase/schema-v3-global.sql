-- NACHO Hub · v3: piso GLOBAL (Global Analyst, economía y actualidad mundial).
-- Aplicado por MCP el 28-10-2026; queda acá como registro, igual que schema-v2-agentes.sql.
-- Idempotente.

alter table public.agent_reports drop constraint if exists agent_reports_context_check;
alter table public.agent_reports add constraint agent_reports_context_check
  check (context in ('BNB', 'AgroScan', 'AMBOS', 'GLOBAL'));

alter table public.agent_runs drop constraint if exists agent_runs_context_check;
alter table public.agent_runs add constraint agent_runs_context_check
  check (context in ('BNB', 'AgroScan', 'AMBOS', 'GLOBAL'));
