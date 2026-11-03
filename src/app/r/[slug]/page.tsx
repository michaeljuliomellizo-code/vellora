/* VelloRa ERP — Página pública de reservas: /r/<slug>
   Ruta independiente del ERP (no requiere sesión). El slug se configura en
   Reservas online → Configuración. */
import PublicBookingClient from "@/components/vellora/PublicBookingClient";

export const metadata = {
  title: "Reserva online",
  description: "Agenda tu cita en línea",
};

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicBookingClient slug={slug} />;
}
