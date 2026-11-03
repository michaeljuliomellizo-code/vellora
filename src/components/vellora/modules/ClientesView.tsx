"use client";

/* VelloRa ERP — Módulo Clientes: directorio con búsqueda, ficha e historial. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Plus, Search } from "lucide-react";
import type { Customer, OrganizationContext } from "@/lib/vellora/types";
import { fetchCustomers } from "@/lib/vellora/queries";
import { formatDate } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

export default function ClientesView({ ctx }: { ctx: OrganizationContext }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Customer | null>(null);

  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fBirth, setFBirth] = useState("");
  const [fNotes, setFNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await fetchCustomers(ctx.organizationId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar clientes");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? "").includes(q) || (c.email ?? "").toLowerCase().includes(q)
    );
  }, [customers, query]);

  const canCreate = can(ctx.permissions, "clientes", "can_create");
  const canUpdate = can(ctx.permissions, "clientes", "can_update");

  async function createCustomer() {
    if (!fName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("customers").insert({
      organization_id: ctx.organizationId,
      full_name: fName.trim(),
      phone: fPhone.trim() || null,
      whatsapp: fPhone.trim() || null,
      email: fEmail.trim() || null,
      birth_date: fBirth || null,
      notes: fNotes.trim() || null,
      active: true,
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible crear el cliente: ${insErr.message}`);
      return;
    }
    setShowNew(false);
    setFName(""); setFPhone(""); setFEmail(""); setFBirth(""); setFNotes("");
    setNotice("Cliente creado correctamente.");
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Clientes"
        subtitle="Directorio con datos de contacto, alergias y notas de cada cliente."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => setShowNew(true)}>
                <Plus size={14} /> Nuevo cliente
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <section className="vr-card">
        <div className="vr-form" style={{ marginBottom: 14 }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: "#9a96a9" }} />
            <input
              placeholder="Buscar por nombre, teléfono o correo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 34, width: "100%" }}
              aria-label="Buscar clientes"
            />
          </div>
          <span className="vr-muted" style={{ fontSize: 12 }}>{filtered.length} de {customers.length} clientes</span>
        </div>

        {loading ? (
          <EmptyState title="Cargando clientes…" body=" " />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin resultados" body="No hay clientes que coincidan con la búsqueda." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Documento</th>
                  <th>Teléfono</th>
                  <th>Instagram</th>
                  <th>Desde</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 40).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.full_name}</strong>
                      {c.email && <><br /><span className="vr-muted" style={{ fontSize: 10.5 }}>{c.email}</span></>}
                    </td>
                    <td>{c.document_number ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.instagram ?? "—"}</td>
                    <td>{formatDate(c.created_at)}</td>
                    <td>
                      <button className="vr-btn-secondary vr-btn-sm" onClick={() => setDetail(c)}>
                        Ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={showNew} title="Nuevo cliente" onClose={() => setShowNew(false)}>
        <FormGrid>
          <Field label="Nombre completo">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ej. Mariana Gómez" maxLength={80} />
          </Field>
          <Field label="Teléfono">
            <input value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="+57 300 000 0000" />
          </Field>
          <Field label="Correo">
            <input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="cliente@correo.com" />
          </Field>
          <Field label="Fecha de nacimiento">
            <input type="date" value={fBirth} onChange={(e) => setFBirth(e.target.value)} />
          </Field>
          <Field label="Notas">
            <input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Alergias, preferencias…" />
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createCustomer()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar cliente
          </button>
        </div>
      </Modal>

      <Modal open={detail !== null} title="Ficha del cliente" onClose={() => setDetail(null)} width={430}>
        {detail && (
          <div className="vr-stack" style={{ gap: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 800, font: "800 22px Manrope,sans-serif" }}>{detail.full_name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                ["Documento", detail.document_number ?? "—"],
                ["Teléfono", detail.phone ?? "—"],
                ["WhatsApp", detail.whatsapp ?? "—"],
                ["Correo", detail.email ?? "—"],
                ["Nacimiento", detail.birth_date ? formatDate(detail.birth_date) : "—"],
                ["Instagram", detail.instagram ?? "—"],
                ["Tipo de cabello", detail.hair_type ?? "—"],
                ["Origen", detail.acquisition_source ?? "—"],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: 10, background: "#fbfaff", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: "#9a96a9", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
            {(detail.allergies || detail.notes) && (
              <div className="vr-alert vr-alert-info">
                <span>{detail.allergies && <><strong>Alergias:</strong> {detail.allergies} </>}{detail.notes && <><strong>Notas:</strong> {detail.notes}</>}</span>
              </div>
            )}
            {canUpdate && <span className="vr-muted" style={{ fontSize: 11 }}>Los cambios de ficha se guardan desde la edición del registro.</span>}
          </div>
        )}
      </Modal>
    </div>
  );
}
