/* VelloRa ERP — Cliente Supabase en modo demo.
   Implementa el subconjunto de la API de supabase-js que usa la app
   (from/select/eq/…/insert/update/delete/upsert/rpc + auth) sobre datos en memoria.
   Cuando existen NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY la app
   usa el cliente real (ver supabase.ts) y este archivo queda sin efecto. */

import { buildDemoDb, DEMO_PASSWORD, type DemoDb } from "./demo-data";
import type { AppUser, MemberRow } from "./types";

type Filter = { col: string; op: string; val: unknown };

class DemoError extends Error {}

function matches(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq": return v === f.val;
    case "neq": return v !== f.val;
    case "in": return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
    case "gt": return (v as number) > (f.val as number);
    case "gte": return (v as number) >= (f.val as number);
    case "lt": return (v as number) < (f.val as number);
    case "lte": return (v as number) <= (f.val as number);
    case "like":
    case "ilike": {
      const pattern = String(f.val).replace(/%/g, ".*").replace(/_/g, ".");
      return new RegExp(pattern, f.op === "ilike" ? "i" : "").test(String(v ?? ""));
    }
    case "is": return f.val === null ? v === null || v === undefined : v === f.val;
    default: return true;
  }
}

/* Resultado estilo PostgREST */
export type DbResult<T> = { data: T | null; error: { message: string; code?: string } | null };

let dbInstance: DemoDb | null = null;
export function demoDb(): DemoDb {
  if (!dbInstance) dbInstance = buildDemoDb();
  return dbInstance;
}
export function resetDemoDb(): DemoDb {
  dbInstance = buildDemoDb();
  return dbInstance;
}

/* Sesión demo persistida en localStorage */
const SESSION_KEY = "vellora_demo_session";
let currentUser: AppUser | null = null;

function loadSession(): AppUser | null {
  if (currentUser) return currentUser;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppUser;
        const db = demoDb();
        currentUser = db.users.find((u) => u.id === parsed.id) ?? null;
      }
    } catch {
      currentUser = null;
    }
  }
  return currentUser;
}
function saveSession(user: AppUser | null) {
  currentUser = user;
  if (typeof window !== "undefined") {
    if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(SESSION_KEY);
  }
}
export function demoCurrentUser(): AppUser | null {
  return loadSession();
}

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

