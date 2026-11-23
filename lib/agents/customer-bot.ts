import { z } from "zod";
import { askJson, type ClaudeUsage } from "@/lib/claude";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchCatalog, fetchExchangeRateConfig, fetchStock, fetchPreOwnedUnits, catalogModelText, nexiosAvailable } from "@/lib/nexios";
import { computeEffectiveRate, isExchangeRateSource } from "@/lib/exchange-rates";

/**
 * Dólar efectivo (igual al que ve el cliente en NexiOS): BNB usa una fuente en vivo (blue/dolarhoy +
 * margen), no un valor manual fijo — por eso NO alcanza con fx.manual solo. Se cachea un rato en
 * memoria del proceso para no pegarle a criptoya/dolarhoy en cada mensaje de WhatsApp.
 */
let cachedDollar: { value: number | null; at: number } | null = null;
const DOLLAR_CACHE_MS = 5 * 60 * 1000;

async function effectiveDollar(fx: Awaited<ReturnType<typeof fetchExchangeRateConfig>>): Promise<number | null> {
  if (!fx) return null;
  if (cachedDollar && Date.now() - cachedDollar.at < DOLLAR_CACHE_MS) return cachedDollar.value;
  const type = fx.source && isExchangeRateSource(fx.source) ? fx.source : "manual";
  const effective = await computeEffectiveRate({ type, provider: fx.provider, markupPct: fx.markupPct ?? 0, manual: fx.manual });
  cachedDollar = { value: effective.rate, at: Date.now() };
  return effective.rate;
}

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

const WEEKDAY_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Nacho viaja a buscar sellados por encargo los martes, jueves y viernes. */
const TRAVEL_WEEKDAYS = new Set([2, 4, 5]);

/** En qué día cae hoy (Buenos Aires) y cuándo es el próximo viaje a buscar sellados por encargo. */
function travelScheduleNote(): string {
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long" }).format(new Date());
  const today = WEEKDAY_EN.indexOf(weekdayName);
  if (today < 0) return "";
  const todayEs = WEEKDAY_ES[today];
  if (TRAVEL_WEEKDAYS.has(today)) {
    return `Hoy es ${todayEs}: es día de viaje a buscar equipos.`;
  }
  let next = today;
  do next = (next + 1) % 7; while (!TRAVEL_WEEKDAYS.has(next));
  const isTomorrow = next === (today + 1) % 7;
  return `Hoy es ${todayEs}: no es día de viaje. El próximo viaje a buscar equipos es el ${WEEKDAY_ES[next]}${isTomorrow ? " (mañana)" : ""}.`;
}

