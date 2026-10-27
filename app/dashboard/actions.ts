"use server";

import { revalidatePath } from "next/cache";
import { DesignerError, generateBanner } from "@/lib/designer/generate";
import { isCategory } from "@/lib/types";

export interface RegenerateResult {
  ok: boolean;
  imageUrl?: string;
  error?: string;
}

export async function regenerateBanner(category: string): Promise<RegenerateResult> {
  if (!isCategory(category)) return { ok: false, error: "Categoría inválida" };
  try {
    const banner = await generateBanner(category);
    revalidatePath("/dashboard");
    revalidatePath("/");
    return { ok: true, imageUrl: banner.image_url };
  } catch (err) {
    const message =
      err instanceof DesignerError || err instanceof Error ? err.message : "Error desconocido";
    console.error("[dashboard/regenerate]", category, message);
    return { ok: false, error: message };
  }
}
