import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeModel } from "@/lib/nexios";
import { wordsMatch } from "@/lib/agents/catalog-match";
import type { WhisperSegment, WhisperWord } from "@/lib/video-editor/captions";
import type { OverlaySegmentInput } from "@/lib/video-editor/render";

export interface OverlayMatch {
  /** Lo que se guarda en video_clips.product_hint. */
  hint: string;
  /** Texto bajo la caja en el video. */
  label: string;
  /** URL pública de la imagen a mostrar en la caja flotante. */
  imageUrl: string;
}

export interface CatalogProduct {
  model: string;
  hero_image_url: string;
}

/** Modelos activos con foto hero — lo usan tanto el match por nombre de archivo de acá abajo como
 * content-analysis.ts (match por lo que se dice en el audio). Centralizado para no repetir la
 * misma query de Supabase en dos lugares. */
export async function getActiveCatalog(db: SupabaseClient): Promise<CatalogProduct[]> {
  const { data } = await db
    .from("products")
    .select("model, hero_image_url")
    .eq("is_active", true)
    .not("hero_image_url", "is", null)
    .returns<CatalogProduct[]>();
  return data ?? [];
}

/**
 * Accesorios con placeholder ya generado y subido a Supabase Storage (bucket "heroes", carpeta
 * accesorios/ — ver tarea: son renders de IA low-res 200x200, provisorios hasta tener fotos reales).
 * Match por palabra clave en el nombre del archivo, sin sensibilidad a mayúsculas.
 */
const ACCESSORY_KEYWORDS: { pattern: RegExp; hint: string; label: string; storagePath: string }[] = [
  { pattern: /cargador/i, hint: "cargador", label: "Cargador", storagePath: "accesorios/cargador__generico.png" },
  { pattern: /blindad/i, hint: "blindado", label: "Vidrio blindado", storagePath: "accesorios/blindado__generico.png" },
  { pattern: /garant/i, hint: "garantia", label: "Garantía BNB", storagePath: "accesorios/garantia__sello.png" },
];

/**
 * Busca qué producto mostrar en la caja flotante a partir del nombre del archivo que subió Nacho
 * (ej. "iphone17probarato.mp4", "cargador_tipo_c.mov"). Primero prueba los accesorios conocidos
 * (match exacto de palabra clave, sin ambigüedad posible); si no matchea ninguno, busca contra los
 * modelos de teléfono activos del catálogo del hub con la misma tolerancia a variantes de ortografía
 * que ya usa el matching de cotizaciones (wordsMatch) — no vale la pena un matcher más sofisticado
 * para esto: el nombre del archivo lo escribe Nacho a mano, no un proveedor con miles de variantes.
 */
export async function matchOverlay(db: SupabaseClient, fileName: string): Promise<OverlayMatch | null> {
  const base = fileName.replace(/\.[^./]+$/, "");

  for (const kw of ACCESSORY_KEYWORDS) {
    if (kw.pattern.test(base)) {
      const { data } = db.storage.from("heroes").getPublicUrl(kw.storagePath);
      return { hint: kw.hint, label: kw.label, imageUrl: data.publicUrl };
    }
  }

  const fileTokens = normalizeModel(base).split(/\s+/).filter(Boolean);
  if (fileTokens.length === 0) return null;

  const products = await getActiveCatalog(db);

  for (const p of products) {
    const modelTokens = normalizeModel(p.model).split(/\s+/).filter(Boolean);
    if (modelTokens.length === 0) continue;
    const allTokensFound = modelTokens.every((mt) => fileTokens.some((ft) => ft === mt || wordsMatch(ft, mt)));
    if (allTokensFound) return { hint: p.model, label: p.model, imageUrl: p.hero_image_url };
  }

  return null;
}

/** El número (o, si no tiene, la última palabra distintiva) que separa a este modelo de los demás
 * del mismo rubro — "iPhone 16" vs "iPhone 17 Pro" se distinguen por "16" vs "17", no por "iPhone".
 * Es lo que se busca palabra por palabra en la transcripción para ANCLAR el momento real en que se
 * nombra cada uno, en vez de repartir el tiempo de la frase en partes iguales (eso hacía que la caja
 * cambiara de producto antes o después de que Nacho lo dijera de verdad). */
function anchorToken(model: string): string {
  const digits = model.match(/\d+/);
  if (digits) return digits[0];
  const tokens = normalizeModel(model).split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] ?? normalizeModel(model);
}

/**
 * A partir de una frase y los modelos que Claude detectó que menciona (content-analysis.ts), busca
 * en qué palabra EXACTA de esa frase se nombra cada uno (por su `anchorToken`) y arma una ventana de
 * tiempo por modelo que arranca ahí — no un reparto parejo del tiempo total de la frase. Si un modelo
 * no se puede anclar (la transcripción no trajo ese número, por ejemplo), arranca al comienzo de la
 * frase antes que no aparecer. Los modelos se ordenan por el momento real en que se dijeron.
 */
export function anchorOverlaySegments(
  segment: WhisperSegment,
  segmentWords: WhisperWord[],
  models: { label: string; imageUrl: string }[],
): OverlaySegmentInput[] {
  if (models.length === 0) return [];

  const usedWordIdx = new Set<number>();
  const anchored = models.map((model) => {
    const token = anchorToken(model.label);
    let foundIdx = -1;
    for (let i = 0; i < segmentWords.length; i++) {
      if (usedWordIdx.has(i)) continue;
      const norm = normalizeModel(segmentWords[i].word);
      if (norm === token || wordsMatch(norm, token)) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx !== -1) usedWordIdx.add(foundIdx);
    return { model, start: foundIdx !== -1 ? segmentWords[foundIdx].start : segment.start };
  });

  anchored.sort((a, b) => a.start - b.start);

  return anchored.map((a, i) => {
    const nextStart = i + 1 < anchored.length ? anchored[i + 1].start : segment.end;
    // Mínimo 0.6s por producto (antes 0.3s, muy poco sumado al flip-in de 0.35s — casi no quedaba
    // tiempo "quieto" mostrando el producto) — si dos anclas quedaron pegadas (dos números seguidos
    // sin pausa) la caja igual tiene que alcanzar a asentarse y leerse, no un parpadeo.
    return { startSec: a.start, endSec: Math.max(nextStart, a.start + 0.6), imageUrl: a.model.imageUrl, label: a.model.label };
  });
}

function plainNormalize(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Busca, palabra por palabra, dónde arranca y termina una frase EXACTA (ej. ["sin","cambios"]) en la
 * transcripción completa — a diferencia de anchorOverlaySegments (que ancla un modelo dentro de UNA
 * oración ya identificada por Claude), esto busca texto literal en todo el clip, sin pasar por
 * content-analysis: lo usan los efectos que dependen de que Nacho diga una frase puntual (ej. el
 * cartel de "sin cambios, sin arreglos"), no de qué producto se nombra.
 */
export function findPhraseWindow(words: WhisperWord[], phrase: string[]): { start: number; end: number } | null {
  const target = phrase.map(plainNormalize);
  for (let i = 0; i <= words.length - target.length; i++) {
    let matches = true;
    for (let j = 0; j < target.length; j++) {
      if (plainNormalize(words[i + j].word) !== target[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return { start: words[i].start, end: words[i + target.length - 1].end };
  }
  return null;
}
