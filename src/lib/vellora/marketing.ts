/* VelloRa ERP — Motor de marketing y crecimiento.
   Funciones puras: índice de clientes, segmentación combinable, atribución de
   ingresos por campaña y evaluación de automatizaciones. La vista consume esto. */

import { bogotaDayKey } from "./format";

/* ————— Tipos ————— */

export type MktCampaignType = "promocional" | "adquisicion" | "especial" | "servicios" | "paquetes";
export type MktStatus = "draft" | "scheduled" | "active" | "paused" | "completed" | "cancelled";
export type MktChannel = "whatsapp" | "email" | "sms" | "instagram" | "facebook" | "tarea";
export type MktAutomationEvent =
  | "cumpleanos_3dias" | "inactivo_30" | "primera_compra" | "post_cita" | "sin_proxima_cita"
  | "visitas_5" | "referida_amiga" | "paquete_comprado" | "cita_proxima" | "baja_demanda";

export type MktCampaign = {
  id: string;
  organization_id: string;
  name: string;
  channel: string;
  objective: string | null;
  description: string | null;
  content: string | null;
  status: MktStatus;
  budget: number;
  starts_on: string | null;
  ends_on: string | null;
  campaign_type: MktCampaignType;
  promo_code: string | null;
  discount_percent: number;
  max_uses: number;
  uses_count: number;
  service_ids: string[];
  segment_id: string | null;
  conditions: string | null;
  image_url: string | null;
  created_at: string;
};

export type MktFilters = {
  preset?: string;
  days?: number; // ventana usada por presets (inactivos, cumpleaños)
  minVisits?: number;
  windowDays?: number;
  maxDaysSinceVisit?: number;
  minTotalSpend?: number;
  serviceId?: string;
  hasWhatsApp?: boolean;
  hasEmail?: boolean;
  birthdayInDays?: number;
  newOnly?: boolean;
};

export type MktSegment = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  filters: MktFilters;
  is_preset: boolean;
  created_at: string;
};

export type MktMessage = {
  id: string;
  campaign_id: string | null;
  automation_id: string | null;
  customer_id: string;
  channel: MktChannel;
  subject: string | null;
  body: string;
  status: "pendiente" | "enviado" | "fallido";
  sent_at: string | null;
  created_at: string;
};

export type MktAutomation = {
  id: string;
  organization_id: string;
  name: string;
  event: MktAutomationEvent;
  action_channel: MktChannel;
  template: string;
  max_per_days: number;
  active: boolean;
  last_run_at: string | null;
};

export type MktCommercialDate = {
  id: string;
  month: number;
  day: number | null;
  name: string;
  description: string | null;
  active: boolean;
};

export const EVENT_META: Record<MktAutomationEvent, { label: string; once: boolean }> = {
  cumpleanos_3dias: { label: "Cliente cumple años en 3 días", once: false },
  inactivo_30: { label: "Cliente lleva 30 días sin visitar", once: false },
  primera_compra: { label: "Cliente realiza su primera compra", once: true },
  post_cita: { label: "Cliente termina una cita (ayer)", once: false },
  sin_proxima_cita: { label: "Cliente visitó pero no tiene próxima cita", once: false },
  visitas_5: { label: "Cliente completa 5 visitas", once: true },
  referida_amiga: { label: "Cliente recomienda una amiga", once: true },
  paquete_comprado: { label: "Cliente compra un paquete", once: true },
  cita_proxima: { label: "Cliente tiene una cita en los próximos 2 días", once: false },
  baja_demanda: { label: "Servicio tiene baja demanda (sugerencia)", once: false },
};

export const TYPE_META: Record<MktCampaignType, string> = {
  promocional: "Promocional (descuentos)",
  adquisicion: "Adquisición (trae una amiga)",
  especial: "Especial (cumpleaños, Navidad…)",
  servicios: "De servicios (impulsar catálogo)",
  paquetes: "De paquetes (combos)",
};

export const STATUS_META: Record<MktStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: "Borrador", bg: "#f3f0fa", fg: "#7556d8" },
  scheduled: { label: "Programada", bg: "#e8f1fd", fg: "#2563c4" },
  active: { label: "Activa", bg: "#e8f8f0", fg: "#238a66" },
  paused: { label: "Pausada", bg: "#fff8e8", fg: "#a87514" },
  completed: { label: "Finalizada", bg: "#f0eef5", fg: "#5e5a70" },
  cancelled: { label: "Cancelada", bg: "#fff0f2", fg: "#ca435c" },
};

