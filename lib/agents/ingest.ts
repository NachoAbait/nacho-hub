import { supabaseAdmin } from "@/lib/supabase";
import { runAgent, type RunOutcome } from "@/lib/agents/runtime";
import { priceReader } from "@/lib/agents/price-reader";
import { findAllowedSupplier, normalizePhone, notePendingSender } from "@/lib/suppliers";

export interface IngestInput {
  sender?: string | null;
  sender_name?: string | null;
  body: string;
  received_at?: string;
  source: "whatsapp" | "manual";
  /** Llegó por difusión (señal extra del puente; nunca alcanza solo). */
  broadcast?: boolean;
  /** Solo para pegado manual: proveedor elegido en el panel (para aplicar sus reglas). */
  supplier_id?: string | null;
}

export type IngestResult =
  | { ok: true; ignored: true; reason: string }
  | { ok: boolean; ignored: false; supplier: string | null; message_id: string; run: RunOutcome };

/**
 * Entrada única de listas de proveedores (puente de WhatsApp y panel).
 * - WhatsApp: solo pasa si el remitente es un proveedor activo cargado por Nacho; el resto se ignora sin guardar nada.
 * - Manual: se procesa siempre (lo pegó Nacho).
 * Guarda el mensaje y corre al Price Reader con trigger "ingest".
 */
export async function ingestPriceList(input: IngestInput): Promise<IngestResult> {
  const db = supabaseAdmin();
  const body = (input.body ?? "").trim();
  if (body.length < 8) return { ok: true, ignored: true, reason: "mensaje vacío o muy corto" };

  let supplierId: string | null = input.supplier_id ?? null;
  let supplierLabel: string | null = null;

  if (input.source === "whatsapp") {
    const supplier = input.sender ? await findAllowedSupplier(db, input.sender) : null;
    if (!supplier) {
      // No toca precios: solo deja registro para que Nacho lo sume desde el panel (sirve tanto para
      // un número que escribió mal como para un canal, cuyo identificador no se puede cargar de antemano).
      if (input.sender) await notePendingSender(db, input.sender, input.sender_name ?? null, body);
      return { ok: true, ignored: true, reason: "remitente que no es proveedor cargado" };
    }
    supplierId = supplier.id;
    supplierLabel = supplier.name ?? supplier.phone;
    await db
      .from("suppliers")
      .update({
        last_seen_at: new Date().toISOString(),
        messages_count: supplier.messages_count + 1,
        ...(!supplier.name && input.sender_name ? { name: input.sender_name } : {}),
      })
      .eq("id", supplier.id);
  } else if (supplierId) {
    const { data } = await db.from("suppliers").select("name, phone").eq("id", supplierId).maybeSingle<{ name: string | null; phone: string }>();
    supplierLabel = data?.name ?? data?.phone ?? null;
  }

  const { data: msg, error } = await db
    .from("supplier_messages")
    .insert({
      source: input.source,
      sender: input.sender ? normalizePhone(input.sender) : null,
      sender_name: input.sender_name ?? supplierLabel,
      supplier_id: supplierId,
      body,
      received_at: input.received_at ?? new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !msg) throw new Error(`No pude guardar el mensaje: ${error?.message}`);

  const run = await runAgent(priceReader, "BNB", "ingest");
  return { ok: run.ok, ignored: false, supplier: supplierLabel, message_id: msg.id, run };
}
