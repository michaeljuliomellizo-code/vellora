"use client";

/* VelloRa ERP — Configuración: organización (editable), sucursales por plan,
   usuarios, perfiles y planes.
   Porta y corrige los módulos PerfilesClient y UsuariosClient del proyecto original,
   añade el sistema de planes (Esencial/Profesional/Elite) con validación de restricciones,
   y la v15: edición de los datos de la organización, gestión de sucursales con límite
   del plan (esencial=1 · profesional=3 · elite=ilimitadas) y creación de usuarios con
   correo, contraseña y perfil vía /api/vellora/usuarios (service-role en servidor). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Plus, ShieldCheck, Users as UsersIcon, CreditCard, Building2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type {
  MemberRow, Module, OrganizationContext, Plan, Role, RoleModulePermission, Branch,
} from "@/lib/vellora/types";
import { supabaseBrowser } from "@/lib/vellora/supabase";
import { formatCOP, formatDate, formatNumber, initialsOf } from "@/lib/vellora/format";
import { ALL_ACTIONS, ROLE_DESCRIPTIONS, planChecks, planAllowsNewProfessional, planAllowsNewBranch, resolvePlanLimits, PLAN_LIMITS } from "@/lib/vellora/permissions";
import { fetchEmployees, fetchAppointments, fetchCustomers } from "@/lib/vellora/queries";
import { planUsage } from "@/lib/vellora/queries";
import { PageHeader, EmptyState, Modal, Field } from "../ui-bits";

type Tab = "general" | "usuarios" | "perfiles" | "planes";

const ACTION_LABELS: Record<string, string> = {
  can_view: "Consultar",
  can_create: "Crear",
  can_update: "Editar",
  can_delete: "Eliminar",
};

const SUB_STATUS_LABELS: Record<string, string> = {
  active: "activa",
  trial: "en prueba",
  past_due: "en mora",
  cancelled: "cancelada",
  expired: "expirada",
};

export default function ConfiguracionView({ ctx }: { ctx: OrganizationContext }) {
  const [tab, setTab] = useState<Tab>("general");
  const roleKey = (ctx.role?.role_key ?? "") as string;

  /* ————— Usuarios ————— */
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userError, setUserError] = useState("");
  const [userNotice, setUserNotice] = useState("");
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [profileId, setProfileId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [active, setActive] = useState(true);
  const [savingUser, setSavingUser] = useState(false);

  /* ————— General: datos de la organización (editable, RPC v15) ————— */
  const [orgName, setOrgName] = useState(ctx.organization.name ?? "");
  const [orgLegal, setOrgLegal] = useState(ctx.organization.legal_name ?? "");
  const [orgTax, setOrgTax] = useState(ctx.organization.tax_id ?? "");
  const [orgPhone, setOrgPhone] = useState(ctx.organization.phone ?? "");
  const [orgEmail, setOrgEmail] = useState(ctx.organization.email ?? "");
  const [orgAddress, setOrgAddress] = useState(ctx.organization.address ?? "");
  const [orgCity, setOrgCity] = useState(ctx.organization.city ?? "");
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState("");
  const [orgNotice, setOrgNotice] = useState("");

  /* ————— General: sucursales con límite del plan (RPC v15) ————— */
  const [branchesAll, setBranchesAll] = useState<Branch[]>([]);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [bName, setBName] = useState("");
  const [bAddress, setBAddress] = useState("");
  const [bPhone, setBPhone] = useState("");
  const [bActive, setBActive] = useState(true);
  const [savingBranch, setSavingBranch] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [branchNotice, setBranchNotice] = useState("");

  /* ————— Crear usuario (POST /api/vellora/usuarios, service-role en el servidor) ————— */
  const [showCreate, setShowCreate] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [cuEmail, setCuEmail] = useState("");
  const [cuPassword, setCuPassword] = useState("");
  const [cuName, setCuName] = useState("");
  const [cuPhone, setCuPhone] = useState("");
  const [cuProfileId, setCuProfileId] = useState("");
  const [cuBranchId, setCuBranchId] = useState("");

  /* ————— Perfiles ————— */
  const [modules, setModules] = useState<Module[]>([]);
  const [permissions, setPermissions] = useState<RoleModulePermission[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [draft, setDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [savingRole, setSavingRole] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [roleNotice, setRoleNotice] = useState("");

  /* ————— Planes ————— */
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<{ professionals: number; branches: number; monthlyAppointments: number } | null>(null);
  const [planValidate, setPlanValidate] = useState<{ ok: boolean; label: string; detail: string }[]>([]);
  const [switchingPlan, setSwitchingPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");
  const [planNotice, setPlanNotice] = useState("");

  const loadAll = useCallback(async () => {
    const sb = supabaseBrowser();
    setLoadingUsers(true);
    try {
      const [mem, rol, brn, brnAll, mod, perm, pln] = await Promise.all([
        sb.rpc("vellora_list_members", { p_organization_id: ctx.organizationId }),
        sb.from("organization_roles").select("*").eq("organization_id", ctx.organizationId).order("name"),
        sb.rpc("vellora_list_member_branches", { p_organization_id: ctx.organizationId }),
        sb.rpc("vellora_list_branches", { p_organization_id: ctx.organizationId }),
        sb.from("vellora_modules").select("*").eq("active", true).order("name"),
        sb.from("role_module_permissions").select("*"),
        sb.from("vellora_plans").select("*").eq("active", true),
      ]);

      if (mem.error) setUserError(`Usuarios: ${mem.error.message}`);
      else setMembers(((mem.data ?? []) as unknown) as MemberRow[]);

      if (rol.error) setUserError(`Perfiles: ${rol.error.message}`);
      else setRoles(((rol.data ?? []) as unknown) as Role[]);

      if (!brn.error) setBranches(((brn.data ?? []) as unknown) as Branch[]);
      /* Sucursales para la pestaña General (activas e inactivas, RPC del v15).
         Si la RPC aún no existe (falta el SQL v15) se conserva ctx.branches. */
      if (!brnAll.error) setBranchesAll(((brnAll.data ?? []) as unknown) as Branch[]);

      if (!mod.error) setModules(((mod.data ?? []) as unknown) as Module[]);
      if (!perm.error) setPermissions(((perm.data ?? []) as unknown) as RoleModulePermission[]);
      if (!pln.error) setPlans(((pln.data ?? []) as unknown) as Plan[]);

      /* Uso del plan + validación (paso 9) */
      const [emps, appts, cus] = await Promise.all([
        fetchEmployees(ctx.organizationId),
        fetchAppointments(ctx.organizationId, 60, 12),
        fetchCustomers(ctx.organizationId),
      ]);
      const u = planUsage(emps, ctx.branches, appts);
      setUsage(u);

      const plan = ctx.subscription?.plan;
      const limits = resolvePlanLimits(plan);
      const checks = plan ? planChecks(limits, u) : [];
      const validations: { ok: boolean; label: string; detail: string }[] = checks.map((c) => ({
        ok: c.ok,
        label: c.label,
        detail: c.limit < 0
          ? `${formatNumber(c.used)} usados · sin límite en el plan`
          : `${formatNumber(c.used)} de ${formatNumber(c.limit)} · ${c.ok ? (c.warn ? "cerca del límite" : "dentro del límite") : "LÍMITE SUPERADO"}`,
      }));

      if (plan) {
        validations.push({
          ok: planAllowsNewProfessional(limits, u.professionals),
          label: "Alta de profesional",
          detail: planAllowsNewProfessional(limits, u.professionals)
            ? "Se permite crear profesionales con el plan actual."
            : `El plan ${plan.name} permite máximo ${limits.max_professionals} profesionales.`,
        });
        validations.push({
          ok: planAllowsNewBranch(limits, u.branches),
          label: "Alta de sucursal",
          detail: planAllowsNewBranch(limits, u.branches)
            ? "Se permite crear sucursales con el plan actual."
            : `El plan ${plan.name} permite máximo ${limits.max_branches} sucursales.`,
        });
        const featureGates: { key: string; label: string; allowedBy: string[] }[] = [
          { key: "inventario", label: "Inventario y compras", allowedBy: ["profesional", "elite"] },
          { key: "nomina", label: "Nómina y comisiones", allowedBy: ["profesional", "elite"] },
          { key: "marketing", label: "Fidelización y marketing", allowedBy: ["profesional", "elite"] },
          { key: "reportes", label: "Reportes avanzados", allowedBy: ["profesional", "elite"] },
        ];
        const planKey = plan.plan_key;
        for (const fg of featureGates) {
          validations.push({
            ok: fg.allowedBy.includes(planKey),
            label: fg.label,
            detail: fg.allowedBy.includes(planKey) ? "Incluido en el plan actual." : `Requiere plan Profesional o Elite.`,
          });
        }
      }
      setPlanValidate(validations);
      void cus;
    } finally {
      setLoadingUsers(false);
    }
  }, [ctx.organizationId, ctx.branches, ctx.subscription?.plan]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* ————— Planes: elegir / cambiar de plan —————
     organization_subscriptions.organization_id es UNIQUE: el upsert inserta
     la primera suscripción de la organización o actualiza el plan existente. */
  async function choosePlan(p: Plan) {
    setPlanError("");
    setPlanNotice("");
    setSwitchingPlan(p.id);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb
        .from("organization_subscriptions")
        .upsert(
          {
            organization_id: ctx.organizationId,
            plan_id: p.id,
            status: "active",
            starts_at: new Date().toISOString(),
            ends_at: null,
          },
          { onConflict: "organization_id" }
        );
      if (error) {
        setPlanError(`No se pudo cambiar el plan: ${error.message}`);
        return;
      }
      setPlanNotice(`Plan cambiado a ${p.name}. Actualizando…`);
      setTimeout(() => window.location.reload(), 600);
    } finally {
      setSwitchingPlan(null);
    }
  }

  /* ————— General: guardar datos de la organización (RPC del v15) ————— */
  async function saveOrganization() {
    if (!orgName.trim()) {
      setOrgError("El nombre de la organización es obligatorio.");
      return;
    }
    if (orgEmail.trim() && !/^\S+@\S+\.\S+$/.test(orgEmail.trim())) {
      setOrgError("El correo de la organización no tiene un formato válido.");
      return;
    }
    setSavingOrg(true);
    setOrgError("");
    setOrgNotice("");
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("vellora_update_organization", {
        p_organization_id: ctx.organizationId,
        p_name: orgName.trim(),
        p_legal_name: orgLegal.trim() || null,
        p_tax_id: orgTax.trim() || null,
        p_phone: orgPhone.trim() || null,
        p_email: orgEmail.trim() || null,
        p_address: orgAddress.trim() || null,
        p_city: orgCity.trim() || null,
      });
      if (error) {
        setOrgError(`No se pudieron guardar los datos: ${error.message}`);
        return;
      }
      setOrgNotice("Datos de la organización guardados. Actualizando pantalla…");
      setTimeout(() => window.location.reload(), 800);
    } finally {
      setSavingOrg(false);
    }
  }

  /* ————— General: sucursales (RPC del v15, límite del plan en el servidor) ————— */
  async function refreshBranches() {
    const sb = supabaseBrowser();
    const { data, error } = await sb.rpc("vellora_list_branches", { p_organization_id: ctx.organizationId });
    if (!error) setBranchesAll(((data ?? []) as unknown) as Branch[]);
  }

  function openBranchModal(b: Branch | null) {
    setEditingBranch(b);
    setBName(b?.name ?? "");
    setBAddress(b?.address ?? "");
    setBPhone(b?.phone ?? "");
    setBActive(b?.active ?? true);
    setBranchError("");
    setBranchNotice("");
    setShowBranchModal(true);
  }

  async function saveBranch() {
    if (!bName.trim()) {
      setBranchError("El nombre de la sucursal es obligatorio.");
      return;
    }
    setSavingBranch(true);
    setBranchError("");
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("vellora_save_branch", {
        p_organization_id: ctx.organizationId,
        p_branch_id: editingBranch?.id ?? null,
        p_name: bName.trim(),
        p_address: bAddress.trim() || null,
        p_phone: bPhone.trim() || null,
        p_active: editingBranch ? bActive : null,
      });
      if (error) {
        setBranchError(error.message);
        return;
      }
      setShowBranchModal(false);
      setBranchNotice(editingBranch ? "Sucursal actualizada." : `Sucursal "${bName.trim()}" creada.`);
      await refreshBranches();
    } finally {
      setSavingBranch(false);
    }
  }

  async function toggleBranchActive(b: Branch) {
    setBranchError("");
    setBranchNotice("");
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("vellora_set_branch_active", {
        p_organization_id: ctx.organizationId,
        p_branch_id: b.id,
        p_active: !b.active,
      });
      if (error) {
        setBranchError(error.message);
        return;
      }
      setBranchNotice(`Sucursal "${b.name}" ${b.active ? "desactivada" : "activada"}.`);
      await refreshBranches();
    } finally {
      setSavingBranch(false);
    }
  }

  /* ————— Usuarios: crear (usa la API de servidor con service-role) ————— */
  async function createUser() {
    if (!cuEmail.trim() || !cuPassword || !cuProfileId) {
      setUserError("Para crear el usuario completa correo, contraseña y perfil.");
      return;
    }
    if (cuPassword.length < 8) {
      setUserError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setCreatingUser(true);
    setUserError("");
    setUserNotice("");
    try {
      const sb = supabaseBrowser();
      const { data: ses } = await sb.auth.getSession();
      /* Tipado defensivo: el cliente demo devuelve una sesión reducida sin access_token. */
      const token =
        ((ses as unknown as { session?: { access_token?: string } | null })?.session?.access_token) ?? "";
      const res = await fetch("/api/vellora/usuarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          organization_id: ctx.organizationId,
          email: cuEmail.trim(),
          password: cuPassword,
          full_name: cuName.trim(),
          phone: cuPhone.trim() || null,
          profile_id: cuProfileId,
          branch_id: cuBranchId || null,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; linked?: boolean };
      if (!res.ok) {
        setUserError(out.error ?? `No fue posible crear el usuario (HTTP ${res.status}).`);
        return;
      }
      setUserNotice(
        out.linked
          ? "El correo ya existía: se vinculó a la organización con el perfil elegido (sin cambiar su clave)."
          : "Usuario creado y vinculado a la organización. Ya puede iniciar sesión con el correo y la contraseña definidos."
      );
      setShowCreate(false);
      setCuEmail(""); setCuPassword(""); setCuName(""); setCuPhone(""); setCuProfileId(""); setCuBranchId("");
      await loadAll();
    } catch (e) {
      setUserError(e instanceof Error ? e.message : "Error de red al crear el usuario.");
    } finally {
      setCreatingUser(false);
    }
  }

  /* ————— Perfiles: helpers ————— */
  function openNewRole() {
    setEditingRole(null);
    setRoleName("");
    setRoleDescription("");
    const initial: Record<string, Record<string, boolean>> = {};
    for (const m of modules) initial[m.id] = { can_view: false, can_create: false, can_update: false, can_delete: false };
    setDraft(initial);
    setRoleError("");
    setRoleNotice("");
    setShowEditor(true);
  }

  function openEditRole(role: Role) {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDescription(role.description ?? "");
    const initial: Record<string, Record<string, boolean>> = {};
    for (const m of modules) {
      const existing = permissions.find((p) => p.role_id === role.id && p.module_id === m.id);
      initial[m.id] = existing
        ? { can_view: existing.can_view, can_create: existing.can_create, can_update: existing.can_update, can_delete: existing.can_delete }
        : { can_view: false, can_create: false, can_update: false, can_delete: false };
    }
    setDraft(initial);
    setRoleError("");
    setRoleNotice("");
    setShowEditor(true);
  }

  function updatePerm(moduleId: string, action: string, checked: boolean) {
    setDraft((cur) => {
      const prev = cur[moduleId] ?? { can_view: false, can_create: false, can_update: false, can_delete: false };
      const next = { ...prev, [action]: checked };
      if (action !== "can_view" && checked) next.can_view = true;
      if (action === "can_view" && !checked) {
        next.can_create = false;
        next.can_update = false;
        next.can_delete = false;
      }
      return { ...cur, [moduleId]: next };
    });
  }

  async function saveRole() {
    if (!roleName.trim()) {
      setRoleError("Escribe el nombre del perfil.");
      return;
    }
    setSavingRole(true);
    setRoleError("");
    const sb = supabaseBrowser();
    let roleId = editingRole?.id;

    if (editingRole) {
      const { error: upErr } = await sb
        .from("organization_roles")
        .update({ name: roleName.trim(), description: roleDescription.trim() || null })
        .eq("id", editingRole.id)
        .eq("organization_id", ctx.organizationId);
      if (upErr) {
        setRoleError(`No fue posible actualizar el perfil: ${upErr.message}`);
        setSavingRole(false);
        return;
      }
    } else {
      const slug = roleName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
      const { data, error: insErr } = await sb
        .from("organization_roles")
        .insert({
          organization_id: ctx.organizationId,
          role_key: `${slug || "perfil"}_${Date.now().toString().slice(-5)}`,
          name: roleName.trim(),
          description: roleDescription.trim() || null,
          is_system: false,
          active: true,
        })
        .select("id")
        .single();
      if (insErr || !data) {
        setRoleError(`No fue posible crear el perfil: ${insErr?.message ?? "sin id"}`);
        setSavingRole(false);
        return;
      }
      roleId = (data as unknown as { id: string }).id;
    }

    const rows = modules.map((m) => ({
      role_id: roleId,
      module_id: m.id,
      can_view: draft[m.id]?.can_view ?? false,
      can_create: draft[m.id]?.can_create ?? false,
      can_update: draft[m.id]?.can_update ?? false,
      can_delete: draft[m.id]?.can_delete ?? false,
    }));
    const { error: permErr } = await sb.from("role_module_permissions").upsert(rows, { onConflict: "role_id,module_id" });
    setSavingRole(false);
    if (permErr) {
      setRoleError(`Perfil guardado, pero falló la matriz de permisos: ${permErr.message}`);
      await loadAll();
      return;
    }
    setShowEditor(false);
    setRoleNotice(editingRole ? "Perfil y permisos actualizados." : "Perfil creado con su matriz de permisos.");
    await loadAll();
  }

  /* ————— Usuarios: guardar ————— */
  async function saveMember() {
    if (!selected) return;
    if (!profileId) {
      setUserError("Selecciona un perfil para el usuario.");
      return;
    }
    setSavingUser(true);
    setUserError("");
    const sb = supabaseBrowser();
    const { error: rpcErr } = await sb.rpc("vellora_update_member_access", {
      p_organization_id: ctx.organizationId,
      p_member_id: selected.member_id,
      p_profile_id: profileId,
      p_branch_id: branchId || null,
      p_active: active,
    });
    setSavingUser(false);
    if (rpcErr) {
      setUserError(`No se pudieron guardar los cambios: ${rpcErr.message}`);
      return;
    }
    setUserNotice("Los permisos y el acceso del usuario se actualizaron.");
    setSelected(null);
    await loadAll();
  }

  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "general", label: "General", icon: Building2 },
    { key: "usuarios", label: "Usuarios", icon: UsersIcon },
    { key: "perfiles", label: "Perfiles y permisos", icon: ShieldCheck },
    { key: "planes", label: "Plan y suscripción", icon: CreditCard },
  ];

  const adminOnly = roleKey === "owner" || roleKey === "administracion";

  /* ————— General: derivados de sucursales y plan ————— */
  const branchList = branchesAll.length ? branchesAll : ctx.branches;
  const planName = ctx.subscription?.plan?.name ?? "actual";
  const maxBranches = resolvePlanLimits(ctx.subscription?.plan).max_branches;
  const activeBranches = branchList.filter((b) => b.active).length;
  const canAddBranch = maxBranches < 0 || activeBranches < maxBranches;

  return (
    <div className="vr-stack">
      <PageHeader
        eyebrow="Administración"
        title="Configuración"
        subtitle="Organización, usuarios, perfiles con matriz de permisos y planes de suscripción."
        actions={
          <button className="vr-btn-secondary" onClick={() => void loadAll()} disabled={loadingUsers}>
            {loadingUsers ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
        }
      />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Secciones de configuración">
        {tabs.map((t) => {
          const Icon = t.icon;
          const activeTab = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab}
              className={activeTab ? "vr-btn vr-btn-sm" : "vr-btn-secondary vr-btn-sm"}
              onClick={() => setTab(t.key)}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ————— GENERAL ————— */}
      {tab === "general" && (
        <>
          {orgError && <div className="vr-alert vr-alert-critical"><span>{orgError}</span></div>}
          {orgNotice && !orgError && <div className="vr-alert vr-alert-info"><span>{orgNotice}</span></div>}
          {branchError && <div className="vr-alert vr-alert-critical"><span>{branchError}</span></div>}
          {branchNotice && !branchError && <div className="vr-alert vr-alert-info"><span>{branchNotice}</span></div>}

          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Datos de la organización</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  {adminOnly
                    ? "Edita la información de tu negocio y guárdala con un clic."
                    : "Solo el Propietario o Administración pueden editar estos datos."}
                </p>
              </div>
            </div>

            {adminOnly ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 13, marginBottom: 14 }}>
                  <Field label="Nombre *">
                    <input value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={120} placeholder="Ej. Salón Michael" />
                  </Field>
                  <Field label="Razón social">
                    <input value={orgLegal} onChange={(e) => setOrgLegal(e.target.value)} maxLength={160} placeholder="Ej. Salón Michael S.A.S." />
                  </Field>
                  <Field label="NIT">
                    <input value={orgTax} onChange={(e) => setOrgTax(e.target.value)} maxLength={40} placeholder="Ej. 900123456-1" />
                  </Field>
                  <Field label="Teléfono">
                    <input value={orgPhone} onChange={(e) => setOrgPhone(e.target.value)} maxLength={40} placeholder="Ej. 300 123 4567" />
                  </Field>
                  <Field label="Correo">
                    <input value={orgEmail} onChange={(e) => setOrgEmail(e.target.value)} type="email" maxLength={120} placeholder="Ej. contacto@minegocio.co" />
                  </Field>
                  <Field label="Ciudad">
                    <input value={orgCity} onChange={(e) => setOrgCity(e.target.value)} maxLength={80} placeholder="Ej. Bogotá" />
                  </Field>
                  <Field label="Dirección">
                    <input value={orgAddress} onChange={(e) => setOrgAddress(e.target.value)} maxLength={200} placeholder="Ej. Cra 7 #45-67" />
                  </Field>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span className="vr-muted" style={{ fontSize: 11 }}>
                    Moneda {ctx.organization.currency ?? "COP"} · Zona horaria {ctx.organization.timezone ?? "America/Bogota"} · Creada {formatDate(ctx.organization.created_at)}
                  </span>
                  <button className="vr-btn" onClick={() => void saveOrganization()} disabled={savingOrg}>
                    {savingOrg ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Guardar cambios
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
                {[
                  ["Nombre", ctx.organization.name],
                  ["Razón social", ctx.organization.legal_name ?? "—"],
                  ["NIT", ctx.organization.tax_id ?? "—"],
                  ["Ciudad", ctx.organization.city ?? "—"],
                  ["Moneda", ctx.organization.currency ?? "COP"],
                  ["Zona horaria", ctx.organization.timezone ?? "America/Bogota"],
                  ["Creada", formatDate(ctx.organization.created_at)],
                ].map(([k, v]) => (
                  <div key={k} style={{ padding: 12, background: "#fbfaff", borderRadius: 11 }}>
                    <div style={{ fontSize: 10, color: "#9a96a9", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>{k}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Sucursales</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  {maxBranches < 0
                    ? `${activeBranches} activa(s) · sin límite de sucursales${ctx.subscription?.plan ? ` (plan ${planName})` : ""}.`
                    : `${activeBranches} de ${maxBranches} sucursal(es) activa(s) · plan ${planName}.`}
                </p>
              </div>
              {adminOnly && (
                <button
                  className="vr-btn vr-btn-sm"
                  disabled={!canAddBranch}
                  title={canAddBranch ? undefined : "Límite de sucursales del plan alcanzado"}
                  onClick={() => openBranchModal(null)}
                >
                  <Plus size={13} /> Agregar sucursal
                </button>
              )}
            </div>

            {!canAddBranch && (
              <div className="vr-alert vr-alert-info" style={{ marginBottom: 12 }}>
                <AlertTriangle size={15} />
                <span>Límite del plan alcanzado: {maxBranches} sucursal(es) activa(s). Desactiva una de la lista o cambia al plan Elite (sucursales ilimitadas) para agregar más.</span>
              </div>
            )}

            {branchList.length === 0 ? (
              <EmptyState title="Sin sucursales" body="Agrega la primera sucursal de tu negocio." />
            ) : (
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead>
                    <tr><th>Sucursal</th><th>Dirección</th><th>Teléfono</th><th>Estado</th>{adminOnly && <th>Acciones</th>}</tr>
                  </thead>
                  <tbody>
                    {branchList.map((b) => (
                      <tr key={b.id}>
                        <td><strong>{b.name}</strong></td>
                        <td>{b.address ?? "—"}</td>
                        <td>{b.phone ?? "—"}</td>
                        <td><span className={`vr-pill ${b.active ? "vr-pill-green" : "vr-pill-gray"}`}>{b.active ? "Activa" : "Inactiva"}</span></td>
                        {adminOnly && (
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="vr-btn-secondary vr-btn-sm" onClick={() => openBranchModal(b)}>Editar</button>
                              <button className="vr-btn-danger vr-btn-sm" onClick={() => void toggleBranchActive(b)}>
                                {b.active ? "Desactivar" : "Activar"}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ————— USUARIOS ————— */}
      {tab === "usuarios" && (
        <>
          {userError && <div className="vr-alert vr-alert-critical"><span>{userError}</span></div>}
          {userNotice && !userError && <div className="vr-alert vr-alert-info"><span>{userNotice}</span></div>}

          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Equipo de la organización</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  Usuarios vinculados con su perfil, sucursal y estado. Crea accesos nuevos con correo y contraseña.
                </p>
              </div>
              {adminOnly && (
                <button
                  className="vr-btn vr-btn-sm"
                  onClick={() => {
                    setShowCreate(true);
                    setUserError("");
                    setUserNotice("");
                  }}
                >
                  <Plus size={13} /> Crear usuario
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14, marginBottom: 18 }}>
              <div>
                <div className="vr-muted" style={{ fontSize: 11 }}>Usuarios registrados</div>
                <h2 style={{ margin: "6px 0 0" }}>{members.length}</h2>
              </div>
              <div>
                <div className="vr-muted" style={{ fontSize: 11 }}>Usuarios activos</div>
                <h2 style={{ margin: "6px 0 0" }}>{members.filter((m) => m.active).length}</h2>
              </div>
              <div>
                <div className="vr-muted" style={{ fontSize: 11 }}>Perfiles disponibles</div>
                <h2 style={{ margin: "6px 0 0" }}>{roles.filter((r) => r.active).length}</h2>
              </div>
            </div>

            {loadingUsers ? (
              <EmptyState title="Cargando usuarios…" body=" " />
            ) : members.length === 0 ? (
              <EmptyState title="Sin usuarios" body="No hay usuarios vinculados a esta organización." />
            ) : (
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Perfil</th>
                      <th>Sucursal</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const owner = m.profile_key === "owner";
                      return (
                        <tr key={m.member_id}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                              <span className="vr-avatar" style={{ width: 30, height: 30, fontSize: 10, borderRadius: 9 }}>{initialsOf(m.full_name)}</span>
                              <span>
                                <strong>{m.full_name || "Usuario sin nombre"}</strong>
                                <br />
                                <span className="vr-muted" style={{ fontSize: 10.5 }}>{m.email || m.user_id}</span>
                              </span>
                            </div>
                          </td>
                          <td>{m.profile_name || m.role || "Sin perfil"}</td>
                          <td>{m.branch_name || "Sin sucursal"}</td>
                          <td>
                            <span className={`vr-pill ${m.active ? "vr-pill-green" : "vr-pill-red"}`}>{m.active ? "Activo" : "Inactivo"}</span>
                          </td>
                          <td>
                            {owner ? (
                              <span className="vr-muted" style={{ fontSize: 11 }}>Protegido</span>
                            ) : adminOnly ? (
                              <button
                                className="vr-btn-secondary vr-btn-sm"
                                onClick={() => {
                                  setSelected(m);
                                  setProfileId(m.profile_id ?? "");
                                  setBranchId(m.branch_id ?? "");
                                  setActive(m.active);
                                  setUserError("");
                                  setUserNotice("");
                                }}
                              >
                                Administrar
                              </button>
                            ) : (
                              <span className="vr-muted" style={{ fontSize: 11 }}>Requiere Administración</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selected && (
            <section className="vr-card">
              <h2>Editar acceso · {selected.full_name}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 13, marginBottom: 16 }}>
                <Field label="Perfil de acceso">
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                    <option value="">Seleccionar perfil</option>
                    {roles.filter((r) => r.active && r.role_key !== "owner").map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Sucursal">
                  <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">Sin sucursal asignada</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Estado del acceso">
                  <select value={active ? "active" : "inactive"} onChange={(e) => setActive(e.target.value === "active")}>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </Field>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="vr-btn-secondary" onClick={() => setSelected(null)} disabled={savingUser}>Cancelar</button>
                <button className="vr-btn" onClick={() => void saveMember()} disabled={savingUser}>
                  {savingUser ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Guardar cambios
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {/* ————— PERFILES ————— */}
      {tab === "perfiles" && (
        <>
          {roleError && <div className="vr-alert vr-alert-critical"><span>{roleError}</span></div>}
          {roleNotice && !roleError && <div className="vr-alert vr-alert-info"><span>{roleNotice}</span></div>}

          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Perfiles de acceso</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  {roles.length} perfiles registrados. El perfil Propietario está protegido; los perfiles del sistema no se pueden eliminar.
                </p>
              </div>
              {adminOnly && (
                <button className="vr-btn vr-btn-sm" onClick={openNewRole}>
                  <Plus size={13} /> Crear perfil
                </button>
              )}
            </div>

            {loadingUsers ? (
              <EmptyState title="Cargando perfiles…" body=" " />
            ) : (
              <div className="vr-table-wrap">
                <table className="vr-table">
                  <thead>
                    <tr>
                      <th>Perfil</th>
                      <th>Clave</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => {
                      const protectedRole = r.role_key === "owner";
                      return (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name}</strong>
                            {r.description && <><br /><span className="vr-muted" style={{ fontSize: 10.5 }}>{r.description}</span></>}
                          </td>
                          <td className="vr-muted">{r.role_key}</td>
                          <td>{r.is_system ? "Sistema" : "Personalizado"}</td>
                          <td>
                            <span className={`vr-pill ${r.active ? "vr-pill-green" : "vr-pill-red"}`}>{r.active ? "Activo" : "Inactivo"}</span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="vr-btn-secondary vr-btn-sm" onClick={() => openEditRole(r)}>
                                {protectedRole ? "Ver permisos" : "Editar"}
                              </button>
                              {!protectedRole && adminOnly && (
                                <button
                                  className="vr-btn-danger vr-btn-sm"
                                  onClick={async () => {
                                    const sb = supabaseBrowser();
                                    if (r.is_system) {
                                      const { error: upErr } = await sb.from("organization_roles").update({ active: !r.active }).eq("id", r.id);
                                      if (upErr) setRoleError(upErr.message);
                                      else setRoleNotice(`Perfil ${r.active ? "desactivado" : "activado"}.`);
                                      await loadAll();
                                    }
                                  }}
                                >
                                  {r.active ? "Desactivar" : "Activar"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="vr-card">
            <h2>Descripción de los perfiles del sistema</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
              {(["owner", "administracion", "cajero", "profesional"] as const).map((rk) => (
                <div key={rk} style={{ padding: 13, border: "1px solid var(--bp-border)", borderRadius: 12 }}>
                  <div style={{ fontWeight: 800, font: "800 13px Manrope,sans-serif", textTransform: "capitalize" }}>
                    {rk === "owner" ? "Propietario (owner)" : rk}
                  </div>
                  <p style={{ fontSize: 11.5, margin: "5px 0 0" }}>{ROLE_DESCRIPTIONS[rk]}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ————— PLANES ————— */}
      {tab === "planes" && (
        <>
          {planError && (
            <div className="vr-alert vr-alert-warning">
              <AlertTriangle size={15} />
              <span>{planError}</span>
            </div>
          )}
          {planNotice && (
            <div className="vr-alert vr-alert-info">
              <CheckCircle2 size={15} />
              <span>{planNotice}</span>
            </div>
          )}
          {plans.length === 0 && (
            <EmptyState
              title="No hay planes cargados"
              body="La tabla vellora_plans está vacía (o RLS la bloquea). Ejecuta el script vellora-sql-v12-planes-suscripciones.sql en Supabase → SQL Editor y recarga esta pantalla."
            />
          )}
          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Plan actual · {ctx.subscription?.plan.name ?? "—"}</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  {ctx.subscription ? `Suscripción ${SUB_STATUS_LABELS[ctx.subscription.status] ?? ctx.subscription.status} hasta ${formatDate(ctx.subscription.current_period_end)}` : "Sin suscripción activa"}
                </p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 13 }}>
              {(usage
                ? [
                    ["Profesionales activos", `${usage.professionals}${resolvePlanLimits(ctx.subscription?.plan).max_professionals > 0 ? ` / ${resolvePlanLimits(ctx.subscription?.plan).max_professionals}` : " / ∞"}`],
                    ["Sucursales", `${usage.branches}${resolvePlanLimits(ctx.subscription?.plan).max_branches > 0 ? ` / ${resolvePlanLimits(ctx.subscription?.plan).max_branches}` : " / ∞"}`],
                    ["Citas este mes", `${formatNumber(usage.monthlyAppointments)}${resolvePlanLimits(ctx.subscription?.plan).max_monthly_appointments > 0 ? ` / ${formatNumber(resolvePlanLimits(ctx.subscription?.plan).max_monthly_appointments)}` : " / ∞"}`],
                  ]
                : [["Uso del plan", "—"]]
              ).map(([k, v]) => (
                <div key={k} style={{ padding: 13, background: "#fbfaff", borderRadius: 11 }}>
                  <div style={{ fontSize: 10, color: "#9a96a9", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>{k}</div>
                  <div style={{ font: "800 19px Manrope,sans-serif", marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
            {plans.map((p) => {
              const isCurrent = ctx.subscription?.plan.id === p.id;
              return (
                <section key={p.id} className="vr-card" style={{ borderColor: isCurrent ? "#7556d8" : undefined, boxShadow: isCurrent ? "0 10px 34px #7556d82e" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h2 style={{ marginBottom: 0 }}>{p.name}</h2>
                    {isCurrent && <span className="vr-pill">Plan actual</span>}
                  </div>
                  <p style={{ fontSize: 12, margin: "0 0 12px" }}>{p.description}</p>
                  <div style={{ font: "800 24px Manrope,sans-serif", marginBottom: 2 }}>
                    {p.price_monthly > 0 ? formatCOP(p.price_monthly) : "A convenir"}
                    <span style={{ fontSize: 12, color: "#9a96a9", fontWeight: 500 }}> /mes</span>
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", display: "grid", gap: 7 }}>
                    {(PLAN_LIMITS[String(p.plan_key)]?.features ?? PLAN_LIMITS.elite.features).map((f) => (
                      <li key={f} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                        <CheckCircle2 size={13} color="#239b72" style={{ flexShrink: 0 }} /> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="vr-btn vr-btn-sm"
                    style={{ width: "100%" }}
                    disabled={isCurrent || switchingPlan === p.id}
                    onClick={() => void choosePlan(p)}
                  >
                    {switchingPlan === p.id ? "Cambiando…" : isCurrent ? "Plan actual" : "Elegir este plan"}
                  </button>
                </section>
              );
            })}
          </div>

          <section className="vr-card">
            <div className="vr-section-head">
              <div>
                <h2 style={{ marginBottom: 4 }}>Validación de los tres planes y sus restricciones (paso 9)</h2>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  Comprobación en vivo de los límites y características frente al uso real de la organización.
                </p>
              </div>
            </div>
            <div className="vr-table-wrap">
              <table className="vr-table">
                <thead>
                  <tr><th>Restricción</th><th>Estado</th><th>Detalle</th></tr>
                </thead>
                <tbody>
                  {planValidate.map((v) => (
                    <tr key={v.label}>
                      <td><strong>{v.label}</strong></td>
                      <td>
                        {v.ok ? (
                          <span className="vr-pill vr-pill-green"><CheckCircle2 size={11} /> Cumple</span>
                        ) : (
                          <span className="vr-pill vr-pill-red"><XCircle size={11} /> Bloqueado</span>
                        )}
                      </td>
                      <td>{v.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {planValidate.some((v) => !v.ok) && (
              <div className="vr-alert vr-alert-warning" style={{ marginTop: 14 }}>
                <AlertTriangle size={15} />
                <span>Hay restricciones bloqueadas. Alcanza el siguiente plan para desbloquearlas.</span>
              </div>
            )}
          </section>
        </>
      )}

      {/* ————— Crear usuario (modal) ————— */}
      <Modal open={showCreate} title="Crear usuario" onClose={() => !creatingUser && setShowCreate(false)} width={560}>
        <p style={{ fontSize: 12.5, margin: "0 0 14px" }}>
          Se crea (o reutiliza, si el correo ya existe) el usuario de acceso y se vincula a esta
          organización con el perfil elegido. La contraseña debe tener al menos 8 caracteres.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 13, marginBottom: 14 }}>
          <Field label="Nombre completo">
            <input value={cuName} onChange={(e) => setCuName(e.target.value)} placeholder="Ej. Laura Gómez" maxLength={80} />
          </Field>
          <Field label="Teléfono (opcional)">
            <input value={cuPhone} onChange={(e) => setCuPhone(e.target.value)} placeholder="300 123 4567" maxLength={30} />
          </Field>
          <Field label="Correo *">
            <input value={cuEmail} onChange={(e) => setCuEmail(e.target.value)} type="email" placeholder="usuario@correo.com" required />
          </Field>
          <Field label="Contraseña *">
            <input value={cuPassword} onChange={(e) => setCuPassword(e.target.value)} type="password" placeholder="Mínimo 8 caracteres" required />
          </Field>
          <Field label="Perfil de acceso *">
            <select value={cuProfileId} onChange={(e) => setCuProfileId(e.target.value)}>
              <option value="">Seleccionar perfil</option>
              {roles.filter((r) => r.active && r.role_key !== "owner").map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Sucursal (opcional)">
            <select value={cuBranchId} onChange={(e) => setCuBranchId(e.target.value)}>
              <option value="">Sin sucursal asignada</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowCreate(false)} disabled={creatingUser}>Cancelar</button>
          <button className="vr-btn" onClick={() => void createUser()} disabled={creatingUser}>
            {creatingUser ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creatingUser ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </Modal>

      {/* ————— Sucursal (modal crear/editar) ————— */}
      <Modal
        open={showBranchModal}
        title={editingBranch ? `Editar sucursal · ${editingBranch.name}` : "Agregar sucursal"}
        onClose={() => !savingBranch && setShowBranchModal(false)}
        width={520}
      >
        <p style={{ fontSize: 12.5, margin: "0 0 14px" }}>
          {maxBranches < 0
            ? `Plan ${planName}: sucursales ilimitadas.`
            : `Plan ${planName}: ${activeBranches} de ${maxBranches} sucursal(es) activa(s) en uso.`}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 13, marginBottom: 14 }}>
          <Field label="Nombre *">
            <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Ej. Sede Norte" maxLength={80} />
          </Field>
          <Field label="Teléfono">
            <input value={bPhone} onChange={(e) => setBPhone(e.target.value)} placeholder="300 123 4567" maxLength={30} />
          </Field>
          <Field label="Dirección">
            <input value={bAddress} onChange={(e) => setBAddress(e.target.value)} placeholder="Cra 7 #45-67" maxLength={160} />
          </Field>
          {editingBranch && (
            <Field label="Estado">
              <select value={bActive ? "active" : "inactive"} onChange={(e) => setBActive(e.target.value === "active")}>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </Field>
          )}
        </div>
        {branchError && (
          <div className="vr-alert vr-alert-critical" style={{ marginBottom: 10 }}><span>{branchError}</span></div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="vr-btn-secondary" onClick={() => setShowBranchModal(false)} disabled={savingBranch}>Cancelar</button>
          <button className="vr-btn" onClick={() => void saveBranch()} disabled={savingBranch}>
            {savingBranch ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {savingBranch ? "Guardando…" : editingBranch ? "Guardar cambios" : "Agregar sucursal"}
          </button>
        </div>
      </Modal>

      {/* ————— Editor de perfil (modal) ————— */}
      <Modal open={showEditor} title={editingRole ? `Editar perfil · ${editingRole.name}` : "Crear perfil"} onClose={() => setShowEditor(false)} width={640}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 13, marginBottom: 18 }}>
          <Field label="Nombre del perfil">
            <input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="Ej. Coordinador"
              maxLength={60}
              disabled={editingRole?.role_key === "owner"}
            />
          </Field>
          <Field label="Descripción">
            <input
              value={roleDescription}
              onChange={(e) => setRoleDescription(e.target.value)}
              placeholder="Responsabilidades"
              maxLength={180}
              disabled={editingRole?.role_key === "owner"}
            />
          </Field>
        </div>

        <h3 style={{ fontSize: 14 }}>Matriz de permisos por módulo</h3>
        <p style={{ fontSize: 11.5, margin: "0 0 10px" }}>
          Al activar crear, editar o eliminar se habilita automáticamente consultar.
        </p>
        <div className="vr-table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="vr-table">
            <thead>
              <tr>
                <th>Módulo</th>
                {ALL_ACTIONS.map((a) => (
                  <th key={a} style={{ textAlign: "center" }}>{ACTION_LABELS[a]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => {
                const values = draft[m.id] ?? { can_view: false, can_create: false, can_update: false, can_delete: false };
                const locked = editingRole?.role_key === "owner";
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      {m.description && <><br /><span className="vr-muted" style={{ fontSize: 10.5 }}>{m.description}</span></>}
                    </td>
                    {ALL_ACTIONS.map((a) => (
                      <td key={a} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={values[a]}
                          disabled={locked}
                          aria-label={`${m.name}: ${ACTION_LABELS[a]}`}
                          onChange={(e) => updatePerm(m.id, a, e.target.checked)}
                          style={{ width: 16, height: 16 }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editingRole?.role_key === "owner" && (
          <div className="vr-alert vr-alert-info" style={{ marginTop: 12 }}>
            <span>El perfil Propietario siempre conserva el acceso total y no puede modificarse.</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className="vr-btn-secondary" onClick={() => setShowEditor(false)} disabled={savingRole}>Cancelar</button>
          <button className="vr-btn" onClick={() => void saveRole()} disabled={savingRole || editingRole?.role_key === "owner"}>
            {savingRole ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Guardar perfil y permisos
          </button>
        </div>
      </Modal>
    </div>
  );
}
