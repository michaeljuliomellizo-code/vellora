/* VelloRa ERP — Definición de perfiles, permisos y restricciones de planes */

import type { ModuleKey, PermissionAction, RoleKey } from "./types";

export const MODULE_LIST: {
  key: ModuleKey;
  name: string;
  description: string;
  category: "Operación" | "Comercial" | "Gestión" | "Administración";
  route: string;
  sort: number;
}[] = [
  { key: "dashboard", name: "Dashboard", description: "Indicadores y resumen del negocio", category: "Operación", route: "dashboard", sort: 1 },
  { key: "agenda", name: "Agenda y reservas", description: "Citas, disponibilidad y reservas", category: "Operación", route: "agenda", sort: 2 },
  { key: "caja", name: "Caja", description: "Turnos, cobros y arqueo", category: "Operación", route: "caja", sort: 3 },
  { key: "clientes", name: "Clientes", description: "Directorio e historial de clientes", category: "Comercial", route: "clientes", sort: 4 },
  { key: "ventas", name: "Ventas", description: "Facturación de servicios y productos", category: "Comercial", route: "ventas", sort: 5 },
  { key: "servicios", name: "Servicios", description: "Catálogo de servicios y tratamientos", category: "Comercial", route: "servicios", sort: 6 },
  { key: "profesionales", name: "Profesionales", description: "Equipo, comisiones y horarios", category: "Gestión", route: "profesionales", sort: 7 },
  { key: "inventario", name: "Inventario", description: "Productos, stock y alertas", category: "Gestión", route: "inventario", sort: 8 },
  { key: "proveedores", name: "Proveedores", description: "Directorio de proveedores y datos de contacto", category: "Gestión", route: "proveedores", sort: 9 },
  { key: "compras", name: "Compras", description: "Órdenes a proveedores", category: "Gestión", route: "compras", sort: 10 },
  { key: "consumo", name: "Consumo interno", description: "Descuento de inventario por uso interno", category: "Gestión", route: "consumo", sort: 10 },
  { key: "nomina", name: "Nómina", description: "Salarios, comisiones y pagos", category: "Gestión", route: "nomina", sort: 11 },
  { key: "fidelizacion", name: "Fidelización", description: "Puntos, recompensas y recompensas canjeadas", category: "Comercial", route: "fidelizacion", sort: 12 },
  { key: "marketing", name: "Marketing", description: "Campañas y comunicaciones", category: "Comercial", route: "marketing", sort: 13 },
  { key: "reportes", name: "Reportes", description: "Analítica avanzada y exportes", category: "Gestión", route: "reportes", sort: 14 },
  { key: "reservas_online", name: "Reservas online", description: "Solicitudes de la agenda pública", category: "Operación", route: "reservas-online", sort: 15 },
  { key: "configuracion", name: "Configuración", description: "Organización, usuarios, perfiles y planes", category: "Administración", route: "configuracion", sort: 16 },
];

export const ALL_ACTIONS: PermissionAction[] = ["can_view", "can_create", "can_update", "can_delete"];

function perms(spec: Partial<Record<ModuleKey, PermissionAction[] | "all">>): Record<string, Record<PermissionAction, boolean>> {
  const out: Record<string, Record<PermissionAction, boolean>> = {};
  for (const m of MODULE_LIST) {
    const specEntry = spec[m.key];
    const row: Record<PermissionAction, boolean> = { can_view: false, can_create: false, can_update: false, can_delete: false };
    if (specEntry === "all") {
      row.can_view = row.can_create = row.can_update = row.can_delete = true;
    } else if (Array.isArray(specEntry)) {
      for (const a of specEntry) row[a] = true;
    }
    out[m.key] = row;
  }
  return out;
}

/** Matriz de permisos predefinida — espejo del SQL (role_module_permissions). */
export const ROLE_PERMISSIONS: Record<RoleKey, Record<string, Record<PermissionAction, boolean>>> = {
  owner: perms({
    dashboard: "all", agenda: "all", caja: "all", clientes: "all", ventas: "all",
    servicios: "all", profesionales: "all", inventario: "all", proveedores: "all", compras: "all",
    consumo: "all", nomina: "all", fidelizacion: "all", marketing: "all", reportes: "all",
    reservas_online: "all", configuracion: "all",
  }),
  administracion: perms({
    dashboard: "all", agenda: "all", caja: "all", clientes: "all", ventas: "all",
    servicios: "all", profesionales: "all", inventario: "all", proveedores: "all", compras: "all",
    consumo: "all", nomina: "all", fidelizacion: "all", marketing: "all", reportes: "all",
    reservas_online: "all", configuracion: "all",
  }),
  cajero: perms({
    agenda: ["can_view", "can_create", "can_update"],
    caja: "all",
    clientes: ["can_view", "can_create", "can_update"],
    ventas: "all",
    servicios: ["can_view"],
    inventario: ["can_view"],
    consumo: ["can_view"],
    reportes: ["can_view"],
  }),
  profesional: perms({
    agenda: ["can_view", "can_update"],
    clientes: ["can_view"],
    servicios: ["can_view"],
    fidelizacion: ["can_view"],
    reportes: ["can_view"],
  }),
};

export const ROLE_DESCRIPTIONS: Record<RoleKey, string> = {
  owner: "Propietario de la organización. Acceso total protegido.",
  administracion: "Gestión completa del negocio: dashboard, operación y configuración.",
  cajero: "Caja, cobros, ventas y agenda del día a día.",
  profesional: "Su agenda, servicios y clientes asignados.",
};

