/* VelloRa ERP — Tipos compartidos.
   Alineados 1:1 con el esquema REAL de la base de datos (BD.sql exportada de Supabase):
   branches, service_orders + service_order_items + payments, payroll_runs + payroll_items,
   loyalty_accounts + loyalty_transactions, vellora_plans, purchases + suppliers, etc.
   Los campos marcados como "derivado" se calculan en la capa de consultas y no existen en la tabla. */

export type RoleKey = "owner" | "administracion" | "cajero" | "profesional";

export type ModuleKey =
  | "dashboard"
  | "agenda"
  | "caja"
  | "clientes"
  | "ventas"
  | "servicios"
  | "profesionales"
  | "inventario"
  | "proveedores"
  | "compras"
  | "consumo"
  | "nomina"
  | "fidelizacion"
  | "marketing"
  | "reportes"
  | "reservas_online"
  | "configuracion";

export type PermissionAction = "can_view" | "can_create" | "can_update" | "can_delete";

export type Organization = {
  id: string;
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  currency?: string | null;
  timezone?: string | null;
  logo_url?: string | null;
  active?: boolean;
  created_at: string;
};

export type Branch = {
  id: string;
  organization_id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  active: boolean;
  created_at?: string;
};

export type AppUser = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
};

export type Role = {
  id: string;
  organization_id: string;
  role_key: RoleKey | string;
  name: string;
  description: string | null;
  is_system: boolean;
  active: boolean;
  created_at?: string;
};

/* Fila del RPC vellora_list_members (o equivalente en demo) */
export type MemberRow = {
  member_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string; // columna organization_members.role (CHECK: owner/admin/reception/professional/cashier/accountant)
  profile_id: string | null;
  profile_name: string | null;
  profile_key: string | null;
  branch_id: string | null;
  branch_name: string | null;
  active: boolean;
};

/* vellora_modules (sin sort_order ni category en la BD real) */
export type Module = {
  id: string;
  module_key: ModuleKey | string;
  name: string;
  description: string | null;
  active: boolean;
  created_at?: string;
};

export type RoleModulePermission = {
  role_id: string;
  module_id: string;
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};

/* vellora_plans — la BD real no guarda límites; se resuelven por plan_key (permissions.ts) */
export type Plan = {
  id: string;
  plan_key: "esencial" | "profesional" | "elite" | string;
  name: string;
  description: string | null;
  price_monthly: number;
  active: boolean;
  created_at?: string;
};

export type OrganizationSubscription = {
  id: string;
  organization_id: string;
  plan_id: string;
  status: "active" | "trial" | "past_due" | "cancelled" | "expired" | string;
  starts_at: string;
  ends_at: string | null;
  created_at?: string;
};

/* ————— Clientes ————— */
export type Customer = {
  id: string;
  organization_id: string;
  full_name: string;
  document_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  birth_date?: string | null;
  address?: string | null;
  instagram?: string | null;
  acquisition_source?: string | null;
  notes?: string | null;
  hair_type?: string | null;
  current_hair_color?: string | null;
  allergies?: string | null;
  active?: boolean;
  created_at: string;
  updated_at?: string;
};

/* ————— Servicios ————— */
export type Service = {
  id: string;
  organization_id: string;
  category_id?: string | null;
  name: string;
  description?: string | null;
  price: number;
  duration_minutes: number;
  variable_price?: boolean;
  commission_percent?: number;
  tax_percent?: number;
  active: boolean;
  created_at?: string;
  category?: string | null;
  updated_at?: string | null;
};

/* ————— Empleados ————— */
export type Employee = {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  full_name: string;
  document_number?: string | null;
  phone?: string | null;
  email?: string | null;
  position?: string | null;
  specialties?: string | null;
  commission_percent?: number;
  salary?: number;
  /* Nómina parametrizable: básico, porcentaje o ambos */
  salary_type?: "basico" | "porcentaje" | "mixto" | string;
  active: boolean;
  role?: string | null;
  created_at?: string;
};

/* ————— Citas ————— (CHECK real: reserved/scheduled/confirmed/arrived/in_service/completed/cancelled/no_show) */
export type AppointmentStatus =
  | "reserved" | "scheduled" | "confirmed" | "arrived"
  | "in_service" | "completed" | "cancelled" | "no_show";

export type Appointment = {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  customer_id?: string | null;
  employee_id?: string | null;
  service_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  status: AppointmentStatus;
  notes?: string | null;
  created_at?: string;
  price: number;
  updated_at?: string | null;
  source: "internal" | "online" | "phone" | "walk_in" | string;
  booking_code?: string | null;
};

/* ————— Ventas: service_orders + service_order_items + payments ————— */
export type ServiceOrderStatus = "open" | "paid" | "void";

export type ServiceOrder = {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  customer_id?: string | null;
  employee_id?: string | null;
  appointment_id?: string | null;
  status: ServiceOrderStatus | string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  created_at: string;
  /* derivados */
  payment_method: string | null; // método del último pago registrado
  kind: "servicio" | "producto" | "mixto"; // según items de la orden
  /** Líneas de la venta (service_order_items): 1 orden puede llevar N ítems,
      p.ej. Manicure + Pedicure + venta de un shampoo. */
  items?: ServiceOrderItem[];
};

/** Alias histórico usado por las vistas. */
export type Sale = ServiceOrder;

export type ServiceOrderItem = {
  id: string;
  order_id: string;
  service_id?: string | null;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  commission_percent?: number;
};

