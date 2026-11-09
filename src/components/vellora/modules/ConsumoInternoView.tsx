"use client";

/* VelloRa ERP — Módulo Consumo interno: descuento de inventario por uso interno.
   Ej.: se compran 6 L de shampoo; si 2 L se usan en servicios, aquí se registra
   ese consumo y el inventario queda con lo realmente vendible. Cada registro
   crea un movimiento de inventario tipo "consumo_interno" (trazable con su
   costo y referencia) y descuenta el stock del producto. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Loader2, RefreshCw } from "lucide-react";
import type { InventoryMovement, OrganizationContext, Product } from "@/lib/vellora/types";
import { fetchProducts } from "@/lib/vellora/queries";
import { formatCOP, formatDate } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Field } from "../ui-bits";

export default function ConsumoInternoView({ ctx }: { ctx: OrganizationContext }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [fProductId, setFProductId] = useState("");
  const [fQty, setFQty] = useState("");
  const [fRef, setFRef] = useState("");

  const canCreate = can(ctx.permissions, "consumo", "can_create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [prod, mov] = await Promise.all([
        fetchProducts(ctx.organizationId),
        sb
          .from("inventory_movements")
          .select("*")
          .eq("organization_id", ctx.organizationId)
          .eq("movement_type", "consumo_interno")
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      if (mov.error) throw new Error(mov.error.message);
      setProducts(prod);
      setMovements(((mov.data ?? []) as unknown) as InventoryMovement[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el consumo interno");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unitOf = (p: Product | undefined) => (p?.unit && p.unit.trim() ? p.unit : "uds");

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthMovs = useMemo(() => movements.filter((m) => m.created_at.slice(0, 7) === monthKey), [movements, monthKey]);
  const monthCost = monthMovs.reduce((a, m) => a + m.quantity * (m.unit_cost ?? 0), 0);
  const lowStock = products.filter((p) => p.active && p.stock <= p.minimum_stock).length;

  async function registerConsumption() {
    const prod = products.find((p) => p.id === fProductId);
    const qty = Number(fQty);
    if (!prod) {
      setError("Selecciona el producto consumido.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Ingresa una cantidad válida mayor a cero (admite decimales, ej. 0.5).");
      return;
    }
    if (qty > prod.stock) {
      setError(`Stock insuficiente: solo hay ${prod.stock} ${unitOf(prod)} de ${prod.name}.`);
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();

    const { error: movErr } = await sb.from("inventory_movements").insert({
      organization_id: ctx.organizationId,
      product_id: prod.id,
      movement_type: "consumo_interno",
      quantity: qty,
      unit_cost: prod.cost,
      reference: fRef.trim() || null,
    });
    if (movErr) {
      setSaving(false);
      setError(`No fue posible registrar el consumo: ${movErr.message}`);
      return;
    }
    const { error: upErr } = await sb
      .from("products")
      .update({ stock: Math.max(0, prod.stock - qty) })
      .eq("id", prod.id);
    if (upErr) {
      setSaving(false);
      setError(`El movimiento quedó registrado pero falló el descuento de stock: ${upErr.message}`);
      await load();
      return;
    }
    setSaving(false);
    setFProductId("");
    setFQty("");
    setFRef("");
    setNotice(`Consumo registrado: ${qty} ${unitOf(prod)} de ${prod.name}. Inventario actualizado.`);
    await load();
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "Producto";
  const productUnit = (id: string) => unitOf(products.find((p) => p.id === id));

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Consumo interno"
        subtitle="Descuenta del inventario los insumos usados en servicios, aseo u operaciones; deja trazabilidad con su costo."
        actions={
          <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Consumo del mes (costo)</div>
          <div className="vr-metric-value">{formatCOP(monthCost, { compact: true })}</div>
          <div className="vr-metric-note">{monthMovs.length} registro(s) este mes</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Registros totales</div>
          <div className="vr-metric-value">{movements.length}</div>
          <div className="vr-metric-note">Últimos 60 movimientos</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Alertas de stock</div>
          <div className="vr-metric-value" style={{ color: lowStock ? "#c67a26" : undefined }}>{lowStock}</div>
          <div className="vr-metric-note">Productos en o bajo el mínimo</div>
        </div>
      </div>

      {/* ————— Formulario de registro ————— */}
      <section className="vr-card">
        <h2><FlaskConical size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Registrar consumo interno</h2>
        <p className="vr-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Ejemplo: compraste 6 litros de shampoo y 2 litros se usaron en servicios → registra 2 litros aquí y el
          inventario quedará con lo realmente disponible para vender. La cantidad admite decimales (ej. 0.5).
        </p>
        {canCreate ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 220px" }}>
              <Field label="Producto">
                <select value={fProductId} onChange={(e) => setFProductId(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {products.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · stock {p.stock} {unitOf(p)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <Field label="Cantidad usada">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fQty}
                  onChange={(e) => setFQty(e.target.value)}
                  placeholder="Ej. 2 o 0.5"
                />
              </Field>
            </div>
            <div style={{ flex: "2 1 220px" }}>
              <Field label="Referencia / motivo (opcional)">
                <input
                  value={fRef}
                  onChange={(e) => setFRef(e.target.value)}
                  placeholder="Ej: Keratina — cliente María / aseo general"
                  maxLength={120}
                />
              </Field>
            </div>
            <button className="vr-btn" onClick={() => void registerConsumption()} disabled={saving} style={{ height: 40 }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={5} />} Registrar consumo
            </button>
          </div>
        ) : (
          <EmptyState title="Solo lectura" body="Tu perfil puede consultar el historial, pero no registrar consumos." />
        )}
      </section>

      {/* ————— Historial ————— */}
      <section className="vr-card">
        <h2>Historial de consumo</h2>
        {loading ? (
          <EmptyState title="Cargando movimientos…" body=" " />
        ) : movements.length === 0 ? (
          <EmptyState
            title="Sin consumos registrados"
            body="Cuando registres consumo interno de productos, aparecerá aquí con fecha, cantidad y costo."
          />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Costo</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.created_at)}</td>
                    <td><strong>{productName(m.product_id)}</strong></td>
                    <td>
                      <span className="vr-pill vr-pill-gray">
                        {m.quantity} {productUnit(m.product_id)}
                      </span>
                    </td>
                    <td>{formatCOP(m.quantity * (m.unit_cost ?? 0))}</td>
                    <td className="vr-muted">{m.reference ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
