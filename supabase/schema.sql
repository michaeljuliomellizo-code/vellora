-- ============================================================================
-- VelloRa ERP — Esquema completo de Supabase (PostgreSQL)
-- Versión 1.0 · 2026-11-01
--
-- Contenido:
--   1. Tablas núcleo multi-tenant (organizaciones, sucursales, membresías)
--   2. Perfiles y permisos (owner + administracion + cajero + profesional)
--   3. Planes y suscripción (Esencial / Profesional / Elite)
--   4. Módulos ERP (agenda, caja, clientes, ventas, inventario, nómina…)
--   5. Funciones RPC usadas por la app
--   6. Triggers (nuevos usuarios, updated_at, fidelización)
--   7. Row Level Security (RLS) por organización y permisos
--   8. Seed: módulos, planes, organización demo con los 4 accesos
--
-- Cómo usarlo:
--   1. Supabase Dashboard → SQL Editor → New query → pegar TODO este archivo → Run.
--   2. Crear los usuarios demo en Authentication → Users (o invitaciones reales)
--      con los mismos correos del seed (paso 8.4).
--   3. Ejecutar el bloque 8.8 con los UUID reales de los usuarios creados.
--   4. En la app VelloRa, definir NEXT_PUBLIC_SUPABASE_URL y
--      NEXT_PUBLIC_SUPABASE_ANON_KEY → el ERP conecta con KPIs reales.
--
-- Nota: los UUID del seed son fijos para que las FK cuadren; Supabase los acepta.
-- ============================================================================

-- ─────────────────────────────────────────────
-- 0. Extensiones
-- ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. NÚCLEO MULTI-TENANT
-- ─────────────────────────────────────────────

-- 1.1 Organizaciones (tenant raíz)
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  currency    text not null default 'COP',
  timezone    text not null default 'America/Bogota',
  created_at  timestamptz not null default now()
);

-- 1.2 Sucursales
create table if not exists public.organization_branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  address         text,
  phone           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- 1.3 Perfil de usuario (extiende auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 2. PERFILES (ROLES) Y PERMISOS
--    3 perfiles de la propuesta + owner protegido del código original
-- ─────────────────────────────────────────────

create table if not exists public.organization_roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key        text not null,
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, role_key)
);

-- Miembros de la organización: une auth.users ↔ organización ↔ perfil
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  profile_id      uuid references public.organization_roles(id) on delete set null,
  branch_id       uuid references public.organization_branches(id) on delete set null,
  legacy_role     text not null default 'profesional',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Catálogo global de módulos del ERP
create table if not exists public.vellora_modules (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null unique,
  name        text not null,
  description text,
  category    text not null default 'Operación',
  sort_order  int  not null default 99,
  active      boolean not null default true
);

-- Matriz de permisos rol × módulo (Consultar / Crear / Editar / Eliminar)
create table if not exists public.role_module_permissions (
  role_id     uuid not null references public.organization_roles(id) on delete cascade,
  module_id   uuid not null references public.vellora_modules(id) on delete cascade,
  can_view    boolean not null default false,
  can_create  boolean not null default false,
  can_update  boolean not null default false,
  can_delete  boolean not null default false,
  primary key (role_id, module_id)
);

-- ─────────────────────────────────────────────
-- 3. PLANES Y SUSCRIPCIÓN  (paso 4 y 9 de la propuesta)
-- ─────────────────────────────────────────────

create table if not exists public.plans (
  id                       uuid primary key default gen_random_uuid(),
  plan_key                 text not null unique,
  name                     text not null,
  description              text,
  price_monthly            numeric(12,2) not null default 0,
  max_professionals        int not null default 5,   -- -1 = ilimitado
  max_branches             int not null default 1,   -- -1 = ilimitado
  max_monthly_appointments int not null default 400, -- -1 = ilimitado
  features                 jsonb not null default '[]'::jsonb,
  active                   boolean not null default true,
  created_at               timestamptz not null default now()
);

create table if not exists public.organization_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  plan_id              uuid not null references public.plans(id),
  status               text not null default 'activa',
  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null default (now() + interval '30 days'),
  created_at           timestamptz not null default now()
);

create index if not exists idx_sub_org on public.organization_subscriptions(organization_id, status);

-- ─────────────────────────────────────────────
-- 4. MÓDULOS ERP
-- ─────────────────────────────────────────────

