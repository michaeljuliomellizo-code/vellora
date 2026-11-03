"use client";

/* VelloRa ERP — Módulo Servicios: catálogo con CRUD básico. */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Plus } from "lucide-react";
import type { OrganizationContext, Service } from "@/lib/vellora/types";
import { fetchServices } from "@/lib/vellora/queries";
import { formatCOP } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

const CATEGORIES = ["Cabello", "Uñas", "Spa", "Rostro", "Corporal", "Otros"];

export default function ServiciosView({ ctx }: { ctx: OrganizationContext }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);

  const [fName, setFName] = useState("");
  const [fCategory, setFCategory] = useState(CATEGORIES[0]);
  const [fDuration, setFDuration] = useState(60);
  const [fPrice, setFPrice] = useState(50000);
  const [fActive, setFActive] = useState(true);

  const canCreate = can(ctx.permissions, "servicios", "can_create");
  const canUpdate = can(ctx.permissions, "servicios", "can_update");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServices(await fetchServices(ctx.organizationId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar servicios");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(svc: Service) {
    setEditing(svc);
    setFName(svc.name);
    setFCategory(svc.category ?? CATEGORIES[0]);
    setFDuration(svc.duration_minutes);
    setFPrice(svc.price);
    setFActive(svc.active);
    setShowNew(true);
  }

  async function save() {
    if (!fName.trim()) {
      setError("El nombre del servicio es obligatorio.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const payload = {
      organization_id: ctx.organizationId,
      name: fName.trim(),
      category: fCategory,
      duration_minutes: fDuration,
      price: fPrice,
      active: fActive,
    };
    const { error: opErr } = editing
      ? await sb.from("services").update(payload).eq("id", editing.id)
      : await sb.from("services").insert(payload);
    setSaving(false);
    if (opErr) {
      setError(`No fue posible guardar el servicio: ${opErr.message}`);
      return;
    }
    setShowNew(false);
    setEditing(null);
    setFName(""); setFDuration(60); setFPrice(50000); setFActive(true);
    setNotice(editing ? "Servicio actualizado." : "Servicio creado.");
    await load();
  }

  async function toggle(svc: Service) {
    const sb = supabaseBrowser();
    const { error: upErr } = await sb.from("services").update({ active: !svc.active }).eq("id", svc.id);
    if (upErr) {
      setError(`No se pudo cambiar el estado: ${upErr.message}`);
      return;
    }
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Servicios y tratamientos"
        subtitle="Catálogo con duración, precio y disponibilidad."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => { setEditing(null); setShowNew(true); }}>
                <Plus size={14} /> Nuevo servicio
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <section className="vr-card">
        {loading ? (
          <EmptyState title="Cargando servicios…" body=" " />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Servicio</th>
                  <th>Categoría</th>
                  <th>Duración</th>
                  <th>Precio</th>
                  <th>Estado</th>
                  {canUpdate && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className="vr-pill">{s.category}</span></td>
                    <td>{s.duration_minutes} min</td>
                    <td><strong>{formatCOP(s.price)}</strong></td>
                    <td>
                      <span className={`vr-pill ${s.active ? "vr-pill-green" : "vr-pill-gray"}`}>{s.active ? "Activo" : "Inactivo"}</span>
                    </td>
                    {canUpdate && (
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="vr-btn-secondary vr-btn-sm" onClick={() => openEdit(s)}>Editar</button>
                          <button className="vr-btn-danger vr-btn-sm" onClick={() => void toggle(s)}>
                            {s.active ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={showNew} title={editing ? "Editar servicio" : "Nuevo servicio"} onClose={() => setShowNew(false)}>
        <FormGrid>
          <Field label="Nombre">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ej. Balayage" maxLength={60} />
          </Field>
          <Field label="Categoría">
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Duración (min)">
            <input type="number" min={15} max={360} step={15} value={fDuration} onChange={(e) => setFDuration(Number(e.target.value))} />
          </Field>
          <Field label="Precio (COP)">
            <input type="number" min={0} step={1000} value={fPrice} onChange={(e) => setFPrice(Number(e.target.value))} />
          </Field>
          <Field label="Estado">
            <select value={fActive ? "1" : "0"} onChange={(e) => setFActive(e.target.value === "1")}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}
