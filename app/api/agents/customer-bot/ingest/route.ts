import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { answerCustomerMessage } from "@/lib/agents/customer-bot";
import { enqueueOutboxMessage } from "@/lib/customer-outbox";

export const maxDuration = 60;

/**
 * POST /api/agents/customer-bot/ingest
 * Authorization: Bearer <CRON_SECRET>
 * Body: { sender, sender_name, body }
 *
 * Mensajes del puente de Baileys DEDICADO al bot de clientes (número nuevo, separado del de la
 * oficina — ver bridge/whatsapp-customer/). No confundir con /api/agents/price-reader/ingest: ese
 * es el puente viejo, de proveedores, en el número de la oficina. Acá no hace falta filtrar por
 * remitente permitido — todo lo que llega a este número es un cliente.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 });
  }
  const sender = typeof b.sender === "string" ? b.sender : null;
  const body = typeof b.body === "string" ? b.body : null;
  if (!sender || !body) return NextResponse.json({ error: "Faltan sender o body" }, { status: 400 });
  const senderName = typeof b.sender_name === "string" ? b.sender_name : null;

  try {
    const { conversationId, reply } = await answerCustomerMessage(sender, senderName, body);
    await enqueueOutboxMessage(conversationId, sender, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[customer-bot/ingest]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