-- 4.1 Clientes
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name       text not null,
  phone           text,
  email           text,
  birth_date      date,
  gender          text,
  notes           text,
  loyalty_points  int not null default 0,
  total_visits    int not null default 0,
  total_spent     numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_customers_org on public.customers(organization_id);

-- 4.2 Servicios
create table if not exists public.services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        text not null default 'Otros',
  duration_min    int not null default 60,
  price           numeric(12,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_services_org on public.services(organization_id);

-- 4.3 Profesionales (empleados)
create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.organization_branches(id) on delete set null,
  full_name       text not null,
  role_title      text not null default 'Profesional',
  specialty       text,
  email           text,
  phone           text,
  commission_pct  numeric(5,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_employees_org on public.employees(organization_id);

-- 4.4 Citas (agenda)
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.organization_branches(id) on delete set null,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  service_id      uuid not null references public.services(id) on delete restrict,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          text not null default 'pendiente',
  price           numeric(12,2) not null default 0,
  source          text not null default 'app',
  notes           text,
  created_at      timestamptz not null default now(),
  constraint appts_status check (status in ('pendiente','confirmada','completada','cancelada','no_show')),
  constraint appts_source check (source in ('app','online','walk_in','phone')),
  constraint appts_dates check (ends_at > starts_at)
);
create index if not exists idx_appts_org_start on public.appointments(organization_id, starts_at);
create index if not exists idx_appts_employee on public.appointments(employee_id, starts_at);

-- 4.5 Ventas e ítems
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.organization_branches(id) on delete set null,
  customer_id     uuid references public.customers(id) on delete set null,
  employee_id     uuid references public.employees(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  kind            text not null default 'servicio',
  subtotal        numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  payment_method  text not null default 'efectivo',
  status          text not null default 'pagada',
  created_at      timestamptz not null default now(),
  constraint sales_kind check (kind in ('servicio','producto','mixto')),
  constraint sales_method check (payment_method in ('efectivo','tarjeta','transferencia','nequi')),
  constraint sales_status check (status in ('pagada','pendiente','anulada'))
);
create index if not exists idx_sales_org_created on public.sales(organization_id, created_at);

create table if not exists public.sale_items (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.sales(id) on delete cascade,
  kind       text not null,
  ref_id     uuid,
  name       text not null,
  qty        numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  total      numeric(14,2) not null default 0,
  constraint sale_items_kind check (kind in ('service','product'))
);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);

-- 4.6 Productos (inventario)
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku             text not null,
  name            text not null,
  category        text not null default 'Otros',
  cost_price      numeric(12,2) not null default 0,
  sale_price      numeric(12,2) not null default 0,
  stock           int not null default 0,
  min_stock       int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, sku)
);
create index if not exists idx_products_org on public.products(organization_id);

-- 4.7 Compras a proveedores
create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.organization_branches(id) on delete set null,
  supplier        text not null,
  total           numeric(14,2) not null default 0,
  status          text not null default 'pendiente',
  created_at      timestamptz not null default now(),
  constraint purchases_status check (status in ('pendiente','recibida'))
);

create table if not exists public.purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  qty         numeric(10,2) not null default 1,
  unit_cost   numeric(12,2) not null default 0,
  total       numeric(14,2) not null default 0
);

-- 4.8 Nómina
create table if not exists public.payroll_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  period          text not null, -- formato YYYY-MM
  base_salary     numeric(14,2) not null default 0,
  commissions     numeric(14,2) not null default 0,
  bonuses         numeric(14,2) not null default 0,
  deductions      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  status          text not null default 'pendiente',
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (employee_id, period),
  constraint payroll_status check (status in ('pendiente','pagada'))
);

-- 4.9 Fidelización
create table if not exists public.loyalty_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  points          int not null,
  kind            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  constraint loyalty_kind check (kind in ('earn','redeem')),
  constraint loyalty_points check (points <> 0)
);
create index if not exists idx_loyalty_org on public.loyalty_movements(organization_id, created_at);

-- 4.10 Marketing
create table if not exists public.marketing_campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  channel         text not null,
  audience        text,
  status          text not null default 'borrador',
  scheduled_at    timestamptz,
  sent            int not null default 0,
  opened          int not null default 0,
  converted       int not null default 0,
  created_at      timestamptz not null default now(),
  constraint campaigns_channel check (channel in ('whatsapp','email','instagram','sms')),
  constraint campaigns_status check (status in ('borrador','programada','enviada'))
);

