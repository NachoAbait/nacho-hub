import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { claimPendingOutbox, markOutboxError, markOutboxSent } from "@/lib/customer-outbox";
import { deliverDueOwnerReminders } from "@/lib/agents/owner-reminders";

/**
 * GET /api/agents/customer-bot/outbox — el puente hace polling cada pocos segundos: devuelve
 * respuestas del bot pendientes de mandar (y las marca 'sending' en el mismo paso, ver
 * claimPendingOutbox) para no entregar la misma fila dos veces si un poll se solapa con el anterior.
 *
 * POST /api/agents/customer-bot/outbox — el puente avisa el resultado real del envío por Baileys.
 * Body: { id, status: "sent" | "error", error?: string }
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // El puente ya pollea esto cada pocos segundos sin parar: es el mismo lugar donde se fijan los
  // recordatorios que ya vencieron, sin necesidad de un cron propio (ver owner-reminders.ts).
  await deliverDueOwnerReminders();
  const items = await claimPendingOutbox();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 });
  }
  const id = typeof b.id === "string" ? b.id : null;
  const status = b.status === "sent" || b.status === "error" ? b.status : null;
  if (!id || !status) return NextResponse.json({ error: "Faltan id o status (sent/error)" }, { status: 400 });

  if (status === "sent") await markOutboxSent(id);
  else await markOutboxError(id, typeof b.error === "string" ? b.error : "error desconocido del puente");
  return NextResponse.json({ ok: true });
}
