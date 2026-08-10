import { INVALID_STATUSES, isActiveReceivable, isReportableInvoice, isActiveCreditNote, isActiveExpense, isActiveProduct, isActivePayment } from './realDataGuards.js'

function isCreditMethod(m) {
  var s = String(m || '').toLowerCase()
  return s.includes('credito') || s.includes('crédito') || s.includes('credit')
}
function toNumber(v) { return Number(v || 0) }
function money(v) { return Number(v).toLocaleString('es-DO', { style: 'currency', currency: 'DOP' }) }
function moneyValue(v) { return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100 }
function now() { return new Date().toISOString() }
function dayKey(d) { try { return new Date(d).toISOString().slice(0, 10) } catch { return '' } }
function monthKey(d) { try { return new Date(d).toISOString().slice(0, 7) } catch { return '' } }
function annualKey(d) { try { return new Date(d).toISOString().slice(0, 4) } catch { return '' } }
function parseDate(v) { var d = v ? new Date(v) : new Date(); return isNaN(d.getTime()) ? new Date() : d }
function inRange(v, start, end) { var t = parseDate(v).getTime(); return t >= parseDate(start).getTime() && t <= parseDate(end).getTime() }
function startOfWeek(v) { var d = parseDate(v); var day = d.getDay() || 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day + 1); return d }
function addDays(v, n) { var d = parseDate(v); d.setDate(d.getDate() + n); return d }

var VALID_INVOICE_STATUSES = new Set(['paid', 'pagada', 'credit', 'credito', 'partial', 'parcial', 'open', 'issued', 'emitida', 'pendiente', 'pending', 'overdue', 'vencida', 'delivered', 'entregada'])

function isValidInvoice(inv) {
  var s = String(inv.status || '').trim().toLowerCase()
  return VALID_INVOICE_STATUSES.has(s)
}

function isVoidedInvoice(inv) {
  var s = String(inv.status || '').trim().toLowerCase()
  return INVALID_STATUSES.has(s)
}

function invoiceDate(inv) {
  return parseDate(inv.issuedAt || inv.createdAt || inv.issueDate || inv.updatedAt)
}

function invoiceTotal(inv) { return toNumber(inv.totals?.total || 0) }
function invoiceProfit(inv) { return toNumber(inv.totals?.profit || inv.totals?.subtotal || 0) - toNumber(inv.totals?.cost || 0) }
function invoiceTax(inv) { return toNumber(inv.totals?.itbis || 0) }

function paymentRatio(inv) {
  var total = invoiceTotal(inv)
  if (total <= 0) return 0
  if (toNumber(inv.balanceDue) <= 0 || inv.status === 'paid') return 1
  return Math.min(Math.max(total - toNumber(inv.balanceDue), 0) / total, 1)
}

function sumTotal(invs) { return invs.reduce(function(s, inv) { return s + invoiceTotal(inv) }, 0) }
function sumTax(invs) { return invs.reduce(function(s, inv) { return s + invoiceTax(inv) }, 0) }

function sumEffectiveProfit(invs) {
  return invs.reduce(function(s, inv) {
    var ratio = paymentRatio(inv)
    return s + invoiceProfit(inv) * ratio
  }, 0)
}

function sumNonCredit(invs) {
  return invs.reduce(function(t, inv) {
    var payments = inv.payments && inv.payments.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: invoiceTotal(inv) }]
    return t + payments.filter(function(p) { return !isCreditMethod(p.method) }).reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
  }, 0)
}

function sumCredit(invs) {
  return invs.reduce(function(t, inv) {
    var payments = inv.payments && inv.payments.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: invoiceTotal(inv) }]
    return t + payments.filter(function(p) { return isCreditMethod(p.method) }).reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
  }, 0)
}

