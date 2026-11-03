"use client";

/* VelloRa ERP — Módulo Inventario: productos, stock y alertas de mínimo. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Plus, AlertTriangle } from "lucide-react";
import type { OrganizationContext, Product } from "@/lib/vellora/types";
import { fetchProducts } from "@/lib/vellora/queries";
import { formatCOP } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { PageHeader, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

const UNIDADES = ["unidad", "litros", "mililitros", "gramos", "kilogramos", "metros", "cajas", "paquetes"];

export default function InventarioView({ ctx }: { ctx: OrganizationContext }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fName, setFName] = useState("");
  const [fSku, setFSku] = useState("");
  const [fCategory, setFCategory] = useState("Cabello");
  const [fCost, setFCost] = useState(20000);
  const [fPrice, setFPrice] = useState(38000);
  const [fStock, setFStock] = useState(10);
  const [fMin, setFMin] = useState(6);
  const [fUnit, setFUnit] = useState("unidad");

  const canCreate = can(ctx.permissions, "inventario", "can_create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await fetchProducts(ctx.organizationId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar inventario");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!onlyLow || p.stock <= p.minimum_stock) &&
        (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
    );
  }, [products, query, onlyLow]);

  const lowCount = products.filter((p) => p.active && p.stock <= p.minimum_stock).length;
  const stockValue = products.reduce((a, p) => a + p.stock * p.cost, 0);

  async function createProduct() {
    if (!fName.trim()) {
      setError("El nombre del producto es obligatorio.");
      return;
    }
    setSaving(true);
    setError("");
    const sb = supabaseBrowser();
    const { error: insErr } = await sb.from("products").insert({
      organization_id: ctx.organizationId,
      sku: fSku.trim() || `VEL-${Date.now().toString().slice(-6)}`,
      name: fName.trim(),
      category: fCategory,
      cost: fCost,
      sale_price: fPrice,
      stock: fStock,
      minimum_stock: fMin,
      unit: fUnit,
      active: true,
    });
    setSaving(false);
    if (insErr) {
      setError(`No fue posible crear el producto: ${insErr.message}`);
      return;
    }
    setShowNew(false);
    setFName(""); setFSku("");
    setNotice("Producto creado correctamente.");
    await load();
  }

  async function adjustStock(p: Product, delta: number) {
    const sb = supabaseBrowser();
    const next = Math.max(0, p.stock + delta);
    const { error: upErr } = await sb.from("products").update({ stock: next }).eq("id", p.id);
    if (upErr) {
      setError(`No se pudo ajustar el stock: ${upErr.message}`);
      return;
    }
    setNotice(`Stock de ${p.name}: ${next} unidades.`);
    await load();
  }

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Gestión"
        title="Inventario"
        subtitle="Productos de venta interna, costos y alertas de stock mínimo."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button className="vr-btn" onClick={() => setShowNew(true)}>
                <Plus size={14} /> Nuevo producto
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}

      {lowCount > 0 && (
        <div className="vr-alert vr-alert-warning">
          <AlertTriangle size={16} />
          <span><strong>{lowCount} productos</strong> en o por debajo del stock mínimo. Genera una orden de compra en Compras.</span>
        </div>
      )}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Productos activos</div>
          <div className="vr-metric-value">{products.filter((p) => p.active).length}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Valor del inventario (costo)</div>
          <div className="vr-metric-value">{formatCOP(stockValue, { compact: true })}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Alertas de stock</div>
          <div className="vr-metric-value" style={{ color: lowCount ? "#c67a26" : undefined }}>{lowCount}</div>
        </div>
      </div>

      <section className="vr-card">
        <div className="vr-form" style={{ marginBottom: 14 }}>
          <input placeholder="Buscar por nombre o SKU…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 300 }} aria-label="Buscar productos" />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} style={{ width: 15, height: 15 }} />
            Solo stock bajo
          </label>
          <span className="vr-muted" style={{ fontSize: 12 }}>{filtered.length} productos</span>
        </div>

        {loading ? (
          <EmptyState title="Cargando inventario…" body=" " />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin productos" body="No hay productos con los filtros seleccionados." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th>Categoría</th>
                  <th>Costo</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Mínimo</th>
                  {canCreate && <th>Ajuste</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map((p) => {
                  const low = p.stock <= p.minimum_stock;
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td className="vr-muted">{p.sku ?? "—"}</td>
                      <td><span className="vr-pill vr-pill-gray">{p.category ?? "—"}</span></td>
                      <td>{formatCOP(p.cost)}</td>
                      <td><strong>{formatCOP(p.sale_price)}</strong></td>
                      <td>
                        <span className={`vr-pill ${low ? "vr-pill-red" : "vr-pill-green"}`}>
                          {p.stock} {p.unit && p.unit !== "unidad" ? p.unit : "uds"}
                        </span>
                      </td>
                      <td>{p.minimum_stock}</td>
                      {canCreate && (
                        <td>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => void adjustStock(p, 5)}>+5</button>
                            <button className="vr-btn-secondary vr-btn-sm" onClick={() => void adjustStock(p, -1)} disabled={p.stock === 0}>−1</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={showNew} title="Nuevo producto" onClose={() => setShowNew(false)}>
        <FormGrid>
          <Field label="Nombre">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ej. Shampoo hidratante 400ml" maxLength={80} />
          </Field>
          <Field label="SKU">
            <input value={fSku} onChange={(e) => setFSku(e.target.value)} placeholder="VEL-019" />
          </Field>
          <Field label="Categoría">
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              {["Cabello", "Uñas", "Rostro", "Spa", "Insumos"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Costo (COP)">
            <input type="number" min={0} step={1000} value={fCost} onChange={(e) => setFCost(Number(e.target.value))} />
          </Field>
          <Field label="Precio venta (COP)">
            <input type="number" min={0} step={1000} value={fPrice} onChange={(e) => setFPrice(Number(e.target.value))} />
          </Field>
          <Field label="Stock inicial">
            <input type="number" min={0} value={fStock} onChange={(e) => setFStock(Number(e.target.value))} />
          </Field>
          <Field label="Stock mínimo">
            <input type="number" min={0} value={fMin} onChange={(e) => setFMin(Number(e.target.value))} />
          </Field>
          <Field label="Unidad de medida">
            <select value={fUnit} onChange={(e) => setFUnit(e.target.value)}>
              {UNIDADES.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createProduct()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}
