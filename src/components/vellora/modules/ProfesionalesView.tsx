"use client";

/* VelloRa ERP — Módulo Profesionales: equipo, comisiones y productividad.
   Crear profesional respeta el límite del plan (paso 4 y 9). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Plus } from "lucide-react";
import type { Appointment, Employee, OrganizationContext } from "@/lib/vellora/types";
import { fetchEmployees, fetchAppointments } from "@/lib/vellora/queries";
import { formatCOP, formatPct } from "@/lib/vellora/format";
import { can, planAllowsNewProfessional, resolvePlanLimits } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field, FormGrid, StatusPill } from "../ui-bits";

export default function ProfesionalesView({ ctx }: { ctx: OrganizationContext }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fName, setFName] = useState("");
  const [fTitle, setFTitle] = useState("Estilista");
  const [fSpecialty, setFSpecialty] = useState("");
  const [fCommission, setFCommission] = useState(35);
  const [fBranch, setFBranch] = useState("");

  const plan = ctx.subscription?.plan ?? null;
  const limits = resolvePlanLimits(plan);
  const activeCount = employees.filter((e) => e.active).length;
  const planBlocked = plan ? !planAllowsNewProfessional(limits, activeCount) : false;
  const canCreate = can(ctx.permissions, "profesionales", "can_create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        fetchEmployees(ctx.organizationId),
        fetchAppointments(ctx.organizationId, 30, 1),
      ]);
      setEmployees(e);
      setAppointments(a);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el equipo");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const done = appointments.filter((a) => a.status === "completed");
    const map = new Map<string, { count: number; revenue: number }>();
    for (const a of done) {
      const empKey = a.employee_id ?? "";
      const cur = map.get(empKey) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += a.price;
      map.set(empKey, cur);
    }
    return map;
  }, [appointments]);

  const maxRevenue = useMemo(() => Math.max(1, ...[...stats.values()].map((v) => v.revenue)), [stats]);

  async function createProfessional() {
    if (!fName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("employees").insert({
      organization_id: ctx.organizationId,
      branch_id: fBranch || ctx.branches[0]?.id || null,
      full_name: fName.trim(),
      position: fTitle,
      specialties: fSpecialty.trim() || null,
      email: null,
      phone: null,
      commission_percent: fCommission,
      active: true,
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible crear el profesional: ${insErr.message}`);
      return;
    }
    setShowNew(false);
    setFName(""); setFSpecialty("");
    setNotice("Profesional creado correctamente.");
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Profesionales"
        subtitle={
          planBlocked
            ? `Límite del plan ${plan?.name} alcanzado (${limits.max_professionals} profesionales). Mejora de plan para agregar más.`
            : `Equipo activo: ${activeCount}${limits.max_professionals > 0 ? ` de ${limits.max_professionals} incluidos en el plan` : ""}.`
        }
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => setShowNew(true)} disabled={planBlocked}>
                <Plus size={14} /> Nuevo profesional
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      {plan && limits.max_professionals > 0 && (
        <section className="vr-card">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>Uso del plan · profesionales</span>
            <span className="vr-muted">{activeCount} / {limits.max_professionals}</span>
          </div>
          <div className={`vr-progress ${activeCount / limits.max_professionals >= 0.8 ? (activeCount >= limits.max_professionals ? "vr-progress-danger" : "vr-progress-warn") : "vr-progress-ok"}`}>
            <span style={{ width: `${Math.min(100, (activeCount / limits.max_professionals) * 100)}%` }} />
          </div>
        </section>
      )}

      <section className="vr-card">
        {loading ? (
          <EmptyState title="Cargando equipo…" body=" " />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Cargo</th>
                  <th>Especialidad</th>
                  <th>Sede</th>
                  <th>Comisión</th>
                  <th>Citas 30d</th>
                  <th>Ingresos 30d</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const st = stats.get(e.id) ?? { count: 0, revenue: 0 };
                  return (
                    <tr key={e.id}>
                      <td><strong>{e.full_name}</strong></td>
                      <td>{e.position ?? "—"}</td>
                      <td>{e.specialties ?? "—"}</td>
                      <td>{ctx.branches.find((b) => b.id === e.branch_id)?.name ?? "—"}</td>
                      <td>{formatPct(e.commission_percent ?? 0)}</td>
                      <td>
                        {st.count}
                        <div className={`vr-progress ${st.revenue > 0 ? "vr-progress-ok" : ""}`} style={{ width: 70, marginTop: 4 }} aria-hidden>
                          <span style={{ width: `${Math.round((st.revenue / maxRevenue) * 100)}%` }} />
                        </div>
                      </td>
                      <td>{formatCOP(st.revenue, { compact: true })}</td>
                      <td><StatusPill status={e.active ? "activo" : "inactivo"} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={showNew} title="Nuevo profesional" onClose={() => setShowNew(false)}>
        <FormGrid>
          <Field label="Nombre completo">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ej. Sofía Torres" maxLength={80} />
          </Field>
          <Field label="Cargo">
            <select value={fTitle} onChange={(e) => setFTitle(e.target.value)}>
              {["Estilista", "Estilista sénior", "Barbero", "Manicurista", "Terapeuta spa", "Cosmetóloga"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Especialidad">
            <input value={fSpecialty} onChange={(e) => setFSpecialty(e.target.value)} placeholder="Ej. Color y balayage" />
          </Field>
          <Field label="Comisión (%)">
            <input type="number" min={0} max={80} value={fCommission} onChange={(e) => setFCommission(Number(e.target.value))} />
          </Field>
          <Field label="Sede">
            <select value={fBranch} onChange={(e) => setFBranch(e.target.value)}>
              <option value="">Automática</option>
              {ctx.branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createProfessional()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}
