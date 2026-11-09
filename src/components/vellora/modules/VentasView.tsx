"use client";

/* VelloRa ERP — Módulo Ventas: venta directa (POS) + historial de facturación.
   Además de las ventas que llegan desde la agenda (citas completadas enviadas
   a caja), aquí se registran ventas SIN agenda con N ítems en una sola orden:
     · Varios servicios y/o varios productos combinados (ej. Manicure +
       Pedicure + un shampoo → 3 ítems registrados en la MISMA venta).
     · Cliente existente, nuevo (se crea al registrar) u ocasional.
     · Los productos descuentan inventario y dejan inventory_movements.
     · Asociación con la caja: con caja abierta, el cobro en efectivo genera
       un cash_movements tipo 'sale' ligado al pago → entra al arqueo del día
       (la descripción del movimiento muestra el detalle de los ítems).
   El registro usa la RPC vellora_create_sale (SQL v18/v17); si aún no se
   aplicó, cae al registro paso a paso (queries.createSale).
   El historial muestra la columna ÍTENS con el detalle de cada venta
   (descripción, cantidad y valor por ítem) para verificar lo registrado. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Loader2, Minus, Plus, RefreshCw, Search, ShoppingBag, Trash2,
} from "lucide-react";
import type {
  CashSession, Customer, Employee, OrganizationContext, Product, Service, ServiceOrder, ServiceOrderItem,
} from "@/lib/vellora/types";
import {
  createSale, fetchCashSessions, fetchCustomers, fetchEmployees,
  fetchProducts, fetchSales, fetchServices, type SaleLineInput,
} from "@/lib/vellora/queries";
import { formatCOP, formatDateTime, bogotaDayKey } from "@/lib/vellora/format";
import { can } from "@/lib/vellora/permissions";
import { PageHeader, StatusPill, EmptyState, Modal, Field, FormGrid } from "../ui-bits";

const PAY_METHODS = ["efectivo", "transferencia", "tarjeta"] as const;

/** Línea del formulario: SaleLineInput + clave local de UI. */
type SaleLine = SaleLineInput & { key: string };

const BORDER = "1px solid var(--bp-border)";

