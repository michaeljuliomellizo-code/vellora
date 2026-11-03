"use client";

/* VelloRa ERP — Módulo Marketing y Crecimiento:
   dashboard, campañas publicitarias, segmentación inteligente, centro de
   comunicación (WhatsApp/correo), automatizaciones, calendario comercial,
   contenido y estadísticas con ROAS. Conectado con Clientes, Agenda,
   Servicios, Ventas y Fidelización. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, RefreshCw, Plus, Megaphone, Users, Send, CalendarDays, Sparkles, BarChart3,
  Copy, Check, Trophy, Trash2, Pencil, Zap, Ticket, Star, Lightbulb, MessageCircle,
} from "lucide-react";
import type { OrganizationContext } from "@/lib/vellora/types";
import { can } from "@/lib/vellora/permissions";
import { formatCOP, formatDateShort, relativeDay } from "@/lib/vellora/format";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import {
  buildCustomerIndex, evalSegment, attributeCampaign, personalize, firstName, waPhone,
  planAtLeast, runAutomation,
  TYPE_META, STATUS_META, EVENT_META,
  type MktCampaign, type MktSegment, type MktMessage, type MktAutomation,
  type MktCommercialDate, type MktCampaignType, type MktStatus, type MktFilters,
  type SegmentMatch, type RawOrder,
} from "@/lib/vellora/marketing";
import { PageHeader, EmptyState, Modal, Field } from "../ui-bits";

/* ————— Constantes locales ————— */

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const CHANNELS = ["WhatsApp", "Instagram", "Facebook", "Correo", "SMS"];

const CONTENT_TEMPLATES: { title: string; tag: string; text: string }[] = [
  {
    title: "Post de promoción (Instagram/Facebook)",
    tag: "Redes",
    text: "✨ ¡{salon} tiene algo para ti! ✨\n\nPor tiempo limitado: {beneficio}.\n\n💜 Atención personalizada\n💜 Productos profesionales\n💜 Agenda flexible\n\n📍 Reserva tu cita por WhatsApp. ¡Te esperamos!",
  },
  {
    title: "Historia con llamada a la acción",
    tag: "Redes",
    text: "CUPOS LIMITADOS ⏰\n{beneficio} en {salon}.\nDesliza hacia arriba y reserva hoy. 💜 #Belleza #{salon}",
  },
  {
    title: "Mensaje masivo de campaña (WhatsApp)",
    tag: "WhatsApp",
    text: "¡Hola {nombre}! 👋 Somos {salon} y queremos contarte que tenemos {beneficio}. Reserva esta semana y aprovecha tu beneficio. ¿Te apartamos un cupo?",
  },
  {
    title: "Correo de boletín mensual",
    tag: "Correo",
    text: "Asunto: Novedades de {salon} para ti 💜\n\nHola {nombre}:\n\nEste mes en {salon}: {beneficio}.\nAdemás, como clienta fiel, tienes acceso prioritario a nuestra agenda.\n\nReserva respondiendo a este correo o por WhatsApp.\n¡Nos vemos pronto!",
  },
  {
    title: "Recuperación de clientes inactivos",
    tag: "WhatsApp",
    text: "¡{nombre}, te extrañamos! 😊 En {salon} preparamos {beneficio} para tu regreso. Tenemos cupos esta semana: ¿cuál te queda mejor?",
  },
  {
    title: "Lanzamiento de servicio nuevo",
    tag: "Redes",
    text: "🆕 ¡NUEVO en {salon}!\n{beneficio}\n\nSé de las primeras en probarlo con un beneficio de lanzamiento. Agenda por WhatsApp. 💜",
  },
];

type CmpForm = {
  name: string; description: string; objective: string; campaign_type: MktCampaignType;
  channel: string; status: MktStatus; budget: string; starts_on: string; ends_on: string;
  promo_code: string; discount_percent: number; max_uses: number; service_ids: string[];
  segment_id: string; conditions: string; image_url: string; content: string;
};

function emptyCmpForm(): CmpForm {
  return {
    name: "", description: "", objective: "", campaign_type: "promocional", channel: "WhatsApp",
    status: "draft", budget: "", starts_on: "", ends_on: "", promo_code: "", discount_percent: 0,
    max_uses: 0, service_ids: [], segment_id: "", conditions: "", image_url: "", content: "",
  };
}

type BuilderState = {
  minVisits: string; maxDaysSinceVisit: string; minTotalSpend: string; serviceId: string;
  birthdayInDays: string; hasWhatsApp: boolean; hasEmail: boolean; newOnly: boolean;
};

function emptyBuilder(): BuilderState {
  return { minVisits: "", maxDaysSinceVisit: "", minTotalSpend: "", serviceId: "", birthdayInDays: "", hasWhatsApp: false, hasEmail: false, newOnly: false };
}

/* ————— Componente ————— */