export function rebuildReports(data) {
  var companyId = data.companyId || ''
  var invoices = (data.invoices || []).filter(function(inv) { return isReportableInvoice(inv, companyId) })
  var payments = (data.payments || []).filter(function(p) { return isActivePayment(p, invoices, data.receivables, companyId) })
  var creditNotes = (data.creditNotes || []).filter(function(n) { return isActiveCreditNote(n, companyId) })
  var receivables = (data.receivables || []).filter(function(r) { return isActiveReceivable(r, invoices, companyId) })
  var expenses = (data.expenses || []).filter(function(e) { return isActiveExpense(e, companyId) })
  var products = (data.products || []).filter(function(p) { return isActiveProduct(p, companyId) })
  var customers = (data.customers || []).filter(function(c) { return c && c.id && !INVALID_STATUSES.has(String(c.status || '').trim().toLowerCase()) })

  var nowDate = new Date()
  var todayKeyVal = dayKey(nowDate)
  var monthKeyVal = monthKey(nowDate)
  var weekStart = startOfWeek(nowDate)

  var todayInvoices = invoices.filter(function(inv) { return dayKey(invoiceDate(inv)) === todayKeyVal })
  var monthInvoices = invoices.filter(function(inv) { return monthKey(invoiceDate(inv)) === monthKeyVal })
  var weekInvoices = invoices.filter(function(inv) { return inRange(invoiceDate(inv), weekStart, nowDate) })
  var yearInvoices = invoices.filter(function(inv) { return annualKey(invoiceDate(inv)) === annualKey(nowDate) })

  var creditInvoices = invoices.filter(function(inv) {
    return (inv.payments || []).some(function(p) { return isCreditMethod(p.method) }) || isCreditMethod(inv.paymentMethod)
  })
  var cashInvoices = invoices.filter(function(inv) {
    return !isCreditMethod(inv.paymentMethod) && !(inv.payments || []).some(function(p) { return isCreditMethod(p.method) })
  })

  var refundsByInvoice = new Map()
  creditNotes.forEach(function(note) {
    var refunds = (note.payments || []).filter(function(p) { return !isCreditMethod(p.method) }).reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
    if (refunds > 0) refundsByInvoice.set(note.invoiceId, (refundsByInvoice.get(note.invoiceId) || 0) + refunds)
  })

  function effectivePending(inv) {
    if (inv.balanceDue != null) return Math.max(0, toNumber(inv.balanceDue))
    var total = invoiceTotal(inv)
    var paid = toNumber(inv.paidAmount || 0)
    var refunds = refundsByInvoice.get(inv.id) || 0
    var effectivePaid = Math.max(0, paid - refunds)
    return Math.max(0, total - effectivePaid)
  }

  var validReceivables = receivables.filter(function(r) {
    return r.balance > 0
  })

  var crInvsWithBalance = creditInvoices.filter(function(inv) {
    return effectivePending(inv) > 0 && isValidInvoice(inv)
  })

  var receivablesBalance = crInvsWithBalance.reduce(function(s, inv) { return s + effectivePending(inv) }, 0)
  var overdueInvoices = crInvsWithBalance.filter(function(inv) {
    var due = inv.dueDate || inv.issuedAt || inv.createdAt
    return due && new Date(due) < nowDate
  })
  var overdueBalance = overdueInvoices.reduce(function(s, inv) { return s + effectivePending(inv) }, 0)

  var monthlyTotals = {}
  invoices.forEach(function(inv) {
    var mk = monthKey(invoiceDate(inv))
    if (!monthlyTotals[mk]) monthlyTotals[mk] = { period: mk, total: 0, profit: 0, tax: 0, documents: 0, cashTotal: 0, creditTotal: 0 }
    monthlyTotals[mk].total += invoiceTotal(inv)
    monthlyTotals[mk].profit += invoiceProfit(inv) * paymentRatio(inv)
    monthlyTotals[mk].tax += invoiceTax(inv)
    monthlyTotals[mk].documents += 1
  })
  var monthlySeries = Object.values(monthlyTotals).sort(function(a, b) { return a.period.localeCompare(b.period) }).slice(-12).reverse()

  var productSales = {}
  invoices.forEach(function(inv) {
    var ratio = paymentRatio(inv)
    ;(inv.items || []).forEach(function(item) {
      var key = item.productId || item.sku || item.name
      if (!key) return
      if (!productSales[key]) productSales[key] = { id: key, name: item.name || 'Producto', sku: item.sku || '', quantity: 0, revenue: 0, profit: 0 }
      var q = toNumber(item.quantity)
      var sub = toNumber(item.net != null ? item.net : toNumber(item.price) * q)
      productSales[key].quantity += q
      productSales[key].revenue += sub + toNumber(item.tax || 0)
      productSales[key].profit += (sub - toNumber(item.cost || 0) * q) * ratio
    })
  })
  var topProducts = Object.values(productSales).sort(function(a, b) { return b.revenue - a.revenue }).slice(0, 10)

  var customerData = {}
  invoices.forEach(function(inv) {
    var key = inv.customerId || inv.customerName || 'final'
    if (!customerData[key]) customerData[key] = { id: key, name: inv.customerName || 'Consumidor final', documents: 0, netRevenue: 0, netProfit: 0 }
    customerData[key].documents += 1
    customerData[key].netRevenue += invoiceTotal(inv)
    customerData[key].netProfit += invoiceProfit(inv) * paymentRatio(inv)
  })
  var topCustomers = Object.values(customerData).sort(function(a, b) { return b.netRevenue - a.netRevenue }).slice(0, 10)

  var totalRevenue = sumTotal(invoices)
  var totalProfit = sumEffectiveProfit(invoices)
  var totalExpenses = expenses.reduce(function(s, e) { return s + toNumber(e.amount || e.total || 0) }, 0)
  var netProfit = totalProfit - totalExpenses
  var cashSalesTotal = sumNonCredit(invoices)
  var creditSalesTotal = sumCredit(invoices)
  var totalTax = sumTax(invoices)
  var avgTicket = invoices.length > 0 ? totalRevenue / invoices.length : 0

  var abonosFromPayments = payments.reduce(function(s, p) { return s + toNumber(p.amount) }, 0)

  return {
    generatedAt: now(),
    source: { invoiceCount: invoices.length, paymentCount: payments.length, receivableCount: receivables.length, expenseCount: expenses.length, creditNoteCount: creditNotes.length, productCount: products.length, customerCount: customers.length },
    totals: {
      totalRevenue: moneyValue(totalRevenue), totalProfit: moneyValue(totalProfit),
      netProfit: moneyValue(netProfit), totalExpenses: moneyValue(totalExpenses),
      cashSales: moneyValue(cashSalesTotal), creditSales: moneyValue(creditSalesTotal),
      totalTax: moneyValue(totalTax), avgTicket: moneyValue(avgTicket),
      receivablesBalance: moneyValue(receivablesBalance), overdueBalance: moneyValue(overdueBalance),
      abonosTotal: moneyValue(abonosFromPayments),
    },
    executiveSummary: {
      today: { sales: moneyValue(sumTotal(todayInvoices)), count: todayInvoices.length, profit: moneyValue(sumEffectiveProfit(todayInvoices)), tax: moneyValue(sumTax(todayInvoices)) },
      week: { sales: moneyValue(sumTotal(weekInvoices)), count: weekInvoices.length },
      month: { sales: moneyValue(sumTotal(monthInvoices)), count: monthInvoices.length, profit: moneyValue(sumEffectiveProfit(monthInvoices)), tax: moneyValue(sumTax(monthInvoices)) },
      year: { sales: moneyValue(sumTotal(yearInvoices)), count: yearInvoices.length },
      indicators: [
        { id: 'totalSales', label: 'Ventas totales', value: moneyValue(totalRevenue), formatted: money(totalRevenue), icon: 'DollarSign', color: 'blue' },
        { id: 'totalProfit', label: 'Ganancia total', value: moneyValue(totalProfit), formatted: money(totalProfit), icon: 'TrendingUp', color: 'green' },
        { id: 'netProfit', label: 'Ganancia neta', value: moneyValue(netProfit), formatted: money(netProfit), icon: 'Wallet', color: netProfit >= 0 ? 'green' : 'red' },
        { id: 'totalExpenses', label: 'Gastos', value: moneyValue(totalExpenses), formatted: money(totalExpenses), icon: 'CreditCard', color: 'amber' },
        { id: 'avgTicket', label: 'Ticket promedio', value: moneyValue(avgTicket), formatted: money(avgTicket), icon: 'Receipt', color: 'purple' },
        { id: 'totalTax', label: 'ITBIS cobrado', value: moneyValue(totalTax), formatted: money(totalTax), icon: 'FileText', color: 'purple' },
        { id: 'receivablesBalance', label: 'Cuentas por cobrar', value: moneyValue(receivablesBalance), formatted: money(receivablesBalance), icon: 'Clock', color: 'amber' },
        { id: 'overdueBalance', label: 'Vencido', value: moneyValue(overdueBalance), formatted: money(overdueBalance), icon: 'AlertTriangle', color: 'red' },
      ],
    },
    cashSales: { total: moneyValue(cashSalesTotal), count: cashInvoices.length, formatted: money(cashSalesTotal) },
    creditSales: { total: moneyValue(creditSalesTotal), count: creditInvoices.length, formatted: money(creditSalesTotal), paidTotal: moneyValue(abonosFromPayments), pendingTotal: moneyValue(receivablesBalance) },
    accountsReceivable: {
      count: validReceivables.length,
      pendingTotal: moneyValue(receivablesBalance),
      overdueCount: overdueInvoices.length,
      overdueTotal: moneyValue(overdueBalance),
      aging: (function() {
        var buckets = { '0-30': { count: 0, total: 0 }, '31-60': { count: 0, total: 0 }, '61-90': { count: 0, total: 0 }, '90+': { count: 0, total: 0 } }
        crInvsWithBalance.forEach(function(inv) {
          var due = new Date(inv.dueDate || inv.issuedAt || inv.createdAt || nowDate)
          var daysOverdue = Math.max(0, Math.floor((nowDate - due) / (1000 * 60 * 60 * 24)))
          var pend = effectivePending(inv)
          var key = daysOverdue <= 30 ? '0-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+'
          buckets[key].count += 1; buckets[key].total += pend
        })
        return Object.entries(buckets).filter(function(e) { return e[1].count > 0 }).map(function(e) { return { range: e[0], count: e[1].count, total: moneyValue(e[1].total) } })
      })(),
    },
    profitability: { revenue: moneyValue(totalRevenue), profit: moneyValue(totalProfit), expenses: moneyValue(totalExpenses), netProfit: moneyValue(netProfit), margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0 },
    averageTicket: { total: moneyValue(avgTicket), count: invoices.length, formatted: money(avgTicket) },
    taxSummary: { total: moneyValue(totalTax), count: invoices.filter(function(i) { return invoiceTax(i) > 0 }).length },
    topProducts: topProducts,
    topCustomers: topCustomers,
    monthlySeries: monthlySeries,
  }
}

