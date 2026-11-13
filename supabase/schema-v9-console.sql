-- NACHO Hub · v9: categoría "console" (PlayStation), con "edition" (Digital/Física) como campo
-- propio, igual que cellular/chip/inches/screen_mm — nunca pegado al modelo.
-- Idempotente.

alter table public.price_quotes add column if not exists edition text;
alter table public.price_updates add column if not exists edition text;
