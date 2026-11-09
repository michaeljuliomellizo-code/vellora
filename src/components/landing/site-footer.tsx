import { LogoMark } from './logo-mark'

/** Pie de página de la landing comercial. */
export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-gray-100 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <a href="/" className="flex items-center gap-2" aria-label="Vellora — inicio">
            <LogoMark className="h-8 w-8" />
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              VELL<span className="text-violet-700">ORA</span>
            </span>
          </a>
          <p className="text-xs text-gray-500">
            Software para administrar negocios de belleza en Colombia.
          </p>
        </div>

        <nav className="flex items-center gap-5 text-sm text-gray-600" aria-label="Enlaces de pie">
          <a href="#modulos" className="transition-colors hover:text-violet-700">
            Módulos
          </a>
          <a href="#planes" className="transition-colors hover:text-violet-700">
            Planes
          </a>
          <a href="/login" className="transition-colors hover:text-violet-700">
            Ingresar
          </a>
        </nav>

        <p className="text-xs text-gray-400">© {year} Vellora · Bogotá, Colombia</p>
      </div>
    </footer>
  )
}
