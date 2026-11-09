/* VelloRa ERP — API: crear usuarios desde Configuración → Usuarios.
   Solo servidor: usa SUPABASE_SERVICE_ROLE_KEY, que jamás llega al navegador.
   El solicitante debe tener sesión válida y ser owner o admin de la
   organización destino; el perfil Propietario solo puede asignarlo un owner.
   Crea o reutiliza el usuario de auth, actualiza public.profiles y vincula
   la membresía en organization_members con su perfil (y sucursal opcional). */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** profile role_key (organization_roles) → valor de organization_members.role (CHECK en inglés). */
const ROLE_BY_PROFILE: Record<string, string> = {
  owner: "owner",
  administracion: "admin",
  administrador: "admin",
  admin: "admin",
  cajero: "cashier",
  profesional: "professional",
  professional: "professional",
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Busca un usuario de auth por correo (hasta 25 páginas de 200). */
async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    /* FIX TS2339: algunas versiones de supabase-js resuelven el genérico de
       listUsers() como never[], y data.users deja de tener email.
       Se normaliza la respuesta a una lista mínima tipada a mano. */
    const users =
      ((data as unknown as { users?: Array<{ id: string; email?: string | null }> }).users) ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return bad(
      "Falta configurar SUPABASE_SERVICE_ROLE_KEY en .env. Agrégala y reinicia el servidor (Ctrl+C → npm run dev).",
      500
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /* 1 · Solicitante autenticado */
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return bad("Sesión no encontrada. Inicia sesión de nuevo.", 401);
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return bad("Sesión inválida o expirada.", 401);
  const requesterId = authData.user.id;

  /* 2 · Datos de la petición */
  let body: {
    organization_id?: string;
    email?: string;
    password?: string;
    full_name?: string;
    phone?: string | null;
    profile_id?: string;
    branch_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return bad("Petición inválida.");
  }

  const organizationId = (body.organization_id ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.full_name ?? "").trim();
  const phone = (body.phone ?? "").trim() || null;
  const profileId = (body.profile_id ?? "").trim();
  const branchId = (body.branch_id ?? "").trim() || null;

  if (!organizationId) return bad("Falta la organización.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("Correo inválido.");
  if (password.length < 8) return bad("La clave debe tener al menos 8 caracteres.");
  if (!profileId) return bad("Selecciona el perfil de acceso.");

  /* 3 · El solicitante debe ser owner o admin ACTIVO de esa organización */
  const { data: requesterMember } = await admin
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", requesterId)
    .eq("active", true)
    .maybeSingle();
  const requesterRole = (requesterMember as { role?: string } | null)?.role ?? "";
  if (!["owner", "admin"].includes(requesterRole)) {
    return bad("Solo el propietario o un administrador pueden crear usuarios.", 403);
  }

  /* 4 · El perfil debe existir, estar activo y pertenecer a la organización */
  const { data: profileRow } = await admin
    .from("organization_roles")
    .select("id, role_key, active")
    .eq("id", profileId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const profile = profileRow as { id: string; role_key: string; active: boolean } | null;
  if (!profile || !profile.active) return bad("El perfil seleccionado no existe o está inactivo.");

  const memberRole = ROLE_BY_PROFILE[String(profile.role_key).trim().toLowerCase()];
  if (!memberRole) return bad(`El perfil "${profile.role_key}" no es un perfil válido para usuarios.`);

  /* Crear otro PROPIETARIO: solo el owner puede hacerlo */
  if (memberRole === "owner" && requesterRole !== "owner") {
    return bad("Solo el Propietario puede crear otro usuario con perfil Propietario.", 403);
  }

  /* 5 · Crear el usuario de auth (o reutilizarlo si el correo ya existe) */
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null, phone },
  });
  let userId: string | null = created?.user?.id ?? null;

  if (!userId) {
    const msg = (createErr?.message ?? "").toLowerCase();
    const already = msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate");
    const existingId = already ? await findUserIdByEmail(admin, email) : null;
    if (!existingId) {
      return bad(`No se pudo crear el usuario: ${createErr?.message ?? "error desconocido"}`);
    }
    /* El correo ya estaba registrado: se vincula a la organización SIN tocar su clave. */
    userId = existingId;
  }

  /* 6 · Perfil público (nombre y teléfono) */
  const { error: profErr } = await admin
    .from("profiles")
    .upsert({ id: userId, full_name: fullName || null, phone }, { onConflict: "id" });
  if (profErr) return bad(`Usuario creado, pero no se pudo guardar el nombre: ${profErr.message}`);

  /* 7 · Vincular a la organización (o actualizar el vínculo si ya existía) */
  const { data: existingMember } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMember) {
    const { error: updErr } = await admin
      .from("organization_members")
      .update({ role: memberRole, profile_id: profileId, branch_id: branchId, active: true })
      .eq("id", (existingMember as { id: string }).id);
    if (updErr) return bad(`No se pudo actualizar el vínculo: ${updErr.message}`);
  } else {
    const { error: insErr } = await admin.from("organization_members").insert({
      organization_id: organizationId,
      user_id: userId,
      role: memberRole,
      profile_id: profileId,
      branch_id: branchId,
      active: true,
    });
    if (insErr) return bad(`Usuario creado, pero no se pudo vincular a la organización: ${insErr.message}`);
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email,
    profile_id: profileId,
    role: memberRole,
    linked: Boolean(existingMember),
  });
}
