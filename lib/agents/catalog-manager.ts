import type { AgentModule } from "@/lib/agents/runtime";
import { getSetting } from "@/lib/agents/runtime";
import { entryKey } from "@/lib/agents/catalog-match";
import { CATEGORY_TO_DEVICE, catalogModelText, DEVICE_TO_CATEGORY, fetchCatalog, nexios, nexiosAvailable, type NexiosCatalogRow } from "@/lib/nexios";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

export interface PendingNewModel {
  id: string;
  category: Category;
  model: string;
  capacity: string | null;
  /** Solo para mostrar en el panel (createCatalogProduct ya los lee aparte de price_updates):
   * model queda limpio, así que sin esto el cartel no distingue un +Cell de 46mm de uno de 42mm. */
  chip: string | null;
  cellular: boolean;
  inches: number | null;
  screenMm: number | null;
  detectedCostUsd: number;
  supplierName: string | null;
  suggestedMargin: number | null;
  suggestedPrice: number | null;
  /** Ya lo creaste hoy: el panel lo muestra en verde en vez de sacarlo de la lista. */
  confirmed: boolean;
}

export interface PendingVisibility {
  id: string;
  action: "hide" | "show";
  category: Category | null;
  model: string;
  capacity: string | null;
  /** Solo para "show": a qué costo y de qué proveedor lo volvieron a cotizar hoy, si lo sabemos. */
  cost: number | null;
  supplierName: string | null;
}

/** Margen promedio de los productos activos de esa categoría, para sugerir precio a un modelo nuevo. */
export function averageMargin(catalog: NexiosCatalogRow[], category: Category): number | null {
  const device = CATEGORY_TO_DEVICE[category];
  const margins = catalog.filter((r) => r.device_type === device && r.margin_usd != null).map((r) => r.margin_usd as number);
  if (!margins.length) return null;
  return Math.round(margins.reduce((a, b) => a + b, 0) / margins.length);
}

/**
 * Catalog Manager (Bruno): lo que NO es comparar precios de lo que ya está en el catálogo (eso es
 * Martín). Dos trabajos, ninguno toca un precio existente:
 * 1. Ve qué modelos nuevos detectó Martín (cotizados por un proveedor, sin match en NexiOS) y deja
 *    listo un margen sugerido para crearlos — el alta la confirma Nacho desde el panel.
 * 2. Ocultar del catálogo público lo que ningún proveedor cotizó hoy (sin stock), y volver a
 *    mostrarlo apenas alguien lo cotiza de nuevo. Según hub_settings.catalog_manager_auto (switch
 *    en el propio panel, arranca en false): si está en automático lo aplica directo; si no, lo deja
 *    en el panel para que Nacho confirme cada cambio uno por uno.
 */
