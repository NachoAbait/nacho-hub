import { Suspense } from "react";
import { connection } from "next/server";
import { agentStatuses } from "@/lib/office/status";
import { latestBanners } from "@/lib/designer/generate";
import { CATEGORIES } from "@/lib/types";
import { OfficeCanvas } from "@/components/office/office-canvas";

// Las server actions del panel (correr agentes, regenerar historias) corren en esta ruta. 120,
// igual que /api/agents/price-reader/ingest: con 60 se cortaba a mitad de la cadena Lucas → Martín
// → Bruno cuando una lista pegada a mano tenía muchos productos, dejando a Martín con su corrida
// en "running" para siempre (el proceso muere, nunca llega a marcar ok/error).
export const maxDuration = 120;

export const metadata = { title: "NACHO Hub" };

async function OfficeLoader() {
  await connection();
  const [statuses, byCategory] = await Promise.all([agentStatuses(), latestBanners()]);
  const designerBanners = CATEGORIES.flatMap((category) => {
    const b = byCategory[category];
    return b ? [{ category, url: b.image_url, generatedAt: b.generated_at }] : [];
  });
  return <OfficeCanvas statuses={statuses} designerBanners={designerBanners} />;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center text-sm text-white/40">Abriendo la oficina…</div>}>
      <OfficeLoader />
    </Suspense>
  );
}
