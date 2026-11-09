import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/* VelloRa ERP — Callback de Supabase Auth.
   Canjea el ?code= del correo de confirmación por una sesión (cookies)
   y entra directo al dashboard.
   FIX: setAll debe devolver void (firma CookieMethodsServer);
   la respuesta se construye ANTES y las cookies se adjuntan dentro de setAll. */

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!url || !key || !code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  // Respuesta destino creada ANTES del cliente: exchangeCodeForSession
  // escribe las cookies de sesión sobre ella vía setAll.
  const response = NextResponse.redirect(new URL(next, origin));

  const sb = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        /* void — la firma CookieMethodsServer no admite return */
      },
    },
  });

  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  return response;
}