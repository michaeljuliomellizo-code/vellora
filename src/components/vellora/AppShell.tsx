"use client";

/* VelloRa ERP — AppShell: sidebar + topbar + pie.
   Filtra el menú según los permisos del perfil (owner / administracion / cajero / profesional),
   incluye centro de notificaciones y es responsive para móvil (paso 8). */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, CalendarDays, Banknote, Users, ReceiptText, Scissors, UserCog,
  Package, ShoppingCart, Wallet, Gift, Megaphone, BarChart3, Globe, Settings, Droplets,
  Menu, X, Bell, LogOut, Scissors as LogoIcon, ChevronRight, ShieldCheck, Info,
} from "lucide-react";
import type { ModuleKey, OrganizationContext, AppNotification } from "@/lib/vellora/types";
import { MODULE_LIST, can, ROLE_DESCRIPTIONS, resolvePlanLimits } from "@/lib/vellora/permissions";
import { initialsOf, formatDate } from "@/lib/vellora/format";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  caja: Banknote,
  clientes: Users,
  ventas: ReceiptText,
  servicios: Scissors,
  profesionales: UserCog,
  inventario: Package,
  compras: ShoppingCart,
  consumo: Droplets,
  nomina: Wallet,
  fidelizacion: Gift,
  marketing: Megaphone,
  reportes: BarChart3,
  reservas_online: Globe,
  configuracion: Settings,
};

type Props = {
  ctx: OrganizationContext;
  view: ModuleKey;
  onView: (v: ModuleKey) => void;
  onSignOut: () => void;
  notifications: AppNotification[];
  onOpenNotification: (moduleKey: string) => void;
  children: React.ReactNode;
};

