import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryKey } from "@/lib/agents/catalog-match";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

/**
 * Orden de categorías pedido para la comparativa (distinto del orden interno de CATEGORIES).
 * Cada una es su propia hoja del Excel (pestaña aparte), no una sección dentro de una hoja grande.
 * "Xiaomi" y otras marcas todavía no son una categoría propia: hoy esos ítems se descartan al
 * leerlos (price-reader los clasifica "other" y los salta), así que no hay nada que listar ahí
 * todavía — si Nacho empieza a vender Xiaomi, hay que sumar la categoría primero.
 */
const CATEGORY_ORDER: Category[] = ["iphone", "macbook", "ipad", "watch", "airpods", "samsung"];

interface QuoteRow {
  supplier_id: string | null;
  category: Category;
  model: string;
  chip: string | null;
  capacity: string | null;
  ram_gb: number | null;
  cost_usd: number;
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const CHEAPEST_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBBF7D0" } };

/** Todo en una sola celda: modelo, chip, capacidad y RAM juntos, tal como lo pidió Nacho. */
function fullLabel(model: string, chip: string | null, capacity: string | null, ramGb: number | null): string {
  const parts = [model];
  if (chip) parts.push(chip);
  if (capacity) parts.push(capacity);
  if (ramGb) parts.push(`${ramGb}GB RAM`);
  return parts.join(" ");
}

/** Comparativa de precios del día: una hoja por categoría, productos en filas, proveedores en columnas. */
export async function buildPriceMatrixWorkbook(db: SupabaseClient, date: string): Promise<ExcelJS.Workbook> {
  const { data: quotes, error } = await db
    .from("price_quotes")
    .select("supplier_id, category, model, chip, capacity, ram_gb, cost_usd")
    .eq("quote_date", date)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`price_quotes: ${error.message}`);

  const { data: suppliers } = await db.from("suppliers").select("id, name, phone").returns<{ id: string; name: string | null; phone: string }[]>();
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name ?? s.phone]));

  // Mismas columnas de proveedor en todas las hojas, aunque un proveedor no tenga nada en esa
  // categoría (esas celdas quedan vacías): así se puede comparar la misma columna entre pestañas.
  const supplierIds = [...new Set((quotes ?? []).map((q) => q.supplier_id).filter((v): v is string => !!v))].sort((a, b) =>
    (supplierName.get(a) ?? "").localeCompare(supplierName.get(b) ?? ""),
  );

  // Filas: un producto (categoría + modelo + chip + capacidad, agrupados sin importar el orden de
  // palabras de cada proveedor) con lo que cotizó cada uno. Si dentro del mismo grupo algún proveedor
  // dio el chip o la RAM y otro no, nos quedamos con el dato que sí vino (nunca lo inventamos).
  interface Row { category: Category; model: string; chip: string | null; capacity: string | null; ramGb: number | null; bySupplier: Map<string, number> }
  const rows = new Map<string, Row>();
  for (const q of quotes ?? []) {
    const key = entryKey(q.category, q.model, q.capacity, q.chip);
    let row = rows.get(key);
    if (!row) {
      row = { category: q.category, model: q.model, chip: q.chip, capacity: q.capacity, ramGb: q.ram_gb, bySupplier: new Map() };
      rows.set(key, row);
    } else {
      if (!row.chip && q.chip) row.chip = q.chip;
      if (!row.ramGb && q.ram_gb) row.ramGb = q.ram_gb;
      if (q.model.length > row.model.length) row.model = q.model;
    }
    if (q.supplier_id) {
      const prev = row.bySupplier.get(q.supplier_id);
      if (prev == null || q.cost_usd < prev) row.bySupplier.set(q.supplier_id, q.cost_usd);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NACHO Hub · Martín (Price Analyst)";
  wb.created = new Date();

  for (const category of CATEGORY_ORDER) {
    const inCategory = [...rows.values()]
      .filter((r) => r.category === category)
      .sort((a, b) => fullLabel(a.model, a.chip, a.capacity, a.ramGb).localeCompare(fullLabel(b.model, b.chip, b.capacity, b.ramGb)));
    if (!inCategory.length) continue;

    const sheet = wb.addWorksheet(CATEGORY_LABEL[category], { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    sheet.getColumn(1).width = 36;
    for (let i = 0; i < supplierIds.length; i++) sheet.getColumn(i + 2).width = 16;

    const header = sheet.addRow(["Producto", ...supplierIds.map((id) => supplierName.get(id) ?? id)]);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    for (const row of inCategory) {
      const cheapest = row.bySupplier.size ? Math.min(...row.bySupplier.values()) : null;
      const excelRow = sheet.addRow([
        fullLabel(row.model, row.chip, row.capacity, row.ramGb),
        ...supplierIds.map((id) => row.bySupplier.get(id) ?? null),
      ]);
      excelRow.getCell(1).font = { bold: true };
      for (let i = 0; i < supplierIds.length; i++) {
        const cell = excelRow.getCell(i + 2);
        const value = row.bySupplier.get(supplierIds[i]);
        if (value == null) continue;
        cell.numFmt = '"US$ "#,##0';
        if (cheapest != null && value === cheapest) {
          cell.fill = CHEAPEST_FILL;
          cell.font = { bold: true };
        }
      }
    }
  }

  return wb;
}
