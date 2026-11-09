/** Iconos de trazo (24×24) para no depender de librerías externas. */
function Icon({ path, title }: { path: React.ReactNode; title: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <title>{title}</title>
      {path}
    </svg>
  )
}

const modules = [
  {
    title: 'Agenda de citas',
    description:
      'Reservas por servicio, profesional y sede. Recordatorios automáticos y control de no-shows.',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="M9 15h.01M13 15h.01M17 15h.01" />
      </>
    ),
  },
  {
    title: 'Punto de venta (POS)',
    description: 'Cobros rápidos, pagos mixtos, propinas y cierre de caja por turno.',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <path d="M6 15h.01M10 15h.01M14 15h.01M18 15h.01M6 18h.01M10 18h.01M14 18h.01M18 18h.01" />
        <path d="M4 11v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" />
      </>
    ),
  },
  {
    title: 'Inventario de productos',
    description:
      'Control por lote y vencimiento, alertas de stock mínimo y consumo interno por sede.',
    icon: (
      <>
        <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7z" />
        <path d="M3 8.5 12 14l9-5.5M12 14v7" />
      </>
    ),
  },
  {
    title: 'Clientes y fidelización',
    description:
      'Historial de servicios, preferencias, paquetes, bonos prepagados y programas de puntos.',
    icon: (
      <>
        <circle cx="8" cy="8" r="3.5" />
        <path d="M2.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
        <path d="M17 11c1.2-1.2 3-1.2 3.6.4.6 1.5-.5 2.8-3.6 5.1-3.1-2.3-4.2-3.6-3.6-5.1.6-1.6 2.4-1.6 3.6-.4z" />
      </>
    ),
  },
  {
    title: 'Facturación electrónica DIAN',
    description: 'Emite, anula y reporta a la DIAN sin salir de Vellora. Vigilada por resolución.',
    icon: (
      <>
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
        <path d="M14 2v6h6M9 13h6M9 17h4" />
      </>
    ),
  },
  {
    title: 'Reportes y analítica',
    description: 'Ventas por sede, servicio y profesional; comisiones y ocupación de la agenda.',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <path d="M7 15v3M12 10v8M17 6v12" />
      </>
    ),
  },
  {
    title: 'Multi-sucursal',
    description:
      'Administra todos tus establecimientos desde una sola cuenta con datos independientes.',
    icon: (
      <>
        <path d="M3 21h18M5 21V9l7-5 7 5v12" />
        <path d="M9 21v-6h6v6M10 10h.01M14 10h.01" />
      </>
    ),
  },
  {
    title: 'Roles y permisos',
    description: 'Dueño, administrador y personal: cada usuario ve solo lo que le corresponde.',
    icon: (
      <>
        <path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6l-8-3z" />
        <path d="M9.5 12l2 2 3.5-3.5" />
      </>
    ),
  },
]

/** Sección de módulos de la plataforma. */
export function ModulesSection() {
  return (
    <section id="modulos" className="scroll-mt-20 bg-white py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-violet-700">Módulos</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Todo lo que tu negocio de belleza necesita
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Una sola herramienta para salones, barberías, spas y estéticas: menos planillas y más
            tiempo para tus clientes.
          </p>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((mod) => (
            <li
              key={mod.title}
              className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-colors hover:border-violet-200 hover:shadow-md"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-100 text-violet-700 transition-colors group-hover:bg-violet-700 group-hover:text-white">
                <Icon path={mod.icon} title={mod.title} />
              </span>
              <h3 className="mt-4 text-base font-bold text-gray-900">{mod.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{mod.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
