/* VelloRa ERP — Dataset demo determinista (modo demo sin credenciales de Supabase).
   Simula el esquema REAL de la base de datos (BD.sql): branches, service_orders,
   service_order_items, payments, payroll_runs/payroll_items, loyalty_accounts/
   loyalty_transactions, vellora_plans, suppliers/purchases, booking_settings, etc. */

import type {
  Appointment, AppUser, Branch, BookingSettings, Campaign, Customer, Employee,
  LoyaltyAccount, LoyaltyTransaction, Module, Organization, OrganizationSubscription,
  Payment, PayrollItem, PayrollRun, Plan, Product, Purchase, PurchaseItem, Role,
  RoleModulePermission, Service, ServiceOrder, ServiceOrderItem, Supplier,
} from "./types";
import { ROLE_PERMISSIONS } from "./permissions";

/* PRNG determinista */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20261101);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;

/* Fechas base en zona Colombia */
const NOW = new Date();
const DAY = 86_400_000;

function at(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + dayOffset, hour, minute, 0);
  return d.toISOString();
}

const iso = (d: Date) => d.toISOString();

/* ————— Núcleo ————— */
export const ORG_ID = "org-bella-esencia-0001";
export const DEMO_PASSWORD = "vellora2026";

const organization: Organization = {
  id: ORG_ID,
  name: "Bella Esencia Spa & Salón",
  legal_name: "Bella Esencia S.A.S.",
  tax_id: "901.234.567-8",
  phone: "+57 601 555 0100",
  email: "hola@bellaesencia.co",
  address: "Calle 93 # 13-19",
  city: "Bogotá",
  country: "CO",
  currency: "COP",
  timezone: "America/Bogota",
  active: true,
  created_at: at(-400, 9),
};

const branches: Branch[] = [
  { id: "branch-chapinero", organization_id: ORG_ID, name: "Sede Chapinero", address: "Calle 93 # 13-19, Chapinero", phone: "+57 601 555 0111", active: true, created_at: at(-400, 9) },
  { id: "branch-norte", organization_id: ORG_ID, name: "Sede Cedritos", address: "Av. 140 # 15-30, Cedritos", phone: "+57 601 555 0112", active: true, created_at: at(-300, 9) },
];

const users: AppUser[] = [
  { id: "user-admin", email: "admin@prueba.com", full_name: "Admin de Prueba", phone: "+57 310 555 0100" },
  { id: "user-valentina", email: "valentina@bellaesencia.co", full_name: "Valentina Ríos", phone: "+57 310 555 0101" },
  { id: "user-camila", email: "camila@bellaesencia.co", full_name: "Camila Andrada", phone: "+57 310 555 0102" },
  { id: "user-andres", email: "andres@bellaesencia.co", full_name: "Andrés Gómez", phone: "+57 310 555 0103" },
  { id: "user-laura", email: "laura@bellaesencia.co", full_name: "Laura Mendoza", phone: "+57 310 555 0104" },
];

/* Perfiles (organization_roles): role_key libre, lo consume la app */
const organization_roles: (Role & { role_key: string })[] = [
  { id: "role-owner", organization_id: ORG_ID, role_key: "owner", name: "Propietario", description: "Acceso total protegido", is_system: true, active: true, created_at: at(-400, 9) },
  { id: "role-admin", organization_id: ORG_ID, role_key: "administracion", name: "Administración", description: "Gestión completa del negocio", is_system: true, active: true, created_at: at(-400, 9) },
  { id: "role-cajero", organization_id: ORG_ID, role_key: "cajero", name: "Cajero", description: "Caja, cobros y ventas", is_system: true, active: true, created_at: at(-400, 9) },
  { id: "role-profesional", organization_id: ORG_ID, role_key: "profesional", name: "Profesional", description: "Su agenda y servicios", is_system: true, active: true, created_at: at(-400, 9) },
];

/* Membresías (organization_members): role usa el CHECK en inglés de la BD real */
const organization_members: {
  id: string; organization_id: string; user_id: string; role: string;
  branch_id: string | null; active: boolean; profile_id: string | null; created_at: string;
}[] = [
  { id: "mem-001", organization_id: ORG_ID, user_id: "user-valentina", role: "owner", branch_id: null, active: true, profile_id: "role-owner", created_at: at(-400, 9) },
  { id: "mem-002", organization_id: ORG_ID, user_id: "user-camila", role: "admin", branch_id: null, active: true, profile_id: "role-admin", created_at: at(-300, 9) },
  { id: "mem-003", organization_id: ORG_ID, user_id: "user-andres", role: "cashier", branch_id: "branch-chapinero", active: true, profile_id: "role-cajero", created_at: at(-250, 9) },
  { id: "mem-004", organization_id: ORG_ID, user_id: "user-laura", role: "professional", branch_id: "branch-chapinero", active: true, profile_id: "role-profesional", created_at: at(-200, 9) },
  { id: "mem-005", organization_id: ORG_ID, user_id: "user-admin", role: "admin", branch_id: null, active: true, profile_id: "role-admin", created_at: at(-100, 9) },
];