/* ————— Planes: funcionalidades progresivas ————— */

export const PLAN_RANK: Record<string, number> = { esencial: 0, profesional: 1, elite: 2 };
export type PlanTier = keyof typeof PLAN_RANK | "esencial";

export function planAtLeast(planKey: string | null | undefined, min: "esencial" | "profesional" | "elite"): boolean {
  const rank = PLAN_RANK[String(planKey ?? "").toLowerCase()];
  return (rank ?? 2) >= PLAN_RANK[min];
}

/* ————— Índice de clientes ————— */

export type RawCustomer = {
  id: string; full_name: string; phone: string | null; whatsapp: string | null; email: string | null;
  birth_date: string | null; active: boolean; marketing_consent: boolean; created_at: string;
};
export type RawOrder = { id: string; customer_id: string | null; created_at: string; total: number };
export type RawItem = { order_id: string; service_id: string | null };
export type RawAppt = { customer_id: string | null; starts_at: string };

export type CustStats = {
  id: string;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  birth_date: string | null;
  active: boolean;
  marketing_consent: boolean;
  created_at: string;
  visitDays: string[]; // claves "YYYY-MM-DD" ordenadas ascendente
  firstVisit: string | null;
  lastVisit: string | null;
  totalSpend: number;
  orderCount: number;
  ticket: number;
  serviceIds: string[];
};

export function buildCustomerIndex(
  customers: RawCustomer[],
  orders: RawOrder[],
  items: RawItem[],
  appts: RawAppt[]
): Map<string, CustStats> {
  const paidById = new Map(orders.map((o) => [o.id, o]));
  const m = new Map<string, CustStats>();
  for (const c of customers) {
    m.set(c.id, {
      ...c,
      visitDays: [], firstVisit: null, lastVisit: null,
      totalSpend: 0, orderCount: 0, ticket: 0, serviceIds: [],
    });
  }
  const svcByCustomer = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.service_id) continue;
    const o = paidById.get(it.order_id);
    if (!o || !o.customer_id) continue;
    let s = svcByCustomer.get(o.customer_id);
    if (!s) { s = new Set(); svcByCustomer.set(o.customer_id, s); }
    s.add(it.service_id);
  }
  for (const o of orders) {
    if (!o.customer_id) continue;
    const row = m.get(o.customer_id);
    if (!row) continue;
    row.totalSpend += Number(o.total ?? 0);
    row.orderCount += 1;
    row.visitDays.push(bogotaDayKey(new Date(o.created_at)));
  }
  for (const a of appts) {
    if (!a.customer_id) continue;
    const row = m.get(a.customer_id);
    if (!row) continue;
    row.visitDays.push(bogotaDayKey(new Date(a.starts_at)));
  }
  for (const row of m.values()) {
    row.visitDays = [...new Set(row.visitDays)].sort();
    row.firstVisit = row.visitDays[0] ?? null;
    row.lastVisit = row.visitDays[row.visitDays.length - 1] ?? null;
    row.ticket = row.orderCount > 0 ? row.totalSpend / row.orderCount : 0;
    row.serviceIds = [...(svcByCustomer.get(row.id) ?? [])];
  }
  return m;
}

/* ————— Utilidades de fechas ————— */

export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / 86400000);
}

