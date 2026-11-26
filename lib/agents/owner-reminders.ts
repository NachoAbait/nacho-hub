import { z } from "zod";
import { askJson } from "@/lib/claude";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Recordatorios que Nacho le pide a su propio bot por WhatsApp ("recordame el pedido de Joaco
 * Peppe a las 17hs"). Ver schema-v15-owner-reminders.sql para el por qué de la tabla separada y de
 * colgarse del polling de customer_outbox en vez de un cron propio.
 */

const ReminderParseSchema = z.object({
  /** true SOLO si el mensaje pide explícitamente que le avisen/recuerden algo en un momento futuro. */
  isReminder: z.boolean(),
  /** ISO 8601 con offset -03:00, solo si isReminder=true. */
  dueAt: z.string().nullable(),
  /** El texto a mandarle en ese momento, solo si isReminder=true. */
  body: z.string().nullable(),
});

const SYSTEM = `Sos un parser: Nacho (el dueño de BNB Store) le escribe a su propio bot de WhatsApp para pedirle
que le recuerde algo más tarde ("recordame...", "avisame a las...", "hacé acordar a tal hora...").
Tu único trabajo es decidir si ESTE mensaje puntual es un pedido de recordatorio, y si lo es,
extraer CUÁNDO hay que avisarle y QUÉ texto mandarle en ese momento.

Reglas:
- "isReminder" true SOLO si el mensaje pide explícitamente que le avisen/recuerden algo en un
  momento futuro reconocible. Una pregunta normal, un pedido de un cliente, o un comentario sin
  horario → false, y "dueAt"/"body" quedan null.
- "dueAt": ISO 8601 completo con el offset -03:00 (ej. "2026-11-26T20:00:00-03:00"), resuelto
  contra la fecha/hora de HOY que te paso en el mensaje. "a las 17hs" = hoy a las 17:00 si esa hora
  todavía no pasó, si no mañana a esa hora. "en una hora", "mañana a la mañana", etc. se resuelven
  igual, en hora de Argentina.
- "body": el texto tal cual se lo tenés que mandar a Nacho en ese momento, en español, directo, en
  2da persona imperativa (ej. "Hacé el pedido del iPhone 18 Pro para Joaco Peppe"), SIN el
  "recordame" ni metacomentarios sobre programar algo — es el contenido del aviso, no el pedido de
  programarlo.`;

/** null si el mensaje no es un pedido de recordatorio (o el horario no se pudo resolver a futuro). */
export async function parseReminderRequest(text: string): Promise<{ dueAt: string; body: string } | null> {
  const todayArt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  const result = await askJson({
    agent: "owner-reminders",
    role: "parser",
    system: SYSTEM,
    prompt: `Hoy es ${todayArt} (hora de Argentina). Mensaje de Nacho: "${text}"`,
    schema: ReminderParseSchema,
    effort: "low",
  });

  if (!result.isReminder || !result.dueAt || !result.body) return null;
  const due = new Date(result.dueAt);
  if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) return null;
  return { dueAt: due.toISOString(), body: result.body };
}

export async function createOwnerReminder(dueAt: string, body: string): Promise<void> {
  const { error } = await supabaseAdmin().from("owner_reminders").insert({ due_at: dueAt, body });
  if (error) throw new Error(`No pude guardar el recordatorio: ${error.message}`);
}

/**
 * El puente de WhatsApp (bridge/whatsapp/) hace polling de customer_outbox cada pocos segundos sin
 * parar — esto se cuelga de ESE mismo polling (ver outbox/route.ts) en vez de pedir un cron propio:
 * el plan Hobby de Vercel de este proyecto solo deja crons de una vez por día, inútil para un
 * "recordame a las 17hs" del mismo día (ver nacho-hub-vercel-hobby-60s.md).
 */
export async function deliverDueOwnerReminders(): Promise<void> {
  const ownerPhone = process.env.NACHO_PHONE_NUMBER;
  if (!ownerPhone) return;
  const db = supabaseAdmin();
  const { data: due } = await db
    .from("owner_reminders")
    .select("id, body")
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .returns<{ id: string; body: string }[]>();
  if (!due?.length) return;

  for (const r of due) {
    const { error } = await db.from("customer_outbox").insert({ phone: ownerPhone, body: `⏰ ${r.body}` });
    if (!error) await db.from("owner_reminders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
  }
}
