import type { Metadata } from 'next'
import { Navbar } from '@/components/landing/navbar'
import { Hero } from '@/components/landing/hero'
import { ModulesSection } from '@/components/landing/modules-section'
import { PricingPlans } from '@/components/landing/pricing-plans'
import { SiteFooter } from '@/components/landing/site-footer'

export const metadata: Metadata = {
  title: 'Vellora — Software para administrar tu negocio de belleza',
  description:
    'Agenda de citas, POS, inventario, facturación electrónica DIAN y multi-sucursal para salones, barberías, spas y estéticas. Prueba gratis 14 días.',
  keywords: ['Vellora', 'software belleza', 'agenda citas', 'POS', 'facturación DIAN', 'Colombia'],
  openGraph: {
    title: 'Vellora — Software para administrar tu negocio de belleza',
    description:
      'Agenda, POS, inventario y facturación electrónica DIAN para negocios de belleza. Multiempresa, multi-sucursal y con suscripciones.',
    type: 'website',
  },
}

/** Landing comercial de Vellora (página inicial `/`). */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <ModulesSection />
        <PricingPlans />
      </main>
      <SiteFooter />
    </div>
  )
}
