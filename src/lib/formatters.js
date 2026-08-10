import { SYSTEM_TIME_ZONE } from './dateTime'

export const currency = new Intl.NumberFormat('es-DO', {
  style: 'currency',
  currency: 'DOP',
  minimumFractionDigits: 2,
})

export const number = new Intl.NumberFormat('es-DO')

export function formatDate(value) {
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: SYSTEM_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
