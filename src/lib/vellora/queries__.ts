/* VelloRa ERP — Consultas y agregaciones compartidas.
   Las consultas usan los nombres de tablas/columnas REALES de la base de datos
   (service_orders, service_order_items, payments, branches, vellora_plans...),
   de modo que el modo demo y Supabase real devuelven datos idénticos. */

import { supabaseBrowser } from "./supabase";
import {
  bogotaDayKey, bogotaMonthKey, pctChange,
} from "./format";
import { planChecks, resolvePlanLimits } from "./permissions";
import type {
  Appointment, AppNotification, CashMovement, CashSession, Customer, Employee, ModuleKey,
  Product, Service, ServiceOrder, Plan, Payment, ServiceOrderItem, WorkPeriod,
} from "./types";

/* ————— Cargas base por módulo ————— */
export async function fetchAppointments(organizationId: string, daysBack = 70, daysAhead = 10): Promise<Appointment[]> {
  const sb = supabaseBrowser();
  const from = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const to = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("appointments")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as Appointment[];
}

/**
 * Ventas = service_orders. Deriva por orden:
 *  · kind (servicio/producto/mixto) desde service_order_items
 *  · payment_method y estado de pago desde payments
 */
export async function fetchSales(organizationId: string, daysBack = 70): Promise<ServiceOrder[]> {
  const sb = supabaseBrowser();
  const from = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const ordersRes = await sb
    .from("service_orders")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("created_at", from)
    .order("created_at", { ascending: false });
  if (ordersRes.error) throw new Error(ordersRes.error.message);

  const orders = ((ordersRes.data ?? []) as unknown) as ServiceOrder[];
  const orderIds = orders.map((o) => o.id);

  /* service_order_items no tiene organization_id: se filtra por las órdenes de la org */
  const [itemsRes, paysRes] = await Promise.all([
    orderIds.length
      ? sb.from("service_order_items").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    sb.from("payments").select("*").eq("organization_id", organizationId).gte("paid_at", from),
  ]);
  const items = (itemsRes.error ? [] : ((itemsRes.data ?? []) as unknown) as ServiceOrderItem[]);
  const pays = ((paysRes.data ?? []) as unknown) as Payment[];

  const itemsByOrder = new Map<string, ServiceOrderItem[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }
  const paysByOrder = new Map<string, Payment[]>();
  for (const p of pays) {
    if (!p.order_id) continue;
    const list = paysByOrder.get(p.order_id) ?? [];
    list.push(p);
    paysByOrder.set(p.order_id, list);
  }

  return orders.map((o) => {
    const its = itemsByOrder.get(o.id) ?? [];
    const hasSvc = its.some((i) => i.service_id);
    const hasPrd = its.some((i) => i.product_id);
    const myPays = paysByOrder.get(o.id) ?? [];
    const paidSum = myPays.reduce((a, p) => a + p.amount, 0);
    const isPaid = o.status === "paid" || (o.status !== "void" && myPays.length > 0 && paidSum >= o.total - 1);
    return {
      ...o,
      status: o.status === "void" ? "void" : isPaid ? "paid" : "open",
      kind: hasSvc && hasPrd ? "mixto" : hasPrd ? "producto" : "servicio",
      payment_method: myPays.length ? myPays[myPays.length - 1].method : null,
    } as ServiceOrder;
  });
}

