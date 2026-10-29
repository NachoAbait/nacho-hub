-- NACHO Hub · v5: vincular un canal/comunidad o un número alternativo a un proveedor YA cargado,
-- en vez de crear una fila nueva separada (la confusión de "proveedor vs canal").
-- Aplicado por MCP el 29-10-2026; queda acá como registro. Idempotente.

alter table public.suppliers add column if not exists channel_id text;
create unique index if not exists suppliers_channel_id_key on public.suppliers (channel_id) where channel_id is not null;
