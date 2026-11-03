"use client";

/* VelloRa ERP — Módulo Reservas online v2.
   · Resumen      : KPIs de la reserva online + próximas citas + solicitudes urgentes.
   · Solicitudes  : bandeja de reservas públicas (confirmar/reprogramar/rechazar/cancelar),
                    con detección de conflictos de agenda al asignar profesional.
   · Configuración: editor completo de booking_settings (enlace público, confirmación
                    automática, horario por día, antelación y política de cancelación).
   La BD real no tiene tabla online_bookings: las solicitudes públicas son
   appointments con source='online' y booking_code; la configuración vive en booking_settings
   (columnas v2 creadas por supabase/reservas_online_v2.sql). */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban, CalendarCheck, CalendarClock, CheckCircle2, Copy, ExternalLink, Globe, Inbox,
  Loader2, MessageCircle, Pencil, RefreshCw, Save, Search, Settings2, TrendingUp, XCircle,
} from "lucide-react";
import type {
  Appointment, BookingHours, BookingSettings, Customer, Employee, OrganizationContext, Service,
} from "@/lib/vellora/types";
import { fetchAppointments, fetchCustomers, fetchEmployees, fetchServices } from "@/lib/vellora/queries";
import { bogotaDayKey, formatCOP, formatDate, formatDateTime, formatTime, relativeDay } from "@/lib/vellora/format";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { DEFAULT_BUSINESS_HOURS, DAY_KEYS, DAY_LABELS, normalizeHours, waLink } from "@/lib/vellora/public-booking";
import { EmptyState, Field, FormGrid, MetricCard, Modal, PageHeader, SectionCard, StatusPill } from "../ui-bits";

type Tab = "resumen" | "solicitudes" | "config";
type Filter = "pendientes" | "proximas" | "historial" | "todas";
type EditTarget = { appt: Appointment; mode: "confirm" | "reschedule" };

const ACTIVE = new Set(["reserved", "scheduled", "confirmed"]);

function emptyCfg(): BookingSettings {
  return {
    id: "", organization_id: "", slug: "mi-salon", public_name: "",
    description: null, contact_phone: null, enabled: false,
    notice_hours: 2, horizon_days: 30, auto_confirm: false,
    slot_minutes: 30, cancellation_hours: 4,
    business_hours: normalizeHours(null),
  };
}

