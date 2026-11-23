import { supabaseAdmin } from "@/lib/supabase";

export interface OutboxItem {
  id: string;
  phone: string;
  body: string;
}

/**
 * Encola una respuesta del bot para que el puente de Baileys dedicado la mande — ver
 * schema-v14-customer-outbox.sql para el por qué: el número de clientes es nuevo y separado del de la
 * oficina, así que no hay forma de que el hub (serverless) le hable directo al puente (corre en la
 * compu de Nacho, sin IP pública); el puente hace polling acá.
 */
export async function enqueueOutboxMessage(conversationId: string, phone: string, body: string): Promise<void> {
  const { error } = await supabaseAdmin().from("customer_outbox").insert({ conversation_id: conversationId, phone, body });
  if (error) throw new Error(`No pude encolar la respuesta: ${error.message}`);
}

/**
 * El puente llama esto por polling. "Reclama" las filas pendientes marcándolas 'sending' en el mismo
 * paso (no un simple select) para que dos polls seguidos no agarren la misma fila dos veces si el envío
 * anterior todavía no terminó de marcarse.
 */
export async function claimPendingOutbox(limit = 20): Promise<OutboxItem[]> {
  const db = supabaseAdmin();
  const { data: pending } = await db
    .from("customer_outbox")
    .select("id, phone, body")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<OutboxItem[]>();
  if (!pending?.length) return [];

  const ids = pending.map((r) => r.id);
  const { data: claimed } = await db
    .from("customer_outbox")
    .update({ status: "sending" })
    .in("id", ids)
    .eq("status", "pending") // por si otro poll ya las agarró entre el select y el update
    .select("id, phone, body")
    .returns<OutboxItem[]>();
  return claimed ?? [];
}

export async function markOutboxSent(id: string): Promise<void> {
  await supabaseAdmin().from("customer_outbox").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
}

export async function markOutboxError(id: string, message: string): Promise<void> {
  await supabaseAdmin().from("customer_outbox").update({ status: "error", error_message: message }).eq("id", id);
}
