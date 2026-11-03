/* VelloRa ERP — Contexto de organización del usuario autenticado.
   Espejo de @/lib/organization del proyecto original, corregido y tipado. */

import { supabaseBrowser } from "./supabase";
import type {
  AppUser, Branch, Module, Organization, OrganizationContext, OrganizationSubscription,
  PermissionAction, Plan, Role, RoleModulePermission,
} from "./types";

/**
 * Construye la matriz de permisos del rol indexada por module_key
 * (dashboard, agenda, caja...) usando la tabla vellora_modules para
 * traducir module_id → module_key. Funciona igual en modo demo y Supabase real.
 */
function permMatrix(
  roleId: string,
  rows: RoleModulePermission[],
  modules: Module[]
): Record<string, Record<PermissionAction, boolean>> {
  const keyById = new Map(modules.map((m) => [m.id, String(m.module_key)]));
  const out: Record<string, Record<PermissionAction, boolean>> = {};
  for (const r of rows) {
    if (r.role_id !== roleId) continue;
    const key = keyById.get(r.module_id) ?? String(r.module_id);
    out[key] = {
      can_view: r.can_view,
      can_create: r.can_create,
      can_update: r.can_update,
      can_delete: r.can_delete,
    };
  }
  return out;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getUser();
  return (data?.user as unknown as AppUser) ?? null;
}

export async function getOrganizationContext(): Promise<OrganizationContext | null> {
  const sb = supabaseBrowser();
  const user = await getCurrentUser();
  if (!user) return null;

  /* Membresía activa */
  const { data: member, error: memberError } = await sb
    .from("organization_members")
    .select("id, organization_id, profile_id, branch_id, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (memberError || !member) return null;

  const organizationId = (member as { organization_id: string }).organization_id;

  const [orgRes, branchesRes, roleRes, permsRes, modsRes, subRes] = await Promise.all([
    sb.from("organizations").select("*").eq("id", organizationId).maybeSingle(),
    sb.from("branches").select("*").eq("organization_id", organizationId).eq("active", true).order("name"),
    sb.from("organization_roles").select("*").eq("id", (member as { profile_id: string | null }).profile_id ?? "none").maybeSingle(),
    sb.from("role_module_permissions").select("*"),
    sb.from("vellora_modules").select("*").eq("active", true),
    sb
      .from("organization_subscriptions")
      .select("*, plan:vellora_plans(*)")
      .eq("organization_id", organizationId)
      .in("status", ["active", "trial"])
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const organization = (orgRes.data as unknown as Organization) ?? null;
  if (!organization) return null;

  const role = (roleRes.data as unknown as Role) ?? null;
  const modules = ((modsRes.data ?? []) as unknown) as Module[];
  const permissions = permMatrix(role?.id ?? "none", (permsRes.data ?? []) as unknown as RoleModulePermission[], modules);

  /* Plan embebido (Supabase real) o resuelto por plan_id (modo demo) */
  const subRow = (subRes.data as unknown as { plan?: Plan | Plan[]; plan_id: string; status: string; ends_at: string | null } | null);
  let plan: Plan | undefined = Array.isArray(subRow?.plan) ? subRow?.plan[0] : subRow?.plan;
  if (!plan && subRow?.plan_id) {
    const { data: planRow } = await sb.from("vellora_plans").select("*").eq("id", subRow.plan_id).maybeSingle();
    plan = (planRow as unknown as Plan) ?? undefined;
  }

  return {
    organizationId,
    organization,
    branches: ((branchesRes.data ?? []) as unknown) as Branch[],
    user,
    member: {
      id: (member as { id: string }).id,
      profile_id: (member as { profile_id: string | null }).profile_id,
      branch_id: (member as { branch_id: string | null }).branch_id,
      active: (member as { active: boolean }).active,
    },
    role,
    permissions,
    subscription: plan
      ? { plan, status: subRow?.status ?? "active", current_period_end: subRow?.ends_at ?? "" }
      : null,
  };
}

/* ————— Suscripción (plan) ————— */
export async function getOrganizationSubscription(organizationId: string) {
  const sb = supabaseBrowser();
  const { data } = await sb
    .from("organization_subscriptions")
    .select("*, plan:vellora_plans(*)")
    .eq("organization_id", organizationId)
    .in("status", ["active", "trial"])
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = (data as unknown as { plan: Plan | Plan[]; status: string; ends_at: string | null } | null);
  const plan = Array.isArray(raw?.plan) ? raw?.plan[0] : raw?.plan;
  if (!plan) return null;
  return { plan, status: raw?.status ?? "active", current_period_end: raw?.ends_at ?? "" } as unknown as OrganizationSubscription & { plan: Plan };
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const sb = supabaseBrowser();
  const { data } = await sb.from("vellora_plans").select("*").eq("id", planId).maybeSingle();
  return (data as unknown as Plan) ?? null;
}