export function auditIntegrity(data) {
  var companyId = data.companyId || ''
  var issues = []
  var validInvoiceIds = new Set((data.invoices || []).filter(function(i) { return !isVoidedInvoice(i) }).map(function(i) { return i.id }))
  var allInvoiceIds = new Set((data.invoices || []).map(function(i) { return i.id }))
  var validProductIds = new Set((data.products || []).filter(function(p) { return isActiveProduct(p, companyId) }).map(function(p) { return p.id }))
  var allPaymentIds = new Set((data.payments || []).map(function(p) { return p.id }))

  ;(data.receivables || []).forEach(function(r) {
    if (!r.invoiceId) { issues.push({ type: 'huérfano', entity: 'CxC', id: r.id, detail: 'No tiene invoiceId' }); return }
    if (!allInvoiceIds.has(r.invoiceId)) { issues.push({ type: 'huérfano', entity: 'CxC', id: r.id, detail: 'Factura ' + r.invoiceId + ' no existe' }); return }
    var inv = (data.invoices || []).find(function(i) { return i.id === r.invoiceId })
    if (inv && isVoidedInvoice(inv)) { issues.push({ type: 'huérfano', entity: 'CxC', id: r.id, detail: 'Factura ' + (inv.number || inv.ncf) + ' está ' + inv.status }) }
    if (r.balance <= 0 && r.status !== 'paid') { issues.push({ type: 'inconsistencia', entity: 'CxC', id: r.id, detail: 'balance=0 pero status=' + r.status }) }
  })

  ;(data.payments || []).forEach(function(p) {
    if (p.invoiceId && !allInvoiceIds.has(p.invoiceId)) { issues.push({ type: 'huérfano', entity: 'Pago', id: p.id, detail: 'Factura ' + p.invoiceId + ' no existe' }) }
    var recv = (data.receivables || []).find(function(r) { return r.id === p.receivableId })
    if (p.receivableId && !recv) { issues.push({ type: 'huérfano', entity: 'Pago', id: p.id, detail: 'CxC ' + p.receivableId + ' no existe' }) }
    if (p.status === 'active' && p.balanceBefore != null && p.balanceAfter != null && Math.abs(toNumber(p.balanceBefore) - toNumber(p.amount) - toNumber(p.balanceAfter)) > 0.01) {
      issues.push({ type: 'inconsistencia', entity: 'Pago', id: p.id, detail: 'balanceBefore=' + p.balanceBefore + ' - amount=' + p.amount + ' != balanceAfter=' + p.balanceAfter })
    }
  })

  ;(data.creditNotes || []).forEach(function(n) {
    if (n.invoiceId && !allInvoiceIds.has(n.invoiceId)) { issues.push({ type: 'huérfano', entity: 'NC', id: n.id, detail: 'Factura ' + n.invoiceId + ' no existe' }) }
  })

  ;(data.inventoryMovements || []).forEach(function(m) {
    if (m.productId && !validProductIds.has(m.productId)) { issues.push({ type: 'huérfano', entity: 'MovInv', id: m.id, detail: 'Producto ' + m.productId + ' no existe o inactivo' }) }
  })

  ;(data.expenses || []).forEach(function(e) {
    if (e.status === 'cancelled' || e.status === 'cancelada' || e.status === 'deleted') return
    if (!e.invoiceId) return
    if (!allInvoiceIds.has(e.invoiceId)) { issues.push({ type: 'huérfano', entity: 'Gasto', id: e.id, detail: 'Factura ' + e.invoiceId + ' no existe' }) }
  })

  var creditInvoiceBalances = []
  ;(data.invoices || []).forEach(function(inv) {
    if (!isValidInvoice(inv) || isVoidedInvoice(inv)) return
    var isCredit = (inv.payments || []).some(function(p) { return isCreditMethod(p.method) }) || isCreditMethod(inv.paymentMethod)
    if (!isCredit) return
    var total = invoiceTotal(inv)
    var paid = toNumber(inv.paidAmount || 0)
    var balanceDue = toNumber(inv.balanceDue || 0)
    if (Math.abs(total - paid - balanceDue) > 1) {
      creditInvoiceBalances.push({ id: inv.id, number: inv.number || inv.ncf, total: money(total), paid: money(paid), balanceDue: money(balanceDue), diff: moneyValue(total - paid - balanceDue) })
    }
  })

  return {
    issues: issues,
    orphanReceivables: issues.filter(function(i) { return i.entity === 'CxC' && i.type === 'huérfano' }).length,
    orphanPayments: issues.filter(function(i) { return i.entity === 'Pago' && i.type === 'huérfano' }).length,
    orphanCreditNotes: issues.filter(function(i) { return i.entity === 'NC' && i.type === 'huérfano' }).length,
    orphanMovements: issues.filter(function(i) { return i.entity === 'MovInv' && i.type === 'huérfano' }).length,
    inconsistencies: issues.filter(function(i) { return i.type === 'inconsistencia' }).length,
    totalIssues: issues.length,
    creditInvoiceBalanceIssues: creditInvoiceBalances,
    details: issues.map(function(i) { return '[' + i.type + '] ' + i.entity + ' ' + i.id + ': ' + i.detail }),
  }
}

