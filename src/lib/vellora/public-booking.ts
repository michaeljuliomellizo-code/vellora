/* VelloRa ERP — Motor de reservas públicas (página /r/[slug]).
   Dos motores detrás de una misma interfaz:
   · Real (Supabase)  → llama las RPC SECURITY DEFINER de reservas_online_v2.sql
     (el público nunca lee tablas directamente).
   · Demo (sin credenciales) → replica la misma lógica en memoria sobre demoDb(),
     de modo que una reserva creada en la página aparece al instante en el módulo. */
import type { BookingHours, Customer } from "./types";
import { supabaseBrowser, IS_DEMO } from "./supabase";
import { demoDb } from "./demo-client";

export const DEFAULT_BUSINESS_HOURS: Record<string, BookingHours> = {
  "1": { open: "09:00", close: "19:00", closed: false },
  "2": { open: "09:00", close: "19:00", closed: false },
  "3": { open: "09:00", close: "19:00", closed: false },
  "4": { open: "09:00", close: "19:00", closed: false },
  "5": { open: "09:00", close: "20:00", closed: false },
  "6": { open: "09:00", close: "20:00", closed: false },
  "7": { open: "10:00", close: "17:00", closed: true },
};

export const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
/* 1=lunes … 7=domingo (ISO) */
export const DAY_LABELS: Record<string, string> = {
  "1": "Lunes", "2": "Martes", "3": "Miércoles", "4": "Jueves",
  "5": "Viernes", "6": "Sábado", "7": "Domingo",
};

export function normalizeHours(raw: Record<string, BookingHours> | null | undefined): Record<string, BookingHours> {
  const out: Record<string, BookingHours> = {};
  for (const k of DAY_KEYS) {
    const h = raw?.[k];
    out[k] = {
      open: typeof h?.open === "string" ? h.open : "09:00",
      close: typeof h?.close === "string" ? h.close : "19:00",
      closed: Boolean(h?.closed),
    };
  }
  return out;
}

/* Clave de día local (YYYY-MM-DD) */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* isodow de una clave YYYY-MM-DD: 1=lunes … 7=domingo */
export function isoDow(dateKey: string): number {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.getDay() === 0 ? 7 : d.getDay();
}

export type PublicSettings = {
  public_name: string;
  description: string | null;
  contact_phone: string | null;
  enabled: boolean;
  notice_hours: number;
  horizon_days: number;
  auto_confirm: boolean;
  slot_minutes: number;
  cancellation_hours: number;
  business_hours: Record<string, BookingHours>;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  category: string;
};

export type PublicEmployee = {
  id: string;
  full_name: string;
  position: string | null;
  specialties: string | null;
};

export type PublicBookingData = {
  ok: boolean;
  message?: string;
  settings: PublicSettings | null;
  services: PublicService[];
  employees: PublicEmployee[];
};

export type Slot = { time: string; employee_id: string | null };

export type CreateBookingPayload = {
  slug: string;
  service_id: string;
  employee_id: string | null;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  consent: boolean;
};

export type BookingResult = {
  ok: boolean;
  message?: string;
  booking_code?: string;
  status?: string;
  auto_confirm?: boolean;
};

/* ————————————————————————————— Motor REAL (RPC) ————————————————————————— */

async function realLoadData(slug: string): Promise<PublicBookingData> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("public_booking_data", { p_slug: slug });
  if (error) {
    /* FIX: si las RPC de reservas públicas no existen en la BD (se crean con
       vellora-sql-v10-reservas-publicas.sql), PostgREST responde PGRST202
       "Could not find the function ... in the schema cache". Mostramos una
       guía clara en lugar del error técnico. */
    const code = (error as { code?: string }).code ?? "";
    if (code === "PGRST202" || code === "404" || /could not find the function/i.test(error.message)) {
      return {
        ok: false,
        message: "Las funciones de reservas públicas no están creadas en la base de datos. Ejecuta el script vellora-sql-v10-reservas-publicas.sql en Supabase (SQL Editor) y recarga esta página.",
        settings: null, services: [], employees: [],
      };
    }
    return { ok: false, message: error.message, settings: null, services: [], employees: [] };
  }
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!d || d.ok !== true) {
    return { ok: false, message: String(d?.message ?? "No encontramos esta página de reservas."), settings: null, services: [], employees: [] };
  }
  const s = d.settings as Record<string, unknown>;
  const settings: PublicSettings = {
    public_name: String(s.public_name ?? ""),
    description: (s.description as string | null) ?? null,
    contact_phone: (s.contact_phone as string | null) ?? null,
    enabled: Boolean(s.enabled),
    notice_hours: Number(s.notice_hours ?? 2),
    horizon_days: Number(s.horizon_days ?? 30),
    auto_confirm: Boolean(s.auto_confirm),
    slot_minutes: Number(s.slot_minutes ?? 30),
    cancellation_hours: Number(s.cancellation_hours ?? 4),
    business_hours: normalizeHours(s.business_hours as Record<string, BookingHours>),
  };
  return {
    ok: true,
    settings,
    services: (d.services as PublicService[]) ?? [],
    employees: (d.employees as PublicEmployee[]) ?? [],
  };
}