/* Módulos (vellora_modules real: module_key, name, description, active) */
const MODULE_DEFS: { key: string; name: string; description: string }[] = [
  { key: "dashboard", name: "Dashboard", description: "Indicadores y resumen del negocio" },
  { key: "agenda", name: "Agenda y reservas", description: "Citas, disponibilidad y reservas" },
  { key: "caja", name: "Caja", description: "Turnos, cobros y arqueo" },
  { key: "clientes", name: "Clientes", description: "Directorio e historial de clientes" },
  { key: "ventas", name: "Ventas", description: "Facturación de servicios y productos" },
  { key: "servicios", name: "Servicios", description: "Catálogo de servicios y tratamientos" },
  { key: "profesionales", name: "Profesionales", description: "Equipo, comisiones y horarios" },
  { key: "inventario", name: "Inventario", description: "Productos, stock y alertas" },
  { key: "compras", name: "Compras", description: "Órdenes a proveedores" },
  { key: "nomina", name: "Nómina", description: "Salarios, comisiones y pagos" },
  { key: "fidelizacion", name: "Fidelización", description: "Puntos y recompensas" },
  { key: "marketing", name: "Marketing", description: "Campañas y comunicaciones" },
  { key: "reportes", name: "Reportes", description: "Analítica avanzada y exportes" },
  { key: "reservas_online", name: "Reservas online", description: "Solicitudes de la agenda pública" },
  { key: "configuracion", name: "Configuración", description: "Organización, usuarios, perfiles y planes" },
];

const vellora_modules: Module[] = MODULE_DEFS.map((m, i) => ({
  id: `mod-${String(i + 1).padStart(2, "0")}-${m.key}`,
  module_key: m.key,
  name: m.name,
  description: m.description,
  active: true,
  created_at: at(-400, 9),
}));

/* Matriz de permisos desde ROLE_PERMISSIONS (misma definición que el SQL).
   ROLE_PERMISSIONS ya está expandido: { moduleKey: { can_view, can_create, ... } } */
const role_module_permissions: RoleModulePermission[] = [];
for (const role of organization_roles) {
  const spec = ROLE_PERMISSIONS[role.role_key as keyof typeof ROLE_PERMISSIONS];
  if (!spec) continue;
  for (const mod of vellora_modules) {
    const entry = spec[mod.module_key] as unknown as Partial<Record<string, boolean>> | undefined;
    role_module_permissions.push({
      role_id: role.id,
      module_id: mod.id,
      can_view: Boolean(entry?.can_view),
      can_create: Boolean(entry?.can_create),
      can_update: Boolean(entry?.can_update),
      can_delete: Boolean(entry?.can_delete),
    });
  }
}

/* Planes (vellora_plans real: sin columnas de límites) */
const vellora_plans: Plan[] = [
  { id: "plan-esencial", plan_key: "esencial", name: "Esencial", description: "Para salones que inician: 1 sede y equipo pequeño.", price_monthly: 89000, active: true, created_at: at(-400, 9) },
  { id: "plan-profesional", plan_key: "profesional", name: "Profesional", description: "Salones en crecimiento: hasta 3 sedes y 15 profesionales.", price_monthly: 189000, active: true, created_at: at(-400, 9) },
  { id: "plan-elite", plan_key: "elite", name: "Elite", description: "Cadenas y franquicias: límites ilimitados y soporte prioritario.", price_monthly: 349000, active: true, created_at: at(-400, 9) },
];

const organization_subscriptions: OrganizationSubscription[] = [
  {
    id: "sub-001",
    organization_id: ORG_ID,
    plan_id: "plan-profesional",
    status: "active",
    starts_at: at(-20, 9),
    ends_at: at(10, 9),
    created_at: at(-20, 9),
  },
];

