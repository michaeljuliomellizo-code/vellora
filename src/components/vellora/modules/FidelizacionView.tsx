"use client";

/* VelloRa ERP — Módulo Fidelización v2:
   • Campañas (loyalty_programs): visitas, servicios pagados (mismos/diferentes/cualquiera),
     categorías, cumpleaños, reactivación, referidos y ruleta gamificada.
   • Premios otorgados (loyalty_program_awards): pendiente → entregado / anulado.
   • Referidos (loyalty_referrals): "Trae a tu mejor amiga".
   • Puntos (loyalty_accounts / loyalty_transactions): acumulación y canje. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, RefreshCw, Gift, Plus, Sparkles, Copy, Check, Trophy, Ticket,
  Users, RotateCw, Pencil, Megaphone, Trash2,
} from "lucide-react";
import type { LoyaltyAccount, OrganizationContext } from "@/lib/vellora/types";
import { can } from "@/lib/vellora/permissions";
import { relativeDay, formatDate, bogotaDayKey } from "@/lib/vellora/format";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field } from "../ui-bits";

/* ————— Tipos ————— */

type ProgramType = "visitas" | "servicios" | "categorias" | "cumpleanos" | "retorno" | "referidos" | "ruleta";
type Scope = "mismos" | "diferentes" | "cualquiera";
type RewardType = "servicio" | "descuento" | "puntos" | "beneficio";
type Prize = { label: string; type: "puntos" | "descuento" | "servicio"; value: number };

type Program = {
  id: string;
  organization_id: string;
  name: string;
  program_type: ProgramType;
  threshold: number;
  period_days: number;
  scope: Scope;
  reward_type: RewardType;
  reward_service_id: string | null;
  reward_value: number;
  reward_label: string | null;
  spins_per_visits: number;
  prizes: Prize[];
  description: string | null;
  ad_message: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  created_at: string;
};

type Award = {
  id: string;
  program_id: string;
  customer_id: string;
  status: "pendiente" | "entregado" | "anulado";
  progress_value: number;
  reward_snapshot: string;
  referral_id: string | null;
  notes: string | null;
  awarded_at: string;
  delivered_at: string | null;
};

type Referral = {
  id: string;
  program_id: string | null;
  referrer_id: string;
  referred_id: string;
  created_at: string;
};

type Cus = { id: string; full_name: string; phone: string | null; birth_date: string | null; active: boolean };
type Svc = { id: string; name: string; category_id: string | null };
type Cat = { id: string; name: string };

type ProgRow = {
  customer: Cus;
  value: number;
  target: number;
  detail: string;
  qualifies: boolean;
  spins?: number;
};

type ProgForm = {
  name: string;
  program_type: ProgramType;
  threshold: number;
  period_days: number;
  scope: Scope;
  reward_type: RewardType;
  reward_service_id: string;
  reward_value: number;
  reward_label: string;
  spins_per_visits: number;
  prizes: Prize[];
  description: string;
  ad_message: string;
  start_date: string;
  end_date: string;
  active: boolean;
};

type Mov = { id: string; customer_id: string; points_delta: number; reason: string; created_at: string };

/* ————— Constantes ————— */

const TYPE_META: Record<ProgramType, { label: string; hint: string }> = {
  visitas: { label: "Por visitas", hint: "Cuenta los días que el cliente visitó el salón (asistencias o compras pagadas) dentro de una ventana de días." },
  servicios: { label: "Por servicios pagados", hint: "Acumula servicios pagados: el mismo servicio, servicios diferentes o cualquier combinación." },
  categorias: { label: "Por categorías", hint: "El cliente completa categorías de servicio diferentes (corte, uñas, color…)." },
  cumpleanos: { label: "Cumpleaños", hint: "Premio automático sugerido durante el mes de cumpleaños del cliente." },
  retorno: { label: "Reactivación", hint: "Detecta clientes con X o más días sin visitar para invitarlos a regresar." },
  referidos: { label: "Referidos", hint: "Registra quién trajo a quién; cuando la amiga haga su primera compra, ambas ganan." },
  ruleta: { label: "Gamificación · Ruleta", hint: "Cada N visitas el cliente gana un giro de ruleta con premios sorpresa." },
};

const SCOPE_META: Record<Scope, string> = {
  mismos: "El mismo servicio",
  diferentes: "Servicios diferentes",
  cualquiera: "Cualquier combinación",
};

const THRESHOLD_LABEL: Record<ProgramType, string> = {
  visitas: "Número de visitas",
  servicios: "Número de servicios pagados",
  categorias: "Número de categorías diferentes",
  cumpleanos: "— (no aplica)",
  retorno: "Días sin visitar",
  referidos: "— (no aplica)",
  ruleta: "Giros por cada… (visitas)",
};

const REWARD_META: Record<RewardType, string> = {
  servicio: "Servicio gratis",
  descuento: "Descuento (%)",
  puntos: "Puntos",
  beneficio: "Bono / beneficio",
};

const WHEEL_COLORS = ["#7556d8", "#9d80f0", "#5c3fc4", "#bda3f8", "#8a63e2", "#6d4ed6"];