async function realLoadSlots(slug: string, serviceId: string, date: string, employeeId: string | null)
  : Promise<{ ok: boolean; message?: string; slots: Slot[] }> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("public_available_slots", {
    p_slug: slug, p_service_id: serviceId, p_date: date, p_employee_id: employeeId,
  });
  if (error) return { ok: false, message: error.message, slots: [] };
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!d || d.ok !== true) return { ok: false, message: d?.message ? String(d.message) : undefined, slots: [] };
  return { ok: true, slots: (d.slots as Slot[]) ?? [] };
}

async function realCreateBooking(p: CreateBookingPayload): Promise<BookingResult> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("public_create_booking", {
    p_slug: p.slug, p_service_id: p.service_id, p_employee_id: p.employee_id,
    p_date: p.date, p_time: p.time, p_name: p.name, p_phone: p.phone,
    p_email: p.email ?? null, p_notes: p.notes ?? null, p_consent: p.consent,
  });
  if (error) return { ok: false, message: error.message };
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!d || d.ok !== true) return { ok: false, message: String(d?.message ?? "No fue posible crear la reserva.") };
  return {
    ok: true,
    booking_code: String(d.booking_code ?? ""),
    status: String(d.status ?? "reserved"),
    auto_confirm: Boolean(d.auto_confirm),
  };
}

async function realCancelBooking(slug: string, code: string, phone: string): Promise<{ ok: boolean; message?: string }> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("public_cancel_booking", {
    p_slug: slug, p_code: code, p_phone: phone,
  });
  if (error) return { ok: false, message: error.message };
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return { ok: d?.ok === true, message: d?.message ? String(d.message) : undefined };
}

/* ————————————————————————————— Motor DEMO ———————————————————————————————— */

