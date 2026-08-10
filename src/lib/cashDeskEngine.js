import { isActiveCreditNote, isActiveExpense, isReportableInvoice, sanitizeCashRegisterWithSources } from './realDataGuards.js'

export const CASH_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Credito']

export function buildCashCutReport({ cashRegister = {}, invoices = [], creditNotes = [], expenses = [], receivables = [], payments = [], company = {}, branches = [], companyId = company?.id || cashRegister?.companyId || '' } = {}) {
  const openedAt = parseDate(cashRegister.openedAt || new Date())
  const closedAt = cashRegister.closedAt ? parseDate(cashRegister.closedAt) : new Date()
  const inSession = (value) => {
    const date = parseDate(value)
    return date.getTime() >= openedAt.getTime() && date.getTime() <= closedAt.getTime()
  }
  const sessionInvoices = invoices.filter((invoice) => isReportableInvoice(invoice, companyId) && inSession(invoice.issuedAt || invoice.createdAt || invoice.issueDate))
  const sessionNotes = creditNotes.filter((note) => isActiveCreditNote(note, companyId) && inSession(note.createdAt || note.updatedAt))
  const sessionExpenses = expenses.filter((expense) => isActiveExpense(expense, companyId) && String(expense.type || '').toLowerCase() !== 'account_payable' && inSession(expense.date || expense.createdAt || expense.updatedAt))
  const cleanCashRegister = sanitizeCashRegisterWithSources(cashRegister, { invoices, creditNotes, expenses, receivables, payments }, companyId)
  const movements = (cleanCashRegister.movements || []).filter((movement) => inSession(movement.createdAt || movement.date))
  const byMethod = summarizeMethods(sessionInvoices, sessionNotes)
  const movementSummary = summarizeMovements(movements)
  const discounts = sessionInvoices.reduce((sum, invoice) => sum + (invoice.items || []).reduce((inner, item) => inner + discountAmount(item), 0), 0)
  const tax = sessionInvoices.reduce((sum, invoice) => sum + Number(invoice.totals?.itbis || 0), 0)
  const grossSales = sessionInvoices.reduce((sum, invoice) => sum + Number(invoice.totals?.total || 0), 0)
  const returns = sessionNotes.reduce((sum, note) => sum + Number(note.totals?.total || 0), 0)
  const expenseTotal = sessionExpenses.reduce((sum, expense) => sum + Number(expense.amount || expense.total || 0), 0)
  const counted = Number(cashRegister.counted || 0)
  const expected = roundMoney(movements.reduce((sum, movement) => sum + cashMovementSignedAmount(movement), 0))
  const branch = branches.find((item) => item.id === cashRegister.branchId)

  const expectedByMethod = movements.reduce((map, movement) => {
    const method = movement.method === 'Reversa' || movement.method === 'Reembolso' ? 'Efectivo' : normalizeMethod(movement.method)
    const signed = cashMovementSignedAmount(movement)
    map[method] = roundMoney((map[method] || 0) + signed)
    return map
  }, {})

  return {
    companyName: company.name || company.legalName || '',
    rnc: company.rnc || '',
    branchName: cashRegister.branchName || branch?.name || 'Sucursal principal',
    cashName: cashRegister.name || 'Caja principal',
    cashier: cashRegister.cashier || cashRegister.openedBy || 'Usuario',
    openedAt: cashRegister.openedAt || '',
    closedAt: cashRegister.closedAt || '',
    openingAmount: Number(cashRegister.openingAmount || 0),
    expected,
    expectedByMethod,
    expectedCash: roundMoney((expectedByMethod['Efectivo'] || 0)),
    expectedCard: roundMoney((expectedByMethod['Tarjeta'] || 0)),
    expectedTransfer: roundMoney((expectedByMethod['Transferencia'] || 0)),
    counted,
    difference: counted - roundMoney((expectedByMethod['Efectivo'] || 0)),
    grossSales,
    returns,
    discounts,
    tax,
    expenses: expenseTotal,
    invoicesCount: sessionInvoices.length,
    transactionsCount: sessionInvoices.length + sessionNotes.length + movements.length,
    byMethod,
    movementSummary,
    movements,
    invoices: sessionInvoices,
    creditNotes: sessionNotes,
    generatedAt: new Date().toISOString(),
  }
}

export function normalizeCashOpenInput(input, fallback = {}) {
  if (typeof input === 'number' || typeof input === 'string') {
    return { amount: Number(input || 0), branchId: fallback.branchId || '', branchName: fallback.branchName || '', cashName: fallback.cashName || 'Caja principal', cashier: fallback.cashier || '' }
  }
  return {
    amount: Number(input?.amount || 0),
    branchId: input?.branchId || fallback.branchId || '',
    branchName: input?.branchName || fallback.branchName || '',
    cashName: input?.cashName || input?.name || fallback.cashName || 'Caja principal',
    cashier: input?.cashier || fallback.cashier || '',
  }
}

export function cashMovementSignedAmount(movement) {
  const amount = Number(movement.amount || 0)
  const type = String(movement.type || '').toLowerCase()
  return ['expense', 'withdrawal', 'retiro', 'credit_note_refund', 'expense_adjustment', 'payable_payment', 'invoice_void_reversal', 'payment_void_reversal'].includes(type) ? -amount : amount
}

function summarizeMethods(invoices, creditNotes) {
  const map = new Map()
  invoices.forEach((invoice) => {
    const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'Efectivo', amount: invoice.totals?.total || 0 }]
    payments.forEach((payment) => {
      const method = normalizeMethod(payment.method)
      const current = map.get(method) || { method, sales: 0, refunds: 0, net: 0, count: 0 }
      current.sales += Number(payment.amount || 0)
      current.count += 1
      map.set(method, current)
    })
  })
  creditNotes.forEach((note) => {
    const payments = note.payments?.length ? note.payments : [{ method: 'Efectivo', amount: note.totals?.total || 0 }]
    payments.forEach((payment) => {
      const method = normalizeMethod(payment.method)
      const current = map.get(method) || { method, sales: 0, refunds: 0, net: 0, count: 0 }
      current.refunds += Number(payment.amount || 0)
      map.set(method, current)
    })
  })
  return [...map.values()].map((item) => ({ ...item, net: item.sales - item.refunds })).sort((a, b) => b.net - a.net)
}

function summarizeMovements(movements) {
  return movements.reduce((summary, movement) => {
    const key = movement.type || 'movimiento'
    const current = summary[key] || { type: key, count: 0, amount: 0 }
    current.count += 1
    current.amount += cashMovementSignedAmount(movement)
    return { ...summary, [key]: current }
  }, {})
}

function discountAmount(item) {
  const quantity = Number(item.quantity || 0)
  const price = Number(item.price || 0)
  const discount = Number(item.discount || 0)
  if (!discount) return 0
  return (price * quantity * discount) / 100
}

function normalizeMethod(method = '') {
  const value = String(method || '').toLowerCase()
  if (value.includes('tarjeta')) return 'Tarjeta'
  if (value.includes('transfer')) return 'Transferencia'
  if (value.includes('credito') || value.includes('crédito')) return 'Credito'
  if (value === 'efectivo' || value === 'cash' || value === 'reversa' || value === 'reembolso') return 'Efectivo'
  return method || 'Efectivo'
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