/* Plantillas listas para usar (pre-llenan el formulario de nueva campaña) */
const TEMPLATES: { name: string; form: Partial<ProgForm> }[] = [
  {
    name: "Belleza x 3",
    form: {
      program_type: "visitas", threshold: 3, period_days: 30, scope: "cualquiera",
      reward_type: "servicio", reward_value: 0, reward_label: "Un servicio de cejas gratis",
      description: "Visita 3 veces en el mes y adquiere 3 servicios.",
      ad_message: "¡Tu belleza tiene recompensa! Visítanos 3 veces este mes, disfruta 3 de nuestros servicios y nosotros te regalamos un servicio especial. ¡Porque verte bien también tiene premios!",
    },
  },
  {
    name: "Mes de consentirte",
    form: {
      program_type: "visitas", threshold: 4, period_days: 30, scope: "cualquiera",
      reward_type: "servicio", reward_value: 0, reward_label: "Una hidratación capilar gratis",
      description: "Realiza 4 visitas durante el mes.",
      ad_message: "Este mes es de consentirte: 4 visitas al salón y te regalamos una hidratación capilar. ¡Te lo mereces!",
    },
  },
  {
    name: "Cliente frecuente",
    form: {
      program_type: "visitas", threshold: 2, period_days: 15, scope: "cualquiera",
      reward_type: "descuento", reward_value: 15, reward_label: "",
      description: "Visita el salón 2 veces en 15 días.",
      ad_message: "¡Nos encanta verte seguido! 2 visitas en 15 días y obtienes 15% de descuento en tu siguiente servicio.",
    },
  },
  {
    name: "Reto Beauty 30",
    form: {
      program_type: "visitas", threshold: 5, period_days: 30, scope: "cualquiera",
      reward_type: "servicio", reward_value: 0, reward_label: "Un servicio premium de cortesía",
      description: "Completa 5 visitas en 30 días.",
      ad_message: "Acepta el Reto Beauty 30: 5 visitas en un mes y un servicio premium de cortesía es tuyo. ¿Aceptas el reto?",
    },
  },
  {
    name: "Beauty 10",
    form: {
      program_type: "servicios", threshold: 10, period_days: 0, scope: "cualquiera",
      reward_type: "servicio", reward_value: 0, reward_label: "El servicio número 11 es gratis",
      description: "Acumula 10 servicios pagados (cualquier combinación).",
      ad_message: "Beauty 10: cada servicio que disfrutas te acerca al 11º… ¡que corre por nuestra cuenta!",
    },
  },
  {
    name: "Manos felices",
    form: {
      program_type: "servicios", threshold: 5, period_days: 0, scope: "mismos",
      reward_type: "servicio", reward_value: 0, reward_label: "La sexta manicura es gratis",
      description: "Paga 5 manicuras (el mismo servicio).",
      ad_message: "Manos felices, cartera feliz: 5 manicuras pagadas y la sexta es gratis. ¡Reserva tu cita!",
    },
  },
  {
    name: "Cabello saludable",
    form: {
      program_type: "servicios", threshold: 4, period_days: 0, scope: "mismos",
      reward_type: "descuento", reward_value: 50, reward_label: "",
      description: "Realiza 4 tratamientos capilares (el mismo servicio).",
      ad_message: "Tu cabello lo agradece: 4 tratamientos capilares y el quinto con 50% de descuento. ¡Brillo garantizado!",
    },
  },
  {
    name: "Cumpleaños Beauty",
    form: {
      program_type: "cumpleanos", threshold: 1, period_days: 0, scope: "cualquiera",
      reward_type: "servicio", reward_value: 0, reward_label: "Un servicio de cortesía en su mes de cumpleaños",
      description: "Durante el mes de cumpleaños, el cliente recibe un servicio de cortesía.",
      ad_message: "¡Feliz cumpleaños! Este mes es tuyo: ven a celebrar con un servicio de cortesía de parte de todo el equipo.",
    },
  },
  {
    name: "No desaparezcas",
    form: {
      program_type: "retorno", threshold: 45, period_days: 0, scope: "cualquiera",
      reward_type: "beneficio", reward_value: 0, reward_label: "Invitación personalizada con beneficio para regresar",
      description: "Cliente con 45 días o más sin visitar el salón recibe una invitación con beneficio.",
      ad_message: "¡Hola! Notamos que hace tiempo no nos visitas y preparamos algo especial para tu regreso. ¡Ven por tu beneficio!",
    },
  },
  {
    name: "Trae a tu mejor amiga",
    form: {
      program_type: "referidos", threshold: 1, period_days: 0, scope: "cualquiera",
      reward_type: "puntos", reward_value: 100, reward_label: "",
      description: "Recomienda una amiga: cuando realice su primera compra, ambas reciben 100 puntos.",
      ad_message: "Los buenos momentos se comparten: trae a tu mejor amiga, cuando haga su primera compra ambas ganan 100 puntos. ¡Belleza en compañía!",
    },
  },
  {
    name: "La ruleta Beauty",
    form: {
      program_type: "ruleta", threshold: 3, period_days: 0, scope: "cualquiera",
      reward_type: "beneficio", reward_value: 0, reward_label: "Premios sorpresa en la ruleta",
      spins_per_visits: 3,
      prizes: [
        { label: "10% de descuento", type: "descuento", value: 10 },
        { label: "Hidratación capilar gratis", type: "servicio", value: 0 },
        { label: "Servicio de cejas gratis", type: "servicio", value: 0 },
        { label: "200 puntos", type: "puntos", value: 200 },
        { label: "Manicura gratis", type: "servicio", value: 0 },
        { label: "50 puntos adicionales", type: "puntos", value: 50 },
      ],
      description: "Cada 3 visitas el cliente obtiene un giro de ruleta con premios sorpresa.",
      ad_message: "¡Gira y gana! Cada 3 visitas recibes un giro en la Ruleta Beauty: descuentos, hidrataciones, cejas, uñas o puntos adicionales. ¿Qué te tocará?",
    },
  },
];

function emptyForm(): ProgForm {
  return {
    name: "", program_type: "visitas", threshold: 3, period_days: 30, scope: "cualquiera",
    reward_type: "servicio", reward_service_id: "", reward_value: 0, reward_label: "",
    spins_per_visits: 3, prizes: [{ label: "", type: "puntos", value: 100 }],
    description: "", ad_message: "", start_date: "", end_date: "", active: true,
  };
}

function autoMechanic(p: Pick<ProgForm, "program_type" | "threshold" | "period_days" | "scope" | "spins_per_visits">): string {
  switch (p.program_type) {
    case "visitas":
      return p.period_days > 0
        ? `Realiza ${p.threshold} visitas en ${p.period_days} días.`
        : `Realiza ${p.threshold} visitas (acumulado).`;
    case "servicios":
      return `Acumula ${p.threshold} servicios pagados (${SCOPE_META[p.scope].toLowerCase()}).`;
    case "categorias":
      return `Completa servicios de ${p.threshold} categorías diferentes.`;
    case "cumpleanos":
      return "Premio durante el mes de cumpleaños del cliente.";
    case "retorno":
      return `Cliente con ${p.threshold} días o más sin visitar el salón.`;
    case "referidos":
      return "Cuando la amiga referida realice su primera compra, ambas ganan la recompensa.";
    case "ruleta":
      return `Cada ${p.spins_per_visits} visitas el cliente obtiene un giro de ruleta.`;
  }
}

/* ————— Componente ————— */