export const catalogManager: AgentModule = {
  id: "catalog-manager",
  contexts: ["BNB"],
  requiredEnv: ["NEXIOS_SUPABASE_SERVICE_ROLE_KEY"],
  async run(ctx) {
    if (!nexiosAvailable()) {
      return { markdown: "# Catálogo\n\nFalta NEXIOS_SUPABASE_SERVICE_ROLE_KEY: no puedo leer ni tocar NexiOS.", summary: "sin acceso a NexiOS", data: {} };
    }
    const auto = await getSetting<boolean>(ctx.db, "catalog_manager_auto", false);
    const catalog = (await fetchCatalog()) ?? [];

    const { data: quotesToday } = await ctx.db
      .from("price_quotes")
      .select("category, model, chip, cellular, inches, screen_mm, capacity, cost_usd, supplier_id")
      .eq("quote_date", ctx.today)
      .returns<{ category: Category; model: string; chip: string | null; cellular: boolean; inches: number | null; screen_mm: number | null; capacity: string | null; cost_usd: number; supplier_id: string | null }[]>();
    // Más barata por producto, con quién la cotizó: para "volvió a aparecer" le podemos decir a
    // Nacho a qué precio y de quién, no solo que "alguien lo cotizó de nuevo".
    const quoteInfoByKey = new Map<string, { cost: number; supplierId: string | null }>();
    for (const q of quotesToday ?? []) {
      const key = entryKey(q.category, q.model, q.capacity, q.chip, q.inches, q.cellular, q.screen_mm);
      const prev = quoteInfoByKey.get(key);
      if (!prev || q.cost_usd < prev.cost) quoteInfoByKey.set(key, { cost: q.cost_usd, supplierId: q.supplier_id });
    }
    const quotedKeys = new Set(quoteInfoByKey.keys());

    // Nunca tocamos accesorios (device_type "accessory"): Lucas no cotiza eso, no hay forma de saber si hay stock.
    const tracked = catalog.filter((r) => DEVICE_TO_CATEGORY[r.device_type] != null);

    // Candidatos a mostrar (siempre se evalúan): lo que cotizaron hoy y estaba oculto.
    const showCandidates = tracked.filter((r) => !r.public_visible && quotedKeys.has(entryKey(DEVICE_TO_CATEGORY[r.device_type]!, catalogModelText(r), r.capacity)));

    // Candidatos a ocultar: solo en la corrida de cron, no en cada mensaje (si corriera en cada
    // "ingest" ocultaría productos a los que todavía no les llegó el turno en la difusión).
    let hideCandidates: NexiosCatalogRow[] = [];
    if (ctx.trigger !== "ingest") {
      hideCandidates = tracked.filter((r) => r.public_visible && !quotedKeys.has(entryKey(DEVICE_TO_CATEGORY[r.device_type]!, catalogModelText(r), r.capacity)));
    }

    let applied = { shown: 0, hidden: 0 };
    let pendingVisibility: PendingVisibility[] = [];
    if (auto) {
      if (showCandidates.length) await nexios()!.from("price_catalog").update({ public_visible: true, updated_at: new Date().toISOString() }).in("id", showCandidates.map((r) => r.id));
      if (hideCandidates.length) await nexios()!.from("price_catalog").update({ public_visible: false, updated_at: new Date().toISOString() }).in("id", hideCandidates.map((r) => r.id));
      applied = { shown: showCandidates.length, hidden: hideCandidates.length };
    } else {
      const showInfos = showCandidates.map((r) => ({
        r,
        info: quoteInfoByKey.get(entryKey(DEVICE_TO_CATEGORY[r.device_type]!, catalogModelText(r), r.capacity)),
      }));
      const showSupplierIds = [...new Set(showInfos.map((x) => x.info?.supplierId).filter((v): v is string => !!v))];
      const showSupplierNames = new Map<string, string>();
      if (showSupplierIds.length) {
        const { data: sup } = await ctx.db.from("suppliers").select("id, name, phone").in("id", showSupplierIds);
        for (const s of sup ?? []) showSupplierNames.set(s.id, s.name ?? s.phone);
      }
      pendingVisibility = [
        ...showInfos.map(({ r, info }): PendingVisibility => ({
          id: r.id, action: "show", category: DEVICE_TO_CATEGORY[r.device_type], model: catalogModelText(r), capacity: r.capacity,
          cost: info?.cost ?? null, supplierName: info?.supplierId ? showSupplierNames.get(info.supplierId) ?? null : null,
        })),
        ...hideCandidates.map((r): PendingVisibility => ({ id: r.id, action: "hide", category: DEVICE_TO_CATEGORY[r.device_type], model: catalogModelText(r), capacity: r.capacity, cost: null, supplierName: null })),
      ];
    }

    // Modelos nuevos que Martín dejó pendientes (sin match en el catálogo), con margen sugerido.
    // Esto SIEMPRE pasa por tu click, automático o no: crear un producto es una decisión más grande
    // que ocultar/mostrar uno que ya existe.
    const { data: pending } = await ctx.db
      .from("price_updates")
      .select("id, category, model, capacity, chip, cellular, inches, screen_mm, detected_cost_usd, supplier_id")
      .eq("status", "new_model")
      .eq("review_status", "pending")
      .returns<{
        id: string; category: Category; model: string; capacity: string | null;
        chip: string | null; cellular: boolean; inches: number | null; screen_mm: number | null;
        detected_cost_usd: number; supplier_id: string | null;
      }[]>();

    const supplierIds = [...new Set((pending ?? []).map((p) => p.supplier_id).filter((v): v is string => !!v))];
    const supplierNames = new Map<string, string>();
    if (supplierIds.length) {
      const { data: sup } = await ctx.db.from("suppliers").select("id, name, phone").in("id", supplierIds);
      for (const s of sup ?? []) supplierNames.set(s.id, s.name ?? s.phone);
    }

    const newModels: PendingNewModel[] = (pending ?? []).map((p) => {
      const margin = averageMargin(catalog, p.category);
      const cost = Number(p.detected_cost_usd);
      return {
        id: p.id, category: p.category, model: p.model, capacity: p.capacity,
        chip: p.chip, cellular: p.cellular, inches: p.inches, screenMm: p.screen_mm,
        detectedCostUsd: cost,
        supplierName: p.supplier_id ? supplierNames.get(p.supplier_id) ?? null : null,
        suggestedMargin: margin, suggestedPrice: margin == null ? null : cost + margin,
        confirmed: false,
      };
    });

    // Nombre legible de una fila de NexiOS para el detalle debajo de cada conteo (ocultados/
    // mostrados/pendientes): sin esto el informe solo decía "oculté 3" sin decir cuáles 3.
    const fmtRow = (r: NexiosCatalogRow) => {
      const cat = DEVICE_TO_CATEGORY[r.device_type];
      return `${cat ? CATEGORY_LABEL[cat] + ": " : ""}${catalogModelText(r)}${r.capacity ? " " + r.capacity : ""}`;
    };

    const lines: string[] = ["# Catálogo"];
    lines.push("", `Modo: ${auto ? "automático" : "manual, esperando tu confirmación"}.`);
    if (auto) {
      if (applied.shown) {
        lines.push(`Volvieron a mostrarse ${applied.shown} (un proveedor los cotizó de nuevo hoy):`);
        for (const r of showCandidates) lines.push(`- ${fmtRow(r)}`);
      } else {
        lines.push("Nadie volvió a tener stock de algo que estaba oculto.");
      }
      if (ctx.trigger !== "ingest") {
        if (applied.hidden) {
          lines.push("", `Oculté ${applied.hidden} del catálogo público: ningún proveedor los cotizó hoy:`);
          for (const r of hideCandidates) lines.push(`- ${fmtRow(r)}`);
        } else {
          lines.push("Todo lo que estaba visible, algún proveedor lo cotizó hoy.");
        }
      }
    } else if (pendingVisibility.length) {
      lines.push(`Hay ${pendingVisibility.length} cambios de visibilidad esperando que los confirmes uno por uno en mi panel:`);
      if (showCandidates.length) {
        lines.push(`- Volver a mostrar (${showCandidates.length}):`);
        for (const r of showCandidates) lines.push(`  - ${fmtRow(r)}`);
      }
      if (hideCandidates.length) {
        lines.push(`- Ocultar (${hideCandidates.length}):`);
        for (const r of hideCandidates) lines.push(`  - ${fmtRow(r)}`);
      }
    } else {
      lines.push("Nada para mostrar u ocultar por ahora.");
    }
    if (newModels.length) {
      lines.push("", "## Modelos nuevos esperando que los crees");
      for (const m of newModels) {
        const detail = [m.chip, m.cellular ? "+Cell" : null, m.inches ? `${m.inches}"` : null, m.screenMm ? `${m.screenMm}mm` : null].filter(Boolean).join(" ");
        lines.push(`- **${CATEGORY_LABEL[m.category]}: ${m.model}${detail ? " " + detail : ""}${m.capacity ? " " + m.capacity : ""}** — costo US$ ${m.detectedCostUsd} de ${m.supplierName ?? "proveedor"}${m.suggestedPrice != null ? `, precio sugerido US$ ${m.suggestedPrice} (margen US$ ${m.suggestedMargin})` : ""}`);
      }
    }
    lines.push("", "## Para hoy");
    if (!auto && pendingVisibility.length) lines.push(`- Confirmá los ${pendingVisibility.length} cambios de visibilidad pendientes.`);
    if (newModels.length) lines.push(`- Revisá los ${newModels.length} modelos nuevos y creá los que correspondan.`);
    if (auto && !applied.shown && !applied.hidden && !newModels.length) lines.push("- Nada para hacer: el catálogo ya refleja lo que cotizaron hoy.");
    if (!auto && !pendingVisibility.length && !newModels.length) lines.push("- Nada para hacer: el catálogo ya refleja lo que cotizaron hoy.");

    const summaryParts: string[] = [];
    if (auto) {
      if (applied.hidden) summaryParts.push(`${applied.hidden} ocultados`);
      if (applied.shown) summaryParts.push(`${applied.shown} mostrados`);
    } else if (pendingVisibility.length) {
      summaryParts.push(`${pendingVisibility.length} cambios esperando confirmación`);
    }
    if (newModels.length) summaryParts.push(`${newModels.length} nuevos esperando`);

    return {
      markdown: lines.join("\n"),
      summary: summaryParts.length ? summaryParts.join(" · ") : "sin cambios",
      data: { auto, hidden: applied.hidden, shown: applied.shown, pendingVisibility, newModels },
    };
  },
};
