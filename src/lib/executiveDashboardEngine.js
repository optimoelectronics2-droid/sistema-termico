import { isActiveCreditNote, isActiveExpense, isActiveProduct, isActiveReceivable, isReportableInvoice, sanitizeCashRegisterWithSources } from './realDataGuards.js'

const money = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
function toNumber(v) { return Number(v || 0) }
function isCreditMethod(m) {
  var s = String(m || '').toLowerCase()
  return s.includes('credito') || s.includes('crédito') || s.includes('credit')
}

export function buildExecutiveDashboardModel({
  invoices = [], products = [], customers = [], receivables = [],
  expenses = [], creditNotes = [], payments = [], cashRegister = {},
  reportStats = null, inventoryReports = null,
} = {}) {
  const now = new Date()
  const companyId = cashRegister.companyId || ''
  const validInvoices = invoices.filter((inv) => isReportableInvoice(inv, companyId))
  const validCreditNotes = creditNotes.filter((note) => isActiveCreditNote(note, companyId))
  const validExpenses = expenses.filter((exp) => isActiveExpense(exp, companyId))
  const validProducts = products.filter((p) => isActiveProduct(p, companyId))
  const cleanCashRegister = sanitizeCashRegisterWithSources(cashRegister, { invoices: validInvoices, creditNotes: validCreditNotes, expenses: validExpenses, receivables, payments }, companyId)
  const todayKey = dayKey(now)
  const monthKeyVal = monthKey(now)
  const weekStart = startOfWeek(now)

  const todayInvoices = validInvoices.filter((inv) => dayKey(invoiceDate(inv)) === todayKey)
  const weekInvoices = validInvoices.filter((inv) => inRange(invoiceDate(inv), weekStart, now))
  const monthInvoices = validInvoices.filter((inv) => monthKey(invoiceDate(inv)) === monthKeyVal)
  const yearInvoices = validInvoices.filter((inv) => annualKey(invoiceDate(inv)) === annualKey(now))
  const yesterdayInvoices = validInvoices.filter((inv) => dayKey(invoiceDate(inv)) === dayKey(addDays(now, -1)))
  const openReceivables = receivables.filter((item) => isActiveReceivable(item, validInvoices, companyId))
  const pendingPayables = validExpenses.filter((item) => ['pending', 'pendiente', 'open'].includes(String(item.status || '').toLowerCase()))
  const lowStock = inventoryReports?.lowStock?.length || inventoryReports?.outOfStock?.length
    ? [...(inventoryReports.lowStock || []), ...(inventoryReports.outOfStock || [])]
    : validProducts.filter((item) => item.category !== 'Servicios' && Number(item.stock || 0) <= Number(item.stockMin || 0))

  const exec = reportStats.executiveSummary
  const cashSales = reportStats.cashSales
  const creditSales = reportStats.creditSales
  const ticket = reportStats.averageTicket
  const profitability = reportStats.profitability
  const ar = reportStats.accountsReceivable
  const tax = reportStats.taxSummary
  const productsAnalysis = reportStats.productAnalysis
  const customersAnalysis = reportStats.customerAnalysis
  const paymentAnalysis = reportStats.paymentMethodAnalysis
  const comparative = reportStats.comparativeAnalysis

  const totals = {
    todaySales: sumTotal(todayInvoices),
    todayCashSales: sumNonCredit(todayInvoices),
    todayCreditSales: sumCredit(todayInvoices),
    todayProfit: sumEffectiveProfit(todayInvoices),
    todayTax: sumTax(todayInvoices),
    invoicesToday: todayInvoices.length,
    productsSoldToday: todayInvoices.reduce((s, inv) => s + (inv.items || []).reduce((s2, item) => s2 + Number(item.quantity || 0), 0), 0),
    todayVsYesterday: buildDayComparison(todayInvoices, yesterdayInvoices),

    weekSales: sumTotal(weekInvoices),
    weekCashSales: sumNonCredit(weekInvoices),
    weekCreditSales: sumCredit(weekInvoices),

    monthSales: sumTotal(monthInvoices),
    monthProfit: sumEffectiveProfit(monthInvoices),
    monthTax: sumTax(monthInvoices),
    monthCashSales: sumNonCredit(monthInvoices),
    monthCreditSales: sumCredit(monthInvoices),

    yearCashSales: sumNonCredit(yearInvoices),
    yearCreditSales: sumCredit(yearInvoices),

    cashTicketAverage: ticket?.indicators?.find((i) => i.id === 'atTicket')?.value ?? 0,

    abonosToday: sumAbonosInPeriod(receivables, todayKey, 'day'),
    abonosWeek: sumAbonosInPeriod(receivables, { start: weekStart, end: now }, 'range'),
    abonosMonth: sumAbonosInPeriod(receivables, monthKeyVal, 'month'),
    abonosYear: sumAbonosInPeriod(receivables, annualKey(now), 'year'),

    receivablesBalance: ar?.totals?.pendingTotal ?? openReceivables.reduce((s, item) => s + Number(item.balance || 0), 0),
    overdueBalance: ar?.totals?.overdueTotal ?? openReceivables.filter((i) => i.dueDate && new Date(i.dueDate) < new Date()).reduce((s, item) => s + Number(item.balance || 0), 0),
    payablesBalance: pendingPayables.reduce((s, item) => s + Number(item.balance || item.amount || item.total || 0), 0),
    creditNotesTotal: validCreditNotes.reduce((s, note) => s + Number(note.totals?.total || 0), 0),

    lowStockCount: lowStock.length,
    newCustomersToday: customers.filter((c) => dayKey(c.createdAt || c.updatedAt) === todayKey).length,
  }

  const dailySeries = buildDaySeries(validInvoices, 14)
  const monthlySeries = (reportStats?.periods?.monthly?.length ? reportStats.periods.monthly : buildMonthSeries(validInvoices, 8)).slice(0, 8).reverse()
  const topProducts = productsAnalysis?.topSelling?.length ? productsAnalysis.topSelling : (reportStats?.topProducts?.length ? reportStats.topProducts : buildTopProducts(validInvoices)).slice(0, 8)
  const topCustomers = customersAnalysis?.bestCustomers?.length ? customersAnalysis.bestCustomers : (reportStats?.frequentCustomers?.length ? reportStats.frequentCustomers : buildTopCustomers(validInvoices)).slice(0, 8)
  const payMethods = paymentAnalysis?.methods?.length ? paymentAnalysis.methods : buildPaymentMethods(validInvoices, validCreditNotes)
  const cashSummary = summarizeCash(cleanCashRegister)
  const cashPeriods = summarizeCashPeriods(cleanCashRegister.movements || [], now)

  return {
    validInvoices, todayInvoices, weekInvoices, monthInvoices, yearInvoices,
    lowStock, openReceivables, pendingPayables,
    dailySeries, monthlySeries, topProducts, topCustomers,
    paymentMethods: payMethods, cashSummary, cashPeriods,
    recentActivity: buildRecentActivity(validInvoices, validCreditNotes, cleanCashRegister.movements),
    alerts: buildAlerts({ lowStock, openReceivables, pendingPayables, cashRegister: cleanCashRegister }),
    executiveSummary: exec,
    cashSales,
    creditSales,
    averageTicket: ticket,
    profitability,
    accountsReceivable: ar,
    taxSummary: tax,
    productAnalysis: productsAnalysis,
    customerAnalysis: customersAnalysis,
    paymentMethodAnalysis: paymentAnalysis,
    comparativeAnalysis: comparative,
    totals,
  }
}

