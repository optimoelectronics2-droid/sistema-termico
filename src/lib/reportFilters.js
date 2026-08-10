export const quickDateRanges = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'last_week', label: 'Semana pasada' },
  { id: 'last_7', label: 'Ultimos 7 dias' },
  { id: 'this_month', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: 'last_30', label: 'Ultimos 30 dias' },
  { id: 'this_year', label: 'Este año' },
  { id: 'last_year', label: 'Año pasado' },
  { id: 'custom', label: 'Personalizado' },
]

export const groupOptions = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' },
  { id: 'product', label: 'Producto' },
  { id: 'category', label: 'Categoria' },
  { id: 'customer', label: 'Cliente' },
  { id: 'payment', label: 'Metodo pago' },
  { id: 'status', label: 'Estado' },
]

export function defaultReportFilters() {
  const range = resolveQuickDateRange('this_month')
  return {
    quickRange: 'this_month',
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    exactDate: '',
    month: currentMonth(),
    year: String(new Date().getFullYear()),
    timeFrom: '',
    timeTo: '',
    query: '',
    customer: '',
    product: '',
    paymentMethod: 'all',
    status: 'all',
    amountMin: '',
    amountMax: '',
    groupBy: 'day',
  }
}

export function applyQuickRange(filters, quickRange) {
  const range = resolveQuickDateRange(quickRange)
  return {
    ...filters,
    quickRange,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    exactDate: quickRange === 'custom' ? filters.exactDate : '',
    month: range.month || filters.month,
    year: range.year || filters.year,
  }
}

export function filterReportRows(rows, filters, options = {}) {
  const searchableFields = options.searchableFields || []
  return rows.filter((row) => {
    const date = parseDate(row.date || row.issuedAt || row.createdAt || row.fecha)
    const text = normalize([
      ...searchableFields.map((field) => row[field]),
      row.number,
      row.ncf,
      row.customerName,
      row.customer,
      row.cliente,
      row.productName,
      row.producto,
      row.sku,
      row.method,
      row.paymentMethod,
      row.status,
      row.seriales,
      row.description,
      row.documentNumber,
      row.reference,
    ].flat().join(' '))
    const total = Number(row.total ?? row.amount ?? row.netRevenue ?? row.revenue ?? row.totals?.total ?? row.valueCost ?? 0)
    if (filters.exactDate && dayKey(date) !== filters.exactDate) return false
    if (filters.dateFrom && date < atStart(filters.dateFrom)) return false
    if (filters.dateTo && date > atEnd(filters.dateTo)) return false
    if (filters.timeFrom && minutesOfDay(date) < timeToMinutes(filters.timeFrom)) return false
    if (filters.timeTo && minutesOfDay(date) > timeToMinutes(filters.timeTo)) return false
    if (filters.query && !text.includes(normalize(filters.query))) return false
    if (filters.customer && !normalize(row.customerName || row.customer || row.cliente || '').includes(normalize(filters.customer))) return false
    if (filters.product && !normalize(row.productName || row.producto || row.name || '').includes(normalize(filters.product))) return false
    if (filters.paymentMethod !== 'all' && normalize(row.paymentMethod || row.method || '') !== normalize(filters.paymentMethod)) return false
    if (filters.status !== 'all' && normalize(row.status || '') !== normalize(filters.status)) return false
    if (filters.amountMin !== '' && total < Number(filters.amountMin)) return false
    if (filters.amountMax !== '' && total > Number(filters.amountMax)) return false
    return true
  })
}

export function groupReportRows(rows, groupBy) {
  const map = new Map()
  rows.forEach((row) => {
    const date = parseDate(row.date || row.issuedAt || row.createdAt || row.fecha)
    const key = groupKey(row, groupBy, date)
    const current = map.get(key) || { group: key, documents: 0, quantity: 0, subtotal: 0, tax: 0, total: 0, cost: 0, profit: 0 }
    const quantity = Number(row.quantity || row.cantidad || row.unitsSold || row.stock || 0)
    const subtotal = Number(row.subtotal || row.totals?.subtotal || 0)
    const tax = Number(row.tax || row.itbis || row.totals?.itbis || 0)
    const total = Number(row.total ?? row.amount ?? row.revenue ?? row.totals?.total ?? 0)
    const cost = Number(row.cost ?? row.costo ?? row.totals?.cost ?? row.valueCost ?? 0)
    const profit = Number(row.profit ?? row.ganancia ?? row.netProfit ?? row.totals?.profit ?? 0)
    current.documents += 1
    current.quantity += quantity
    current.subtotal += subtotal
    current.tax += tax
    current.total += total
    current.cost += cost
    current.profit += profit
    map.set(key, current)
  })
  return [...map.values()]
    .map((row) => ({
      ...row,
      subtotal: roundMoney(row.subtotal),
      tax: roundMoney(row.tax),
      total: roundMoney(row.total),
      cost: roundMoney(row.cost),
      profit: roundMoney(row.profit),
    }))
    .sort((a, b) => String(b.group).localeCompare(String(a.group)))
}