export default function AppShell({ ctx, view, onView, onSignOut, notifications, onOpenNotification, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const roleKey = (ctx.role?.role_key ?? "profesional") as string;

  /* Módulos visibles según permisos */
  const navModules = useMemo(
    () =>
      MODULE_LIST.filter((m) => {
        if (m.key === "dashboard") {
          /* El dashboard solo lo ven Administración (y el owner protegido) */
          return roleKey === "owner" || roleKey === "administracion";
        }
        return can(ctx.permissions, m.key, "can_view");
      }),
    [ctx.permissions, roleKey]
  );

  const groups = useMemo(() => {
    const g = new Map<string, typeof navModules>();
    for (const m of navModules) {
      const list = g.get(m.category) ?? [];
      list.push(m);
      g.set(m.category, list);
    }
    return [...g.entries()];
  }, [navModules]);

  /* Notificaciones del perfil actual */
  const myNotifications = useMemo(
    () => notifications.filter((n) => (n.audience_roles as string[]).includes(roleKey)).slice(0, 8),
    [notifications, roleKey]
  );
  const unread = myNotifications.length;

  const plan = ctx.subscription?.plan;
  const planKey = plan?.plan_key ?? "";
  const planLimits = resolvePlanLimits(plan);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [view]);

  const currentName = navModules.find((m) => m.key === view)?.name ?? "VelloRa";

  const nav = (
    <nav className="vr-nav" aria-label="Navegación principal">
      {groups.map(([category, mods]) => (
        <div key={category}>
          <div className="vr-nav-heading">{category}</div>
          {mods.map((m) => {
            const Icon = ICONS[m.key] ?? Info;
            const active = view === m.key;
            const badge = m.key === "caja" ? myNotifications.filter((n) => n.module_key === "caja").length : 0;
            return (
              <button
                key={m.key}
                type="button"
                className={`vr-nav-link${active ? " active" : ""}`}
                onClick={() => onView(m.key)}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{m.name}</span>
                {badge > 0 && <span className="vr-nav-badge">{badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="vr-shell vr-root">
      {/* Sidebar escritorio / drawer móvil */}
      {menuOpen && <button className="vr-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <aside className={`vr-sidebar${menuOpen ? " vr-sidebar-open" : ""}`}>
        <button className="vr-sidebar-close" aria-label="Cerrar" onClick={() => setMenuOpen(false)}>
          <X size={16} />
        </button>
        <div className="vr-brand">
          <span className="vr-brand-mark">
            <LogoIcon size={20} />
          </span>
          <div>
            <strong>VelloRa</strong>
            <small>ERP SALONES &amp; SPA</small>
          </div>
        </div>

        {nav}

        <div className="vr-sidebar-bottom">
          {plan && (
            <>
              <div className="vr-plan">
                <span className="vr-plan-icon"><ShieldCheck size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <strong>Plan {plan.name}</strong>
                  <small>
                    {planKey === "elite"
                      ? "Límites ilimitados"
                      : `${ctx.organization.name.split(" ")[0]} · hasta ${planLimits.max_professionals} prof.`}
                  </small>
                </div>
              </div>
              {planKey !== "elite" && (
                <div className="vr-plan-progress" aria-hidden>
                  <span style={{ width: `${Math.min(100, Math.round((planLimits.max_professionals < 0 ? 0 : 100) || 40))}%` }} />
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px" }}>
            <span className="vr-avatar" style={{ width: 32, height: 32, fontSize: 11, borderRadius: 9 }}>
              {initialsOf(ctx.user.full_name)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bp-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ctx.user.full_name}
              </div>
              <div style={{ fontSize: 10, color: "#9a96a9", textTransform: "capitalize" }}>
                {ctx.role?.name ?? "Sin perfil"}
              </div>
            </div>
            <button type="button" className="vr-icon-btn" style={{ width: 32, height: 32 }} onClick={onSignOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <div className="vr-main-wrap">
        {/* Topbar */}
        <header className="vr-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <button className="vr-menu-button" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="vr-breadcrumb">
              <strong>{ctx.organization.name}</strong>
              <ChevronRight size={11} style={{ display: "inline", margin: "0 4px", verticalAlign: "-1px" }} />
              {currentName}
            </div>
          </div>

          <div className="vr-topbar-right">
            <span className="vr-status-dot" aria-hidden />
            <span className="vr-user-chip">
              {formatDate(new Date().toISOString())}
            </span>

            {/* Campana de notificaciones */}
            <div style={{ position: "relative" }} ref={notifRef}>
              <button
                type="button"
                className="vr-icon-btn"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label={`Notificaciones (${unread} sin leer)`}
                aria-expanded={notifOpen}
              >
                <Bell size={16} />
                {unread > 0 && <span className="vr-icon-dot" />}
              </button>

              {notifOpen && (
                <div className="vr-pop" role="dialog" aria-label="Notificaciones">
                  <div className="vr-pop-head">
                    <span>Alertas y notificaciones</span>
                    <span style={{ fontSize: 10, color: "#9a96a9", fontWeight: 500 }}>{unread} para tu perfil</span>
                  </div>
                  <div className="vr-pop-list">
                    {myNotifications.length === 0 ? (
                      <div className="vr-empty" style={{ padding: 24 }}>
                        <strong>Todo en orden</strong>
                        No hay notificaciones para tu perfil.
                      </div>
                    ) : (
                      myNotifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="vr-pop-item unread"
                          style={{ width: "100%", textAlign: "left", background: "transparent", border: 0 }}
                          onClick={() => {
                            setNotifOpen(false);
                            onOpenNotification(String(n.module_key));
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                              background: n.severity === "critical" ? "#d94b66" : n.severity === "warning" ? "#e9a13b" : "#7556d8",
                            }}
                          />
                          <span style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", fontSize: 12.5, color: "var(--bp-ink)" }}>{n.title}</strong>
                            <span style={{ fontSize: 11.5, color: "#8d899e", lineHeight: 1.45, display: "block" }}>{n.body}</span>
                            <span style={{ fontSize: 10, color: "#b3aec2", display: "block", marginTop: 3 }}>{formatDate(n.created_at)}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <span className="vr-avatar vr-user-chip" title={ROLE_DESCRIPTIONS[roleKey as keyof typeof ROLE_DESCRIPTIONS] ?? ""}>
              {initialsOf(ctx.user.full_name)}
            </span>
          </div>
        </header>

        <main className="vr-main">{children}</main>

        <footer className="vr-footer">
          <span>
            © {new Date().getFullYear()} VelloRa ERP · {ctx.organization.name}
          </span>
          <span>
            Sesión protegida por RLS
          </span>
        </footer>
      </div>
    </div>
  );
}
