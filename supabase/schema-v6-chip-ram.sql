-- NACHO Hub · v6: Lucas ahora extrae chip y RAM como campos propios, separados del modelo y de la
-- capacidad de almacenamiento. Antes quedaban mezclados en el texto libre de "model" (o la RAM se
-- perdía directamente), lo que causaba productos duplicados cuando dos proveedores escribían el
-- mismo modelo en distinto orden de palabras.
-- Aplicado por MCP el 29-10-2026; queda acá como registro. Idempotente.

alter table public.price_quotes add column if not exists chip text;
alter table public.price_quotes add column if not exists ram_gb integer;