export function detectDuplicates(data) {
  var duplicates = []

  var seenIds = new Map()
  ;(data.invoices || []).concat(data.creditNotes || []).concat(data.receivables || []).concat(data.payments || []).concat(data.expenses || []).forEach(function(doc) {
    if (!doc || !doc.id) return
    if (seenIds.has(doc.id)) { duplicates.push({ type: 'id_duplicado', id: doc.id, entity1: seenIds.get(doc.id), entity2: doc.constructor ? doc.constructor.name : 'Documento' }) }
    else { seenIds.set(doc.id, doc.constructor ? doc.constructor.name : 'Documento') }
  })

  var seenNumbers = new Map()
  ;(data.invoices || []).forEach(function(inv) {
    if (!inv.number) return
    if (seenNumbers.has(inv.number)) { duplicates.push({ type: 'numero_duplicado', value: inv.number, id1: seenNumbers.get(inv.number), id2: inv.id }) }
    else { seenNumbers.set(inv.number, inv.id) }
  })

  var seenNcf = new Map()
  ;(data.invoices || []).forEach(function(inv) {
    if (!inv.ncf) return
    if (seenNcf.has(inv.ncf)) { duplicates.push({ type: 'ncf_duplicado', value: inv.ncf, id1: seenNcf.get(inv.ncf), id2: inv.id }) }
    else { seenNcf.set(inv.ncf, inv.id) }
  })

  var seenInvoiceIds = new Map()
  ;(data.payments || []).forEach(function(p) {
    if (!p.id || !p.invoiceId) return
    var key = p.invoiceId + '-' + p.id
    if (seenInvoiceIds.has(key)) { duplicates.push({ type: 'paymentId_invoiceId_duplicado', value: key, entity1: seenInvoiceIds.get(key), entity2: p.id }) }
    else { seenInvoiceIds.set(key, p.id) }
  })

  return duplicates
}

