"use client";

/* VelloRa ERP — Módulo Caja: periodos de trabajo, caja diaria, arqueo y venta directa.
   Flujo: Abrir periodo (semanal/quincenal/mensual/personalizado) → abrir caja del día
   (base inicial) → ventas/ingresos/gastos/retiros → arqueo y cierre del día →
   al final del periodo: cierre + liquidación de nómina (payroll_runs). */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, RefreshCw, DollarSign, CreditCard, Banknote, Landmark, Receipt,
  CalendarRange, Play, Lock, ShoppingBag, ArrowDownCircle, ArrowUpCircle, Vault,
} from "lucide-react";
import type {
  CashMovement, CashSession, Customer, Employee, OrganizationContext, Service, ServiceOrder, WorkPeriod,
} from "@/lib/vellora/types";
import {
  fetchCashMovements, fetchCashSessions, fetchCustomers, fetchEmployees,
  fetchSales, fetchServices, fetchWorkPeriods,
} from "@/lib/vellora/queries";
import { formatCOP, formatTime, bogotaDayKey } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, StatusPill, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

const METHOD_ICON: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  efectivo: Banknote, tarjeta: CreditCard, transferencia: Landmark,
};

/* Medios de pago soportados: Efectivo, Transferencia y Tarjeta */
const PAY_METHODS = ["efectivo", "transferencia", "tarjeta"] as const;

const PERIOD_TYPE_LABELS: Record<string, string> = {
  semanal: "Semanal (lunes a sábado)",
  quincenal: "Quincenal",
  mensual: "Mensual",
  personalizado: "Personalizado",
};

const MOVEMENT_LABELS: Record<string, string> = {
  sale: "Venta",
  deposit: "Ingreso",
  expense: "Gasto",
  withdrawal: "Retiro",
  adjustment: "Ajuste",
};

function dateKey(d: Date): string {
  return bogotaDayKey(d);
}

