import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Proveedores. Regla del dueño: SOLO se procesan los remitentes que Nacho cargó a mano
 * (tabla suppliers con active = true, o hub_settings.supplier_senders). Todo lo demás se ignora.
 */

export interface Supplier {
  id: string;
  phone: string;
  name: string | null;
  rules: Record<string, unknown>;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  messages_count: number;
}

/** "5492257123456:12@s.whatsapp.net" → "5492257123456". */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.split("@")[0].split(":")[0].replace(/\D/g, "");
}

/** Clave de comparación: los últimos 10 dígitos (iguala +54 9 2257…, 54 2257… y 2257… sin prefijos). */
export function phoneKey(raw: string | null | undefined): string {
  return normalizePhone(raw).slice(-10);
}

export async function listSuppliers(db: SupabaseClient): Promise<Supplier[]> {
  const { data } = await db.from("suppliers").select("*").order("name", { ascending: true, nullsFirst: false }).returns<Supplier[]>();
  return data ?? [];
}

/** ¿Este remitente es un proveedor cargado por Nacho? Devuelve la fila (creándola si solo estaba en supplier_senders). */
export async function findAllowedSupplier(db: SupabaseClient, sender: string): Promise<Supplier | null> {
  const key = phoneKey(sender);
  if (key.length < 8) return null;
  const all = await listSuppliers(db);
  const hit = all.find((s) => phoneKey(s.phone) === key);
  if (hit) return hit.active ? hit : null;

  const { data: setting } = await db.from("hub_settings").select("value").eq("key", "supplier_senders").maybeSingle<{ value: unknown }>();
  const senders = Array.isArray(setting?.value) ? (setting.value as unknown[]).map(String) : [];
  if (!senders.some((n) => phoneKey(n) === key)) return null;
  const { data: created } = await db
    .from("suppliers")
    .upsert({ phone: normalizePhone(sender), active: true }, { onConflict: "phone" })
    .select("*")
    .single<Supplier>();
  return created ?? null;
}

/**
 * Guarda la lista que Nacho edita en el panel: una línea por proveedor, "número" o "número, nombre".
 * Los de la lista quedan activos; los que se sacaron quedan inactivos (no se borran: conservan reglas e historial).
 * hub_settings.supplier_senders queda sincronizado con los números activos.
 */
export async function saveSupplierList(db: SupabaseClient, text: string): Promise<{ active: number; deactivated: number }> {
  const entries = new Map<string, { phone: string; name: string | null }>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([+\d][\d\s\-().+]*)(?:[,;:\t]\s*(.+))?$/);
    if (!m) continue;
    const phone = normalizePhone(m[1]);
    if (phoneKey(phone).length < 8) continue;
    entries.set(phoneKey(phone), { phone, name: m[2]?.trim() || null });
  }
  const existing = await listSuppliers(db);
  const byKey = new Map(existing.map((s) => [phoneKey(s.phone), s]));

  for (const [key, e] of entries) {
    const prev = byKey.get(key);
    if (prev) {
      await db.from("suppliers").update({ active: true, ...(e.name ? { name: e.name } : {}) }).eq("id", prev.id);
    } else {
      await db.from("suppliers").insert({ phone: e.phone, name: e.name, active: true });
    }
  }
  const toOff = existing.filter((s) => s.active && !entries.has(phoneKey(s.phone)));
  if (toOff.length) await db.from("suppliers").update({ active: false }).in("id", toOff.map((s) => s.id));

  await db.from("hub_settings").upsert({ key: "supplier_senders", value: [...entries.values()].map((e) => e.phone), updated_at: new Date().toISOString() });
  return { active: entries.size, deactivated: toOff.length };
}

/** Reglas editables de un proveedor (descuento por unidad y notas). */
export async function saveSupplierRules(db: SupabaseClient, id: string, input: { unit_discount_usd?: number | null; bulk_pricing?: string; notes?: string }) {
  const { data } = await db.from("suppliers").select("rules").eq("id", id).single<{ rules: Record<string, unknown> }>();
  const rules = { ...(data?.rules ?? {}) };
  if (input.unit_discount_usd == null || Number.isNaN(input.unit_discount_usd) || input.unit_discount_usd === 0) delete rules.unit_discount_usd;
  else rules.unit_discount_usd = input.unit_discount_usd;
  if (input.bulk_pricing !== undefined) rules.bulk_pricing = input.bulk_pricing;
  if (input.notes !== undefined) rules.notes = input.notes;
  await db.from("suppliers").update({ rules }).eq("id", id);
}