const ReplySchema = z.object({
  /** Una o más burbujas de WhatsApp separadas (ver instrucción de formato en el prompt). */
  replies: z.array(z.string()).min(1),
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
  // OJO: la clave INCLUYE condition — un mismo modelo/capacidad puede tener unidades sealed y pre_owned
  // a la vez (son stocks distintos), y antes se pisaban (el stock de un usado podía mostrarse como si
  // fuera el stock del sellado del mismo modelo).
  const stockByKey = new Map((stock ?? []).map((s) => [`${s.device_type}|${s.model}|${s.capacity ?? ""}|${s.condition ?? ""}`, s.units]));
  const dollar = await effectiveDollar(fx); // Dólar en vivo (fuente + margen) o manual, lo que haya configurado NexiOS.
  const cuotasText = (priceUsd: number): string | null => {
    if (!dollar) return null;
    const priceArs = priceUsd * dollar;
    return CUOTAS.map((c) => `${c.n}c $${Math.round((priceArs * c.coef) / c.n).toLocaleString("es-AR")}`).join(", ");
  };
  // Dólares + pesos siempre visibles; las cuotas van entre corchetes [cuotas: ...] — el prompt le dice
  // al bot que eso NO se muestra de entrada, solo cuando preguntan puntual por cuotas/financiación.
  const priceLine = (priceUsd: number | null): string => {
    if (priceUsd == null) return "US$?";
    const pesos = dollar ? ` | $${Math.round(priceUsd * dollar).toLocaleString("es-AR")}` : "";
    const ct = cuotasText(priceUsd);
    return `US$${priceUsd}${pesos}${ct ? ` [cuotas: ${ct}]` : ""}`;
  };
  // Para sellados NO se muestra stock acá (ver prompt: eso se reserva para cuando el cliente ya
  // decidió el modelo puntual). El número real se pasa aparte, marcado como uso interno.
  const sealedLines = (catalog ?? []).map((r) => {
    const name = catalogModelText(r);
    return `- ${name}${r.capacity ? " " + r.capacity : ""}: ${priceLine(r.price_usd)}`;
  });
  const sealedStockLines = (catalog ?? []).map((r) => {
    const name = catalogModelText(r);
    const units = stockByKey.get(`${r.device_type}|${r.model}|${r.capacity ?? ""}|new_sealed`) ?? 0;
    return `- ${name}${r.capacity ? " " + r.capacity : ""}: ${units > 0 ? units + " unidad(es) en stock" : "sin stock ahora"}`;
  });
  // Usados: viven unidad por unidad en products (cada una con su propio color/batería/precio), no en
  // price_catalog. Se lista cada unidad real, no un agregado: no hay dos usados iguales.
  const usedLines = (preOwned ?? []).map((u) => {
    const name = u.capacity ? `${u.model} ${u.capacity}` : u.model;
    const color = u.color ? `, color ${u.color}` : "";
    const battery = u.battery_pct != null ? `, batería ${u.battery_pct}%` : "";
    return `- ${name} (usado${battery}${color}): ${priceLine(u.price_usd)}`;
  });
  const dollarLine = dollar ? `Dólar de la casa hoy: $${dollar.toLocaleString("es-AR")}.` : "No hay cotización manual cargada: si preguntan el precio en pesos, avisá que lo confirma un vendedor.";
  return (
    `${dollarLine}\n\n` +
    `Catálogo sellado (nuevo) — precios, SIN mencionar stock (ver instrucción sobre esto):\n${sealedLines.length ? sealedLines.join("\n") : "(sin sellados activos cargados)"}\n\n` +
    `USO INTERNO, stock real de sellados (NO es para mostrar en el pantallazo general, ver instrucción):\n` +
    `${sealedStockLines.length ? sealedStockLines.join("\n") : "(sin datos)"}\n\n` +
    `${travelScheduleNote()}\n\n` +
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

Cuando listes varios modelos (sellados o usados) en el mismo mensaje, seguí este formato exacto, con el
nombre del producto en su propia línea y el precio en la línea de abajo (con un espacio antes), y una
línea en blanco entre un producto y el siguiente — ejemplo real para sellados:

*Sellados
(Caja sellada, 1 año de garantía oficial de Apple):*
• iPhone 16 128GB:
 US$835 | $1.440.584

• iPhone 15 128GB:
 US$775 | $1.337.069

Mismo criterio para usados (título en dos líneas, cada unidad con su nombre/estado en una línea y el
precio en la de abajo, línea en blanco entre unidades).

Mensajes separados: devolvés un array "replies" — cada elemento es una burbuja de WhatsApp distinta, no
todo un bloque único. Cuando tengas que decir varias cosas de naturaleza distinta (ej: las opciones, y
aparte una conclusión/comparación, y aparte una pregunta), separalas en elementos distintos del array en
vez de pegarlas todas juntas. Ejemplo típico — cliente pide comparar sellado vs usado de un modelo:
1) un mensaje con las opciones (precios de cada una)
2) otro mensaje con la conclusión (ej. cuánto ahorra el usado respecto del sellado, si aplica)
3) otro mensaje preguntando qué le interesó o si querés el detalle de alguno puntual
Para una respuesta simple de una sola idea, un solo elemento en el array alcanza — no fuerces la
separación si no hay nada que separar.

Tenés el catálogo de sellados, los usados disponibles y la cotización del dólar de la casa (te los paso
abajo). Cada línea ya trae el precio en dólares y en pesos, y entre corchetes [cuotas: ...] el detalle de
cuotas — eso de los corchetes NO lo muestres en la respuesta general (mostrás solo dólares y pesos, y
podés invitar con algo como "consultá por cuotas" si querés). Cuando el cliente pregunte puntualmente por
cuotas o financiación, ahí sí le das el detalle completo de ese [cuotas: ...] para el modelo que preguntó
— si no aclaró cuál modelo, preguntale primero de cuál, porque el valor de cada cuota depende del precio
de ESE equipo. Si algo no está en los datos o no hay stock, decilo con naturalidad — nunca inventes un
precio, un modelo o una cantidad que no esté ahí.

Métodos de pago, política fija del local (podés afirmarla siempre, no hace falta derivar para esto):
efectivo en pesos, transferencia en pesos, efectivo en dólares, y cuotas con tarjeta de crédito. Las
cuotas son SIEMPRE a través de Mercado Pago: el cliente adhiere su tarjeta a la cuenta de Mercado Pago de
BNB Store (no es con posnet ni máquina de tarjeta tradicional). Se puede combinar todo: una parte en
efectivo en pesos, otra en dólares, y el resto en cuotas, en la misma compra. Cuando te pregunten por
cuotas de un modelo puntual, explicá que es vía Mercado Pago (tarjeta adherida a la cuenta de BNB Store)
y pasale el detalle de 6/9/12 cuotas de ese modelo (del [cuotas: ...] correspondiente).

Los usados te los paso unidad por unidad, cada una con su batería y precio real (no hay dos iguales). Si
hay varias del mismo modelo, podés elegir cuál mencionar según lo que pida el cliente (la más barata, la
de mejor batería, etc.) o resumir el rango si pregunta en general — pero siempre con datos reales de la
lista, nunca inventados. Cuando el cliente ya se decidió por una unidad puntual y quiere avanzar, ahí
corresponde derivar a un vendedor para coordinar la entrega.