function buildDayComparison(today, yesterday) {
  const t = sumTotal(today); const y = sumTotal(yesterday)
  const diff = t - y; const pct = y > 0 ? (diff / y) * 100 : 0
  return { today: t, yesterday: y, diff, pctChange: pct, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' }
}

function sumTotal(invoices) { return invoices.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0) }
function sumTax(invoices) { return invoices.reduce((s, inv) => s + Number(inv.totals?.itbis || 0), 0) }

function sumNonCredit(invoices) {
  return invoices.reduce((t, inv) => {
    const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
    return t + payments.filter((p) => !isCreditMethod(p.method)).reduce((s, p) => s + Number(p.amount || 0), 0)
  }, 0)
}
function sumCredit(invoices) {
  return invoices.reduce((t, inv) => {
    const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
    return t + payments.filter((p) => isCreditMethod(p.method)).reduce((s, p) => s + Number(p.amount || 0), 0)
  }, 0)
}

function sumEffectiveProfit(invoices) {
  return invoices.reduce((s, inv) => {
    const ratio = paymentRatio(inv); const totals = inv.totals || {}
    const profit = totals.profit != null ? Number(totals.profit) : (Number(totals.subtotal || 0) - Number(totals.cost || 0))
    return s + profit * ratio
  }, 0)
}
function paymentRatio(invoice) {
  var total = Number(invoice.totals?.total || 0)
  if (total <= 0) return 0
  if (toNumber(invoice.balanceDue) <= 0 || invoice.status === 'paid') return 1
  return Math.min(Math.max(total - toNumber(invoice.balanceDue), 0) / total, 1)
}