export async function fetchCustomers(organizationId: string): Promise<Customer[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("customers")
    .select("*")
    .eq("organization_id", organizationId)
    .order("full_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as Customer[];
}

export async function fetchServices(organizationId: string): Promise<Service[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("services")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as Service[];
}

export async function fetchEmployees(organizationId: string): Promise<Employee[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("employees")
    .select("*")
    .eq("organization_id", organizationId)
    .order("full_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as Employee[];
}

export async function fetchProducts(organizationId: string): Promise<Product[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as Product[];
}

/* ————— Periodos de trabajo y sesiones de caja ————— */
export async function fetchWorkPeriods(organizationId: string, limit = 12): Promise<WorkPeriod[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("work_periods")
    .select("*")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as WorkPeriod[];
}

export async function fetchCashSessions(organizationId: string, limit = 40): Promise<CashSession[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("cash_registers")
    .select("*")
    .eq("organization_id", organizationId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as CashSession[];
}

/** Movimientos de una o varias sesiones de caja (cash_movements). */
export async function fetchCashMovements(sessionIds: string[]): Promise<CashMovement[]> {
  if (sessionIds.length === 0) return [];
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("cash_movements")
    .select("*")
    .in("cash_register_id", sessionIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as CashMovement[];
}

/* ————— Notificaciones calculadas —————
   La BD real no tiene tabla notifications: se derivan de los datos
   (stock bajo, citas por confirmar hoy y límites del plan). */
export async function fetchNotifications(organizationId: string): Promise<AppNotification[]> {
  const sb = supabaseBrowser();
  const [appts, prods] = await Promise.all([
    fetchAppointments(organizationId, 1, 1),
    fetchProducts(organizationId).catch(() => [] as Product[]),
  ]);
  const now = new Date().toISOString();
  const out: AppNotification[] = [];

  const low = prods.filter((p) => p.active && p.stock <= p.minimum_stock);
  if (low.length > 0) {
    out.push({
      id: "ntf-stock",
      organization_id: organizationId,
      severity: low.some((p) => p.stock === 0) ? "critical" : "warning",
      title: `Inventario bajo: ${low.length} producto(s)`,
      body: `${low.slice(0, 3).map((p) => p.name).join(", ")}${low.length > 3 ? " y más" : ""} están en o por debajo del mínimo.`,
      module_key: "inventario",
      audience_roles: ["owner", "administracion", "cajero"],
      created_at: now,
      read_by: [],
    });
  }

  const todayKey = bogotaDayKey(new Date());
  const porConfirmar = appts.filter(
    (a) => (a.status === "reserved" || a.status === "scheduled") && bogotaDayKey(new Date(a.starts_at)) === todayKey
  );
  if (porConfirmar.length > 0) {
    out.push({
      id: "ntf-citas",
      organization_id: organizationId,
      severity: "info",
      title: `${porConfirmar.length} citas por confirmar hoy`,
      body: "Confírmalas desde la agenda para asegurar la disponibilidad de los profesionales.",
      module_key: "agenda",
      audience_roles: ["owner", "administracion", "profesional"],
      created_at: now,
      read_by: [],
    });
  }

  return out;
}

/* ————— Agregaciones KPI ————— */
export type Range = "hoy" | "7d" | "30d" | "mes";

export const RANGE_LABELS: Record<Range, string> = {
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
};

function rangeBounds(range: Range): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let start: Date;
  switch (range) {
    case "hoy":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case "7d":
      start = new Date(end.getTime() - 6 * 86_400_000);
      start.setHours(0, 0, 0, 0);
      break;
    case "mes":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    default:
      start = new Date(end.getTime() - 29 * 86_400_000);
      start.setHours(0, 0, 0, 0);
  }
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  return { start, end, prevStart, prevEnd };
}

export type Kpis = {
  revenue: number; revenuePrev: number; revenueChange: number | null;
  completedAppointments: number; completedPrev: number; completedChange: number | null;
  todayAppointments: number;
  pendingToday: number;
  avgTicket: number; avgTicketPrev: number; avgTicketChange: number | null;
  newCustomers: number; newCustomersPrev: number; newCustomersChange: number | null;
  productRevenue: number; productRevenuePrev: number; productRevenueChange: number | null;
  serviceRevenue: number;
  occupancy: number | null;
};

export function computeKpis(
  appointments: Appointment[],
  sales: ServiceOrder[],
  customers: Customer[],
  employees: Employee[],
  range: Range
): Kpis {
  const { start, end, prevStart, prevEnd } = rangeBounds(range);

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t <= end.getTime();
  };
  const inPrev = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= prevStart.getTime() && t <= prevEnd.getTime();
  };

  const paidSales = sales.filter((s) => s.status === "paid");
  const salesCur = paidSales.filter((s) => inRange(s.created_at));
  const salesPrev = paidSales.filter((s) => inPrev(s.created_at));

  const revenue = salesCur.reduce((a, s) => a + s.total, 0);
  const revenuePrev = salesPrev.reduce((a, s) => a + s.total, 0);

  const apptCur = appointments.filter((a) => a.status === "completed" && inRange(a.starts_at));
  const apptPrev = appointments.filter((a) => a.status === "completed" && inPrev(a.starts_at));

  const avgTicket = salesCur.length ? revenue / salesCur.length : 0;
  const avgTicketPrev = salesPrev.length ? revenuePrev / salesPrev.length : 0;

  const newCus = customers.filter((c) => inRange(c.created_at));
  const newCusPrev = customers.filter((c) => inPrev(c.created_at));

  const productRevenue = salesCur.reduce(
    (a, s) => a + (s.kind === "producto" || s.kind === "mixto" ? s.total : 0),
    0
  );
  const productRevenuePrev = salesPrev.reduce(
    (a, s) => a + (s.kind === "producto" || s.kind === "mixto" ? s.total : 0),
    0
  );

  /* Ocupación: horas agendadas confirmadas+en curso+completadas / capacidad 8h × profesionales × días */
  const active = appointments.filter(
    (a) => (a.status === "confirmed" || a.status === "arrived" || a.status === "in_service" || a.status === "completed") && inRange(a.starts_at)
  );
  let scheduledHours = 0;
  for (const a of active) {
    const dur = (new Date(a.ends_at ?? a.starts_at).getTime() - new Date(a.starts_at).getTime()) / 3_600_000;
    scheduledHours += Math.max(0.25, Math.min(dur, 6));
  }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const capacity = 8 * employees.length * days * (5 / 7);
  const occupancy = employees.length ? Math.min(100, (scheduledHours / capacity) * 100) : 0;

  const todayKey = bogotaDayKey(new Date());
  const todayAppointments = appointments.filter((a) => bogotaDayKey(new Date(a.starts_at)) === todayKey);
  const pendingToday = todayAppointments.filter(
    (a) => a.status === "reserved" || a.status === "scheduled"
  ).length;

  return {
    revenue,
    revenuePrev,
    revenueChange: pctChange(revenue, revenuePrev),
    completedAppointments: apptCur.length,
    completedPrev: apptPrev.length,
    completedChange: pctChange(apptCur.length, apptPrev.length),
    todayAppointments: todayAppointments.length,
    pendingToday,
    avgTicket,
    avgTicketPrev,
    avgTicketChange: pctChange(avgTicket, avgTicketPrev),
    newCustomers: newCus.length,
    newCustomersPrev: newCusPrev.length,
    newCustomersChange: pctChange(newCus.length, newCusPrev.length),
    productRevenue,
    productRevenuePrev,
    productRevenueChange: pctChange(productRevenue, productRevenuePrev),
    serviceRevenue: revenue - productRevenue,
    occupancy,
  };
}

/* Serie de ingresos y citas por día para N días */
export type DayPoint = { day: string; label: string; revenue: number; citas: number };

export function revenueSeries(sales: ServiceOrder[], appointments: Appointment[], days: number): DayPoint[] {
  const paid = sales.filter((s) => s.status === "paid");
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = bogotaDayKey(d);
    const revenue = paid
      .filter((s) => bogotaDayKey(new Date(s.created_at)) === key)
      .reduce((a, s) => a + s.total, 0);
    const citas = appointments.filter(
      (a) => a.status === "completed" && bogotaDayKey(new Date(a.starts_at)) === key
    ).length;
    out.push({
      day: key,
      label: d.toLocaleDateString("es-CO", { day: "numeric", month: "short" }),
      revenue,
      citas,
    });
  }
  return out;
}

