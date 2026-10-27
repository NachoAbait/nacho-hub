import { connection } from "next/server";
import { latestBanner } from "@/lib/designer/generate";
import { CATEGORY_LABEL, type Category } from "@/lib/types";
import { RegenerateButton } from "@/components/dashboard/regenerate-button";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

/** Server Component async: lee el último banner de la categoría. */
export async function BannerCard({ category }: { category: Category }) {
  // Datos por request: corta el prerender acá y deja que el Suspense de arriba muestre el skeleton.
  await connection();
  const banner = await latestBanner(category);

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{CATEGORY_LABEL[category]}</h2>
          <p className="text-xs text-white/50">
            {banner ? `Generado ${formatDate(banner.generated_at)}` : "Sin banner todavía"}
          </p>
        </div>
        <RegenerateButton category={category} />
      </header>

      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-black">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.image_url}
            alt={`Banner ${CATEGORY_LABEL[category]}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/30">
            Tocá “Regenerar” para crear el primero
          </div>
        )}
      </div>

      {banner && (
        <a
          href={banner.image_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-amber-300 underline-offset-2 hover:underline"
        >
          Abrir PNG ({banner.width}×{banner.height})
        </a>
      )}
    </article>
  );
}

export function BannerCardSkeleton({ category }: { category: Category }) {
  return (
    <article className="flex animate-pulse flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold">{CATEGORY_LABEL[category]}</h2>
      <div className="aspect-[4/5] rounded-2xl bg-white/10" />
    </article>
  );
}