-- 4.11 Reservas online (página pública /reservar/[slug])
create table if not exists public.online_bookings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_name   text not null,
  phone           text not null,
  service_id      uuid references public.services(id) on delete set null,
  employee_id     uuid references public.employees(id) on delete set null,
  preferred_at    timestamptz not null,
  status          text not null default 'nuevo',
  created_at      timestamptz not null default now(),
  constraint bookings_status check (status in ('nuevo','confirmado','rechazado'))
);
create index if not exists idx_online_bookings_org on public.online_bookings(organization_id, status);

-- 4.12 Notificaciones / alertas
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  severity        text not null default 'info',
  title           text not null,
  body            text,
  module_key      text,
  audience_roles  text[] not null default '{owner,administracion}',
  read_by         text[] not null default '{}',
  created_at      timestamptz not null default now(),
  constraint notif_severity check (severity in ('info','warning','critical'))
);
create index if not exists idx_notifications_org on public.notifications(organization_id, created_at);

-- ─────────────────────────────────────────────
-- 5. FUNCIONES RPC (las que llama la app)
-- ─────────────────────────────────────────────

-- Helper: membresía activa del usuario actual
create or replace function public.vellora_current_member()
returns table (member_id uuid, organization_id uuid, role_key text, role_name text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.organization_id, r.role_key, r.name,
         coalesce(r.role_key = 'owner', false)
  from public.organization_members m
  left join public.organization_roles r on r.id = m.profile_id
  where m.user_id = auth.uid() and m.active = true
  limit 1;
$$;

-- Helper: ¿el usuario actual es miembro de la organización?
create or replace function public.vellora_is_member(p_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where user_id = auth.uid() and organization_id = p_organization_id and active = true
  );
$$;

-- Helper: permiso del rol del usuario actual sobre un módulo
create or replace function public.vellora_has_permission(
  p_organization_id uuid, p_module_key text, p_action text default 'can_view'
)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_action
             when 'can_view' then p.can_view
             when 'can_create' then p.can_create
             when 'can_update' then p.can_update
             when 'can_delete' then p.can_delete
             else false
           end
    from public.organization_members m
    join public.role_module_permissions p on p.role_id = m.profile_id
    join public.vellora_modules mo on mo.id = p.module_id
    where m.user_id = auth.uid()
      and m.organization_id = p_organization_id
      and m.active = true
      and mo.module_key = p_module_key
    limit 1
  ), false);
$$;

-- RPC: directorio de usuarios de la organización (usada por el módulo Usuarios)
create or replace function public.vellora_list_members(p_organization_id uuid)
returns table (
  member_id uuid, user_id uuid, email text, full_name text, phone text,
  legacy_role text, profile_id uuid, profile_name text, profile_key text,
  branch_id uuid, branch_name text, active boolean
)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, pr.email, pr.full_name, pr.phone,
         m.legacy_role, m.profile_id, r.name, r.role_key,
         m.branch_id, b.name, m.active
  from public.organization_members m
  left join public.profiles pr on pr.id = m.user_id
  left join public.organization_roles r on r.id = m.profile_id
  left join public.organization_branches b on b.id = m.branch_id
  where m.organization_id = p_organization_id
    and public.vellora_is_member(p_organization_id)
  order by pr.full_name nulls last;
$$;

-- RPC: sucursales disponibles para asignar miembros
create or replace function public.vellora_list_member_branches(p_organization_id uuid)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select b.id, b.name
  from public.organization_branches b
  where b.organization_id = p_organization_id and b.active = true
    and public.vellora_is_member(p_organization_id)
  order by b.name;
$$;

