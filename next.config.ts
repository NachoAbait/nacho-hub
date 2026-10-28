import type { NextConfig } from "next";

// Rutas que lanzan Playwright. El tracing de Next no sigue los requires dinámicos
// de playwright-core (browsers.json) ni los binarios .br de @sparticuz/chromium,
// así que hay que incluirlos a mano en el bundle de la función.
const PLAYWRIGHT_FILES = [
  "./node_modules/playwright-core/**/*",
  "./node_modules/@sparticuz/chromium/**/*",
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/designer/generate": PLAYWRIGHT_FILES,
    "/dashboard": PLAYWRIGHT_FILES,
    "/": PLAYWRIGHT_FILES,
    "/api/agents/[id]": PLAYWRIGHT_FILES,
    "/api/agents/price-reader/ingest": PLAYWRIGHT_FILES,
    "/api/cron/[tier]": PLAYWRIGHT_FILES,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
