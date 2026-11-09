/** Marca de Vellora: destello sobre degradado violeta. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-violet-700 to-fuchsia-600 shadow-sm ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2 text-white">
        <path d="M12 2c1 5 5 9 10 10-5 1-9 5-10 10-1-5-5-9-10-10 5-1 9-5 10-10z" />
      </svg>
    </span>
  )
}