-- RPC: actualizar perfil, sucursal y estado de acceso de un miembro
--      (protege al owner y exige permiso de actualizar en configuracion)
create or replace function public.vellora_update_member_access(
  p_organization_id uuid,
  p_member_id uuid,
  p_profile_id uuid,
  p_branch_id uuid,
  p_active boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target_role text;
  v_target_current text;
begin
  -- El perfil destino no puede ser owner
  select role_key into v_target_role
  from public.organization_roles where id = p_profile_id;
  if v_target_role = 'owner' then
    raise exception 'No se puede asignar el perfil Propietario (protegido)';
  end if;

  -- El miembro objetivo no puede ser el owner
  select r.role_key into v_target_current
  from public.organization_members m
  left join public.organization_roles r on r.id = m.profile_id
  where m.id = p_member_id and m.organization_id = p_organization_id;
  if v_target_current = 'owner' then
    raise exception 'El acceso del Propietario está protegido';
  end if;

  -- El llamante debe poder actualizar el módulo configuracion
  if not public.vellora_has_permission(p_organization_id, 'configuracion', 'can_update') then
    raise exception 'Sin permiso para administrar usuarios (configuracion:can_update)';
  end if;

  update public.organization_members m
     set profile_id = p_profile_id,
         branch_id  = p_branch_id,
         active     = p_active,
         legacy_role = v_target_role
   where m.id = p_member_id and m.organization_id = p_organization_id;
end;
$$;

-- RPC: límites y uso del plan actual (validación del paso 9)
create or replace function public.vellora_plan_usage(p_organization_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'professionals', (select count(*) from public.employees e where e.organization_id = p_organization_id and e.active),
    'branches',      (select count(*) from public.organization_branches b where b.organization_id = p_organization_id and b.active),
    'monthly_appointments', (select count(*) from public.appointments a
                              where a.organization_id = p_organization_id
                                and date_trunc('month', a.starts_at) = date_trunc('month', now())),
    'plan', (select jsonb_build_object('plan_key', pl.plan_key, 'name', pl.name,
                    'max_professionals', pl.max_professionals,
                    'max_branches', pl.max_branches,
                    'max_monthly_appointments', pl.max_monthly_appointments)
             from public.organization_subscriptions s
             join public.plans pl on pl.id = s.plan_id
             where s.organization_id = p_organization_id and s.status in ('activa','prueba')
             order by s.current_period_start desc limit 1)
  );
$$;

-- ─────────────────────────────────────────────
-- 6. TRIGGERS
-- ─────────────────────────────────────────────

-- 6.1 Crear perfil + organización/membresía cuando se registra un usuario
--     meta opcional: raw_user_meta_metadata → { full_name, create_org: "true", organization_name }
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_role uuid;
  v_org_name text;
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email, coalesce(new.raw_user_meta_metadata->>'full_name', ''), new.phone)
  on conflict (id) do nothing;

  if coalesce(new.raw_user_meta_metadata->>'create_org', 'false') = 'true' then
    v_org_name := coalesce(new.raw_user_meta_metadata->>'organization_name', 'Mi Salón');
    insert into public.organizations (name, slug)
    values (v_org_name, lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 6))
    returning id into v_org;

    insert into public.organization_roles (organization_id, role_key, name, description, is_system)
    values (v_org, 'owner', 'Propietario', 'Acceso total protegido al ERP.', true),
           (v_org, 'administracion', 'Administración', 'Gestión completa del negocio y del dashboard.', true),
           (v_org, 'cajero', 'Cajero', 'Caja, cobros, ventas y agenda.', true),
           (v_org, 'profesional', 'Profesional', 'Su agenda, servicios y clientes.', true);

    select id into v_role from public.organization_roles
    where organization_id = v_org and role_key = 'owner';

    insert into public.organization_members (organization_id, user_id, profile_id, legacy_role)
    values (v_org, new.id, v_role, 'owner');

    insert into public.organization_subscriptions (organization_id, plan_id, status, current_period_end)
    select v_org, p.id, 'prueba', now() + interval '14 days'
    from public.plans p where p.plan_key = 'profesional';
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6.2 Coherencia: subtotal de venta = suma de ítems
create or replace function public.recalc_sale_total()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sale uuid;
begin
  v_sale := coalesce(new.sale_id, old.sale_id);
  update public.sales s
     set subtotal = t.sum_total
    from (select coalesce(sum(total),0) as sum_total
            from public.sale_items where sale_id = v_sale) t
   where s.id = v_sale;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recalc_sale_total on public.sale_items;
create trigger trg_recalc_sale_total
  after insert or update or delete on public.sale_items
  for each row execute function public.recalc_sale_total();

-- 6.3 Fidelización: otorgar puntos al completar una cita
create or replace function public.earn_loyalty_on_complete()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_points int;
begin
  if new.status = 'completada' and coalesce(old.status, '') <> 'completada' then
    v_points := greatest(5, floor(new.price / 1000)::int);
    insert into public.loyalty_movements (organization_id, customer_id, points, kind, description)
    values (new.organization_id, new.customer_id, v_points, 'earn', 'Puntos por servicio completado');
    update public.customers
       set loyalty_points = loyalty_points + v_points,
           total_visits = total_visits + 1,
           total_spent = total_spent + new.price
     where id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_earn_loyalty on public.appointments;
