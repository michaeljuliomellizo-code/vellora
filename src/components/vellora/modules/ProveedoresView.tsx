"use client";

/* VelloRa ERP — Módulo Proveedores: directorio de proveedores asociado a la
   tabla REAL public.suppliers (Agregar, Editar, Inactivar/Activar).
   La baja es LÓGICA (active=false), nunca DELETE: así no se rompe la
   integridad con purchases (FK supplier_id) ni con products.supplier_name.
   Los proveedores inactivos no aparecen en Compras ni en Inventario. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Plus, Pencil, PowerOff, Power } from "lucide-react";
import type { OrganizationContext, Supplier } from "@/lib/vellora/types";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

type FormState = {
  name: string;
  tax_id: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  payment_terms: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  tax_id: "",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  payment_terms: "",
  notes: "",
};

export default function ProveedoresView({ ctx }: { ctx: OrganizationContext }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const canCreate = can(ctx.permissions, "proveedores", "can_create");
  const canUpdate = can(ctx.permissions, "proveedores", "can_update");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const { data, error: qErr } = await sb
        .from("suppliers")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .order("name");
      if (qErr) throw new Error(qErr.message);
      setSuppliers(((data ?? []) as unknown) as Supplier[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar proveedores");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          (s.tax_id ?? "").toLowerCase().includes(q) ||
          (s.contact_name ?? "").toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
  }, [suppliers, query]);

  const activeCount = suppliers.filter((s) => s.active).length;

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name ?? "",
      tax_id: s.tax_id ?? "",
      contact_name: s.contact_name ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      payment_terms: s.payment_terms ?? "",
      notes: s.notes ?? "",
    });
    setError("");
    setShowForm(true);
  }

  async function saveSupplier() {
    const name = form.name.trim();
    if (!name) {
      setError("El nombre del proveedor es obligatorio.");
      return;
    }
    const email = form.email.trim();
    if (email && !email.includes("@")) {
      setError("El correo del proveedor no tiene un formato válido.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const payload = {
      name,
      tax_id: form.tax_id.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: email || null,
      address: form.address.trim() || null,
      payment_terms: form.payment_terms.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error: dbErr } = editing
      ? await sb.from("suppliers").update(payload).eq("id", editing.id).eq("organization_id", ctx.organizationId)
      : await sb.from("suppliers").insert({ ...payload, organization_id: ctx.organizationId, active: true });
    setSaving(false);
    if (dbErr) {
      setError(`No fue posible guardar el proveedor: ${dbErr.message}`);
      return;
    }
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setNotice(editing ? `Proveedor "${name}" actualizado.` : `Proveedor "${name}" agregado.`);
    await load();
  }

  async function toggleActive(s: Supplier) {
    setTogglingId(s.id);
    setError("");
    const sb = supabaseBrowser();
    const { error: dbErr } = await sb
      .from("suppliers")
      .update({ active: !s.active })
      .eq("id", s.id)
      .eq("organization_id", ctx.organizationId);
    setTogglingId(null);
    if (dbErr) {
      setError(`No se pudo cambiar el estado: ${dbErr.message}`);
      return;
    }
    setNotice(
      s.active
        ? `Proveedor "${s.name}" inactivado. Ya no aparece en Compras ni en Inventario.`
        : `Proveedor "${s.name}" reactivado.`
    );
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Proveedores"
        subtitle="Directorio de proveedores con contacto, NIT y términos de pago. La baja es lógica: se inactivan, no se borran."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={openNew}>
                <Plus size={14} /> Nuevo proveedor
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Proveedores activos</div>
          <div className="vr-metric-value">{activeCount}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Inactivos</div>
          <div className="vr-metric-value" style={{ color: suppliers.length - activeCount ? "#8d899e" : undefined }}>
            {suppliers.length - activeCount}
          </div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Total registrados</div>
          <div className="vr-metric-value">{suppliers.length}</div>
        </div>
      </div>

      <section className="vr-card">
        <div className="vr-form" style={{ marginBottom: 14 }}>
          <input
            placeholder="Buscar por nombre, NIT, contacto o correo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 340 }}
            aria-label="Buscar proveedores"
          />
          <span className="vr-muted" style={{ fontSize: 12 }}>{filtered.length} proveedores</span>
        </div>

        {loading ? (
          <EmptyState title="Cargando proveedores…" body=" " />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={suppliers.length === 0 ? "Sin proveedores" : "Sin resultados"}
            body={suppliers.length === 0
              ? "Agrega tu primer proveedor con el botón «Nuevo proveedor». Los proveedores que registres aquí aparecerán en Inventario y en Compras."
              : "No hay proveedores que coincidan con la búsqueda."}
          />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Contacto</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th>Términos de pago</th>
                  <th>Estado</th>
                  {canUpdate && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} style={{ opacity: s.active ? 1 : 0.62 }}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.tax_id && <div className="vr-muted" style={{ fontSize: 11 }}>NIT {s.tax_id}</div>}
                    </td>
                    <td>{s.contact_name ?? "—"}</td>
                    <td>{s.phone ?? "—"}</td>
                    <td>{s.email ?? "—"}</td>
                    <td>{s.payment_terms ?? "—"}</td>
                    <td>
                      <span className={`vr-pill ${s.active ? "vr-pill-green" : "vr-pill-gray"}`}>
                        {s.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    {canUpdate && (
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="vr-btn-secondary vr-btn-sm" onClick={() => openEdit(s)} title="Editar proveedor">
                            <Pencil size={12} /> Editar
                          </button>
                          <button
                            className="vr-btn-secondary vr-btn-sm"
                            onClick={() => void toggleActive(s)}
                            disabled={togglingId === s.id}
                            title={s.active ? "Inactivar (baja lógica)" : "Reactivar proveedor"}
                          >
                            {togglingId === s.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : s.active ? (
                              <><PowerOff size={12} /> Inactivar</>
                            ) : (
                              <><Power size={12} /> Activar</>
                            )}
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

      <Modal
        open={showForm}
        title={editing ? `Editar proveedor · ${editing.name}` : "Nuevo proveedor"}
        onClose={() => setShowForm(false)}
        width={560}
      >
        <FormGrid>
          <Field label="Nombre *">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej. Distribuidora Belleza SAS"
              maxLength={120}
            />
          </Field>
          <Field label="NIT / Tax ID">
            <input
              value={form.tax_id}
              onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))}
              placeholder="Ej. 900123456-1"
              maxLength={40}
            />
          </Field>
          <Field label="Persona de contacto">
            <input
              value={form.contact_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
              placeholder="Ej. Laura Gómez"
              maxLength={80}
            />
          </Field>
          <Field label="Teléfono">
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Ej. 3001234567"
              maxLength={30}
            />
          </Field>
          <Field label="Correo">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="ventas@proveedor.com"
              maxLength={120}
            />
          </Field>
          <Field label="Términos de pago">
            <input
              value={form.payment_terms}
              onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
              placeholder="Ej. Contado · Crédito 30 días"
              maxLength={80}
            />
          </Field>
          <Field label="Dirección">
            <input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Ej. Cra 15 # 82-40, Bogotá"
              maxLength={160}
            />
          </Field>
          <Field label="Notas">
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Ej. Descuento 5% desde 10 unidades"
              maxLength={200}
            />
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void saveSupplier()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}
