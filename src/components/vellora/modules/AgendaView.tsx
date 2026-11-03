"use client";

/* VelloRa ERP — Módulo Agenda: calendario del día, estados y creación de citas.
   El perfil Profesional ve únicamente sus propias citas (filtro en el servidor).
   Las citas completadas se envían a la caja: genera la venta (service_orders
   status=open + service_order_items) para que el cajero la cobre. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, CheckCircle2, XCircle, CalendarDays, Banknote, ShoppingBag } from "lucide-react";
import type { Appointment, Customer, Employee, OrganizationContext, Service, ServiceOrder } from "@/lib/vellora/types";
import { fetchAppointments, fetchCustomers, fetchEmployees, fetchSales, fetchServices } from "@/lib/vellora/queries";
import { formatCOP, formatTime, bogotaDayKey, relativeDay } from "@/lib/vellora/format";
import { can, planAllowsNewAppointment, resolvePlanLimits } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, StatusPill, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

type Props = { ctx: OrganizationContext };

const STATUS_LABELS: Record<string, string> = {
  reserved: "Por confirmar",
  scheduled: "Agendada",
  confirmed: "Confirmada",
  arrived: "Llegó",
  in_service: "En servicio",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

export default function AgendaView({ ctx }: Props) {
  const roleKey = (ctx.role?.role_key ?? "") as string;
  const isProfesional = roleKey === "profesional";
  const employeeIdSelf = useMemo(() => {
    /* El profesional coincide con un empleado por nombre */
    return null;
  }, []);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [billingId, setBillingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dayFilter, setDayFilter] = useState<string>(bogotaDayKey(new Date()));
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  /* Formulario nueva cita */
  const [fCustomer, setFCustomer] = useState("");
  const [fEmployee, setFEmployee] = useState("");
  const [fService, setFService] = useState("");
  const [fDate, setFDate] = useState(bogotaDayKey(new Date()));
  const [fTime, setFTime] = useState("10:00");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, c, e, s, v] = await Promise.all([
        fetchAppointments(ctx.organizationId, 30, 14),
        fetchCustomers(ctx.organizationId),
        fetchEmployees(ctx.organizationId),
        fetchServices(ctx.organizationId),
        fetchSales(ctx.organizationId, 30),
      ]);
      setAppointments(a);
      setCustomers(c);
      setEmployees(e);
      setServices(s);
      setOrders(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar la agenda");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Vista profesional: filtra por su empleado asociado */
  const selfEmployee = useMemo(
    () => (isProfesional ? employees.find((e) => e.full_name === ctx.user.full_name) ?? null : null),
    [isProfesional, employees, ctx.user.full_name]
  );

  const visible = useMemo(() => {
    let list = appointments;
    if (selfEmployee) list = list.filter((a) => a.employee_id === selfEmployee.id);
    if (dayFilter !== "todas") list = list.filter((a) => bogotaDayKey(new Date(a.starts_at)) === dayFilter);
    if (statusFilter !== "todas") list = list.filter((a) => a.status === statusFilter);
    return list;
  }, [appointments, selfEmployee, dayFilter, statusFilter]);

  const days = useMemo(() => {
    const set = new Set(appointments.map((a) => bogotaDayKey(new Date(a.starts_at))));
    return [...set].sort();
  }, [appointments]);

  const monthCount = useMemo(() => {
    const mk = bogotaDayKey(new Date()).slice(0, 7);
    return appointments.filter((a) => bogotaDayKey(new Date(a.starts_at)).startsWith(mk)).length;
  }, [appointments]);

  const planBlocked = ctx.subscription ? !planAllowsNewAppointment(resolvePlanLimits(ctx.subscription.plan), monthCount) : false;
  const canCreate = can(ctx.permissions, "agenda", "can_create") && !planBlocked && !isProfesional;

  async function changeStatus(appt: Appointment, status: Appointment["status"]) {
    const sb = supabaseBrowser();
    const { error: upErr } = await sb.from("appointments").update({ status }).eq("id", appt.id);
    if (upErr) {
      setError(`No se pudo actualizar la cita: ${upErr.message}`);
      return;
    }
    setNotice(`Cita marcada como ${STATUS_LABELS[status] ?? status}.`);
    await load();
  }

  /* Ventas ya generadas por cita (para no duplicar cobros) */
  const invoicedByAppt = useMemo(() => {
    const m = new Map<string, ServiceOrder>();
    for (const o of orders) if (o.appointment_id) m.set(o.appointment_id, o);
    return m;
  }, [orders]);

  /* Envía la cita completada a la caja: crea la orden abierta con su línea de servicio */
  async function sendToCash(appt: Appointment) {
    const sb = supabaseBrowser();
    setBillingId(appt.id);
    setError("");
    const svc = services.find((s) => s.id === appt.service_id);
    const { data: ord, error: ordErr } = await sb
      .from("service_orders")
      .insert({
        organization_id: ctx.organizationId,
        branch_id: appt.branch_id ?? null,
        customer_id: appt.customer_id ?? null,
        employee_id: appt.employee_id ?? null,
        appointment_id: appt.id,
        status: "open",
        subtotal: appt.price,
        discount: 0,
        tax: 0,
        total: appt.price,
      })
      .select("id")
      .single();
    if (ordErr || !ord) {
      setBillingId(null);
      setError(`No fue posible generar la venta: ${ordErr?.message ?? "respuesta vacía"}`);
      return;
    }
    const { error: itemErr } = await sb.from("service_order_items").insert({
      order_id: ord.id,
      service_id: appt.service_id ?? null,
      description: svc?.name ?? "Servicio realizado",
      quantity: 1,
      unit_price: appt.price,
      discount: 0,
      commission_percent: 0,
    });
    setBillingId(null);
    if (itemErr) {
      setError(`La orden se creó pero falló la línea del servicio: ${itemErr.message}`);
      await load();
      return;
    }
    setNotice(`Venta de ${formatCOP(appt.price)} enviada a la caja. Cóbrala en el módulo Caja.`);
    await load();
  }

  async function createAppointment() {
    if (!fCustomer || !fEmployee || !fService) {
      setError("Selecciona cliente, profesional y servicio.");
      return;
    }
    setSaving(true);
    setError("");
    const svc = services.find((s) => s.id === fService)!;
    const emp = employees.find((e) => e.id === fEmployee)!;
    const start = new Date(`${fDate}T${fTime}:00`);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("appointments").insert({
      organization_id: ctx.organizationId,
      branch_id: emp.branch_id ?? ctx.branches[0]?.id ?? null,
      customer_id: fCustomer,
      employee_id: fEmployee,
      service_id: fService,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "reserved",
      price: svc.price,
      source: "internal",
      notes: null,
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible crear la cita: ${insErr.message}`);
      return;
    }
    setShowNew(false);
    setNotice("Cita creada correctamente.");
    await load();
  }

  const dayName = dayFilter === "todas" ? "todas las fechas" : relativeDay(`${dayFilter}T12:00:00`);
  const hoy = new Intl.DateTimeFormat('en-CA').format(new Date()); // "2026-11-03"

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow={isProfesional ? "Mi agenda" : "Operación"}
        title={isProfesional ? "Mi agenda de citas" : "Agenda y reservas"}
        subtitle={
          isProfesional
            ? "Tus citas asignadas por día y estado."
            : planBlocked
              ? "Límite de citas del plan alcanzado este mes — mejora de plan para crear más."
              : "Gestiona citas por día, confirma reservas y marca estados."
        }
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} style={{ verticalAlign: "-2px" }} /> Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => setShowNew(true)}>
                <Plus size={14} style={{ verticalAlign: "-2px" }} /> Nueva cita
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div className="vr-card">
        <div className="vr-form" style={{ marginBottom: 16 }}>
          
          <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="todas">Todas las fechas</option>
            <option value={hoy}>Hoy</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="todas">Todos los estados</option>
            {["reserved", "confirmed", "completed", "cancelled", "no_show"].map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
            ))}
          </select>
          <span className="vr-muted" style={{ fontSize: 12 }}>
            {visible.length} citas · {dayName}
          </span>
        </div>

        {loading ? (
          <EmptyState title="Cargando agenda…" body=" " />
        ) : visible.length === 0 ? (
          <EmptyState title="Sin citas" body="No hay citas con los filtros seleccionados." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Cliente</th>
                  <th>Servicio</th>
                  <th>Profesional</th>
                  {!isProfesional && <th>Sede</th>}
                  <th>Origen</th>
                  <th>Estado</th>
                  <th>Precio</th>
                  {!isProfesional && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const cust = customers.find((c) => c.id === a.customer_id);
                  const svc = services.find((s) => s.id === a.service_id);
                  const emp = employees.find((e) => e.id === a.employee_id);
                  const branch = ctx.branches.find((b) => b.id === a.branch_id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{formatTime(a.starts_at)}</strong>
                        <br />
                        <span className="vr-muted" style={{ fontSize: 10.5 }}>{relativeDay(a.starts_at)}</span>
                      </td>
                      <td>{cust?.full_name ?? "—"}</td>
                      <td>{svc?.name ?? "—"}</td>
                      <td>{emp?.full_name ?? "—"}</td>
                      {!isProfesional && <td>{branch?.name ?? "—"}</td>}
                      <td style={{ textTransform: "capitalize" }}>{a.source === "online" ? "online" : a.source.replace("_", " ")}</td>
                      <td><StatusPill status={a.status} /></td>
                      <td>{formatCOP(a.price)}</td>
                      {!isProfesional && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            {a.status !== "completed" && a.status !== "cancelled" && (
                              <>
                                {(a.status === "reserved" || a.status === "scheduled") && (
                                  <button className="vr-btn-secondary vr-btn-sm" onClick={() => void changeStatus(a, "confirmed")}>
                                    <CheckCircle2 size={12} /> Confirmar
                                  </button>
                                )}
                                {a.status === "confirmed" && (
                                  <button className="vr-btn vr-btn-sm" onClick={() => void changeStatus(a, "completed")}>
                                    <CheckCircle2 size={12} /> Completar
                                  </button>
                                )}
                                <button className="vr-btn-danger vr-btn-sm" onClick={() => void changeStatus(a, "cancelled")}>
                                  <XCircle size={12} /> Cancelar
                                </button>
                              </>
                            )}
                            {a.status === "completed" &&
                              (() => {
                                const ord = invoicedByAppt.get(a.id);
                                if (ord) {
                                  return (
                                    <span className="vr-muted" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                      <ShoppingBag size={12} /> {ord.status === "paid" ? "Cobrada en caja" : "En caja · por cobrar"}
                                    </span>
                                  );
                                }
                                return (
                                  <button
                                    className="vr-btn vr-btn-sm"
                                    onClick={() => void sendToCash(a)}
                                    disabled={billingId === a.id}
                                    title="Genera la venta y la envía al módulo Caja para el cobro"
                                  >
                                    {billingId === a.id ? <Loader2 size={12} className="animate-spin" /> : <Banknote size={12} />} Enviar a caja
                                  </button>
                                );
                              })()}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showNew} title="Nueva cita" onClose={() => setShowNew(false)}>
        <FormGrid>
          <Field label="Cliente">
            <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)}>
              <option value="">Seleccionar…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Servicio">
            <select value={fService} onChange={(e) => setFService(e.target.value)}>
              <option value="">Seleccionar…</option>
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {formatCOP(s.price)}</option>
              ))}
            </select>
          </Field>
          <Field label="Profesional">
            <select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)}>
              <option value="">Seleccionar…</option>
              {employees.filter((e) => e.active).map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha">
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </Field>
          <Field label="Hora">
            <input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} />
          </Field>
        </FormGrid>
        {planBlocked && (
          <div className="vr-alert vr-alert-warning" style={{ marginBottom: 12 }}>
            <span>El plan {ctx.subscription?.plan.name} alcanzó su límite de {ctx.subscription ? resolvePlanLimits(ctx.subscription.plan).max_monthly_appointments : 0} citas este mes. Mejora de plan para continuar.</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createAppointment()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />} Crear cita
          </button>
        </div>
      </Modal>
    </div>
  );
}
