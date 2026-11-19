-- NACHO Hub · v12: Video Editor (Tier 3, BNB) — mira la carpeta de Drive "VIDEOS BNB STORE",
-- edita cada clip nuevo (fondo difuminado + caja flotante con el producto) y guarda el resultado.
-- Idempotente.

create table if not exists public.video_clips (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  drive_file_name text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  product_hint text,
  output_url text,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists video_clips_status_idx on public.video_clips(status, created_at desc);

alter table public.video_clips enable row level security;
revoke all on public.video_clips from anon, authenticated;

-- ---------------------------------------------------------------
-- Storage: bucket público "clips" para los renders terminados (distinto de "banners"/"heroes",
-- que son solo imágenes — ver schema.sql).
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 209715200, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read clips" on storage.objects;
create policy "public read clips"
  on storage.objects for select
  to public
  using (bucket_id = 'clips');
