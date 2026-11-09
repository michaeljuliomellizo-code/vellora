"use client";

/* VelloRa ERP — Orquestador de la SPA.
   Gestión sesión → AuthGate → AppShell + vista activa según permisos del perfil.
   FIX: si hay sesión válida pero la organización/perfil no existe en BD,
   se muestra una pantalla explicativa ("sin-config") en vez del login,
   que causaba la sensación de bucle login → dashboard → login. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "./auth-gate";
import AppShell from "./AppShell";
import DashboardClient from "./DashboardClient";
import AgendaView from "./modules/AgendaView";
import CajaView from "./modules/CajaView";
import ClientesView from "./modules/ClientesView";
import VentasView from "./modules/VentasView";
import ServiciosView from "./modules/ServiciosView";
import ProfesionalesView from "./modules/ProfesionalesView";
import InventarioView from "./modules/InventarioView";
import ProveedoresView from "./modules/ProveedoresView";
import ComprasView from "./modules/ComprasView";
import ConsumoInternoView from "./modules/ConsumoInternoView";
import NominaView from "./modules/NominaView";
import FidelizacionView from "./modules/FidelizacionView";
import MarketingView from "./modules/MarketingView";
import ReservasOnlineView from "./modules/ReservasOnlineView";
import ReportesView from "./modules/ReportesView";
import ConfiguracionView from "./modules/ConfiguracionView";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { getOrganizationContext } from "@/lib/vellora/organization";
import { fetchNotifications } from "@/lib/vellora/queries";
import { can, ROLE_LANDING, planAllowsModule } from "@/lib/vellora/permissions";
import type { AppNotification, ModuleKey, OrganizationContext } from "@/lib/vellora/types";
import { AlertTriangle, Loader2, LogOut, RefreshCw } from "lucide-react";

type Phase = "checking" | "login" | "ready" | "sin-config";

export default function VelloRaApp() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [ctx, setCtx] = useState<OrganizationContext | null>(null);
  const [view, setView] = useState<ModuleKey>("dashboard");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userEmail, setUserEmail] = useState<string>("");

  /* Cargar sesión y contexto */
  const refreshContext = useCallback(async () => {
    setPhase("checking");
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    if (!data?.user) {
      setCtx(null);
      setPhase("login");
      return;
    }
    setUserEmail(data.user.email ?? "");

    try {
      const context = await getOrganizationContext();
      if (!context) {
        /* Hay sesión, pero el usuario no tiene organización/rol en BD */
        setCtx(null);
        setPhase("sin-config");
        return;
      }
      setCtx(context);

      /* Landing según perfil: cajero → caja, profesional → agenda, admin → dashboard */
      const roleKey = (context.role?.role_key ?? "profesional") as keyof typeof ROLE_LANDING;
      setView(ROLE_LANDING[roleKey] as ModuleKey);

      try {
        setNotifications(await fetchNotifications(context.organizationId));
      } catch {
        setNotifications([]);
      }
      setPhase("ready");
    } catch {
      setCtx(null);
      setPhase("sin-config");
    }
  }, []);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const handleSignOut = useCallback(async () => {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    setCtx(null);
    setNotifications([]);
    setPhase("login");
    router.refresh();
  }, [router]);

  /* Navegación con control de permisos: si el perfil no puede ver el módulo, vuelve a su landing */
  const goView = useCallback(
    (target: string) => {
      if (!ctx) return;
      const roleKey = (ctx.role?.role_key ?? "profesional") as keyof typeof ROLE_LANDING;
      if (target === "dashboard") {
        /* El dashboard solo lo ve Administración (y owner) */
        if (roleKey !== "owner" && roleKey !== "administracion") {
          setView(ROLE_LANDING[roleKey] as ModuleKey);
          return;
        }
        setView("dashboard");
        return;
      }
      /* Módulos no incluidos en el plan actual → vuelve a la landing del perfil */
      if (!planAllowsModule(ctx.subscription?.plan?.plan_key ?? "", target)) {
        setView(ROLE_LANDING[roleKey] as ModuleKey);
        return;
      }
      if (can(ctx.permissions, target, "can_view")) {
        setView(target as ModuleKey);
      } else {
        setView(ROLE_LANDING[roleKey] as ModuleKey);
      }
    },
    [ctx]
  );

  const body = useMemo(() => {
    if (!ctx) return null;
    switch (view) {
      case "dashboard": return <DashboardClient ctx={ctx} onView={goView} />;
      case "agenda": return <AgendaView ctx={ctx} />;
      case "caja": return <CajaView ctx={ctx} />;
      case "clientes": return <ClientesView ctx={ctx} />;
      case "ventas": return <VentasView ctx={ctx} />;
      case "servicios": return <ServiciosView ctx={ctx} />;
      case "profesionales": return <ProfesionalesView ctx={ctx} />;
      case "inventario": return <InventarioView ctx={ctx} />;
      case "proveedores": return <ProveedoresView ctx={ctx} />;
      case "compras": return <ComprasView ctx={ctx} />;
      case "consumo": return <ConsumoInternoView ctx={ctx} />;
      case "nomina": return <NominaView ctx={ctx} />;
      case "fidelizacion": return <FidelizacionView ctx={ctx} />;
      case "marketing": return <MarketingView ctx={ctx} />;
      case "reservas_online": return <ReservasOnlineView ctx={ctx} />;
      case "reportes": return <ReportesView ctx={ctx} />;
      case "configuracion": return <ConfiguracionView ctx={ctx} />;
      default: return <DashboardClient ctx={ctx} onView={goView} />;
    }
  }, [ctx, view, goView]);

  if (phase === "checking") {
    return (
      <main className="vr-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <Loader2 size={26} className="animate-spin" style={{ color: "#7556d8", margin: "0 auto 12px", display: "block" }} />
          <div style={{ fontSize: 13, color: "#8d899e" }}>Iniciando VelloRa ERP…</div>
        </div>
      </main>
    );
  }

  /* FIX: sesión válida pero sin organización/perfil en la base de datos.
     Antes esto caía en AuthGate y parecía un bucle de login. */
  if (phase === "sin-config") {
    return (
      <main className="vr-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f5fa" }}>
        <div style={{ width: "100%", maxWidth: 480, background: "#ffffff", border: "1px solid #e6e3f0", borderRadius: 16, padding: 28, boxShadow: "0 10px 30px rgba(28,15,66,0.08)", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: "#f3effc", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <AlertTriangle size={24} style={{ color: "#7556d8" }} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1c0f42", margin: 0 }}>
            Cuenta sin configuración inicial
          </h1>
          <p style={{ fontSize: 14, color: "#5b5670", lineHeight: 1.6, marginTop: 10 }}>
            Tu sesión inició correctamente{userEmail ? <> como <strong>{userEmail}</strong></> : null}, pero tu
            usuario todavía no tiene organización y rol asignados en la base de datos, por lo que
            VelloRa no puede cargar tu espacio de trabajo.
          </p>
          <p style={{ fontSize: 12.5, color: "#8d899e", lineHeight: 1.6, marginTop: 6 }}>
            Esto se resuelve creando la organización y el perfil del usuario (configuración inicial en Supabase).
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void refreshContext()}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#7556d8", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              <RefreshCw size={15} /> Reintentar
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: "#5b5670", border: "1px solid #e6e3f0", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              <LogOut size={15} /> Cerrar sesión
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "login" || !ctx) {
    return <AuthGate onAuthenticated={() => void refreshContext()} />;
  }

  return (
    <AppShell
      ctx={ctx}
      view={view}
      onView={(v) => goView(v)}
      onSignOut={() => void handleSignOut()}
      notifications={notifications}
      onOpenNotification={(moduleKey) => goView(moduleKey)}
    >
      {body}
    </AppShell>
  );
}