export function reconcileInventory(data) {
  var companyId = data.companyId || ''
  var products = (data.products || []).filter(function(p) { return isActiveProduct(p, companyId) })
  var movements = (data.inventoryMovements || [])

  var STOCK_IN = new Set(['entrada', 'stock_inicial', 'ajuste_positivo', 'salida_revertida', 'nota_credito_entrada'])
  var STOCK_OUT = new Set(['salida', 'ajuste_negativo', 'entrada_revertida'])

  var computedStock = {}
  movements.forEach(function(m) {
    if (!m.productId) return
    if (!computedStock[m.productId]) computedStock[m.productId] = 0
    var qty = toNumber(m.quantity)
    if (STOCK_IN.has(m.type)) computedStock[m.productId] += qty
    else if (STOCK_OUT.has(m.type)) computedStock[m.productId] -= qty
  })

  var discrepancies = []
  products.forEach(function(p) {
    var expected = computedStock[p.id] || 0
    var actual = toNumber(p.stock)
    if (Math.abs(expected - actual) > 0.01) {
      discrepancies.push({ productId: p.id, name: p.name, sku: p.sku, expectedStock: expected, actualStock: actual, diff: moneyValue(expected - actual) })
    }
  })

  var totalExpected = Object.values(computedStock).reduce(function(s, v) { return s + v }, 0)
  var totalActual = products.reduce(function(s, p) { return s + toNumber(p.stock) }, 0)

  return {
    discrepancies: discrepancies,
    productCount: products.length,
    productsWithIssues: discrepancies.length,
    totalActualStock: totalActual,
    totalExpectedStock: totalExpected,
    diff: moneyValue(totalExpected - totalActual),
  }
}

