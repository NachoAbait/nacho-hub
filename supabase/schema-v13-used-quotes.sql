-- NACHO Hub · v13: cotizaciones de equipos USADOS que mandan los proveedores en sus listas.
-- Lucas (Price Reader) hasta ahora las descartaba (solo guardaba "new" en price_quotes). Van en una
-- tabla aparte para NO tocar el flujo de precios nuevos (Martín/Bruno/Delfina leen solo price_quotes).
-- Es la base de la lista de referencia para cotizar canjes (uso interno, fase 1). Idempotente.

create table if not exists public.used_quotes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.supplier_messages(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  category text not null,
  model text not null,
  capacity text,
  price_usd numeric not null,
  confidence numeric not null default 1,
  raw_line text,
  note text,
  quote_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists used_quotes_model_date_idx on public.used_quotes(category, model, quote_date desc);

alter table public.used_quotes enable row level security;
