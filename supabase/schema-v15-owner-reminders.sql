-- Recordatorios que Nacho le pide a su propio bot de WhatsApp ("recordame X a las Y"). Separado de
-- customer_outbox (que es "mandar YA"): acá se guarda la hora futura, y algo tiene que fijarse
-- cuándo ya pasó esa hora para recién ahí encolarlo en customer_outbox.
--
-- Por qué no un cron de Vercel: el plan Hobby de este proyecto solo deja crons de una vez por día
-- (ver nacho-hub-vercel-hobby-60s.md), inútil para "avisame a las 17hs" del mismo día. En cambio, el
-- puente de WhatsApp (bridge/whatsapp/) ya hace polling de customer_outbox cada pocos segundos sin
-- parar — deliverDueOwnerReminders() se cuelga de ESE mismo polling (ver
-- app/api/agents/customer-bot/outbox/route.ts), así que no hace falta infraestructura nueva.
create table if not exists owner_reminders (
  id uuid primary key default gen_random_uuid(),
  due_at timestamptz not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table owner_reminders enable row level security;
