"use client";

/* VelloRa ERP — Dashboard principal (paso 1 y 2 de la propuesta).
   Visible SOLO para los perfiles Administración y Propietario.
   KPIs reales de Supabase (o del dataset demo), gráfico de ventas 30 días,
   estado del plan, alertas y próximas citas. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from "recharts";
import {
  TrendingUp, TrendingDown, CalendarCheck2, Receipt, Users2, Boxes, Activity,
  Wallet, Loader2, ShieldAlert, Clock3, Cake, Sparkles, ArrowRight, Lock,
} from "lucide-react";
import type { ModuleKey, OrganizationContext, Appointment, Customer } from "@/lib/vellora/types";
import {
  fetchAppointments, fetchSales, fetchCustomers, fetchEmployees, fetchProducts,
  fetchNotifications, fetchServices, computeKpis, revenueSeries, upcomingAppointments,
  dashboardAlerts, planUsage, RANGE_LABELS, type Range, type Kpis, type DayPoint,
} from "@/lib/vellora/queries";
import { formatCOP, formatNumber, formatPct, formatTime, relativeDay, formatDateShort, initialsOf } from "@/lib/vellora/format";
import { planChecks, resolvePlanLimits } from "@/lib/vellora/permissions";
import { ChartBox } from "./ui-bits";

type Props = { ctx: OrganizationContext; onView: (v: ModuleKey) => void };

type Load = {
  kpis: Kpis;
  series: DayPoint[];
  upcoming: Appointment[];
  alerts: ReturnType<typeof dashboardAlerts>;
  planUsage: ReturnType<typeof planUsage>;
  birthdays: Customer[];
  todayList: Appointment[];
};

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("es-CO", { hour: "numeric", hour12: false, timeZone: "America/Bogota" }).format(new Date()));
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.slice(-14);
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const w = 120;
  const hgt = 30;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = hgt - ((v - min) / (max - min || 1)) * hgt;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="vr-spark" width={w} height={hgt} viewBox={`0 0 ${w} ${hgt}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="vr-muted">— sin datos previos</span>;
  const up = value >= 0;
  return (
    <span className={`vr-trend ${up ? "vr-trend-up" : "vr-trend-down"}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {formatPct(Math.abs(value), 1)}
    </span>
  );
}

export default function DashboardClient({ ctx, onView }: Props) {
  /* Guardia: solo Administración / Propietario */
  const roleKey = (ctx.role?.role_key ?? "") as string;
  const allowed = roleKey === "owner" || roleKey === "administracion";

  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<Load | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartMode, setChartMode] = useState<"revenue" | "citas">("revenue");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgId = ctx.organizationId;
      const [appointments, sales, customers, employees, products, notifications, services] = await Promise.all([
        fetchAppointments(orgId, 90, 12),
        fetchSales(orgId, 90),
        fetchCustomers(orgId),
        fetchEmployees(orgId),
        fetchProducts(orgId),
        fetchNotifications(orgId),
        fetchServices(orgId),
      ]);

      const kpis = computeKpis(appointments, sales, customers, employees, range);
      const series = revenueSeries(sales, appointments, 30);
      const upcoming = upcomingAppointments(appointments, 6);
      const usage = planUsage(employees, ctx.branches, appointments);
      const plan = ctx.subscription?.plan ?? null;
      const alerts = dashboardAlerts(products, appointments, notifications, plan, usage);

      /* Cumpleaños de los próximos 30 días */
      const now = new Date();
      const birthdays = customers
        .filter((c) => {
          if (!c.birth_date) return false;
          const b = new Date(c.birth_date);
          const next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
          const diff = (next.getTime() - now.getTime()) / 86_400_000;
          return diff >= 0 && diff <= 30;
        })
        .sort((a, b) => {
          const da = new Date(a.birth_date!), db2 = new Date(b.birth_date!);
          return (da.getMonth() * 40 + da.getDate()) - (db2.getMonth() * 40 + db2.getDate());
        })
        .slice(0, 4);

      const todayKey = new Date().toDateString();
      const todayList = appointments
        .filter((a) => new Date(a.starts_at).toDateString() === todayKey && a.status !== "cancelled")
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

      setData({ kpis, series, upcoming, alerts, planUsage: usage, birthdays, todayList });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible cargar los indicadores");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId, ctx.branches, ctx.subscription?.plan, range]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!allowed) {
    return (
      <div className="vr-card" style={{ textAlign: "center", padding: 40 }}>
        <Lock size={30} color="#d94b66" style={{ marginBottom: 10 }} />
        <h1>Dashboard restringido</h1>
        <p style={{ maxWidth: 420, margin: "0 auto 6px" }}>
          El dashboard general solo está disponible para el perfil <strong>Administración</strong>.
          Tu perfil (<strong>{ctx.role?.name}</strong>) tiene una vista operativa dedicada.
        </p>
        <button className="vr-btn" onClick={() => onView(roleKey === "cajero" ? "caja" : "agenda")}>
          Ir a {roleKey === "cajero" ? "Caja" : "Agenda"}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="vr-empty" style={{ padding: 60 }}>
        <Loader2 size={22} className="animate-spin" style={{ margin: "0 auto 10px", display: "block", color: "#7556d8" }} />
        Calculando indicadores…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="vr-card vr-error" style={{ border: "1px solid #ffd4dc" }}>
        {error || "Sin datos"}
        <button className="vr-btn-secondary vr-btn-sm" style={{ marginLeft: 12 }} onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  }

  const k = data.kpis;
  const plan = ctx.subscription?.plan ?? null;
  const checks = plan ? planChecks(resolvePlanLimits(plan), data.planUsage) : [];

  const kpiCards = [
    {
      label: `Ingresos · ${RANGE_LABELS[range].toLowerCase()}`,
      value: formatCOP(k.revenue, { compact: true }),
      note: <><Trend value={k.revenueChange} /> vs periodo anterior</>,
      icon: <Wallet size={19} />, tone: "purple",
      spark: data.series.map((d) => d.revenue), color: "#7556d8",
      onClick: () => onView("ventas"),
    },
    {
      label: "Citas completadas",
      value: formatNumber(k.completedAppointments),
      note: <><Trend value={k.completedChange} /> vs periodo anterior</>,
      icon: <CalendarCheck2 size={19} />, tone: "green",
      spark: data.series.map((d) => d.citas), color: "#239b72",
      onClick: () => onView("agenda"),
    },
    {
      label: "Ticket promedio",
      value: formatCOP(k.avgTicket),
      note: <><Trend value={k.avgTicketChange} /> por venta</>,
      icon: <Receipt size={19} />, tone: "blue",
      spark: null, color: "#3973ce",
      onClick: () => onView("ventas"),
    },
    {
      label: "Clientes nuevos",
      value: formatNumber(k.newCustomers),
      note: <><Trend value={k.newCustomersChange} /> vs periodo anterior</>,
      icon: <Users2 size={19} />, tone: "orange",
      spark: null, color: "#c67a26",
      onClick: () => onView("clientes"),
    },
    {
      label: "Ocupación del equipo",
      value: k.occupancy !== null ? formatPct(k.occupancy) : "—",
      note: "Horas agendadas / capacidad",
      icon: <Activity size={19} />, tone: "purple",
      spark: null, color: "#7556d8",
      onClick: () => onView("profesionales"),
    },
    {
      label: "Venta de productos",
      value: formatCOP(k.productRevenue, { compact: true }),
      note: <><Trend value={k.productRevenueChange} /> servicios: {formatCOP(k.serviceRevenue, { compact: true })}</>,
      icon: <Boxes size={19} />, tone: "green",
      spark: null, color: "#239b72",
      onClick: () => onView("inventario"),
    },
  ];

  const toneClass: Record<string, string> = {
    purple: "vr-di-purple", green: "vr-di-green", blue: "vr-di-blue", orange: "vr-di-orange", red: "vr-di-red",
  };

  const quickLinks: { key: ModuleKey; label: string; desc: string; tone: string }[] = [
    { key: "agenda", label: "Agenda de hoy", desc: `${data.todayList.length} citas programadas`, tone: "vr-di-purple" },
    { key: "caja", label: "Caja del día", desc: "Cobros y cierre de turno", tone: "vr-di-green" },
    { key: "clientes", label: "Nuevo cliente", desc: "Registra y fideliza", tone: "vr-di-blue" },
    { key: "inventario", label: "Inventario", desc: "Stock y alertas", tone: "vr-di-orange" },
  ];

  return (
    <div className="vr-stack vr-dashboard-page" style={{ gap: 20 }}>
      {/* Encabezado */}
      <div className="vr-page-heading" style={{ marginBottom: 0 }}>
        <div>
          <div className="vr-eyebrow">Panel general · {RANGE_LABELS[range]}</div>
          <h1>
            {greeting()}, {ctx.user.full_name?.split(" ")[0]}
          </h1>
          <p>
            Resumen de <strong>{ctx.organization.name}</strong> · {formatNumber(data.planUsage.monthlyAppointments)} citas este mes · {data.planUsage.professionals} profesionales activos
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Alertas (paso 6) */}
      {data.alerts.length > 0 && (
        <section style={{ display: "grid", gap: 10 }}>
          {data.alerts.map((a) => (
            <div key={a.id} className={`vr-alert vr-alert-${a.severity}`}>
              <ShieldAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
              </div>
              <button className="vr-btn-secondary vr-btn-sm" onClick={() => onView(a.module as ModuleKey)}>
                Ver
              </button>
            </div>
          ))}
        </section>
      )}

      {/* KPIs (paso 2) */}
      <section className="vr-metric-grid" style={{ marginBottom: 0 }} aria-label="Indicadores clave">
        {kpiCards.map((c) => (
          <button
            key={c.label}
            type="button"
            className="vr-metric-card"
            style={{ textAlign: "left", cursor: "pointer", display: "block" }}
            onClick={c.onClick}
          >
            <div className="vr-metric-top">
              <span className="vr-metric-label">{c.label}</span>
              <span className={`vr-dashboard-icon ${toneClass[c.tone]}`}>{c.icon}</span>
            </div>
            <div className="vr-metric-value">{c.value}</div>
            <div className="vr-metric-note">{c.note}</div>
            {c.spark && <Sparkline data={c.spark} color={c.color} />}
          </button>
        ))}
      </section>

      <div className="vr-dashboard-grid">
        {/* Gráfico principal (paso 3) */}
        <section className="vr-card">
          <div className="vr-section-head" style={{ marginBottom: 8 }}>
            <div>
              <h2 style={{ marginBottom: 3 }}>Ventas de los últimos 30 días</h2>
              <p>Ingresos cobrados y citas completadas por día · moneda COP</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={chartMode === "revenue" ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
                onClick={() => setChartMode("revenue")}
              >
                Ingresos
              </button>
              <button
                type="button"
                className={chartMode === "citas" ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
                onClick={() => setChartMode("citas")}
              >
                Citas
              </button>
            </div>
          </div>

          <ChartBox height={265}>
            {(chartWidth) => chartMode === "revenue" ? (
              <AreaChart width={chartWidth} height={265} data={data.series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7556d8" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#7556d8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeecf4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#9a96a9" }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatCOP(v), "Ingresos"]}
                    labelStyle={{ fontSize: 11, color: "#6d6880" }}
                    contentStyle={{ borderRadius: 12, border: "1px solid #ebe9f2", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#7556d8" strokeWidth={2.4} fill="url(#gradRev)" />
              </AreaChart>
            ) : (
              <BarChart width={chartWidth} height={265} data={data.series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeecf4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip
                    formatter={(v: number) => [v, "Citas completadas"]}
                    labelStyle={{ fontSize: 11, color: "#6d6880" }}
                    contentStyle={{ borderRadius: 12, border: "1px solid #ebe9f2", fontSize: 12 }}
                  />
                  <Bar dataKey="citas" fill="#239b72" radius={[5, 5, 0, 0]} maxBarSize={22} />
              </BarChart>
            )}
          </ChartBox>
        </section>

        {/* Columna derecha */}
        <div className="vr-stack" style={{ gap: 18 }}>
          {/* Plan actual (paso 4) */}
          <section className="vr-card">
            <div className="vr-section-head" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>Plan {plan?.name ?? "—"}</h2>
                <p>Uso dentro de los límites incluidos</p>
              </div>
              <Sparkles size={18} color="#7556d8" />
            </div>

            <div style={{ display: "grid", gap: 13 }}>
              {checks.map((c) => {
                const pct = c.limit < 0 ? 0 : Math.min(100, Math.round((c.used / c.limit) * 100));
                const cls = !c.ok ? "vr-progress-danger" : c.warn ? "vr-progress-warn" : "vr-progress-ok";
                return (
                  <div key={c.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, color: "#5e5a70" }}>{c.label}</span>
                      <span style={{ color: "#8e899f" }}>
                        {formatNumber(c.used)} / {c.limit < 0 ? "∞" : formatNumber(c.limit)}
                      </span>
                    </div>
                    <div className={`vr-progress ${cls}`} aria-hidden>
                      <span style={{ width: c.limit < 0 ? "8%" : `${pct}%` }} />
                    </div>
                    {(!c.ok || c.warn) && (
                      <div style={{ fontSize: 10.5, marginTop: 4, color: !c.ok ? "#d94b66" : "#b06a1c" }}>
                        {!c.ok
                          ? "Límite superado — mejora de plan requerida"
                          : "Cerca del límite del plan"}
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="vr-btn-secondary vr-btn-sm" style={{ justifySelf: "start" }} onClick={() => onView("configuracion")}>
                Ver planes y suscripción <ArrowRight size={12} style={{ display: "inline", verticalAlign: "-2px" }} />
              </button>
            </div>
          </section>

          {/* Próximas citas */}
          <section className="vr-card">
            <div className="vr-section-head" style={{ marginBottom: 10 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>Próximas citas</h2>
                <p>Confirmadas y pendientes</p>
              </div>
              <Clock3 size={17} color="#7556d8" />
            </div>
            {data.upcoming.length === 0 ? (
              <div className="vr-empty">
                <strong>Agenda libre</strong>
                No hay citas próximas programadas.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {data.upcoming.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f4f3f8" }}>
                    <span
                      className="vr-avatar"
                      style={{ width: 34, height: 34, fontSize: 9.5, borderRadius: 10, background: a.status === "reserved" || a.status === "scheduled" ? "linear-gradient(140deg,#f0c06e,#c67a26)" : "linear-gradient(140deg,#9c80f2,#6b4dce)" }}
                    >
                      {formatTime(a.starts_at).replace(/\s?(am|pm)/i, "")}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--bp-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {relativeDay(a.starts_at)} · {a.status === "reserved" || a.status === "scheduled" ? "Por confirmar" : "Confirmada"}
                      </div>
                      <div style={{ fontSize: 11, color: "#8d899e" }}>{a.source === "online" ? "Reserva online" : "Cita en sede"}</div>
                    </div>
                    <span className={`vr-pill ${a.status === "reserved" || a.status === "scheduled" ? "vr-pill-amber" : "vr-pill-green"}`}>{formatCOP(a.price, { compact: true })}</span>
                  </div>
                ))}
                <button className="vr-btn-secondary vr-btn-sm" style={{ justifySelf: "start", marginTop: 6 }} onClick={() => onView("agenda")}>
                  Abrir agenda <ArrowRight size={12} style={{ display: "inline", verticalAlign: "-2px" }} />
                </button>
              </div>
            )}
          </section>

          {/* Cumpleaños */}
          <section className="vr-card">
            <div className="vr-section-head" style={{ marginBottom: 10 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>Cumpleaños próximos</h2>
                <p>Oportunidad de fidelización</p>
              </div>
              <Cake size={17} color="#c67a26" />
            </div>
            {data.birthdays.length === 0 ? (
              <div className="vr-empty" style={{ padding: 16 }}>
                Sin cumpleaños en los próximos 30 días.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {data.birthdays.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="vr-avatar" style={{ width: 30, height: 30, fontSize: 10, borderRadius: 9, background: "linear-gradient(140deg,#f0a86e,#c67a26)" }}>
                      {initialsOf(c.full_name)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--bp-ink)" }}>{c.full_name}</div>
                      <div style={{ fontSize: 11, color: "#8d899e" }}>
                        {c.birth_date ? formatDateShort(c.birth_date) : ""}{c.phone ? ` · ${c.phone}` : ""}
                      </div>
                    </div>
                    <span className="vr-pill vr-pill-amber">20% dcto</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Accesos rápidos */}
      <section className="vr-card">
        <div className="vr-section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Accesos rápidos</h2>
            <p>Las tareas más frecuentes del día</p>
          </div>
        </div>
        <div className="vr-quick-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
          {quickLinks.map((q) => (
            <button key={q.key} type="button" className="vr-quick-link" onClick={() => onView(q.key)}>
              <span className={`vr-quick-icon ${q.tone}`}>
                {q.key === "agenda" ? <CalendarCheck2 size={16} /> : q.key === "caja" ? <Wallet size={16} /> : q.key === "clientes" ? <Users2 size={16} /> : <Boxes size={16} />}
              </span>
              <span>
                <strong>{q.label}</strong>
                <small>{q.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
