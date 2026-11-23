import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_COOKIE, dashboardCookieValue } from "@/lib/auth";

/**
 * Gate de contraseña para todo el dashboard (ver lib/auth.ts para el por qué: la protección nativa
 * de Vercel no cubre el dominio real de Producción en el plan Hobby). El matcher de abajo ya deja
 * afuera /api, /_next y los archivos estáticos — acá además se deja pasar siempre /login, para no
 * armar un loop de redirects.
 */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  const cookie = request.cookies.get(DASHBOARD_COOKIE)?.value;
  if (cookie && cookie === (await dashboardCookieValue())) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
