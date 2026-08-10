import { isActiveCreditNote, isActiveExpense, isActivePayment, isReportableInvoice, sanitizeCashRegister } from './realDataGuards.js'

export const chartOfAccounts = [
  { code: '1010', name: 'Caja general', type: 'Activo', normalBalance: 'Debito', description: 'Efectivo recibido y salidas de caja.' },
  { code: '1020', name: 'Banco / transferencias', type: 'Activo', normalBalance: 'Debito', description: 'Cobros y pagos por transferencia bancaria.' },
  { code: '1030', name: 'Tarjetas por cobrar', type: 'Activo', normalBalance: 'Debito', description: 'Ventas cobradas con tarjeta pendientes de liquidacion.' },
  { code: '1100', name: 'Cuentas por cobrar clientes', type: 'Activo', normalBalance: 'Debito', description: 'Facturas a credito y cobros aplicados.' },
  { code: '1200', name: 'Inventario', type: 'Activo', normalBalance: 'Debito', description: 'Costo de productos disponibles para venta.' },
  { code: '2010', name: 'ITBIS por pagar', type: 'Pasivo', normalBalance: 'Credito', description: 'ITBIS generado por ventas menos ajustes.' },
  { code: '2100', name: 'Cuentas por pagar', type: 'Pasivo', normalBalance: 'Credito', description: 'Obligaciones pendientes con suplidores.' },
  { code: '4010', name: 'Ingresos por ventas', type: 'Ingreso', normalBalance: 'Credito', description: 'Ingresos netos por facturacion.' },
  { code: '4020', name: 'Devoluciones y notas de credito', type: 'Contra ingreso', normalBalance: 'Debito', description: 'Reversas comerciales que reducen ingresos.' },
  { code: '5010', name: 'Costo de ventas', type: 'Costo', normalBalance: 'Debito', description: 'Costo del inventario vendido.' },
  { code: '6010', name: 'Gastos operativos', type: 'Gasto', normalBalance: 'Debito', description: 'Gastos administrativos y operativos.' },
  { code: '6020', name: 'Diferencia de caja', type: 'Gasto', normalBalance: 'Debito', description: 'Sobrantes o faltantes detectados en cierre.' },
]

const accountByCode = new Map(chartOfAccounts.map((account) => [account.code, account]))

export function buildAccountingJournal({ invoices = [], creditNotes = [], payments = [], expenses = [], cashRegister = {}, company = {}, receivables = [], companyId = company?.id || '' } = {}) {
  const validInvoices = invoices.filter((invoice) => isReportableInvoice(invoice, companyId))
  const validCreditNotes = creditNotes.filter((note) => isActiveCreditNote(note, companyId))
  const validReceivables = receivables.filter((receivable) => receivable?.id && !receivable.deletedAt)
  const validPayments = payments.filter((payment) => isActivePayment(payment, validInvoices, validReceivables, companyId))
  const validExpenses = expenses.filter((expense) => isActiveExpense(expense, companyId))
  const cleanCashRegister = sanitizeCashRegister(cashRegister, companyId)
  const entries = [
    ...validInvoices.map(invoiceEntry),
    ...validCreditNotes.map(creditNoteEntry),
    ...validPayments.map(paymentEntry),
    ...validExpenses.map(expenseEntry),
    ...validExpenses.flatMap(payablePaymentEntries),
    ...cashClosingEntries(cleanCashRegister),
  ]
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((entry, index) => ({ ...entry, number: entry.number || `AS-${String(entriesDate(entry)).replaceAll('-', '')}-${String(index + 1).padStart(4, '0')}` }))

  const lines = entries.flatMap((entry) => entry.lines.map((line, index) => {
    const account = accountByCode.get(line.accountCode) || {}
    const debit = roundMoney(line.debit || 0)
    const credit = roundMoney(line.credit || 0)
    return {
      id: `${entry.id}-${index}`,
      entryId: entry.id,
      number: entry.number,
      date: entry.date,
      description: line.memo || entry.description,
      entryDescription: entry.description,
      reference: entry.reference,
      user: entry.user,
      branch: entry.branch,
      movementType: entry.type,
      source: entry.source || '',
      documentNumber: entry.documentNumber || entry.reference || '',
      customerName: entry.customerName || '',
      paymentMethod: entry.paymentMethod || '',
      accountCode: line.accountCode,
      accountName: account.name || line.accountName || '',
      accountType: account.type || '',
      normalBalance: account.normalBalance || '',
      accountDescription: account.description || '',
      debit,
      credit,
      amount: roundMoney(debit || credit),
      side: debit ? 'Debito' : 'Credito',
      entryLine: index + 1,
      entryLineCount: entry.lines.length,
    }
  }))
  const totals = lines.reduce((sum, line) => ({
    debit: roundMoney(sum.debit + line.debit),
    credit: roundMoney(sum.credit + line.credit),
  }), { debit: 0, credit: 0 })
  const ledger = buildGeneralLedger(lines)

  return {
    company,
    accounts: chartOfAccounts,
    entries: entries.map(enrichEntry),
    lines,
    ledger,
    totals,
    balanced: Math.abs(totals.debit - totals.credit) < 0.01,
    generatedAt: new Date().toISOString(),
  }
}