/* Citas próximas (hoy en adelante) */
export function upcomingAppointments(appointments: Appointment[], limit = 6): Appointment[] {
  const nowIso = new Date().toISOString();
  return appointments
    .filter((a) => a.starts_at >= nowIso && (a.status === "confirmed" || a.status === "reserved" || a.status === "scheduled"))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, limit);
}

/* Alertas del dashboard derivadas de datos */
export type DashboardAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  module: ModuleKey | string;
};

export function dashboardAlerts(
  products: Product[],
  appointments: Appointment[],
  notifications: AppNotification[],
  plan: Plan | null,
  usage: { professionals: number; branches: number; monthlyAppointments: number }
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  const low = products.filter((p) => p.active && p.stock <= p.minimum_stock);
  if (low.length > 0) {
    alerts.push({
      id: "alert-stock",
      severity: low.some((p) => p.stock === 0) ? "critical" : "warning",
      title: `Inventario bajo: ${low.length} producto(s)`,
      body: low.slice(0, 3).map((p) => p.name).join(", ") + (low.length > 3 ? " y más." : "."),
      module: "inventario",
    });
  }

  const todayKey = bogotaDayKey(new Date());
  const pendientes = appointments.filter(
    (a) =>
      (a.status === "reserved" || a.status === "scheduled") &&
      bogotaDayKey(new Date(a.starts_at)) === todayKey
  );
  if (pendientes.length > 0) {
    alerts.push({
      id: "alert-citas",
      severity: "info",
      title: `${pendientes.length} citas por confirmar hoy`,
      body: "Confírmalas desde la agenda para asegurar la disponibilidad de los profesionales.",
      module: "agenda",
    });
  }

  if (plan) {
    for (const check of planChecks(resolvePlanLimits(plan), usage)) {
      if (!check.ok) {
        alerts.push({
          id: `alert-plan-${check.label}`,
          severity: "critical",
          title: `Límite del plan superado: ${check.label}`,
          body: `Estás en ${check.used} de ${check.limit === -1 ? "ilimitado" : check.limit} ${check.unit}. Mejora de plan recomendada.`,
          module: "configuracion",
        });
      } else if (check.warn) {
        alerts.push({
          id: `alert-plan-${check.label}`,
          severity: "warning",
          title: `Plan al ${Math.round((check.used / check.limit) * 100)}%: ${check.label}`,
          body: `Has usado ${check.used} de ${check.limit} ${check.unit} incluidos en tu plan.`,
          module: "configuracion",
        });
      }
    }
  }

  for (const n of notifications.filter((n) => n.severity !== "info").slice(0, 2)) {
    if (alerts.some((a) => a.title === n.title)) continue;
    alerts.push({
      id: `alert-ntf-${n.id}`,
      severity: n.severity === "critical" ? "critical" : "warning",
      title: n.title,
      body: n.body,
      module: n.module_key,
    });
  }

  return alerts.slice(0, 5);
}

