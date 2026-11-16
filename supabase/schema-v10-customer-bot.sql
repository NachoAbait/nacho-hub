-- NACHO Hub · v10: bot de atención a clientes por WhatsApp (DM Handler, BNB).
-- Un hilo por teléfono, con todos los mensajes (cliente y bot) para que el agente
-- tenga memoria de la conversación entre corridas. Idempotente.

create table if not exists public.customer_conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  status text not null default 'open' check (status in ('open', 'handed_off')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.customer_conversations(id) on delete cascade,
  role text not null check (role in ('customer', 'bot')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_messages_conversation_idx on public.customer_messages(conversation_id, created_at);