create trigger trg_earn_loyalty
  after update of status on public.appointments
  for each row execute function public.earn_loyalty_on_complete();

-- ─────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
--    Regla general: solo miembros activos acceden a datos de su organización.
--    Los permisos finos por módulo los evalúa vellora_has_permission(); la BD
--    garantiza el aislamiento multi-tenant.
-- ─────────────────────────────────────────────

alter table public.organizations              enable row level security;
alter table public.organization_branches      enable row level security;
alter table public.profiles                   enable row level security;
alter table public.organization_roles         enable row level security;
alter table public.organization_members       enable row level security;
alter table public.vellora_modules            enable row level security;
alter table public.role_module_permissions    enable row level security;
alter table public.plans                      enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.customers                  enable row level security;
alter table public.services                   enable row level security;
alter table public.employees                  enable row level security;
alter table public.appointments               enable row level security;
alter table public.sales                      enable row level security;
alter table public.sale_items                 enable row level security;
alter table public.products                   enable row level security;
alter table public.purchases                  enable row level security;
alter table public.purchase_items             enable row level security;
alter table public.payroll_entries            enable row level security;
alter table public.loyalty_movements          enable row level security;
alter table public.marketing_campaigns        enable row level security;
alter table public.online_bookings            enable row level security;
alter table public.notifications              enable row level security;

-- 7.1 Organizaciones: visibles solo para miembros
drop policy if exists org_member_read on public.organizations;
create policy org_member_read on public.organizations
  for select using (public.vellora_is_member(id));

-- 7.2 Perfil propio: el usuario ve/edita su propio perfil
drop policy if exists profile_self on public.profiles;
create policy profile_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- 7.3 Plantilla de políticas para tablas con organization_id
do $$
declare t text;
begin
  foreach t in array array[
    'organization_branches','organization_members',
    'customers','services','employees','appointments','sales','products',
    'purchases','payroll_entries','loyalty_movements','marketing_campaigns',
    'online_bookings','notifications','organization_subscriptions'
  ] loop
    execute format('drop policy if exists "%s_org_select" on public.%I;', t, t);
    execute format('create policy "%s_org_select" on public.%I for select using (public.vellora_is_member(organization_id));', t, t);
    execute format('drop policy if exists "%s_org_write" on public.%I;', t, t);
    execute format('create policy "%s_org_write" on public.%I for all using (public.vellora_is_member(organization_id)) with check (public.vellora_is_member(organization_id));', t, t);
  end loop;
end $$;

-- 7.4 Roles: lectura para miembros, escritura solo owner/administración
drop policy if exists roles_member_read on public.organization_roles;
create policy roles_member_read on public.organization_roles
  for select using (public.vellora_is_member(organization_id));

drop policy if exists roles_admin_write on public.organization_roles;
create policy roles_admin_write on public.organization_roles
  for all using (
    public.vellora_is_member(organization_id)
    and (public.vellora_current_member().is_owner
         or public.vellora_has_permission(organization_id, 'configuracion', 'can_update'))
  ) with check (
    public.vellora_is_member(organization_id)
    and (public.vellora_current_member().is_owner
         or public.vellora_has_permission(organization_id, 'configuracion', 'can_update'))
  );

-- 7.5 Módulos y planes: catálogos legibles por cualquier usuario autenticado
drop policy if exists modules_read on public.vellora_modules;
create policy modules_read on public.vellora_modules
  for select to authenticated using (active = true);

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans
  for select to authenticated using (active = true);

-- 7.6 Matriz de permisos: lectura por miembro, escritura admin
drop policy if exists perms_read on public.role_module_permissions;
create policy perms_read on public.role_module_permissions
  for select using (
    exists (select 1 from public.organization_roles r
            where r.id = role_id and public.vellora_is_member(r.organization_id))
  );

