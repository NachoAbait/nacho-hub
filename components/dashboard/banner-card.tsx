import { connection } from "next/server";
import { latestBanner } from "@/lib/designer/generate";
import { CATEGORY_LABEL, type Category } from "@/lib/types";
import { RegenerateButton } from "@/components/dashboard/regenerate-button";
import { ShareButton } from "@/components/dashboard/share-button";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

/** Hoy cada categoría tiene una sola historia (sellados, en dólares). A futuro va a haber más de
 * una variante por categoría (usados en dólares, usados en pesos y cuotas) — el título ya describe
 * CUÁL historia es, no solo la categoría, para que cuando aparezcan esas variantes se sumen como
 * cards nuevas sin que esta deje de tener sentido. */
function bannerTitle(category: Category): string {
  return `${CATEGORY_LABEL[category]} · Sellados en USD`;
}

/** Server Component async: lee el último banner de la categoría. */
export async function BannerCard({ category }: { category: Category }) {
  // Datos por request: corta el prerender acá y deja que el Suspense de arriba muestre el skeleton.
  await connection();
  const banner = await latestBanner(category);
  const title = bannerTitle(category);

  return (
    <article className="flex w-[300px] flex-none snap-center flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 sm:w-[340px]">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <p className="text-xs text-white/50">
            {banner ? `Generado ${formatDate(banner.generated_at)}` : "Sin banner todavía"}
          </p>
        </div>
        <RegenerateButton category={category} />
      </header>

      <div className="aspect-[9/16] overflow-hidden rounded-2xl bg-black">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.image_url}
            alt={`Banner ${title}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/30">
            Tocá “Regenerar” para crear el primero
          </div>
        )}
      </div>

      {banner && <ShareButton imageUrl={banner.image_url} fileName={`bnb-${category}.png`} title={title} />}
    </article>
  );
}

export function BannerCardSkeleton({ category }: { category: Category }) {
  return (
    <article className="flex w-[300px] flex-none animate-pulse snap-center flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 sm:w-[340px]">
      <h2 className="text-lg font-semibold">{bannerTitle(category)}</h2>
      <div className="aspect-[9/16] rounded-2xl bg-white/10" />
    </article>
  );
}
