"use client";

/* VelloRa ERP — Módulo Compras: órdenes a proveedores con VARIOS artículos
   (suppliers + purchases + purchase_items). El formulario permite acumular
   líneas de productos con cantidad y costo unitario, y crea una sola orden con
   todas. Estados reales del CHECK: draft / received / cancelled. */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Plus, Trash2 } from "lucide-react";
import type { OrganizationContext, Product, Purchase, PurchaseItem, Supplier } from "@/lib/vellora/types";
import { fetchProducts } from "@/lib/vellora/queries";
import { formatCOP, formatDate } from "@/lib/vellora/format";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, StatusPill, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

type PurchaseLine = { product_id: string; name: string; qty: number; cost: number };

export default function ComprasView({ ctx }: { ctx: OrganizationContext }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Purchase | null>(null);

  /* Formulario: proveedor + constructor de líneas (varios artículos por orden) */
  const [fSupplierId, setFSupplierId] = useState("");
  const [fProductId, setFProductId] = useState("");
  const [fQty, setFQty] = useState("1");
  const [fCost, setFCost] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [pur, prod, sup] = await Promise.all([
        sb.from("purchases").select("*").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }),
        fetchProducts(ctx.organizationId),
        sb.from("suppliers").select("*").eq("organization_id", ctx.organizationId).eq("active", true).order("name"),
      ]);
      if (pur.error) throw new Error(pur.error.message);
      const rows = ((pur.data ?? []) as unknown) as Purchase[];
      const sups = ((sup.data ?? []) as unknown) as Supplier[];
      setPurchases(rows.map((p) => ({ ...p, supplier_name: sups.find((s) => s.id === p.supplier_id)?.name ?? "—" })));
      setProducts(prod);
      setSuppliers(sups);
      if (rows.length > 0) {
        const ids = rows.map((p) => p.id);
        const { data: it } = await sb.from("purchase_items").select("*").in("purchase_id", ids);
        const rawItems = ((it ?? []) as unknown) as PurchaseItem[];
        setItems(rawItems.map((i) => ({ ...i, product_name: prod.find((p) => p.id === i.product_id)?.name ?? "Producto" })));
      } else {
        setItems([]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar compras");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Limpia por completo el formulario de nueva orden (se usa al abrir y tras crear) */
  function resetPurchaseForm() {
    setFSupplierId("");
    setFProductId("");
    setFQty("1");
    setFCost("");
    setLines([]);
  }

  function addLine() {
    const prod = products.find((p) => p.id === fProductId);
    const qty = Number(fQty);
    const cost = fCost === "" ? prod?.cost ?? 0 : Number(fCost);
    if (!prod) {
      setError("Selecciona un producto para agregarlo a la orden.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("La cantidad debe ser mayor a cero.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("El costo unitario no es válido.");
      return;
    }
    setError("");
    /* Si el producto ya está en la orden, suma cantidades y actualiza el costo */
    setLines((ls) => {
      const existing = ls.find((l) => l.product_id === prod.id);
      if (existing) {
        return ls.map((l) => (l.product_id === prod.id ? { ...l, qty: l.qty + qty, cost } : l));
      }
      return [...ls, { product_id: prod.id, name: prod.name, qty, cost }];
    });
    setFProductId("");
    setFQty("1");
    setFCost("");
  }

  const linesTotal = lines.reduce((a, l) => a + l.qty * l.cost, 0);

  async function createPurchase() {
    if (!fSupplierId) {
      setError("Selecciona el proveedor.");
      return;
    }
    if (lines.length === 0) {
      setError("Agrega al menos un producto a la orden.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const { data, error: insErr } = await sb
      .from("purchases")
      .insert({
        organization_id: ctx.organizationId,
        supplier_id: fSupplierId,
        purchase_number: `OC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        status: "draft",
        purchase_date: new Date().toISOString().slice(0, 10),
        total: linesTotal,
        subtotal: linesTotal,
      })
      .select("id")
      .single();
    if (insErr || !data) {
      setSaving(false);
      setError(`No fue posible crear la orden: ${insErr?.message ?? "sin id"}`);
      return;
    }
    const purchaseId = (data as unknown as { id: string }).id;
    const { error: itemErr } = await sb.from("purchase_items").insert(
      lines.map((l) => ({
        purchase_id: purchaseId,
        product_id: l.product_id,
        quantity: l.qty,
        unit_cost: l.cost,
      }))
    );
    if (itemErr) {
      setError(`Orden creada, pero falló el detalle: ${itemErr.message}`);
      setSaving(false);
      await load();
      return;
    }
    setSaving(false);
    setShowNew(false);
    resetPurchaseForm();
    setNotice(`Orden creada con ${lines.length} artículo(s) por ${formatCOP(linesTotal)}. Recíbela para sumar el stock.`);
    await load();
  }

  async function receive(purchase: Purchase) {
    const sb = supabaseBrowser();
    const { error: upErr } = await sb.from("purchases").update({ status: "received", received_at: new Date().toISOString() }).eq("id", purchase.id);
    if (upErr) {
      setError(`No se pudo recibir la orden: ${upErr.message}`);
      return;
    }
    /* Sumar stock de los productos de la orden + registrar el movimiento de inventario */
    const orderLines = items.filter((i) => i.purchase_id === purchase.id);
    for (const line of orderLines) {
      if (!line.product_id) continue;
      const prod = products.find((p) => p.id === line.product_id);
      if (!prod) continue;
      await sb.from("products").update({ stock: prod.stock + line.quantity }).eq("id", prod.id);
      await sb.from("inventory_movements").insert({
        organization_id: ctx.organizationId,
        product_id: prod.id,
        movement_type: "entrada",
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        reference: purchase.purchase_number ?? `OC ${purchase.id.slice(0, 8)}`,
      });
    }
    setNotice(`Orden de ${purchase.supplier_name ?? "proveedor"} recibida. Stock actualizado.`);
    await load();
  }

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthTotal = purchases
    .filter((p) => p.created_at.slice(0, 7) === monthKey)
    .reduce((a, p) => a + p.total, 0);

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Compras"
        subtitle="Órdenes a proveedores con varios artículos y recepción de mercancía."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            <button
              className="vr-btn"
              onClick={() => {
                resetPurchaseForm();
                setShowNew(true);
              }}
            >
              <Plus size={14} /> Nueva orden
            </button>
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Órdenes este mes</div>
          <div className="vr-metric-value">{purchases.filter((p) => p.created_at.slice(0, 7) === monthKey).length}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Compras del mes</div>
          <div className="vr-metric-value">{formatCOP(monthTotal, { compact: true })}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Por recibir</div>
          <div className="vr-metric-value" style={{ color: "#c67a26" }}>{purchases.filter((p) => p.status === "draft").length}</div>
        </div>
      </div>

      <section className="vr-card">
        {loading ? (
          <EmptyState title="Cargando compras…" body=" " />
        ) : purchases.length === 0 ? (
          <EmptyState title="Sin órdenes" body="Aún no hay órdenes de compra registradas." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Productos</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="vr-muted">{p.purchase_number ?? "—"}</td>
                    <td>{formatDate(p.created_at)}</td>
                    <td><strong>{p.supplier_name ?? "—"}</strong></td>
                    <td>{items.filter((i) => i.purchase_id === p.id).length}</td>
                    <td><strong>{formatCOP(p.total)}</strong></td>
                    <td><StatusPill status={p.status} /></td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="vr-btn-secondary vr-btn-sm" onClick={() => setDetail(p)}>Detalle</button>
                        {p.status === "draft" && (
                          <button className="vr-btn vr-btn-sm" onClick={() => void receive(p)}>Recibir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={showNew} title="Nueva orden de compra" onClose={() => setShowNew(false)} width={640}>
        <FormGrid>
          <Field label="Proveedor">
            <select value={fSupplierId} onChange={(e) => setFSupplierId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        </FormGrid>

        {/* Constructor de líneas: varios artículos por orden */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", margin: "4px 0 12px" }}>
          <div style={{ flex: "2 1 200px" }}>
            <Field label="Producto">
              <select
                value={fProductId}
                onChange={(e) => {
                  setFProductId(e.target.value);
                  const prod = products.find((p) => p.id === e.target.value);
                  setFCost(prod ? String(prod.cost) : "");
                }}
              >
                <option value="">Seleccionar…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · costo {formatCOP(p.cost)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <Field label="Cantidad">
              <input type="number" min="0" step="0.01" value={fQty} onChange={(e) => setFQty(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <Field label="Costo unitario">
              <input type="number" min="0" step="100" value={fCost} onChange={(e) => setFCost(e.target.value)} />
            </Field>
          </div>
          <button className="vr-btn-secondary" onClick={addLine} style={{ height: 40 }}>
            <Plus size={14} /> Agregar
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="vr-muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
            Aún no has agregado productos. Selecciona uno, indica cantidad y costo, y pulsa «Agregar». Puedes agregar varios.
          </p>
        ) : (
          <div className="vr-table-wrap" style={{ marginBottom: 12 }}>
            <table className="vr-table">
              <thead>
                <tr><th>Producto</th><th>Cant.</th><th>Costo unit.</th><th>Subtotal</th><th /></tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.product_id}>
                    <td>{l.name}</td>
                    <td>{l.qty}</td>
                    <td>{formatCOP(l.cost)}</td>
                    <td><strong>{formatCOP(l.qty * l.cost)}</strong></td>
                    <td>
                      <button
                        className="vr-btn-secondary vr-btn-sm"
                        onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                        aria-label={`Quitar ${l.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Total de la orden</td>
                  <td colSpan={2}><strong>{formatCOP(linesTotal)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createPurchase()} disabled={saving || lines.length === 0}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Crear orden ({lines.length})
          </button>
        </div>
      </Modal>

      <Modal open={detail !== null} title={`Orden · ${detail?.purchase_number ?? ""}`} onClose={() => setDetail(null)} width={520}>
        {detail && (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr><th>Producto</th><th>Cant.</th><th>Costo unit.</th><th>Total</th></tr>
              </thead>
              <tbody>
                {items.filter((i) => i.purchase_id === detail.id).map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_name ?? "—"}</td>
                    <td>{i.quantity}</td>
                    <td>{formatCOP(i.unit_cost)}</td>
                    <td><strong>{formatCOP(i.quantity * i.unit_cost)}</strong></td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                  <td><strong>{formatCOP(detail.total)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
