-- NACHO Hub · v2: runtime de agentes, Price Reader y configuración.
-- Idempotente. Se aplicó por MCP el 27-10-2026; queda acá como registro.

-- Corridas de agentes (para el estado "trabajando" y el historial)
create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    text not null,
  context     text not null default 'BNB' check (context in ('BNB', 'AgroScan', 'AMBOS')),
  trigger     text not null default 'manual' check (trigger in ('manual', 'cron', 'ingest')),
  status      text not null default 'running' check (status in ('running', 'ok', 'error')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  summary     text,
  error       text,
  cost_usd    numeric(10, 5) not null default 0,
  usage_json  jsonb
);
create index if not exists agent_runs_agent_started_idx on public.agent_runs (agent_id, started_at desc);
create index if not exists agent_runs_status_idx on public.agent_runs (status) where status = 'running';

-- agent_reports: relación con la corrida y resumen corto
alter table public.agent_reports add column if not exists run_id uuid references public.agent_runs (id) on delete set null;
alter table public.agent_reports add column if not exists summary text;

-- Mensajes crudos de proveedores (WhatsApp vía puente, o pegados a mano)
create table if not exists public.supplier_messages (
  id           uuid primary key default gen_random_uuid(),
  source       text not null default 'whatsapp' check (source in ('whatsapp', 'manual')),
  sender       text,                       -- número o jid
  sender_name  text,
  received_at  timestamptz not null default now(),
  body         text not null,
  parsed_at    timestamptz,
  parse_json   jsonb,
  run_id       uuid references public.agent_runs (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists supplier_messages_received_idx on public.supplier_messages (received_at desc);

-- Cambios de precio detectados y qué pasó con cada uno
create table if not exists public.price_updates (
  id                 uuid primary key default gen_random_uuid(),
  message_id         uuid references public.supplier_messages (id) on delete cascade,
  category           public.product_category,
  model              text not null,
  capacity           text,
  detected_cost_usd  numeric(10, 2) not null,
  previous_cost_usd  numeric(10, 2),
  new_price_usd      numeric(10, 2),
  hub_product_id     uuid references public.products (id) on delete set null,
  nexios_catalog_id  uuid,
  status             text not null default 'detected'
                     check (status in ('detected', 'applied', 'applied_hub_only', 'pending_nexios', 'new_model', 'unchanged', 'rejected')),
  note               text,
  created_at         timestamptz not null default now(),
  applied_at         timestamptz
);
create index if not exists price_updates_created_idx on public.price_updates (created_at desc);

-- Configuración editable del hub (competidores, cuentas de IG, proveedores…)
create table if not exists public.hub_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- products: de dónde vino cada fila y su costo
alter table public.products add column if not exists cost_usd numeric(10, 2);
alter table public.products add column if not exists margin_usd numeric(10, 2);
alter table public.products add column if not exists nexios_catalog_id uuid;
alter table public.products add column if not exists source text not null default 'manual';

alter table public.agent_runs        enable row level security;
alter table public.supplier_messages enable row level security;
alter table public.price_updates     enable row level security;
alter table public.hub_settings      enable row level security;
revoke all on public.agent_runs, public.supplier_messages, public.price_updates, public.hub_settings from anon, authenticated;

-- Valores iniciales de configuración (si no existen)
insert into public.hub_settings (key, value) values
  ('competitors', '{"BNB": ["@iphonesdolores", "@applestoredolores"], "AgroScan": []}'::jsonb),
  ('instagram_accounts', '{"BNB": "bnbstore.dolores", "AgroScan": "agroscan"}'::jsonb),
  ('supplier_senders', '[]'::jsonb),
  ('market_queries', '{"BNB": ["iPhone Argentina precio", "Apple Argentina", "dólar hoy"], "AgroScan": ["SENASA ganadería", "precio hacienda Cañuelas", "trazabilidad bovina Argentina"]}'::jsonb)
on conflict (key) do nothing;
