import { LogoMark } from './logo-mark'

const links = [
  { href: '#modulos', label: 'Módulos' },
  { href: '#planes', label: 'Planes' },
  { href: '/login', label: 'Ingresar' },
]

/** Barra de navegación fija de la landing comercial de Vellora. */
export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label="Vellora — inicio">
          <LogoMark className="h-9 w-9" />
          <span className="text-xl font-extrabold tracking-tight text-gray-900">
            VELL<span className="text-violet-700">ORA</span>
          </span>
        </a>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Navegación principal">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-violet-50 hover:text-violet-700 sm:block"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/register"
            className="ml-1 inline-flex items-center rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
          >
            Probar gratis
          </a>
        </nav>
      </div>
    </header>
  )
}