export default function ReservasOnlineView({ ctx }: { ctx: OrganizationContext }) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [bookings, setBookings] = useState<Appointment[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [cfg, setCfg] = useState<BookingSettings>(emptyCfg());
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("pendientes");
  const [search, setSearch] = useState("");

  /* Modal confirmar / reprogramar */
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editForm, setEditForm] = useState({ date: "", time: "", employeeId: "", branchId: "", notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  /* Modal rechazar */
  const [rejectTarget, setRejectTarget] = useState<Appointment | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [b, all, c, s, e, cfgRow] = await Promise.all([
        sb.from("appointments").select("*").eq("organization_id", ctx.organizationId).eq("source", "online").order("starts_at", { ascending: false }).limit(400),
        fetchAppointments(ctx.organizationId, 60, 40),
        fetchCustomers(ctx.organizationId),
        fetchServices(ctx.organizationId),
        fetchEmployees(ctx.organizationId),
        sb.from("booking_settings").select("*").eq("organization_id", ctx.organizationId).maybeSingle(),
      ]);
      if (b.error) throw new Error(b.error.message);
      setBookings(((b.data ?? []) as unknown) as Appointment[]);
      setAllAppointments(all);
      setCustomers(c);
      setServices(s);
      setEmployees(e);
      if (!cfgRow.error) {
        const row = (cfgRow.data as unknown) as BookingSettings | null;
        setSettings(row);
        if (row) setCfg({ ...row, business_hours: normalizeHours(row.business_hours) });
        else setCfg({ ...emptyCfg(), organization_id: ctx.organizationId, public_name: ctx.organization?.name ?? "", slug: "mi-salon" });
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar las reservas");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId, ctx.organization?.name]);

  useEffect(() => { void load(); }, [load]);

  /* ———————————————————————————— Derivados ——————————————————————————————— */
  const now = Date.now();
  const todayKey = bogotaDayKey(new Date());

  const customerOf = useCallback((id?: string | null) => customers.find((c) => c.id === id), [customers]);
  const serviceOf = useCallback((id?: string | null) => services.find((s) => s.id === id), [services]);
  const employeeOf = useCallback((id?: string | null) => employees.find((e) => e.id === id), [employees]);

  const active = useMemo(() => bookings.filter((b) => ACTIVE.has(b.status)), [bookings]);
  const pending = useMemo(() => bookings.filter((b) => b.status === "reserved").sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)), [bookings]);
  const todayBookings = useMemo(() => active.filter((b) => bogotaDayKey(new Date(b.starts_at)) === todayKey).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)), [active, todayKey]);
  const next7 = useMemo(() => active.filter((b) => +new Date(b.starts_at) >= now - 3600e3 && +new Date(b.starts_at) <= now + 7 * 86400e3).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)), [active, now]);

  const win30 = 30 * 86400e3;
  const last30 = useMemo(() => bookings.filter((b) => +new Date(b.starts_at) >= now - win30 && +new Date(b.starts_at) <= now + win30), [bookings, now]);
  const cancelRate30 = useMemo(() => {
    const past = bookings.filter((b) => +new Date(b.starts_at) >= now - win30 && +new Date(b.starts_at) <= now);
    if (past.length === 0) return null;
    return (past.filter((b) => b.status === "cancelled").length / past.length) * 100;
  }, [bookings, now]);
  const noShow30 = useMemo(() => bookings.filter((b) => b.status === "no_show" && +new Date(b.starts_at) >= now - win30).length, [bookings, now]);
  const programado = useMemo(() => active.filter((b) => +new Date(b.starts_at) >= now - 3600e3).reduce((acc, b) => acc + (b.price ?? 0), 0), [active, now]);
  const nuevasOnline30 = useMemo(() => {
    const first = new Map<string, number>();
    for (const b of bookings) {
      const t = +new Date(b.starts_at);
      if (!b.customer_id) continue;
      first.set(b.customer_id, Math.min(first.get(b.customer_id) ?? Infinity, t));
    }
    let n = 0;
    for (const t of first.values()) if (t >= now - win30) n++;
    return n;
  }, [bookings, now]);
  const confirmRate30 = useMemo(() => {
    const past = bookings.filter((b) => +new Date(b.starts_at) >= now - win30 && +new Date(b.starts_at) <= now);
    if (past.length === 0) return null;
    return (past.filter((b) => b.status !== "cancelled" && b.status !== "no_show").length / past.length) * 100;
  }, [bookings, now]);

  const topServices30 = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const b of last30) if (b.service_id) cnt.set(b.service_id, (cnt.get(b.service_id) ?? 0) + 1);
    return [...cnt.entries()]
      .map(([id, n]) => ({ name: serviceOf(id)?.name ?? "Servicio", n, price: serviceOf(id)?.price ?? 0 }))
      .sort((a, b) => b.n - a.n).slice(0, 5);
  }, [last30, serviceOf]);

  /* Filtro + búsqueda de la bandeja */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list: Appointment[];
    if (filter === "pendientes") list = bookings.filter((b) => b.status === "reserved");
    else if (filter === "proximas") list = active.filter((b) => +new Date(b.starts_at) >= now - 3600e3);
    else if (filter === "historial") list = bookings.filter((b) => !ACTIVE.has(b.status) || +new Date(b.starts_at) < now - 3600e3);
    else list = bookings;
    if (q) {
      list = list.filter((b) => {
        const c = customerOf(b.customer_id);
        return [b.booking_code, c?.full_name, c?.phone, serviceOf(b.service_id)?.name]
          .some((v) => (v ?? "").toLowerCase().includes(q));
      });
    }
    return list.sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at));
  }, [bookings, filter, search, customerOf, serviceOf, now]);

  /* Conflictos de agenda para el modal (contra TODAS las citas, no solo online) */
  const editConflict = useMemo(() => {
    if (!editTarget) return null;
    const dur = serviceOf(editTarget.appt.service_id)?.duration_minutes ?? 60;
    const start = new Date(`${editForm.date}T${editForm.time || "00:00"}:00-05:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + dur * 60000);
    const clash = allAppointments.find((a) => {
      if (a.id === editTarget.appt.id) return false;
      if (editForm.employeeId && a.employee_id !== editForm.employeeId) return false;
      if (a.status === "cancelled" || a.status === "no_show") return false;
      const s = new Date(a.starts_at);
      const e2 = a.ends_at ? new Date(a.ends_at) : new Date(s.getTime() + 60 * 60000);
      return s < end && e2 > start;
    });
    if (!clash) return null;
    const c = customerOf(clash.customer_id);
    return `${formatTime(clash.starts_at)} · ${serviceOf(clash.service_id)?.name ?? "cita"} de ${c?.full_name ?? "otra clienta"}`;
  }, [editTarget, editForm, allAppointments, serviceOf, customerOf]);

  /* ———————————————————————————— Acciones ————————————————————————————————— */
  function openEdit(t: EditTarget) {
    const d = new Date(t.appt.starts_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditForm({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      employeeId: t.appt.employee_id ?? "",
      branchId: t.appt.branch_id ?? "",
      notes: t.appt.notes ?? "",
    });
    setEditTarget(t);
  }

  async function saveEdit() {
    if (!editTarget) return;
    setSavingEdit(true);
    const dur = serviceOf(editTarget.appt.service_id)?.duration_minutes ?? 60;
    const starts = new Date(`${editForm.date}T${editForm.time}:00-05:00`);
    const sb = supabaseBrowser();
    const payload: Record<string, unknown> = {
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + dur * 60000).toISOString(),
      employee_id: editForm.employeeId || null,
      branch_id: editForm.branchId || null,
      updated_at: new Date().toISOString(),
    };
    if (editTarget.mode === "confirm") payload.status = "confirmed";
    const { error: upErr } = await sb.from("appointments").update(payload).eq("id", editTarget.appt.id);
    setSavingEdit(false);
    if (upErr) { setError(`No se pudo guardar: ${upErr.message}`); return; }
    const name = customerOf(editTarget.appt.customer_id)?.full_name ?? editTarget.appt.booking_code ?? "la reserva";
    setNotice(editTarget.mode === "confirm" ? `Reserva de ${name} confirmada y agendada.` : `Reserva de ${name} reprogramada.`);
    setEditTarget(null);
    await load();
  }

  async function reject() {
    if (!rejectTarget) return;
    const sb = supabaseBrowser();
    const stamp = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
    const { error: upErr } = await sb.from("appointments").update({
      status: "cancelled",
      notes: `${rejectTarget.notes ? `${rejectTarget.notes} · ` : ""}Rechazada (${stamp}): ${rejectReason.trim() || "sin motivo"}`,
      updated_at: new Date().toISOString(),
    }).eq("id", rejectTarget.id);
    if (upErr) { setError(`No se pudo rechazar: ${upErr.message}`); return; }
    const name = customerOf(rejectTarget.customer_id)?.full_name ?? rejectTarget.booking_code ?? "la reserva";
    setNotice(`Solicitud de ${name} rechazada.`);
    setRejectTarget(null);
    setRejectReason("");
    await load();
  }

  async function cancelUpcoming(a: Appointment) {
    const sb = supabaseBrowser();
    const { error: upErr } = await sb.from("appointments").update({
      status: "cancelled",
      notes: `${a.notes ? `${a.notes} · ` : ""}Cancelada por el salón`,
      updated_at: new Date().toISOString(),
    }).eq("id", a.id);
    if (upErr) { setError(`No se pudo cancelar: ${upErr.message}`); return; }
    setNotice("Reserva cancelada.");
    await load();
  }

  async function saveCfg() {
    setSavingCfg(true);
    const sb = supabaseBrowser();
    const clean: Record<string, unknown> = {
      slug: cfg.slug.trim().toLowerCase().replace(/\s+/g, "-"),
      public_name: cfg.public_name.trim() || ctx.organization?.name || "Mi salón",
      description: cfg.description ?? null,
      contact_phone: cfg.contact_phone ?? null,
      enabled: cfg.enabled,
      notice_hours: Math.max(0, Math.min(720, Number(cfg.notice_hours) || 0)),
      horizon_days: Math.max(1, Math.min(180, Number(cfg.horizon_days) || 30)),
      auto_confirm: cfg.auto_confirm,
      slot_minutes: Number(cfg.slot_minutes) || 30,
      cancellation_hours: Math.max(0, Math.min(72, Number(cfg.cancellation_hours) || 0)),
      business_hours: normalizeHours(cfg.business_hours),
      updated_at: new Date().toISOString(),
    };
    let err: { message: string } | null;
    if (settings?.id) {
      ({ error: err } = await sb.from("booking_settings").update(clean).eq("id", settings.id));
    } else {
      ({ error: err } = await sb.from("booking_settings").insert({ ...clean, organization_id: ctx.organizationId } as never));
    }
    setSavingCfg(false);
    if (err) { setError(`No se pudo guardar la configuración: ${err.message}`); return; }
    setNotice("Configuración de reservas guardada. La página pública se actualiza al instante.");
    await load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = `${origin}/r/${cfg.slug || "mi-salon"}`;
  const slugOK = /^[a-z0-9](-?[a-z0-9])*$/.test(cfg.slug.trim());

  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "resumen", label: "Resumen", icon: TrendingUp },
    { key: "solicitudes", label: `Solicitudes${pending.length ? ` (${pending.length})` : ""}`, icon: Inbox },
    { key: "config", label: "Configuración", icon: Settings2 },
  ];

  const waHref = (b: Appointment) => {
    const c = customerOf(b.customer_id);
    const text = `Hola ${c?.full_name?.split(" ")[0] ?? ""}, te escribimos de ${cfg.public_name || "Bella Esencia"} sobre tu reserva ${b.booking_code ?? ""} del ${formatDate(b.starts_at)} a las ${formatTime(b.starts_at)}.`;
    return waLink(c?.phone ?? c?.whatsapp, text);
  };

  /* ———————————————————————————— Render ——————————————————————————————————— */
  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Operación"
        title="Reservas online"
        subtitle="Portal público de reservas, solicitudes de clientas y configuración de la agenda en línea."
        actions={
          <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      {settings && !settings.enabled && (
        <div className="vr-alert vr-alert-warning">
          <span><strong>Las reservas en línea están desactivadas.</strong> Actívalas en la pestaña Configuración para que la página pública deje de recibir solicitudes.</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Secciones de reservas online">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={on}
              className={on ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
              onClick={() => setTab(t.key)}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ————————————————————————— RESUMEN ———————————————————————————————— */}
      {tab === "resumen" && (
        <>
          <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
            <MetricCard label="Solicitudes por confirmar" value={String(pending.length)} note={pending.some((b) => bogotaDayKey(new Date(b.starts_at)) <= todayKey) ? "⚠ hay reservas de hoy o pasadas sin confirmar" : "reservas esperando respuesta"} />
            <MetricCard label="Reservas de hoy" value={String(todayBookings.length)} note={`${todayBookings.length ? formatTime(todayBookings[0].starts_at) : "—"} la primera`} />
            <MetricCard label="Próximos 7 días" value={String(next7.length)} note="citas agendadas en línea" />
            <MetricCard label="Ingresos programados" value={formatCOP(programado, { compact: true })} note="por reservas activas futuras" />
            <MetricCard label="Tasa de confirmación" value={confirmRate30 === null ? "—" : `${confirmRate30.toFixed(0)}%`} note="solicitudes atendidas (30 días)" />
            <MetricCard label="Clientas nuevas online" value={String(nuevasOnline30)} note="primera reserva en 30 días" />
            <MetricCard label="Cancelaciones" value={cancelRate30 === null ? "—" : `${cancelRate30.toFixed(0)}%`} note="sobre reservas (30 días)" />
            <MetricCard label="No-show online" value={String(noShow30)} note="reservas sin asistir (30 días)" />
          </div>

          {pending.length > 0 && (
            <SectionCard title="Solicitudes urgentes" action={<button className="vr-btn-secondary vr-btn-sm" onClick={() => { setTab("solicitudes"); setFilter("pendientes"); }}>Ver todas</button>}>
              {pending.slice(0, 5).map((b) => {
                const c = customerOf(b.customer_id);
                const overdue = bogotaDayKey(new Date(b.starts_at)) <= todayKey;
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #f0edf8", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <strong style={{ fontSize: 13.5 }}>{c?.full_name ?? "Clienta"}</strong>
                      <span className="vr-muted" style={{ marginLeft: 8, fontSize: 12.5 }}>{serviceOf(b.service_id)?.name ?? "—"}</span>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: overdue ? "#b4550d" : "#5b5571" }}>
                      {relativeDay(b.starts_at)} · {formatTime(b.starts_at)}
                    </span>
                    {overdue && <span className="vr-pill" style={{ background: "#fdeee0", color: "#b4550d" }}>urgente</span>}
                    <button className="vr-btn vr-btn-sm" onClick={() => openEdit({ appt: b, mode: "confirm" })}>
                      <CheckCircle2 size={12} /> Confirmar
                    </button>
                  </div>
                );
              })}
            </SectionCard>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
            <SectionCard title="Próximas reservas">
              {next7.length === 0 ? (
                <EmptyState title="Nada agendado" body="Cuando confirmes solicitudes aparecerán aquí." />
              ) : next7.slice(0, 6).map((b) => {
                const c = customerOf(b.customer_id);
                const wa = waHref(b);
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f0edf8", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <strong style={{ fontSize: 13.5 }}>{c?.full_name ?? "—"}</strong>
                      <div className="vr-muted" style={{ fontSize: 12 }}>{serviceOf(b.service_id)?.name} · {employeeOf(b.employee_id)?.full_name ?? "sin profesional"}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700 }}>{relativeDay(b.starts_at)}</div>
                      <div className="vr-muted">{formatTime(b.starts_at)} · {b.booking_code}</div>
                    </div>
                    {wa && <a className="vr-icon-btn" href={wa} target="_blank" rel="noreferrer" title="Escribir por WhatsApp"><MessageCircle size={14} /></a>}
                  </div>
                );
              })}
            </SectionCard>

            <SectionCard title="Servicios más reservados (30 días)">
              {topServices30.length === 0 ? (
                <EmptyState title="Sin datos todavía" body="Aparecerá cuando lleguen reservas en línea." />
              ) : topServices30.map((s, i) => (
                <div key={s.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f0edf8" }}>
                  <span className="vr-pill vr-pill-gray">{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13 }}>{s.name}</strong>
                    <div className="vr-muted" style={{ fontSize: 12 }}>{formatCOP(s.price)}</div>
                  </div>
                  <strong style={{ fontSize: 14, color: "#5b3fb8" }}>{s.n}</strong>
                </div>
              ))}
            </SectionCard>
          </div>

          {settings && (
            <div className="vr-alert vr-alert-info">
              <Globe size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Página pública <strong>{settings.public_name}</strong> · {settings.enabled ? "activada" : "desactivada"} ·{" "}
                {settings.auto_confirm ? "confirmación automática" : "confirmación manual"} · antelación mínima {settings.notice_hours} h · horizonte {settings.horizon_days} días
              </span>
            </div>
          )}
        </>
      )}

      {/* ——————————————————————— SOLICITUDES ————————————————————————————— */}
      {tab === "solicitudes" && (
        <section className="vr-card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            {([
              ["pendientes", `Pendientes (${bookings.filter((b) => b.status === "reserved").length})`],
              ["proximas", "Próximas"],
              ["historial", "Historial"],
              ["todas", "Todas"],
            ] as [Filter, string][]).map(([k, label]) => (
              <button key={k} className={filter === k ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
            <div style={{ flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 7, background: "#f6f4fb", borderRadius: 10, padding: "7px 11px" }}>
              <Search size={14} style={{ color: "#8d84a8" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por clienta, código o servicio…"
                style={{ border: 0, outline: "none", background: "transparent", fontSize: 13, width: "100%", color: "inherit" }} />
            </div>
          </div>

          {loading ? (
            <EmptyState title="Cargando reservas…" body=" " />
          ) : filtered.length === 0 ? (
            <EmptyState title="Sin solicitudes" body="Aún no llegan reservas desde la página pública." />
          ) : (
            <div className="vr-table-wrap">
              <table className="vr-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Clienta</th>
                    <th>Servicio</th>
                    <th>Fecha solicitada</th>
                    <th>Profesional</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const c = customerOf(b.customer_id);
                    const wa = waHref(b);
                    const canAct = b.status === "reserved" || b.status === "scheduled" || b.status === "confirmed";
                    const overdue = b.status === "reserved" && bogotaDayKey(new Date(b.starts_at)) <= todayKey;
                    return (
                      <tr key={b.id}>
                        <td className="vr-muted">{b.booking_code ?? "—"}</td>
                        <td>
                          <strong>{c?.full_name ?? "—"}</strong>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8d84a8" }}>
                            {c?.phone ?? "—"}
                            {wa && (
                              <a className="vr-icon-btn" href={wa} target="_blank" rel="noreferrer" title="Escribir por WhatsApp" style={{ width: 22, height: 22 }}>
                                <MessageCircle size={12} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          {serviceOf(b.service_id)?.name ?? "—"}
                          <div className="vr-muted" style={{ fontSize: 12 }}>{formatCOP(b.price ?? 0)}</div>
                        </td>
                        <td>
                          {formatDateTime(b.starts_at)}
                          {overdue && <div style={{ fontSize: 11, fontWeight: 800, color: "#b4550d" }}>⚠ vencida</div>}
                        </td>
                        <td>{employeeOf(b.employee_id)?.full_name ?? <span className="vr-muted">sin asignar</span>}</td>
                        <td><StatusPill status={b.status} /></td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {b.status === "reserved" && (
                              <button className="vr-btn vr-btn-sm" onClick={() => openEdit({ appt: b, mode: "confirm" })}>
                                <CheckCircle2 size={12} /> Confirmar
                              </button>
                            )}
                            {(b.status === "scheduled" || b.status === "confirmed") && (
                              <>
                                <button className="vr-btn-secondary vr-btn-sm" onClick={() => openEdit({ appt: b, mode: "reschedule" })}>
                                  <Pencil size={12} /> Reprogramar
                                </button>
                                <button className="vr-btn-danger vr-btn-sm" onClick={() => void cancelUpcoming(b)}>
                                  <Ban size={12} /> Cancelar
                                </button>
                              </>
                            )}
                            {b.status === "reserved" && (
                              <button className="vr-btn-danger vr-btn-sm" onClick={() => { setRejectTarget(b); setRejectReason(""); }}>
                                <XCircle size={12} /> Rechazar
                              </button>
                            )}
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
      )}

      {/* ——————————————————————— CONFIGURACIÓN ——————————————————————————— */}
      {tab === "config" && (
        <>
          <SectionCard title="Enlace de la página pública" action={
            <div style={{ display: "flex", gap: 6 }}>
              <button className="vr-btn-secondary vr-btn-sm" onClick={() => { void navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
                <Copy size={12} /> {copied ? "¡Copiado!" : "Copiar enlace"}
              </button>
              <a className="vr-btn vr-btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Abrir
              </a>
            </div>
          }>
            <div className="vr-alert vr-alert-info" style={{ marginBottom: 12 }}>
              <Globe size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Comparte este enlace en Instagram, WhatsApp o Google: <code>{publicUrl}</code></span>
            </div>
            <FormGrid>
              <Field label="Dirección (slug)">
                <input value={cfg.slug} onChange={(e) => setCfg({ ...cfg, slug: e.target.value.toLowerCase() })} placeholder="mi-salon" />
              </Field>
              <Field label="Estado de las reservas">
                <select value={cfg.enabled ? "1" : "0"} onChange={(e) => setCfg({ ...cfg, enabled: e.target.value === "1" })}>
                  <option value="1">Activadas — recibiendo solicitudes</option>
                  <option value="0">Desactivadas — página cerrada</option>
                </select>
              </Field>
            </FormGrid>
            {!slugOK && <div className="vr-alert vr-alert-warning"><span>Usa solo letras minúsculas, números y guiones (ej. bella-esencia).</span></div>}
          </SectionCard>

          <SectionCard title="Información que ve la clienta">
            <FormGrid>
              <Field label="Nombre público">
                <input value={cfg.public_name} onChange={(e) => setCfg({ ...cfg, public_name: e.target.value })} placeholder="Bella Esencia Spa & Salón" />
              </Field>
              <Field label="Teléfono de contacto">
                <input value={cfg.contact_phone ?? ""} onChange={(e) => setCfg({ ...cfg, contact_phone: e.target.value })} placeholder="+57 601 555 0100" />
              </Field>
            </FormGrid>
            <Field label="Descripción corta">
              <textarea rows={2} value={cfg.description ?? ""} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} placeholder="Agenda tu cita de cabello, uñas o spa en línea" />
            </Field>
          </SectionCard>

          <SectionCard title="Reglas de la agenda">
            <FormGrid>
              <Field label="Antelación mínima (horas)">
                <input type="number" min={0} max={720} value={cfg.notice_hours} onChange={(e) => setCfg({ ...cfg, notice_hours: Number(e.target.value) })} />
              </Field>
              <Field label="Horizonte de reservas (días)">
                <input type="number" min={1} max={180} value={cfg.horizon_days} onChange={(e) => setCfg({ ...cfg, horizon_days: Number(e.target.value) })} />
              </Field>
              <Field label="Duración de cada bloque">
                <select value={String(cfg.slot_minutes)} onChange={(e) => setCfg({ ...cfg, slot_minutes: Number(e.target.value) })}>
                  {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
                </select>
              </Field>
              <Field label="Confirmación">
                <select value={cfg.auto_confirm ? "1" : "0"} onChange={(e) => setCfg({ ...cfg, auto_confirm: e.target.value === "1" })}>
                  <option value="0">Manual — el salón confirma cada solicitud</option>
                  <option value="1">Automática — la reserva queda confirmada al instante</option>
                </select>
              </Field>
              <Field label="Cancelación en línea hasta (horas antes)">
                <input type="number" min={0} max={72} value={cfg.cancellation_hours} onChange={(e) => setCfg({ ...cfg, cancellation_hours: Number(e.target.value) })} />
              </Field>
            </FormGrid>
          </SectionCard>

          <SectionCard title="Horario de atención (hora de Bogotá)">
            <div className="vr-stack" style={{ gap: 8 }}>
              {DAY_KEYS.map((k) => {
                const h: BookingHours = (cfg.business_hours as Record<string, BookingHours>)[k] ?? { open: "09:00", close: "19:00", closed: false };
                return (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 130px", gap: 10, alignItems: "center" }}>
                    <strong style={{ fontSize: 13 }}>{DAY_LABELS[k]}</strong>
                    <input type="time" value={h.open} disabled={h.closed} onChange={(e) => setCfg({ ...cfg, business_hours: { ...normalizeHours(cfg.business_hours), [k]: { ...h, open: e.target.value } } })} />
                    <input type="time" value={h.close} disabled={h.closed} onChange={(e) => setCfg({ ...cfg, business_hours: { ...normalizeHours(cfg.business_hours), [k]: { ...h, close: e.target.value } } })} />
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                      <input type="checkbox" checked={h.closed} onChange={(e) => setCfg({ ...cfg, business_hours: { ...normalizeHours(cfg.business_hours), [k]: { ...h, closed: e.target.checked } } })} />
                      Cerrado
                    </label>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="vr-btn" onClick={() => void saveCfg()} disabled={savingCfg || !slugOK}>
              {savingCfg ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar configuración
            </button>
          </div>
        </>
      )}

      {/* —————————————— MODAL confirmar / reprogramar ———————————————— */}
      <Modal open={!!editTarget} title={editTarget?.mode === "confirm" ? "Confirmar reserva" : "Reprogramar reserva"} onClose={() => setEditTarget(null)} width={520}>
        {editTarget && (
          <>
            <div className="vr-alert vr-alert-info" style={{ marginBottom: 14 }}>
              <CalendarCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>{customerOf(editTarget.appt.customer_id)?.full_name ?? "Clienta"}</strong> · {serviceOf(editTarget.appt.service_id)?.name ?? "Servicio"} ({serviceOf(editTarget.appt.service_id)?.duration_minutes ?? 60} min) · código {editTarget.appt.booking_code}
                <br />Solicitó: {formatDateTime(editTarget.appt.starts_at)}
              </span>
            </div>
            <FormGrid>
              <Field label="Fecha"><input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} /></Field>
              <Field label="Hora (Bogotá)"><input type="time" value={editForm.time} onChange={(e) => setEditForm({ ...editForm, time: e.target.value })} /></Field>
              <Field label="Profesional">
                <select value={editForm.employeeId} onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })}>
                  <option value="">— Sin asignar —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </Field>
              <Field label="Sede">
                <select value={editForm.branchId} onChange={(e) => setEditForm({ ...editForm, branchId: e.target.value })}>
                  <option value="">— Sin sede —</option>
                  {ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </FormGrid>
            <Field label="Notas internas">
              <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Preferencias, indicaciones…" />
            </Field>
            {editConflict && (
              <div className="vr-alert vr-alert-warning" style={{ marginTop: 10 }}>
                <CalendarClock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>Conflicto de agenda:</strong> el profesional ya tiene {editConflict}. Elige otra hora u otro profesional.</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="vr-btn-secondary" onClick={() => setEditTarget(null)}>Cancelar</button>
              <button className="vr-btn" onClick={() => void saveEdit()} disabled={savingEdit || !editForm.date || !editForm.time || !!editConflict}>
                {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {editTarget.mode === "confirm" ? "Confirmar y agendar" : "Guardar nueva hora"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* —————————————— MODAL rechazar ———————————————— */}
      <Modal open={!!rejectTarget} title="Rechazar solicitud" onClose={() => setRejectTarget(null)} width={440}>
        {rejectTarget && (
          <>
            <p style={{ fontSize: 13.5, marginTop: 0 }}>
              Se rechazará la reserva <strong>{rejectTarget.booking_code}</strong> de{" "}
              <strong>{customerOf(rejectTarget.customer_id)?.full_name ?? "la clienta"}</strong> del {formatDate(rejectTarget.starts_at)}. La clienta quedará como cancelada.
            </p>
            <Field label="Motivo (opcional)">
              <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Ej. sin disponibilidad a esa hora" />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="vr-btn-secondary" onClick={() => setRejectTarget(null)}>Volver</button>
              <button className="vr-btn-danger" onClick={() => void reject()}><XCircle size={14} /> Rechazar solicitud</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
