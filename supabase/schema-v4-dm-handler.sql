-- NACHO Hub · v4: DM Handler (Micaela) sobre WhatsApp, modo borrador.
-- Aplicado por MCP el 28-10-2026; queda acá como registro, igual que los schema-v* anteriores.
-- Idempotente.

alter table public.pending_senders
  add column if not exists draft_reply text,
  add column if not exists draft_classification text check (draft_classification in ('rutinario','venta_caliente','derivar')),
  add column if not exists draft_note text,
  add column if not exists draft_generated_at timestamptz;
