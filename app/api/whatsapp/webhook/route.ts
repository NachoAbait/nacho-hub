import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { findAllowedSupplier } from "@/lib/suppliers";
import { ingestPriceList } from "@/lib/agents/ingest";
import { answerCustomerMessage } from "@/lib/agents/customer-bot";
import { parseInboundWebhook, sendWhatsAppMessage } from "@/lib/whatsapp-cloud";

// Hasta 60s en Vercel Hobby: el parseo con Claude puede tardar unos segundos.
export const maxDuration = 60;

/**
 * GET: verificación del webhook que pide Meta al conectarlo (hub.mode=subscribe).
 * POST: mensajes entrantes del número oficial de la oficina (Meta Cloud API).
 * Un solo número para todo: si el remitente es un proveedor cargado, va a Lucas
 * (mismo camino que hoy, vía Baileys); si no, lo atiende el bot de clientes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  const inbound = body ? parseInboundWebhook(body) : null;
  // Meta también manda webhooks de "status" (entregado/leído) sin mensaje: se ignoran en silencio.
  if (!inbound) return NextResponse.json({ ok: true, ignored: true });

  try {
    const db = supabaseAdmin();
    const supplier = await findAllowedSupplier(db, inbound.from);
    if (supplier) {
      const result = await ingestPriceList({
        source: "whatsapp",
        sender: inbound.from,
        sender_name: inbound.name,
        body: inbound.text,
      });
      return NextResponse.json({ ok: true, lane: "supplier", result });
    }

    const { replies } = await answerCustomerMessage(inbound.from, inbound.name, inbound.text);
    for (const reply of replies) await sendWhatsAppMessage(inbound.from, reply);
    return NextResponse.json({ ok: true, lane: "customer" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[whatsapp/webhook]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
