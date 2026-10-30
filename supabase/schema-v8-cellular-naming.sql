-- NACHO Hub · v8: la conectividad celular pasa a ser un campo propio (no un sufijo pegado al
-- modelo), y el modelo siempre lleva el prefijo de línea (iPhone/iPad/MacBook/Apple Watch/Galaxy),
-- antes inconsistente entre categorías y entre proveedores.
-- Aplicado por MCP el 30-10-2026; queda acá como registro. Idempotente.

alter table public.price_quotes add column if not exists cellular boolean not null default false;