export default function VentasView({ ctx }: { ctx: OrganizationContext }) {
  const [sales, setSales] = useState<ServiceOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warn, setWarn] = useState("");
  const [kindFilter, setKindFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ————— Modal nueva venta (POS multi-ítem) ————— */
  const [showNew, setShowNew] = useState(false);
  const [custSel, setCustSel] = useState("occasional"); // occasional | new | <customer_id>
  const [fNewName, setFNewName] = useState("");
  const [fEmployee, setFEmployee] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [tab, setTab] = useState<"servicios" | "productos">("servicios");
  const [query, setQuery] = useState("");
  const [fDiscount, setFDiscount] = useState("");
  const [fMethod, setFMethod] = useState<string>("efectivo");
  const [fCollect, setFCollect] = useState("ahora"); // ahora | abierta
  const [modalErr, setModalErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, cus, svc, prd, emp, ses] = await Promise.all([
        fetchSales(ctx.organizationId, 45),
        fetchCustomers(ctx.organizationId).catch(() => [] as Customer[]),
        fetchServices(ctx.organizationId).catch(() => [] as Service[]),
        fetchProducts(ctx.organizationId).catch(() => [] as Product[]),
        fetchEmployees(ctx.organizationId).catch(() => [] as Employee[]),
        fetchCashSessions(ctx.organizationId).catch(() => [] as CashSession[]),
      ]);
      setSales(v);
      setCustomers(cus);
      setServices(svc);
      setProducts(prd);
      setEmployees(emp);
      setSessions(ses);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar ventas");
    } finally {
      setLoading(false);
    }
  }, [ctx.organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ————— Derivados ————— */
  const canCreate = can(ctx.permissions, "ventas", "can_create");
  const openSession = sessions.find((s) => s.status === "open") ?? null;

  const filtered = useMemo(
    () =>
      sales.filter(
        (s) =>
          (kindFilter === "todas" || s.kind === kindFilter) &&
          (statusFilter === "todas" || s.status === statusFilter)
      ),
    [sales, kindFilter, statusFilter]
  );

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const customerLabel = (s: ServiceOrder) =>
    s.customer_id ? customerById.get(s.customer_id)?.full_name ?? "Cliente" : "Ocasional";

  const todayKey = bogotaDayKey(new Date());
  const todayTotal = sales
    .filter((s) => bogotaDayKey(new Date(s.created_at)) === todayKey && s.status === "paid")
    .reduce((a, s) => a + s.total, 0);
  const monthTotal = sales
    .filter((s) => s.status === "paid" && bogotaDayKey(new Date(s.created_at)).slice(0, 7) === todayKey.slice(0, 7))
    .reduce((a, s) => a + s.total, 0);

  /* Totales del carrito */
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unit_price, 0);
  const discount = Math.min(Math.max(Number(fDiscount) || 0, 0), subtotal);
  const total = Math.round(subtotal - discount);
  const nSvc = lines.filter((l) => l.kind === "servicio").length;
  const nPrd = lines.filter((l) => l.kind === "producto").length;

  /* Stock disponible para cada línea de producto (resta las otras líneas del mismo producto) */
  const inCartByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (l.kind === "producto" && l.product_id) m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.quantity);
    }
    return m;
  }, [lines]);
  const remaining = (productId: string): number => {
    const p = products.find((x) => x.id === productId);
    if (!p) return 0;
    return p.stock - (inCartByProduct.get(productId) ?? 0);
  };

  /* ————— Catálogo con búsqueda ————— */
  const q = query.trim().toLowerCase();
  const svcList = services.filter(
    (s) => s.active && (!q || s.name.toLowerCase().includes(q))
  );
  const prdList = products.filter(
    (p) => p.active && (!q || p.name.toLowerCase().includes(q))
  );

  /* ————— Formulario de venta ————— */
  function resetForm() {
    setCustSel("occasional");
    setFNewName("");
    setFEmployee("");
    setLines([]);
    setTab("servicios");
    setQuery("");
    setFDiscount("");
    setFMethod("efectivo");
    setFCollect("ahora");
    setModalErr("");
  }

  function newKey() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addService(svc: Service) {
    setModalErr("");
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        kind: "servicio",
        service_id: svc.id,
        product_id: null,
        description: svc.name,
        quantity: 1,
        unit_price: svc.price,
      },
    ]);
  }

  function addProduct(prd: Product) {
    const avail = prd.stock - (inCartByProduct.get(prd.id) ?? 0);
    if (avail <= 0) {
      setModalErr(`Sin stock disponible de ${prd.name} (hay ${prd.stock}).`);
      return;
    }
    setModalErr("");
    /* Si el producto ya está en el carrito, suma 1 a esa línea; si no, crea la línea */
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.kind === "producto" && l.product_id === prd.id);
      if (idx >= 0) {
        const copy = [...ls];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...ls,
        {
          key: newKey(),
          kind: "producto",
          service_id: null,
          product_id: prd.id,
          description: prd.name,
          quantity: 1,
          unit_price: prd.sale_price,
        },
      ];
    });
  }

  function changeQty(key: string, delta: number) {
    const l = lines.find((x) => x.key === key);
    if (!l) return;
    let next = l.quantity + delta;
    if (l.kind === "producto" && l.product_id) {
      const stock = products.find((p) => p.id === l.product_id)?.stock ?? 0;
      const remain = stock - ((inCartByProduct.get(l.product_id) ?? 0) - l.quantity);
      if (next > remain) {
        setModalErr(`Stock insuficiente de ${l.description}: hay ${stock}, quedan ${remain} disponibles.`);
        return;
      }
    }
    next = Math.max(l.kind === "producto" ? 1 : 0.5, Math.round(next * 10) / 10);
    setLines((ls) => ls.map((x) => (x.key === key ? { ...x, quantity: next } : x)));
    setModalErr("");
  }

  function setQty(key: string, value: number) {
    const l = lines.find((x) => x.key === key);
    if (!l) return;
    let next = Math.max(l.kind === "producto" ? 1 : 0.5, Math.round((value || 0) * 10) / 10);
    if (l.kind === "producto" && l.product_id) {
      const stock = products.find((p) => p.id === l.product_id)?.stock ?? 0;
      const remain = stock - ((inCartByProduct.get(l.product_id) ?? 0) - l.quantity);
      if (next > remain) {
        setModalErr(`Stock insuficiente de ${l.description}: hay ${stock}, quedan ${remain} disponibles.`);
        next = Math.max(1, remain);
      }
    }
    setLines((ls) => ls.map((x) => (x.key === key ? { ...x, quantity: next } : x)));
  }

  function updPrice(key: string, value: number) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, unit_price: Math.max(0, value || 0) } : l)));
  }

  function delLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function submitSale() {
    if (lines.length === 0) {
      setModalErr("Agrega al menos un ítem: uno o varios servicios del catálogo y/o productos del inventario.");
      return;
    }
    if (custSel === "new" && !fNewName.trim()) {
      setModalErr("Escribe el nombre del cliente nuevo (o elige cliente ocasional).");
      return;
    }
    for (const [pid, qty] of inCartByProduct) {
      const p = products.find((x) => x.id === pid);
      if (!p) {
        setModalErr("Uno de los productos de la venta ya no existe en el inventario. Actualiza y reintenta.");
        return;
      }
      if (qty > p.stock) {
        setModalErr(`Stock insuficiente de ${p.name}: hay ${p.stock}, pides ${qty}.`);
        return;
      }
    }
    if (total <= 0) {
      setModalErr("El total de la venta debe ser mayor a cero.");
      return;
    }
    setSaving(true);
    setModalErr("");
    try {
      const res = await createSale({
        organizationId: ctx.organizationId,
        lines: lines.map((l) => ({
          kind: l.kind,
          service_id: l.service_id ?? null,
          product_id: l.product_id ?? null,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        customerId: custSel !== "occasional" && custSel !== "new" ? custSel : null,
        customerName: custSel === "new" ? fNewName.trim() : null,
        employeeId: fEmployee || null,
        branchId: openSession?.branch_id ?? ctx.branches[0]?.id ?? null,
        paymentMethod: fMethod,
        collectNow: fCollect === "ahora",
        discount: Number(fDiscount) || 0,
        cashRegisterId: openSession?.id ?? null,
      });
      setShowNew(false);
      resetForm();
      setSaving(false);
      setError("");
      let msg = `Venta registrada con ${res.items_count ?? lines.length} ítem(s) (${nSvc} servicio(s) + ${nPrd} producto(s)) por ${formatCOP(res.total)}`;
      msg += res.status === "paid" ? " — pagada." : " — por cobrar: se cobra en el módulo Caja.";
      if (res.customer_created) msg += " Se creó el cliente nuevo.";
      if (res.stock_updated > 0) msg += ` Inventario descontado (${res.stock_updated} producto(s)).`;
      if (res.status === "paid" && fMethod === "efectivo" && res.cash_movement_id) msg += " El efectivo entró al arqueo de la caja abierta.";
      setNotice(msg);
      setWarn(res.warnings || "");
      await load();
    } catch (err) {
      setSaving(false);
      setModalErr(err instanceof Error ? err.message : "No fue posible registrar la venta");
    }
  }

  /* ————— Historial: resumen de ítems por venta ————— */
  function itemsSummary(s: ServiceOrder): string {
    const its = s.items ?? [];
    if (its.length === 0) return "—";
    const names = its.map((i) => `${i.description}${Number(i.quantity) > 1 ? ` ×${Number(i.quantity)}` : ""}`);
    const shown = names.slice(0, 3).join(" + ");
    return names.length > 3 ? `${shown} +${names.length - 3} más` : shown;
  }

  /* ————— Render ————— */
  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Ventas"
        subtitle="Facturación con o sin agenda: cada venta admite varios ítems combinados (ej. Manicure + Pedicure + un shampoo), asociada a la caja y con descuento de inventario."
        actions={
          <>
            <button className="vr-btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {canCreate && (
              <button
                className="vr-btn"
                onClick={() => {
                  resetForm();
                  setNotice("");
                  setWarn("");
                  setShowNew(true);
                }}
              >
                <ShoppingBag size={14} /> Nueva venta
              </button>
            )}
          </>
        }
      />

      {error && <div className="vr-alert vr-alert-critical"><span>{error}</span></div>}
      {notice && !error && <div className="vr-alert vr-alert-info"><span>{notice}</span></div>}
      {warn && !error && <div className="vr-alert vr-alert-warning"><span>{warn}</span></div>}

      {!loading && !openSession && (
        <div className="vr-alert vr-alert-warning">
          <span>
            No hay caja abierta. Puedes registrar ventas igualmente (quedan pagadas o por cobrar); abre la caja en el
            módulo Caja para que los cobros en efectivo queden en el arqueo del día.
          </span>
        </div>
      )}
      {!loading && openSession && (
        <div className="vr-alert vr-alert-info">
          <span>
            Caja abierta: los cobros en efectivo que registres aquí entran automáticamente al arqueo del día.
          </span>
        </div>
      )}

      <div className="vr-metric-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Cobrado hoy</div>
          <div className="vr-metric-value">{formatCOP(todayTotal)}</div>
        </div>
        <div className="vr-metric-card">
          <div className="vr-metric-label">Cobrado este mes</div>
          <div className="vr-metric-value">{formatCOP(monthTotal, { compact: true })}</div>
        </div>
      </div>

      <section className="vr-card">
        <div className="vr-form" style={{ marginBottom: 14 }}>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="todas">Todos los tipos</option>
            <option value="servicio">Servicio</option>
            <option value="producto">Producto</option>
            <option value="mixto">Mixto</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="todas">Todos los estados</option>
            <option value="paid">Pagada</option>
            <option value="open">Abierta</option>
            <option value="void">Anulada</option>
          </select>
          <span className="vr-muted" style={{ fontSize: 12 }}>{filtered.length} ventas</span>
        </div>

        {loading ? (
          <EmptyState title="Cargando ventas…" body=" " />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin ventas" body="No hay ventas con los filtros seleccionados." />
        ) : (
          <div className="vr-table-wrap">
            <table className="vr-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Ítems</th>
                  <th>Método</th>
                  <th>Descuento</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 60).map((s) => {
                  const its = s.items ?? [];
                  const open = expandedId === s.id;
                  return (
                    <SaleRow
                      key={s.id}
                      sale={s}
                      itemsCount={its.length}
                      summary={itemsSummary(s)}
                      open={open}
                      onToggle={() => setExpandedId(open ? null : s.id)}
                      customer={customerLabel(s)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Modal: nueva venta sin agenda (POS multi-ítem) ————— */}
      <Modal open={showNew} title="Nueva venta (sin agenda)" onClose={() => setShowNew(false)} width={980}>
        <FormGrid>
          <Field label="Cliente">
            <select value={custSel} onChange={(e) => setCustSel(e.target.value)}>
              <option value="occasional">Cliente ocasional (sin registro)</option>
              <option value="new">+ Cliente nuevo…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </Field>
          {custSel === "new" && (
            <Field label="Nombre del cliente nuevo">
              <input
                value={fNewName}
                onChange={(e) => setFNewName(e.target.value)}
                placeholder="Ej: María Pérez"
              />
            </Field>
          )}
          <Field label="Profesional (opcional)">
            <select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)}>
              <option value="">Sin asignar</option>
              {employees.filter((e) => e.active).map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </Field>
        </FormGrid>

        {/* Catálogo + carrito */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 14, alignItems: "start" }}>
          {/* — Catálogo — */}
          <div style={{ border: BORDER, borderRadius: 12, padding: "12px 14px", background: "var(--bp-lilac, #f0ebff)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>1 · Catálogo</strong>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className={`vr-btn-secondary vr-btn-sm ${tab === "servicios" ? "vr-tab-on" : ""}`}
                  onClick={() => setTab("servicios")}
                  style={tab === "servicios" ? { outline: "2px solid #7556d8", outlineOffset: -2 } : undefined}
                >
                  Servicios
                </button>
                <button
                  type="button"
                  className="vr-btn-secondary vr-btn-sm"
                  onClick={() => setTab("productos")}
                  style={tab === "productos" ? { outline: "2px solid #7556d8", outlineOffset: -2 } : undefined}
                >
                  Productos
                </button>
              </div>
            </div>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#8b87a0" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre…"
                style={{ width: "100%", paddingLeft: 32 }}
              />
            </div>
            <div style={{ maxHeight: 250, overflowY: "auto", display: "grid", gap: 6 }}>
              {tab === "servicios" ? (
                svcList.length === 0 ? (
                  <div className="vr-muted" style={{ fontSize: 12.5 }}>Sin servicios que coincidan.</div>
                ) : (
                  svcList.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="vr-btn-secondary vr-btn-sm"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "#fff" }}
                      onClick={() => addService(s)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <Plus size={13} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      </span>
                      <strong>{formatCOP(s.price)}</strong>
                    </button>
                  ))
                )
              ) : prdList.length === 0 ? (
                <div className="vr-muted" style={{ fontSize: 12.5 }}>Sin productos que coincidan.</div>
              ) : (
                prdList.map((p) => {
                  const out = p.stock <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="vr-btn-secondary vr-btn-sm"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "#fff", opacity: out ? 0.55 : 1 }}
                      onClick={() => addProduct(p)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <Plus size={13} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span className="vr-muted" style={{ fontSize: 11 }}>hay {p.stock}</span>
                      </span>
                      <strong>{formatCOP(p.sale_price)}</strong>
                    </button>
                  );
                })
              )}
            </div>
            <div className="vr-muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              Cada clic agrega un ítem al carrito: puedes combinar varios servicios y productos en la misma venta
              (ej. Manicure + Pedicure + un shampoo).
            </div>
          </div>

          {/* — Carrito — */}
          <div style={{ border: BORDER, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>
                2 · Ítems de la venta{" "}
                <span className={`vr-pill ${lines.length ? "vr-pill-green" : "vr-pill-gray"}`} style={{ marginLeft: 4 }}>
                  {lines.length} ítem(s){nSvc || nPrd ? ` · ${nSvc} serv. + ${nPrd} prod.` : ""}
                </span>
              </strong>
              {lines.length > 0 && (
                <button type="button" className="vr-btn-secondary vr-btn-sm" onClick={() => setLines([])}>
                  <Trash2 size={12} /> Vaciar
                </button>
              )}
            </div>
            {lines.length === 0 ? (
              <div className="vr-muted" style={{ fontSize: 12.5, padding: "18px 4px", textAlign: "center" }}>
                Aún no hay ítems. La venta puede ser solo de servicios, solo de productos, o mixta
                (varios de cada tipo).
              </div>
            ) : (
              <div style={{ maxHeight: 296, overflowY: "auto", display: "grid", gap: 8 }}>
                {lines.map((l) => {
                  const remain = l.kind === "producto" && l.product_id
                    ? (products.find((p) => p.id === l.product_id)?.stock ?? 0) - ((inCartByProduct.get(l.product_id) ?? 0) - l.quantity)
                    : null;
                  const short = remain !== null && l.quantity > (remain ?? 0);
                  return (
                    <div key={l.key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, border: BORDER, borderRadius: 10, padding: "8px 10px", alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.description}{" "}
                          <span className={`vr-pill ${l.kind === "producto" ? "vr-pill-amber" : "vr-pill-green"}`} style={{ marginLeft: 4 }}>
                            {l.kind}
                          </span>
                        </div>
                        <div className="vr-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          importe {formatCOP(Math.round(l.quantity * l.unit_price))}
                          {remain !== null && (
                            <span style={{ marginLeft: 8, color: short ? "#ca435c" : undefined }}>hay {remain}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button type="button" className="vr-icon-btn" onClick={() => changeQty(l.key, -1)} aria-label="Quitar uno">
                          <Minus size={13} />
                        </button>
                        <input
                          type="number"
                          min={l.kind === "producto" ? "1" : "0.5"}
                          step={l.kind === "producto" ? "1" : "0.5"}
                          value={l.quantity}
                          onChange={(e) => setQty(l.key, Number(e.target.value))}
                          style={{ width: 62, textAlign: "center" }}
                          aria-label="Cantidad"
                        />
                        <button type="button" className="vr-icon-btn" onClick={() => changeQty(l.key, 1)} aria-label="Agregar uno">
                          <Plus size={13} />
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={l.unit_price}
                          onChange={(e) => updPrice(l.key, Number(e.target.value))}
                          style={{ width: 104 }}
                          title="Precio unitario (COP)"
                          aria-label="Precio unitario"
                        />
                        <button type="button" className="vr-icon-btn" onClick={() => delLine(l.key)} aria-label="Quitar ítem">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cobro */}
        <FormGrid>
          <Field label="Descuento global (COP)">
            <input type="number" min="0" value={fDiscount} onChange={(e) => setFDiscount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Medio de pago">
            <select value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m} style={{ textTransform: "capitalize" }}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Cobro">
            <select value={fCollect} onChange={(e) => setFCollect(e.target.value)}>
              <option value="ahora">Cobrar ahora (queda pagada)</option>
              <option value="abierta">Dejar por cobrar (abierta en Caja)</option>
            </select>
          </Field>
        </FormGrid>

        {fCollect === "ahora" && fMethod === "efectivo" && !openSession && (
          <div className="vr-alert vr-alert-warning" style={{ marginBottom: 12 }}>
            <span>No hay caja abierta: la venta quedará pagada, pero el efectivo no entrará a ningún arqueo. Ábrela en el módulo Caja.</span>
          </div>
        )}
        {fCollect === "ahora" && openSession && (
          <div className="vr-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            {fMethod === "efectivo"
              ? "El efectivo entrará al arqueo de la caja abierta (cash_movements · venta, con el detalle de los ítems)."
              : `El pago por ${fMethod} quedará registrado en pagos; no suma efectivo al arqueo.`}
          </div>
        )}

        <div className="vr-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {lines.length} ítem(s) · Subtotal {formatCOP(Math.round(subtotal))} · Descuento {formatCOP(Math.round(discount))} ·{" "}
          Total: <strong style={{ color: "#7556d8" }}>{formatCOP(total)}</strong>
        </div>

        {modalErr && <div className="vr-alert vr-alert-critical" style={{ marginBottom: 12 }}><span>{modalErr}</span></div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void submitSale()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />} Registrar venta ({lines.length} ítems)
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ————— Fila del historial con detalle expandible de los ítems ————— */
function SaleRow({
  sale, itemsCount, summary, open, onToggle, customer,
}: {
  sale: ServiceOrder;
  itemsCount: number;
  summary: string;
  open: boolean;
  onToggle: () => void;
  customer: string;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td>{formatDateTime(sale.created_at)}</td>
        <td>{customer}</td>
        <td>
          <span className="vr-muted" style={{ fontSize: 12 }}>
            <strong style={{ color: "inherit" }}>{itemsCount}</strong> ítem(s): {summary}
          </span>
        </td>
        <td style={{ textTransform: "capitalize" }}>{sale.payment_method ?? "por definir"}</td>
        <td>{sale.discount > 0 ? formatCOP(sale.discount) : "—"}</td>
        <td><strong>{formatCOP(sale.total)}</strong></td>
        <td><StatusPill status={sale.status} /></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: "rgba(117,86,216,.04)" }}>
            <ItemDetailRow items={sale.items ?? []} />
          </td>
        </tr>
      )}
    </>
  );
}

function ItemDetailRow({ items }: { items: ServiceOrderItem[] }) {
  if (items.length === 0) {
    return (
      <div className="vr-muted" style={{ fontSize: 12.5 }}>
        Sin ítems registrados en esta venta.
      </div>
    );
  }
  const sum = items.reduce((a, i) => a + Number(i.quantity) * Number(i.unit_price) - Number(i.discount ?? 0), 0);
  return (
    <div style={{ padding: "2px 4px 8px" }}>
      <table className="vr-table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ width: 96 }}>Tipo</th>
            <th>Ítem</th>
            <th style={{ width: 70 }}>Cant.</th>
            <th style={{ width: 120 }}>Precio</th>
            <th style={{ width: 120 }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <span className={`vr-pill ${i.product_id ? "vr-pill-amber" : "vr-pill-green"}`}>
                  {i.product_id ? "producto" : "servicio"}
                </span>
              </td>
              <td>{i.description}</td>
              <td>×{Number(i.quantity)}</td>
              <td>{formatCOP(Number(i.unit_price))}</td>
              <td>
                <strong>{formatCOP(Number(i.quantity) * Number(i.unit_price) - Number(i.discount ?? 0))}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vr-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {items.length} ítem(s) registrados en esta venta · suma de ítems {formatCOP(Math.round(sum))}
      </div>
    </div>
  );
}
