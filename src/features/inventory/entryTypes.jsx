/* eslint-disable react-refresh/only-export-components -- Este módulo comparte las constantes del formulario y su insignia React. */
export const ENTRY_TYPES = ['Nueva mercancia', 'Devolucion proveedor', 'Ajuste positivo', 'Transferencia']

export const TYPE_BADGE = {
  'Nueva mercancia': { color: '#34d399', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.35)' },
  'Devolucion proveedor': { color: '#fbbf24', bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.35)' },
  'Ajuste positivo': { color: '#22d3ee', bg: 'rgba(34,211,238,.12)', border: 'rgba(34,211,238,.35)' },
  'Transferencia': { color: '#a78bfa', bg: 'rgba(167,139,250,.12)', border: 'rgba(167,139,250,.35)' },
  default: { color: '#94a3b8', bg: 'rgba(148,163,184,.12)', border: 'rgba(148,163,184,.35)' },
}

export function TypeBadge({ type }) {
  const style = TYPE_BADGE[type] || TYPE_BADGE.default
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>{type}</span>
  )
}
