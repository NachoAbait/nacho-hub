-- Cola de mensajes salientes del bot de clientes, para el puente de Baileys dedicado (número nuevo,
-- separado del de la oficina). answerCustomerMessage() en lib/agents/customer-bot.ts no manda nada
-- directo (sigue agnóstica del transporte) — el endpoint de ingest de este lane inserta acá, y el
-- puente local hace polling, manda por Baileys, y marca el resultado.
create table if not exists customer_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references customer_conversations(id),
  phone text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table customer_outbox enable row level security;
