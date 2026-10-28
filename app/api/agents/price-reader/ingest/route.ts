import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { ingestPriceList } from "@/lib/agents/ingest";

// Parseo con Claude + actualización de NexiOS + banners: hasta 60 s en Vercel Hobby.
export const maxDuration = 60;

/**
 * POST /api/agents/price-reader/ingest
 * Authorization: Bearer <CRON_SECRET>
 * Body: { sender, sender_name, body, received_at, source, broadcast? }
 * Solo procesa remitentes que Nacho cargó como proveedores; el resto responde { ignored: true }.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 });
  }
  if (typeof b.body !== "string") return NextResponse.json({ error: "Falta body (texto)" }, { status: 400 });

  try {
    const result = await ingestPriceList({
      source: b.source === "manual" ? "manual" : "whatsapp",
      sender: typeof b.sender === "string" ? b.sender : null,
      sender_name: typeof b.sender_name === "string" ? b.sender_name : null,
      body: b.body,
      received_at: typeof b.received_at === "string" ? b.received_at : undefined,
      broadcast: b.broadcast === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[price-reader/ingest]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