/* Uso del plan actual */
export function planUsage(
  employees: Employee[],
  branches: { active: boolean }[],
  appointments: Appointment[]
): { professionals: number; branches: number; monthlyAppointments: number } {
  const monthKey = bogotaMonthKey(new Date());
  return {
    professionals: employees.filter((e) => e.active).length,
    branches: branches.filter((b) => b.active).length,
    monthlyAppointments: appointments.filter(
      (a) => bogotaMonthKey(new Date(a.starts_at)) === monthKey
    ).length,
  };
}

/* Top servicios por ingresos (usa service_order_items) */
export async function fetchSaleItems(orderIds: string[]): Promise<{ sale_id: string; kind: string; ref_id: string | null; name: string; qty: number; total: number }[]> {
  if (orderIds.length === 0) return [];
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("service_order_items").select("*").in("order_id", orderIds);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown) as ServiceOrderItem[];
  return rows.map((it) => ({
    sale_id: it.order_id,
    kind: it.service_id ? "service" : "product",
    ref_id: it.service_id ?? it.product_id ?? null,
    name: it.description,
    qty: it.quantity,
    total: it.quantity * it.unit_price - (it.discount ?? 0),
  }));
}

export type TopServiceRow = { name: string; revenue: number; count: number };

export async function topServices(
  organizationId: string,
  services: Service[],
  days = 30,
  limit = 6
): Promise<TopServiceRow[]> {
  const sales = await fetchSales(organizationId, days);
  const paidIds = sales.filter((s) => s.status === "paid").map((s) => s.id);
  const items = await fetchSaleItems(paidIds);
  const svcIds = new Set(services.map((s) => s.id));
  const byService = new Map<string, TopServiceRow>();
  for (const it of items) {
    if (it.kind !== "service" || !it.ref_id || !svcIds.has(it.ref_id)) continue;
    const svc = services.find((s) => s.id === it.ref_id);
    const key = it.ref_id;
    const prev = byService.get(key) ?? { name: svc?.name ?? it.name, revenue: 0, count: 0 };
    prev.revenue += it.total;
    prev.count += it.qty;
    byService.set(key, prev);
  }
  return [...byService.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/* ————— Venta directa (sin agenda) —————
   Servicios a clientes sin cita y/o productos del negocio, asociados a la
   caja del día y con descuento de inventario.
   1) Intenta la RPC vellora_create_sale (SQL v17): ATÓMICA — orden, líneas,
      pago, movimiento de caja y descuento de inventario en una transacción,
      con validación de membresía y de stock en la BD.
   2) Si la RPC no está aplicada (o modo demo), registra paso a paso igual
      que el resto de módulos. En ambos casos devuelve warnings no fatales. */

export type SaleLineInput = {
  kind: "servicio" | "producto";
  service_id?: string | null;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  commission_percent?: number;
};

export type CreateSaleInput = {
  organizationId: string;
  lines: SaleLineInput[];
  /** Cliente existente (opcional). */
  customerId?: string | null;
  /** Cliente sin agenda: si no existe con ese nombre se crea; vacío = ocasional. */
  customerName?: string | null;
  employeeId?: string | null;
  branchId?: string | null;
  paymentMethod: string;
  /** true = queda pagada + pago + movimiento de caja; false = abierta para cobrar en Caja. */
  collectNow: boolean;
  discount?: number;
  /** Caja abierta del día: el cobro en efectivo entra al arqueo (cash_movements). */
  cashRegisterId?: string | null;
  notes?: string | null;
};

export type CreateSaleResult = {
  order_id: string;
  total: number;
  status: string;
  customer_id: string | null;
  customer_created: boolean;
  payment_id: string | null;
  cash_movement_id: string | null;
  stock_updated: number;
  warnings: string;
};

export async function createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  const sb = supabaseBrowser();
  const params = {
    p_organization_id: input.organizationId,
    p_items: input.lines.map((l) => ({
      kind: l.kind,
      service_id: l.service_id ?? null,
      product_id: l.product_id ?? null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount: l.discount ?? 0,
      commission_percent: l.commission_percent ?? null,
    })),
    p_customer_id: input.customerId ?? null,
    p_customer_name: input.customerName ?? null,
    p_employee_id: input.employeeId ?? null,
    p_branch_id: input.branchId ?? null,
    p_payment_method: input.paymentMethod,
    p_collect_now: input.collectNow,
    p_discount: input.discount ?? 0,
    p_cash_register_id: input.cashRegisterId ?? null,
    p_notes: input.notes ?? null,
  };
  try {
    const { data, error } = await sb.rpc("vellora_create_sale", params);
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as CreateSaleResult | null;
      if (row && typeof row.order_id === "string" && row.order_id) return row;
      /* data vacía u otra forma → fallback */
    }
  } catch {
    /* sin RPC → fallback paso a paso */
  }
  return createSaleStepByStep(input);
}

