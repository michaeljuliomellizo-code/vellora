import { formatCOP } from './format'

const demoItems = [
  { name: 'Corte + Styling', meta: '45 min · Estilista: Ana', price: 35000 },
  { name: 'Manicure Spa', meta: '50 min · Técnica: Laura', price: 28000 },
  { name: 'Tinte Premium', meta: '120 min · IVA 19%', price: 77000 },
]

const demoTotal = demoItems.reduce((sum, item) => sum + item.price, 0)
const demoCash = 150000
const demoChange = demoCash - demoTotal

/** Hero comercial de Vellora: propuesta de valor + demo de venta POS. */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-violet-50/50 to-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-[-10%] h-72 w-72 rounded-full bg-violet-200/60 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-30%] left-[-8%] h-64 w-64 rounded-full bg-fuchsia-100/70 blur-3xl"
      />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-24">
        {/* Texto */}
        <div>
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-violet-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm">
            <span className="text-violet-700">CO</span>
            <span className="text-gray-300" aria-hidden="true">
              ·
            </span>
            Hecho para el mercado colombiano
            <span className="text-gray-300" aria-hidden="true">
              ·
            </span>
            <span className="text-violet-700">COP · DIAN</span>
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
            La plataforma integral para administrar tu{' '}
            <span className="text-violet-700">negocio de belleza</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
            Agenda de citas, punto de venta, inventario de productos, fidelización de clientes,
            facturación electrónica DIAN y analítica. Multiempresa, multi-sucursal y con
            suscripciones.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="/register"
              className="inline-flex items-center justify-center rounded-xl bg-violet-700 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-600/20 transition-colors hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
            >
              Crear mi cuenta gratis 14 días
            </a>
            <a
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3.5 text-base font-semibold text-gray-800 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
            >
              Ya tengo cuenta
            </a>
          </div>

          <p className="mt-4 text-sm text-gray-500">
            Sin tarjeta de crédito · Datos independientes por empresa · Soporte en español
          </p>
        </div>

        {/* Demo de venta POS */}
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-xl shadow-violet-100 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <p className="font-bold text-gray-900">Venta POS · Vellora Belleza</p>
              <span className="shrink-0 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                Caja abierta
              </span>
            </div>

            <ul className="mt-4 space-y-3">
              {demoItems.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.meta}</p>
                  </div>
                  <p className="text-sm font-bold text-gray-900">${formatCOP(item.price)}</p>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-xl bg-violet-50 px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="font-extrabold text-gray-900">Total</p>
                <p className="text-lg font-extrabold text-gray-900">${formatCOP(demoTotal)}</p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-600">
                <span>Efectivo recibido</span>
                <span>
                  ${formatCOP(demoCash)} · Cambio ${formatCOP(demoChange)}
                </span>
              </div>
            </div>
          </div>

          <div className="absolute -bottom-4 left-6 hidden items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-lg shadow-violet-100 sm:flex">
            <span className="h-2 w-2 rounded-full bg-violet-600" aria-hidden="true" />
            Facturación electrónica DIAN lista para usar
          </div>
        </div>
      </div>
    </section>
  )
}