export function reconcileFinancials(data) {
  var companyId = data.companyId || ''
  var invoices = (data.invoices || []).filter(function(inv) { return isReportableInvoice(inv, companyId) })
  var payments = (data.payments || []).filter(function(p) { return isActivePayment(p, invoices, data.receivables, companyId) })
  var expenses = (data.expenses || []).filter(function(e) { return isActiveExpense(e, companyId) })
  var creditNotes = (data.creditNotes || []).filter(function(n) { return isActiveCreditNote(n, companyId) })
  var cashRegister = data.cashRegister || {}

  var cashSalesTotal = invoices.reduce(function(s, inv) {
    var ps = inv.payments && inv.payments.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: invoiceTotal(inv) }]
    return s + ps.filter(function(p) { return !isCreditMethod(p.method) }).reduce(function(s2, p) { return s2 + toNumber(p.amount) }, 0)
  }, 0)

  var abonosTotal = payments.reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
  var creditNoteRefunds = creditNotes.reduce(function(s, n) { return s + toNumber(n.totals?.total || 0) }, 0)
  var expensesTotal = expenses.reduce(function(s, e) { return s + toNumber(e.amount || e.total || 0) }, 0)

  var expectedCashIncome = cashSalesTotal + abonosTotal - creditNoteRefunds
  var expectedCashBalance = expectedCashIncome - expensesTotal

  var movements = cashRegister.movements || []
  var registerExpected = movements.reduce(function(s, m) {
    var amt = toNumber(m.amount)
    if (m.type === 'expense' || m.type === 'withdrawal' || m.type === 'retiro') return s - amt
    return s + amt
  }, toNumber(cashRegister.openingAmount))

  var registerCounted = toNumber(cashRegister.counted)

  var diff = moneyValue(registerExpected - expectedCashBalance)

  return {
    cashSalesTotal: moneyValue(cashSalesTotal),
    abonosTotal: moneyValue(abonosTotal),
    creditNoteRefunds: moneyValue(creditNoteRefunds),
    expensesTotal: moneyValue(expensesTotal),
    expectedCashIncome: moneyValue(expectedCashIncome),
    expectedCashBalance: moneyValue(expectedCashBalance),
    registerExpected: moneyValue(registerExpected),
    registerCounted: moneyValue(registerCounted),
    registerDifference: moneyValue(registerExpected - registerCounted),
    reconciliationDiff: diff,
    status: Math.abs(diff) < 0.01 ? 'ok' : 'discrepancia',
  }
}

