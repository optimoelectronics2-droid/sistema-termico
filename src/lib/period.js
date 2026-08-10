export function toIsoLocal(date) {
  const value = date instanceof Date ? date : new Date(date || Date.now())
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function parseIsoLocal(text) {
  const [year, month, day] = String(text || '').split('-').map(Number)
  return new Date(year || 2000, (month || 1) - 1, day || 1)
}

export function addDaysLocal(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + Number(days || 0))
  return next
}

export const QUICK_DATE_CHIPS = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'this_month', label: 'Este mes' },
  { id: 'last_month', label: 'Mes anterior' },
  { id: 'last_30', label: 'Ultimos 30 dias' },
  { id: 'this_year', label: 'Este ano' },
  { id: 'all', label: 'Todo' },
]

export function quickChipRange(id, anchor = new Date()) {
  if (id === 'today') return { from: toIsoLocal(anchor), to: toIsoLocal(anchor) }
  if (id === 'yesterday') {
    const day = addDaysLocal(anchor, -1)
    return { from: toIsoLocal(day), to: toIsoLocal(day) }
  }
  if (id === 'this_week') {
    const start = addDaysLocal(anchor, 1 - (anchor.getDay() || 7))
    return { from: toIsoLocal(start), to: toIsoLocal(addDaysLocal(start, 6)) }
  }
  if (id === 'this_month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    return { from: toIsoLocal(start), to: toIsoLocal(end) }
  }
  if (id === 'last_month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth(), 0)
    return { from: toIsoLocal(start), to: toIsoLocal(end) }
  }
  if (id === 'last_30') return { from: toIsoLocal(addDaysLocal(anchor, -29)), to: toIsoLocal(anchor) }
  if (id === 'this_year') return { from: `${anchor.getFullYear()}-01-01`, to: `${anchor.getFullYear()}-12-31` }
  return { from: '', to: '' }
}

export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function compareValues(left, right) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber - rightNumber
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' })
}
