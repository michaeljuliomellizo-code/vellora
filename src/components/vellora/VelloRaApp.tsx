"use client";

/* VelloRa ERP — Orquestador de la SPA.
   Gestiona sesión → AuthGate → AppShell + vista activa según permisos del perfil. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "./AuthGate";
import AppShell from "./AppShell";
import DashboardClient from "./DashboardClient";
import AgendaView from "./modules/AgendaView";
import CajaView from "./modules/CajaView";
import ClientesView from "./modules/ClientesView";
import VentasView from "./modules/VentasView";
import ServiciosView from "./modules/ServiciosView";
import ProfesionalesView from "./modules/ProfesionalesView";
import InventarioView from "./modules/InventarioView";
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
import { can, ROLE_LANDING } from "@/lib/vellora/permissions";
import type { AppNotification, ModuleKey, OrganizationContext } from "@/lib/vellora/types";
import { Loader2 } from "lucide-react";

type Phase = "checking" | "login" | "ready";

export default function VelloRaApp() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [ctx, setCtx] = useState<OrganizationContext | null>(null);
  const [view, setView] = useState<ModuleKey>("dashboard");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

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
    try {
      const context = await getOrganizationContext();
      if (!context) {
        setCtx(null);
        setPhase("login");
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
      setPhase("login");
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