/* ————— Catálogo ————— */
const services: Service[] = [
  { id: "svc-001", organization_id: ORG_ID, name: "Corte y styling", description: "Corte personalizado con lavado y peinado", price: 45000, duration_minutes: 60, commission_percent: 35, active: true, category: "Cabello", created_at: at(-380, 9) },
  { id: "svc-002", organization_id: ORG_ID, name: "Balayage completo", description: "Iluminación a mano alza con matiz", price: 180000, duration_minutes: 180, commission_percent: 40, active: true, category: "Cabello", created_at: at(-380, 9) },
  { id: "svc-003", organization_id: ORG_ID, name: "Tinte raíz", description: "Retoque de raíz con color premium", price: 95000, duration_minutes: 120, commission_percent: 38, active: true, category: "Cabello", created_at: at(-380, 9) },
  { id: "svc-004", organization_id: ORG_ID, name: "Manicura spa", description: "Cuidado de cutícula, esmaltado semipermanente", price: 38000, duration_minutes: 75, commission_percent: 35, active: true, category: "Uñas", created_at: at(-380, 9) },
  { id: "svc-005", organization_id: ORG_ID, name: "Pedicura premium", description: "Exfoliación, mascarilla y esmaltado", price: 46000, duration_minutes: 75, commission_percent: 35, active: true, category: "Uñas", created_at: at(-380, 9) },
  { id: "svc-006", organization_id: ORG_ID, name: "Masaje relajante 60'", description: "Masaje corporal con aromaterapia", price: 120000, duration_minutes: 60, commission_percent: 42, active: true, category: "Spa", created_at: at(-380, 9) },
  { id: "svc-007", organization_id: ORG_ID, name: "Facial profundo", description: "Limpieza profunda con hidratación", price: 98000, duration_minutes: 90, commission_percent: 40, active: true, category: "Rostro", created_at: at(-380, 9) },
  { id: "svc-008", organization_id: ORG_ID, name: "Keratina", description: "Alisado y brillo con queratina", price: 220000, duration_minutes: 180, commission_percent: 40, active: true, category: "Cabello", created_at: at(-370, 9) },
  { id: "svc-009", organization_id: ORG_ID, name: "Peinado evento", description: "Ondas, recogidos y trenzas para eventos", price: 70000, duration_minutes: 75, commission_percent: 38, active: true, category: "Cabello", created_at: at(-370, 9) },
  { id: "svc-010", organization_id: ORG_ID, name: "Depilación cejas", description: "Diseño y perfilado con pinza", price: 22000, duration_minutes: 30, commission_percent: 30, active: true, category: "Rostro", created_at: at(-370, 9) },
];

const employees: Employee[] = [
  { id: "emp-laura", organization_id: ORG_ID, branch_id: "branch-chapinero", full_name: "Laura Mendoza", position: "Estilista sénior", specialties: "Color y balayage", email: "laura@bellaesencia.co", phone: "+57 310 555 0104", commission_percent: 40, salary: 1600000, active: true, created_at: at(-380, 9) },
  { id: "emp-sofia", organization_id: ORG_ID, branch_id: "branch-chapinero", full_name: "Sofía Torres", position: "Estilista", specialties: "Cortes y peinados", email: "sofia@bellaesencia.co", phone: "+57 310 555 0201", commission_percent: 35, salary: 1400000, active: true, created_at: at(-360, 9) },
  { id: "emp-daniela", organization_id: ORG_ID, branch_id: "branch-chapinero", full_name: "Daniela Ruiz", position: "Manicurista", specialties: "Nail art", email: "daniela@bellaesencia.co", phone: "+57 310 555 0202", commission_percent: 35, salary: 1300000, active: true, created_at: at(-350, 9) },
  { id: "emp-carolina", organization_id: ORG_ID, branch_id: "branch-norte", full_name: "Carolina Peña", position: "Terapeuta spa", specialties: "Masajes y aromaterapia", email: "carolina@bellaesencia.co", phone: "+57 310 555 0203", commission_percent: 38, salary: 1500000, active: true, created_at: at(-340, 9) },
  { id: "emp-sebastian", organization_id: ORG_ID, branch_id: "branch-norte", full_name: "Sebastián Cruz", position: "Barbero", specialties: "Barba y afeitado clásico", email: "sebastian@bellaesencia.co", phone: "+57 310 555 0204", commission_percent: 35, salary: 1400000, active: true, created_at: at(-330, 9) },
  { id: "emp-juliana", organization_id: ORG_ID, branch_id: "branch-norte", full_name: "Juliana Vargas", position: "Cosmetóloga", specialties: "Faciales y dermopigmentación", email: "juliana@bellaesencia.co", phone: "+57 310 555 0205", commission_percent: 40, salary: 1650000, active: true, created_at: at(-320, 9) },
];