drop policy if exists perms_admin_write on public.role_module_permissions;
create policy perms_admin_write on public.role_module_permissions
  for all using (
    exists (select 1 from public.organization_roles r
            where r.id = role_id
              and (public.vellora_current_member().is_owner
                   or public.vellora_has_permission(r.organization_id, 'configuracion', 'can_update')))
  ) with check (
    exists (select 1 from public.organization_roles r
            where r.id = role_id
              and (public.vellora_current_member().is_owner
                   or public.vellora_has_permission(r.organization_id, 'configuracion', 'can_update')))
  );

-- 7.7 Ítems dependientes: heredan aislamiento por la FK padre
drop policy if exists sale_items_org on public.sale_items;
create policy sale_items_org on public.sale_items
  for all using (
    exists (select 1 from public.sales s where s.id = sale_id and public.vellora_is_member(s.organization_id))
  ) with check (
    exists (select 1 from public.sales s where s.id = sale_id and public.vellora_is_member(s.organization_id))
  );

drop policy if exists purchase_items_org on public.purchase_items;
create policy purchase_items_org on public.purchase_items
  for all using (
    exists (select 1 from public.purchases p where p.id = purchase_id and public.vellora_is_member(p.organization_id))
  ) with check (
    exists (select 1 from public.purchases p where p.id = purchase_id and public.vellora_is_member(p.organization_id))
  );

-- 7.8 Reservas online: el público crea, la organización gestiona
drop policy if exists bookings_public_insert on public.online_bookings;
create policy bookings_public_insert on public.online_bookings
  for insert to anon, authenticated with check (true);

drop policy if exists bookings_org_read on public.online_bookings;
create policy bookings_org_read on public.online_bookings
  for select using (public.vellora_is_member(organization_id));

drop policy if exists bookings_org_update on public.online_bookings;
create policy bookings_org_update on public.online_bookings
  for update using (public.vellora_is_member(organization_id))
  with check (public.vellora_is_member(organization_id));

-- ─────────────────────────────────────────────
-- 8. SEED
-- ─────────────────────────────────────────────

-- 8.1 Módulos del sistema
insert into public.vellora_modules (module_key, name, description, category, sort_order) values
  ('dashboard',       'Dashboard',          'Indicadores y resumen del negocio',            'Operación',      1),
  ('agenda',          'Agenda y reservas',  'Citas, disponibilidad y reservas',             'Operación',      2),
  ('caja',            'Caja',               'Turnos, cobros y arqueo',                      'Operación',      3),
  ('clientes',        'Clientes',           'Directorio e historial de clientes',           'Comercial',      4),
  ('ventas',          'Ventas',             'Facturación de servicios y productos',         'Comercial',      5),
  ('servicios',       'Servicios',          'Catálogo de servicios y tratamientos',         'Comercial',      6),
  ('profesionales',   'Profesionales',      'Equipo, comisiones y horarios',                'Gestión',        7),
  ('inventario',      'Inventario',         'Productos, stock y alertas',                   'Gestión',        8),
  ('compras',         'Compras',            'Órdenes a proveedores',                        'Gestión',        9),
  ('nomina',          'Nómina',             'Salarios, comisiones y pagos',                 'Gestión',       10),
  ('fidelizacion',    'Fidelización',       'Puntos y recompensas',                         'Comercial',     11),
  ('marketing',       'Marketing',          'Campañas y comunicaciones',                    'Comercial',     12),
  ('reportes',        'Reportes',           'Analítica avanzada y exportes',                'Gestión',       13),
  ('reservas_online', 'Reservas online',    'Solicitudes de la agenda pública',             'Operación',     14),
  ('configuracion',   'Configuración',      'Organización, usuarios, perfiles y planes',    'Administración',15)
on conflict (module_key) do nothing;

-- 8.2 Planes (Esencial / Profesional / Elite)
insert into public.plans (plan_key, name, description, price_monthly, max_professionals, max_branches, max_monthly_appointments, features) values
  ('esencial', 'Esencial', 'Para salones que empiezan a organizarse.', 89000, 5, 1, 400,
    '["1 sucursal","5 profesionales","400 citas/mes","Agenda y caja","Clientes y ventas","Soporte por correo"]'::jsonb),
  ('profesional', 'Profesional', 'El favorito de los salones en crecimiento.', 189000, 15, 3, 1500,
    '["3 sucursales","15 profesionales","1.500 citas/mes","Todo Esencial","Inventario y compras","Nómina y comisiones","Fidelización y marketing","Reportes avanzados","Soporte prioritario"]'::jsonb),
  ('elite', 'Elite', 'Cadenas y franquicias sin límites.', 389000, -1, -1, -1,
    '["Sucursales ilimitadas","Profesionales ilimitados","Citas ilimitadas","Todo Profesional","Multi-sede consolidado","API y webhooks","Gerente de cuenta dedicado"]'::jsonb)