export function nextBirthdayDays(birth: string | null, now: Date): number | null {
  if (!birth) return null;
  const mo = Number(birth.slice(5, 7));
  const d = Number(birth.slice(8, 10));
  if (!mo || !d) return null;
  const y = now.getFullYear();
  const today = new Date(y, now.getMonth(), now.getDate());
  let next = new Date(y, mo - 1, d);
  if (next.getTime() < today.getTime()) next = new Date(y + 1, mo - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/** Normaliza un teléfono colombiano a formato wa.me (57…). */
export function waPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.startsWith("57") && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

/* ————— Segmentación ————— */

export type SegmentMatch = { c: CustStats; why: string };

export function evalSegment(filters: MktFilters, index: Map<string, CustStats>, now: Date): SegmentMatch[] {
  const all = [...index.values()].filter((c) => c.active);
  const spends = all.map((c) => c.totalSpend).filter((v) => v > 0).sort((a, b) => a - b);
  const tickets = all.map((c) => c.ticket).filter((v) => v > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

  const preset = filters.preset ?? "";
  const out: SegmentMatch[] = [];

  for (const c of all) {
    let ok = true;
    let why = "";
    const dSince = daysSince(c.lastVisit, now);

    if (preset === "vip") {
      ok = c.totalSpend > 0 && c.totalSpend >= pct(spends, 0.9);
      why = "Top 10% por consumo histórico";
    } else if (preset === "nuevos") {
      const dFirst = daysSince(c.firstVisit, now);
      ok = c.orderCount >= 1 && dFirst !== null && dFirst <= 30;
      why = "Primera compra en los últimos 30 días";
    } else if (preset === "frecuentes") {
      const win = filters.windowDays ?? 60;
      const min = filters.minVisits ?? 4;
      const recent = c.visitDays.filter((k) => daysSince(`${k}T00:00:00`, now) !== null && (daysSince(`${k}T00:00:00`, now) ?? 999) <= win);
      ok = recent.length >= min;
      why = `${recent.length} visitas en ${win} días`;
    } else if (preset === "inactivos") {
      const d = filters.days ?? 45;
      ok = dSince !== null && dSince >= d;
      why = dSince !== null ? `Última visita hace ${dSince} días` : "Sin visitas";
    } else if (preset === "potenciales") {
      ok = c.orderCount === 0;
      why = "Registrado y sin compras todavía";
    } else if (preset === "alto_valor") {
      ok = c.totalSpend >= pct(spends, 0.75) && c.orderCount >= 2;
      why = `Gasto acumulado alto (${c.orderCount} compras)`;
    } else if (preset === "bajo_consumo") {
      ok = c.orderCount >= 1 && c.ticket <= pct(tickets, 0.5);
      why = `Ticket promedio bajo`;
    } else if (preset === "cumpleanos") {
      const d = nextBirthdayDays(c.birth_date, now);
      ok = d !== null && d <= (filters.days ?? 30);
      why = d !== null ? `Cumple en ${d} días` : "";
    }

    if (!ok) continue;

    // Filtros combinables adicionales (para presets y segmentos personalizados)
    if (filters.preset && filters.maxDaysSinceVisit !== undefined) {
      if (dSince === null || dSince > filters.maxDaysSinceVisit) continue;
    }
    if (filters.preset && filters.minVisits !== undefined && preset !== "frecuentes") {
      if (c.visitDays.length < filters.minVisits) continue;
    }
    if (filters.minVisits !== undefined && !filters.preset) {
      if (c.visitDays.length < filters.minVisits) continue;
    }
    if (filters.maxDaysSinceVisit !== undefined && !filters.preset) {
      if (dSince === null || dSince > filters.maxDaysSinceVisit) continue;
    }
    if (filters.minTotalSpend !== undefined && c.totalSpend < filters.minTotalSpend) continue;
    if (filters.serviceId && !c.serviceIds.includes(filters.serviceId)) continue;
    if (filters.hasWhatsApp && !waPhone(c.whatsapp ?? c.phone)) continue;
    if (filters.hasEmail && !c.email) continue;
    if (filters.birthdayInDays !== undefined) {
      const d = nextBirthdayDays(c.birth_date, now);
      if (d === null || d > filters.birthdayInDays) continue;
    }
    if (filters.newOnly) {
      const dFirst = daysSince(c.firstVisit, now);
      if (!(c.orderCount >= 1 && dFirst !== null && dFirst <= 30)) continue;
    }
    out.push({ c, why });
  }
  return out.sort((a, b) => b.c.totalSpend - a.c.totalSpend);
}

/* ————— Atribución de ingresos por campaña ————— */

export type Attribution = { sent: number; buyers: number; orders: number; revenue: number };

/** Ingresos atribuibles: órdenes pagadas de clientes contactados, hechas entre el
    envío del mensaje y los siguientes `windowDays` días. */
export function attributeCampaign(
  campaignId: string,
  messages: MktMessage[],
  orders: RawOrder[],
  windowDays = 30
): Attribution {
  const firstByCustomer = new Map<string, Date>();
  for (const msg of messages) {
    if (msg.campaign_id !== campaignId || msg.status !== "enviado" || !msg.sent_at) continue;
    const t = new Date(msg.sent_at);
    const prev = firstByCustomer.get(msg.customer_id);
    if (!prev || t < prev) firstByCustomer.set(msg.customer_id, t);
  }
  let buyers = 0;
  let revenue = 0;
  let ordersCount = 0;
  for (const [cid, sentAt] of firstByCustomer) {
    const until = sentAt.getTime() + windowDays * 86400000;
    let bought = false;
    for (const o of orders) {
      if (o.customer_id !== cid) continue;
      const t = new Date(o.created_at).getTime();
      if (t >= sentAt.getTime() && t <= until) {
        bought = true;
        revenue += Number(o.total ?? 0);
        ordersCount += 1;
      }
    }
    if (bought) buyers += 1;
  }
  return { sent: firstByCustomer.size, buyers, orders: ordersCount, revenue };
}

/* ————— Personalización de plantillas ————— */

export function personalize(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/* ————— Evaluación de automatizaciones ————— */

export type AutomationRunInput = {
  now: Date;
  orgName: string;
  referrals?: { referrer_id: string; referred_id: string }[];
  futureAppts?: RawAppt[];
  completedApptsYesterday?: RawAppt[];
  lowDemandServiceNames?: string[];
};

export type AutomationRunResult = {
  outputs: { customer_id: string; body: string }[];
  suggestion: string | null;
  skipped: number;
};

export function runAutomation(
  a: MktAutomation,
  index: Map<string, CustStats>,
  input: AutomationRunInput,
  existingMessages: MktMessage[]
): AutomationRunResult {
  const outputs: { customer_id: string; body: string }[] = [];
  const meta = EVENT_META[a.event];
  const now = input.now;
  let skipped = 0;

  const contactedRecently = new Set<string>();
  const contactedEver = new Set<string>();
  for (const msg of existingMessages) {
    if (msg.automation_id !== a.id || msg.status === "fallido") continue;
    contactedEver.add(msg.customer_id);
    if (msg.created_at && now.getTime() - new Date(msg.created_at).getTime() < a.max_per_days * 86400000) {
      contactedRecently.add(msg.customer_id);
    }
  }

  const push = (c: CustStats) => {
    if (meta.once ? contactedEver.has(c.id) : contactedRecently.has(c.id)) { skipped += 1; return; }
    const body = personalize(a.template, { nombre: firstName(c.full_name), salon: input.orgName });
    outputs.push({ customer_id: c.id, body });
  };

  const futureIds = new Set((input.futureAppts ?? []).map((x) => x.customer_id).filter(Boolean) as string[]);
  const completedYesterdayIds = new Set(
    (input.completedApptsYesterday ?? []).map((x) => x.customer_id).filter(Boolean) as string[]
  );

  for (const c of index.values()) {
    if (!c.active) continue;
    const dSince = daysSince(c.lastVisit, now);
    const dFirst = daysSince(c.firstVisit, now);

    switch (a.event) {
      case "cumpleanos_3dias": {
        const d = nextBirthdayDays(c.birth_date, now);
        if (d !== null && d <= 3) push(c);
        break;
      }
      case "inactivo_30": {
        if (dSince !== null && dSince >= 30) push(c);
        break;
      }
      case "primera_compra": {
        if (c.orderCount >= 1 && dFirst !== null && dFirst <= 7) push(c);
        break;
      }
      case "post_cita": {
        if (completedYesterdayIds.has(c.id)) push(c);
        break;
      }
      case "sin_proxima_cita": {
        if (dSince !== null && dSince <= 30 && !futureIds.has(c.id)) push(c);
        break;
      }
      case "visitas_5": {
        if (c.visitDays.length >= 5) push(c);
        break;
      }
      case "referida_amiga": {
        if ((input.referrals ?? []).some((r) => r.referrer_id === c.id)) push(c);
        break;
      }
      case "cita_proxima": {
        const soon = (input.futureAppts ?? []).some((x) => {
          if (x.customer_id !== c.id) return false;
          const diff = (new Date(x.starts_at).getTime() - now.getTime()) / 86400000;
          return diff >= 0 && diff <= 2;
        });
        if (soon) push(c);
        break;
      }
      case "paquete_comprado":
      case "baja_demanda":
        // paquetes: aún sin módulo de paquetes; baja_demanda se resuelve como sugerencia.
        break;
    }
  }

  let suggestion: string | null = null;
  if (a.event === "baja_demanda") {
    const names = input.lowDemandServiceNames ?? [];
    suggestion = names.length > 0
      ? `Servicios con baja demanda en los últimos 60 días: ${names.slice(0, 6).join(", ")}. Sugerencia: crea una campaña tipo "De servicios" dirigida al segmento "Clientes inactivos" o "Clientes frecuentes".`
      : "Todos los servicios registraron ventas en los últimos 60 días. No hay sugerencias por baja demanda.";
  }

  return { outputs, suggestion, skipped };
}
