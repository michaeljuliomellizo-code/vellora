/* VelloRa ERP — Fábrica del cliente Supabase.
   · Con NEXT_PUBLIC_SUPABASE_URL + clave pública → cliente real de Supabase.
     Acepta AMBOS nombres de clave: el clásico NEXT_PUBLIC_SUPABASE_ANON_KEY
     y el nuevo NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (misma llave, otro nombre).
   · Sin credenciales → cliente demo en memoria con el mismo subconjunto de API,
     de modo que TODO el código de la app funciona igual en ambos modos.
   · La SUPABASE_SERVICE_ROLE_KEY jamás se usa aquí: es secreta y solo servidor. */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export const IS_DEMO = !(SUPABASE_URL && SUPABASE_ANON_KEY);

/* Diagnóstico: URL configurada pero sin clave pública reconocida.
   Así el usuario ve en consola por qué la app sigue en modo demo. */
if (typeof window !== "undefined" && SUPABASE_URL && !SUPABASE_ANON_KEY) {
  console.warn(
    "[VelloRa] NEXT_PUBLIC_SUPABASE_URL está definida pero falta la clave pública. " +
      "Agrega NEXT_PUBLIC_SUPABASE_ANON_KEY (o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) en .env " +
      "y reinicia el servidor (Ctrl+C → npm run dev). La app sigue en modo demo."
  );
}

let realClient: SupabaseClient | null = null;

function getRealClient(): SupabaseClient {
  if (!realClient) {
    realClient = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return realClient;
}

/** Cliente con la forma usada por la app (real o demo). */
export type VrClient = ReturnType<typeof createDemoClient> | SupabaseClient;

export function supabaseBrowser(): VrClient {
  if (IS_DEMO) return createDemoClient();
  return getRealClient() as unknown as VrClient;
}

/** Indicador para mostrar el modo en la interfaz. */
export function clientMode(): "demo" | "supabase" {
  return IS_DEMO ? "demo" : "supabase";
}