on conflict (plan_key) do nothing;

-- 8.3 Organización demo
insert into public.organizations (id, name, slug, currency, timezone)
values ('11111111-1111-4111-8111-111111111111', 'Bella Esencia Spa & Salón', 'bella-esencia', 'COP', 'America/Bogota')
on conflict (slug) do nothing;

insert into public.organization_branches (id, organization_id, name, address, phone) values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'Sede Chapinero', 'Cra. 13 #63-40, Bogotá', '+57 601 345 6789'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'Sede Norte',     'Av. Chaón 128-52, Bogotá', '+57 601 987 6543')
on conflict do nothing;

-- 8.4 Perfiles del sistema de la organización demo
insert into public.organization_roles (id, organization_id, role_key, name, description, is_system) values
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', 'owner',          'Propietario',    'Acceso total protegido al ERP.',                true),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', 'administracion', 'Administración', 'Gestión completa del negocio y del dashboard.', true),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111111', 'cajero',         'Cajero',         'Caja, cobros, ventas y agenda.',                true),
  ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111111', 'profesional',    'Profesional',    'Su agenda, servicios y clientes.',              true)
on conflict do nothing;

-- 8.5 Matriz de permisos (espejo exacto de src/lib/vellora/permissions.ts)
-- owner y administracion: TODO en todos los módulos
insert into public.role_module_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, true, true, true
from public.organization_roles r
cross join public.vellora_modules m
where r.organization_id = '11111111-1111-4111-8111-111111111111'
  and r.role_key in ('owner','administracion')
on conflict do nothing;

-- cajero: agenda(v,c,u) · caja(todo) · clientes(v,c,u) · ventas(todo) · servicios(v) · inventario(v) · reportes(v)
insert into public.role_module_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id,
       true,
       (m.module_key in ('caja','ventas')),
       (m.module_key in ('agenda','caja','clientes','ventas')),
       (m.module_key in ('caja','ventas'))
from public.organization_roles r
cross join public.vellora_modules m
where r.role_key = 'cajero'
  and r.organization_id = '11111111-1111-4111-8111-111111111111'
  and m.module_key in ('agenda','caja','clientes','ventas','servicios','inventario','reportes')
on conflict do nothing;

-- profesional: agenda(v,u) · clientes(v) · servicios(v) · fidelizacion(v) · reportes(v)
insert into public.role_module_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id,
       true,
       false,
       (m.module_key = 'agenda'),
       false
from public.organization_roles r
cross join public.vellora_modules m
where r.role_key = 'profesional'
  and r.organization_id = '11111111-1111-4111-8111-111111111111'
  and m.module_key in ('agenda','clientes','servicios','fidelizacion','reportes')
on conflict do nothing;

-- 8.6 Suscripción demo al plan Profesional
insert into public.organization_subscriptions (organization_id, plan_id, status)
select '11111111-1111-4111-8111-111111111111', p.id, 'activa'
from public.plans p where p.plan_key = 'profesional';

-- 8.7 USUARIOS DEMO
--     Crearlos en Authentication → Users con los correos:
--       valentina@bellaesencia.co  (Propietaria, owner)
--       camila@bellaesencia.co     (Administración)
--       andres@bellaesencia.co     (Cajero)
--       laura@bellaesencia.co      (Profesional)
--     Contraseña sugerida: vellora2026

-- 8.8 Membresías demo — ejecutar DESPUÉS de crear los usuarios de Auth,
--     reemplazando los UUID por los reales:
--
-- insert into public.organization_members (organization_id, user_id, profile_id, legacy_role)
-- values
--   ('11111111-1111-4111-8111-111111111111', '<UUID_AUTH_valentina>', '33333333-3333-4333-8333-333333333301', 'owner'),
--   ('11111111-1111-4111-8111-111111111111', '<UUID_AUTH_camila>',    '33333333-3333-4333-8333-333333333302', 'administracion'),
--   ('11111111-1111-4111-8111-111111111111', '<UUID_AUTH_andres>',     '33333333-3333-4333-8333-333333333303', 'cajero'),
--   ('11111111-1111-4111-8111-111111111111', '<UUID_AUTH_laura>',      '33333333-3333-4333-8333-333333333304', 'profesional');

