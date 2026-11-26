import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { answerCustomerMessage } from "@/lib/agents/customer-bot";
import { createOwnerReminder, parseReminderRequest } from "@/lib/agents/owner-reminders";
import { enqueueOutboxMessage, notifyOwnerOfHandoff } from "@/lib/customer-outbox";

/** sender tal como lo manda el puente (puede traer o no el "9" del celu argentino) vs el número
 * cargado en .env: comparamos solo dígitos para no depender de que coincida el formato exacto. */
function isOwnerPhone(sender: string): boolean {
  const owner = process.env.NACHO_PHONE_NUMBER;
  return !!owner && sender.replace(/\D/g, "") === owner.replace(/\D/g, "");
}

export const maxDuration = 60;

/**
 * POST /api/agents/customer-bot/ingest
 * Authorization: Bearer <CRON_SECRET>
 * Body: { sender, sender_name, body }
 *
 * Mensajes del puente de Baileys (bridge/whatsapp/, el mismo número de la oficina) para remitentes
 * que el hub NO reconoce como proveedor cargado — ver ingestPriceList en lib/agents/ingest.ts, que
 * es quien decide y reenvía acá. Acá no hace falta filtrar de nuevo: todo lo que llega ya es cliente.
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
    // Nacho pidiéndole un recordatorio a su propio bot ("recordame X a las Y"): se resuelve acá,
    // antes del flujo normal de cliente — ver lib/agents/owner-reminders.ts.
    if (isOwnerPhone(sender)) {
      const reminder = await parseReminderRequest(body);
      if (reminder) {
        await createOwnerReminder(reminder.dueAt, reminder.body);
        const when = new Intl.DateTimeFormat("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(reminder.dueAt));
        await enqueueOutboxMessage(null, sender, `Dale, te aviso el ${when} hs: "${reminder.body}"`);
        return NextResponse.json({ ok: true, reminder: true });
      }
    }

    const { conversationId, replies, handoff, handoffSummary } = await answerCustomerMessage(sender, senderName, body);
    for (const reply of replies) await enqueueOutboxMessage(conversationId, sender, reply);
    if (handoff) await notifyOwnerOfHandoff(conversationId, sender, senderName, handoffSummary);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[customer-bot/ingest]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
