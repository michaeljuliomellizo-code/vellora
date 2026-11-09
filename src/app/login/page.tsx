"use client";

/* VelloRa ERP — Ruta /login: envuelve el AuthGate.
   Tras autenticar entra UNA sola vez a /dashboard.
   Sin router.refresh() extra: cada refresh dispara otro GET /dashboard
   y el proxy revalida la sesión contra Supabase — por eso /dashboard se
   cargaba 3 veces al iniciar sesión (620 ms + 300 ms + 312 ms). */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/vellora/auth-gate";

export default function LoginPage() {
  const router = useRouter();

  const onAuthenticated = useCallback(() => {
    // Una única navegación. Las cookies de sesión ya están escritas por
    // el cliente de Supabase cuando signInWithPassword termina, así que
    // la petición RSC de /dashboard llega ya autenticada.
    router.replace("/dashboard");
  }, [router]);

  return <AuthGate onAuthenticated={onAuthenticated} />;
}