-- 8.9 Catálogo demo (servicios y productos) para KPIs desde el primer día
insert into public.services (id, organization_id, name, category, duration_min, price) values
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111111', 'Corte y styling',         'Cabello',  60,  55000),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111111', 'Coloración completa',     'Cabello', 120, 140000),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111111', 'Balayage',                'Cabello', 180, 220000),
  ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111111', 'Manicura spa',            'Uñas',     60,  42000),
  ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111111', 'Pedicura spa',            'Uñas',     75,  52000),
  ('44444444-4444-4444-8444-444444444406', '11111111-1111-4111-8111-111111111111', 'Masaje relajante 60 min', 'Spa',      60, 110000),
  ('44444444-4444-4444-8444-444444444407', '11111111-1111-4111-8111-111111111111', 'Facial hidratante',       'Rostro',   60,  95000),
  ('44444444-4444-4444-8444-444444444408', '11111111-1111-4111-8111-111111111111', 'Diseño de uñas',          'Uñas',     45,  38000),
  ('44444444-4444-4444-8444-444444444409', '11111111-1111-4111-8111-111111111111', 'Keratina',                'Cabello', 150, 180000),
  ('44444444-4444-4444-8444-444444444410', '11111111-1111-4111-8111-111111111111', 'Piedras calientes',       'Spa',      90, 150000)
on conflict (id) do nothing;

insert into public.employees (id, organization_id, branch_id, full_name, role_title, specialty, commission_pct) values
  ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'Laura Mendoza',  'Estilista sénior', 'Color y balayage',         40),
  ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'Sofía Torres',   'Estilista',        'Cortes y peinados',        35),
  ('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'Daniela Ruiz',   'Manicurista',      'Nail art',                 35),
  ('55555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222202', 'Carolina Peña',  'Terapeuta spa',    'Masajes y aromaterapia',   38),
  ('55555555-5555-4555-8555-555555555505', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222202', 'Sebastián Cruz', 'Barbero',          'Barba y afeitado clásico', 35),
  ('55555555-5555-4555-8555-555555555506', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222202', 'Juliana Vargas', 'Cosmetóloga',      'Faciales',                 40)
on conflict (id) do nothing;

insert into public.products (organization_id, sku, name, category, cost_price, sale_price, stock, min_stock) values
  ('11111111-1111-4111-8111-111111111111', 'VEL-001', 'Shampoo repolarizante 400ml',      'Cabello', 28000, 52000, 24, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-002', 'Acondicionador hidratación 400ml', 'Cabello', 30000, 56000, 18, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-003', 'Máscara capilar keratina 250g',    'Cabello', 42000, 78000,  9, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-004', 'Aceite de argán 60ml',             'Cabello', 35000, 64000,  3, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-005', 'Esmalte semipermanente Rosa Nudo', 'Uñas',    14000, 28000, 30, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-006', 'Esmalte semipermanente Rojo Pasión','Uñas',   14000, 28000, 22, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-007', 'Top coat brillo 15ml',             'Uñas',    12000, 24000,  5, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-008', 'Aceite para cutículas 30ml',       'Uñas',    10000, 21000, 14, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-009', 'Crema facial hidratante 50g',      'Rostro',  45000, 82000, 12, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-010', 'Sérum vitamina C 30ml',            'Rostro',  55000, 98000,  8, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-011', 'Protector solar FPS50 60ml',       'Rostro',  38000, 69000,  2, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-012', 'Aceite de masaje lavanda 250ml',   'Spa',     26000, 47000, 16, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-013', 'Sal de mar Epsom 1kg',             'Spa',     15000, 31000, 25, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-014', 'Velas aromáticas (pack x3)',       'Spa',     22000, 42000, 11, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-015', 'Tinta para cejas café',            'Rostro',  18000, 36000,  7, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-016', 'Papel aluminio color 100m',        'Cabello', 24000, 44000,  4, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-017', 'Guantes nitrilo caja x100',        'Insumos', 16000, 30000, 20, 6),
  ('11111111-1111-4111-8111-111111111111', 'VEL-018', 'Toallas microfibra (pack x6)',     'Insumos', 38000, 72000,  3, 6)
on conflict do nothing;

-- Fin del esquema VelloRa
