import { Suspense } from "react";
import { BannerCard, BannerCardSkeleton } from "@/components/dashboard/banner-card";

export const metadata = { title: "Dashboard · NACHO Hub" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">Designer</p>
        <h1 className="mt-1 text-3xl font-bold">Banners</h1>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Suspense fallback={<BannerCardSkeleton category="iphone" />}>
          <BannerCard category="iphone" />
        </Suspense>
      </div>
    </main>
  );
}
