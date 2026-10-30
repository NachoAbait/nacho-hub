-- NACHO Hub · v7: Lucas separa las pulgadas (MacBook/iPad) como campo propio y reconoce las
-- variantes +Cell (eSIM) como un producto distinto, nunca fusionado con la versión WiFi-only.
-- Aplicado por MCP el 30-10-2026; queda acá como registro. Idempotente.

alter table public.price_quotes add column if not exists inches numeric;