export function describeFilters(filters) {
  const parts = []
  if (filters.exactDate) parts.push(`Dia ${filters.exactDate}`)
  else if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || 'inicio'} a ${filters.dateTo || 'hoy'}`)
  if (filters.timeFrom || filters.timeTo) parts.push(`${filters.timeFrom || '00:00'}-${filters.timeTo || '23:59'}`)
  if (filters.query) parts.push(`Busqueda: ${filters.query}`)
  if (filters.customer) parts.push(`Cliente: ${filters.customer}`)
  if (filters.product) parts.push(`Producto: ${filters.product}`)
  if (filters.paymentMethod !== 'all') parts.push(`Pago: ${filters.paymentMethod}`)
  if (filters.status !== 'all') parts.push(`Estado: ${filters.status}`)
  return parts.join(' | ') || 'Sin filtros adicionales'
}

function resolveQuickDateRange(id) {
  const now = new Date()
  const today = dayKey(now)
  if (id === 'today') return { dateFrom: today, dateTo: today }
  if (id === 'yesterday') {
    const date = addDays(now, -1)
    return { dateFrom: dayKey(date), dateTo: dayKey(date) }
  }
  if (id === 'last_7') return { dateFrom: dayKey(addDays(now, -6)), dateTo: today }
  if (id === 'last_30') return { dateFrom: dayKey(addDays(now, -29)), dateTo: today }
  if (id === 'this_week') return { dateFrom: dayKey(startOfWeek(now)), dateTo: today }
  if (id === 'last_week') {
    const start = addDays(startOfWeek(now), -7)
    return { dateFrom: dayKey(start), dateTo: dayKey(addDays(start, 6)) }
  }
  if (id === 'this_month') return { dateFrom: `${currentMonth()}-01`, dateTo: dayKey(endOfMonth(now)), month: currentMonth(), year: String(now.getFullYear()) }
  if (id === 'last_month') {
    const date = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { dateFrom: dayKey(date), dateTo: dayKey(endOfMonth(date)), month: currentMonth(date), year: String(date.getFullYear()) }
  }
  if (id === 'this_year') return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: `${now.getFullYear()}-12-31`, year: String(now.getFullYear()) }
  if (id === 'last_year') return { dateFrom: `${now.getFullYear() - 1}-01-01`, dateTo: `${now.getFullYear() - 1}-12-31`, year: String(now.getFullYear() - 1) }
  return { dateFrom: '', dateTo: '' }
}

function groupKey(row, groupBy, date) {
  if (groupBy === 'week') return weekKey(date)
  if (groupBy === 'month') return dayKey(date).slice(0, 7)
  if (groupBy === 'year') return String(date.getFullYear())
  if (groupBy === 'product') return row.productName || row.producto || row.name || row.sku || 'Sin producto'
  if (groupBy === 'category') return row.category || row.categoria || 'Sin categoria'
  if (groupBy === 'customer') return row.customerName || row.customer || row.cliente || 'Sin cliente'
  if (groupBy === 'payment') return row.paymentMethod || row.method || 'No especificado'
  if (groupBy === 'status') return row.status || 'Sin estado'
  return dayKey(date)
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function atStart(value) {
  return new Date(`${value}T00:00:00`)
}

function atEnd(value) {
  return new Date(`${value}T23:59:59.999`)
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function currentMonth(date = new Date()) {
  return date.toISOString().slice(0, 7)
}

function startOfWeek(date) {
  const next = new Date(date)
  const day = next.getDay()
  next.setDate(next.getDate() - day)
  return next
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function weekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