async function demoLoadData(slug: string): Promise<PublicBookingData> {
  const db = demoDb();
  const row = db.booking_settings.find((b) => b.slug === slug.toLowerCase().trim());
  if (!row) {
    return {
      ok: false,
      message: "No encontramos esta página de reservas. (Estás en modo demo, sin Supabase: la página de ejemplo es /r/bella-esencia.)",
      settings: null, services: [], employees: [],
    };
  }
  const catNames = new Map<string, string>();
  // El dataset demo no incluye service_categories; usar la etiqueta del servicio si existe
  const services: PublicService[] = db.services
    .filter((s) => s.organization_id === row.organization_id && s.active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      price: s.price,
      duration_minutes: s.duration_minutes,
      category: s.category ?? catNames.get(s.category_id ?? "") ?? "Otros",
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const employees: PublicEmployee[] = db.employees
    .filter((e) => e.organization_id === row.organization_id && e.active)
    .map((e) => ({ id: e.id, full_name: e.full_name, position: e.position ?? null, specialties: e.specialties ?? null }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const settings: PublicSettings = {
    public_name: row.public_name,
    description: row.description ?? null,
    contact_phone: row.contact_phone ?? null,
    enabled: row.enabled,
    notice_hours: row.notice_hours,
    horizon_days: row.horizon_days,
    auto_confirm: row.auto_confirm,
    slot_minutes: row.slot_minutes,
    cancellation_hours: row.cancellation_hours,
    business_hours: normalizeHours(row.business_hours),
  };
  return { ok: true, settings, services, employees };
}

/* Citas activas del profesional que chocan con [start, end) */
function conflictsAt(
  db: ReturnType<typeof import("./demo-client")["demoDb"]>,
  employeeId: string,
  start: Date,
  end: Date
): boolean {
  return db.appointments.some((a) => {
    if (a.employee_id !== employeeId) return false;
    if (a.status === "cancelled" || a.status === "no_show") return false;
    const s = new Date(a.starts_at);
    const e = a.ends_at ? new Date(a.ends_at) : new Date(s.getTime() + 60 * 60000);
    return s < end && e > start;
  });
}

async function demoLoadSlots(slug: string, serviceId: string, date: string, employeeId: string | null)
  : Promise<{ ok: boolean; message?: string; slots: Slot[] }> {
  const db = demoDb();
  const row = db.booking_settings.find((b) => b.slug === slug.toLowerCase().trim());
  if (!row) return { ok: false, message: "Página de reservas no encontrada.", slots: [] };
  if (!row.enabled) return { ok: false, message: "Las reservas en línea están desactivadas momentáneamente.", slots: [] };

  const today = dayKey(new Date());
  if (date < today || date > addDaysKey(today, Math.max(row.horizon_days, 1))) return { ok: true, slots: [] };

  const svc = db.services.find((s) => s.id === serviceId && s.organization_id === row.organization_id && s.active);
  if (!svc) return { ok: false, message: "El servicio ya no está disponible.", slots: [] };

  const hours = normalizeHours(row.business_hours)[String(isoDow(date))];
  if (!hours || hours.closed) return { ok: true, slots: [] };

  const step = Math.max(row.slot_minutes || 30, 5);
  const dur = Math.min(svc.duration_minutes || 60, 600);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const openM = toMin(hours.open);
  const closeM = toMin(hours.close);
  const minStart = new Date(Date.now() + Math.max(row.notice_hours, 0) * 3600000);
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const employees = db.employees.filter((e) => e.organization_id === row.organization_id && e.active);
  const slots: Slot[] = [];
  for (let m = openM; m + dur <= closeM; m += step) {
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = new Date(`${date}T${time}:00`);
    if (start < minStart) continue;
    const end = new Date(start.getTime() + dur * 60000);
    let chosen: string | null = null;
    if (employeeId) {
      const emp = employees.find((e) => e.id === employeeId);
      if (emp && !conflictsAt(db, emp.id, start, end)) chosen = emp.id;
    } else {
      const free = employees
        .filter((e) => !conflictsAt(db, e.id, start, end))
        .map((e) => ({
          id: e.id,
          load: db.appointments.filter((a) =>
            a.employee_id === e.id && a.status !== "cancelled" && a.status !== "no_show" &&
            new Date(a.starts_at) >= dayStart && new Date(a.starts_at) <= dayEnd
          ).length,
          name: e.full_name,
        }))
        .sort((a, b) => a.load - b.load || a.name.localeCompare(b.name));
      chosen = free[0]?.id ?? null;
    }
    if (chosen) slots.push({ time, employee_id: chosen });
  }
  return { ok: true, slots };
}

async function demoCreateBooking(p: CreateBookingPayload): Promise<BookingResult> {
  const db = demoDb();
  const row = db.booking_settings.find((b) => b.slug === p.slug.toLowerCase().trim());
  if (!row) return { ok: false, message: "Página de reservas no encontrada." };
  if (!row.enabled) return { ok: false, message: "Las reservas en línea están desactivadas momentáneamente." };
  if (!p.consent) return { ok: false, message: "Debes autorizar el contacto para confirmar tu cita." };
  if ((p.name ?? "").trim().length < 3) return { ok: false, message: "Escribe tu nombre completo." };
  if ((p.phone ?? "").replace(/\D/g, "").length < 7) return { ok: false, message: "Escribe un teléfono válido (ej. 300 123 4567)." };

  const svc = db.services.find((s) => s.id === p.service_id && s.organization_id === row.organization_id && s.active);
  if (!svc) return { ok: false, message: "El servicio ya no está disponible." };

  const today = dayKey(new Date());
  if (p.date < today || p.date > addDaysKey(today, Math.max(row.horizon_days, 1))) {
    return { ok: false, message: "La fecha queda fuera del horizonte de reservas." };
  }
  const start = new Date(`${p.date}T${p.time}:00`);
  const end = new Date(start.getTime() + (svc.duration_minutes || 60) * 60000);
  if (start.getTime() < Date.now() + Math.max(row.notice_hours, 0) * 3600000) {
    return { ok: false, message: `Debes reservar con al menos ${row.notice_hours} hora(s) de antelación.` };
  }
  const hours = normalizeHours(row.business_hours)[String(isoDow(p.date))];
  if (!hours || hours.closed) return { ok: false, message: "Ese día no atendemos. Elige otro día." };
  if (p.time < hours.open || end > new Date(`${p.date}T${hours.close}:00`)) {
    return { ok: false, message: "La hora escogida queda por fuera de nuestro horario de atención." };
  }

  let empId = p.employee_id;
  if (empId) {
    const emp = db.employees.find((e) => e.id === empId && e.organization_id === row.organization_id && e.active);
    if (!emp || conflictsAt(db, emp.id, start, end)) {
      return { ok: false, message: "Esa hora acaba de ocuparse con este profesional. Elige otra hora." };
    }
  } else {
    const dayStart = new Date(`${p.date}T00:00:00`);
    const dayEnd = new Date(`${p.date}T23:59:59`);
    const free = db.employees
      .filter((e) => e.organization_id === row.organization_id && e.active && !conflictsAt(db, e.id, start, end))
      .map((e) => ({
        id: e.id,
        load: db.appointments.filter((a) =>
          a.employee_id === e.id && a.status !== "cancelled" && a.status !== "no_show" &&
          new Date(a.starts_at) >= dayStart && new Date(a.starts_at) <= dayEnd
        ).length,
        name: e.full_name,
      }))
      .sort((a, b) => a.load - b.load || a.name.localeCompare(b.name));
    empId = free[0]?.id ?? null;
    if (!empId) return { ok: false, message: "Ya no hay cupo a esa hora. Elige otra hora o día." };
  }
  const emp = db.employees.find((e) => e.id === empId)!;

  let customer: Customer | undefined = db.customers.find(
    (c) => c.organization_id === row.organization_id && c.phone === p.phone.trim()
  );
  if (!customer) {
    customer = {
      id: crypto.randomUUID(),
      organization_id: row.organization_id,
      full_name: p.name.trim(),
      phone: p.phone.trim(),
      email: p.email?.trim() || null,
      acquisition_source: "Reserva online",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.customers.push(customer);
  } else if (p.email && !customer.email) {
    customer.email = p.email.trim();
  }

  let code = `R-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  while (db.appointments.some((a) => a.booking_code === code)) {
    code = `R-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  const notesParts = [p.notes?.trim(), "Solicitud web · Autoriza contacto por WhatsApp/correo"].filter(Boolean);
  db.appointments.push({
    id: crypto.randomUUID(),
    organization_id: row.organization_id,
    branch_id: emp.branch_id ?? null,
    customer_id: customer.id,
    employee_id: emp.id,
    service_id: svc.id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    status: row.auto_confirm ? "confirmed" : "reserved",
    notes: notesParts.join(" · "),
    created_at: new Date().toISOString(),
    price: svc.price,
    updated_at: new Date().toISOString(),
    source: "online",
    booking_code: code,
  });

  return { ok: true, booking_code: code, status: row.auto_confirm ? "confirmed" : "reserved", auto_confirm: row.auto_confirm };
}

async function demoCancelBooking(slug: string, code: string, phone: string): Promise<{ ok: boolean; message?: string }> {
  const db = demoDb();
  const row = db.booking_settings.find((b) => b.slug === slug.toLowerCase().trim());
  if (!row) return { ok: false, message: "Página de reservas no encontrada." };

  const cust = db.customers.find(
    (c) => c.organization_id === row.organization_id && (c.phone?.trim() === phone.trim() || (c as { whatsapp?: string | null }).whatsapp?.trim() === phone.trim())
  );
  const appt = db.appointments.find(
    (a) => a.organization_id === row.organization_id && a.source === "online" &&
      a.booking_code?.toUpperCase() === code.trim().toUpperCase() && a.customer_id === cust?.id
  );
  if (!appt) return { ok: false, message: "No encontramos una reserva con ese código y teléfono. Verifica los datos." };
  if (appt.status === "cancelled") return { ok: false, message: "Esta reserva ya estaba cancelada." };
  if (!["reserved", "scheduled", "confirmed"].includes(appt.status)) {
    return { ok: false, message: "Esta reserva ya no se puede cancelar en línea." };
  }
  const mins = (new Date(appt.starts_at).getTime() - Date.now()) / 60000;
  if (mins < Math.max(row.cancellation_hours, 0) * 60) {
    return { ok: false, message: `Solo puedes cancelar con al menos ${row.cancellation_hours} hora(s) de antelación. Contáctanos al ${row.contact_phone ?? "nuestro teléfono"}.` };
  }
  appt.status = "cancelled";
  appt.notes = `${appt.notes ? `${appt.notes} · ` : ""}Cancelada por el cliente`;
  appt.updated_at = new Date().toISOString();
  return { ok: true, message: "Tu reserva fue cancelada. Esperamos verte pronto." };
}

/* ———————————————————————— Utilidades de fecha ——————————————————————————— */

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/* ————————————————————————— Interfaz pública ————————————————————————————— */

export async function loadPublicBookingData(slug: string): Promise<PublicBookingData> {
  return IS_DEMO ? demoLoadData(slug) : realLoadData(slug);
}

export async function loadAvailableSlots(slug: string, serviceId: string, date: string, employeeId: string | null)
  : Promise<{ ok: boolean; message?: string; slots: Slot[] }> {
  return IS_DEMO ? demoLoadSlots(slug, serviceId, date, employeeId) : realLoadSlots(slug, serviceId, date, employeeId);
}

export async function createPublicBooking(p: CreateBookingPayload): Promise<BookingResult> {
  return IS_DEMO ? demoCreateBooking(p) : realCreateBooking(p);
}

export async function cancelPublicBooking(slug: string, code: string, phone: string)
  : Promise<{ ok: boolean; message?: string }> {
  return IS_DEMO ? demoCancelBooking(slug, code, phone) : realCancelBooking(slug, code, phone);
}

/* Enlace wa.me limpio para Colombia */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const full = digits.startsWith("57") ? digits : `57${digits}`;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}