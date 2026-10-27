import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

/**
 * Cliente anon: para lo que algún día corra en el browser.
 * Hoy las tablas no tienen policies para anon, así que solo sirve para Storage público.
 */
export function supabaseAnon(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );
}

let adminClient: SupabaseClient | null = null;

/**
 * Cliente service role: SOLO en server (route handlers, server actions, crons).
 * Saltea RLS. Nunca importar desde un Client Component.
 */
export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() no se puede usar en el browser");
  }
  if (!adminClient) {
    adminClient = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return adminClient;
}
