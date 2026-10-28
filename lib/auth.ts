/** Autorización de endpoints de agentes y crons: siempre exige CRON_SECRET (Vercel lo manda en los crons). */
export function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