export type Payment = {
  id: string;
  organization_id: string;
  order_id?: string | null;
  method: string;
  amount: number;
  paid_at: string;
  reference?: string | null;
};

/* ————— Productos e inventario ————— */
export type Product = {
  id: string;
  organization_id: string;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  cost: number;
  sale_price: number;
  stock: number;
  minimum_stock: number;
  supplier_name?: string | null;
  lot?: string | null;
  expires_at?: string | null;
  location?: string | null;
  unit?: string | null;
  active: boolean;
  created_at?: string;
  stock_quantity?: number;
  updated_at?: string | null;
};

export type Supplier = {
  id: string;
  organization_id: string;
  name: string;
  tax_id?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string | null;
};

/* CHECK real: draft / received / cancelled */
export type Purchase = {
  id: string;
  organization_id: string;
  supplier_id?: string | null;
  purchase_number?: string | null;
  status: "draft" | "received" | "cancelled" | string;
  purchase_date: string;
  total: number;
  notes?: string | null;
  created_by?: string | null;
  received_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  subtotal?: number;
  /* derivado */
  supplier_name?: string | null;
};

export type PurchaseItem = {
  id: string;
  purchase_id: string;
  product_id?: string | null;
  quantity: number;
  unit_cost: number;
  created_at?: string;
  /* derivado */
  product_name?: string | null;
};

export type InventoryMovement = {
  id: string;
  organization_id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  unit_cost?: number | null;
  reference?: string | null;
  created_at: string;
};

/* ————— Nómina: payroll_runs + payroll_items ————— */
export type PayrollRun = {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "approved" | "paid" | string;
  created_at?: string;
  updated_at?: string | null;
};

export type PayrollItem = {
  id: string;
  run_id: string;
  employee_id: string;
  base_salary: number;
  commission: number;
  bonus: number;
  deductions: number;
  total: number;
  paid: boolean;
  paid_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
  /* derivado */
  employee_name?: string | null;
  period_label?: string;
};

/* ————— Periodos de trabajo y caja diaria ————— */
export type WorkPeriod = {
  id: string;
  organization_id: string;
  name: string;
  period_type: "semanal" | "quincenal" | "mensual" | "personalizado" | string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: "abierto" | "cerrado" | string;
  closed_at?: string | null;
  notes?: string | null;
  created_at?: string;
};

/** Sesión de caja de un día (tabla cash_registers). */
export type CashSession = {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  work_period_id?: string | null;
  opened_at: string;
  closed_at?: string | null;
  opening_amount: number;
  closing_amount?: number | null;
  expected_amount?: number;
  difference?: number;
  status: "open" | "closed" | string;
  opened_by?: string | null;
  notes?: string | null;
};

export type CashMovementType =
  | "sale" | "expense" | "withdrawal" | "deposit" | "adjustment";

/** Movimiento de caja (tabla cash_movements, asociado a la sesión del día). */
export type CashMovement = {
  id: string;
  cash_register_id: string;
  organization_id?: string | null;
  type: CashMovementType | string;
  description?: string | null;
  method?: string | null;
  amount: number;
  created_at: string;
  payment_id?: string | null;
};

/* ————— Fidelización: loyalty_accounts + loyalty_transactions ————— */
export type LoyaltyAccount = {
  id: string;
  organization_id: string;
  customer_id: string;
  points: number;
  tier: string;
  /* derivado */
  customer_name?: string | null;
  customer_phone?: string | null;
};

export type LoyaltyTransaction = {
  id: string;
  organization_id: string;
  customer_id: string;
  payment_id?: string | null;
  points_delta: number;
  reason: string;
  created_at: string;
};

/* ————— Marketing ————— */
export type Campaign = {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  channel: string;
  objective?: string | null;
  content?: string | null;
  status: "draft" | "active" | "paused" | "completed" | string;
  budget: number;
  starts_on?: string | null;
  ends_on?: string | null;
  created_at?: string;
  updated_at?: string | null;
};

/* ————— Reservas online: appointments.source='online' + booking_settings ————— */
/* Horario comercial de un día (clave "1"=lunes … "7"=domingo, ISO) */
export type BookingHours = { open: string; close: string; closed: boolean };

export type BookingSettings = {
  id: string;
  organization_id: string;
  slug: string;
  public_name: string;
  description?: string | null;
  contact_phone?: string | null;
  enabled: boolean;
  notice_hours: number;
  horizon_days: number;
  /* v2: confirmación automática, duración del bloque, horario por día y
     antelación mínima para que el cliente cancele en línea */
  auto_confirm: boolean;
  slot_minutes: number;
  cancellation_hours: number;
  business_hours?: Record<string, BookingHours> | null;
  created_at?: string;
  updated_at?: string | null;
};

/* ————— Notificaciones calculadas (la BD real no tiene tabla notifications) ————— */
export type AppNotification = {
  id: string;
  organization_id: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  module_key: ModuleKey | string;
  audience_roles: RoleKey[] | string[];
  created_at: string;
  read_by?: string[];
};

/* Contexto de sesión derivado */
export type OrganizationContext = {
  organizationId: string;
  organization: Organization;
  branches: Branch[];
  user: AppUser;
  member: { id: string; profile_id: string | null; branch_id: string | null; active: boolean };
  role: Role | null;
  permissions: Record<string, Record<PermissionAction, boolean>>;
  subscription: {
    plan: Plan;
    status: string;
    current_period_end: string;
  } | null;
};

export type Session = {
  user: AppUser;
};