export function buildGeneralLedger(lines = []) {
  const grouped = new Map()
  lines
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((line) => {
      const current = grouped.get(line.accountCode) || {
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: 0,
        credit: 0,
        balance: 0,
        lines: [],
      }
      current.debit = roundMoney(current.debit + line.debit)
      current.credit = roundMoney(current.credit + line.credit)
      current.balance = roundMoney(current.debit - current.credit)
      current.lines.push({ ...line, balance: current.balance })
      grouped.set(line.accountCode, current)
    })
  return [...grouped.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
}

function invoiceEntry(invoice) {
  const total = roundMoney(invoice.totals?.total || 0)
  const tax = roundMoney(invoice.totals?.itbis || invoice.totals?.tax || 0)
  const subtotal = roundMoney(invoice.totals?.subtotal || total - tax)
  const cost = roundMoney(invoice.totals?.cost || invoice.items?.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.quantity || 0), 0))
  const paymentLines = splitPayments(invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'Efectivo', amount: total }])
  const lines = [
    ...paymentLines.map((payment) => ({ accountCode: payment.accountCode, debit: payment.amount })),
    { accountCode: '4010', credit: subtotal },
  ]
  if (tax) lines.push({ accountCode: '2010', credit: tax })
  if (cost) lines.push({ accountCode: '5010', debit: cost }, { accountCode: '1200', credit: cost })
  return compactEntry({
    id: `journal-invoice-${invoice.id}`,
    date: invoice.issuedAt || invoice.createdAt || invoice.issueDate,
    type: 'Venta',
    source: 'Facturacion',
    description: `Factura ${invoice.number || invoice.ncf || ''}`.trim(),
    reference: invoice.ncf || invoice.number || invoice.id,
    documentNumber: invoice.number || invoice.ncf || invoice.id,
    customerName: invoice.customerName || '',
    paymentMethod: (invoice.payments || []).map((payment) => payment.method).join(', ') || invoice.paymentMethod || '',
    user: invoice.seller || 'Sistema',
    branch: invoice.branchName || invoice.branchId || '',
    lines,
  })
}

function creditNoteEntry(note) {
  const total = roundMoney(note.totals?.total || 0)
  const tax = roundMoney(note.totals?.itbis || 0)
  const subtotal = roundMoney(note.totals?.subtotal || total - tax)
  const cost = roundMoney(note.totals?.cost || note.items?.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.quantity || 0), 0))
  const refundLines = splitPayments(note.payments?.length ? note.payments : [{ method: 'Efectivo', amount: total }])
  const lines = [
    { accountCode: '4020', debit: subtotal },
    ...refundLines.map((payment) => ({ accountCode: payment.accountCode, credit: payment.amount })),
  ]
  if (tax) lines.push({ accountCode: '2010', debit: tax })
  if (cost) lines.push({ accountCode: '1200', debit: cost }, { accountCode: '5010', credit: cost })
  return compactEntry({
    id: `journal-credit-${note.id}`,
    date: note.createdAt || note.updatedAt,
    type: 'Nota de credito',
    source: 'Facturacion',
    description: `Nota de credito ${note.number || note.ncf || ''}`.trim(),
    reference: note.invoiceNumber || note.invoiceId,
    documentNumber: note.number || note.ncf || note.id,
    customerName: note.customerName || '',
    paymentMethod: (note.payments || []).map((payment) => payment.method).join(', ') || '',
    user: note.user || 'Sistema',
    branch: note.branchName || note.branchId || '',
    lines,
  })
}

function paymentEntry(payment) {
  const amount = roundMoney(payment.amount || 0)
  if (!amount) return null
  const [{ accountCode }] = splitPayments([{ method: payment.method, amount }])
  return compactEntry({
    id: `journal-payment-${payment.id}`,
    date: payment.date || payment.createdAt,
    type: 'Cobro CxC',
    source: 'Cuentas por cobrar',
    description: `Cobro factura ${payment.invoiceId || ''}`.trim(),
    reference: payment.reference || payment.invoiceId,
    documentNumber: payment.invoiceNumber || payment.invoiceId || payment.id,
    customerName: payment.customerName || '',
    paymentMethod: payment.method || '',
    user: payment.user || 'Sistema',
    branch: payment.branchName || payment.branchId || '',
    lines: [
      { accountCode, debit: amount },
      { accountCode: '1100', credit: amount },
    ],
  })
}

