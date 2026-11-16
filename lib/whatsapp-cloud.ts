/**
 * Transporte oficial de WhatsApp (Meta Cloud API) para el bot de clientes.
 * Lucas (proveedores) sigue entrando por el puente de Baileys; esto es solo para
 * mandar y recibir mensajes del mismo número de la oficina del lado de clientes.
 *
 * Variables de entorno:
 * - WHATSAPP_ACCESS_TOKEN: token permanente del usuario de sistema (Business Manager).
 * - WHATSAPP_PHONE_NUMBER_ID: el "Phone number ID" que da Meta al conectar el número (no el teléfono).
 * - WHATSAPP_VERIFY_TOKEN: string elegida por Nacho para que Meta verifique el webhook.
 */

const GRAPH_URL = "https://graph.facebook.com/v22.0";

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("Falta WHATSAPP_PHONE_NUMBER_ID");
  return id;
}

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("Falta WHATSAPP_ACCESS_TOKEN");
  return token;
}

/** Manda un mensaje de texto plano. `to` en formato internacional sin "+" (ej. 5492257123456). */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH_URL}/${phoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp Cloud API ${res.status}: ${detail}`);
  }
}

export interface InboundWhatsAppMessage {
  from: string;
  name: string | null;
  text: string;
  messageId: string;
}

/** Extrae el primer mensaje de texto de un webhook de Meta. Null si no es un mensaje de texto (status, imagen, etc). */
export function parseInboundWebhook(body: unknown): InboundWhatsAppMessage | null {
  const entry = (body as { entry?: unknown[] })?.entry?.[0] as { changes?: unknown[] } | undefined;
  const value = (entry?.changes?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
  if (!value) return null;
  const messages = value.messages as Array<Record<string, unknown>> | undefined;
  const msg = messages?.[0];
  if (!msg || msg.type !== "text") return null;
  const contacts = value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined;
  const text = (msg.text as { body?: string } | undefined)?.body;
  if (typeof text !== "string" || typeof msg.from !== "string" || typeof msg.id !== "string") return null;
  return {
    from: msg.from,
    name: contacts?.[0]?.profile?.name ?? null,
    text,
    messageId: msg.id,
  };
}
