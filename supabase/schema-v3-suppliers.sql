-- NACHO Hub · v3: proveedores, precio unitario y aprendizaje del Price Reader.
-- Idempotente. Aplicado por MCP el 27-10-2026.

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null unique,          -- normalizado: solo dígitos, sin + ni espacios
  name          text,
  rules         jsonb not null default '{}'::jsonb,  -- {unit_discount_usd, bulk_pricing, notes, examples: [...máx 10]}
  active        boolean not null default true,        -- solo los activos se procesan
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  messages_count int not null default 0
);
alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;

alter table public.supplier_messages add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

alter table public.price_updates add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
alter table public.price_updates add column if not exists original_price_usd numeric(10, 2);   -- precio tal como lo publicó el proveedor
alter table public.price_updates add column if not exists pricing_basis text;                  -- unit | bulk_min
alter table public.price_updates add column if not exists bulk_qty int;
alter table public.price_updates add column if not exists adjustment_usd numeric(10, 2);       -- ajuste aplicado (regla del proveedor), negativo = descuento
alter table public.price_updates add column if not exists adjustment_note text;
alter table public.price_updates add column if not exists raw_line text;
alter table public.price_updates add column if not exists review_status text not null default 'pending'
  check (review_status in ('pending', 'confirmed', 'corrected'));
alter table public.price_updates add column if not exists corrected_cost_usd numeric(10, 2);
alter table public.price_updates add column if not exists reviewed_at timestamptz;