/* ————— Query builder thenable ————— */
class DemoQuery<T extends Record<string, unknown>> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  constructor(private table: string) {}

  private rows(): Record<string, unknown>[] {
    return (demoDb() as unknown as Record<string, Record<string, unknown>[]>)[this.table] ?? [];
  }

  select(_cols?: string) { return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: unknown) { this.filters.push({ col, op: "gt", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: unknown) { this.filters.push({ col, op: "lt", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "lte", val }); return this; }
  like(col: string, val: string) { this.filters.push({ col, op: "like", val }); return this; }
  ilike(col: string, val: string) { this.filters.push({ col, op: "ilike", val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: "is", val }); return this; }
  in(col: string, vals: unknown[]) { this.filters.push({ col, op: "in", val: vals }); return this; }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number) { this.limitCount = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }

  private execute(): T[] {
    let rows = this.rows().filter((r) => this.filters.every((f) => matches(r, f)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderCol as string], bv = b[this.orderCol as string];
        const cmp = av === bv ? 0 : (av ?? "") > (bv ?? "") ? 1 : -1;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    } else if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }
    return rows as T[];
  }

  /* thenable: await query → { data, error } */
  then<TResult1 = DbResult<T[]>, TResult2 = never>(
    resolve?: ((value: DbResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const p = new Promise<DbResult<T[]>>((res) => {
      res({ data: this.execute(), error: null });
    });
    return p.then(resolve, reject);
  }

  single(): Promise<DbResult<T>> {
    const rows = this.execute();
    if (rows.length === 0) {
      return Promise.resolve({ data: null, error: { message: "No se encontró la fila (PGRST116)", code: "PGRST116" } });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }
  maybeSingle(): Promise<DbResult<T | null>> {
    const rows = this.execute();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  /* Mutaciones (misma API que supabase-js: from(...).insert/update/delete/upsert) */
  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    return new DemoMutation<Record<string, unknown>>(this.table, "insert", payload);
  }
  update(payload: Record<string, unknown>) {
    return new DemoMutation<Record<string, unknown>>(this.table, "update", payload, [], [...this.filters]);
  }
  delete() {
    return new DemoMutation<Record<string, unknown>>(this.table, "delete", {}, [], [...this.filters]);
  }
  upsert(payload: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    const cols = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    return new DemoMutation<Record<string, unknown>>(this.table, "upsert", payload, cols);
  }
}

/* ————— Insert / Update / Delete / Upsert ————— */
class DemoMutation<T extends Record<string, unknown>> {
  private isSingle = false;

  constructor(
    private table: string,
    private mode: "insert" | "update" | "delete" | "upsert",
    private payload: Record<string, unknown> | Record<string, unknown>[],
    private conflictCols: string[] = [],
    private matchFilters: Filter[] = []
  ) {}

  select(_cols?: string) { return this; }
  single(): Promise<DbResult<T>> {
    this.isSingle = true;
    return this.singleResult();
  }
  maybeSingle(): Promise<DbResult<T | null>> {
    return this.singleResult().then((r) => (r.error && r.error.code === "PGRST116" ? { data: null, error: null } : (r as DbResult<T | null>)));
  }
  eq(col: string, val: unknown) { this.matchFilters.push({ col, op: "eq", val }); return this; }
  in(col: string, vals: unknown[]) { this.matchFilters.push({ col, op: "in", val: vals }); return this; }

  private rowsRef(): Record<string, unknown>[] {
    return (demoDb() as unknown as Record<string, Record<string, unknown>[]>)[this.table] ?? [];
  }

  private run(): T[] {
    const rows = this.rowsRef();
    if (this.mode === "insert" || this.mode === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: Record<string, unknown>[] = [];
      for (const item of list) {
        if (this.mode === "upsert" && this.conflictCols.length > 0) {
          const idx = rows.findIndex((r) => this.conflictCols.every((c) => r[c] === item[c]));
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...item };
            inserted.push(rows[idx]);
            continue;
          }
        }
        const row = { id: uuid(), created_at: new Date().toISOString(), ...item };
        rows.push(row);
        inserted.push(row);
      }
      return inserted as T[];
    }
    if (this.mode === "update") {
      const updated: Record<string, unknown>[] = [];
      rows.forEach((r, i) => {
        if (this.matchFilters.every((f) => matches(r, f))) {
          rows[i] = { ...r, ...(this.payload as Record<string, unknown>) };
          updated.push(rows[i]);
        }
      });
      return updated as T[];
    }
    /* delete */
    for (let i = rows.length - 1; i >= 0; i--) {
      if (this.matchFilters.every((f) => matches(rows[i], f))) rows.splice(i, 1);
    }
    return [];
  }

  then<TResult1 = DbResult<T[]>, TResult2 = never>(
    resolve?: ((value: DbResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    let result: DbResult<T[]>;
    try {
      result = { data: this.run(), error: null };
    } catch (e) {
      result = { data: null, error: { message: e instanceof Error ? e.message : "Error de mutación" } };
    }
    return Promise.resolve(result).then(resolve, reject);
  }

  async singleResult(): Promise<DbResult<T>> {
    const res = (await this) as DbResult<T[]>;
    if (res.error) return { data: null, error: res.error };
    if (!res.data || res.data.length === 0) {
      return { data: null, error: { message: "No se recibió la fila creada" } };
    }
    return { data: res.data[0] as T, error: null };
  }
}

/* ————— RPC ————— */
/* role_key del perfil → valor de organization_members.role (CHECK en inglés de la BD real) */
const ROLE_KEY_TO_MEMBER: Record<string, string> = {
  owner: "owner",
  administracion: "admin",
  cajero: "cashier",
  profesional: "professional",
};

function runRpc<T>(fn: string, params: Record<string, unknown> | undefined): Promise<DbResult<T[]>> {
  const db = demoDb();
  if (fn === "vellora_list_members") {
    const rows: MemberRow[] = db.organization_members
      .map((m) => {
        const user = db.users.find((u) => u.id === m.user_id);
        const role = db.organization_roles.find((r) => r.id === m.profile_id);
        const branch = db.branches.find((b) => b.id === m.branch_id);
        return {
          member_id: m.id,
          user_id: m.user_id,
          email: user?.email ?? null,
          full_name: user?.full_name ?? null,
          phone: user?.phone ?? null,
          role: m.role,
          profile_id: m.profile_id,
          profile_name: role?.name ?? null,
          profile_key: role?.role_key ?? null,
          branch_id: m.branch_id,
          branch_name: branch?.name ?? null,
          active: m.active,
        };
      });
    return Promise.resolve({ data: (rows as unknown) as T[], error: null });
  }
  if (fn === "vellora_list_member_branches") {
    return Promise.resolve({
      data: db.branches.map((b) => ({ id: b.id, name: b.name })) as unknown as T[],
      error: null,
    });
  }
  if (fn === "vellora_update_member_access") {
    const m = db.organization_members.find((x) => x.id === params?.p_member_id);
    if (!m) return Promise.resolve({ data: null, error: { message: "Membresía no encontrada" } });
    /* Protección del Propietario: nunca se degrada ni desactiva su acceso */
    const currentRole = db.organization_roles.find((r) => r.id === m.profile_id);
    if (currentRole?.role_key === "owner") {
      return Promise.resolve({ data: null, error: { message: "El acceso del Propietario está protegido (RPC)" } });
    }
    const role = db.organization_roles.find((r) => r.id === params?.p_profile_id);
    if (role?.role_key === "owner") {
      return Promise.resolve({ data: null, error: { message: "No se puede asignar el perfil Propietario (RPC)" } });
    }
    m.profile_id = (params?.p_profile_id as string) ?? null;
    m.branch_id = (params?.p_branch_id as string) ?? null;
    m.active = Boolean(params?.p_active);
    m.role = ROLE_KEY_TO_MEMBER[String(role?.role_key ?? "")] ?? m.role;
    return Promise.resolve({ data: [] as unknown as T[], error: null });
  }
  return Promise.resolve({ data: null, error: { message: `RPC no implementado en demo: ${fn}` } });
}

/* ————— Auth demo ————— */
const authListeners: ((event: string, session: { user: AppUser } | null) => void)[] = [];

const demoAuth = {
  async getUser() {
    const user = loadSession();
    return { data: { user }, error: user ? null : { message: "No hay sesión" } };
  },
  async getSession() {
    const user = loadSession();
    return { data: { session: user ? { user } : null }, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const db = demoDb();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || password !== DEMO_PASSWORD) {
      return { data: { user: null }, error: { message: "Credenciales inválidas. Revisa el correo y la contraseña." } };
    }
    saveSession(user);
    authListeners.forEach((cb) => cb("SIGNED_IN", { user }));
    return { data: { user }, error: null };
  },
  async signOut() {
    saveSession(null);
    authListeners.forEach((cb) => cb("SIGNED_OUT", null));
    return { error: null };
  },
  onAuthStateChange(cb: (event: string, session: { user: AppUser } | null) => void) {
    authListeners.push(cb);
    return {
      data: {
        subscription: {
          unsubscribe() {
            const i = authListeners.indexOf(cb);
            if (i >= 0) authListeners.splice(i, 1);
          },
        },
      },
    };
  },
};

/* ————— Cliente demo ————— */
export function createDemoClient() {
  return {
    __demo: true as const,
    auth: demoAuth,
    from(table: string) {
      return new DemoQuery<Record<string, unknown>>(table);
    },
    rpc(fn: string, params?: Record<string, unknown>) {
      return runRpc(fn, params);
    },
  };
}

export type DemoClient = ReturnType<typeof createDemoClient>;

/* Reset para pruebas */
export function resetDemoSession() {
  saveSession(null);
}