function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${months[(m ?? 1) - 1]}`;
}

/* Fechas sugeridas del periodo según su tipo */
function suggestPeriod(type: string): { start: string; end: string; name: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  let start: Date;
  let end: Date;
  switch (type) {
    case "semanal": {
      const dow = (now.getDay() + 6) % 7; // lunes = 0
      start = new Date(y, m, day - dow);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 5); // sábado
      break;
    }
    case "quincenal":
      start = day <= 15 ? new Date(y, m, 1) : new Date(y, m, 16);
      end = day <= 15 ? new Date(y, m, 15) : new Date(y, m + 1, 0);
      break;
    case "mensual":
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 0);
      break;
    default:
      start = new Date(y, m, day);
      end = new Date(y, m, day);
  }
  const s = dateKey(start);
  const e = dateKey(end);
  return { start: s, end: e, name: `${PERIOD_TYPE_LABELS[type]?.split(" ")[0] ?? "Periodo"} ${shortDate(s)} – ${shortDate(e)}` };
}

type MoveKind = "deposit" | "expense" | "withdrawal";

export default function CajaView({ ctx }: { ctx: OrganizationContext }) {
  const [periods, setPeriods] = useState<WorkPeriod[]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [sales, setSales] = useState<ServiceOrder[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methodSel, setMethodSel] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* Modal: abrir periodo */
  const [showPeriod, setShowPeriod] = useState(false);
  const [fPeriodType, setFPeriodType] = useState("semanal");
  const sug = useMemo(() => suggestPeriod("semanal"), []);
  const [fStart, setFStart] = useState(sug.start);
  const [fEnd, setFEnd] = useState(sug.end);
  const [fPeriodName, setFPeriodName] = useState(sug.name);

  /* Modal: abrir caja del día */
  const [showOpenDay, setShowOpenDay] = useState(false);
  const [fBase, setFBase] = useState("0");

  /* Modal: movimiento manual (ingreso / gasto / retiro) */
  const [showMove, setShowMove] = useState(false);
  const [moveKind, setMoveKind] = useState<MoveKind>("deposit");
  const [fMoveAmount, setFMoveAmount] = useState("");
  const [fMoveMethod, setFMoveMethod] = useState("efectivo");
  const [fMoveDesc, setFMoveDesc] = useState("");

  /* Modal: venta sin cita */
  const [showSale, setShowSale] = useState(false);
  const [fCustName, setFCustName] = useState("");
  const [fEmployee, setFEmployee] = useState("");
  const [fService, setFService] = useState("");
  const [fQty, setFQty] = useState("1");
  const [fPrice, setFPrice] = useState("");
  const [fMethod, setFMethod] = useState("efectivo");

  /* Modal: arqueo y cierre del día */
  const [showCount, setShowCount] = useState(false);
  const [fCounted, setFCounted] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, ses, v, emp, svc, cus] = await Promise.all([
        fetchWorkPeriods(ctx.organizationId),
        fetchCashSessions(ctx.organizationId),
        fetchSales(ctx.organizationId, 40),
        fetchEmployees(ctx.organizationId),
        fetchServices(ctx.organizationId),
        fetchCustomers(ctx.organizationId),
      ]);
      setPeriods(p);
      setSessions(ses);
      setSales(v);
      setEmployees(emp);
      setServices(svc);
      setCustomers(cus);
      const mv = await fetchCashMovements(ses.map((s) => s.id));
      setMovements(mv);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando caja");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ————— Derivados ————— */
  const canCreate = can(ctx.permissions, "caja", "can_create");
  const canUpdate = can(ctx.permissions, "caja", "can_update");
  const openPeriod = periods.find((p) => p.status === "abierto") ?? null;
  const openSession = sessions.find((s) => s.status === "open") ?? null;

  const todayKey = dateKey(new Date());
  const todaySales = sales.filter((s) => bogotaDayKey(new Date(s.created_at)) === todayKey);
  const pending = todaySales.filter((s) => s.status === "open");
  const paid = todaySales.filter((s) => s.status === "paid");

  const sessionMovs = movements.filter((m) => m.cash_register_id === (openSession?.id ?? "__none__"));
  const isCash = (m: CashMovement) => (m.method ?? "efectivo") === "efectivo";
  const sumMov = (types: string[]) =>
    sessionMovs.filter((m) => types.includes(m.type) && isCash(m)).reduce((a, m) => a + m.amount, 0);

  const base = openSession ? openSession.opening_amount : 0;
  const cashSales = sumMov(["sale"]);
  const deposits = sumMov(["deposit", "adjustment"]);
  const expenses = sumMov(["expense"]);
  const withdrawals = sumMov(["withdrawal"]);
  const expectedCash = base + cashSales + deposits - expenses - withdrawals;
  const nonCashToday = paid
    .filter((s) => (s.payment_method ?? "") !== "efectivo")
    .reduce((a, s) => a + s.total, 0);

  /* Sesiones (días) del periodo activo */
  const periodSessions = useMemo(() => {
    if (!openPeriod) return sessions.slice(0, 10);
    return sessions.filter(
      (s) => s.work_period_id === openPeriod.id || bogotaDayKey(new Date(s.opened_at)) >= openPeriod.start_date
    );
  }, [sessions, openPeriod]);

  const daysIntoPeriod = openPeriod
    ? Math.max(1, Math.round((Date.now() - new Date(`${openPeriod.start_date}T12:00:00`).getTime()) / 86_400_000) + 1)
    : 0;

  /* ————— Acciones ————— */
  async function submitOpenPeriod() {
    if (!fStart || !fEnd || new Date(fStart) > new Date(fEnd)) {
      setError("Revisa las fechas del periodo.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const name = fPeriodName.trim() || suggestPeriod(fPeriodType).name;
    const { error: insErr } = await sb.from("work_periods").insert({
      organization_id: ctx.organizationId,
      name,
      period_type: fPeriodType,
      start_date: fStart,
      end_date: fEnd,
      status: "abierto",
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible abrir el periodo: ${insErr.message}`);
      return;
    }
    setShowPeriod(false);
    setNotice(`Periodo "${name}" abierto. Ya puedes abrir la caja del día.`);
    await load();
  }

  async function closePeriod() {
    if (!openPeriod) return;
    if (openSession) {
      setError("Cierra la caja del día (arqueo) antes de cerrar el periodo.");
      setShowCount(false);
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const p = openPeriod;
    const startISO = new Date(`${p.start_date}T00:00:00`).toISOString();
    const endISO = new Date(`${p.end_date}T23:59:59`).toISOString();

    /* Ventas pagadas del periodo (para comisiones) */
    const periodSales = sales.filter(
      (s) => s.status === "paid" && s.created_at >= startISO && s.created_at <= endISO
    );

    /* Evita duplicar la liquidación si ya existe un corrido con las mismas fechas */
    const { data: existing } = await sb
      .from("payroll_runs")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("period_start", p.start_date)
      .eq("period_end", p.end_date)
      .maybeSingle();

    let runId = (existing as { id: string } | null)?.id ?? null;
    let liquidaciones = 0;
    let totalNomina = 0;

    if (!runId) {
      const { data: run, error: runErr } = await sb
        .from("payroll_runs")
        .insert({
          organization_id: ctx.organizationId,
          period_start: p.start_date,
          period_end: p.end_date,
          status: "draft",
        })
        .select("id")
        .single();
      if (runErr || !run) {
        setSaving(false);
        setError(`No fue posible crear la nómina del periodo: ${runErr?.message ?? "respuesta vacía"}`);
        return;
      }
      runId = run.id;

      for (const e of employees.filter((x) => x.active)) {
        const servicesTotal = periodSales
          .filter((s) => s.employee_id === e.id && s.kind !== "producto")
          .reduce((a, s) => a + s.total, 0);
        const tipo = e.salary_type ?? "basico";
        const baseAmt = tipo === "porcentaje" ? 0 : e.salary ?? 0;
        const pct = tipo === "basico" ? 0 : e.commission_percent ?? 0;
        const commission = Math.round((servicesTotal * pct) / 100);
        const total = baseAmt + commission;
        const { error: itErr } = await sb.from("payroll_items").insert({
          run_id: runId,
          employee_id: e.id,
          base_salary: baseAmt,
          commission,
          bonus: 0,
          deductions: 0,
          total,
          paid: false,
        });
        if (!itErr) {
          liquidaciones += 1;
          totalNomina += total;
        }
      }
    }

    const { error: upErr } = await sb
      .from("work_periods")
      .update({ status: "cerrado", closed_at: new Date().toISOString() })
      .eq("id", p.id);
    setSaving(false);
    if (upErr) {
      setError(`No se pudo cerrar el periodo: ${upErr.message}`);
      return;
    }
    setShowPeriod(false);
    setNotice(
      runId && liquidaciones > 0
        ? `Periodo "${p.name}" cerrado. Nómina generada: ${liquidaciones} liquidación(es) por ${formatCOP(totalNomina)}. Págala en el módulo Nómina.`
        : `Periodo "${p.name}" cerrado.`
    );
    await load();
  }

  async function openDay() {
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const baseAmt = Math.max(0, Number(fBase) || 0);
    const { data: ses, error: insErr } = await sb
      .from("cash_registers")
      .insert({
        organization_id: ctx.organizationId,
        branch_id: ctx.branches[0]?.id ?? null,
        work_period_id: openPeriod?.id ?? null,
        opened_at: new Date().toISOString(),
        opening_amount: baseAmt,
        status: "open",
        opened_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (insErr || !ses) {
      setSaving(false);
      setError(`No fue posible abrir la caja: ${insErr?.message ?? "respuesta vacía"}`);
      return;
    }
    if (baseAmt > 0) {
      await sb.from("cash_movements").insert({
        cash_register_id: ses.id,
        organization_id: ctx.organizationId,
        type: "deposit",
        method: "efectivo",
        amount: baseAmt,
        description: "Base inicial del día",
      });
    }
    setSaving(false);
    setShowOpenDay(false);
    setFBase("0");
    setNotice("Caja del día abierta. Registra ventas, ingresos y gastos con normalidad.");
    await load();
  }

  async function addMovement() {
    if (!openSession) {
      setError("Abre la caja del día primero.");
      return;
    }
    const amount = Number(fMoveAmount);
    if (!amount || amount <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("cash_movements").insert({
      cash_register_id: openSession.id,
      organization_id: ctx.organizationId,
      type: moveKind,
      method: moveKind === "withdrawal" ? "efectivo" : fMoveMethod,
      amount,
      description: fMoveDesc.trim() || MOVEMENT_LABELS[moveKind],
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible registrar el movimiento: ${insErr.message}`);
      return;
    }
    setShowMove(false);
    setFMoveAmount("");
    setFMoveDesc("");
    setNotice(`${MOVEMENT_LABELS[moveKind]} de ${formatCOP(amount)} registrado.`);
    await load();
  }

  /* Limpia por completo el formulario de venta sin cita (al abrir el modal y tras registrar) */
  function resetSaleForm() {
    setFCustName("");
    setFEmployee("");
    setFService("");
    setFQty("1");
    setFPrice("");
    setFMethod("efectivo");
  }

  /* Venta directa (cliente sin cita): crea orden pagada + pago + movimiento de caja */
  async function quickSale() {
    const name = fCustName.trim();
    if (!name || !fEmployee || !fService) {
      setError("Indica el nombre del cliente, el profesional y el servicio.");
      return;
    }
    const svc = services.find((s) => s.id === fService);
    if (!svc) {
      setError("Selecciona un servicio válido.");
      return;
    }
    const qty = Math.max(1, Number(fQty) || 1);
    const unit = Number(fPrice) >= 0 && fPrice !== "" ? Number(fPrice) : svc.price;
    const total = Math.round(unit * qty);
    if (total <= 0) {
      setError("El total debe ser mayor a cero.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();

    /* Cliente: usa el existente si coincide por nombre; si no, lo crea */
    let customerId: string | null = customers.find((c) => c.full_name.trim().toLowerCase() === name.toLowerCase())?.id ?? null;
    if (!customerId) {
      const { data: newCust, error: custErr } = await sb
        .from("customers")
        .insert({ organization_id: ctx.organizationId, full_name: name })
        .select("id")
        .single();
      if (custErr || !newCust) {
        setSaving(false);
        setError(`No fue posible registrar al cliente: ${custErr?.message ?? "respuesta vacía"}`);
        return;
      }
      customerId = newCust.id;
    }

    const { data: order, error: ordErr } = await sb
      .from("service_orders")
      .insert({
        organization_id: ctx.organizationId,
        branch_id: openSession?.branch_id ?? ctx.branches[0]?.id ?? null,
        customer_id: customerId,
        employee_id: fEmployee,
        appointment_id: null,
        status: "paid",
        subtotal: total,
        discount: 0,
        tax: 0,
        total,
      })
      .select("id")
      .single();
    if (ordErr || !order) {
      setSaving(false);
      setError(`No fue posible registrar la venta: ${ordErr?.message ?? "respuesta vacía"}`);
      return;
    }

    /* A partir de aquí la venta YA existe en la base de datos: si algo posterior
       falla, se informa el detalle en un aviso, pero el modal SIEMPRE se cierra
       y el formulario se limpia (la ventana no debe quedar abierta tras registrar). */
    let warn = "";

    const { error: itemErr } = await sb.from("service_order_items").insert({
      order_id: order.id,
      service_id: svc.id,
      description: svc.name,
      quantity: qty,
      unit_price: unit,
      discount: 0,
      commission_percent: 0,
    });
    if (itemErr) warn = `La venta se registró pero falló la línea del servicio: ${itemErr.message}`;

    const { data: pay, error: payErr } = await sb
      .from("payments")
      .insert({
        organization_id: ctx.organizationId,
        order_id: order.id,
        method: fMethod,
        amount: total,
        paid_at: new Date().toISOString(),
        reference: null,
      })
      .select("id")
      .single();
    if (payErr || !pay) {
      warn = warn || `La venta se registró pero falló el registro del pago: ${payErr?.message ?? "respuesta vacía"}`;
    }

    /* El efectivo entra a la caja del día; tarjeta/transferencia quedan en payments */
    if (openSession && fMethod === "efectivo") {
      const { error: movErr } = await sb.from("cash_movements").insert({
        cash_register_id: openSession.id,
        organization_id: ctx.organizationId,
        type: "sale",
        method: "efectivo",
        amount: total,
        description: `Venta ${name} · ${svc.name}`,
        payment_id: (pay as { id: string } | null)?.id ?? null,
      });
      if (movErr) warn = warn || `La venta se registró pero falló el movimiento de caja: ${movErr.message}`;
    }

    setSaving(false);
    setShowSale(false);
    resetSaleForm();
    if (warn) {
      setError(warn);
    } else {
      setNotice(`Venta de ${formatCOP(total)} registrada (${fMethod}).`);
    }
    await load();
  }

  /* Arqueo: cierra la sesión del día comparando lo contado vs lo esperado */
  async function countAndClose() {
    if (!openSession) return;
    const counted = Number(fCounted);
    if (Number.isNaN(counted) || counted < 0) {
      setError("Ingresa el efectivo contado en caja.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const diff = Math.round(counted - expectedCash);
    const { error: upErr } = await sb
      .from("cash_registers")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_amount: counted,
        expected_amount: expectedCash,
        difference: diff,
      })
      .eq("id", openSession.id);
    setSaving(false);
    if (upErr) {
      setError(`No fue posible cerrar la caja: ${upErr.message}`);
      return;
    }
    setShowCount(false);
    setFCounted("");
    setNotice(
      diff === 0
        ? "Caja cerrada sin diferencias. Cuadra perfecto."
        : `Caja cerrada con ${diff > 0 ? "sobrante" : "faltante"} de ${formatCOP(Math.abs(diff))}.`
    );
    await load();
  }

  async function collect(sale: ServiceOrder) {
    const sb = supabaseBrowser();
    const method = methodSel[sale.id] ?? sale.payment_method ?? "efectivo";
    const { error: upErr } = await sb.from("service_orders").update({ status: "paid" }).eq("id", sale.id);
    if (upErr) {
      setError(`No se pudo cobrar: ${upErr.message}`);
      return;
    }
    const { error: payErr } = await sb.from("payments").insert({
      organization_id: ctx.organizationId,
      order_id: sale.id,
      method,
      amount: sale.total,
      paid_at: new Date().toISOString(),
      reference: null,
    });
    if (payErr) {
      setError(`La orden se marcó pagada pero falló el registro del pago: ${payErr.message}`);
      await load();
      return;
    }
    if (openSession && method === "efectivo") {
      const { error: movErr } = await sb.from("cash_movements").insert({
        cash_register_id: openSession.id,
        organization_id: ctx.organizationId,
        type: "sale",
        method: "efectivo",
        amount: sale.total,
        description: "Cobro de venta",
        payment_id: null,
      });
      if (movErr) {
        setError(`Cobro registrado, pero falló el movimiento de caja: ${movErr.message}`);
        await load();
        return;
      }
    }
    setNotice(`Cobro de ${formatCOP(sale.total)} (${method}) registrado correctamente.`);
    await load();
  }

  const moveIcon: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
    sale: ShoppingBag, deposit: ArrowDownCircle, expense: ArrowUpCircle, withdrawal: Vault, adjustment: RefreshCw,
  };

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Operación diaria"
        title="Caja del día"
        subtitle={
          openPeriod
            ? `Periodo ${openPeriod.name} · día ${daysIntoPeriod} · ${openPeriod.start_date} a ${openPeriod.end_date}`
            : "Abre un periodo de trabajo para comenzar a operar la caja."
        }
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canUpdate && openPeriod && !openSession && (
              <button className="vr-btn" onClick={() => setShowOpenDay(true)}>
                <Play size={14} /> Abrir caja del día
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      {/* ————— Periodo de trabajo ————— */}
      <section className="vr-card">
        <h2><CalendarRange size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Periodo de trabajo</h2>
        {openPeriod ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong style={{ font: "800 15px Manrope,sans-serif" }}>{openPeriod.name}</strong>
              <div className="vr-muted" style={{ fontSize: 12 }}>
                {PERIOD_TYPE_LABELS[openPeriod.period_type] ?? openPeriod.period_type} · {openPeriod.start_date} → {openPeriod.end_date} · día {daysIntoPeriod}
              </div>
            </div>
            <span className="vr-pill vr-pill-green">Abierto</span>
            {canUpdate && (
              <button className="vr-btn-danger vr-btn-sm" onClick={() => void closePeriod()} disabled={saving}>
                <Lock size={12} /> Cerrar periodo y liquidar nómina
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <span className="vr-muted" style={{ flex: 1, fontSize: 13 }}>
              No hay un periodo activo. Abre uno para operar la caja y liquidar nómina al finalizar.
            </span>
            {canCreate && (
              <button
                className="vr-btn"
                onClick={() => {
                  const s = suggestPeriod(fPeriodType);
                  setFStart(s.start); setFEnd(s.end); setFPeriodName(s.name);
                  setShowPeriod(true);
                }}
              >
                <CalendarRange size={14} /> Abrir nuevo periodo
              </button>
            )}
          </div>
        )}
      </section>

      {/* ————— Métricas del día ————— */}
      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Base inicial</div>
          <div className="vr-metric-value">{formatCOP(base, { compact: true })}</div>
          <div className="vr-metric-note">{openSession ? "Caja abierta" : "Caja cerrada"}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Ventas efectivo hoy</div>
          <div className="vr-metric-value">{formatCOP(cashSales, { compact: true })}</div>
          <div className="vr-metric-note"><Receipt size={11} /> {paid.length} ventas pagadas</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Gastos y retiros</div>
          <div className="vr-metric-value" style={{ color: expenses + withdrawals ? "#ca435c" : undefined }}>
            −{formatCOP(expenses + withdrawals, { compact: true })}
          </div>
          <div className="vr-metric-note">Ingresos extra: {formatCOP(deposits, { compact: true })}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Esperado en caja</div>
          <div className="vr-metric-value" style={{ color: "#7556d8" }}>{formatCOP(expectedCash, { compact: true })}</div>
          <div className="vr-metric-note">No efectivo hoy: {formatCOP(nonCashToday, { compact: true })}</div>
        </div>
      </div>

      {/* ————— Acciones rápidas ————— */}
      {canCreate && openSession && (
        <div className="vr-card" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button className="vr-btn" onClick={() => { resetSaleForm(); setShowSale(true); }}>
            <ShoppingBag size={14} /> Venta sin cita
          </button>
          <button className="vr-btn-secondary" onClick={() => { setMoveKind("deposit"); setShowMove(true); }}>
            <ArrowDownCircle size={14} /> Ingreso
          </button>
          <button className="vr-btn-secondary" onClick={() => { setMoveKind("expense"); setShowMove(true); }}>
            <ArrowUpCircle size={14} /> Gasto
          </button>
          <button className="vr-btn-secondary" onClick={() => { setMoveKind("withdrawal"); setShowMove(true); }}>
            <Vault size={14} /> Retiro
          </button>
          <button className="vr-btn-danger" onClick={() => { setFCounted(String(expectedCash)); setShowCount(true); }}>
            <Lock size={14} /> Arquear y cerrar día
          </button>
        </div>
      )}
      {canCreate && !openSession && openPeriod && !loading && (
        <div className="vr-alert vr-alert-warning">
          <span>La caja del día está cerrada. Ábrela con una base inicial para vender y registrar movimientos.</span>
        </div>
      )}

      {/* ————— Ventas de hoy ————— */}
      <section className="vr-card">
        <h2>Ventas de hoy</h2>
        {loading ? (
          <EmptyState title="Cargando ventas…" body=" " />
        ) : todaySales.length === 0 ? (
          <EmptyState title="Sin movimientos" body="Todavía no hay ventas registradas hoy." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Método</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {todaySales.map((s) => {
                  const Icon = METHOD_ICON[s.payment_method ?? ""] ?? DollarSign;
                  return (
                    <tr key={s.id}>
                      <td><strong>{formatTime(s.created_at)}</strong></td>
                      <td style={{ textTransform: "capitalize" }}>{s.kind}</td>
                      <td style={{ textTransform: "capitalize" }}>
                        {s.status === "open" ? (
                          <select
                            value={methodSel[s.id] ?? "efectivo"}
                            onChange={(e) => setMethodSel((m) => ({ ...m, [s.id]: e.target.value }))}
                            style={{ maxWidth: 140, fontSize: 12 }}
                            aria-label="Método de pago"
                          >
                            {PAY_METHODS.map((m) => (
                              <option key={m} value={m} style={{ textTransform: "capitalize" }}>{m}</option>
                            ))}
                          </select>
                        ) : (
                          <><Icon size={13} style={{ verticalAlign: "-2px" }} /> {s.payment_method ?? "—"}</>
                        )}
                      </td>
                      <td><strong>{formatCOP(s.total)}</strong></td>
                      <td><StatusPill status={s.status} /></td>
                      <td>
                        {s.status === "open" ? (
                          canUpdate ? (
                            <button className="vr-btn vr-btn-sm" onClick={() => void collect(s)}>
                              <DollarSign size={12} /> Cobrar
                            </button>
                          ) : (
                            <span className="vr-muted" style={{ fontSize: 11 }}>Por cobrar</span>
                          )
                        ) : (
                          <span className="vr-muted" style={{ fontSize: 11 }}>Cobrada</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Movimientos del día ————— */}
      <section className="vr-card">
        <h2>Movimientos de caja de hoy</h2>
        {sessionMovs.length === 0 ? (
          <EmptyState title="Sin movimientos" body="Cuando abras la caja verás aquí la base, ingresos, gastos y ventas en efectivo." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Método</th>
                  <th>Descripción</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {sessionMovs.map((m) => {
                  const Icon = moveIcon[m.type] ?? DollarSign;
                  const sign = m.type === "expense" || m.type === "withdrawal" ? "−" : "";
                  return (
                    <tr key={m.id}>
                      <td><strong>{formatTime(m.created_at)}</strong></td>
                      <td><Icon size={13} style={{ verticalAlign: "-2px" }} /> {MOVEMENT_LABELS[m.type] ?? m.type}</td>
                      <td style={{ textTransform: "capitalize" }}>{m.method ?? "efectivo"}</td>
                      <td className="vr-muted">{m.description ?? "—"}</td>
                      <td style={{ fontWeight: 700, color: sign ? "#ca435c" : undefined }}>{sign}{formatCOP(m.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Historial de días del periodo ————— */}
      <section className="vr-card">
        <h2>Días del periodo</h2>
        {periodSessions.length === 0 ? (
          <EmptyState title="Sin días cerrados" body="Aquí verás el arqueo de cada día: esperado, contado y diferencia." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Abierta</th>
                  <th>Base</th>
                  <th>Esperado</th>
                  <th>Contado</th>
                  <th>Diferencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {periodSessions.map((s) => {
                  const diff = s.status === "closed" ? s.difference ?? 0 : null;
                  return (
                    <tr key={s.id}>
                      <td><strong>{bogotaDayKey(new Date(s.opened_at))}</strong></td>
                      <td>{formatTime(s.opened_at)}</td>
                      <td>{formatCOP(s.opening_amount, { compact: true })}</td>
                      <td>{s.status === "closed" ? formatCOP(s.expected_amount ?? 0, { compact: true }) : "—"}</td>
                      <td>{s.status === "closed" ? formatCOP(s.closing_amount ?? 0, { compact: true }) : "—"}</td>
                      <td>
                        {diff === null ? (
                          "—"
                        ) : (
                          <strong style={{ color: diff === 0 ? "#2e9e6b" : "#ca435c" }}>
                            {diff > 0 ? "+" : ""}{formatCOP(diff, { compact: true })}
                          </strong>
                        )}
                      </td>
                      <td><StatusPill status={s.status === "open" ? "abierta" : "cerrada"} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Modal: abrir periodo ————— */}
      <Modal open={showPeriod} title="Abrir periodo de trabajo" onClose={() => setShowPeriod(false)}>
        <FormGrid>
          <Field label="Tipo de periodo">
            <select
              value={fPeriodType}
              onChange={(e) => {
                setFPeriodType(e.target.value);
                const s = suggestPeriod(e.target.value);
                setFStart(s.start); setFEnd(s.end); setFPeriodName(s.name);
              }}
            >
              {Object.entries(PERIOD_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Nombre (opcional)">
            <input value={fPeriodName} onChange={(e) => setFPeriodName(e.target.value)} placeholder="Ej: Semana 45" />
          </Field>
          <Field label="Fecha inicio">
            <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} />
          </Field>
          <Field label="Fecha fin">
            <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowPeriod(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void submitOpenPeriod()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarRange size={14} />} Abrir periodo
          </button>
        </div>
      </Modal>

      {/* ————— Modal: abrir caja del día ————— */}
      <Modal open={showOpenDay} title="Abrir caja del día" onClose={() => setShowOpenDay(false)}>
        <Field label="Base inicial en efectivo (COP)">
          <input type="number" min="0" value={fBase} onChange={(e) => setFBase(e.target.value)} placeholder="0" />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowOpenDay(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void openDay()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Abrir caja
          </button>
        </div>
      </Modal>

      {/* ————— Modal: movimiento manual ————— */}
      <Modal open={showMove} title={`Registrar ${MOVEMENT_LABELS[moveKind]?.toLowerCase()}`} onClose={() => setShowMove(false)}>
        <FormGrid>
          <Field label="Monto (COP)">
            <input type="number" min="0" value={fMoveAmount} onChange={(e) => setFMoveAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Medio">
            <select value={fMoveMethod} onChange={(e) => setFMoveMethod(e.target.value)} disabled={moveKind === "withdrawal"}>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m} style={{ textTransform: "capitalize" }}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Descripción">
            <input value={fMoveDesc} onChange={(e) => setFMoveDesc(e.target.value)} placeholder="Ej: insumos, domo, consignación…" />
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowMove(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void addMovement()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />} Registrar
          </button>
        </div>
      </Modal>

      {/* ————— Modal: venta sin cita ————— */}
      <Modal open={showSale} title="Venta sin cita (cliente directo)" onClose={() => setShowSale(false)}>
        <FormGrid>
          <Field label="Nombre del cliente">
            <input
              value={fCustName}
              onChange={(e) => setFCustName(e.target.value)}
              placeholder="Ej: María Pérez"
              list="vr-customers-list"
            />
            <datalist id="vr-customers-list">
              {customers.map((c) => (
                <option key={c.id} value={c.full_name} />
              ))}
            </datalist>
          </Field>
          <Field label="Profesional">
            <select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)}>
              <option value="">Seleccionar…</option>
              {employees.filter((e) => e.active).map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Servicio realizado">
            <select
              value={fService}
              onChange={(e) => {
                setFService(e.target.value);
                const s = services.find((x) => x.id === e.target.value);
                setFPrice(s ? String(s.price) : "");
              }}
            >
              <option value="">Seleccionar…</option>
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {formatCOP(s.price)}</option>
              ))}
            </select>
          </Field>
          <Field label="Cantidad">
            <input type="number" min="1" value={fQty} onChange={(e) => setFQty(e.target.value)} />
          </Field>
          <Field label="Precio unitario (COP)">
            <input type="number" min="0" value={fPrice} onChange={(e) => setFPrice(e.target.value)} />
          </Field>
          <Field label="Medio de pago">
            <select value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m} style={{ textTransform: "capitalize" }}>{m}</option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <div className="vr-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Total: <strong>{formatCOP(Math.round((Number(fPrice) || 0) * (Number(fQty) || 1)))}</strong> · la venta queda pagada y con trazabilidad (cliente, profesional, servicio y medio de pago).
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowSale(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void quickSale()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />} Registrar venta
          </button>
        </div>
      </Modal>

      {/* ————— Modal: arqueo y cierre del día ————— */}
      <Modal open={showCount} title="Arqueo y cierre del día" onClose={() => setShowCount(false)}>
        <div className="vr-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Efectivo esperado en caja: <strong>{formatCOP(expectedCash)}</strong> (base {formatCOP(base, { compact: true })} + ventas {formatCOP(cashSales, { compact: true })} + ingresos {formatCOP(deposits, { compact: true })} − gastos {formatCOP(expenses, { compact: true })} − retiros {formatCOP(withdrawals, { compact: true })}).
        </div>
        <Field label="Efectivo contado en caja (COP)">
          <input type="number" min="0" value={fCounted} onChange={(e) => setFCounted(e.target.value)} placeholder="0" />
        </Field>
        <div className="vr-muted" style={{ fontSize: 12, margin: "10px 0 14px" }}>
          Diferencia:{" "}
          <strong style={{ color: Number(fCounted) - expectedCash === 0 ? "#2e9e6b" : "#ca435c" }}>
            {formatCOP(Math.round((Number(fCounted) || 0) - expectedCash))}
          </strong>{" "}
          {Number(fCounted) - expectedCash === 0 ? "(cuadra)" : Number(fCounted) - expectedCash > 0 ? "(sobrante)" : "(faltante)"}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowCount(false)}>Cancelar</button>
          <button className="vr-btn-danger" onClick={() => void countAndClose()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Cerrar caja del día
          </button>
        </div>
      </Modal>
    </div>
  );
}
