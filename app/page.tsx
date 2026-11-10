import { Suspense } from "react";
import { connection } from "next/server";
import { agentStatuses } from "@/lib/office/status";
import { latestBanner } from "@/lib/designer/generate";
import { OfficeCanvas } from "@/components/office/office-canvas";

// Las server actions del panel (correr agentes, regenerar historias) corren en esta ruta. 120,
// igual que /api/agents/price-reader/ingest: con 60 se cortaba a mitad de la cadena Lucas → Martín
// → Bruno cuando una lista pegada a mano tenía muchos productos, dejando a Martín con su corrida
// en "running" para siempre (el proceso muere, nunca llega a marcar ok/error).
export const maxDuration = 120;

export const metadata = { title: "NACHO Hub" };

async function OfficeLoader() {
  await connection();
  const [statuses, banner] = await Promise.all([agentStatuses(), latestBanner("iphone")]);
  return (
    <OfficeCanvas
      statuses={statuses}
      designerBanner={banner ? { url: banner.image_url, generatedAt: banner.generated_at } : null}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center text-sm text-white/40">Abriendo la oficina…</div>}>
      <OfficeLoader />
    </Suspense>
  );
}