export default function FidelizacionView({ ctx }: { ctx: OrganizationContext }) {
  const [tab, setTab] = useState<"campanas" | "premios" | "puntos">("campanas");
  const [filter, setFilter] = useState<"todas" | "activas" | "ejemplos">("activas");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [programs, setPrograms] = useState<Program[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [customers, setCustomers] = useState<Cus[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [categories, setCategories] = useState<Cat[]>([]);
  const [paidOrders, setPaidOrders] = useState<{ id: string; customer_id: string | null; created_at: string }[]>([]);
  const [paidItems, setPaidItems] = useState<{ order_id: string; service_id: string | null; quantity: number }[]>([]);
  const [doneAppts, setDoneAppts] = useState<{ customer_id: string | null; starts_at: string }[]>([]);

  /* Puntos (pestaña original) */
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [movements, setMovements] = useState<Mov[]>([]);
  const [redeem, setRedeem] = useState<LoyaltyAccount | null>(null);
  const [points, setPoints] = useState(100);

  /* Detalle de campaña, editor y ruleta */
  const [detail, setDetail] = useState<Program | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProgForm>(emptyForm());
  const [wheel, setWheel] = useState<{ customer: Cus; available: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState<Prize | null>(null);

  /* Referidos (formulario en detalle) */
  const [refFrom, setRefFrom] = useState("");
  const [refTo, setRefTo] = useState("");

  const canCreate = can(ctx.permissions, "fidelizacion", "can_create");
  const canUpdate = can(ctx.permissions, "fidelizacion", "can_update");

  /* ————— Carga ————— */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const org = ctx.organizationId;
      const [pRes, aRes, rRes, cRes, sRes, catRes, ordRes, apptRes, accRes, movRes] = await Promise.all([
        sb.from("loyalty_programs").select("*").eq("organization_id", org).order("created_at", { ascending: true }),
        sb.from("loyalty_program_awards").select("*").eq("organization_id", org).order("awarded_at", { ascending: false }).limit(500),
        sb.from("loyalty_referrals").select("*").eq("organization_id", org).order("created_at", { ascending: false }),
        sb.from("customers").select("id, full_name, phone, birth_date, active").eq("organization_id", org).eq("active", true).order("full_name"),
        sb.from("services").select("id, name, category_id").eq("organization_id", org),
        sb.from("service_categories").select("id, name").eq("organization_id", org),
        sb.from("service_orders").select("id, customer_id, created_at").eq("organization_id", org).eq("status", "paid"),
        sb.from("appointments").select("customer_id, starts_at").eq("organization_id", org).eq("status", "completed"),
        sb.from("loyalty_accounts").select("*").eq("organization_id", org).order("points", { ascending: false }),
        sb.from("loyalty_transactions").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(20),
      ]);
      const firstErr = [pRes, aRes, rRes, cRes, sRes, catRes, ordRes, apptRes, accRes, movRes].find((r) => r.error);
      if (firstErr?.error) throw new Error(firstErr.error.message);

      const ords = ((ordRes.data ?? []) as unknown) as { id: string; customer_id: string | null; created_at: string }[];
      let items: { order_id: string; service_id: string | null; quantity: number }[] = [];
      if (ords.length > 0) {
        const { data: itData, error: itErr } = await sb
          .from("service_order_items")
          .select("order_id, service_id, quantity")
          .in("order_id", ords.map((o) => o.id));
        if (itErr) throw new Error(itErr.message);
        items = ((itData ?? []) as unknown) as typeof items;
      }

      const cus = ((cRes.data ?? []) as unknown) as Cus[];
      setPrograms(((pRes.data ?? []) as unknown) as Program[]);
      setAwards(((aRes.data ?? []) as unknown) as Award[]);
      setReferrals(((rRes.data ?? []) as unknown) as Referral[]);
      setCustomers(cus);
      setServices(((sRes.data ?? []) as unknown) as Svc[]);
      setCategories(((catRes.data ?? []) as unknown) as Cat[]);
      setPaidOrders(ords);
      setPaidItems(items);
      setDoneAppts(((apptRes.data ?? []) as unknown) as { customer_id: string | null; starts_at: string }[]);
      setAccounts(
        (((accRes.data ?? []) as unknown) as LoyaltyAccount[]).map((a) => ({
          ...a,
          customer_name: cus.find((c) => c.id === a.customer_id)?.full_name ?? "Cliente",
          customer_phone: cus.find((c) => c.id === a.customer_id)?.phone ?? null,
        }))
      );
      setMovements(((movRes.data ?? []) as unknown) as Mov[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar fidelización");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ————— Índices derivados ————— */

  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const svcMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const progMap = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);

  /* Días de visita por cliente (órdenes pagadas + citas completadas) */
  const visitDaysByCust = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (cid: string | null | undefined, iso: string | null | undefined) => {
      if (!cid || !iso) return;
      let s = m.get(cid);
      if (!s) { s = new Set(); m.set(cid, s); }
      s.add(bogotaDayKey(new Date(iso)));
    };
    for (const o of paidOrders) add(o.customer_id, o.created_at);
    for (const a of doneAppts) add(a.customer_id, a.starts_at);
    return m;
  }, [paidOrders, doneAppts]);

  /* Servicios pagados por cliente: mapa por servicio y por categoría */
  const svcByCust = useMemo(() => {
    const ordersById = new Map(paidOrders.map((o) => [o.id, o]));
    const m = new Map<string, { svc: Map<string, number>; cat: Map<string, number> }>();
    for (const it of paidItems) {
      if (!it.service_id) continue;
      const o = ordersById.get(it.order_id);
      if (!o || !o.customer_id) continue;
      const qty = Number(it.quantity ?? 1);
      let row = m.get(o.customer_id);
      if (!row) { row = { svc: new Map(), cat: new Map() }; m.set(o.customer_id, row); }
      row.svc.set(it.service_id, (row.svc.get(it.service_id) ?? 0) + qty);
      const catId = svcMap.get(it.service_id)?.category_id ?? null;
      if (catId) row.cat.set(catId, (row.cat.get(catId) ?? 0) + qty);
    }
    return m;
  }, [paidOrders, paidItems, svcMap]);

  const awardsByKey = useMemo(() => {
    const m = new Map<string, Award[]>();
    for (const a of awards) {
      const k = `${a.program_id}:${a.customer_id}`;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return m;
  }, [awards]);

  const awardRefs = useMemo(() => new Set(awards.map((a) => a.referral_id).filter(Boolean) as string[]), [awards]);

  /* ————— Cálculo de avance por campaña ————— */

  function programProgress(p: Program): ProgRow[] {
    const now = new Date();
    const windowStart = p.period_days > 0 ? new Date(now.getTime() - p.period_days * 86400000) : null;
    const rows: ProgRow[] = [];
    for (const c of customers) {
      if (!c.active) continue;
      const cAwards = (awardsByKey.get(`${p.id}:${c.id}`) ?? []).filter((a) => a.status !== "anulado");
      if (cAwards.some((a) => a.status === "pendiente")) continue; // ya tiene un premio por entregar

      if (p.program_type === "ruleta") {
        const visits = visitDaysByCust.get(c.id)?.size ?? 0;
        const per = Math.max(1, p.spins_per_visits);
        const available = Math.floor(visits / per) - cAwards.length;
        if (available > 0) {
          rows.push({ customer: c, value: visits % per, target: per, detail: `${visits} visitas · ${available} giro(s) disponible(s)`, qualifies: true, spins: available });
        }
        continue;
      }

      if (p.program_type === "cumpleanos") {
        if (!c.birth_date) continue;
        const bm = Number(String(c.birth_date).slice(5, 7));
        if (bm !== now.getMonth() + 1) continue;
        const year = String(now.getFullYear());
        if (cAwards.some((a) => String(a.awarded_at).slice(0, 4) === year)) continue;
        rows.push({ customer: c, value: 1, target: 1, detail: `Cumple este mes · ${formatDate(c.birth_date)}`, qualifies: true });
        continue;
      }

      if (p.program_type === "retorno") {
        const days = visitDaysByCust.get(c.id);
        if (!days || days.size === 0) continue;
        const sorted = [...days].sort();
        const lastKey = sorted[sorted.length - 1] ?? "";
        if (!lastKey) continue;
        const last = new Date(`${lastKey}T12:00:00`);
        const dSince = Math.floor((now.getTime() - last.getTime()) / 86400000);
        const lastAwardAt = cAwards.map((a) => a.awarded_at).sort().slice(-1)[0];
        if (lastAwardAt && new Date(lastAwardAt) > last) continue; // ya premiado tras esa visita; debe volver
        if (dSince < p.threshold) continue;
        rows.push({ customer: c, value: dSince, target: p.threshold, detail: `Última visita hace ${dSince} días`, qualifies: true });
        continue;
      }

      if (p.program_type === "referidos") continue; // se maneja con la tabla de referidas

      // visitas | servicios | categorias
      const wAwards = cAwards.filter((a) => !windowStart || new Date(a.awarded_at) >= windowStart);
      const consumed = wAwards.reduce((s, a) => s + (a.progress_value ?? 0), 0);
      let value = 0;
      let detail = "";
      if (p.program_type === "visitas") {
        const all = [...(visitDaysByCust.get(c.id) ?? [])];
        const inWin = windowStart ? all.filter((k) => new Date(`${k}T12:00:00`) >= windowStart) : all;
        value = Math.max(0, inWin.length - consumed);
        detail = windowStart ? `${value} de ${p.threshold} visitas en ${p.period_days} días` : `${value} visitas acumuladas`;
      } else if (p.program_type === "servicios") {
        const row = svcByCust.get(c.id);
        if (p.scope === "mismos") {
          const top = row ? [...row.svc.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
          value = Math.max(0, (top?.[1] ?? 0) - consumed);
          detail = top ? `${value} × ${svcMap.get(top[0])?.name ?? "servicio"} (el más repetido)` : "Aún sin servicios pagados";
        } else if (p.scope === "diferentes") {
          value = Math.max(0, (row?.svc.size ?? 0) - consumed);
          detail = `${value} servicios diferentes pagados`;
        } else {
          value = Math.max(0, [...(row?.svc.values() ?? [])].reduce((s, q) => s + q, 0) - consumed);
          detail = `${value} servicios pagados (cualquier combinación)`;
        }
      } else if (p.program_type === "categorias") {
        const row = svcByCust.get(c.id);
        let catCount = row ? row.cat.size : 0;
        if (row) catCount += [...row.svc.keys()].filter((sid) => !svcMap.get(sid)?.category_id).length;
        value = Math.max(0, catCount - consumed);
        detail = `${value} de ${p.threshold} categorías completadas`;
      }
      rows.push({ customer: c, value, target: p.threshold, detail, qualifies: value >= p.threshold });
    }
    return rows.sort((a, b) => b.value / Math.max(1, b.target) - a.value / Math.max(1, a.target));
  }

  const progressCache = useMemo(() => {
    const m = new Map<string, ProgRow[]>();
    for (const p of programs) m.set(p.id, programProgress(p));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, customers, awards, visitDaysByCust, svcByCust, awardsByKey]);

  /* ————— Textos de recompensa y mecánica ————— */

  function rewardText(p: Program): string {
    if (p.program_type === "ruleta") return "Premios sorpresa en la ruleta";
    if (p.reward_type === "servicio") {
      const s = p.reward_service_id ? svcMap.get(p.reward_service_id)?.name : null;
      return s ? `${s} gratis` : (p.reward_label || "Un servicio gratis");
    }
    if (p.reward_type === "descuento") return `${p.reward_value}% de descuento`;
    if (p.reward_type === "puntos") return `${p.reward_value} puntos`;
    return p.reward_label || "Bono especial";
  }

  function mechanicText(p: Program): string {
    return p.description?.trim() || autoMechanic({ program_type: p.program_type, threshold: p.threshold, period_days: p.period_days, scope: p.scope, spins_per_visits: p.spins_per_visits });
  }

  function programOpen(p: Program): boolean {
    const today = new Date();
    if (p.start_date && new Date(`${p.start_date}T00:00:00`) > today) return false;
    if (p.end_date && new Date(`${p.end_date}T23:59:59`) < today) return false;
    return true;
  }

  /* ————— Acciones ————— */

  async function addPointsRaw(customerId: string, delta: number, reason: string): Promise<string | null> {
    const sb = supabaseBrowser();
    const { data: acc } = await sb.from("loyalty_accounts").select("id, points").eq("organization_id", ctx.organizationId).eq("customer_id", customerId).maybeSingle();
    const row = (acc as unknown as { id: string; points: number } | null);
    if (row) {
      const { error: upErr } = await sb.from("loyalty_accounts").update({ points: row.points + delta }).eq("id", row.id);
      if (upErr) return upErr.message;
    } else {
      const { error: insErr } = await sb.from("loyalty_accounts").insert({ organization_id: ctx.organizationId, customer_id: customerId, points: delta, tier: "bronze" });
      if (insErr) return insErr.message;
    }
    const { error: txErr } = await sb.from("loyalty_transactions").insert({
      organization_id: ctx.organizationId, customer_id: customerId, payment_id: null, points_delta: delta, reason,
    });
    return txErr ? txErr.message : null;
  }

  async function saveProgram() {
    if (!form.name.trim()) { setError("La campaña necesita un nombre."); return; }
    if (form.program_type !== "cumpleanos" && form.program_type !== "referidos" && form.threshold < 1) {
      setError("El umbral debe ser al menos 1.");
      return;
    }
    if (form.program_type === "ruleta" && form.prizes.filter((z) => z.label.trim()).length < 2) {
      setError("La ruleta necesita al menos 2 premios con nombre.");
      return;
    }
    setBusy("save");
    try {
      const sb = supabaseBrowser();
      const payload = {
        organization_id: ctx.organizationId,
        name: form.name.trim(),
        program_type: form.program_type,
        threshold: form.threshold,
        period_days: ["visitas", "servicios", "categorias"].includes(form.program_type) ? form.period_days : 0,
        scope: form.program_type === "servicios" ? form.scope : "cualquiera",
        reward_type: form.program_type === "ruleta" ? "beneficio" : form.reward_type,
        reward_service_id: form.reward_type === "servicio" && form.reward_service_id ? form.reward_service_id : null,
        reward_value: form.reward_value,
        reward_label: form.reward_label.trim() || null,
        spins_per_visits: Math.max(1, form.spins_per_visits),
        prizes: form.program_type === "ruleta" ? form.prizes.filter((z) => z.label.trim()) : [],
        description: form.description.trim() || autoMechanic(form),
        ad_message: form.ad_message.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        active: form.active,
        updated_at: new Date().toISOString(),
      };
      let saveErr: string | null = null;
      if (editingId) {
        const { error: e } = await sb.from("loyalty_programs").update(payload).eq("id", editingId);
        saveErr = e?.message ?? null;
      } else {
        const { error: e } = await sb.from("loyalty_programs").insert(payload);
        saveErr = e?.message ?? null;
      }
      if (saveErr) throw new Error(saveErr);
      setEditorOpen(false);
      setEditingId(null);
      setNotice(editingId ? "Campaña actualizada." : `Campaña "${form.name.trim()}" creada.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible guardar la campaña");
    } finally {
      setBusy("");
    }
  }

  async function toggleActive(p: Program) {
    setBusy(p.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("loyalty_programs").update({ active: !p.active, updated_at: new Date().toISOString() }).eq("id", p.id);
    setBusy("");
    if (e) { setError(`No fue posible cambiar el estado: ${e.message}`); return; }
    setNotice(!p.active ? `Campaña "${p.name}" activada.` : `Campaña "${p.name}" desactivada.`);
    await load();
  }

  async function removeProgram(p: Program) {
    if (!window.confirm(`¿Eliminar la campaña "${p.name}"? Los premios asociados también se eliminarán.`)) return;
    setBusy(p.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("loyalty_programs").delete().eq("id", p.id);
    setBusy("");
    if (e) { setError(`No fue posible eliminar: ${e.message}`); return; }
    if (detail?.id === p.id) setDetail(null);
    setNotice(`Campaña "${p.name}" eliminada.`);
    await load();
  }

  async function grantAward(p: Program, row: ProgRow, referral?: Referral) {
    const key = referral ? `ref:${referral.id}` : `${p.id}:${row.customer.id}`;
    setBusy(key);
    try {
      const sb = supabaseBrowser();
      const progressValue = p.program_type === "retorno" ? 0 : p.program_type === "referidos" ? 1 : Math.max(1, row.value);
      const notes = referral
        ? `Por referir a ${custMap.get(referral.referred_id)?.full_name ?? "una amiga"}`
        : null;
      const { error: insErr } = await sb.from("loyalty_program_awards").insert({
        organization_id: ctx.organizationId,
        program_id: p.id,
        customer_id: referral ? referral.referrer_id : row.customer.id,
        status: "pendiente",
        progress_value: progressValue,
        reward_snapshot: rewardText(p),
        referral_id: referral?.id ?? null,
        notes,
        created_by: ctx.user.id,
      });
      if (insErr) throw new Error(insErr.message);

      let warn = "";
      if (p.reward_type === "puntos" && p.reward_value > 0) {
        const e1 = await addPointsRaw(referral ? referral.referrer_id : row.customer.id, p.reward_value, `Premio campaña: ${p.name}`);
        if (e1) warn = `Premio otorgado, pero falló la suma de puntos: ${e1}`;
        if (referral) {
          const e2 = await addPointsRaw(referral.referred_id, p.reward_value, `Premio campaña (referida): ${p.name}`);
          if (e2) warn = warn || `Premio otorgado, pero fallaron los puntos de la referida: ${e2}`;
        }
      }
      if (warn) setError(warn);
      else setNotice(`Premio otorgado a ${referral ? custMap.get(referral.referrer_id)?.full_name ?? "cliente" : row.customer.full_name}: ${rewardText(p)}. Encuéntralo en la pestaña Premios.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible otorgar el premio");
    } finally {
      setBusy("");
    }
  }

  async function deliverAward(a: Award) {
    setBusy(a.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("loyalty_program_awards").update({ status: "entregado", delivered_at: new Date().toISOString() }).eq("id", a.id);
    setBusy("");
    if (e) { setError(`No fue posible marcar la entrega: ${e.message}`); return; }
    setNotice("Premio marcado como entregado.");
    await load();
  }

  async function cancelAward(a: Award) {
    if (!window.confirm("¿Anular este premio? El avance del cliente volverá a contar.")) return;
    setBusy(a.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("loyalty_program_awards").update({ status: "anulado" }).eq("id", a.id);
    setBusy("");
    if (e) { setError(`No fue posible anular: ${e.message}`); return; }
    setNotice("Premio anulado.");
    await load();
  }

  async function registerReferral(p: Program) {
    if (!refFrom || !refTo) { setError("Selecciona quién refiere y a qué amiga."); return; }
    if (refFrom === refTo) { setError("La amiga referida debe ser un cliente diferente."); return; }
    setBusy("ref");
    try {
      const sb = supabaseBrowser();
      const { error: e } = await sb.from("loyalty_referrals").insert({
        organization_id: ctx.organizationId, program_id: p.id, referrer_id: refFrom, referred_id: refTo,
      });
      if (e) throw new Error(e.message.includes("loyalty_referrals_unique_referred") ? "Esa amiga ya fue registrada como referida." : e.message);
      setRefFrom(""); setRefTo("");
      setNotice("Referida registrada. Cuando realice su primera compra aparecerá lista para premiar.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible registrar la referida");
    } finally {
      setBusy("");
    }
  }

  async function recordSpin(prize: Prize, customer: Cus, p: Program) {
    try {
      const sb = supabaseBrowser();
      const { error: insErr } = await sb.from("loyalty_program_awards").insert({
        organization_id: ctx.organizationId,
        program_id: p.id,
        customer_id: customer.id,
        status: "entregado",
        progress_value: 0,
        reward_snapshot: prize.label,
        notes: "Premio de ruleta (entregado al girar)",
        delivered_at: new Date().toISOString(),
        created_by: ctx.user.id,
      });
      if (insErr) throw new Error(insErr.message);
      if (prize.type === "puntos" && prize.value > 0) {
        const e1 = await addPointsRaw(customer.id, prize.value, `Ruleta Beauty: ${prize.label}`);
        if (e1) setError(`Premio registrado, pero falló la suma de puntos: ${e1}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible registrar el premio de la ruleta");
    }
  }

  function startSpin(prizeCount: number) {
    const p = detail;
    if (!p || !wheel || spinning) return;
    const prizes = (p.prizes ?? []) as Prize[];
    if (prizes.length === 0) return;
    const idx = Math.floor(Math.random() * prizes.length);
    const seg = 360 / prizeCount;
    const current = ((rotation % 360) + 360) % 360;
    const targetMod = (360 - (idx * seg + seg / 2) + 360) % 360;
    const delta = 360 * 5 + ((targetMod - current + 360) % 360);
    setSpinResult(null);
    setSpinning(true);
    setRotation(rotation + delta);
    window.setTimeout(async () => {
      setSpinning(false);
      const prize = prizes[idx] ?? prizes[0];
      if (prize) setSpinResult(prize);
      if (prize && wheel) await recordSpin(prize, wheel.customer, p);
    }, 3300);
  }

  async function doRedeem() {
    if (!redeem) return;
    if (points <= 0 || points > redeem.points) {
      setError("Puntos inválidos para el canje.");
      return;
    }
    setError("");
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("loyalty_transactions").insert({
      organization_id: ctx.organizationId,
      customer_id: redeem.customer_id,
      payment_id: null,
      points_delta: -points,
      reason: "Canje manual de recompensa",
    });
    if (insErr) {
      setError(`No fue posible canjear: ${insErr.message}`);
      return;
    }
    const { error: upErr } = await sb.from("loyalty_accounts").update({ points: redeem.points - points }).eq("id", redeem.id);
    if (upErr) {
      setError(`Movimiento registrado, pero falló la actualización de puntos: ${upErr.message}`);
      await load();
      return;
    }
    setRedeem(null);
    setNotice(`Canje de ${points} puntos registrado para ${redeem.customer_name ?? "el cliente"}.`);
    await load();
  }

  /* ————— Derivados de UI ————— */

  const visiblePrograms = useMemo(() => {
    const list = programs.filter((p) => (filter === "todas" ? true : filter === "activas" ? p.active : !p.active));
    return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [programs, filter]);

  const pendingAwards = useMemo(() => awards.filter((a) => a.status === "pendiente"), [awards]);
  const toAwardCount = useMemo(() => {
    let n = 0;
    for (const p of programs) {
      if (!p.active) continue;
      const rows = progressCache.get(p.id) ?? [];
      if (p.program_type === "referidos") {
        n += referrals.filter((r) => r.program_id === p.id && paidOrders.some((o) => o.customer_id === r.referred_id) && !awardRefs.has(r.id)).length;
      } else {
        n += rows.filter((r) => r.qualifies).length;
      }
    }
    return n;
  }, [programs, progressCache, referrals, paidOrders, awardRefs]);

  const top = useMemo(() => [...accounts].sort((a, b) => b.points - a.points).slice(0, 10), [accounts]);
  const totalPoints = accounts.reduce((a, c) => a + c.points, 0);

  const detailRows = detail ? progressCache.get(detail.id) ?? [] : [];
  const detailReferrals = useMemo(() => {
    if (!detail) return [];
    return referrals.filter((r) => r.program_id === detail.id);
  }, [referrals, detail]);

  /* ————— Render ————— */

  const tabs: { key: typeof tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "campanas", label: "Campañas", icon: Ticket },
    { key: "premios", label: "Premios", icon: Trophy },
    { key: "puntos", label: "Puntos", icon: Users },
  ];

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Fidelización"
        subtitle="Campañas que premian la recurrencia: visitas, servicios, cumpleaños, referidos y ruleta."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => { setForm(emptyForm()); setEditingId(null); setEditorOpen(true); }}>
                <Plus size={14} /> Nueva campaña
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Secciones de fidelización">
        {tabs.map((t) => {
          const Icon = t.icon;
          const activeTab = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab}
              className={activeTab ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
              onClick={() => setTab(t.key)}
            >
              <Icon size={13} /> {t.label}
              {t.key === "premios" && pendingAwards.length > 0 && (
                <span className="vr-pill" style={{ marginLeft: 6, padding: "1px 7px", fontSize: 10 }}>{pendingAwards.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "campanas" && (
        <>
          <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Campañas activas</div>
              <div className="vr-metric-value">{programs.filter((p) => p.active).length}</div>
            </div>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Clientes por premiar</div>
              <div className="vr-metric-value">{toAwardCount}</div>
            </div>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Premios pendientes de entrega</div>
              <div className="vr-metric-value">{pendingAwards.length}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {(["activas", "ejemplos", "todas"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
                onClick={() => setFilter(f)}
              >
                {f === "activas" ? "Activas" : f === "ejemplos" ? "Ejemplos e inactivas" : "Todas"}
              </button>
            ))}
            {filter === "ejemplos" && (
              <span style={{ fontSize: 11.5, color: "#8d899e" }}>
                Las campañas de ejemplo vienen preconfiguradas: revísolas, ajústalas y actívalas con un clic.
              </span>
            )}
          </div>

          {visiblePrograms.length === 0 ? (
            <EmptyState
              title={filter === "activas" ? "No hay campañas activas" : "No hay campañas aquí"}
              body="Crea una campaña desde cero o parte de una plantilla con el botón Nueva campaña."
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 14 }}>
              {visiblePrograms.map((p) => {
                const rows = progressCache.get(p.id) ?? [];
                const cumple =
                  p.program_type === "referidos"
                    ? referrals.filter((r) => r.program_id === p.id && paidOrders.some((o) => o.customer_id === r.referred_id) && !awardRefs.has(r.id)).length
                    : rows.filter((r) => r.qualifies).length;
                const premios = awards.filter((a) => a.program_id === p.id && a.status !== "anulado").length;
                const expired = p.end_date ? new Date(`${p.end_date}T23:59:59`) < new Date() : false;
                return (
                  <div key={p.id} className="vr-card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{p.name}</div>
                        <span className="vr-pill vr-pill-gray" style={{ marginTop: 4, display: "inline-block", fontSize: 10 }}>
                          {TYPE_META[p.program_type].label}
                        </span>
                      </div>
                      {expired ? (
                        <span className="vr-pill" style={{ background: "#fff0f2", color: "#ca435c" }}>Finalizada</span>
                      ) : p.active ? (
                        <span className="vr-pill" style={{ background: "#e8f8f0", color: "#238a66" }}>Activa</span>
                      ) : (
                        <span className="vr-pill" style={{ background: "#f3f0fa", color: "#7556d8" }}>Ejemplo</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#5e5a70" }}>{mechanicText(p)}</div>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "#7556d8" }}>
                      <Gift size={14} /> {rewardText(p)}
                    </div>
                    {p.ad_message && (
                      <div style={{ background: "#f6f3fd", borderRadius: 10, padding: "9px 11px", fontSize: 11.5, color: "#5e5a70", fontStyle: "italic", position: "relative" }}>
                        <Megaphone size={11} style={{ display: "inline", marginRight: 5, verticalAlign: "-1px" }} />
                        {p.ad_message}
                        <button
                          type="button"
                          className="vr-icon-btn"
                          aria-label="Copiar mensaje publicitario"
                          title="Copiar mensaje"
                          style={{ position: "absolute", right: 6, top: 6 }}
                          onClick={() => { void navigator.clipboard?.writeText(p.ad_message ?? ""); setNotice("Mensaje publicitario copiado."); }}
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: "#8d899e" }}>
                      {p.program_type === "ruleta" ? "Giros disponibles ahora" : "Clientes que cumplen hoy"}: <strong style={{ color: "#7556d8" }}>{cumple}</strong>
                      {" · "}Premios otorgados: <strong>{premios}</strong>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {canUpdate && (
                        <button className="vr-btn-secondary vr-btn-sm" onClick={() => void toggleActive(p)} disabled={busy === p.id}>
                          {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          {p.active ? "Desactivar" : "Activar"}
                        </button>
                      )}
                      {canUpdate && (
                        <button className="vr-btn-secondary vr-btn-sm" onClick={() => {
                          setForm({
                            name: p.name, program_type: p.program_type, threshold: p.threshold, period_days: p.period_days,
                            scope: p.scope, reward_type: p.reward_type, reward_service_id: p.reward_service_id ?? "",
                            reward_value: p.reward_value, reward_label: p.reward_label ?? "", spins_per_visits: p.spins_per_visits,
                            prizes: (p.prizes?.length ? p.prizes : [{ label: "", type: "puntos", value: 100 }]) as Prize[],
                            description: p.description ?? "", ad_message: p.ad_message ?? "",
                            start_date: p.start_date ?? "", end_date: p.end_date ?? "", active: p.active,
                          });
                          setEditingId(p.id);
                          setEditorOpen(true);
                        }}>
                          <Pencil size={12} /> Editar
                        </button>
                      )}
                      <button className="vr-btn-secondary vr-btn-sm" onClick={() => { setDetail(p); setRefFrom(""); setRefTo(""); }}>
                        {p.program_type === "ruleta" ? <RotateCw size={12} /> : <Trophy size={12} />}
                        {p.program_type === "ruleta" ? "Giros" : "Progreso"}
                      </button>
                      {canUpdate && (
                        <button className="vr-btn-secondary vr-btn-sm" title="Eliminar campaña" onClick={() => void removeProgram(p)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "premios" && (
        <section className="vr-card">
          <h2>Premios otorgados</h2>
          {awards.length === 0 ? (
            <EmptyState title="Aún no hay premios" body="Cuando un cliente cumpla una campaña, otorga su premio desde Progreso y aparecerá aquí para marcar la entrega." />
          ) : (
            <div className="vr-table-wrap">
              <table className="vr-table">
                <thead>
                  <tr><th>Cliente</th><th>Campaña</th><th>Recompensa</th><th>Estado</th><th>Otorgado</th><th>Entregado</th><th></th></tr>
                </thead>
                <tbody>
                  {awards.map((a) => {
                    const p = progMap.get(a.program_id);
                    const c = custMap.get(a.customer_id);
                    const pend = a.status === "pendiente";
                    return (
                      <tr key={a.id}>
                        <td><strong>{c?.full_name ?? "Cliente"}</strong>{a.notes ? <div style={{ fontSize: 10.5, color: "#8d899e" }}>{a.notes}</div> : null}</td>
                        <td>{p?.name ?? "—"}<div style={{ fontSize: 10.5, color: "#8d899e" }}>{p ? TYPE_META[p.program_type].label : ""}</div></td>
                        <td>{a.reward_snapshot || "—"}</td>
                        <td>
                          <span className="vr-pill" style={{
                            background: a.status === "entregado" ? "#e8f8f0" : pend ? "#fff8e8" : "#f3f0fa",
                            color: a.status === "entregado" ? "#238a66" : pend ? "#a87514" : "#8d899e",
                          }}>
                            {a.status === "entregado" ? "Entregado" : pend ? "Pendiente" : "Anulado"}
                          </span>
                        </td>
                        <td>{relativeDay(a.awarded_at)}</td>
                        <td>{a.delivered_at ? relativeDay(a.delivered_at) : "—"}</td>
                        <td>
                          {canUpdate && pend && (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button className="vr-btn vr-btn-sm" onClick={() => void deliverAward(a)} disabled={busy === a.id}>
                                {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Entregado
                              </button>
                              <button className="vr-btn-secondary vr-btn-sm" onClick={() => void cancelAward(a)} disabled={busy === a.id}>Anular</button>
                            </div>
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
      )}

      {tab === "puntos" && (
        <>
          <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Puntos vigentes</div>
              <div className="vr-metric-value">{totalPoints.toLocaleString("es-CO")}</div>
            </div>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Clientes en programa</div>
              <div className="vr-metric-value">{accounts.filter((a) => a.points > 0).length}</div>
            </div>
            <div className="vr-metric-card">
              <div className="vr-metric-label">Premios de campaña otorgados</div>
              <div className="vr-metric-value">{awards.filter((a) => a.status !== "anulado").length}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 18, alignItems: "start" }} className="vr-dash-cols">
            <section className="vr-card">
              <h2>Top clientes por puntos</h2>
              {loading ? (
                <EmptyState title="Cargando…" body=" " />
              ) : (
                <div className="vr-table-wrap">
                  <table className="vr-table">
                    <thead>
                      <tr><th>Cliente</th><th>Teléfono</th><th>Nivel</th><th>Puntos</th><th></th></tr>
                    </thead>
                    <tbody>
                      {top.map((a) => (
                        <tr key={a.id}>
                          <td><strong>{a.customer_name ?? "—"}</strong></td>
                          <td>{a.customer_phone ?? "—"}</td>
                          <td><span className="vr-pill vr-pill-gray" style={{ textTransform: "capitalize" }}>{a.tier}</span></td>
                          <td><span className="vr-pill">{a.points} pts</span></td>
                          <td>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => { setRedeem(a); setPoints(Math.min(100, a.points)); }}>
                              <Gift size={12} /> Canjear
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="vr-card">
              <h2>Movimientos recientes</h2>
              {movements.length === 0 ? (
                <EmptyState title="Sin movimientos" body="Aún no hay acumulaciones ni canjes." />
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {movements.slice(0, 10).map((m) => {
                    const earn = m.points_delta >= 0;
                    return (
                      <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span
                          style={{
                            width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
                            background: earn ? "#e8f8f0" : "#fff0f2",
                            color: earn ? "#238a66" : "#ca435c",
                            fontSize: 13, fontWeight: 800,
                          }}
                        >
                          {earn ? "+" : "−"}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            {accounts.find((a) => a.customer_id === m.customer_id)?.customer_name ?? "Cliente"}
                          </div>
                          <div style={{ fontSize: 11, color: "#8d899e" }}>{m.reason}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: earn ? "#238a66" : "#ca435c" }}>
                            {earn ? "+" : ""}{m.points_delta} pts
                          </div>
                          <div style={{ fontSize: 10, color: "#b3aec2" }}>{relativeDay(m.created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* ————— Modal: detalle de campaña (progreso / referidos / ruleta) ————— */}
      <Modal open={detail !== null} title={detail ? `Campaña · ${detail.name}` : ""} onClose={() => setDetail(null)} width={860}>
        {detail && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span className="vr-pill vr-pill-gray">{TYPE_META[detail.program_type].label}</span>
              <span className="vr-pill" style={{ background: detail.active ? "#e8f8f0" : "#f3f0fa", color: detail.active ? "#238a66" : "#7556d8" }}>
                {detail.active ? "Activa" : "Inactiva"}
              </span>
              {(detail.start_date || detail.end_date) && (
                <span className="vr-pill vr-pill-gray">
                  {detail.start_date ? formatDate(detail.start_date) : "sin inicio"} → {detail.end_date ? formatDate(detail.end_date) : "sin fin"}
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, margin: "0 0 4px" }}><strong>Mecánica:</strong> {mechanicText(detail)}</p>
            <p style={{ fontSize: 13, margin: "0 0 4px" }}><strong>Recompensa:</strong> {rewardText(detail)}</p>
            {detail.ad_message && (
              <p style={{ fontSize: 12, margin: "6px 0 12px", background: "#f6f3fd", borderRadius: 10, padding: "9px 11px", color: "#5e5a70", fontStyle: "italic" }}>
                <Megaphone size={11} style={{ display: "inline", marginRight: 5, verticalAlign: "-1px" }} />
                {detail.ad_message}
              </p>
            )}
            <p style={{ fontSize: 11.5, color: "#8d899e", margin: "0 0 14px" }}>{TYPE_META[detail.program_type].hint}</p>

            {detail.program_type === "referidos" ? (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={{ minWidth: 200 }}>
                    <Field label="Cliente que refiere">
                      <select value={refFrom} onChange={(e) => setRefFrom(e.target.value)}>
                        <option value="">Selecciona…</option>
                        {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div style={{ minWidth: 200 }}>
                    <Field label="Amiga referida">
                      <select value={refTo} onChange={(e) => setRefTo(e.target.value)}>
                        <option value="">Selecciona…</option>
                        {customers.filter((c) => c.id !== refFrom).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                      </select>
                    </Field>
                  </div>
                  {canUpdate && (
                    <button className="vr-btn" onClick={() => void registerReferral(detail)} disabled={busy === "ref"}>
                      {busy === "ref" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Registrar referida
                    </button>
                  )}
                </div>
                {detailReferrals.length === 0 ? (
                  <EmptyState title="Sin referidas registradas" body="Registra quién trajo a quién; cuando la amiga haga su primera compra podrás otorgar el premio." />
                ) : (
                  <div className="vr-table-wrap">
                    <table className="vr-table">
                      <thead>
                        <tr><th>Amiga referida</th><th>Traída por</th><th>Primera compra</th><th></th></tr>
                      </thead>
                      <tbody>
                        {detailReferrals.map((r) => {
                          const bought = paidOrders.some((o) => o.customer_id === r.referred_id);
                          const alreadyAwarded = awardRefs.has(r.id);
                          const pairRow: ProgRow = { customer: custMap.get(r.referrer_id) ?? { id: r.referrer_id, full_name: "Cliente", phone: null, birth_date: null, active: true }, value: 1, target: 1, detail: "", qualifies: bought && !alreadyAwarded };
                          return (
                            <tr key={r.id}>
                              <td><strong>{custMap.get(r.referred_id)?.full_name ?? "Cliente"}</strong></td>
                              <td>{custMap.get(r.referrer_id)?.full_name ?? "Cliente"}</td>
                              <td>
                                <span className="vr-pill" style={{ background: bought ? "#e8f8f0" : "#fff8e8", color: bought ? "#238a66" : "#a87514" }}>
                                  {bought ? "Sí ✓" : "Aún no"}
                                </span>
                              </td>
                              <td>
                                {canUpdate && bought && !alreadyAwarded && (
                                  <button className="vr-btn vr-btn-sm" onClick={() => void grantAward(detail, pairRow, r)} disabled={busy === `ref:${r.id}`}>
                                    {busy === `ref:${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />} Otorgar premio
                                  </button>
                                )}
                                {alreadyAwarded && <span style={{ fontSize: 11, color: "#238a66", fontWeight: 700 }}>Premiada ✓</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {detail.reward_type === "puntos" && (
                  <p style={{ fontSize: 11.5, color: "#8d899e", marginTop: 10 }}>
                    Al otorgar, {detail.reward_value} puntos se suman automáticamente a la cuenta de ambas clientas.
                  </p>
                )}
              </>
            ) : detailRows.length === 0 ? (
              <EmptyState
                title={detail.program_type === "ruleta" ? "Nadie tiene giros disponibles" : "Nadie cumple los requisitos aún"}
                body={detail.program_type === "ruleta"
                  ? `Los giros se desbloquean cada ${detail.spins_per_visits} visitas del cliente.`
                  : "A medida que los clientes avancen, verás aquí su progreso para otorgar el premio."}
              />
            ) : (
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th style={{ width: 170 }}>Avance</th>
                      <th>Detalle</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((r) => {
                      const pct = Math.min(100, Math.round((r.value / Math.max(1, r.target)) * 100));
                      return (
                        <tr key={r.customer.id}>
                          <td>
                            <strong>{r.customer.full_name}</strong>
                            <div style={{ fontSize: 10.5, color: "#8d899e" }}>{r.customer.phone ?? ""}</div>
                          </td>
                          <td>
                            <div style={{ fontSize: 11, fontWeight: 700, color: r.qualifies ? "#238a66" : "#5e5a70", marginBottom: 4 }}>
                              {detail.program_type === "retorno" ? `${r.value} días` : `${r.value} / ${r.target}`}
                            </div>
                            <div style={{ height: 6, background: "#efeaf8", borderRadius: 99 }}>
                              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: r.qualifies ? "#238a66" : "#7556d8", borderRadius: 99 }} />
                            </div>
                          </td>
                          <td style={{ fontSize: 11.5 }}>{r.detail}</td>
                          <td>
                            {r.qualifies && canUpdate && programOpen(detail) && (
                              detail.program_type === "ruleta" ? (
                                <button className="vr-btn vr-btn-sm" onClick={() => { setWheel({ customer: r.customer, available: r.spins ?? 1 }); setSpinResult(null); }}>
                                  <RotateCw size={12} /> Girar ruleta
                                </button>
                              ) : (
                                <button className="vr-btn vr-btn-sm" onClick={() => void grantAward(detail, r)} disabled={busy === `${detail.id}:${r.customer.id}`}>
                                  {busy === `${detail.id}:${r.customer.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />} Otorgar premio
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {detail.program_type !== "referidos" && (
              <p style={{ fontSize: 11.5, color: "#8d899e", marginTop: 12 }}>
                Al otorgar un premio, el avance consumido se descuenta para que el cliente pueda volver a cumplir
                {detail.period_days > 0 ? " dentro de la misma ventana de días." : "."}
                {" "}Si un premio está pendiente de entrega, el cliente no vuelve a aparecer hasta que lo entregues o lo anules.
              </p>
            )}
          </>
        )}
      </Modal>

      {/* ————— Modal: editor de campaña ————— */}
      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña"} onClose={() => { setEditorOpen(false); setEditingId(null); }} width={680}>
        {!editingId && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={13} /> Plantillas listas (un clic para pre-llenar)
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="vr-btn-secondary vr-btn-sm"
                  onClick={() => setForm({ ...emptyForm(), ...t.form, name: t.name })}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div style={{ height: 1, background: "#f0eef5", margin: "14px 0" }} />
          </div>
        )}

        <Field label="Nombre de la campaña">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Belleza x 3" />
        </Field>

        <Field label="Mecánica de la campaña">
          <select value={form.program_type} onChange={(e) => setForm({ ...form, program_type: e.target.value as ProgramType })}>
            {(Object.keys(TYPE_META) as ProgramType[]).map((k) => (
              <option key={k} value={k}>{TYPE_META[k].label}</option>
            ))}
          </select>
        </Field>
        <p style={{ fontSize: 11.5, color: "#8d899e", margin: "-6px 0 14px" }}>{TYPE_META[form.program_type].hint}</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
          {form.program_type !== "cumpleanos" && form.program_type !== "referidos" && (
            <Field label={THRESHOLD_LABEL[form.program_type]}>
              <input
                type="number"
                min={1}
                value={form.program_type === "ruleta" ? form.spins_per_visits : form.threshold}
                onChange={(e) => setForm(form.program_type === "ruleta"
                  ? { ...form, spins_per_visits: Math.max(1, Number(e.target.value)) }
                  : { ...form, threshold: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
          )}
          {form.program_type === "ruleta" && (
            <Field label="…visitas por giro">
              <div style={{ fontSize: 11, color: "#8d899e", fontWeight: 500, paddingTop: 4 }}>
                El cliente gana 1 giro cada {form.spins_per_visits} visitas.
              </div>
            </Field>
          )}
          {["visitas", "servicios", "categorias"].includes(form.program_type) && (
            <Field label="Ventana de días (0 = todo el histórico)">
              <select value={form.period_days} onChange={(e) => setForm({ ...form, period_days: Number(e.target.value) })}>
                {[0, 7, 15, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>{d === 0 ? "Histórico completo" : `Últimos ${d} días`}</option>
                ))}
              </select>
            </Field>
          )}
          {form.program_type === "servicios" && (
            <Field label="¿Qué debe acumular el cliente?">
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Scope })}>
                {(Object.keys(SCOPE_META) as Scope[]).map((s) => (
                  <option key={s} value={s}>{SCOPE_META[s]}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {form.program_type === "ruleta" ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <RotateCw size={13} /> Premios de la ruleta
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {form.prizes.map((z, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 90px 38px", gap: 8, alignItems: "center" }}>
                  <input
                    value={z.label}
                    placeholder="Premio (ej.: Manicura gratis)"
                    onChange={(e) => setForm({ ...form, prizes: form.prizes.map((zz, j) => (j === i ? { ...zz, label: e.target.value } : zz)) })}
                  />
                  <select
                    value={z.type}
                    onChange={(e) => setForm({ ...form, prizes: form.prizes.map((zz, j) => (j === i ? { ...zz, type: e.target.value as Prize["type"] } : zz)) })}
                  >
                    <option value="servicio">Servicio gratis</option>
                    <option value="descuento">Descuento %</option>
                    <option value="puntos">Puntos</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={z.value}
                    title="Valor (puntos o %)"
                    onChange={(e) => setForm({ ...form, prizes: form.prizes.map((zz, j) => (j === i ? { ...zz, value: Number(e.target.value) } : zz)) })}
                  />
                  <button type="button" className="vr-btn-secondary vr-btn-sm" aria-label="Quitar premio" onClick={() => setForm({ ...form, prizes: form.prizes.filter((_, j) => j !== i) })}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="vr-btn-secondary vr-btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => setForm({ ...form, prizes: [...form.prizes, { label: "", type: "puntos", value: 100 }] })}
            >
              <Plus size={12} /> Añadir premio
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
            <Field label="Recompensa">
              <select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value as RewardType })}>
                {(Object.keys(REWARD_META) as RewardType[]).map((k) => (
                  <option key={k} value={k}>{REWARD_META[k]}</option>
                ))}
              </select>
            </Field>
            {form.reward_type === "servicio" && (
              <Field label="Servicio de cortesía">
                <select value={form.reward_service_id} onChange={(e) => setForm({ ...form, reward_service_id: e.target.value })}>
                  <option value="">— Elegir servicio (opcional) —</option>
                  {services.filter((s) => s.name).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.category_id ? ` · ${catMap.get(s.category_id)?.name ?? ""}` : ""}</option>
                  ))}
                </select>
              </Field>
            )}
            {(form.reward_type === "descuento" || form.reward_type === "puntos") && (
              <Field label={form.reward_type === "descuento" ? "Porcentaje de descuento" : "Puntos a otorgar"}>
                <input type="number" min={1} value={form.reward_value} onChange={(e) => setForm({ ...form, reward_value: Number(e.target.value) })} />
              </Field>
            )}
            {form.reward_type === "beneficio" && (
              <Field label="Describe el beneficio">
                <input value={form.reward_label} onChange={(e) => setForm({ ...form, reward_label: e.target.value })} placeholder="Ej.: Invitación con beneficio especial" />
              </Field>
            )}
          </div>
        )}

        <Field label="Mecánica (texto que verá el administrador)">
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={autoMechanic(form)}
          />
        </Field>

        <div style={{ height: 12 }} />

        <Field label="Mensaje publicitario para clientes (copiable)">
          <textarea
            rows={3}
            value={form.ad_message}
            onChange={(e) => setForm({ ...form, ad_message: e.target.value })}
            placeholder='Ej.: "¡Tu belleza tiene recompensa! Visítanos 3 veces este mes…"'
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, margin: "14px 0" }}>
          <Field label="Inicio (opcional)">
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Fin (opcional)">
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
          <Field label="Estado">
            <select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
              <option value="1">Activa</option>
              <option value="0">Inactiva (guardar como ejemplo)</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className="vr-btn-secondary" onClick={() => { setEditorOpen(false); setEditingId(null); }}>Cancelar</button>
          <button className="vr-btn" onClick={() => void saveProgram()} disabled={busy === "save"}>
            {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {editingId ? "Guardar cambios" : "Crear campaña"}
          </button>
        </div>
      </Modal>

      {/* ————— Modal: ruleta ————— */}
      <Modal open={wheel !== null} title={wheel ? `Ruleta Beauty · ${wheel.customer.full_name}` : "Ruleta Beauty"} onClose={() => { if (!spinning) { setWheel(null); setSpinResult(null); } }} width={560}>
        {wheel && detail && (
          <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
            <div style={{ fontSize: 12.5, color: "#5e5a70" }}>
              Giros disponibles: <strong>{wheel.available}</strong> · Cada {detail.spins_per_visits} visitas = 1 giro
            </div>
            <div style={{ position: "relative", width: 300, height: 300 }}>
              <div style={{
                position: "absolute", left: "50%", top: -6, transform: "translateX(-50%)", zIndex: 2,
                width: 0, height: 0, borderLeft: "11px solid transparent", borderRight: "11px solid transparent", borderTop: "20px solid #1f1635",
              }} />
              <div
                style={{
                  width: "100%", height: "100%", borderRadius: "50%",
                  border: "8px solid #7556d8",
                  background: `conic-gradient(${(detail.prizes as Prize[]).map((_, i) => {
                    const seg = 360 / Math.max(1, (detail.prizes as Prize[]).length);
                    return `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`;
                  }).join(", ")})`,
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning ? "transform 3s cubic-bezier(0.17,0.67,0.12,1)" : "none",
                  boxShadow: "0 12px 30px rgba(117,86,216,.25)",
                }}
              />
              <div style={{
                position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none",
              }}>
                <div style={{
                  width: 74, height: 74, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center",
                  fontWeight: 800, fontSize: 11, color: "#7556d8", boxShadow: "0 4px 14px rgba(31,22,53,.18)", textAlign: "center", padding: 6,
                }}>
                  VelloRa
                </div>
              </div>
            </div>
            {spinResult ? (
              <div style={{ textAlign: "center", display: "grid", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#238a66" }}>
                  🎉 ¡{wheel.customer.full_name} ganó: {spinResult.label}!
                </div>
                <div style={{ fontSize: 11.5, color: "#8d899e" }}>
                  Premio registrado como entregado{spinResult.type === "puntos" ? ` y ${spinResult.value} puntos sumados a su cuenta.` : "."}
                </div>
                <button className="vr-btn" onClick={() => { setWheel(null); setSpinResult(null); }}>
                  <Check size={14} /> Listo
                </button>
              </div>
            ) : (
              <button className="vr-btn" disabled={spinning || wheel.available < 1} onClick={() => startSpin((detail.prizes as Prize[]).length)}>
                {spinning ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                {spinning ? "Girando…" : "Girar ruleta"}
              </button>
            )}
            <div style={{ fontSize: 11, color: "#b3aec2", textAlign: "center" }}>
              Premios: {((detail.prizes as Prize[]) ?? []).map((z) => z.label).filter(Boolean).join(" · ")}
            </div>
          </div>
        )}
      </Modal>

      {/* ————— Modal: canje de puntos ————— */}
      <Modal open={redeem !== null} title={`Canjear puntos · ${redeem?.customer_name ?? ""}`} onClose={() => setRedeem(null)} width={380}>
        {redeem && (
          <>
            <p style={{ fontSize: 13, marginBottom: 12 }}>
              Puntos disponibles: <strong>{redeem.points}</strong>
            </p>
            <Field label="Puntos a canjear">
              <input type="number" min={1} max={redeem.points} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="vr-btn-secondary" onClick={() => setRedeem(null)}>Cancelar</button>
              <button className="vr-btn" onClick={() => void doRedeem()}>Confirmar canje</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