function expenseEntry(expense) {
  const amount = roundMoney(expense.amount || expense.total || 0)
  if (!amount) return null
  const isPayable = String(expense.type || '').toLowerCase() === 'account_payable'
  return compactEntry({
    id: `journal-expense-${expense.id}`,
    date: expense.date || expense.createdAt || expense.updatedAt,
    type: isPayable ? 'Cuenta por pagar' : 'Gasto',
    source: isPayable ? 'Cuentas por pagar' : 'Gastos',
    description: expense.concept || expense.description || 'Gasto operativo',
    reference: expense.reference || expense.id,
    documentNumber: expense.reference || expense.id,
    paymentMethod: expense.method || '',
    user: expense.user || 'Sistema',
    branch: expense.branchName || expense.branchId || '',
    lines: [
      { accountCode: '6010', debit: amount },
      { accountCode: isPayable ? '2100' : methodAccount(expense.method), credit: amount },
    ],
  })
}

function payablePaymentEntries(expense) {
  if (String(expense.type || '').toLowerCase() !== 'account_payable') return []
  return (expense.payments || []).map((payment) => {
    const amount = roundMoney(payment.amount || 0)
    if (!amount) return null
    return compactEntry({
      id: `journal-payable-payment-${payment.id}`,
      date: payment.date || payment.createdAt,
      type: 'Pago CxP',
      source: 'Cuentas por pagar',
      description: `Pago a proveedor ${expense.supplierName || expense.vendor || ''}`.trim(),
      reference: payment.reference || expense.reference || expense.id,
      documentNumber: expense.reference || expense.id,
      paymentMethod: payment.method || '',
      user: payment.user || 'Sistema',
      branch: payment.branchName || payment.branchId || '',
      lines: [
        { accountCode: '2100', debit: amount },
        { accountCode: methodAccount(payment.method), credit: amount },
      ],
    })
  }).filter(Boolean)
}

function cashClosingEntries(cashRegister = {}) {
  if (!cashRegister.closedAt) return []
  const difference = roundMoney(Number(cashRegister.counted || 0) - Number(cashRegister.expected || 0))
  if (!difference) return []
  return [compactEntry({
    id: `journal-cash-close-${cashRegister.id || cashRegister.closedAt}`,
    date: cashRegister.closedAt,
    type: 'Cierre de caja',
    source: 'Caja',
    description: 'Diferencia de cierre de caja',
    reference: cashRegister.id || '',
    user: cashRegister.closedBy || cashRegister.cashier || 'Sistema',
    branch: cashRegister.branchName || cashRegister.branchId || '',
    lines: difference > 0
      ? [{ accountCode: '1010', debit: difference }, { accountCode: '6020', credit: difference }]
      : [{ accountCode: '6020', debit: Math.abs(difference) }, { accountCode: '1010', credit: Math.abs(difference) }],
  })]
}

function splitPayments(payments = []) {
  return payments
    .map((payment) => ({ accountCode: methodAccount(payment.method), amount: roundMoney(payment.amount || 0) }))
    .filter((payment) => payment.amount > 0)
}

function methodAccount(method = '') {
  const value = String(method || '').toLowerCase()
  if (value.includes('credito') || value.includes('crédito')) return '1100'
  if (value.includes('transfer')) return '1020'
  if (value.includes('tarjeta')) return '1030'
  return '1010'
}

function compactEntry(entry) {
  const lines = (entry.lines || [])
    .map((line) => ({ ...line, debit: roundMoney(line.debit || 0), credit: roundMoney(line.credit || 0) }))
    .filter((line) => line.debit || line.credit)
  if (!lines.length) return null
  return { ...entry, date: parseDate(entry.date).toISOString(), lines }
}

function enrichEntry(entry) {
  const debit = roundMoney(entry.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0))
  const credit = roundMoney(entry.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0))
  return {
    ...entry,
    debit,
    credit,
    difference: roundMoney(debit - credit),
    balanced: Math.abs(debit - credit) < 0.01,
    explanation: explainEntry(entry),
  }
}

function explainEntry(entry) {
  const debitAccounts = entry.lines.filter((line) => line.debit).map((line) => accountByCode.get(line.accountCode)?.name || line.accountCode).join(', ')
  const creditAccounts = entry.lines.filter((line) => line.credit).map((line) => accountByCode.get(line.accountCode)?.name || line.accountCode).join(', ')
  return `${entry.type}: debita ${debitAccounts || 'N/A'} y acredita ${creditAccounts || 'N/A'} por ${entry.description}.`
}

function entriesDate(entry) {
  return parseDate(entry.date).toISOString().slice(0, 10)
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
