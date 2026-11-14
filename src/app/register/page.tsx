'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase'
import { LogoMark } from '@/components/landing/logo-mark'

/** Ruta de destino tras crear la cuenta (si la URL no trae ?next=/ruta).
 *  ¡Apúntala a la pantalla principal de TU aplicación, no a la landing! */
const REDIRECT_DEFAULT = '/dashboard'

const ERRORES: Record<string, string> = {
  'User already registered': 'Ese correo ya tiene una cuenta. Inicia sesión.',
  'Password should be at least 6 characters':
    'La contraseña debe tener al menos 6 caracteres.',
  'Signups not allowed for this instance':
    'Los registros están deshabilitados en este proyecto de Supabase.',
}

const PLANES: Record<string, string> = {
  esencial: 'Esencial',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const inputCls =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-600/20'

export default function RegisterPage() {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creada, setCreada] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('plan')
    if (p && PLANES[p]) setPlan(p)
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }

    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Supabase no está configurado (revisa NEXT_PUBLIC_SUPABASE_* en .env.local).')
      return
    }
    setCargando(true)

    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: nombre.trim(),
          ...(plan ? { plan_interes: plan } : {}),
        },
      },
    })
    setCargando(false)

    if (err) {
      setError(ERRORES[err.message] ?? err.message)
      return
    }

    if (data.session) {
      // Proyecto con "Confirm email" desactivado: sesión inmediata.
      const next = new URLSearchParams(window.location.search).get('next')
      router.replace(next || REDIRECT_DEFAULT)
      return
    }

    // Proyecto con confirmación por correo activada.
    // 👇 FIX: cierra cualquier sesión residual que hubiera en el navegador
    // (p. ej. de otro usuario con el que probaste login antes). Si no se
    // cierra, el proxy ve la cookie sb-* activa y al pulsar
    // "Ir a iniciar sesión" redirige /login → /dashboard en vez de mostrar
    // el formulario de acceso.
    await supabase.auth.signOut()
    setCreada(true)
  }

  if (creada) {
    return (
      <main className="grid min-h-screen place-items-center bg-violet-50 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-violet-100 bg-white p-8 text-center shadow-xl shadow-violet-900/5">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900">
            ¡Cuenta creada!
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Te enviamos un correo a <strong>{email.trim()}</strong> para confirmar tu cuenta.
            Al confirmarla podrás iniciar sesión.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex w-full justify-center rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-violet-50 px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <LogoMark />
          <span className="text-xl font-extrabold tracking-tight text-gray-900">Vellora</span>
        </Link>

        <div className="rounded-2xl border border-violet-100 bg-white p-8 shadow-xl shadow-violet-900/5">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Crea tu cuenta gratis
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            14 días de prueba. Sin tarjeta. Tu negocio listo en minutos.
          </p>

          {plan && (
            <p className="mt-4 inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
              Plan seleccionado: {PLANES[plan]}
            </p>
          )}
          {!isSupabaseConfigured && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
              Supabase no está configurado: define las variables en <code>.env.local</code> y
              reinicia el servidor.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="nombre" className="text-sm font-medium text-gray-700">
                Nombre y apellido
              </label>
              <input
                id="nombre"
                type="text"
                autoComplete="name"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ingresa tu nombre completo"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="email" className="text-sm font-medium text-gray-700">
                Correo
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                className={inputCls}
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => setVerPass((v) => !v)}
                  className="text-xs font-medium text-violet-700 hover:text-violet-800"
                >
                  {verPass ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <input
                id="password"
                type={verPass ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="confirmar" className="text-sm font-medium text-gray-700">
                Confirmar contraseña
              </label>
              <input
                id="confirmar"
                type={verPass ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                placeholder="Repite la contraseña"
                className={inputCls}
              />
            </div>

            <button
              type="submit"
              disabled={cargando || !isSupabaseConfigured}
              className="w-full rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cargando ? 'Creando cuenta…' : 'Crear cuenta gratis'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-violet-700 hover:text-violet-800">
              Inicia sesión
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            ← Volver a la página principal
          </Link>
        </p>
      </div>
    </main>
  )
}