function sumAbonosInPeriod(receivables = [], periodKey, mode) {
  return receivables.reduce((t, recv) => t + (recv.payments || []).filter((p) => p.status !== 'deleted').reduce((s, p) => {
    const pd = parseDate(p.date || p.createdAt)
    if (mode === 'day' && dayKey(pd) === periodKey) return s + Number(p.amount || 0)
    if (mode === 'range' && inRange(pd, periodKey.start, periodKey.end)) return s + Number(p.amount || 0)
    if (mode === 'month' && monthKey(pd) === periodKey) return s + Number(p.amount || 0)
    if (mode === 'year' && annualKey(pd) === periodKey) return s + Number(p.amount || 0)
    return s
  }, 0), 0)
}

function buildDaySeries(invoices, count) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(new Date(), i - count + 1); const key = dayKey(date)
    const rows = invoices.filter((inv) => dayKey(invoiceDate(inv)) === key)
    return { period: key, label: key.slice(5), total: sumTotal(rows), profit: sumEffectiveProfit(rows), tax: sumTax(rows), documents: rows.length }
  })
}

function buildMonthSeries(invoices, count) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(); date.setMonth(date.getMonth() - i); const key = monthKey(date)
    const rows = invoices.filter((inv) => monthKey(invoiceDate(inv)) === key)
    return { period: key, label: key, total: sumTotal(rows), netProfit: sumEffectiveProfit(rows), tax: sumTax(rows), documents: rows.length }
  })
}

function buildTopProducts(invoices) {
  const map = new Map()
  invoices.forEach((inv) => {
    const ratio = paymentRatio(inv)
    ;(inv.items || []).forEach((item) => {
      const key = item.productId || item.sku || item.name
      const cur = map.get(key) || { id: key, name: item.name || 'Producto', sku: item.sku || '', quantity: 0, revenue: 0, profit: 0 }
      const q = Number(item.quantity || 0); const sub = Number(item.net ?? Number(item.price || 0) * q)
      cur.quantity += q; cur.revenue += sub + Number(item.tax || 0)
      cur.profit += (sub - Number(item.cost || 0) * q) * ratio
      map.set(key, cur)
    })
  })
  return [...map.values()].sort((a, b) => b.revenue - a.revenue)
}

function buildTopCustomers(invoices) {
  const map = new Map()
  invoices.forEach((inv) => {
    const key = inv.customerId || inv.customerName || 'final'
    const cur = map.get(key) || { id: key, name: inv.customerName || 'Consumidor final', documents: 0, netRevenue: 0, netProfit: 0 }
    cur.documents += 1; cur.netRevenue += Number(inv.totals?.total || 0)
    cur.netProfit += (Number(inv.totals?.profit || 0) || (Number(inv.totals?.subtotal || 0) - Number(inv.totals?.cost || 0))) * paymentRatio(inv)
    map.set(key, cur)
  })
  return [...map.values()].sort((a, b) => b.netRevenue - a.netRevenue)
}

function buildPaymentMethods(invoices, creditNotes) {
  const map = new Map()
  invoices.forEach((inv) => {
    const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'No especificado', amount: inv.totals?.total || 0 }]
    payments.forEach((p) => {
      const m = normalizeMethod(p.method); const cur = map.get(m) || { method: m, count: 0, total: 0, refunds: 0, net: 0 }
      cur.count += 1; cur.total += Number(p.amount || 0); map.set(m, cur)
    })
  })
  creditNotes.forEach((note) => {
    const payments = note.payments?.length ? note.payments : [{ method: 'Nota credito', amount: note.totals?.total || 0 }]
    payments.forEach((p) => {
      const m = normalizeMethod(p.method); const cur = map.get(m) || { method: m, count: 0, total: 0, refunds: 0, net: 0 }
      cur.refunds += Number(p.amount || 0); map.set(m, cur)
    })
  })
  return [...map.values()].map((item) => ({ ...item, net: item.total - item.refunds })).sort((a, b) => b.net - a.net)
}

function summarizeCash(cashRegister = {}) {
  const movements = cashRegister.movements || []; const byMethod = new Map()
  movements.forEach((m) => { const method = normalizeMethod(m.method || m.type); byMethod.set(method, Number(byMethod.get(method) || 0) + signedMovementAmount(m)) })
  const expected = roundMoney(movements.reduce((s, m) => s + signedMovementAmount(m), 0))
  const counted = Number(cashRegister.counted || 0)
  return { status: cashRegister.status || 'closed', openedAt: cashRegister.openedAt || null, closedAt: cashRegister.closedAt || null, openingAmount: Number(cashRegister.openingAmount || 0), expected, counted, difference: roundMoney(counted - expected), movements: movements.length, byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) }
}

