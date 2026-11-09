"use client";

/* VelloRa ERP — Wizard público de reservas (página /r/<slug>).
   4 pasos: servicio → profesional → fecha y hora → datos de contacto.
   Con confirmación instantánea (código de reserva), WhatsApp de contacto
   y cancelación en línea con código + teléfono. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarCheck, Check, ChevronDown, Clock,
  Loader2, MessageCircle, Phone, Scissors, Sparkles, User,
} from "lucide-react";
import {
  cancelPublicBooking, createPublicBooking, DAY_LABELS, DAY_KEYS,
  loadAvailableSlots, loadPublicBookingData, normalizeHours, waLink,
} from "@/lib/vellora/public-booking";
import type { PublicBookingData, PublicService, Slot } from "@/lib/vellora/public-booking";
import { IS_DEMO } from "@/lib/vellora/supabase";
import { formatCOP } from "@/lib/vellora/format";

type Phase = "loading" | "ready" | "closed" | "error";
type DoneInfo = {
  code: string;
  status: string;
  auto: boolean;
  service: string;
  employee: string;
  when: string;
};

const STEPS = ["Servicio", "Profesional", "Fecha y hora", "Tus datos"];

function esDayLabel(d: Date, todayKey: string, key: string): { top: string; bottom: string } {
  const wd = new Intl.DateTimeFormat("es-CO", { weekday: "short" }).format(d).replace(".", "");
  const dm = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(d);
  if (key === todayKey) return { top: "Hoy", bottom: dm };
  const t = new Date(); t.setDate(t.getDate() + 1);
  if (key === t.toISOString().slice(0, 10)) return { top: "Mañana", bottom: dm };
  return { top: wd.charAt(0).toUpperCase() + wd.slice(1), bottom: dm };
}

export default function PublicBookingClient({ slug }: { slug: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [data, setData] = useState<PublicBookingData | null>(null);

  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState<string | null>(null); // null = cualquiera
  const [dateKey, setDateKey] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsMsg, setSlotsMsg] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [done, setDone] = useState<DoneInfo | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelCode, setCancelCode] = useState("");
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelMsg, setCancelMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const todayKey = new Date().toISOString().slice(0, 10);
  const service: PublicService | undefined = useMemo(
    () => data?.services.find((s) => s.id === serviceId),
    [data, serviceId]
  );
  const employee = data?.employees.find((e) => e.id === slot?.employee_id)
    ?? data?.employees.find((e) => e.id === employeeId);

  const days = useMemo(() => {
    if (!data?.settings) return [];
    const out: { key: string; top: string; bottom: string; closed: boolean; dow: number }[] = [];
    for (let i = 0; i < Math.min(data.settings.horizon_days, 31); i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const hours = data.settings.business_hours[String(dow)];
      out.push({
        key,
        dow,
        closed: !hours || hours.closed,
        ...esDayLabel(d, todayKey, key),
      });
    }
    return out;
  }, [data, todayKey]);

  const load = useCallback(async () => {
    setPhase("loading");
    const res = await loadPublicBookingData(slug);
    if (!res.ok || !res.settings) {
      setErrMsg(res.message ?? "No encontramos esta página de reservas.");
      setPhase("error");
      return;
    }
    if (!res.settings.enabled) {
      setData(res);
      setPhase("closed");
      return;
    }
    setData(res);
    setPhase("ready");
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  /* Cargar horas cuando cambian servicio / día / profesional (paso 3) */
  useEffect(() => {
    if (phase !== "ready" || !serviceId || !dateKey) return;
    let alive = true;
    setSlotsLoading(true);
    setSlotsMsg("");
    loadAvailableSlots(slug, serviceId, dateKey, step >= 1 ? employeeId : null)
      .then((res) => {
        if (!alive) return;
        setSlots(res.slots ?? []);
        if (res.ok === false && res.message) setSlotsMsg(res.message);
      })
      .finally(() => { if (alive) setSlotsLoading(false); });
    return () => { alive = false; };
  }, [phase, slug, serviceId, dateKey, employeeId, step]);

  /* Fecha por defecto: primer día con atención */
  useEffect(() => {
    if (!dateKey && days.length) {
      const firstOpen = days.find((d) => !d.closed);
      if (firstOpen) setDateKey(firstOpen.key);
    }
  }, [days, dateKey]);

  const canNext = step === 0 ? Boolean(serviceId)
    : step === 1 ? true
    : step === 2 ? Boolean(slot)
    : name.trim().length >= 3 && phone.replace(/\D/g, "").length >= 7 && consent;

  async function submit() {
    if (!service || !slot || !dateKey) return;
    setSubmitting(true);
    setSubmitErr("");
    const empId = slot.employee_id ?? employeeId;
    const res = await createPublicBooking({
      slug, service_id: service.id, employee_id: empId, date: dateKey, time: slot.time,
      name, phone, email: email.trim() || undefined, notes: notes.trim() || undefined, consent,
    });
    setSubmitting(false);
    if (!res.ok) {
      setSubmitErr(res.message ?? "No fue posible crear la reserva. Intenta de nuevo.");
      return;
    }
    const when = new Date(`${dateKey}T${slot.time}:00`);
    setDone({
      code: res.booking_code ?? "",
      status: res.status ?? "reserved",
      auto: res.auto_confirm ?? false,
      service: service.name,
      employee: data?.employees.find((e) => e.id === (empId ?? slot.employee_id))?.full_name ?? "Cualquiera disponible",
      when: new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(when),
    });
  }

  async function doCancel() {
    setCancelling(true);
    setCancelMsg(null);
    const res = await cancelPublicBooking(slug, cancelCode, cancelPhone);
    setCancelling(false);
    setCancelMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Reserva cancelada." : "No fue posible cancelar.") });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, PublicService[]>();
    for (const s of data?.services ?? []) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return [...map.entries()];
  }, [data]);

  const waContact = waLink(data?.settings?.contact_phone);

  if (phase === "loading") {
    return (
      <div className="pb-page pb-loader">
        <div className="pb-loader-inner">
          <Loader2 size={26} className="animate-spin" style={{ color: "#7556d8", margin: "0 auto 10px", display: "block" }} />
          Cargando reservas…
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="pb-page pb-loader">
        <div className="pb-loader-inner" style={{ maxWidth: 420, padding: 20 }}>
          <AlertCircle size={34} style={{ color: "#c05050", margin: "0 auto 12px", display: "block" }} />
          <b style={{ display: "block", marginBottom: 6, color: "#241b3a" }}>Página no disponible</b>
          <div style={{ fontSize: 14, color: "#5c5470" }}>{errMsg}</div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#8a819e" }}>
            Dirección consultada: <b>/r/{slug}</b>
          </div>
          {IS_DEMO && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#a8720d" }}>
              Estás en modo demo (sin credenciales de Supabase). La página de ejemplo es <b>/r/bella-esencia</b>.
            </div>
          )}
          <button
            type="button"
            onClick={() => void load()}
            style={{
              marginTop: 16, padding: "9px 18px", borderRadius: 10, border: "none",
              background: "#7556d8", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-page">
      <header className="pb-hero">
        <span className="pb-hero-badge"><Sparkles size={13} /> Reservas en línea</span>
        <h1>{data?.settings?.public_name}</h1>
        {data?.settings?.description && <p>{data.settings.description}</p>}
        <div className="pb-chip-row">
          {waContact && (
            <a className="pb-chip" href={waContact} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <MessageCircle size={13} /> WhatsApp
            </a>
          )}
          {data?.settings?.contact_phone && (
            <span className="pb-chip"><Phone size={13} /> {data.settings.contact_phone}</span>
          )}
          <span className="pb-chip"><Clock size={13} /> Confirmación {data?.settings?.auto_confirm ? "automática" : "por el salón"}</span>
        </div>
      </header>

      <main className="pb-body">
        {phase === "closed" ? (
          <div className="pb-card pb-done">
            <div className="pb-done-ico" style={{ background: "#fff4e0", color: "#a8720d" }}><CalendarCheck size={28} /></div>
            <h2>Reservas en línea cerradas</h2>
            <p>
              {data?.settings?.public_name ?? "El salón"} no está recibiendo reservas en línea en este momento.
              {data?.settings?.contact_phone ? ` Escríbenos o llámanos al ${data.settings.contact_phone}.` : ""}
            </p>
            {waContact && (
              <a className="pb-btn pb-btn-wa" href={waContact} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <MessageCircle size={16} /> Escribir por WhatsApp
              </a>
            )}
          </div>
        ) : done ? (
          <div className="pb-card pb-done">
            <div className="pb-done-ico"><Check size={30} /></div>
            <h2>¡Reserva registrada!</h2>
            {done.auto ? (
              <p>Tu cita quedó <b>confirmada</b>. Te esperamos.</p>
            ) : (
              <p>Tu solicitud quedó registrada. El salón la <b>confirmará en breve</b> por WhatsApp o correo.</p>
            )}
            <div className="pb-code">{done.code}</div>
            <div className="pb-summary">
              <div><span>Servicio</span><b>{done.service}</b></div>
              <div><span>Profesional</span><b>{done.employee}</b></div>
              <div><span>Fecha</span><b style={{ textTransform: "capitalize" }}>{done.when}</b></div>
              <div><span>Estado</span><b>{done.auto ? "Confirmada" : "Pendiente de confirmación"}</b></div>
            </div>
            <p style={{ fontSize: 12.5 }}>
              Guarda tu código <b>{done.code}</b>: te servirá para cancelar o consultar tu reserva.
            </p>
            {waContact && (
              <a className="pb-btn pb-btn-wa" href={waContact} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <MessageCircle size={16} /> Contactar por WhatsApp
              </a>
            )}
          </div>
        ) : (
          <div className="pb-card">
            {/* Indicador de pasos */}
            <div className="pb-steps">
              {STEPS.map((label, i) => (
                <div key={label} className={`pb-step${i <= step ? " on" : ""}`}>
                  <i />
                  {label}
                </div>
              ))}
            </div>

            {submitErr && <div className="pb-err">{submitErr}</div>}

            {step === 0 && (
              <section>
                <h2 className="pb-q">¿Qué servicio quieres reservar?</h2>
                {grouped.length === 0 && <div className="pb-empty-slots">No hay servicios publicados aún.</div>}
                {grouped.map(([cat, list]) => (
                  <div key={cat}>
                    <div className="pb-cat">{cat}</div>
                    {list.map((s) => (
                      <button key={s.id} type="button" className={`pb-opt${serviceId === s.id ? " sel" : ""}`} onClick={() => { setServiceId(s.id); setSlot(null); }}>
                        <span className="pb-radio" />
                        <span className="pb-opt-main">
                          <span className="pb-opt-name">{s.name}</span>
                          <span className="pb-opt-sub" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <Clock size={11} /> {s.duration_minutes} min{s.description ? ` · ${s.description}` : ""}
                          </span>
                        </span>
                        <span className="pb-opt-price">{formatCOP(s.price)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )}

            {step === 1 && (
              <section>
                <h2 className="pb-q">¿Con quién prefieres tu cita?</h2>
                <button type="button" className={`pb-opt${employeeId === null ? " sel" : ""}`} onClick={() => { setEmployeeId(null); setSlot(null); }}>
                  <span className="pb-radio" />
                  <span className="pb-opt-main">
                    <span className="pb-opt-name">Cualquiera disponible</span>
                    <span className="pb-opt-sub">Te asignamos el profesional con mejor disponibilidad</span>
                  </span>
                  <Sparkles size={16} style={{ color: "#7556d8" }} />
                </button>
                {(data?.employees ?? []).map((e) => (
                  <button key={e.id} type="button" className={`pb-opt${employeeId === e.id ? " sel" : ""}`} onClick={() => { setEmployeeId(e.id); setSlot(null); }}>
                    <span className="pb-radio" />
                    <span className="pb-opt-main">
                      <span className="pb-opt-name">{e.full_name}</span>
                      <span className="pb-opt-sub">{[e.position, e.specialties].filter(Boolean).join(" · ") || "Profesional"}</span>
                    </span>
                    <User size={16} style={{ color: "#8d84a8" }} />
                  </button>
                ))}
              </section>
            )}

            {step === 2 && (
              <section>
                <h2 className="pb-q">Elige el día y la hora</h2>
                <div className="pb-days">
                  {days.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      className={`pb-day${dateKey === d.key ? " sel" : ""}${d.closed ? "" : ""}`}
                      style={d.closed ? { opacity: 0.45 } : undefined}
                      disabled={d.closed}
                      onClick={() => { setDateKey(d.key); setSlot(null); }}
                    >
                      <b>{d.top}</b>
                      <span>{d.bottom}</span>
                    </button>
                  ))}
                </div>
                {slotsLoading ? (
                  <div className="pb-empty-slots"><Loader2 size={16} className="animate-spin" style={{ display: "inline", verticalAlign: "-3px", marginRight: 6 }} />Consultando disponibilidad…</div>
                ) : slots.length === 0 ? (
                  <div className="pb-empty-slots">
                    {slotsMsg || "No hay horas disponibles para este día. Prueba otro día u otro profesional."}
                  </div>
                ) : (
                  <div className="pb-slots">
                    {slots.map((s) => (
                      <button key={s.time} type="button" className={`pb-slot${slot?.time === s.time ? " sel" : ""}`} onClick={() => setSlot(s)}>
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
                {service && (
                  <p style={{ fontSize: 12, color: "#8d84a8", margin: "12px 0 0" }}>
                    {service.name} · {service.duration_minutes} min · {formatCOP(service.price)}
                  </p>
                )}
              </section>
            )}

            {step === 3 && (
              <section>
                <h2 className="pb-q">Tus datos</h2>
                <div className="pb-field">
                  <label>Nombre completo *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. María Gómez" autoComplete="name" />
                </div>
                <div className="pb-field">
                  <label>WhatsApp / teléfono *</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej. 300 123 4567" inputMode="tel" autoComplete="tel" />
                </div>
                <div className="pb-field">
                  <label>Correo (opcional)</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" inputMode="email" autoComplete="email" />
                </div>
                <div className="pb-field">
                  <label>Comentarios (opcional)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Cuéntanos algo útil para tu cita" />
                </div>
                <label className="pb-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>Autorizo que {data?.settings?.public_name ?? "el salón"} me contacte por <b>WhatsApp o correo</b> para confirmar, recordar o gestionar esta cita.</span>
                </label>

                <div className="pb-summary">
                  <div><span>Servicio</span><b>{service?.name}</b></div>
                  <div><span>Profesional</span><b>{employee?.full_name ?? "Cualquiera disponible"}</b></div>
                  <div><span>Fecha y hora</span><b style={{ textTransform: "capitalize" }}>
                    {new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${dateKey}T12:00:00`))} · {slot?.time}
                  </b></div>
                  <div><span>Total</span><b>{service ? formatCOP(service.price) : "—"}</b></div>
                </div>
              </section>
            )}

            <div className="pb-nav">
              <button type="button" className="pb-btn pb-btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                <ArrowLeft size={15} /> Atrás
              </button>
              {step < 3 ? (
                <button type="button" className="pb-btn" onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={!canNext}>
                  Continuar <ArrowRight size={15} />
                </button>
              ) : (
                <button type="button" className="pb-btn" onClick={() => void submit()} disabled={!canNext || submitting}>
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <CalendarCheck size={15} />}
                  Confirmar reserva
                </button>
              )}
            </div>
          </div>
        )}

        {!done && (
          <div className="pb-toggle-cancel">
            <button type="button" onClick={() => setCancelOpen((v) => !v)}>
              {cancelOpen ? "Ocultar" : "¿Ya tienes una reserva? Cancelarla"} <ChevronDown size={12} style={{ verticalAlign: "-2px" }} />
            </button>
            {cancelOpen && (
              <div className="pb-card" style={{ marginTop: 12, textAlign: "left" }}>
                <h2 className="pb-q" style={{ fontSize: 14.5 }}>Cancelar mi reserva</h2>
                <p style={{ fontSize: 12.5, color: "#6d6488", margin: "0 0 12px" }}>
                  Ingresa el código que te dieron (ej. <code>R-4F2A9C</code>) y el teléfono con el que reservaste.
                  {data?.settings ? ` Puedes cancelar hasta ${data.settings.cancellation_hours} h antes.` : ""}
                </p>
                <div className="pb-field"><label>Código de reserva</label>
                  <input value={cancelCode} onChange={(e) => setCancelCode(e.target.value.toUpperCase())} placeholder="R-XXXXXX" />
                </div>
                <div className="pb-field"><label>Teléfono</label>
                  <input value={cancelPhone} onChange={(e) => setCancelPhone(e.target.value)} placeholder="300 123 4567" inputMode="tel" />
                </div>
                {cancelMsg && <div className={cancelMsg.ok ? "pb-warn" : "pb-err"} style={cancelMsg.ok ? { background: "#e8f8ee", borderColor: "#b5e5c5", color: "#1c7a42" } : undefined}>{cancelMsg.text}</div>}
                <button type="button" className="pb-btn" style={{ width: "100%" }} onClick={() => void doCancel()} disabled={cancelling || cancelCode.length < 4 || cancelPhone.length < 7}>
                  {cancelling ? <Loader2 size={15} className="animate-spin" /> : null} Cancelar reserva
                </button>
              </div>
            )}
          </div>
        )}

        <div className="pb-foot">
          Agenda gestionada con <b>VelloRa</b> · página <code>/r/{slug}</code>
          {data?.settings && (() => {
            const hrs = normalizeHours(data.settings.business_hours);
            return (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                <Scissors size={12} />
                {DAY_KEYS.map((k) => (
                  <span key={k} style={{ fontSize: 11, color: hrs[k].closed ? "#c0b9d4" : "#6d6488" }}>
                    {DAY_LABELS[k].slice(0, 2)}{hrs[k].closed ? " · cerrado" : ` ${hrs[k].open.slice(0, 5)}`}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