export default function MarketingView({ ctx }: { ctx: OrganizationContext }) {
  type Tab = "dashboard" | "campanas" | "segmentos" | "comunicacion" | "automatizacion" | "calendario" | "contenido" | "estadisticas";
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [campaigns, setCampaigns] = useState<MktCampaign[]>([]);
  const [segments, setSegments] = useState<MktSegment[]>([]);
  const [messages, setMessages] = useState<MktMessage[]>([]);
  const [automations, setAutomations] = useState<MktAutomation[]>([]);
  const [dates, setDates] = useState<MktCommercialDate[]>([]);
  const [customers, setCustomers] = useState<{ id: string; full_name: string; phone: string | null; whatsapp: string | null; email: string | null; birth_date: string | null; active: boolean; marketing_consent: boolean; created_at: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; category_id: string | null; active: boolean }[]>([]);
  const [orders, setOrders] = useState<RawOrder[]>([]);
  const [paidItems, setPaidItems] = useState<{ order_id: string; service_id: string | null }[]>([]);
  const [doneAppts, setDoneAppts] = useState<{ customer_id: string | null; starts_at: string }[]>([]);
  const [futureAppts, setFutureAppts] = useState<{ customer_id: string | null; starts_at: string }[]>([]);
  const [referrals, setReferrals] = useState<{ referrer_id: string; referred_id: string }[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CmpForm>(emptyCmpForm());

  const [segResult, setSegResult] = useState<{ title: string; matches: SegmentMatch[] } | null>(null);
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder());
  const [saveName, setSaveName] = useState("");

  const [commFilters, setCommFilters] = useState<MktFilters | null>(null);
  const [commTitle, setCommTitle] = useState("");
  const [template, setTemplate] = useState("¡Hola {nombre}! 👋 Somos {salon} y tenemos un beneficio especial para ti: {beneficio}. ¿Te apartamos un cupo esta semana?");
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [commCampaign, setCommCampaign] = useState("");
  const [onlyConsent, setOnlyConsent] = useState(true);
  const [commList, setCommList] = useState<SegmentMatch[]>([]);
  const [commSent, setCommSent] = useState<Set<string>>(new Set());

  const [autoEdit, setAutoEdit] = useState<MktAutomation | null>(null);
  const [autoTemplate, setAutoTemplate] = useState("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [statsWindow, setStatsWindow] = useState(30);

  const canCreate = can(ctx.permissions, "marketing", "can_create");
  const canUpdate = can(ctx.permissions, "marketing", "can_update");
  const planKey = ctx.subscription?.plan?.plan_key ?? "";
  const isPro = planAtLeast(planKey, "profesional");
  const isElite = planAtLeast(planKey, "elite");

  /* ————— Carga ————— */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const org = ctx.organizationId;
      const [cRes, sRes, mRes, aRes, dRes, cusRes, svcRes, ordRes, apptRes, futRes] = await Promise.all([
        sb.from("marketing_campaigns").select("*").eq("organization_id", org).order("created_at", { ascending: false }),
        sb.from("mk_segments").select("*").eq("organization_id", org).order("created_at", { ascending: true }),
        sb.from("mk_messages").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(800),
        sb.from("mk_automations").select("*").eq("organization_id", org).order("event"),
        sb.from("mk_commercial_dates").select("*").eq("organization_id", org).eq("active", true).order("month"),
        sb.from("customers").select("id, full_name, phone, whatsapp, email, birth_date, active, marketing_consent, created_at").eq("organization_id", org).eq("active", true),
        sb.from("services").select("id, name, category_id, active").eq("organization_id", org),
        sb.from("service_orders").select("id, customer_id, created_at, total").eq("organization_id", org).eq("status", "paid"),
        sb.from("appointments").select("customer_id, starts_at").eq("organization_id", org).eq("status", "completed"),
        sb.from("appointments").select("customer_id, starts_at").eq("organization_id", org).gte("starts_at", new Date(Date.now() - 86400000).toISOString()),
      ]);
      const firstErr = [cRes, sRes, mRes, aRes, dRes, cusRes, svcRes, ordRes, apptRes, futRes].find((r) => r.error);
      if (firstErr?.error) throw new Error(firstErr.error.message);

      const ords = ((ordRes.data ?? []) as unknown) as RawOrder[];
      let items: { order_id: string; service_id: string | null }[] = [];
      if (ords.length > 0) {
        const { data: itData, error: itErr } = await sb.from("service_order_items").select("order_id, service_id").in("order_id", ords.map((o) => o.id));
        if (itErr) throw new Error(itErr.message);
        items = ((itData ?? []) as unknown) as typeof items;
      }
      try {
        const { data: refData } = await sb.from("loyalty_referrals").select("referrer_id, referred_id").eq("organization_id", org);
        setReferrals(((refData ?? []) as unknown) as { referrer_id: string; referred_id: string }[]);
      } catch { setReferrals([]); }

      setCampaigns(((cRes.data ?? []) as unknown) as MktCampaign[]);
      setSegments(((sRes.data ?? []) as unknown) as MktSegment[]);
      setMessages(((mRes.data ?? []) as unknown) as MktMessage[]);
      setAutomations(((aRes.data ?? []) as unknown) as MktAutomation[]);
      setDates(((dRes.data ?? []) as unknown) as MktCommercialDate[]);
      setCustomers(((cusRes.data ?? []) as unknown) as typeof customers);
      setServices(((svcRes.data ?? []) as unknown) as typeof services);
      setOrders(ords);
      setPaidItems(items);
      setDoneAppts(((apptRes.data ?? []) as unknown) as { customer_id: string | null; starts_at: string }[]);
      setFutureAppts(((futRes.data ?? []) as unknown) as { customer_id: string | null; starts_at: string }[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar marketing");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ————— Índice y derivados ————— */

  const index = useMemo(
    () => buildCustomerIndex(
      customers,
      orders,
      paidItems,
      doneAppts
    ),
    [customers, orders, paidItems, doneAppts]
  );
  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const segMap = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  const attrByCampaign = useMemo(() => {
    const m = new Map<string, { sent: number; buyers: number; revenue: number }>();
    for (const c of campaigns) {
      const a = attributeCampaign(c.id, messages, orders, 30);
      m.set(c.id, a);
    }
    return m;
  }, [campaigns, messages, orders]);

  /* ————— Acciones: campañas ————— */

  async function saveCampaign() {
    if (!form.name.trim()) { setError("La campaña necesita un nombre."); return; }
    setBusy("save");
    try {
      const sb = supabaseBrowser();
      const payload = {
        organization_id: ctx.organizationId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        objective: form.objective.trim() || null,
        content: form.content.trim() || null,
        campaign_type: form.campaign_type,
        channel: form.channel,
        status: form.status,
        budget: Number(form.budget || 0),
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        promo_code: form.promo_code.trim().toUpperCase() || null,
        discount_percent: form.discount_percent,
        max_uses: form.max_uses,
        service_ids: form.service_ids,
        segment_id: form.segment_id || null,
        conditions: form.conditions.trim() || null,
        image_url: form.image_url.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let e: string | null = null;
      if (editingId) {
        const r = await sb.from("marketing_campaigns").update(payload).eq("id", editingId);
        e = r.error?.message ?? null;
      } else {
        const r = await sb.from("marketing_campaigns").insert({ ...payload, created_by: ctx.user.id });
        e = r.error?.message ?? null;
      }
      if (e) throw new Error(e);
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

  async function addUse(c: MktCampaign) {
    setBusy(c.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("marketing_campaigns").update({ uses_count: c.uses_count + 1, updated_at: new Date().toISOString() }).eq("id", c.id);
    setBusy("");
    if (e) { setError(`No fue posible registrar el uso: ${e.message}`); return; }
    setNotice(`Uso del código ${c.promo_code ?? ""} registrado.`);
    await load();
  }

  async function removeCampaign(c: MktCampaign) {
    if (!window.confirm(`¿Eliminar la campaña "${c.name}"?`)) return;
    setBusy(c.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("marketing_campaigns").delete().eq("id", c.id);
    setBusy("");
    if (e) { setError(`No fue posible eliminar: ${e.message}`); return; }
    setNotice("Campaña eliminada.");
    await load();
  }

  /* ————— Acciones: segmentos ————— */

  function builderFilters(): MktFilters {
    const f: MktFilters = {};
    if (Number(builder.minVisits) > 0) f.minVisits = Number(builder.minVisits);
    if (Number(builder.maxDaysSinceVisit) > 0) f.maxDaysSinceVisit = Number(builder.maxDaysSinceVisit);
    if (Number(builder.minTotalSpend) > 0) f.minTotalSpend = Number(builder.minTotalSpend);
    if (builder.serviceId) f.serviceId = builder.serviceId;
    if (Number(builder.birthdayInDays) > 0) f.birthdayInDays = Number(builder.birthdayInDays);
    if (builder.hasWhatsApp) f.hasWhatsApp = true;
    if (builder.hasEmail) f.hasEmail = true;
    if (builder.newOnly) f.newOnly = true;
    return f;
  }

  function calcBuilder() {
    const f = builderFilters();
    if (Object.keys(f).length === 0) { setError("Elige al menos un filtro para calcular el segmento."); return; }
    const matches = evalSegment(f, index, new Date());
    setSegResult({ title: "Segmento personalizado", matches });
  }

  async function saveSegment() {
    if (!saveName.trim()) { setError("Ponle un nombre al segmento."); return; }
    setBusy("saveSeg");
    try {
      const sb = supabaseBrowser();
      const { error: e } = await sb.from("mk_segments").insert({
        organization_id: ctx.organizationId, name: saveName.trim(),
        description: "Segmento personalizado del administrador",
        filters: builderFilters(), is_preset: false,
      });
      if (e) throw new Error(e.message);
      setSaveName("");
      setNotice("Segmento guardado.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible guardar el segmento");
    } finally {
      setBusy("");
    }
  }

  async function removeSegment(s: MktSegment) {
    if (!window.confirm(`¿Eliminar el segmento "${s.name}"?`)) return;
    setBusy(s.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("mk_segments").delete().eq("id", s.id);
    setBusy("");
    if (e) { setError(`No fue posible eliminar: ${e.message}`); return; }
    await load();
  }

  /* ————— Acciones: comunicación ————— */

  function useSegmentInComms(s: MktSegment) {
    setCommFilters(s.filters);
    setCommTitle(s.name);
    setTab("comunicacion");
    setCommList([]);
  }

  function generateCommList() {
    if (!commFilters) { setError("Selecciona un público objetivo."); return; }
    const matches = evalSegment(commFilters, index, new Date()).filter(({ c }) => {
      if (onlyConsent && !c.marketing_consent) return false;
      if (channel === "whatsapp" && !waPhone(c.whatsapp ?? c.phone)) return false;
      if (channel === "email" && !c.email) return false;
      return true;
    });
    setCommList(matches);
    setCommSent(new Set());
    if (matches.length === 0) setNotice("Ningún cliente cumple los criterios con esos filtros de canal/consentimiento.");
  }

  async function logAndOpen(custId: string) {
    const c = custMap.get(custId);
    if (!c) return;
    const body = personalize(template, { nombre: firstName(c.full_name), salon: ctx.organization.name, codigo: campaigns.find((x) => x.id === commCampaign)?.promo_code ?? "" });
    const sb = supabaseBrowser();
    let opened = false;
    if (channel === "whatsapp") {
      const phone = waPhone(c.whatsapp ?? c.phone);
      if (!phone) { setError("El cliente no tiene WhatsApp registrado."); return; }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, "_blank");
      opened = true;
    } else {
      const subject = `Novedades de ${ctx.organization.name}`;
      window.open(`mailto:${c.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_self");
      opened = true;
    }
    if (opened) {
      const { error: e } = await sb.from("mk_messages").insert({
        organization_id: ctx.organizationId,
        campaign_id: commCampaign || null,
        customer_id: custId,
        channel,
        subject: channel === "email" ? `Novedades de ${ctx.organization.name}` : null,
        body,
        status: "enviado",
        sent_at: new Date().toISOString(),
        created_by: ctx.user.id,
      });
      if (e) { setError(`Mensaje abierto, pero falló el registro: ${e.message}`); return; }
      setCommSent((prev) => new Set(prev).add(custId));
      await load();
    }
  }

  async function sendQueued(m: MktMessage) {
    const c = custMap.get(m.customer_id);
    if (!c) return;
    const sb = supabaseBrowser();
    if (m.channel === "whatsapp") {
      const phone = waPhone(c.whatsapp ?? c.phone);
      if (!phone) { setError("El cliente no tiene WhatsApp registrado."); return; }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(m.body)}`, "_blank");
    } else if (m.channel === "email") {
      window.open(`mailto:${c.email ?? ""}?subject=${encodeURIComponent(m.subject ?? "Mensaje de " + ctx.organization.name)}&body=${encodeURIComponent(m.body)}`, "_self");
    }
    const { error: e } = await sb.from("mk_messages").update({ status: "enviado", sent_at: new Date().toISOString() }).eq("id", m.id);
    if (e) { setError(`No fue posible marcar el envío: ${e.message}`); return; }
    await load();
  }

  async function discardQueued(m: MktMessage) {
    setBusy(m.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("mk_messages").update({ status: "fallido" }).eq("id", m.id);
    setBusy("");
    if (e) { setError(`No fue posible descartar: ${e.message}`); return; }
    await load();
  }

  /* ————— Acciones: automatización ————— */

  async function runAutomationNow(a: MktAutomation) {
    setBusy(a.id);
    try {
      const sb = supabaseBrowser();
      const now = new Date();
      const yesterdayStart = new Date(now.getTime() - 2 * 86400000);
      const completedYesterday = doneAppts.filter((x) => {
        const t = new Date(x.starts_at).getTime();
        return t >= yesterdayStart.getTime() && t < now.getTime() - 86400000 * 0.5;
      });
      const soldIds = new Set<string>();
      const paidById = new Map(orders.map((o) => [o.id, o]));
      for (const it of paidItems) {
        const o = paidById.get(it.order_id);
        if (!o || !it.service_id) continue;
        if (now.getTime() - new Date(o.created_at).getTime() <= 60 * 86400000) soldIds.add(it.service_id);
      }
      const lowDemand = services.filter((s) => s.active && !soldIds.has(s.id)).map((s) => s.name);
      const res = runAutomation(a, index, {
        now, orgName: ctx.organization.name, referrals, futureAppts,
        completedApptsYesterday: completedYesterday, lowDemandServiceNames: lowDemand,
      }, messages);
      if (a.action_channel === "tarea" || a.event === "baja_demanda") {
        await sb.from("mk_automations").update({ last_run_at: now.toISOString() }).eq("id", a.id);
        setNotice(res.suggestion ?? "Sugerencia revisada. Revisa el Dashboard.");
        await load();
        return;
      }
      if (res.outputs.length === 0) {
        await sb.from("mk_automations").update({ last_run_at: now.toISOString() }).eq("id", a.id);
        setNotice(`Sin clientes que cumplan el evento en este momento. (${res.skipped} omitidos por frecuencia)`);
        await load();
        return;
      }
      const rows = res.outputs.map((o) => ({
        organization_id: ctx.organizationId,
        automation_id: a.id,
        customer_id: o.customer_id,
        channel: a.action_channel === "email" ? "email" : "whatsapp",
        subject: a.action_channel === "email" ? a.name : null,
        body: o.body,
        status: "pendiente",
        created_by: ctx.user.id,
      }));
      const { error: e } = await sb.from("mk_messages").insert(rows);
      if (e) throw new Error(e.message);
      await sb.from("mk_automations").update({ last_run_at: now.toISOString() }).eq("id", a.id);
      setNotice(`${res.outputs.length} mensaje(s) generados en la cola de Comunicación (envíalos con un clic).${res.suggestion ? " " + res.suggestion : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible ejecutar la automatización");
    } finally {
      setBusy("");
    }
  }

  async function toggleAutomation(a: MktAutomation) {
    setBusy(a.id);
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("mk_automations").update({ active: !a.active }).eq("id", a.id);
    setBusy("");
    if (e) { setError(`No fue posible cambiar el estado: ${e.message}`); return; }
    setNotice(!a.active ? `Automatización "${a.name}" activada.` : `Automatización "${a.name}" desactivada.`);
    await load();
  }

  async function saveAutomationTemplate() {
    if (!autoEdit) return;
    setBusy("auto");
    const sb = supabaseBrowser();
    const { error: e } = await sb.from("mk_automations").update({ template: autoTemplate, max_per_days: autoEdit.max_per_days }).eq("id", autoEdit.id);
    setBusy("");
    if (e) { setError(`No fue posible guardar: ${e.message}`); return; }
    setAutoEdit(null);
    setNotice("Automatización actualizada.");
    await load();
  }

  /* ————— Dashboard: cálculos ————— */

  const dash = useMemo(() => {
    const now = new Date();
    const in30 = now.getTime() - 30 * 86400000;
    const in90 = now.getTime() - 90 * 86400000;

    const newCustomers = customers.filter((c) => new Date(c.created_at).getTime() >= in30).length;

    let recovered = 0;
    let recurrent = 0;
    for (const c of index.values()) {
      if (!c.active) continue;
      if (c.visitDays.length >= 2) {
        const last = new Date(`${c.lastVisit ?? ""}T12:00:00`).getTime();
        const prev = new Date(`${c.visitDays[c.visitDays.length - 2] ?? ""}T12:00:00`).getTime();
        if (last >= in30 && last - prev >= 45 * 86400000) recovered += 1;
        if (last >= in90) recurrent += 1;
      }
    }

    const activeCampaigns = campaigns.filter((c) => c.status === "active" && (!c.ends_on || new Date(`${c.ends_on}T23:59:59`) >= now)).length;

    // Contactados y convertidos en los últimos 30 días (ventana de atribución 30 días)
    const firstMsgByCustomer = new Map<string, { t: number; campaignId: string | null }>();
    for (const m of messages) {
      if (m.status !== "enviado" || !m.sent_at) continue;
      const t = new Date(m.sent_at).getTime();
      if (t < in30) continue;
      const prev = firstMsgByCustomer.get(m.customer_id);
      if (!prev || t < prev.t) firstMsgByCustomer.set(m.customer_id, { t, campaignId: m.campaign_id });
    }
    let converted = 0;
    let revenue30 = 0;
    let orders30 = 0;
    const campaignRevenue = new Map<string, number>();
    for (const [cid, info] of firstMsgByCustomer) {
      const until = Math.min(info.t + 30 * 86400000, now.getTime());
      let bought = false;
      for (const o of orders) {
        if (o.customer_id !== cid) continue;
        const t = new Date(o.created_at).getTime();
        if (t >= info.t && t <= until) {
          bought = true; revenue30 += Number(o.total ?? 0); orders30 += 1;
          if (info.campaignId) campaignRevenue.set(info.campaignId, (campaignRevenue.get(info.campaignId) ?? 0) + Number(o.total ?? 0));
        }
      }
      if (bought) converted += 1;
    }
    const contacted = firstMsgByCustomer.size;
    const conversion = contacted > 0 ? (converted / contacted) * 100 : 0;
    const avgTicket = orders30 > 0 ? revenue30 / orders30 : 0;

    const campaignsTouched = new Set([...messages.filter((m) => m.status === "enviado" && m.campaign_id && new Date(m.sent_at ?? "").getTime() >= in90)].map((m) => m.campaign_id));
    const invest = campaigns.filter((c) => campaignsTouched.has(c.id)).reduce((s, c) => s + Number(c.budget ?? 0), 0);
    const roas = invest > 0 ? revenue30 / invest : 0;

    const revenueByCampaign = campaigns
      .map((c) => ({ c, revenue: campaignRevenue.get(c.id) ?? 0 }))
      .filter((x) => x.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const roasList = campaigns
      .map((c) => ({ c, roas: Number(c.budget) > 0 ? (attrByCampaign.get(c.id)?.revenue ?? 0) / Number(c.budget) : 0 }))
      .filter((x) => x.roas > 0)
      .sort((a, b) => b.roas - a.roas);

    const followup = evalSegment({ preset: "inactivos", days: 45 }, index, now)
      .sort((a, b) => b.c.totalSpend - a.c.totalSpend).slice(0, 5);

    const nextDates = [...dates]
      .map((d) => ({ d, dist: (d.month - (now.getMonth() + 1) + 12) % 12 }))
      .sort((a, b) => a.dist - b.dist || (a.d.day ?? 0) - (b.d.day ?? 0))
      .slice(0, 4)
      .map((x) => x.d);

    const svcCount = new Map<string, number>();
    for (const c of campaigns) for (const sid of (c.service_ids ?? []) as string[]) svcCount.set(sid, (svcCount.get(sid) ?? 0) + 1);
    const topServices = [...svcCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([sid, n]) => ({ name: services.find((s) => s.id === sid)?.name ?? "Servicio", n }));

    // Ocupación por día de la semana (últimos 30 días)
    const weekday = [0, 0, 0, 0, 0, 0, 0];
    for (const a of doneAppts) {
      if (new Date(a.starts_at).getTime() >= in30) {
        const wd = (new Date(a.starts_at).getDay() + 6) % 7;
        weekday[wd] += 1;
      }
    }
    let minWd = -1;
    for (let i = 0; i < 7; i++) if (minWd === -1 || weekday[i] < weekday[minWd]) minWd = i;

    const sold60 = new Set<string>();
    const paidById = new Map(orders.map((o) => [o.id, o]));
    for (const it of paidItems) {
      const o = paidById.get(it.order_id);
      if (!o || !it.service_id) continue;
      if (now.getTime() - new Date(o.created_at).getTime() <= 60 * 86400000) sold60.add(it.service_id);
    }
    const lowDemand = services.filter((s) => s.active && !sold60.has(s.id)).map((s) => s.name);

    const potenciales = evalSegment({ preset: "potenciales" }, index, now).length;
    const birthdays = evalSegment({ preset: "cumpleanos", days: 30 }, index, now).length;

    return { newCustomers, recovered, recurrent, activeCampaigns, contacted, converted, conversion, revenue30, avgTicket, invest, roas, revenueByCampaign, roasList, followup, nextDates, topServices, minWd, lowDemand, potenciales, birthdays };
  }, [campaigns, messages, orders, customers, index, dates, services, doneAppts, paidItems, attrByCampaign]);

  /* ————— Estadísticas ————— */

  const stats = useMemo(() => {
    return campaigns.map((c) => {
      const a = attributeCampaign(c.id, messages, orders, statsWindow);
      const sent = messages.filter((m) => m.campaign_id === c.id && m.status === "enviado").length;
      const conv = a.sent > 0 ? (a.buyers / a.sent) * 100 : 0;
      const budget = Number(c.budget ?? 0);
      const roas = budget > 0 ? a.revenue / budget : 0;
      const redemption = c.max_uses > 0 ? (c.uses_count / c.max_uses) * 100 : 0;
      return { c, ...a, sent, conv, budget, roas, redemption };
    }).filter((r) => r.sent > 0 || r.budget > 0 || r.c.promo_code).sort((a, b) => b.revenue - a.revenue);
  }, [campaigns, messages, orders, statsWindow]);

  const maxRevenue = Math.max(1, ...dash.revenueByCampaign.map((x) => x.revenue));

  /* ————— Calendario ————— */

  const calGrid = useMemo(() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const startWd = (first.getDay() + 6) % 7; // lunes primero
    const daysIn = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const cells: { day: number | null }[] = [];
    for (let i = 0; i < startWd; i++) cells.push({ day: null });
    for (let d = 1; d <= daysIn; d++) cells.push({ day: d });
    return cells;
  }, [calMonth]);

  function campaignsOnDay(day: number): MktCampaign[] {
    const key = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return campaigns.filter((c) => (c.starts_on && c.starts_on <= key) && (!c.ends_on || c.ends_on >= key) && (c.status === "active" || c.status === "scheduled"));
  }

  function datesOnMonth(day: number | null): MktCommercialDate[] {
    return dates.filter((d) => d.month === calMonth.m + 1 && (d.day === day || (d.day === null && day === 1)));
  }

  const queue = messages.filter((m) => m.status === "pendiente");
  const presets = segments.filter((s) => s.is_preset);
  const customs = segments.filter((s) => !s.is_preset);

  /* ————— Render auxiliares ————— */

  function MetricCard2({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
      <div className="vr-metric-card">
        <div className="vr-metric-label">{label}</div>
        <div className="vr-metric-value">{value}</div>
        {note && <div className="vr-metric-note">{note}</div>}
      </div>
    );
  }

  function SegTable({ matches }: { matches: SegmentMatch[] }) {
    if (matches.length === 0) return <EmptyState title="Sin resultados" body="Ningún cliente cumple los criterios." />;
    return (
      <div className="vr-table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
        <table className="vr-table">
          <thead><tr><th>Cliente</th><th>Criterio</th><th>Gasto</th><th>Última visita</th><th>Contacto</th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.c.id}>
                <td><strong>{m.c.full_name}</strong></td>
                <td style={{ fontSize: 11.5 }}>{m.why}</td>
                <td>{m.c.totalSpend > 0 ? formatCOP(m.c.totalSpend, { compact: true }) : "—"}</td>
                <td>{m.c.lastVisit ? formatDateShort(m.c.lastVisit) : "—"}</td>
                <td>{m.c.whatsapp ?? m.c.phone ?? m.c.email ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  /* ————— Render ————— */

  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }>; lock?: boolean }[] = [
    { key: "dashboard", label: "Dashboard", icon: Megaphone },
    { key: "campanas", label: "Campañas", icon: Ticket },
    { key: "segmentos", label: "Segmentos", icon: Users },
    { key: "comunicacion", label: "Comunicación", icon: Send },
    { key: "automatizacion", label: "Automático", icon: Zap, lock: !isPro },
    { key: "calendario", label: "Calendario", icon: CalendarDays },
    { key: "contenido", label: "Contenido", icon: Sparkles },
    { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
  ];

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Marketing y crecimiento"
        subtitle="Atrae, recupera y fideliza clientes: campañas, segmentos, comunicación y resultados."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => { setForm(emptyCmpForm()); setEditingId(null); setEditorOpen(true); }}>
                <Plus size={14} /> Nueva campaña
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Secciones de marketing">
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
              {t.lock && <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>PRO</span>}
            </button>
          );
        })}
      </div>

      {/* ———————————— DASHBOARD ———————————— */}
      {tab === "dashboard" && (
        <>
          <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
            <MetricCard2 label="Clientes nuevos (30d)" value={String(dash.newCustomers)} note="Registrados este mes" />
            <MetricCard2 label="Clientes recuperados" value={String(dash.recovered)} note="Volvieron tras ≥45 días inactivos" />
            <MetricCard2 label="Campañas activas" value={String(dash.activeCampaigns)} note={`${campaigns.length} en total`} />
            <MetricCard2 label="Ingresos por marketing" value={formatCOP(dash.revenue30, { compact: true })} note="Ventas tras mensajes (30d)" />
            <MetricCard2 label="Tasa de conversión" value={`${dash.conversion.toFixed(1)}%`} note={`${dash.converted} de ${dash.contacted} contactados`} />
            <MetricCard2 label="Ticket promedio" value={formatCOP(dash.avgTicket, { compact: true })} note="Clientes captados por campañas" />
            <MetricCard2 label="Clientes recurrentes" value={String(dash.recurrent)} note="2+ visitas en 90 días" />
            <MetricCard2 label="ROAS de marketing" value={dash.roas > 0 ? `${dash.roas.toFixed(2)}x` : "—"} note={`Inversión: ${formatCOP(dash.invest, { compact: true })}`} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16, alignItems: "start" }}>
            <section className="vr-card">
              <h2>Ingresos por campaña (últimos 30 días)</h2>
              {dash.revenueByCampaign.length === 0 ? (
                <EmptyState title="Aún sin ingresos atribuidos" body="Cuando envíes mensajes de una campaña y los clientes compren, verás aquí los ingresos por campaña." />
              ) : (
                <div style={{ display: "grid", gap: 9 }}>
                  {dash.revenueByCampaign.slice(0, 6).map(({ c, revenue }) => (
                    <div key={c.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ fontWeight: 700, color: "#7556d8" }}>{formatCOP(revenue, { compact: true })}</span>
                      </div>
                      <div style={{ height: 7, background: "#efeaf8", borderRadius: 99 }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.round((revenue / maxRevenue) * 100)}%`, background: "#7556d8", borderRadius: 99 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="vr-card">
              <h2><Trophy size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Campañas con mejor rendimiento</h2>
              {dash.roasList.length === 0 ? (
                <EmptyState title="Sin ROAS calculable" body="Asigna presupuesto a tus campañas y envía mensajes para medir el retorno." />
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {dash.roasList.slice(0, 3).map(({ c, roas }) => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span className="vr-pill" style={{ background: "#e8f8f0", color: "#238a66" }}>{roas.toFixed(2)}x</span>
                    </div>
                  ))}
                </div>
              )}
              <h2 style={{ marginTop: 16 }}><Star size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Próximas fechas comerciales</h2>
              <div style={{ display: "grid", gap: 6 }}>
                {dash.nextDates.map((d) => (
                  <div key={d.id} style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="vr-pill vr-pill-gray" style={{ minWidth: 84, textAlign: "center" }}>
                      {d.day ? `${d.day} ${MONTHS[d.month - 1].slice(0, 3)}` : MONTHS[d.month - 1]}
                    </span>
                    <span>{d.name}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="vr-card">
              <h2><Users size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Clientes que necesitan seguimiento</h2>
              {dash.followup.length === 0 ? (
                <EmptyState title="Todo al día" body="Ningún cliente con gasto alto está inactivo por ahora." />
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {dash.followup.map((m) => (
                    <div key={m.c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{m.c.full_name}</span>
                      <span style={{ color: "#a87514" }}>{m.why} · {formatCOP(m.c.totalSpend, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              )}
              <h2 style={{ marginTop: 16 }}><Sparkles size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Servicios más promocionados</h2>
              {dash.topServices.length === 0 ? (
                <p style={{ fontSize: 12, color: "#8d899e" }}>Aún no promocionas servicios específicos en tus campañas.</p>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {dash.topServices.map((s) => (
                    <span key={s.name} className="vr-pill vr-pill-gray">{s.name} · {s.n} campañas</span>
                  ))}
                </div>
              )}
            </section>

            <section className="vr-card">
              <h2><Lightbulb size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Recomendaciones de oportunidad</h2>
              {isElite ? (
                <div style={{ display: "grid", gap: 9, fontSize: 12.5 }}>
                  {dash.minWd >= 0 && (
                    <div>📅 Los <strong>{DAYS[dash.minWd]}</strong> registran la menor ocupación: crea una campaña flash o promoción para ese día.</div>
                  )}
                  {dash.lowDemand.length > 0 && (
                    <div>📉 Sin ventas en 60 días: <strong>{dash.lowDemand.slice(0, 4).join(", ")}</strong>. Crea una campaña tipo "De servicios" dirigida a clientes frecuentes.</div>
                  )}
                  {dash.potenciales > 0 && (
                    <div>🚀 Tienes <strong>{dash.potenciales}</strong> clientes potenciales sin compras: envíales la promoción de bienvenida desde Segmentos.</div>
                  )}
                  {dash.birthdays > 0 && (
                    <div>🎂 <strong>{dash.birthdays}</strong> clientes cumplen años pronto: activa la automatización de cumpleaños o el segmento "Cumpleaños próximos".</div>
                  )}
                  {dash.minWd < 0 && dash.lowDemand.length === 0 && dash.potenciales === 0 && dash.birthdays === 0 && (
                    <p style={{ color: "#8d899e" }}>Todo va bien por ahora. Vuelve cuando tengas más datos de operación.</p>
                  )}
                </div>
              ) : (
                <EmptyState title="Recomendaciones inteligentes" body="Disponibles en el plan Elite: detectan días de baja ocupación, servicios sin ventas y oportunidades automáticas." />
              )}
            </section>
          </div>
        </>
      )}

      {/* ———————————— CAMPAÑAS ———————————— */}
      {tab === "campanas" && (
        <section className="vr-card">
          <h2>Campañas publicitarias</h2>
          {loading ? (
            <EmptyState title="Cargando…" body=" " />
          ) : campaigns.length === 0 ? (
            <EmptyState title="Sin campañas" body="Crea tu primera campaña promocional, de adquisición o de paquetes." />
          ) : (
            <div className="vr-table-wrap">
              <table className="vr-table">
                <thead>
                  <tr><th>Campaña</th><th>Tipo</th><th>Canal</th><th>Código / usos</th><th>Presupuesto</th><th>Vigencia</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        {c.description && <div style={{ fontSize: 10.5, color: "#8d899e" }}>{c.description}</div>}
                        {c.promo_code && <div style={{ fontSize: 10.5, color: "#7556d8", fontWeight: 700 }}>Cupón: {c.promo_code} · {c.discount_percent > 0 ? `${c.discount_percent}%` : "beneficio"}</div>}
                      </td>
                      <td><span className="vr-pill vr-pill-gray" style={{ fontSize: 10 }}>{TYPE_META[c.campaign_type]?.split(" ")[0] ?? c.campaign_type}</span></td>
                      <td style={{ fontSize: 11.5 }}>{c.channel}</td>
                      <td style={{ fontSize: 11.5 }}>
                        {c.promo_code ? (
                          <>
                            {c.uses_count}{c.max_uses > 0 ? ` / ${c.max_uses}` : ""} usos
                            {canUpdate && (
                              <button className="vr-btn-secondary vr-btn-sm" style={{ marginLeft: 6 }} onClick={() => void addUse(c)} disabled={busy === c.id} title="Registrar un uso del cupón">
                                <Plus size={11} />
                              </button>
                            )}
                          </>
                        ) : "—"}
                      </td>
                      <td>{formatCOP(c.budget ?? 0, { compact: true })}</td>
                      <td style={{ fontSize: 11.5 }}>
                        {c.starts_on ? formatDateShort(c.starts_on) : "—"} → {c.ends_on ? formatDateShort(c.ends_on) : "—"}
                      </td>
                      <td>
                        <span className="vr-pill" style={{ background: STATUS_META[c.status]?.bg ?? "#f0eef5", color: STATUS_META[c.status]?.fg ?? "#5e5a70" }}>
                          {STATUS_META[c.status]?.label ?? c.status}
                        </span>
                      </td>
                      <td>
                        {canUpdate && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => {
                              setForm({
                                name: c.name, description: c.description ?? "", objective: c.objective ?? "",
                                campaign_type: c.campaign_type ?? "promocional", channel: c.channel ?? "WhatsApp",
                                status: c.status ?? "draft", budget: String(c.budget ?? ""),
                                starts_on: c.starts_on ?? "", ends_on: c.ends_on ?? "",
                                promo_code: c.promo_code ?? "", discount_percent: c.discount_percent ?? 0,
                                max_uses: c.max_uses ?? 0, service_ids: (c.service_ids ?? []) as string[],
                                segment_id: c.segment_id ?? "", conditions: c.conditions ?? "",
                                image_url: c.image_url ?? "", content: c.content ?? "",
                              });
                              setEditingId(c.id);
                              setEditorOpen(true);
                            }}>
                              <Pencil size={12} />
                            </button>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => void removeCampaign(c)} disabled={busy === c.id}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ———————————— SEGMENTOS ———————————— */}
      {tab === "segmentos" && (
        <>
          <section className="vr-card">
            <h2>Segmentos preconfigurados</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
              {presets.map((s) => (
                <div key={s.id} style={{ border: "1px solid #f0eef5", borderRadius: 12, padding: 13, display: "grid", gap: 8, alignContent: "start" }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: "#8d899e" }}>{s.description}</div>
                  <button className="vr-btn-secondary vr-btn-sm" onClick={() => setSegResult({ title: s.name, matches: evalSegment(s.filters ?? {}, index, new Date()) })}>
                    <Users size={12} /> Ver clientes
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="vr-card">
            <h2>Segmentación inteligente (combina filtros)</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 12 }}>
              <Field label="Visitas mínimas (histórico)">
                <input type="number" min={0} value={builder.minVisits} onChange={(e) => setBuilder({ ...builder, minVisits: e.target.value })} placeholder="Ej.: 2" />
              </Field>
              <Field label="Sin visitar más de (días)">
                <input type="number" min={0} value={builder.maxDaysSinceVisit} onChange={(e) => setBuilder({ ...builder, maxDaysSinceVisit: e.target.value })} placeholder="Ej.: 30" />
              </Field>
              <Field label="Gasto acumulado mayor a (COP)">
                <input type="number" min={0} step={10000} value={builder.minTotalSpend} onChange={(e) => setBuilder({ ...builder, minTotalSpend: e.target.value })} placeholder="Ej.: 100000" />
              </Field>
              <Field label="Compró el servicio">
                <select value={builder.serviceId} onChange={(e) => setBuilder({ ...builder, serviceId: e.target.value })}>
                  <option value="">Cualquiera</option>
                  {services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Cumpleaños en (días)">
                <input type="number" min={0} value={builder.birthdayInDays} onChange={(e) => setBuilder({ ...builder, birthdayInDays: e.target.value })} placeholder="Ej.: 30" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, marginBottom: 12 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={builder.hasWhatsApp} onChange={(e) => setBuilder({ ...builder, hasWhatsApp: e.target.checked })} /> Con WhatsApp registrado
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={builder.hasEmail} onChange={(e) => setBuilder({ ...builder, hasEmail: e.target.checked })} /> Con correo registrado
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={builder.newOnly} onChange={(e) => setBuilder({ ...builder, newOnly: e.target.checked })} /> Solo compras recientes (30 días)
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="vr-btn" onClick={calcBuilder}><BarChart3 size={14} /> Calcular segmento</button>
              {segResult && (
                <>
                  <input style={{ maxWidth: 220 }} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Nombre para guardar" />
                  <button className="vr-btn-secondary" onClick={() => void saveSegment()} disabled={busy === "saveSeg"}>
                    {busy === "saveSeg" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Guardar segmento
                  </button>
                  <button className="vr-btn-secondary" onClick={() => { setCommFilters(builderFilters()); setCommTitle(saveName.trim() || "Segmento personalizado"); setTab("comunicacion"); }}>
                    <Send size={13} /> Enviar a Comunicación
                  </button>
                </>
              )}
            </div>
          </section>

          {customs.length > 0 && (
            <section className="vr-card">
              <h2>Mis segmentos guardados</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {customs.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", border: "1px solid #f0eef5", borderRadius: 999, padding: "6px 8px 6px 12px" }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.name}</span>
                    <button className="vr-btn-secondary vr-btn-sm" onClick={() => setSegResult({ title: s.name, matches: evalSegment(s.filters ?? {}, index, new Date()) })}>Ver</button>
                    <button className="vr-btn-secondary vr-btn-sm" onClick={() => useSegmentInComms(s)}><Send size={11} /></button>
                    {canUpdate && <button className="vr-btn-secondary vr-btn-sm" onClick={() => void removeSegment(s)} disabled={busy === s.id}><Trash2 size={11} /></button>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {segResult && (
            <section className="vr-card">
              <h2>{segResult.title} · {segResult.matches.length} cliente(s)</h2>
              <SegTable matches={segResult.matches} />
            </section>
          )}
        </>
      )}

      {/* ———————————— COMUNICACIÓN ———————————— */}
      {tab === "comunicacion" && (
        <>
          <section className="vr-card">
            <h2>Centro de comunicación con clientes</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 12 }}>
              <Field label="Público objetivo">
                <select
                  value={commTitle}
                  onChange={(e) => {
                    const s = segments.find((x) => x.name === e.target.value);
                    setCommTitle(e.target.value);
                    setCommFilters(s ? (s.filters ?? {}) : null);
                    setCommList([]);
                  }}
                >
                  <option value="">Selecciona un segmento…</option>
                  {segments.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Canal">
                <select value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}>
                  <option value="whatsapp">WhatsApp {isPro ? "" : "(plan Profesional+)"}</option>
                  <option value="email">Correo electrónico</option>
                </select>
              </Field>
              <Field label="Campaña asociada (para medir resultados)">
                <select value={commCampaign} onChange={(e) => setCommCampaign(e.target.value)}>
                  <option value="">— Sin campaña —</option>
                  {campaigns.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Mensaje (variables: {nombre}, {salon}, {beneficio}, {codigo})">
              <textarea rows={3} value={template} onChange={(e) => setTemplate(e.target.value)} />
            </Field>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={onlyConsent} onChange={(e) => setOnlyConsent(e.target.checked)} /> Solo clientes con consentimiento
              </label>
              <button className="vr-btn" onClick={generateCommList}><Users size={14} /> Generar lista</button>
              {channel === "whatsapp" && !isPro && (
                <span className="vr-pill" style={{ background: "#fff8e8", color: "#a87514" }}>
                  Las campañas por WhatsApp requieren plan Profesional o superior
                </span>
              )}
            </div>

            {commList.length > 0 && (
              <div className="vr-table-wrap" style={{ maxHeight: 380, overflowY: "auto" }}>
                <table className="vr-table">
                  <thead><tr><th>Cliente</th><th>Contacto</th><th>Mensaje</th><th></th></tr></thead>
                  <tbody>
                    {commList.map(({ c }) => {
                      const body = personalize(template, { nombre: firstName(c.full_name), salon: ctx.organization.name, codigo: campaigns.find((x) => x.id === commCampaign)?.promo_code ?? "" });
                      return (
                        <tr key={c.id}>
                          <td><strong>{c.full_name}</strong></td>
                          <td style={{ fontSize: 11.5 }}>{channel === "whatsapp" ? (c.whatsapp ?? c.phone ?? "—") : (c.email ?? "—")}</td>
                          <td style={{ fontSize: 11, color: "#8d899e", maxWidth: 300 }}>{body.length > 90 ? `${body.slice(0, 90)}…` : body}</td>
                          <td>
                            {commSent.has(c.id) ? (
                              <span className="vr-pill" style={{ background: "#e8f8f0", color: "#238a66" }}><Check size={11} style={{ verticalAlign: "-1px" }} /> Enviado</span>
                            ) : (
                              <button
                                className="vr-btn vr-btn-sm"
                                disabled={channel === "whatsapp" && !isPro}
                                onClick={() => void logAndOpen(c.id)}
                                title={channel === "whatsapp" ? "Abrir WhatsApp con el mensaje listo" : "Abrir correo con el mensaje listo"}
                              >
                                <MessageCircle size={12} /> {channel === "whatsapp" ? "Abrir WhatsApp" : "Abrir correo"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {commList.length > 0 && (
              <p style={{ fontSize: 11.5, color: "#8d899e", marginTop: 8 }}>
                Cada envío queda registrado con la campaña asociada para calcular conversión e ingresos en Estadísticas.
              </p>
            )}
          </section>

          <section className="vr-card">
            <h2>Cola de automatizaciones ({queue.length})</h2>
            {queue.length === 0 ? (
              <EmptyState title="Cola vacía" body="Ejecuta una automatización en la pestaña Automático y los mensajes aparecerán aquí listos para enviar." />
            ) : (
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead><tr><th>Cliente</th><th>Canal</th><th>Mensaje</th><th></th></tr></thead>
                  <tbody>
                    {queue.map((m) => (
                      <tr key={m.id}>
                        <td><strong>{custMap.get(m.customer_id)?.full_name ?? "Cliente"}</strong></td>
                        <td><span className="vr-pill vr-pill-gray" style={{ fontSize: 10 }}>{m.channel}</span></td>
                        <td style={{ fontSize: 11, color: "#5e5a70", maxWidth: 340 }}>{m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="vr-btn vr-btn-sm" onClick={() => void sendQueued(m)} disabled={busy === m.id}><Send size={12} /> Enviar</button>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => void discardQueued(m)} disabled={busy === m.id}>Descartar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ———————————— AUTOMATIZACIÓN ———————————— */}
      {tab === "automatizacion" && (
        <section className="vr-card">
          <h2><Zap size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Marketing automático</h2>
          {!isPro ? (
            <EmptyState title="Función del plan Profesional o superior" body="Configura reglas evento → acción (cumpleaños, recuperación, post-cita…) y el sistema genera los mensajes listos para enviar." />
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: "#8d899e", margin: "0 0 14px" }}>
                Activa las reglas que quieras y presiona "Ejecutar ahora": el sistema detecta los clientes que cumplen cada evento,
                respeta la frecuencia máxima (evita mensajes repetidos) y deja los mensajes en la cola de Comunicación.
              </p>
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead><tr><th>Regla</th><th>Evento</th><th>Canal</th><th>Frecuencia</th><th>Activa</th><th>Última ejecución</th><th></th></tr></thead>
                  <tbody>
                    {automations.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.name}</strong></td>
                        <td style={{ fontSize: 11.5 }}>{EVENT_META[a.event]?.label ?? a.event}</td>
                        <td><span className="vr-pill vr-pill-gray" style={{ fontSize: 10 }}>{a.action_channel}</span></td>
                        <td style={{ fontSize: 11.5 }}>Cada {a.max_per_days} días</td>
                        <td>
                          {canUpdate && (
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => void toggleAutomation(a)} disabled={busy === a.id}>
                              {a.active ? <Check size={12} /> : <Plus size={12} />} {a.active ? "Sí" : "No"}
                            </button>
                          )}
                        </td>
                        <td style={{ fontSize: 11.5 }}>{a.last_run_at ? relativeDay(a.last_run_at) : "Nunca"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            {canUpdate && (
                              <>
                                <button className="vr-btn vr-btn-sm" onClick={() => void runAutomationNow(a)} disabled={busy === a.id}>
                                  {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Ejecutar
                                </button>
                                <button className="vr-btn-secondary vr-btn-sm" onClick={() => { setAutoEdit(a); setAutoTemplate(a.template); }}>
                                  <Pencil size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ———————————— CALENDARIO ———————————— */}
      {tab === "calendario" && (
        <>
          <section className="vr-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{MONTHS[calMonth.m]} {calMonth.y}</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="vr-btn-secondary vr-btn-sm" onClick={() => setCalMonth(calMonth.m === 0 ? { y: calMonth.y - 1, m: 11 } : { y: calMonth.y, m: calMonth.m - 1 })}>‹</button>
                <button className="vr-btn-secondary vr-btn-sm" onClick={() => { const d = new Date(); setCalMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>Hoy</button>
                <button className="vr-btn-secondary vr-btn-sm" onClick={() => setCalMonth(calMonth.m === 11 ? { y: calMonth.y + 1, m: 0 } : { y: calMonth.y, m: calMonth.m + 1 })}>›</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
              {DAYS.map((d) => (
                <div key={d} style={{ fontSize: 10, fontWeight: 800, color: "#8d899e", textAlign: "center", padding: 4 }}>{d}</div>
              ))}
              {calGrid.map((cell, i) => {
                if (cell.day === null) return <div key={`e${i}`} />;
                const cs = campaignsOnDay(cell.day);
                const ds = datesOnMonth(cell.day);
                const isToday = new Date().toDateString() === new Date(calMonth.y, calMonth.m, cell.day).toDateString();
                return (
                  <div key={cell.day} style={{
                    minHeight: 64, border: `1px solid ${isToday ? "#7556d8" : "#f0eef5"}`, borderRadius: 9, padding: 5,
                    background: isToday ? "#f6f3fd" : "#fff", fontSize: 10.5, display: "grid", gap: 3, alignContent: "start",
                  }}>
                    <div style={{ fontWeight: 800, color: isToday ? "#7556d8" : "#5e5a70" }}>{cell.day}</div>
                    {ds.map((d) => (
                      <div key={d.id} title={d.description ?? d.name} style={{ background: "#fff8e8", color: "#a87514", borderRadius: 6, padding: "2px 4px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <Star size={9} style={{ display: "inline", verticalAlign: "-1px" }} /> {d.name}
                      </div>
                    ))}
                    {cs.map((c) => (
                      <div key={c.id} title={c.name} style={{ background: "#e8f8f0", color: "#238a66", borderRadius: 6, padding: "2px 4px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.name}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="vr-card">
            <h2>Plan comercial del año</h2>
            <div style={{ display: "grid", gap: 6 }}>
              {MONTHS.map((mo, mi) => {
                const list = dates.filter((d) => d.month === mi + 1);
                if (list.length === 0) return null;
                return (
                  <div key={mo} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 12, width: 92, color: "#7556d8" }}>{mo}</span>
                    {list.map((d) => (
                      <span key={d.id} className="vr-pill vr-pill-gray" style={{ fontSize: 11 }}>
                        {d.day ? `${d.day}/` : ""}{mo.slice(0, 3)} · {d.name}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* ———————————— CONTENIDO ———————————— */}
      {tab === "contenido" && (
        <section className="vr-card">
          <h2><Sparkles size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Contenido y creatividad</h2>
          <p style={{ fontSize: 12.5, color: "#8d899e", margin: "0 0 14px" }}>
            Plantillas listas para publicar. Reemplaza {`{beneficio}`} por tu promoción y copia. {`{salon}`} y {`{nombre}`} se rellenan automáticamente al copiar.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
            {CONTENT_TEMPLATES.map((t) => (
              <div key={t.title} style={{ border: "1px solid #f0eef5", borderRadius: 12, padding: 13, display: "grid", gap: 8, alignContent: "start" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12.5 }}>{t.title}</strong>
                  <span className="vr-pill vr-pill-gray" style={{ fontSize: 10 }}>{t.tag}</span>
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11.5, color: "#5e5a70", fontFamily: "inherit", background: "#faf9fd", borderRadius: 8, padding: 10 }}>
                  {t.text.replace(/\{salon\}/g, ctx.organization.name)}
                </pre>
                <button
                  className="vr-btn-secondary vr-btn-sm"
                  onClick={() => { void navigator.clipboard?.writeText(personalize(t.text, { salon: ctx.organization.name })); setNotice(`"${t.title}" copiada al portapapeles.`); }}
                >
                  <Copy size={12} /> Copiar plantilla
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ———————————— ESTADÍSTICAS ———————————— */}
      {tab === "estadisticas" && (
        <section className="vr-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <h2><BarChart3 size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />Estadísticas y rentabilidad</h2>
            <div style={{ display: "flex", gap: 6 }}>
              {[30, 60, 90].map((w) => (
                <button key={w} className={statsWindow === w ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"} onClick={() => setStatsWindow(w)}>
                  {w} días
                </button>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "#8d899e", margin: "8px 0 14px" }}>
            Los ingresos atribuidos son las ventas de clientes que compraron dentro de los {statsWindow} días siguientes al envío de un mensaje de la campaña.
            Nota: para la rentabilidad neta considera además el costo de los servicios y los descuentos aplicados.
          </p>
          {stats.length === 0 ? (
            <EmptyState title="Sin datos todavía" body="Crea campañas, asígnales presupuesto y envía mensajes para ver conversión e ingresos." />
          ) : (
            <div className="vr-table-wrap">
              <table className="vr-table">
                <thead>
                  <tr><th>Campaña</th><th>Enviados</th><th>Compraron</th><th>Conversión</th><th>Ingresos atribuidos</th><th>Inversión</th><th>ROAS</th><th>Redención cupón</th></tr>
                </thead>
                <tbody>
                  {stats.map((r) => (
                    <tr key={r.c.id}>
                      <td><strong>{r.c.name}</strong></td>
                      <td>{r.sent}</td>
                      <td>{r.buyers}</td>
                      <td>{r.sent > 0 ? `${r.conv.toFixed(1)}%` : "—"}</td>
                      <td style={{ fontWeight: 700, color: "#238a66" }}>{formatCOP(r.revenue, { compact: true })}</td>
                      <td>{formatCOP(r.budget, { compact: true })}</td>
                      <td>
                        {r.budget > 0 ? (
                          <span className="vr-pill" style={{ background: r.roas >= 1 ? "#e8f8f0" : "#fff0f2", color: r.roas >= 1 ? "#238a66" : "#ca435c" }}>
                            {r.roas.toFixed(2)}x
                          </span>
                        ) : "—"}
                      </td>
                      <td>{r.c.promo_code ? (r.c.max_uses > 0 ? `${r.c.uses_count}/${r.c.max_uses}` : `${r.c.uses_count} usos`) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ————— Modal: editor de campaña ————— */}
      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña"} onClose={() => { setEditorOpen(false); setEditingId(null); }} width={700}>
        <Field label="Nombre de la campaña">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: 20% en tratamientos capilares de noviembre" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Descripción">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué comunica la campaña" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "12px 0" }}>
          <Field label="Tipo">
            <select value={form.campaign_type} onChange={(e) => setForm({ ...form, campaign_type: e.target.value as MktCampaignType })}>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Canal de difusión">
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MktStatus })}>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ height: 10 }} />
        <Field label="Objetivo comercial">
          <input value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Ej.: llenar los martes, impulsar uñas, recuperar inactivos" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, margin: "12px 0" }}>
          <Field label="Presupuesto (COP)">
            <input type="number" min={0} step={10000} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="450000" />
          </Field>
          <Field label="Inicio">
            <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
          </Field>
          <Field label="Fin">
            <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, margin: "0 0 12px" }}>
          <Field label="Código promocional">
            <input value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value })} placeholder="BEAUTY20" />
          </Field>
          <Field label="Descuento (%)">
            <input type="number" min={0} max={100} value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: Number(e.target.value) })} />
          </Field>
          <Field label="Límite de usos (0 = ilimitado)">
            <input type="number" min={0} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Público objetivo (segmento)">
          <select value={form.segment_id} onChange={(e) => setForm({ ...form, segment_id: e.target.value })}>
            <option value="">— Público general —</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Servicios participantes">
          <div style={{ border: "1px solid #f0eef5", borderRadius: 10, padding: 10, maxHeight: 130, overflowY: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {services.filter((s) => s.active).map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, background: form.service_ids.includes(s.id) ? "#f6f3fd" : "#fff", border: "1px solid #f0eef5", borderRadius: 999, padding: "4px 10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.service_ids.includes(s.id)}
                  onChange={(e) => setForm({ ...form, service_ids: e.target.checked ? [...form.service_ids, s.id] : form.service_ids.filter((x) => x !== s.id) })}
                />
                {s.name}
              </label>
            ))}
          </div>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Condiciones y restricciones">
          <input value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="Ej.: de lunes a viernes, no acumulable, previa reserva" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Imagen o pieza gráfica (URL opcional)">
          <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Texto / contenido de la pieza">
          <textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Texto del post, correo o mensaje…" />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className="vr-btn-secondary" onClick={() => { setEditorOpen(false); setEditingId(null); }}>Cancelar</button>
          <button className="vr-btn" onClick={() => void saveCampaign()} disabled={busy === "save"}>
            {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {editingId ? "Guardar cambios" : "Crear campaña"}
          </button>
        </div>
      </Modal>

      {/* ————— Modal: editar plantilla de automatización ————— */}
      <Modal open={autoEdit !== null} title={autoEdit ? `Automatización · ${autoEdit.name}` : ""} onClose={() => setAutoEdit(null)} width={560}>
        {autoEdit && (
          <>
            <p style={{ fontSize: 12, color: "#8d899e", margin: "0 0 12px" }}>
              Evento: <strong>{EVENT_META[autoEdit.event]?.label}</strong>. Variables: {`{nombre}`}, {`{salon}`}.
            </p>
            <Field label="Mensaje (acción automática)">
              <textarea rows={4} value={autoTemplate} onChange={(e) => setAutoTemplate(e.target.value)} />
            </Field>
            <div style={{ height: 10 }} />
            <Field label={`Frecuencia máxima: enviar cada X días (actual: ${autoEdit.max_per_days})`}>
              <input type="number" min={1} max={90} value={autoEdit.max_per_days} onChange={(e) => setAutoEdit({ ...autoEdit, max_per_days: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="vr-btn-secondary" onClick={() => setAutoEdit(null)}>Cancelar</button>
              <button className="vr-btn" onClick={() => void saveAutomationTemplate()} disabled={busy === "auto"}>
                {busy === "auto" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