function summarizeCashPeriods(movements = [], now = new Date()) {
  const todayKeyVal = dayKey(now); const monthKeyVal = monthKey(now); const weekStart = startOfWeek(now)
  return movements.reduce((s, m) => {
    const d = parseDate(m.createdAt || m.date); const signed = signedMovementAmount(m)
    if (dayKey(d) === todayKeyVal) s.today = roundMoney(s.today + signed)
    if (inRange(d, weekStart, now)) s.week = roundMoney(s.week + signed)
    if (monthKey(d) === monthKeyVal) s.month = roundMoney(s.month + signed)
    return s
  }, { today: 0, week: 0, month: 0 })
}

function signedMovementAmount(movement) {
  const amt = Number(movement.amount || 0)
  return ['expense', 'withdrawal', 'retiro', 'credit_note_refund', 'expense_adjustment', 'payable_payment', 'invoice_void_reversal', 'payment_void_reversal'].includes(String(movement.type || '').toLowerCase()) ? -amt : amt
}

function buildRecentActivity(invoices, creditNotes, movements = []) {
  return [
    ...invoices.slice(0, 12).map((inv) => ({ id: `invoice-${inv.id}`, type: 'Factura', title: inv.number || inv.ncf || 'Factura', detail: inv.customerName || 'Cliente', amount: Number(inv.totals?.total || 0), date: invoiceDate(inv).toISOString() })),
    ...creditNotes.slice(0, 8).map((note) => ({ id: `credit-${note.id}`, type: 'Nota credito', title: note.number || note.ncf || 'Nota credito', detail: note.reason || note.invoiceNumber || '', amount: -Number(note.totals?.total || 0), date: parseDate(note.createdAt || note.updatedAt).toISOString() })),
    ...movements.slice(0, 12).map((m) => ({ id: `cash-${m.id}`, type: 'Caja', title: m.concept || m.note || m.type, detail: m.method || m.reference || '', amount: signedMovementAmount(m), date: parseDate(m.createdAt).toISOString() })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12)
}

function buildAlerts({ lowStock, openReceivables, pendingPayables, cashRegister }) {
  const cashExpected = roundMoney((cashRegister.movements || []).reduce((s, m) => s + signedMovementAmount(m), 0))
  return [
    lowStock.length ? { id: 'stock', tone: 'red', title: 'Inventario critico', detail: `${lowStock.length} producto(s) requieren reposicion.` } : null,
    openReceivables.length ? { id: 'cxc', tone: 'amber', title: 'Cuentas por cobrar', detail: `${openReceivables.length} balance(s) abiertos.` } : null,
    pendingPayables.length ? { id: 'cxp', tone: 'blue', title: 'Cuentas por pagar', detail: `${pendingPayables.length} compromiso(s) pendientes.` } : null,
    cashRegister.status === 'open' ? { id: 'cash', tone: 'green', title: 'Caja abierta', detail: `Balance calculado: ${money.format(cashExpected)}.` } : { id: 'cash', tone: 'red', title: 'Caja cerrada', detail: 'Abra caja antes de facturar si la empresa lo requiere.' },
  ].filter(Boolean)
}

function roundMoney(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100 }
function normalizeMethod(method = '') {
  const v = String(method || 'No especificado').trim().toLowerCase()
  if (v.includes('efectivo')) return 'Efectivo'; if (v.includes('tarjeta')) return 'Tarjeta'; if (v.includes('transfer')) return 'Transferencia'
  if (v.includes('credito') || v.includes('crédito')) return 'Credito'; return method?.trim() || 'No especificado'
}
function startOfWeek(value) { const date = parseDate(value); const day = date.getDay() || 7; const next = new Date(date); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - day + 1); return next }
function addDays(value, days) { const date = parseDate(value); date.setDate(date.getDate() + days); return date }
function inRange(value, start, end) { const time = parseDate(value).getTime(); return time >= parseDate(start).getTime() && time <= parseDate(end).getTime() }
function invoiceDate(invoice) { return parseDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate || invoice?.updatedAt) }
function dayKey(value) { return parseDate(value).toISOString().slice(0, 10) }
function monthKey(value) { return parseDate(value).toISOString().slice(0, 7) }
function annualKey(value) { return parseDate(value).toISOString().slice(0, 4) }
function parseDate(value) { const d = value ? new Date(value) : new Date(); return Number.isNaN(d.getTime()) ? new Date() : d }
