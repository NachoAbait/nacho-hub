-- NACHO Hub · módulo DESIGNER
-- Pegar completo en el SQL Editor del proyecto "nacho-hub".
-- Es idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------
-- Enum de categorías
-- ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_category') then
    create type public.product_category as enum
      ('iphone', 'ipad', 'macbook', 'watch', 'airpods', 'samsung');
  end if;
end $$;

-- ---------------------------------------------------------------
-- products
-- ---------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  category       public.product_category not null,
  model          text not null,                 -- "iPhone 16 Pro Max"
  capacity       text,                          -- "256 GB" (null para Watch/AirPods)
  price_usd      numeric(10, 2) not null check (price_usd >= 0),
  hero_image_url text,                          -- URL pública (Storage "heroes" o externa), PNG sin fondo
  display_order  integer not null default 0,
  is_active      boolean not null default true,
  context        text not null default 'BNB' check (context in ('BNB', 'AgroScan')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists products_category_active_order_idx
  on public.products (category, is_active, display_order);

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- banners
-- ---------------------------------------------------------------
create table if not exists public.banners (
  id            uuid primary key default gen_random_uuid(),
  category      public.product_category not null,
  generated_at  timestamptz not null default now(),
  image_url     text not null,                  -- URL pública en Storage "banners"
  storage_path  text not null,                  -- path dentro del bucket, para poder borrar
  width         integer not null,
  height        integer not null,
  snapshot_json jsonb not null                  -- productos tal cual se renderizaron
);

create index if not exists banners_category_generated_idx
  on public.banners (category, generated_at desc);

-- ---------------------------------------------------------------
-- agent_reports (informes diarios de los agentes; se usa desde Fase 3)
-- ---------------------------------------------------------------
create table if not exists public.agent_reports (
  id               uuid primary key default gen_random_uuid(),
  agent_name       text not null,
  context          text not null default 'BNB' check (context in ('BNB', 'AgroScan', 'AMBOS')),
  date             date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  content_markdown text not null,
  raw_data_json    jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists agent_reports_agent_date_idx
  on public.agent_reports (agent_name, date desc);

-- ---------------------------------------------------------------
-- RLS: nadie entra con anon. El hub usa service role desde el server.
-- ---------------------------------------------------------------
alter table public.products      enable row level security;
alter table public.banners       enable row level security;
alter table public.agent_reports enable row level security;

revoke all on public.products      from anon, authenticated;
revoke all on public.banners       from anon, authenticated;
revoke all on public.agent_reports from anon, authenticated;

-- ---------------------------------------------------------------
-- Storage: buckets públicos "banners" y "heroes"
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('banners', 'banners', true, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('heroes',  'heroes',  true, 10485760, array['image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública de los dos buckets (escritura solo con service role)
drop policy if exists "public read banners" on storage.objects;
create policy "public read banners"
  on storage.objects for select
  to public
  using (bucket_id = 'banners');

drop policy if exists "public read heroes" on storage.objects;
create policy "public read heroes"
  on storage.objects for select
  to public
  using (bucket_id = 'heroes');

-- ---------------------------------------------------------------
-- Seed de ejemplo para iPhone (borrar o editar precios a gusto)
-- ---------------------------------------------------------------
insert into public.products (category, model, capacity, price_usd, hero_image_url, display_order)
select * from (values
  ('iphone'::public.product_category, 'iPhone 17 Pro Max', '256 GB', 1499.00, null, 1),
  ('iphone'::public.product_category, 'iPhone 17 Pro',     '256 GB', 1299.00, null, 2),
  ('iphone'::public.product_category, 'iPhone 17',         '256 GB', 1049.00, null, 3),
  ('iphone'::public.product_category, 'iPhone Air',        '256 GB', 1199.00, null, 4),
  ('iphone'::public.product_category, 'iPhone 16',         '128 GB',  849.00, null, 5),
  ('iphone'::public.product_category, 'iPhone 16e',        '128 GB',  699.00, null, 6)
) as v(category, model, capacity, price_usd, hero_image_url, display_order)
where not exists (select 1 from public.products where category = 'iphone');