/* ————— Clientes ————— */
const NOMBRES = ["Mariana", "Carolina", "Valeria", "Isabella", "Samantha", "Natalia", "Daniela", "Gabriela", "Paula", "Andrea", "Camila", "Juliana", "Manuela", "Sara", "Lucía", "Elena", "Claudia", "Diana", "Marcela", "Patricia", "Ricardo", "Julián", "Andrés", "Felipe", "Diego", "Cristian", "Óscar", "Mauricio"];
const APELLIDOS = ["Gómez", "Rodríguez", "Martínez", "López", "García", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", " Castro", "Molina", "Ortiz", "Silva"];
const FUENTES = ["Instagram", "Referido", "Google", "Caminando", "Facebook"];
const TIPOS_CABELLO = ["Liso", "Ondulado", "Rizado", "Afro"];

const customers: Customer[] = [];
for (let i = 0; i < 30; i++) {
  const nombre = `${NOMBRES[i % NOMBRES.length]} ${APELLIDOS[i % APELLIDOS.length].trim()}`;
  const birthMonth = between(0, 11);
  const birthDay = between(1, 28);
  const year = between(1975, 2004);
  /* 4 cumpleaños caen dentro de los próximos 30 días */
  const forceSoon = i < 4;
  const bd = forceSoon
    ? new Date(1990 + i, NOW.getMonth(), NOW.getDate() + 3 + i * 5)
    : new Date(year, birthMonth, birthDay);
  customers.push({
    id: `cus-${String(i + 1).padStart(3, "0")}`,
    organization_id: ORG_ID,
    full_name: nombre,
    document_number: `CC ${10_200_000 + i * 3717}`,
    phone: `+57 320 ${String(2000000 + i * 13571).slice(0, 7)}`,
    whatsapp: `+57 320 ${String(2000000 + i * 13571).slice(0, 7)}`,
    email: i % 3 === 0 ? `cliente${i + 1}@correo.com` : null,
    birth_date: `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, "0")}-${String(bd.getDate()).padStart(2, "0")}`,
    address: i % 4 === 0 ? `Cra ${between(5, 120)} # ${between(20, 140)}-${between(10, 90)}, Bogotá` : null,
    instagram: i % 2 === 0 ? `@${nombre.split(" ")[0].toLowerCase()}.${nombre.split(" ")[1].toLowerCase()}` : null,
    acquisition_source: pick(FUENTES),
    notes: i % 5 === 0 ? "Prefiere cita en la mañana." : null,
    hair_type: pick(TIPOS_CABELLO),
    allergies: i % 8 === 0 ? "Sensible al amoníaco" : null,
    active: true,
    created_at: at(-between(5, 350), between(9, 18)),
  });
}

/* ————— Productos, proveedores y compras ————— */
const products: Product[] = [
  { id: "prd-001", organization_id: ORG_ID, sku: "VEL-001", name: "Shampoo hidratante 400ml", category: "Cabello", brand: "Keraplus", cost: 22000, sale_price: 42000, stock: 18, minimum_stock: 8, active: true, created_at: at(-300, 9) },
  { id: "prd-002", organization_id: ORG_ID, sku: "VEL-002", name: "Acondicionador nutritivo 400ml", category: "Cabello", brand: "Keraplus", cost: 24000, sale_price: 45000, stock: 12, minimum_stock: 8, active: true, created_at: at(-300, 9) },
  { id: "prd-003", organization_id: ORG_ID, sku: "VEL-003", name: "Aceite de argán 60ml", category: "Cabello", brand: "L'Essence", cost: 31000, sale_price: 62000, stock: 4, minimum_stock: 6, active: true, created_at: at(-300, 9) },
  { id: "prd-004", organization_id: ORG_ID, sku: "VEL-004", name: "Esmalte semipermanente rosa", category: "Uñas", brand: "NailPro", cost: 15000, sale_price: 32000, stock: 22, minimum_stock: 10, active: true, created_at: at(-300, 9) },
  { id: "prd-005", organization_id: ORG_ID, sku: "VEL-005", name: "Base coat 15ml", category: "Uñas", brand: "NailPro", cost: 12000, sale_price: 26000, stock: 9, minimum_stock: 10, active: true, created_at: at(-300, 9) },
  { id: "prd-006", organization_id: ORG_ID, sku: "VEL-006", name: "Crema facial hidratante", category: "Rostro", brand: "DermaSoft", cost: 34000, sale_price: 68000, stock: 7, minimum_stock: 5, active: true, created_at: at(-290, 9) },
  { id: "prd-007", organization_id: ORG_ID, sku: "VEL-007", name: "Protector solar FPS50", category: "Rostro", brand: "DermaSoft", cost: 28000, sale_price: 55000, stock: 0, minimum_stock: 5, active: true, created_at: at(-290, 9) },
  { id: "prd-008", organization_id: ORG_ID, sku: "VEL-008", name: "Aceite corporal spa 200ml", category: "Spa", brand: "Zen Aroma", cost: 26000, sale_price: 52000, stock: 11, minimum_stock: 6, active: true, created_at: at(-280, 9) },
  { id: "prd-009", organization_id: ORG_ID, sku: "VEL-009", name: "Cera estilizante mate", category: "Cabello", brand: "Keraplus", cost: 18000, sale_price: 38000, stock: 14, minimum_stock: 6, active: true, created_at: at(-280, 9) },
  { id: "prd-010", organization_id: ORG_ID, sku: "VEL-010", name: "Kit ampollas keratina x4", category: "Cabello", brand: "Keraplus", cost: 48000, sale_price: 92000, stock: 3, minimum_stock: 4, active: true, created_at: at(-270, 9) },
];

const suppliers: Supplier[] = [
  { id: "sup-001", organization_id: ORG_ID, name: "Cosméticos Andinos S.A.", tax_id: "830.112.345-1", contact_name: "Marcela Díaz", phone: "+57 601 340 2210", email: "ventas@cosmeticosandinos.co", active: true, created_at: at(-380, 9) },
  { id: "sup-002", organization_id: ORG_ID, name: "Distribuidora NailPro", tax_id: "900.456.789-3", contact_name: "Jorge Peña", phone: "+57 601 220 8833", email: "pedidos@nailpro.co", active: true, created_at: at(-370, 9) },
  { id: "sup-003", organization_id: ORG_ID, name: "Zen Aroma Naturales", tax_id: "901.789.123-5", contact_name: "Luisa Fernández", phone: "+57 601 611 4520", email: "hola@zenaroma.co", active: true, created_at: at(-360, 9) },
];

const purchases: Purchase[] = [
  { id: "pch-001", organization_id: ORG_ID, supplier_id: "sup-001", purchase_number: "OC-2026-041", status: "received", purchase_date: at(-20, 0).slice(0, 10), total: 528000, subtotal: 528000, received_at: at(-18, 10), created_at: at(-20, 10), updated_at: at(-18, 10) },
  { id: "pch-002", organization_id: ORG_ID, supplier_id: "sup-002", purchase_number: "OC-2026-042", status: "received", purchase_date: at(-9, 0).slice(0, 10), total: 315000, subtotal: 315000, received_at: at(-7, 15), created_at: at(-9, 15), updated_at: at(-7, 15) },
  { id: "pch-003", organization_id: ORG_ID, supplier_id: "sup-001", purchase_number: "OC-2026-043", status: "draft", purchase_date: NOW.toISOString().slice(0, 10), total: 240000, subtotal: 240000, created_at: at(0, 9), updated_at: at(0, 9) },
];

const purchase_items: PurchaseItem[] = [
  { id: "pci-001", purchase_id: "pch-001", product_id: "prd-001", quantity: 12, unit_cost: 22000, created_at: at(-20, 10) },
  { id: "pci-002", purchase_id: "pch-001", product_id: "prd-002", quantity: 10, unit_cost: 24000, created_at: at(-20, 10) },
  { id: "pci-003", purchase_id: "pch-002", product_id: "prd-004", quantity: 15, unit_cost: 15000, created_at: at(-9, 15) },
  { id: "pci-004", purchase_id: "pch-002", product_id: "prd-005", quantity: 7, unit_cost: 12000, created_at: at(-9, 15) },
  { id: "pci-005", purchase_id: "pch-003", product_id: "prd-003", quantity: 8, unit_cost: 31000, created_at: at(0, 9) },
];

/* ————— Citas ————— */
const SOURCE_LIST: Appointment["source"][] = ["internal", "internal", "internal", "phone", "walk_in"];
const bookingCode = () => `VR-${Math.floor(rnd() * 9000 + 1000)}`;

const appointments: Appointment[] = [];
const service_orders: ServiceOrder[] = [];
const service_order_items: ServiceOrderItem[] = [];
const payments: Payment[] = [];

let orderSeq = 1;
let paySeq = 1;
let itemSeq = 1;

function orderFromAppointment(appt: Appointment, status: ServiceOrder["status"], createdAt: string) {
  const svc = services.find((s) => s.id === appt.service_id);
  const discount = rnd() < 0.12 ? Math.round((svc?.price ?? appt.price) * 0.1) : 0;
  const subtotal = svc?.price ?? appt.price;
  const total = Math.max(0, subtotal - discount);
  const orderId = `ord-${String(orderSeq++).padStart(4, "0")}`;
  service_orders.push({
    id: orderId,
    organization_id: ORG_ID,
    branch_id: appt.branch_id ?? null,
    customer_id: appt.customer_id ?? null,
    employee_id: appt.employee_id ?? null,
    appointment_id: appt.id,
    status,
    subtotal,
    discount,
    tax: 0,
    total,
    created_at: createdAt,
    payment_method: null,
    kind: "servicio",
  });
  service_order_items.push({
    id: `soi-${String(itemSeq++).padStart(4, "0")}`,
    order_id: orderId,
    service_id: appt.service_id ?? null,
    product_id: null,
    description: svc?.name ?? "Servicio",
    quantity: 1,
    unit_price: subtotal,
    discount,
    commission_percent: svc?.commission_percent ?? 35,
  });
  if (status === "paid") {
    const method = pick(["efectivo", "tarjeta", "tarjeta", "transferencia", "nequi"]);
    payments.push({
      id: `pay-${String(paySeq++).padStart(4, "0")}`,
      organization_id: ORG_ID,
      order_id: orderId,
      method,
      amount: total,
      paid_at: createdAt,
      reference: method === "tarjeta" ? `************${between(1000, 9999)}` : null,
    });
    const so = service_orders[service_orders.length - 1];
    so.payment_method = method;
  }
}

/* Historial: 90 días hacia atrás (lunes menos ocupado), hoy y 12 días hacia adelante */
for (let d = -90; d <= 12; d++) {
  const weekday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + d).getDay();
  const base = weekday === 0 ? 0 : weekday === 1 ? between(2, 4) : between(4, 7);
  const count = d === 0 ? 6 : base;

  for (let k = 0; k < count; k++) {
    const svc = pick(services);
    const emp = pick(employees);
    const cus = pick(customers);
    const hour = pick([9, 10, 11, 12, 14, 15, 16, 17, 18]);
    const starts = at(d, hour, pick([0, 30]));
    const ends = new Date(new Date(starts).getTime() + svc.duration_minutes * 60_000).toISOString();

    let status: Appointment["status"];
    let orderStatus: ServiceOrder["status"] | null = null;
    if (d < 0) {
      const r = rnd();
      status = r < 0.82 ? "completed" : r < 0.92 ? "cancelled" : r < 0.97 ? "no_show" : "completed";
      orderStatus = status === "completed" ? "paid" : null;
    } else if (d === 0) {
      /* Hoy: mezcla realista por horas */
      if (hour <= 12) {
        status = rnd() < 0.55 ? "completed" : "in_service";
        orderStatus = status === "completed" ? (rnd() < 0.8 ? "paid" : "open") : null;
      } else {
        status = rnd() < 0.5 ? "confirmed" : "reserved";
      }
    } else {
      const r = rnd();
      status = r < 0.45 ? "confirmed" : r < 0.85 ? "scheduled" : "reserved";
    }

    const isOnline = rnd() < 0.08;
    const appt: Appointment = {
      id: `apt-${d < 0 ? "p" : d === 0 ? "t" : "f"}${String(appointments.length + 1).padStart(4, "0")}`,
      organization_id: ORG_ID,
      branch_id: emp.branch_id ?? "branch-chapinero",
      customer_id: cus.id,
      employee_id: emp.id,
      service_id: svc.id,
      starts_at: starts,
      ends_at: ends,
      status,
      price: svc.price,
      notes: null,
      created_at: starts,
      source: isOnline ? "online" : pick(SOURCE_LIST),
      booking_code: isOnline ? bookingCode() : null,
    };
    appointments.push(appt);
    if (orderStatus) orderFromAppointment(appt, orderStatus, ends);
  }
}