/** Fallback sin RPC: mismo resultado, registro paso a paso desde el cliente. */
async function createSaleStepByStep(input: CreateSaleInput): Promise<CreateSaleResult> {
  const sb = supabaseBrowser();
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (warnings.length === 0) warnings.push(msg);
  };

  if (input.lines.length === 0) throw new Error("La venta debe tener al menos un ítem (servicio o producto)");

  const subtotal = input.lines.reduce((a, l) => a + l.quantity * l.unit_price - (l.discount ?? 0), 0);
  const discount = Math.min(Math.max(input.discount ?? 0, 0), subtotal);
  const total = Math.round((subtotal - discount) * 100) / 100;
  if (total <= 0) throw new Error("El total de la venta debe ser mayor a cero");

  /* Cliente: existente, buscado por nombre o creado */
  let customerId = input.customerId ?? null;
  let customerCreated = false;
  const custName = (input.customerName ?? "").trim();
  if (!customerId && custName) {
    const { data: cus, error: cusErr } = await sb
      .from("customers")
      .select("id,full_name")
      .eq("organization_id", input.organizationId);
    if (cusErr) throw new Error(`No fue posible verificar los clientes: ${cusErr.message}`);
    const match = ((cus ?? []) as { id: string; full_name: string }[]).find(
      (c) => (c.full_name ?? "").trim().toLowerCase() === custName.toLowerCase()
    );
    if (match) {
      customerId = match.id;
    } else {
      const { data: created, error: insErr } = await sb
        .from("customers")
        .insert({ organization_id: input.organizationId, full_name: custName })
        .select("id")
        .single();
      if (insErr || !created) {
        throw new Error(`No fue posible registrar al cliente: ${insErr?.message ?? "respuesta vacía"}`);
      }
      customerId = (created as { id: string }).id;
      customerCreated = true;
    }
  }

  /* Stock real en BD (por si cambió desde que se abrió el formulario) */
  const productLines = input.lines.filter((l) => l.kind === "producto" && l.product_id);
  const needed = new Map<string, number>();
  for (const l of productLines) needed.set(l.product_id as string, (needed.get(l.product_id as string) ?? 0) + l.quantity);
  const stockById = new Map<string, { stock: number; cost: number }>();
  const productIds = [...needed.keys()];
  if (productIds.length) {
    const { data: prods, error: prodErr } = await sb
      .from("products")
      .select("id,stock,cost")
      .in("id", productIds)
      .eq("organization_id", input.organizationId);
    if (prodErr) throw new Error(`No fue posible verificar el inventario: ${prodErr.message}`);
    for (const p of ((prods ?? []) as unknown) as { id: string; stock: number; cost: number }[]) {
      stockById.set(p.id, { stock: Number(p.stock), cost: Number(p.cost) });
    }
  }
  for (const [pid, qty] of needed) {
    const info = stockById.get(pid);
    if (!info) throw new Error("Uno de los productos ya no existe en el inventario");
    if (info.stock < qty) {
      const nm = input.lines.find((l) => l.product_id === pid)?.description ?? pid;
      throw new Error(`Stock insuficiente de ${nm}: hay ${info.stock}, se piden ${qty}`);
    }
  }

  /* Orden de venta (sin cita: appointment_id null) */
  const { data: order, error: ordErr } = await sb
    .from("service_orders")
    .insert({
      organization_id: input.organizationId,
      branch_id: input.branchId ?? null,
      customer_id: customerId,
      employee_id: input.employeeId ?? null,
      appointment_id: null,
      status: input.collectNow ? "paid" : "open",
      subtotal,
      discount,
      tax: 0,
      total,
    })
    .select("id")
    .single();
  if (ordErr || !order) throw new Error(`No fue posible registrar la venta: ${ordErr?.message ?? "respuesta vacía"}`);
  const orderId = (order as { id: string }).id;

  /* Líneas de la venta */
  const { error: itemsErr } = await sb.from("service_order_items").insert(
    input.lines.map((l) => ({
      order_id: orderId,
      service_id: l.service_id ?? null,
      product_id: l.product_id ?? null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount: l.discount ?? 0,
      commission_percent: l.commission_percent ?? null,
    }))
  );
  if (itemsErr) warn(`La venta se registró pero fallaron las líneas: ${itemsErr.message}`);

  /* Pago + caja (solo si se cobra ahora) */
  let paymentId: string | null = null;
  let cashMovementId: string | null = null;
  if (input.collectNow) {
    const { data: pay, error: payErr } = await sb
      .from("payments")
      .insert({
        organization_id: input.organizationId,
        order_id: orderId,
        method: input.paymentMethod,
        amount: total,
        paid_at: new Date().toISOString(),
        reference: null,
      })
      .select("id")
      .single();
    if (payErr || !pay) {
      warn(`La venta se registró pero falló el registro del pago: ${payErr?.message ?? "respuesta vacía"}`);
    } else {
      paymentId = (pay as { id: string }).id;
      if (input.cashRegisterId) {
        const { data: mov, error: movErr } = await sb
          .from("cash_movements")
          .insert({
            cash_register_id: input.cashRegisterId,
            organization_id: input.organizationId,
            type: "sale",
            method: input.paymentMethod,
            amount: total,
            description: `Venta directa · ${customerId ? custName || "cliente" : "cliente ocasional"}`,
            payment_id: paymentId,
          })
          .select("id")
          .single();
        if (movErr || !mov) warn(`La venta se registró pero falló el movimiento de caja: ${movErr?.message ?? "respuesta vacía"}`);
        else cashMovementId = (mov as { id: string }).id;
      } else if (input.paymentMethod === "efectivo") {
        warn("No hay caja abierta: el cobro en efectivo no quedó asociado a un arqueo.");
      }
    }
  }

  /* Inventario: movimiento de salida + descuento de stock por producto */
  let stockUpdated = 0;
  for (const [pid, qty] of needed) {
    const info = stockById.get(pid);
    const { error: movErr } = await sb.from("inventory_movements").insert({
      organization_id: input.organizationId,
      product_id: pid,
      movement_type: "venta",
      quantity: qty,
      unit_cost: info?.cost ?? 0,
      reference: `Venta directa ${orderId}`,
    });
    if (movErr) warn(`Venta registrada, pero sin movimiento de inventario: ${movErr.message}`);
    const { error: upErr } = await sb
      .from("products")
      .update({ stock: Math.max(0, Number(info?.stock ?? 0) - qty) })
      .eq("id", pid);
    if (upErr) warn(`Venta registrada, pero falló el descuento de stock: ${upErr.message}`);
    else stockUpdated += 1;
  }

  return {
    order_id: orderId,
    total,
    status: input.collectNow ? "paid" : "open",
    customer_id: customerId,
    customer_created: customerCreated,
    payment_id: paymentId,
    cash_movement_id: cashMovementId,
    stock_updated: stockUpdated,
    warnings: warnings.join(" · "),
  };
}
