-- NACHO Hub · v11: lista de pendientes centralizada para "Ernesto autónomo".
-- Un ítem = algo que Nacho quiere que se haga en un proyecto, sin importar cuál (BNB, AgroScan,
-- NexiOS, Tikka, Finanzas Personales). Ernesto la lee y va resolviendo solo. Idempotente.

create table if not exists public.backlog_items (
  id uuid primary key default gen_random_uuid(),
  project text not null,
  title text not null,
  detail text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'blocked', 'done')),
  blocked_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);

create index if not exists backlog_items_project_status_idx on public.backlog_items(project, status);