/* Citas online nuevas pendientes (para Reservas online) */
for (let i = 0; i < 3; i++) {
  const svc = pick(services);
  const emp = pick(employees);
  const cus = pick(customers);
  const starts = at(between(1, 5), pick([10, 11, 15, 16]));
  appointments.push({
    id: `apt-web-${i + 1}`,
    organization_id: ORG_ID,
    branch_id: emp.branch_id ?? "branch-chapinero",
    customer_id: cus.id,
    employee_id: emp.id,
    service_id: svc.id,
    starts_at: starts,
    ends_at: new Date(new Date(starts).getTime() + svc.duration_minutes * 60_000).toISOString(),
    status: i === 0 ? "reserved" : i === 1 ? "reserved" : "scheduled",
    price: svc.price,
    notes: "Solicitud desde la página pública",
    created_at: at(0, 8 + i),
    source: "online",
    booking_code: bookingCode(),
  });
}

/* Ventas de producto puro (sin cita) en los últimos 30 días */
for (let i = 0; i < 26; i++) {
  const d = -between(0, 29);
  const prd = pick(products);
  const qty = between(1, 2);
  const subtotal = prd.sale_price * qty;
  const discount = rnd() < 0.15 ? Math.round(subtotal * 0.05) : 0;
  const total = Math.max(0, subtotal - discount);
  const method = pick(["efectivo", "tarjeta", "transferencia", "nequi"]);
  const orderId = `ord-${String(orderSeq++).padStart(4, "0")}`;
  const createdAt = at(d, between(10, 19), between(0, 59));
  const paid = d < 0 || rnd() < 0.7;
  service_orders.push({
    id: orderId,
    organization_id: ORG_ID,
    branch_id: pick(branches).id,
    customer_id: rnd() < 0.6 ? pick(customers).id : null,
    employee_id: null,
    appointment_id: null,
    status: paid ? "paid" : "open",
    subtotal,
    discount,
    tax: 0,
    total,
    created_at: createdAt,
    payment_method: paid ? method : null,
    kind: "producto",
  });
  service_order_items.push({
    id: `soi-${String(itemSeq++).padStart(4, "0")}`,
    order_id: orderId,
    service_id: null,
    product_id: prd.id,
    description: prd.name,
    quantity: qty,
    unit_price: prd.sale_price,
    discount,
    commission_percent: 0,
  });
  if (paid) {
    payments.push({
      id: `pay-${String(paySeq++).padStart(4, "0")}`,
      organization_id: ORG_ID,
      order_id: orderId,
      method,
      amount: total,
      paid_at: createdAt,
      reference: null,
    });
  }
}