/** Landing por perfil cuando entra a la app. */
export const ROLE_LANDING: Record<RoleKey, string> = {
  owner: "dashboard",
  administracion: "dashboard",
  cajero: "caja",
  profesional: "agenda",
};

export function can(
  permissions: Record<string, Record<PermissionAction, boolean>> | null | undefined,
  moduleKey: ModuleKey | string,
  action: PermissionAction = "can_view"
): boolean {
  return Boolean(permissions?.[moduleKey]?.[action]);
}

/** ————— Planes —————
 * La tabla real vellora_plans solo guarda plan_key/name/description/price_monthly,
 * así que los límites se definen aquí por plan_key y se resuelven en tiempo de uso. */
export const PLAN_ORDER: Record<string, number> = { esencial: 0, profesional: 1, elite: 2 };

export type PlanLimits = {
  max_professionals: number; // -1 = ilimitado
  max_branches: number; // -1 = ilimitado
  max_monthly_appointments: number; // -1 = ilimitado
  features: string[];
};

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  esencial: {
    max_professionals: 5,
    max_branches: 1,
    max_monthly_appointments: 400,
    features: [
      "1 sucursal · 5 profesionales",
      "Agenda, caja, clientes y ventas",
      "400 citas al mes",
      "Soporte por correo",
    ],
  },
  profesional: {
    max_professionals: 15,
    max_branches: 3,
    max_monthly_appointments: 1500,
    features: [
      "3 sucursales · 15 profesionales",
      "Todo lo del plan Esencial",
      "Inventario, proveedores, compras y nómina",
      "Fidelización y marketing",
      "Reportes avanzados · 1500 citas/mes",
    ],
  },
  elite: {
    max_professionals: -1,
    max_branches: -1,
    max_monthly_appointments: -1,
    features: [
      "Sucursales y profesionales ilimitados",
      "Todo lo del plan Profesional",
      "Citas ilimitadas",
      "Soporte prioritario",
    ],
  },
};

/** Resuelve los límites de un plan por plan_key; planes desconocidos → sin restricción. */
export function resolvePlanLimits(
  plan: { plan_key?: string } | null | undefined
): PlanLimits {
  const key = String(plan?.plan_key ?? "").toLowerCase();
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.elite;
}

/** ————— Módulos incluidos por plan —————
 * La app oculta del menú los módulos que no incluye el plan vigente de la
 * organización (organization_subscriptions → vellora_plans.plan_key).
 * Espejo de las características anunciadas en PLAN_LIMITS:
 *   · esencial    → operación básica (agenda, caja, clientes, ventas, servicios)
 *   · profesional → + inventario, proveedores, compras, consumo, nómina,
 *                   fidelización y marketing
 *   · elite       → todos los módulos
 * Plan desconocido o sin suscripción → todos los módulos (misma conducta
 * tolerante que resolvePlanLimits, que hace fallback a elite).           */
export const PLAN_MODULES: Record<string, ModuleKey[]> = {
  esencial: [
    "dashboard", "agenda", "caja", "clientes", "ventas", "servicios",
    "profesionales", "reportes", "reservas_online", "configuracion",
  ],
  profesional: [
    "dashboard", "agenda", "caja", "clientes", "ventas", "servicios",
    "profesionales", "inventario", "proveedores", "compras", "consumo",
    "nomina", "fidelizacion", "marketing", "reportes", "reservas_online",
    "configuracion",
  ],
  elite: [
    "dashboard", "agenda", "caja", "clientes", "ventas", "servicios",
    "profesionales", "inventario", "proveedores", "compras", "consumo",
    "nomina", "fidelizacion", "marketing", "reportes", "reservas_online",
    "configuracion",
  ],
};

/** ¿El plan incluye el módulo? Plan desconocido o sin suscripción → true. */
export function planAllowsModule(
  planKey: string | null | undefined,
  moduleKey: ModuleKey | string
): boolean {
  const list = PLAN_MODULES[String(planKey ?? "").toLowerCase()];
  if (!list) return true;
  return list.includes(moduleKey as ModuleKey);
}

export type PlanCheck = {
  label: string;
  used: number;
  limit: number; // -1 ilimitado
  ok: boolean;
  warn: boolean; // >= 80% del límite
  unit: string;
};

export function planChecks(
  limits: PlanLimits,
  usage: { professionals: number; branches: number; monthlyAppointments: number }
): PlanCheck[] {
  const mk = (label: string, used: number, limit: number, unit: string): PlanCheck => ({
    label,
    used,
    limit,
    unit,
    ok: limit < 0 ? true : used <= limit,
    warn: limit >= 0 && used / limit >= 0.8,
  });
  return [
    mk("Profesionales activos", usage.professionals, limits.max_professionals, "profesionales"),
    mk("Sucursales", usage.branches, limits.max_branches, "sucursales"),
    mk("Citas este mes", usage.monthlyAppointments, limits.max_monthly_appointments, "citas"),
  ];
}

export function planAllowsNewProfessional(limits: PlanLimits, currentActive: number): boolean {
  return limits.max_professionals < 0 || currentActive < limits.max_professionals;
}

export function planAllowsNewBranch(limits: PlanLimits, current: number): boolean {
  return limits.max_branches < 0 || current < limits.max_branches;
}

export function planAllowsNewAppointment(limits: PlanLimits, monthCount: number): boolean {
  return limits.max_monthly_appointments < 0 || monthCount < limits.max_monthly_appointments;
}