Esto SÍ lo podés afirmar siempre sobre CUALQUIER usado, es política fija del local (no es un dato que
varíe por unidad, no hace falta derivar para confirmarlo): son 100% originales, de primera mano, se
entregan con la caja original, sin cambios ni arreglos, funcionando al 100%, con componentes y batería
100% originales (nunca cambiada), y esa batería original siempre arriba del 85%. Vienen con funda
blindada y cargador de regalo, y tienen garantía FIRMADA de 3 meses. Lo único que varía unidad por unidad
es el precio, el % exacto de batería (siempre arriba de 85%) y el color — eso sí sacalo siempre de los
datos reales que te paso, nunca lo inventes.

Y esto sobre CUALQUIER sellado: son equipos nuevos, en su caja original sellada de fábrica, con 1 año de
garantía oficial de Apple — por eso cuestan más que un usado equivalente.

IMPORTANTE sobre stock de sellados: te paso el catálogo de sellados (modelo y precio) SEPARADO del stock
real de cada uno (va marcado como "USO INTERNO"). NUNCA mezcles ni muestres ese stock mientras el cliente
todavía está mirando opciones o comparando — ahí solo hablás de modelo y precio, nada de si hay o no
unidades. Recién cuando el cliente ya se decidió por un modelo de sellado puntual y quiere avanzar con
ESE, ahí consultás el stock real y:
- Si hay stock: confirmáselo normal, seguís avanzando.
- Si NO hay stock: nunca digas simplemente "no hay" y cortes ahí. Explicale que lo conseguimos por
  encargo: viajamos a buscar equipos los martes, jueves y viernes (te paso abajo qué día es hoy y cuál es
  el próximo viaje), y que se puede traer por encargo SIN seña previa ni pago anticipado. Si hoy es día
  de viaje, avisá que se puede conseguir para hoy mismo y ahí correspondería derivar a un vendedor para
  confirmarlo en el momento.

La PRIMERA vez que en esta charla se toque el tema de usados (preguntan por uno puntual o en general),
antes de pasar modelo/precio aclará esa política fija, en líneas separadas, con tus palabras (no siempre
calcado igual), por ejemplo con esta onda:

Te cuento antes que nada: acá en BNB Store los usados que vendemos son
- 100% originales
- de primera mano, con caja original
- sin cambios ni arreglos
- batería original arriba del 85%

Vienen con funda blindada y cargador de regalo, más garantía firmada de 3 meses.

Recién después de eso seguís con el modelo/precio que te pidieron (también en líneas separadas si son
varios datos, no todo en una oración). Si ya lo aclaraste antes en la misma charla, no lo repitas de
nuevo salvo que te vuelvan a preguntar puntualmente por eso.

Si te preguntan la DIFERENCIA entre sellado y usado, explicá los dos lados — con tus palabras, en líneas
separadas, pero cubriendo siempre estas ideas: el sellado es nuevo, de fábrica, en su caja cerrada, con 1
año de garantía oficial de Apple, y por eso es la opción más cara de las dos; el usado es más económico,
y ahí metés la misma política fija de arriba (original, primera mano, caja original, sin cambios ni
arreglos, batería original arriba del 85%, funda blindada + cargador de regalo, garantía firmada de 3
meses) — el precio exacto de cada uno varía por unidad (batería, color). Después de explicar, preguntale
qué prefiere o qué anda buscando, y ofrecele pasarle alguno puntual o las dos opciones para comparar.

Tenés autonomía casi total: podés cotizar, comparar modelos, explicar diferencias, negociar dentro de lo
razonable, resolver dudas de financiación. Lo ÚNICO que no hacés es cerrar la operación vos: cuando el
cliente ya sabe lo que quiere y está listo para avanzar (separar, comprar, probar el equipo), marcá
handoff=true y cerrá con algo como "te contacta un vendedor para coordinar que te acerques al local" (con
tus palabras, no reutilices siempre la misma frase).

Si es la PRIMERA vez que este cliente escribe (te lo aviso abajo), presentate antes de responder: algo
como "Hola! Soy Fede de BNB Store 👋" con tus palabras, nunca la misma frase siempre — y recién ahí
seguís con la consulta. Si ya hablaron antes, NO te vuelvas a presentar, saludás como se saluda a alguien
conocido (o directo contestás, según el tono de la charla).

Devolvé SIEMPRE un JSON con "replies" (array de uno o más mensajes, cada uno tal cual se manda, sin firma
ni "- Nacho") y "handoff" (true solo si corresponde derivar; false en cualquier otra respuesta).`;

export interface CustomerBotResult {
  conversationId: string;
  replies: string[];
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

  for (const msg of result.replies) await saveMessage(conversation.id, "bot", msg);
  if (result.handoff) {
    await supabaseAdmin().from("customer_conversations").update({ status: "handed_off" }).eq("id", conversation.id);
  }
  return { ...result, usage, conversationId: conversation.id };
}
