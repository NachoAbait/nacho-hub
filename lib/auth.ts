/** Autorización de endpoints de agentes y crons: siempre exige CRON_SECRET (Vercel lo manda en los crons). */
export function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Nombre de la cookie del gate de contraseña del dashboard (ver middleware.ts). */
export const DASHBOARD_COOKIE = "nacho_dashboard_auth";

/**
 * Gate de contraseña propio del dashboard — no confiamos en la protección nativa de Vercel: en el
 * plan Hobby no bloquea el dominio real asignado a Producción (verificado en vivo el 23-11-2026,
 * `curl` a nacho-hub.vercel.app devolvía la app entera sin pedir login pese a tener SSO "activado").
 * La cookie NUNCA guarda la contraseña en texto plano — guarda un hash fijo derivado de ella, así
 * que ver la cookie en el navegador no revela la clave real.
 */
export async function dashboardCookieValue(): Promise<string> {
  // Sin Buffer (de Node): esto corre tanto en el middleware (Edge runtime) como en /api/login
  // (Node runtime), y Buffer no existe en Edge — Web Crypto (crypto.subtle) sí, en los dos.
  const secret = process.env.DASHBOARD_PASSWORD ?? "";
  const data = new TextEncoder().encode(`nacho-hub-gate:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidDashboardPassword(password: string): Promise<boolean> {
  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) return false;
  return password === secret;
}
