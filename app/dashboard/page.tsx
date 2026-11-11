import { Suspense } from "react";
import { BannerCard, BannerCardSkeleton } from "@/components/dashboard/banner-card";
import { CATEGORIES } from "@/lib/types";

export const metadata = { title: "Dashboard · NACHO Hub" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">Designer</p>
        <h1 className="mt-1 text-3xl font-bold">Banners</h1>
        <p className="mt-1 text-sm text-white/50">Deslizá para ver cada historia. Tocá “Compartir / Descargar” para bajarla al toque.</p>
      </header>

      <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [-webkit-overflow-scrolling:touch]">
        {CATEGORIES.map((category) => (
          <Suspense key={category} fallback={<BannerCardSkeleton category={category} />}>
            <BannerCard category={category} />
          </Suspense>
        ))}
      </div>
    </main>
  );
}
