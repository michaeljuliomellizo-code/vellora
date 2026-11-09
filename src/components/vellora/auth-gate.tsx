"use client";

/* VelloRa ERP — AuthGate: portada de acceso.
   Login con Supabase Auth real (signInWithPassword).
   Tras autenticar SOLO notifica al padre (onAuthenticated): la navegación
   la hace el padre, una única vez. Aquí NO hay router.refresh() — era la
   causa de que /dashboard se cargara 3 veces al iniciar sesión. */

import { useCallback, useState } from "react";
import { LogIn, Loader2, Scissors, HeartPulse } from "lucide-react";
import { supabaseBrowser } from "@/lib/vellora/supabase";

export default function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useCallback(
    async (mail: string, pass: string) => {
      setBusy(true);
      setErr("");
      const sb = supabaseBrowser();
      const { error } = await sb.auth.signInWithPassword({ email: mail, password: pass });
      setBusy(false);
      if (error) {
        setErr(error.message);
        return;
      }
      // Una sola notificación → el padre navega UNA vez a /dashboard.
      onAuthenticated();
    },
    [onAuthenticated]
  );

  return (
    <main className="vr-login">
      <div className="vr-login-card">
        <div className="vr-login-logo">
          <span className="vr-brand-mark">
            <Scissors size={20} />
          </span>
          <div>
            <strong style={{ font: "800 22px Manrope,sans-serif", letterSpacing: "-0.7px" }}>VelloRa ERP</strong>
            <div style={{ fontSize: 10, letterSpacing: "1.2px", color: "#a19caf", fontWeight: 700 }}>
              SALONES &amp; SPA · GESTIÓN INTELIGENTE
            </div>
          </div>
        </div>

        <p style={{ fontSize: 13, margin: "14px 0 20px" }}>
          Ingresa con tu correo y contraseña para acceder a tu organización.
        </p>

        <form
          className="vr-stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(email, password);
          }}
        >
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
            Correo
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tucorreo@salon.com"
              autoComplete="email"
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
            Contraseña
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {err && (
            <div role="alert" className="vr-alert vr-alert-critical" style={{ padding: "10px 12px" }}>
              <span>{err}</span>
            </div>
          )}

          <button className="vr-btn" type="submit" disabled={busy} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
            {busy ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "#a6a2b2" }}>
          <HeartPulse size={12} color="#7556d8" />
          Acceso protegido · VelloRa ERP
        </div>
      </div>
    </main>
  );
}