// ---------------------------------------------------------------------------
// Remitentes nuevos: un número mal cargado o un CANAL de difusión que Nacho
// no podía anotar de antemano (WhatsApp no entrega el JID de un canal hasta
// que llega el primer mensaje). Se muestran en el panel para sumarlos con un toque.
// ---------------------------------------------------------------------------

export interface PendingSender {
  sender: string;
  kind: "phone" | "channel";
  sender_name: string | null;
  last_body: string | null;
  messages_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

/** "120363...@newsletter" → canal (WhatsApp Channels); el resto es un número. */
export function senderKind(raw: string | null | undefined): "phone" | "channel" {
  return raw?.includes("@newsletter") ? "channel" : "phone";
}

/** Registra que vimos este remitente sin aprobar (no toca precios: es solo para que Nacho lo vea y decida). */
export async function notePendingSender(db: SupabaseClient, raw: string, senderName: string | null, body: string): Promise<void> {
  const kind = senderKind(raw);
  const key = normalizePhone(raw);
  if (!key) return;
  const { data: prev } = await db.from("pending_senders").select("messages_count").eq("sender", key).maybeSingle<{ messages_count: number }>();
  await db.from("pending_senders").upsert({
    sender: key,
    kind,
    sender_name: senderName,
    last_body: body.slice(0, 400),
    messages_count: (prev?.messages_count ?? 0) + 1,
    last_seen_at: new Date().toISOString(),
  });
}

export async function listPendingSenders(db: SupabaseClient): Promise<PendingSender[]> {
  const { data } = await db.from("pending_senders").select("*").order("last_seen_at", { ascending: false }).limit(20).returns<PendingSender[]>();
  return data ?? [];
}

/** Lo suma como proveedor activo y lo saca de la lista de pendientes. */
export async function approvePendingSender(db: SupabaseClient, sender: string, name: string | null): Promise<void> {
  await db.from("suppliers").upsert({ phone: sender, name, active: true }, { onConflict: "phone" });
  await db.from("pending_senders").delete().eq("sender", sender);
}

/** Lo descarta sin sumarlo (para una consulta de cliente que entró por error). */
export async function dismissPendingSender(db: SupabaseClient, sender: string): Promise<void> {
  await db.from("pending_senders").delete().eq("sender", sender);
}

// ---------------------------------------------------------------------------
// Alta y baja de UN proveedor por vez (botones del panel). A diferencia de
// saveSupplierList, estas nunca tocan a los demás proveedores.
// ---------------------------------------------------------------------------

/** Suma o reactiva un proveedor sin afectar a los demás. */
export async function addSupplier(db: SupabaseClient, rawPhone: string, name: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  const phone = normalizePhone(rawPhone);
  const key = phoneKey(phone);
  if (key.length < 8) return { ok: false, reason: "número inválido (necesita al menos 8 dígitos)" };

  await db.from("suppliers").upsert({ phone, active: true, ...(name ? { name } : {}) }, { onConflict: "phone" });

  const { data: setting } = await db.from("hub_settings").select("value").eq("key", "supplier_senders").maybeSingle<{ value: unknown }>();
  const list = Array.isArray(setting?.value) ? (setting.value as unknown[]).map(String) : [];
  if (!list.some((n) => phoneKey(n) === key)) {
    await db.from("hub_settings").upsert({ key: "supplier_senders", value: [...list, phone], updated_at: new Date().toISOString() });
  }
  return { ok: true };
}

/** Desactiva un proveedor puntual (no lo borra: conserva reglas e historial). */
export async function removeSupplier(db: SupabaseClient, id: string): Promise<void> {
  const { data } = await db.from("suppliers").select("phone").eq("id", id).maybeSingle<{ phone: string }>();
  await db.from("suppliers").update({ active: false }).eq("id", id);
  if (data?.phone) {
    const key = phoneKey(data.phone);
    const { data: setting } = await db.from("hub_settings").select("value").eq("key", "supplier_senders").maybeSingle<{ value: unknown }>();
    const list = Array.isArray(setting?.value) ? (setting.value as unknown[]).map(String) : [];
    await db.from("hub_settings").upsert({ key: "supplier_senders", value: list.filter((n) => phoneKey(n) !== key), updated_at: new Date().toISOString() });
  }
}