export function systemHealth(data) {
  var integrity = auditIntegrity(data)
  var duplicates = detectDuplicates(data)
  var inventory = reconcileInventory(data)
  var financials = reconcileFinancials(data)
  var reports = rebuildReports(data)

  var totalProblems = integrity.totalIssues + duplicates.length + inventory.productsWithIssues + (financials.status !== 'ok' ? 1 : 0)

  var scores = {
    integrityScore: integrity.totalIssues === 0 ? 100 : Math.max(0, 100 - integrity.totalIssues * 10),
    duplicateScore: duplicates.length === 0 ? 100 : Math.max(0, 100 - duplicates.length * 20),
    inventoryScore: inventory.productsWithIssues === 0 ? 100 : Math.max(0, 100 - inventory.productsWithIssues * 5),
    financialScore: financials.status === 'ok' ? 100 : 50,
  }

  var overall = Math.round(Object.values(scores).reduce(function(s, v) { return s + v }, 0) / Object.keys(scores).length)

  var level = overall >= 95 ? 'EXCELENTE' : overall >= 80 ? 'BUENO' : overall >= 60 ? 'REGULAR' : 'CRITICO'

  return {
    generatedAt: now(),
    overallScore: overall,
    overallLevel: level,
    scores: scores,
    totalProblems: totalProblems,
    integrity: {
      totalIssues: integrity.totalIssues,
      orphans: integrity.orphanReceivables + integrity.orphanPayments + integrity.orphanCreditNotes + integrity.orphanMovements,
      inconsistencies: integrity.inconsistencies,
      creditInvoiceBalanceIssues: integrity.creditInvoiceBalanceIssues.length,
    },
    duplicates: { count: duplicates.length, items: duplicates.slice(0, 20) },
    inventory: { totalProducts: inventory.productCount, productsWithIssues: inventory.productsWithIssues, discrepancies: inventory.discrepancies.slice(0, 20) },
    financials: { status: financials.status, reconciliationDiff: financials.reconciliationDiff, expectedCashBalance: financials.expectedCashBalance, registerExpected: financials.registerExpected },
    reports: reports,
  }
}
