"use client";

/* VelloRa ERP — Módulo Ventas: historial de facturación con filtro y totales. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { OrganizationContext, ServiceOrder } from "@/lib/vellora/types";
import { fetchSales } from "@/lib/vellora/queries";
import { formatCOP, formatDateTime, bogotaDayKey } from "@/lib/vellora/format";
import { PageHeader, StatusPill, EmptyState } from "../ui-bits";

export default function VentasView({ ctx }: { ctx: OrganizationContext }) {
  const [sales, setSales] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todas");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSales(await fetchSales(ctx.organizationId, 45));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar ventas");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      sales.filter(
        (s) =>
          (kindFilter === "todas" || s.kind === kindFilter) &&
          (statusFilter === "todas" || s.status === statusFilter)
      ),
    [sales, kindFilter, statusFilter]
  );

  const todayKey = bogotaDayKey(new Date());
  const todayTotal = sales
    .filter((s) => bogotaDayKey(new Date(s.created_at)) === todayKey && s.status === "paid")
    .reduce((a, s) => a + s.total, 0);
  const monthTotal = sales
    .filter((s) => s.status === "paid" && bogotaDayKey(new Date(s.created_at)).slice(0, 7) === todayKey.slice(0, 7))
    .reduce((a, s) => a + s.total, 0);

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Ventas"
        subtitle="Facturación de servicios, productos y ventas mixtas."
        actions={
          <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Cobrado hoy</div>
          <div className="vr-metric-value">{formatCOP(todayTotal)}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Cobrado este mes</div>
          <div className="vr-metric-value">{formatCOP(monthTotal, { compact: true })}</div>
        </div>
      </div>

      <section className="vr-card">
        <div className="vr-form" style={{ marginBottom: 14 }}>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="todas">Todos los tipos</option>
            <option value="servicio">Servicio</option>
            <option value="producto">Producto</option>
            <option value="mixto">Mixto</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="todas">Todos los estados</option>
            <option value="paid">Pagada</option>
            <option value="open">Abierta</option>
            <option value="void">Anulada</option>
          </select>
          <span className="vr-muted" style={{ fontSize: 12 }}>{filtered.length} ventas</span>
        </div>

        {loading ? (
          <EmptyState title="Cargando ventas…" body=" " />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin ventas" body="No hay ventas con los filtros seleccionados." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Método</th>
                  <th>Descuento</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 60).map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td style={{ textTransform: "capitalize" }}>{s.kind}</td>
                    <td style={{ textTransform: "capitalize" }}>{s.payment_method ?? "por definir"}</td>
                    <td>{s.discount > 0 ? formatCOP(s.discount) : "—"}</td>
                    <td><strong>{formatCOP(s.total)}</strong></td>
                    <td><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
