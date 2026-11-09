"use client";

/* VelloRa ERP — Módulo Reportes: analítica avanzada (paso 7) con export CSV. */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Download, Lock, ShieldCheck } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { OrganizationContext } from "@/lib/vellora/types";
import {
  fetchAppointments, fetchSales, fetchCustomers, fetchEmployees, topServices,
} from "@/lib/vellora/queries";
import { formatCOP, formatNumber, formatPct, bogotaDayKey } from "@/lib/vellora/format";
import { computeKpis } from "@/lib/vellora/queries";
import { PageHeader, EmptyState, ChartBox } from "../ui-bits";

/* ————— Reportes por plan —————
   Cada plan desbloquea más secciones (espejo de las características de
   PLAN_LIMITS en permissions.ts):
     · esencial    → Resumen + Top servicios
     · profesional → + Ingresos por profesional + Comparativo mensual + CSV
     · elite       → + Métodos de pago (todo)
   Plan desconocido o sin suscripción → todo desbloqueado (mismo criterio
   tolerante de resolvePlanLimits).                                   */
type ReportFlags = {
  resumen: boolean; top: boolean; porProfesional: boolean;
  pagos: boolean; mensual: boolean; csv: boolean;
};

function reportsForPlan(planKey: string): ReportFlags {
  if (planKey === "esencial") {
    return { resumen: true, top: true, porProfesional: false, pagos: false, mensual: false, csv: false };
  }
  if (planKey === "profesional") {
    return { resumen: true, top: true, porProfesional: true, pagos: false, mensual: true, csv: true };
  }
  return { resumen: true, top: true, porProfesional: true, pagos: true, mensual: true, csv: true };
}

const UNLOCK_LABEL: Record<keyof ReportFlags, string> = {
  resumen: "",
  top: "plan Esencial",
  porProfesional: "plan Profesional",
  pagos: "plan Elite",
  mensual: "plan Profesional",
  csv: "plan Profesional",
};

/** Tarjeta con candado para secciones no incluidas en el plan actual. */
function LockedCard({ title, planLabel }: { title: string; planLabel: string }) {
  return (
    <section className="vr-card" style={{ position: "relative" }}>
      <h2>{title}</h2>
      <div
        style={{
          display: "grid", placeItems: "center", textAlign: "center",
          minHeight: 180, padding: "18px 10px",
          background: "repeating-linear-gradient(135deg, #faf9fd 0 12px, #f5f3fb 12px 24px)",
          borderRadius: 12, border: "1px dashed #d9d3ea",
        }}
      >
        <div style={{ width: 42, height: 42, borderRadius: 999, background: "#efe9fb", display: "grid", placeItems: "center", margin: "0 auto 10px" }}>
          <Lock size={18} style={{ color: "#7556d8" }} />
        </div>
        <strong style={{ fontSize: 13.5, color: "var(--bp-ink)", display: "block" }}>Reporte bloqueado en tu plan actual</strong>
        <span style={{ fontSize: 12, color: "#8d899e", display: "block", marginTop: 4, lineHeight: 1.5 }}>
          Disponible desde el <strong>{planLabel}</strong>. Cambia de plan en<br />Configuración → Plan y Suscripción.
        </span>
      </div>
    </section>
  );
}

