export const SYSTEM_TIME_ZONE = 'America/Santo_Domingo'

export function nowIso() {
  return new Date().toISOString()
}

export function todayIso() {
  return dayKeyInSystemZone(new Date())
}

export function currentYear() {
  return Number(dayKeyInSystemZone(new Date()).slice(0, 4))
}

export function addDaysIso(dateText, days) {
  const date = parseDate(dateText)
  date.setDate(date.getDate() + Number(days || 0))
  return dayKeyInSystemZone(date)
}

export function daysUntil(dateText) {
  const target = parseDate(`${dateText || todayIso()}T00:00:00`)
  const today = parseDate(`${todayIso()}T00:00:00`)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

export function parseDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00-04:00`)
  }
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export function dayKeyInSystemZone(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYSTEM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parseDate(value))
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
