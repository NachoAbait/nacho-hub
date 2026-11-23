import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchCatalog, fetchExchangeRateConfig, fetchStock, catalogModelText, nexiosAvailable } from "@/lib/nexios";

/**
 * Coeficientes de financiación con tarjeta, copiados de resellerapp (src/lib/cuotas.ts).
 * Viven duplicados a propósito: NexiOS es la fuente real para la venta, esto es solo para
 * que el bot pueda cotizar en cuotas sin depender de ese repo. Si Nacho cambia los coeficientes
 * allá, hay que actualizarlos acá también.
 */
const CUOTAS: { n: number; coef: number }[] = [
  { n: 6, coef: 1.414 },
  { n: 9, coef: 1.534 },
  { n: 12, coef: 1.663 },
];

const ReplySchema = z.object({
  reply: z.string(),
  /** true cuando el bot ya resolvió la consulta y corresponde cerrar derivando a un vendedor. */
  handoff: z.boolean(),
});

interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  status: "open" | "handed_off";
}

async function getOrCreateConversation(phone: string, name: string | null): Promise<Conversation> {
  const db = supabaseAdmin();
  const { data: existing } = await db.from("customer_conversations").select("*").eq("phone", phone).maybeSingle<Conversation>();
  if (existing) return existing;
  const { data: created, error } = await db
    .from("customer_conversations")
    .insert({ phone, name })
    .select("*")
    .single<Conversation>();
  if (error) throw new Error(`No pude crear la conversación: ${error.message}`);
  return created;
}

async function recentHistory(conversationId: string): Promise<{ role: "customer" | "bot"; body: string }[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("customer_messages")
    .select("role, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<{ role: "customer" | "bot"; body: string }[]>();
  return (data ?? []).reverse();
}

async function saveMessage(conversationId: string, role: "customer" | "bot", body: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("customer_messages").insert({ conversation_id: conversationId, role, body });
  await db.from("customer_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
}

/** Catálogo + stock + cotización armados en texto plano para el prompt: precio USD, pesos y cuotas. */
async function catalogContext(): Promise<string> {
  if (!nexiosAvailable()) return "(Sin acceso al catálogo de NexiOS ahora mismo: no inventes precios ni stock, decile al cliente que un vendedor le confirma.)";
  const [catalog, stock, fx] = await Promise.all([fetchCatalog(), fetchStock(), fetchExchangeRateConfig()]);
  const stockByKey = new Map((stock ?? []).map((s) => [`${s.device_type}|${s.model}|${s.capacity ?? ""}`, s.units]));
  const dollar = fx?.manual ?? null; // Si algún día no hay manual, mejor no inventar la cotización en vivo acá: el bot avisa que no tiene el dólar de hoy.
  const lines = (catalog ?? []).map((r) => {
    const name = catalogModelText(r);
    const key = `${r.device_type}|${r.model}|${r.capacity ?? ""}`;
    const units = stockByKey.get(key) ?? 0;
    const priceUsd = r.price_usd;
    let cuotasTxt = "";
    if (priceUsd != null && dollar) {
      const priceArs = priceUsd * dollar;
      cuotasTxt = " | " + CUOTAS.map((c) => `${c.n}c $${Math.round((priceArs * c.coef) / c.n).toLocaleString("es-AR")}`).join(", ");
    }
    return `- ${name}${r.capacity ? " " + r.capacity : ""}: US$${priceUsd ?? "?"}${cuotasTxt} · stock: ${units > 0 ? units + " unidad(es)" : "sin stock ahora"}`;
  });
  const dollarLine = dollar ? `Dólar de la casa hoy: $${dollar.toLocaleString("es-AR")}.` : "No hay cotización manual cargada: si preguntan el precio en pesos, avisá que lo confirma un vendedor.";
  return `${dollarLine}\n\nCatálogo (sellado, nuevo):\n${lines.join("\n")}`;
}

const SYSTEM_PROMPT = `Te llamás Fede y atendés el WhatsApp de BNB Store, una casa de compra/venta de celulares y
tecnología Apple/Samsung en Dolores, Buenos Aires. Sos el asesor de ventas del local — hablás en nombre de
Nacho (Ignacio Abait), el dueño, con su mismo tono: directo, cercano, en español argentino, sin sonar a bot
ni a libreto. Nada de "¡Hola! ¿En qué puedo ayudarte hoy? 😊" ni de bullets acartonados — escribí como un
mensaje de WhatsApp real, corto, con la onda de un vendedor que labura ahí y conoce el producto.

Tenés el catálogo, el stock real y la cotización del dólar de la casa (te los paso abajo). Usalos para
responder precio en dólares, en pesos y en cuotas (6/9/12, ya vienen calculadas). Si algo no está en el
catálogo o no hay stock, decilo con naturalidad — nunca inventes un precio, un modelo o una cantidad que
no esté en los datos.

Tenés autonomía casi total: podés cotizar, comparar modelos, explicar diferencias, negociar dentro de lo
razonable, resolver dudas de financiación. Lo ÚNICO que no hacés es cerrar la operación vos: cuando el
cliente ya sabe lo que quiere y está listo para avanzar (separar, comprar, probar el equipo), marcá
handoff=true y cerrá con algo como "te contacta un vendedor para coordinar que te acerques al local" (con
tus palabras, no reutilices siempre la misma frase).

Si es la PRIMERA vez que este cliente escribe (te lo aviso abajo), presentate antes de responder: algo
como "Hola! Soy Fede de BNB Store 👋" con tus palabras, nunca la misma frase siempre — y recién ahí
seguís con la consulta. Si ya hablaron antes, NO te vuelvas a presentar, saludás como se saluda a alguien
conocido (o directo contestás, según el tono de la charla).

Devolvé SIEMPRE un JSON con "reply" (el mensaje que se manda tal cual, sin firma ni "- Nacho") y
"handoff" (true solo en el mensaje donde corresponde derivar; false en cualquier otra respuesta).`;

export interface CustomerBotResult {
  conversationId: string;
  reply: string;
  handoff: boolean;
  usage: ClaudeUsage[];
}

/** Responde un mensaje de un cliente por WhatsApp. No toca proveedores: eso sigue siendo Lucas. */
export async function answerCustomerMessage(phone: string, name: string | null, incoming: string): Promise<CustomerBotResult> {
  const conversation = await getOrCreateConversation(phone, name);
  await saveMessage(conversation.id, "customer", incoming);

  const [history, catalog] = await Promise.all([recentHistory(conversation.id), catalogContext()]);
  const transcript = history.map((m) => `${m.role === "customer" ? "Cliente" : "Vos"}: ${m.body}`).join("\n");
  const isFirstContact = !history.some((m) => m.role === "bot");

  const usage: ClaudeUsage[] = [];
  const result = await askJson({
    agent: "customer-bot",
    role: "analyst",
    system: SYSTEM_PROMPT,
    prompt:
      `${catalog}\n\n---\n` +
      `${isFirstContact ? "Este cliente te escribe por primera vez: presentate." : "Ya hablaron antes: no te vuelvas a presentar."}\n\n` +
      `Conversación con ${name ?? "este cliente"} hasta ahora:\n${transcript}\n\nRespondé el último mensaje del cliente.`,
    schema: ReplySchema,
    usage,
  });

  await saveMessage(conversation.id, "bot", result.reply);
  if (result.handoff) {
    await supabaseAdmin().from("customer_conversations").update({ status: "handed_off" }).eq("id", conversation.id);
  }
  return { ...result, usage, conversationId: conversation.id };
}
