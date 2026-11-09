"use client";

/* VelloRa ERP — Módulo Ventas: venta directa (POS) + historial de facturación.
   Además de las ventas que llegan desde la agenda (citas completadas enviadas
   a caja), aquí se registran:
     · Servicios vendidos a clientes SIN cita (cliente existente, nuevo u ocasional).
     · Productos del negocio (descuenta inventario y deja inventory_movements).
     · Ventas mixtas (servicios + productos en la misma orden).
   Asociación con la caja: si hay una caja abierta (módulo Caja), el cobro en
   efectivo genera un cash_movements tipo 'sale' ligado al pago → entra al
   arqueo del día. Sin caja abierta, la venta igual queda registrada y se
   avisa. El registro usa la RPC vellora_create_sale (SQL v17); si aún no se
   aplicó, cae al registro paso a paso (queries.createSale). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShoppingBag, Trash2 } from "lucide-react";
import type {
  CashSession, Customer, Employee, OrganizationContext, Product, Service, ServiceOrder,
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

  /* ————— Modal nueva venta ————— */
  const [showNew, setShowNew] = useState(false);
  const [custSel, setCustSel] = useState("occasional"); // occasional | new | <customer_id>
  const [fNewName, setFNewName] = useState("");
  const [fEmployee, setFEmployee] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [pickSvc, setPickSvc] = useState("");
  const [pickPrd, setPickPrd] = useState("");
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

  /* Totales del formulario */
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unit_price, 0);
  const discount = Math.min(Math.max(Number(fDiscount) || 0, 0), subtotal);
  const total = Math.round(subtotal - discount);

  /* Stock disponible para cada línea de producto (resta las otras líneas del mismo producto) */
  const remaining = (line: SaleLine): number | null => {
    if (line.kind !== "producto" || !line.product_id) return null;
    const p = products.find((x) => x.id === line.product_id);
    if (!p) return 0;
    const others = lines
      .filter((x) => x.kind === "producto" && x.product_id === line.product_id && x.key !== line.key)
      .reduce((a, x) => a + x.quantity, 0);
    return p.stock - others;
  };
  const neededByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (l.kind === "producto" && l.product_id) m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.quantity);
    }
    return m;
  }, [lines]);

  /* ————— Formulario de venta ————— */
  function resetForm() {
    setCustSel("occasional");
    setFNewName("");
    setFEmployee("");
    setLines([]);
    setPickSvc("");
    setPickPrd("");
    setFDiscount("");
    setFMethod("efectivo");
    setFCollect("ahora");
    setModalErr("");
  }

  function addService(id: string) {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    setLines((ls) => [
      ...ls,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "servicio",
        service_id: svc.id,
        product_id: null,
        description: svc.name,
        quantity: 1,
        unit_price: svc.price,
      },
    ]);
  }

  function addProduct(id: string) {
    const prd = products.find((p) => p.id === id);
    if (!prd) return;
    setLines((ls) => [
      ...ls,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "producto",
        service_id: null,
        product_id: prd.id,
        description: prd.name,
        quantity: 1,
        unit_price: prd.sale_price,
      },
    ]);
  }

  function updLine(key: string, patch: Partial<SaleLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function delLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function submitSale() {
    if (lines.length === 0) {
      setModalErr("Agrega al menos un servicio del catálogo o un producto del inventario.");
      return;
    }
    if (custSel === "new" && !fNewName.trim()) {
      setModalErr("Escribe el nombre del cliente nuevo (o elige cliente ocasional).");
      return;
    }
    for (const [pid, qty] of neededByProduct) {
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
      let msg = `Venta de ${formatCOP(res.total)} registrada (${res.status === "paid" ? "pagada" : "por cobrar: se cobra en el módulo Caja"}).`;
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

  /* ————— Render ————— */
  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Comercial"
        title="Ventas"
        subtitle="Facturación de servicios con o sin agenda, productos del negocio y ventas mixtas; asociadas a la caja y con descuento de inventario."
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
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Método</th>
                  <th>Descuento</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 60).map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>{customerLabel(s)}</td>
                    <td style={{ textTransform: "capitalize" }}>{s.kind}</td>
                    <td style={{ textTransform: "capitalize" }}>{s.payment_method ?? "por definir"}</td>
                    <td>{s.discount > 0 ? formatCOP(s.discount) : "—"}</td>
                    <td><strong>{formatCOP(s.total)}</strong></td>
                    <td><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ————— Modal: nueva venta directa ————— */}
      <Modal open={showNew} title="Nueva venta (sin agenda)" onClose={() => setShowNew(false)} width={760}>
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

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "4px 0 10px" }}>
          <h2 style={{ margin: 0 }}>Ítems de la venta</h2>
          <span className="vr-muted" style={{ fontSize: 12 }}>
            Servicios sin agenda y/o productos; los productos descuentan inventario al registrar.
          </span>
        </div>
        <FormGrid>
          <Field label="Agregar servicio del catálogo">
            <select
              value={pickSvc}
              onChange={(e) => {
                if (e.target.value) addService(e.target.value);
                setPickSvc("");
              }}
            >
              <option value="">Selecciona un servicio…</option>
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {formatCOP(s.price)}</option>
              ))}
            </select>
          </Field>
          <Field label="Agregar producto del inventario">
            <select
              value={pickPrd}
              onChange={(e) => {
                if (e.target.value) addProduct(e.target.value);
                setPickPrd("");
              }}
            >
              <option value="">Selecciona un producto…</option>
              {products.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · hay {p.stock} · {formatCOP(p.sale_price)}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>

        {lines.length === 0 ? (
          <div className="vr-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            Aún no hay ítems: la venta puede ser solo de servicios, solo de productos, o mixta.
          </div>
        ) : (
          <div className="vr-table-wrap" style={{ marginBottom: 12 }}>
            <table className="vr-table">
              <thead>
                <tr>
                  <th>Ítem</th>
                  <th style={{ width: 96 }}>Cant.</th>
                  <th style={{ width: 140 }}>Precio (COP)</th>
                  <th style={{ width: 120 }}>Importe</th>
                  <th style={{ width: 42 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const remain = remaining(l);
                  const short = remain !== null && l.quantity > remain;
                  return (
                    <tr key={l.key}>
                      <td>
                        {l.description}{" "}
                        <span className={`vr-pill ${l.kind === "producto" ? "vr-pill-blue" : "vr-pill-green"}`} style={{ marginLeft: 6 }}>
                          {l.kind}
                        </span>
                        {remain !== null && (
                          <span className="vr-muted" style={{ fontSize: 11, marginLeft: 8, color: short ? "#ca435c" : undefined }}>
                            hay {remain}
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={l.quantity}
                          onChange={(e) => updLine(l.key, { quantity: Math.max(0.5, Number(e.target.value) || 0.5) })}
                          style={{ width: 76 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={l.unit_price}
                          onChange={(e) => updLine(l.key, { unit_price: Math.max(0, Number(e.target.value) || 0) })}
                          style={{ width: 120 }}
                        />
                      </td>
                      <td><strong>{formatCOP(Math.round(l.quantity * l.unit_price))}</strong></td>
                      <td>
                        <button type="button" className="vr-icon-btn" onClick={() => delLine(l.key)} aria-label="Quitar ítem">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
              ? "El efectivo entrará al arqueo de la caja abierta (cash_movements · venta)."
              : `El pago por ${fMethod} quedará registrado en pagos; no suma efectivo al arqueo.`}
          </div>
        )}

        <div className="vr-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Subtotal {formatCOP(Math.round(subtotal))} · Descuento {formatCOP(Math.round(discount))} ·{" "}
          Total: <strong style={{ color: "#7556d8" }}>{formatCOP(total)}</strong>
        </div>

        {modalErr && <div className="vr-alert vr-alert-critical" style={{ marginBottom: 12 }}><span>{modalErr}</span></div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          <button className="vr-btn" onClick={() => void submitSale()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />} Registrar venta
          </button>
        </div>
      </Modal>
    </div>
  );
}
