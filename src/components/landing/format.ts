/** Formatea un valor en pesos colombianos sin decimales: 49900 → "49.900". */
export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(value)
}
