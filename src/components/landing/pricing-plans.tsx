'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase'
import { formatCOP } from './format'

/** Estructura mínima que la landing necesita de cada plan. */
export type Plan = {
  code: string
  name: string
  tagline: string
  price: number
  currency: string
  interval: 'month' | 'year'
  trialDays: number
  features: string[]
  isFeatured: boolean
}

/** Precios de respaldo (COP/mes): se muestran si Supabase no está configurado,
 *  no responde o la tabla `subscription_plans` aún no existe. Mantén estos
 *  valores alineados con el seed del script supabase/01_planes_suscripcion.sql. */
export const FALLBACK_PLANS: Plan[] = [
  {
    code: 'esencial',
    name: 'Esencial',
    tagline: 'Para negocios que empiezan',
    price: 99900,
    currency: 'COP',
    interval: 'month',
    trialDays: 14,
    features: [
      '1 establecimiento',
      'Agenda de citas',
      'Punto de venta (POS)',
      'Inventario básico',
      'Hasta 3 usuarios',
      'Soporte por email',
    ],
    isFeatured: false,
  },
  {
    code: 'pro',
    name: 'Pro',
    tagline: 'El favorito de los negocios en crecimiento',
    price: 149900,
    currency: 'COP',
    interval: 'month',
    trialDays: 14,
    features: [
      'Hasta 3 establecimientos',
      'Todo lo del plan Esencial',
      'Facturación electrónica DIAN',
      'Clientes y fidelización',
      'Reportes y analítica',
      'Hasta 10 usuarios',
      'Soporte prioritario',
    ],
    isFeatured: true,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    tagline: 'Para cadenas y franquicias',
    price: 219900,
    currency: 'COP',
    interval: 'month',
    trialDays: 14,
    features: [
      'Establecimientos ilimitados',
      'Todo lo del plan Pro',
      'Usuarios ilimitados',
      'Roles personalizados por sede',
      'API y webhooks',
      'Gerente de cuenta dedicado',
    ],
    isFeatured: false,
  },
]

/** Convierte una fila de `subscription_plans` al tipo Plan, tolerando columnas ausentes. */
function mapPlanRow(row: Record<string, unknown>): Plan {
  const fallback = FALLBACK_PLANS[0]
  return {
    code: typeof row.code === 'string' && row.code ? row.code : 'plan',
    name: typeof row.name === 'string' && row.name ? row.name : 'Plan',
    tagline: typeof row.tagline === 'string' ? row.tagline : fallback.tagline,
    price: Number(row.price_cop ?? row.price ?? fallback.price) || fallback.price,
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'COP',
    interval: row.billing_interval === 'year' ? 'year' : 'month',
    trialDays: Number(row.trial_days ?? 14) || 14,
    features: Array.isArray(row.features) ? row.features.map((f) => String(f)) : [],
    isFeatured: Boolean(row.is_featured),
  }
}

type PlanSource = 'loading' | 'supabase' | 'fallback'

/** Sección de planes: consulta Supabase y cae a precios de respaldo si falla. */
export function PricingPlans() {
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS)
  const [source, setSource] = useState<PlanSource>('loading')

  useEffect(() => {
    let cancelled = false

    async function loadPlans() {
      if (!isSupabaseConfigured) {
        // Sin credenciales todavía: precios de respaldo inmediatos.
        setSource('fallback')
        return
      }

      const supabase = getSupabaseClient()
      if (!supabase) {
        setSource('fallback')
        return
      }

      try {
        // Si Supabase no responde en 4 s mostramos el respaldo sin bloquear la página.
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('supabase_timeout')), 4000),
        )

        const query = supabase
          .from('subscription_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })

        const { data, error } = await Promise.race([query, timeout])

        if (error || !data || data.length === 0) {
          setPlans(FALLBACK_PLANS)
          setSource('fallback')
          return
        }

        const mapped = data.map((row) => mapPlanRow(row as Record<string, unknown>))
        if (cancelled) return
        setPlans(mapped.length > 0 ? mapped : FALLBACK_PLANS)
        setSource(mapped.length > 0 ? 'supabase' : 'fallback')
      } catch {
        if (cancelled) return
        setPlans(FALLBACK_PLANS)
        setSource('fallback')
      }
    }

    loadPlans()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      id="planes"
      className="scroll-mt-20 bg-gradient-to-b from-white via-violet-50/40 to-violet-50/80 py-16 lg:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-violet-700">Planes</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Planes simples que crecen con tu negocio
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Todos los planes incluyen 14 días gratis. Sin tarjeta de crédito y cancelas cuando
            quieras.
          </p>
        </div>

        {source === 'loading' ? (
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3" aria-hidden="true">
            {FALLBACK_PLANS.map((plan) => (
              <div
                key={plan.code}
                className="h-96 animate-pulse rounded-2xl border border-gray-100 bg-white/70"
              />
            ))}
          </div>
        ) : (
          <ul className="mt-12 grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
            {plans.map((plan) => (
              <li key={plan.code}>
                <article
                  className={
                    plan.isFeatured
                      ? 'relative flex h-full flex-col rounded-2xl border-2 border-violet-600 bg-white p-7 shadow-xl shadow-violet-100'
                      : 'flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-7 shadow-sm hover:border-violet-200'
                  }
                >
                  {plan.isFeatured && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-700 px-4 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-sm">
                      Más popular
                    </span>
                  )}

                  <h3 className="text-lg font-extrabold text-gray-900">{plan.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">{plan.tagline}</p>

                  <p className="mt-5 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight text-gray-900">
                      ${formatCOP(plan.price)}
                    </span>
                    <span className="text-sm font-medium text-gray-500">
                      /{plan.interval === 'year' ? 'año' : 'mes'}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {plan.trialDays} días gratis · sin tarjeta
                  </p>

                  <ul className="mt-6 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="mt-0.5 h-4 w-4 shrink-0 text-violet-700"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 10-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <a
                    href={`/register?plan=${encodeURIComponent(plan.code)}`}
                    className={
                      plan.isFeatured
                        ? 'mt-7 inline-flex items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-800'
                        : 'mt-7 inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
                    }
                  >
                    Comenzar gratis
                  </a>
                </article>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-center text-xs text-gray-500">
          Precios en pesos colombianos (COP), IVA no incluido.
          {source === 'fallback' && (
            <span className="block text-gray-400">
              Sin conexión con Supabase · mostrando precios de respaldo
            </span>
          )}
        </p>
      </div>
    </section>
  )
}