/* Recalcular kind de cada orden según sus items */
for (const o of service_orders) {
  const its = service_order_items.filter((i) => i.order_id === o.id);
  const hasSvc = its.some((i) => i.service_id);
  const hasPrd = its.some((i) => i.product_id);
  o.kind = hasSvc && hasPrd ? "mixto" : hasPrd ? "producto" : "servicio";
  if (o.payment_method === null) {
    const pays = payments.filter((p) => p.order_id === o.id);
    o.payment_method = pays.length ? pays[pays.length - 1].method : null;
  }
}

/* ————— Nómina: payroll_runs + payroll_items ————— */
function monthLabel(offset: number): { label: string; start: Date; end: Date } {
  const s = new Date(NOW.getFullYear(), NOW.getMonth() + offset, 1);
  const e = new Date(NOW.getFullYear(), NOW.getMonth() + offset + 1, 0);
  return { label: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}`, start: s, end: e };
}

const payroll_runs: PayrollRun[] = [];
const payroll_items: PayrollItem[] = [];
let piSeq = 1;
[-2, -1, 0].forEach((off, idx) => {
  const m = monthLabel(off);
  const runId = `prn-${idx + 1}`;
  payroll_runs.push({
    id: runId,
    organization_id: ORG_ID,
    period_start: iso(m.start).slice(0, 10),
    period_end: iso(m.end).slice(0, 10),
    status: off === 0 ? "draft" : "paid",
    created_at: iso(m.end),
    updated_at: off === 0 ? iso(NOW) : iso(m.end),
  });
  for (const emp of employees) {
    const base = emp.salary ?? 1400000;
    const commission = between(420, 980) * 1000;
    const bonus = off === 0 ? 0 : between(0, 2) * 50000;
    const deductions = Math.round(base * 0.08);
    payroll_items.push({
      id: `pri-${String(piSeq++).padStart(3, "0")}`,
      run_id: runId,
      employee_id: emp.id,
      base_salary: base,
      commission,
      bonus,
      deductions,
      total: base + commission + bonus - deductions,
      paid: off !== 0,
      paid_at: off !== 0 ? iso(m.end) : null,
      created_at: iso(m.end),
    });
  }
});

/* ————— Fidelización ————— */
const loyalty_accounts: LoyaltyAccount[] = customers.slice(0, 16).map((c, i) => ({
  id: `loy-${String(i + 1).padStart(3, "0")}`,
  organization_id: ORG_ID,
  customer_id: c.id,
  points: between(0, 9) * 100 + 150,
  tier: i < 3 ? "gold" : i < 8 ? "silver" : "bronze",
  customer_name: c.full_name,
  customer_phone: c.phone,
}));

const loyalty_transactions: LoyaltyTransaction[] = [];
for (let i = 0; i < 22; i++) {
  const acc = pick(loyalty_accounts);
  const earn = rnd() < 0.7;
  loyalty_transactions.push({
    id: `lot-${String(i + 1).padStart(3, "0")}`,
    organization_id: ORG_ID,
    customer_id: acc.customer_id,
    payment_id: null,
    points_delta: earn ? between(2, 9) * 10 : -between(1, 5) * 100,
    reason: earn ? "Acumulación por servicio completado" : "Canje de recompensa",
    created_at: at(-between(0, 40), between(9, 19)),
  });
}

/* ————— Marketing ————— */
const marketing_campaigns: Campaign[] = [
  { id: "cmp-001", organization_id: ORG_ID, name: "Promo balayage de temporada", description: "20% dcto en balayage entre semana", channel: "Instagram", objective: "Ocupar agenda de martes a jueves", content: "Post + stories con antes/después", status: "active", budget: 300000, starts_on: at(-12, 0).slice(0, 10), ends_on: at(18, 0).slice(0, 10), created_at: at(-14, 9) },
  { id: "cmp-002", organization_id: ORG_ID, name: "Cumpleaños felices", description: "Mensaje automático con 20% dcto", channel: "WhatsApp", objective: "Reactivar clientes en su mes", content: "Plantilla de WhatsApp Business", status: "active", budget: 80000, starts_on: at(-40, 0).slice(0, 10), ends_on: null, created_at: at(-45, 9) },
  { id: "cmp-003", organization_id: ORG_ID, name: "Reactivar clientas 6 meses", description: "Cupón de 15% para quien no visita hace 6 meses", channel: "WhatsApp", objective: "Reactivación", content: "Segmento manual + cupón", status: "draft", budget: 120000, starts_on: null, ends_on: null, created_at: at(-6, 9) },
  { id: "cmp-004", organization_id: ORG_ID, name: "Día de la madre", description: "Paquete spa + manicura", channel: "Instagram", objective: "Ventas de paquete", content: "Campaña pagada + post orgánico", status: "completed", budget: 450000, starts_on: at(-70, 0).slice(0, 10), ends_on: at(-45, 0).slice(0, 10), created_at: at(-75, 9) },
];

/* ————— Reservas online: configuración ————— */
const booking_settings: BookingSettings[] = [
  {
    id: "bks-001",
    organization_id: ORG_ID,
    slug: "bella-esencia",
    public_name: "Bella Esencia Spa & Salón",
    description: "Agenda tu cita de cabello, uñas o spa en línea",
    contact_phone: "+57 601 555 0100",
    enabled: true,
    notice_hours: 2,
    horizon_days: 30,
    created_at: at(-200, 9),
    updated_at: at(-30, 9),
  },
];

/* ————— DB demo ————— */
export type DemoDb = {
  users: AppUser[];
  organizations: Organization[];
  branches: Branch[];
  organization_roles: Role[];
  organization_members: typeof organization_members;
  vellora_modules: Module[];
  role_module_permissions: RoleModulePermission[];
  vellora_plans: Plan[];
  organization_subscriptions: OrganizationSubscription[];
  services: Service[];
  employees: Employee[];
  customers: Customer[];
  products: Product[];
  suppliers: Supplier[];
  purchases: Purchase[];
  purchase_items: PurchaseItem[];
  appointments: Appointment[];
  service_orders: ServiceOrder[];
  service_order_items: ServiceOrderItem[];
  payments: Payment[];
  payroll_runs: PayrollRun[];
  payroll_items: PayrollItem[];
  loyalty_accounts: LoyaltyAccount[];
  loyalty_transactions: LoyaltyTransaction[];
  marketing_campaigns: Campaign[];
  booking_settings: BookingSettings[];
};

export function buildDemoDb(): DemoDb {
  return {
    users: users.map((u) => ({ ...u })),
    organizations: [{ ...organization }],
    branches: branches.map((b) => ({ ...b })),
    organization_roles: organization_roles.map((r) => ({ ...r })),
    organization_members: organization_members.map((m) => ({ ...m })),
    vellora_modules: vellora_modules.map((m) => ({ ...m })),
    role_module_permissions: role_module_permissions.map((p) => ({ ...p })),
    vellora_plans: vellora_plans.map((p) => ({ ...p })),
    organization_subscriptions: organization_subscriptions.map((s) => ({ ...s })),
    services: services.map((s) => ({ ...s })),
    employees: employees.map((e) => ({ ...e })),
    customers: customers.map((c) => ({ ...c })),
    products: products.map((p) => ({ ...p })),
    suppliers: suppliers.map((s) => ({ ...s })),
    purchases: purchases.map((p) => ({ ...p })),
    purchase_items: purchase_items.map((i) => ({ ...i })),
    appointments: appointments.map((a) => ({ ...a })),
    service_orders: service_orders.map((o) => ({ ...o })),
    service_order_items: service_order_items.map((i) => ({ ...i })),
    payments: payments.map((p) => ({ ...p })),
    payroll_runs: payroll_runs.map((r) => ({ ...r })),
    payroll_items: payroll_items.map((i) => ({ ...i })),
    loyalty_accounts: loyalty_accounts.map((a) => ({ ...a })),
    loyalty_transactions: loyalty_transactions.map((t) => ({ ...t })),
    marketing_campaigns: marketing_campaigns.map((c) => ({ ...c })),
    booking_settings: booking_settings.map((b) => ({ ...b })),
  };
}
