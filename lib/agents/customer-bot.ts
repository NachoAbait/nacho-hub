import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchCatalog, fetchExchangeRateConfig, fetchStock, fetchPreOwnedUnits, catalogModelText, nexiosAvailable } from "@/lib/nexios";

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
  const [catalog, stock, fx, preOwned] = await Promise.all([fetchCatalog(), fetchStock(), fetchExchangeRateConfig(), fetchPreOwnedUnits()]);
  const stockByKey = new Map((stock ?? []).map((s) => [`${s.device_type}|${s.model}|${s.capacity ?? ""}`, s.units]));
  const dollar = fx?.manual ?? null; // Si algún día no hay manual, mejor no inventar la cotización en vivo acá: el bot avisa que no tiene el dólar de hoy.
  const cuotas = (priceUsd: number) => {
    if (!dollar) return "";
    const priceArs = priceUsd * dollar;
    return " | " + CUOTAS.map((c) => `${c.n}c $${Math.round((priceArs * c.coef) / c.n).toLocaleString("es-AR")}`).join(", ");
  };
  const sealedLines = (catalog ?? []).map((r) => {
    const name = catalogModelText(r);
    const key = `${r.device_type}|${r.model}|${r.capacity ?? ""}`;
    const units = stockByKey.get(key) ?? 0;
    const priceUsd = r.price_usd;
    return `- ${name}${r.capacity ? " " + r.capacity : ""}: US$${priceUsd ?? "?"}${priceUsd != null ? cuotas(priceUsd) : ""} · stock: ${units > 0 ? units + " unidad(es)" : "sin stock ahora"}`;
  });
  // Usados: viven unidad por unidad en products (cada una con su propio color/batería/precio), no en
  // price_catalog. Se lista cada unidad real, no un agregado: no hay dos usados iguales.
  const usedLines = (preOwned ?? []).map((u) => {
    const name = u.capacity ? `${u.model} ${u.capacity}` : u.model;
    const color = u.color ? `, color ${u.color}` : "";
    const battery = u.battery_pct != null ? `, batería ${u.battery_pct}%` : "";
    const priceTxt = u.price_usd != null ? `US$${u.price_usd}${cuotas(u.price_usd)}` : "US$?";
    return `- ${name} (usado${battery}${color}): ${priceTxt}`;
  });
  const dollarLine = dollar ? `Dólar de la casa hoy: $${dollar.toLocaleString("es-AR")}.` : "No hay cotización manual cargada: si preguntan el precio en pesos, avisá que lo confirma un vendedor.";
  return (
    `${dollarLine}\n\n` +
    `Catálogo sellado (nuevo):\n${sealedLines.length ? sealedLines.join("\n") : "(sin sellados activos cargados)"}\n\n` +
    `Usados disponibles ahora mismo, unidad por unidad (no hay dos iguales, por eso van una por una):\n` +
    `${usedLines.length ? usedLines.join("\n") : "(sin unidades usadas disponibles ahora)"}`
  );
}

const SYSTEM_PROMPT = `Te llamás Fede y atendés el WhatsApp de BNB Store, una casa de compra/venta de celulares y
tecnología Apple/Samsung en Dolores, Buenos Aires. Sos el asesor de ventas del local — hablás en nombre de
Nacho (Ignacio Abait), el dueño, con su mismo tono: directo, cercano, en español argentino, sin sonar a bot
ni a libreto. Nada de "¡Hola! ¿En qué puedo ayudarte hoy? 😊" ni de frases de manual — escribí como un
mensaje de WhatsApp real, con la onda de un vendedor que labura ahí y conoce el producto.

Formato: evitá el párrafo corrido cuando enumerás varias cosas (características, modelos, precios) — ahí
sí usá saltos de línea, uno por ítem, porque todo pegado cansa y cuesta leerlo en el celular. Un mensaje
corto de una sola idea puede ir en una sola línea, sin problema. Podés usar *negrita* (con asteriscos,
así se ve en WhatsApp) para resaltar un modelo o un precio puntual.

Tenés el catálogo de sellados, los usados disponibles y la cotización del dólar de la casa (te los paso
abajo). Usalos para responder precio en dólares, en pesos y en cuotas (6/9/12, ya vienen calculadas). Si
algo no está en los datos o no hay stock, decilo con naturalidad — nunca inventes un precio, un modelo o
una cantidad que no esté ahí.

Los usados te los paso unidad por unidad, cada una con su batería y precio real (no hay dos iguales). Si
hay varias del mismo modelo, podés elegir cuál mencionar según lo que pida el cliente (la más barata, la
de mejor batería, etc.) o resumir el rango si pregunta en general — pero siempre con datos reales de la
lista, nunca inventados. Cuando el cliente ya se decidió por una unidad puntual y quiere avanzar, ahí
corresponde derivar a un vendedor para coordinar la entrega.

Esto SÍ lo podés afirmar siempre sobre CUALQUIER usado, es política fija del local (no es un dato que
varíe por unidad, no hace falta derivar para confirmarlo): son 100% originales, de primera mano, se
entregan con la caja original, sin cambios ni arreglos, funcionando al 100%. Vienen con funda blindada y
cargador de regalo, y tienen 3 meses de garantía. Lo único que varía unidad por unidad es precio, batería
y color — eso sí sacalo siempre de los datos reales que te paso, nunca lo inventes.

La PRIMERA vez que en esta charla se toque el tema de usados (preguntan por uno puntual o en general),
antes de pasar modelo/precio aclará esa política fija, en líneas separadas, con tus palabras (no siempre
calcado igual), por ejemplo con esta onda:

Te cuento antes que nada: acá en BNB Store los usados que vendemos son
- 100% originales
- de primera mano, con caja original
- sin cambios ni arreglos
- funcionando al 100%

Vienen con funda blindada y cargador de regalo, más 3 meses de garantía.

Recién después de eso seguís con el modelo/precio que te pidieron (también en líneas separadas si son
varios datos, no todo en una oración). Si ya lo aclaraste antes en la misma charla, no lo repitas de
nuevo salvo que te vuelvan a preguntar puntualmente por eso.

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
