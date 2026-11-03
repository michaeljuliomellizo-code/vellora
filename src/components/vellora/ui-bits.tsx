"use client";

/* VelloRa ERP — Piezas de UI compartidas por los módulos. */

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Contenedor de gráficos que mide su ancho real con un listener de resize de
 *  ventana (sin ResizeObserver, que puede entrar en bucle con recharts).
 *  Los hijos reciben el ancho medido en píxeles. */
export function ChartBox({
  height,
  children,
}: { height: number; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.clientWidth || 640)));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {children(width)}
    </div>
  );
}

export function PageHeader({
  eyebrow, title, subtitle, actions,
}: { eyebrow: string; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="vr-page-heading">
      <div>
        <div className="vr-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    /* Citas (CHECK real en inglés) */
    completed: "vr-pill-green", confirmed: "vr-pill-green",
    reserved: "vr-pill-amber", scheduled: "vr-pill-amber", arrived: "vr-pill-blue",
    in_service: "vr-pill-blue", cancelled: "vr-pill-red", no_show: "vr-pill-red",
    /* Ventas */
    paid: "vr-pill-green", open: "vr-pill-amber", void: "vr-pill-red",
    /* Compras */
    received: "vr-pill-green", draft: "vr-pill-gray",
    /* Nómina */
    approved: "vr-pill-blue",
    /* Marketing */
    active: "vr-pill-green", paused: "vr-pill-amber",
    /* Genéricos */
    activo: "vr-pill-green", Activo: "vr-pill-green", inactivo: "vr-pill-gray",
    active_es: "vr-pill-green",
  };
  const labels: Record<string, string> = {
    reserved: "por confirmar", scheduled: "agendada", confirmed: "confirmada",
    arrived: "llegó", in_service: "en servicio", completed: "completada",
    cancelled: "cancelada", no_show: "no asistió",
    paid: "pagada", open: "abierta", void: "anulada",
    received: "recibida", draft: "borrador", approved: "aprobada",
    active: "activa", paused: "pausada",
  };
  return <span className={`vr-pill ${map[status] ?? ""}`}>{labels[status] ?? status.replace("_", " ")}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="vr-empty">
      <strong>{title}</strong>
      {body}
    </div>
  );
}

export function Modal({
  open, title, onClose, children, width,
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center",
        background: "#1f163566", padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vr-card"
        style={{ width: width ?? 480, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(31,22,53,.3)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="vr-icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
      {label}
      {children}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 13, marginBottom: 16 }}>
      {children}
    </div>
  );
}

export function MetricCard({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="vr-metric-card">
      <div className="vr-metric-label">{label}</div>
      <div className="vr-metric-value">{value}</div>
      {note && <div className="vr-metric-note">{note}</div>}
      {tone && <div className={`vr-progress ${tone}`} style={{ marginTop: 10 }} aria-hidden><span style={{ width: "55%" }} /></div>}
    </div>
  );
}

export function SectionCard({ children, title, action }: { children: ReactNode; title?: string; action?: ReactNode }) {
  return (
    <section className="vr-card">
      {(title || action) && (
        <div className="vr-section-head">
          <h2 style={{ marginBottom: 0 }}>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
