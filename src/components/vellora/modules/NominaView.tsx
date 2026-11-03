"use client";

/* VelloRa ERP — Módulo Nómina: parametrización del esquema de pago por empleado
   (básico, porcentaje o mixto) y corridos de nómina (payroll_runs/payroll_items)
   generados al cerrar cada periodo de trabajo desde la Caja. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, DollarSign, ChevronDown, ChevronRight, Save, SlidersHorizontal } from "lucide-react";
import type { Employee, OrganizationContext, PayrollItem, PayrollRun } from "@/lib/vellora/types";
import { fetchEmployees } from "@/lib/vellora/queries";
import { formatCOP } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, StatusPill, EmptyState } from "../ui-bits";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const SALARY_TYPES: { key: string; label: string }[] = [
  { key: "basico", label: "Básico fijo" },
  { key: "porcentaje", label: "Por porcentaje" },
  { key: "mixto", label: "Básico + porcentaje" },
];

function periodLabel(run: PayrollRun): string {
  const s = new Date(`${run.period_start}T12:00:00`);
  const e = new Date(`${run.period_end}T12:00:00`);
  const sameMonth = s.getMonth() === e.getMonth();
  return sameMonth
    ? `${MESES[s.getMonth()]} ${s.getFullYear()}`
    : `${MESES[s.getMonth()]}–${MESES[e.getMonth()]} ${e.getFullYear()}`;
}

type PayConfig = { tipo: string; base: string; pct: string };

export default function NominaView({ ctx }: { ctx: OrganizationContext }) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payConfig, setPayConfig] = useState<Record<string, PayConfig>>({});
  const [savingEmp, setSavingEmp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const canUpdate = can(ctx.permissions, "nomina", "can_update");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [runRes, emp] = await Promise.all([
        sb.from("payroll_runs").select("*").eq("organization_id", ctx.organizationId).order("period_start", { ascending: false }),
        fetchEmployees(ctx.organizationId),
      ]);
      if (runRes.error) throw new Error(runRes.error.message);
      const runRows = ((runRes.data ?? []) as unknown) as PayrollRun[];
      setRuns(runRows);
      setEmployees(emp);
      setPayConfig(
        Object.fromEntries(
          emp.map((e) => [
            e.id,
            {
              tipo: (e.salary_type as string) ?? "basico",
              base: String(e.salary ?? 0),
              pct: String(e.commission_percent ?? 0),
            },
          ])
        )
      );

      if (runRows.length > 0) {
        const { data: it, error: itErr } = await sb.from("payroll_items").select("*").in("run_id", runRows.map((r) => r.id));
        if (itErr) throw new Error(itErr.message);
        const raw = ((it ?? []) as unknown) as PayrollItem[];
        setItems(raw.map((i) => ({ ...i, employee_name: emp.find((e) => e.id === i.employee_id)?.full_name ?? "—", period_label: periodLabel(runRows.find((r) => r.id === i.run_id)!) })));
      } else {
        setItems([]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar nómina");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingRuns = useMemo(() => runs.filter((r) => r.status !== "paid"), [runs]);
  const totalPorPagar = useMemo(
    () => items.filter((i) => pendingRuns.some((r) => r.id === i.run_id)).reduce((a, i) => a + i.total, 0),
    [items, pendingRuns]
  );
  const totalPagado = useMemo(
    () => items.filter((i) => !pendingRuns.some((r) => r.id === i.run_id)).reduce((a, i) => a + i.total, 0),
    [items, pendingRuns]
  );

  async function savePayConfig(emp: Employee) {
    const cfg = payConfig[emp.id];
    if (!cfg) return;
    setSavingEmp(emp.id);
    setError("");
    const sb = supabaseBrowser();
    const { error: upErr } = await sb
      .from("employees")
      .update({
        salary_type: cfg.tipo,
        salary: Math.max(0, Number(cfg.base) || 0),
        commission_percent: Math.max(0, Number(cfg.pct) || 0),
      })
      .eq("id", emp.id);
    setSavingEmp(null);
    if (upErr) {
      setError(`No se pudo guardar el esquema de ${emp.full_name}: ${upErr.message}`);
      return;
    }
    setNotice(`Esquema de pago de ${emp.full_name} actualizado.`);
    await load();
  }

  async function payRun(run: PayrollRun) {
    setPaying(true);
    setError("");
    const sb = supabaseBrowser();
    const now = new Date().toISOString();
    const { error: runErr } = await sb.from("payroll_runs").update({ status: "paid", updated_at: now }).eq("id", run.id);
    if (runErr) {
      setError(`No se pudo marcar el periodo: ${runErr.message}`);
      setPaying(false);
      return;
    }
    const runItems = items.filter((i) => i.run_id === run.id && !i.paid);
    for (const it of runItems) {
      await sb.from("payroll_items").update({ paid: true, paid_at: now, updated_at: now }).eq("id", it.id);
    }
    setPaying(false);
    setNotice(`Nómina de ${periodLabel(run)} marcada como pagada (${runItems.length} desprendibles).`);
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Nómina"
        subtitle="Esquema de pago por profesional (básico, porcentaje o mixto) y liquidaciones por periodo de trabajo."
        actions={
          <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Por pagar</div>
          <div className="vr-metric-value" style={{ color: totalPorPagar ? "#c67a26" : undefined }}>
            {formatCOP(totalPorPagar, { compact: true })}
          </div>
          <div className="vr-metric-note">{pendingRuns.length} periodo(s) pendiente(s)</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Pagado</div>
          <div className="vr-metric-value">{formatCOP(totalPagado, { compact: true })}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Profesionales</div>
          <div className="vr-metric-value">{employees.filter((e) => e.active).length}</div>
        </div>
      </div>

      {/* ————— Esquema de pago parametrizable ————— */}
      <section className="vr-card">
        <h2><SlidersHorizontal size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Esquema de pago por profesional</h2>
        <p className="vr-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Define para cada profesional si se liquida con básico fijo, por porcentaje de sus servicios vendidos, o ambos.
          El básico se interpreta <strong>por periodo</strong> (el que parametrices en Caja: semanal, quincenal o mensual).
          La comisión se calcula sobre las ventas de servicios pagadas dentro del periodo.
        </p>
        {loading ? (
          <EmptyState title="Cargando profesionales…" body=" " />
        ) : employees.length === 0 ? (
          <EmptyState title="Sin profesionales" body="Crea profesionales en el módulo Profesionales." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Esquema</th>
                  <th>Básico por periodo</th>
                  <th>% Comisión</th>
                  {canUpdate && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const cfg = payConfig[e.id] ?? { tipo: "basico", base: "0", pct: "0" };
                  return (
                    <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                      <td>
                        <strong>{e.full_name}</strong>
                        {!e.active && <span className="vr-muted"> (inactivo)</span>}
                      </td>
                      <td>
                        <select
                          value={cfg.tipo}
                          onChange={(ev) => setPayConfig((c) => ({ ...c, [e.id]: { ...cfg, tipo: ev.target.value } }))}
                          disabled={!canUpdate}
                          style={{ maxWidth: 190 }}
                        >
                          {SALARY_TYPES.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={cfg.base}
                          onChange={(ev) => setPayConfig((c) => ({ ...c, [e.id]: { ...cfg, base: ev.target.value } }))}
                          disabled={!canUpdate || cfg.tipo === "porcentaje"}
                          style={{ maxWidth: 130 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={cfg.pct}
                          onChange={(ev) => setPayConfig((c) => ({ ...c, [e.id]: { ...cfg, pct: ev.target.value } }))}
                          disabled={!canUpdate || cfg.tipo === "basico"}
                          style={{ maxWidth: 90 }}
                        />
                      </td>
                      {canUpdate && (
                        <td>
                          <button className="vr-btn vr-btn-sm" onClick={() => void savePayConfig(e)} disabled={savingEmp === e.id}>
                            {savingEmp === e.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Liquidaciones por periodo ————— */}
      {loading ? (
        <EmptyState title="Cargando nómina…" body=" " />
      ) : runs.length === 0 ? (
        <EmptyState
          title="Sin liquidaciones"
          body="Cierra un periodo de trabajo en el módulo Caja (botón «Cerrar periodo y liquidar nómina») para generar la nómina aquí."
        />
      ) : (
        <div className="vr-stack" style={{ gap: 14 }}>
          {runs.map((run) => {
            const runItems = items.filter((i) => i.run_id === run.id);
            const total = runItems.reduce((a, i) => a + i.total, 0);
            const open = expanded === run.id;
            return (
              <section key={run.id} className="vr-card" style={{ padding: 0 }}>
                {/* Encabezado clicable: div con role="button" (un <button> no puede contener otro <button>) */}
                <div
                  role="button"
                  tabIndex={0}
                  style={{ width: "100%", background: "transparent", border: 0, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}
                  onClick={() => setExpanded(open ? null : run.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpanded(open ? null : run.id);
                    }
                  }}
                  aria-expanded={open}
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ font: "800 15px Manrope,sans-serif" }}>
                      Nómina {periodLabel(run)} <span className="vr-muted" style={{ fontSize: 11.5 }}>({run.period_start} → {run.period_end})</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8d899e" }}>
                      {runItems.length} desprendibles · {formatCOP(total, { compact: true })}
                    </div>
                  </div>
                  <StatusPill status={run.status} />
                  {run.status !== "paid" && canUpdate && (
                    <button
                      className="vr-btn vr-btn-sm"
                      onClick={(e) => { e.stopPropagation(); void payRun(run); }}
                      disabled={paying}
                    >
                      <DollarSign size={12} /> Pagar
                    </button>
                  )}
                </div>

                {open && (
                  <div className="vr-table-wrap" style={{ padding: "0 18px 16px" }}>
                    <table className="vr-table">
                      <thead>
                        <tr>
                          <th>Profesional</th>
                          <th>Salario base</th>
                          <th>Comisiones</th>
                          <th>Bonos</th>
                          <th>Deducciones</th>
                          <th>Total</th>
                          <th>Pagado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runItems.map((e) => (
                          <tr key={e.id}>
                            <td><strong>{e.employee_name ?? "—"}</strong></td>
                            <td>{formatCOP(e.base_salary)}</td>
                            <td>{formatCOP(e.commission)}</td>
                            <td>{formatCOP(e.bonus)}</td>
                            <td style={{ color: "#ca435c" }}>−{formatCOP(e.deductions)}</td>
                            <td><strong>{formatCOP(e.total)}</strong></td>
                            <td>
                              {e.paid ? (
                                <span className="vr-pill vr-pill-green">Pagado</span>
                              ) : (
                                <span className="vr-pill vr-pill-amber">Pendiente</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
