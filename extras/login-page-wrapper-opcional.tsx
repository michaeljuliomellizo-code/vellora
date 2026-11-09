"use client";

/* OPCIONAL — Login en la ruta /login.
   Úsalo SOLO si quieres mantener la URL /login además del gate en /.
   Si tu ERP vive detrás del gate en / (portada de acceso), no necesitas
   este archivo: borra src/app/login/page.tsx y listo. */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/vellora/auth-gate";

export default function LoginPage() {
  const router = useRouter();

  const onAuthenticated = useCallback(() => {
    router.replace("/dashboard"); // ← apunta a la pantalla principal de tu ERP
  }, [router]);

  return <AuthGate onAuthenticated={onAuthenticated} />;
}
