import { NextResponse } from "next/server";
import { DASHBOARD_COOKIE, dashboardCookieValue, isValidDashboardPassword } from "@/lib/auth";

/** POST /api/login: { password } → cookie si coincide con DASHBOARD_PASSWORD. Ver middleware.ts. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await isValidDashboardPassword(password))) {
    return NextResponse.json({ ok: false, error: "Contraseña incorrecta" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(DASHBOARD_COOKIE, await dashboardCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400, // 400 días: el máximo que Chrome permite para una cookie, se vence solo igual
  });
  return res;
}
