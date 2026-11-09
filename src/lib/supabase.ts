import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/vellora/supabase'

/**
 * Cliente de Supabase para el navegador (landing + ingreso/registro).
 * Delega en la fábrica única de lib/vellora/supabase.ts para que EXISTA UN
 * SOLO cliente con sesión en cookies (fix del HTTP 431 por cookies duplicadas).
 * Mantiene la firma original: null si Supabase no está configurado o si se
 * invoca en el servidor.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (typeof window === 'undefined') return null
  return supabaseBrowser() as unknown as SupabaseClient
}