"use client";

import { useEffect, useState } from "react";
import { loadCustomerConversations, loadCustomerMessages, type CustomerConversation, type CustomerMessageRow } from "@/app/actions";
import { PanelSkeleton } from "@/components/office/skeleton";

const STATUS_LABEL: Record<CustomerConversation["status"], string> = {
  open: "Abierta",
  handed_off: "Derivada a vos",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ConversationThread({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<CustomerMessageRow[] | null>(null);
  useEffect(() => {
    setMessages(null);
    loadCustomerMessages(conversationId).then(setMessages);
  }, [conversationId]);

  if (messages === null) return <PanelSkeleton />;
  if (messages.length === 0) return <p className="text-[11px] text-white/40">Sin mensajes.</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${
            m.role === "customer" ? "self-start bg-white/10 text-white/90" : "self-end bg-amber-400/15 text-amber-100"
          }`}
        >
          <p>{m.body}</p>
          <p className="mt-0.5 text-[9px] text-white/35">{fmtTime(m.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Conversaciones del bot de clientes por WhatsApp — ver loadCustomerConversations en app/actions.ts
 * para el por qué vive acá (sin agente propio en la oficina todavía). Una card por conversación, se
 * expande para ver el hilo completo. Vacío hasta que entren mensajes reales (falta Meta).
 */
export function CustomerConversationsPanel() {
  const [items, setItems] = useState<CustomerConversation[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { loadCustomerConversations().then(setItems); }, []);

  if (items === null) return <PanelSkeleton />;

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        Conversaciones con clientes (WhatsApp)
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-white/50">
          Todavía no hay conversaciones — falta terminar la verificación del negocio en Meta Business Manager para
          que el bot pueda recibir mensajes reales.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-[11px]">
          {items.map((c) => {
            const isOpen = open === c.id;
            return (
              <div key={c.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(isOpen ? null : c.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-white/90">{c.name || c.phone}</span>
                      <span className="flex-none text-[10px] uppercase tracking-wider text-white/40">{STATUS_LABEL[c.status]}</span>
                    </div>
                    {c.name && <div className="text-[10px] text-white/40">{c.phone}</div>}
                    {c.lastMessagePreview && <p className="mt-1 truncate text-white/60">{c.lastMessagePreview}</p>}
                  </div>
                  <div className="flex-none text-right text-[10px] text-white/35">
                    <div>{fmtTime(c.lastMessageAt)}</div>
                    <div>{c.messageCount} msj.</div>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-white/10 pt-2">
                    <ConversationThread conversationId={c.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