export default function ReportesView({ ctx }: { ctx: OrganizationContext }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [top, setTop] = useState<{ name: string; revenue: number; count: number }[]>([]);
  const [byProfessional, setByProfessional] = useState<{ name: string; revenue: number }[]>([]);
  const [byPayment, setByPayment] = useState<{ name: string; value: number }[]>([]);
  const [summary, setSummary] = useState<{ label: string; value: string; delta: string }[]>([]);
  const [monthly, setMonthly] = useState<{ name: string; revenue: number }[]>([]);

  const planKey = String(ctx.subscription?.plan?.plan_key ?? "").toLowerCase();
  const planName = ctx.subscription?.plan?.name ?? "Elite";
  const reports = reportsForPlan(planKey);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = ctx.organizationId;
      const [appointments, sales, customers, employees] = await Promise.all([
        fetchAppointments(orgId, 120, 1),
        fetchSales(orgId, 120),
        fetchCustomers(orgId),
        fetchEmployees(orgId),
      ]);
      const services = await import("@/lib/vellora/queries").then((m) => m.fetchServices(orgId));

      /* Top servicios 30 días */
      const t = await topServices(orgId, services, 30, 8);
      setTop(t);

      /* Ingresos por profesional 30 días */
      const cutoff = Date.now() - 30 * 86_400_000;
      const paid30 = sales.filter((s) => s.status === "paid" && new Date(s.created_at).getTime() >= cutoff);
      const perEmp = new Map<string, number>();
      for (const s of paid30) {
        if (!s.employee_id) continue;
        perEmp.set(s.employee_id, (perEmp.get(s.employee_id) ?? 0) + s.total);
      }
      setByProfessional(
        employees
          .map((e) => ({ name: e.full_name.split(" ")[0], revenue: perEmp.get(e.id) ?? 0 }))
          .sort((a, b) => b.revenue - a.revenue)
      );

      /* Por método de pago 30 días */
      const perMethod = new Map<string, number>();
      for (const s of paid30) {
        const m = s.payment_method ?? "sin registrar";
        perMethod.set(m, (perMethod.get(m) ?? 0) + s.total);
      }
      setByPayment([...perMethod.entries()].map(([name, value]) => ({ name, value })));

      /* Serie mensual 3 meses */
      const months: { name: string; revenue: number }[] = [];
      for (let i = 2; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i, 1);
        const key = bogotaDayKey(d).slice(0, 7);
        const rev = sales
          .filter((s) => s.status === "paid" && bogotaDayKey(new Date(s.created_at)).slice(0, 7) === key)
          .reduce((a, s) => a + s.total, 0);
        months.push({ name: d.toLocaleDateString("es-CO", { month: "short" }), revenue: rev });
      }
      setMonthly(months);

      /* Resumen comparativo */
      const k30 = computeKpis(appointments, sales, customers, employees, "30d");
      setSummary([
        { label: "Ingresos 30 días", value: formatCOP(k30.revenue), delta: k30.revenueChange === null ? "—" : `${k30.revenueChange >= 0 ? "+" : "−"}${formatPct(Math.abs(k30.revenueChange), 1)}` },
        { label: "Citas completadas", value: formatNumber(k30.completedAppointments), delta: k30.completedChange === null ? "—" : `${k30.completedChange >= 0 ? "+" : "−"}${formatPct(Math.abs(k30.completedChange), 1)}` },
        { label: "Ticket promedio", value: formatCOP(k30.avgTicket), delta: k30.avgTicketChange === null ? "—" : `${k30.avgTicketChange >= 0 ? "+" : "−"}${formatPct(Math.abs(k30.avgTicketChange), 1)}` },
        { label: "Ocupación", value: formatPct(k30.occupancy ?? 0), delta: "capacidad del equipo" },
      ]);

      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar reportes");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    const rows = [
      ["Reporte VelloRa", ctx.organization.name],
      ["Generado", new Date().toISOString()],
      [],
      ["Servicio", "Ingresos 30d", "Unidades"],
      ...top.map((t) => [t.name, String(t.revenue), String(t.count)]),
      [],
      ["Profesional", "Ingresos 30d"],
      ...byProfessional.map((p) => [p.name, String(p.revenue)]),
      [],
      ["Método de pago", "Recaudo 30d"],
      ...byPayment.map((p) => [p.name, String(p.value)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-vellora-${bogotaDayKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Analítica"
        title="Reportes"
        subtitle={`Reportes según tu plan: resumen y top de servicios para todos; productividad por profesional y comparativo mensual desde Profesional; mezcla de pagos en Elite.`}
        actions={
          <>
            <span className="vr-pill vr-pill-gray" title="Plan vigente de la organización" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ShieldCheck size={13} /> Plan {planName}
            </span>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            <button
              className="vr-btn"
              onClick={exportCsv}
              disabled={!reports.csv}
              title={reports.csv ? "Descargar CSV" : `Disponible desde el ${UNLOCK_LABEL.csv}`}
            >
              <Download size={14} /> Exportar CSV
            </button>
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
        {summary.map((s) => (
          <div key={s.label} className="vr-metric-card">
            <div className="vr-metric-label">{s.label}</div>
            <div className="vr-metric-value" style={{ fontSize: 21 }}>{s.value}</div>
            <div className="vr-metric-note">{s.delta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 18, alignItems: "start" }}>
        {reports.porProfesional ? (
          <section className="vr-card">
            <h2>Ingresos por profesional · 30 días</h2>
            <ChartBox height={250}>
              {(w1) => (
              <BarChart width={w1} height={250} data={byProfessional} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeecf4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#5e5a70" }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip formatter={(v: number) => [formatCOP(v), "Ingresos"]} contentStyle={{ borderRadius: 12, border: "1px solid #ebe9f2", fontSize: 12 }} />
                  <Bar dataKey="revenue" fill="#7556d8" radius={[0, 6, 6, 0]} maxBarSize={18} />
              </BarChart>
              )}
            </ChartBox>
          </section>
        ) : (
          <LockedCard title="Ingresos por profesional · 30 días" planLabel={UNLOCK_LABEL.porProfesional} />
        )}

        {reports.pagos ? (
          <section className="vr-card">
            <h2>Métodos de pago · 30 días</h2>
            <ChartBox height={250}>
              {(w2) => (
              <BarChart width={w2} height={250} data={byPayment} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeecf4" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} width={46} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip formatter={(v: number) => [formatCOP(v), "Recaudo"]} contentStyle={{ borderRadius: 12, border: "1px solid #ebe9f2", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#239b72" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
              )}
            </ChartBox>
          </section>
        ) : (
          <LockedCard title="Métodos de pago · 30 días" planLabel={UNLOCK_LABEL.pagos} />
        )}
      </div>

      <section className="vr-card">
        <h2>Top servicios por ingresos · 30 días</h2>
        {loading ? (
          <EmptyState title="Calculando…" body=" " />
        ) : top.length === 0 ? (
          <EmptyState title="Sin datos" body="Aún no hay ventas de servicios en los últimos 30 días." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr><th>#</th><th>Servicio</th><th>Unidades</th><th>Ingresos</th><th>Participación</th></tr>
              </thead>
              <tbody>
                {top.map((t, i) => {
                  const total = top.reduce((a, x) => a + x.revenue, 0);
                  return (
                    <tr key={t.name}>
                      <td>{i + 1}</td>
                      <td><strong>{t.name}</strong></td>
                      <td>{t.count}</td>
                      <td><strong>{formatCOP(t.revenue)}</strong></td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="vr-progress vr-progress-ok" style={{ width: 90 }}><span style={{ width: `${Math.round((t.revenue / total) * 100)}%` }} /></div>
                          <span className="vr-muted" style={{ fontSize: 11 }}>{Math.round((t.revenue / total) * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reports.mensual ? (
        <section className="vr-card">
          <h2>Comparativo mensual de ingresos</h2>
          <ChartBox height={210}>
            {(w3) => (
            <BarChart width={w3} height={210} data={monthly} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeecf4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9a96a9" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`)} />
                <Tooltip formatter={(v: number) => [formatCOP(v), "Ingresos"]} contentStyle={{ borderRadius: 12, border: "1px solid #ebe9f2", fontSize: 12 }} />
                <Bar dataKey="revenue" fill="#3973ce" radius={[6, 6, 0, 0]} maxBarSize={46} />
            </BarChart>
            )}
          </ChartBox>
        </section>
      ) : (
        <LockedCard title="Comparativo mensual de ingresos" planLabel={UNLOCK_LABEL.mensual} />
      )}
    </div>
  );
}
