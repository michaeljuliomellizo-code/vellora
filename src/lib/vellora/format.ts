/* VelloRa ERP — Utilidades de formato (COP, es-CO, zona horaria America/Bogota) */

const TZ = "America/Bogota";

export function formatCOP(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) {
    if (Math.abs(value) >= 1_000_000) {
      return `$${(value / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `$${(value / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })}k`;
    }
  }
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);
}

export function formatPct(value: number, digits = 0): string {
  return `${value.toLocaleString("es-CO", { maximumFractionDigits: digits })}%`;
}

/** Fecha (ISO) -> "3 nov, 2026" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

/** Fecha ISO -> "3 nov" */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: TZ });
}

/** ISO -> "2:30 pm" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

/** Clave YYYY-MM-DD en zona America/Bogota */
export function bogotaDayKey(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  });
  return fmt.format(date);
}

export function bogotaMonthKey(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: TZ,
  });
  return fmt.format(date);
}

/** "Hoy", "Ayer", "3 nov" */
export function relativeDay(iso: string): string {
  const today = bogotaDayKey(new Date());
  const day = bogotaDayKey(new Date(iso));
  if (day === today) return "Hoy";
  const yesterday = bogotaDayKey(new Date(Date.now() - 86_400_000));
  if (day === yesterday) return "Ayer";
  return formatDateShort(iso);
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (a + b).toUpperCase();
}

export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
