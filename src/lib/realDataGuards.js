export const INVALID_STATUSES = new Set(['deleted', 'eliminado', 'eliminada', 'cancelled', 'canceled', 'cancelado', 'cancelada', 'voided', 'anulada', 'anulado'])
export const INVALID_INVOICE_STATUSES = new Set(['deleted', 'eliminado', 'cancelled', 'canceled', 'cancelado', 'cancelada', 'voided', 'anulada', 'anulado'])
const VALID_INVOICE_STATUSES = new Set(['paid', 'pagada', 'credit', 'credito', 'partial', 'parcial', 'open', 'issued', 'emitida'])

export function normalizedStatus(record) {
  return String(record?.status || record?.estado || '').trim().toLowerCase()
}

export function isExistingRecord(record) {
  return Boolean(record && typeof record === 'object' && record.id)
}

export function isDeletedRecord(record) {
  const status = normalizedStatus(record)
  return INVALID_STATUSES.has(status)
}

export function belongsToCompany(record, companyId) {
  if (!companyId || !record) return true
  const owner = record.companyId || record.tenantId
  return !owner || owner === companyId
}

export function isActiveRecord(record, companyId) {
  return isExistingRecord(record) && belongsToCompany(record, companyId) && !isDeletedRecord(record)
}

export function isActiveProduct(product, companyId) {
  const status = normalizedStatus(product)
  return isActiveRecord(product, companyId) && status !== 'inactivo' && status !== 'inactive'
}

export function isActiveCustomer(customer, companyId) {
  const status = normalizedStatus(customer)
  return isActiveRecord(customer, companyId) && status !== 'inactivo' && status !== 'inactive'
}

export function isReportableInvoice(invoice, companyId) {
  if (!isExistingRecord(invoice) || !belongsToCompany(invoice, companyId)) return false
  const status = normalizedStatus(invoice)
  if (INVALID_INVOICE_STATUSES.has(status)) return false
  return Array.isArray(invoice.items) && invoice.items.length > 0 && Number(invoice?.totals?.total ?? invoice?.total ?? 0) > 0
}

export function isActiveCreditNote(note, companyId) {
  if (!isExistingRecord(note) || !belongsToCompany(note, companyId)) return false
  const status = normalizedStatus(note)
  if (INVALID_INVOICE_STATUSES.has(status) || status === 'draft') return false
  return Array.isArray(note.items) && note.items.length > 0 && Number(note?.totals?.total ?? note?.total ?? 0) > 0
}

export function isActiveReceivable(receivable, invoices = [], companyId) {
  if (!isActiveRecord(receivable, companyId)) return false
  const status = normalizedStatus(receivable)
  if (status === 'paid' || status === 'cancelled' || status === 'cancelado') return false
  if (Number(receivable.balance || 0) <= 0) return false
  if (!receivable.invoiceId) return true
  const invoice = invoices.find((inv) => inv.id === receivable.invoiceId)
  if (!invoice) return false
  return isReportableInvoice(invoice, companyId)
}

export function isActiveExpense(expense, companyId) {
  if (!isActiveRecord(expense, companyId)) return false
  const status = normalizedStatus(expense)
  return status !== 'cancelled' && status !== 'cancelado'
}

export function isActivePayable(payable, companyId) {
  return isActiveExpense(payable, companyId)
    && String(payable?.type || '').toLowerCase() === 'account_payable'
    && Number(payable?.amount ?? payable?.total ?? 0) > 0
}

export function isActivePayment(payment, invoices = [], receivables = [], companyId) {
  if (!isActiveRecord(payment, companyId)) return false
  const status = normalizedStatus(payment)
  if (status === 'voided' || status === 'cancelled' || status === 'cancelado') return false
  if (!payment.invoiceId) return true
  const hasInvoice = invoices.some((invoice) => invoice.id === payment.invoiceId && isReportableInvoice(invoice, companyId))
  const hasReceivable = receivables.some((receivable) => receivable.invoiceId === payment.invoiceId && isActiveRecord(receivable, companyId))
  return hasInvoice || hasReceivable
}

export function isActiveCashMovement(movement, companyId, references = {}) {
  if (!isExistingRecord(movement) || !belongsToCompany(movement, companyId)) return false
  const status = normalizedStatus(movement)
  if (movement.deleted || status === 'deleted' || status === 'cancelled' || status === 'cancelado' || status === 'voided') return false
  return cashMovementHasValidSource(movement, references, companyId)
}

export function isActiveInventoryMovement(movement, products = [], invoices = [], companyId) {
  if (!isActiveRecord(movement, companyId)) return false
  if (movement.productId && !products.some((product) => product.id === movement.productId && isActiveProduct(product, companyId))) return false
  if (movement.invoiceId && !invoices.some((invoice) => invoice.id === movement.invoiceId && isReportableInvoice(invoice, companyId))) return false
  return true
}

export function sanitizeOperationalData(data = {}, companyId = '') {
  const products = (data.products || []).filter((product) => isActiveProduct(product, companyId))
  const customers = (data.customers || []).filter((customer) => isActiveCustomer(customer, companyId))
  const invoices = (data.invoices || []).filter((invoice) => isReportableInvoice(invoice, companyId))
  const creditNotes = (data.creditNotes || []).filter((note) => isActiveCreditNote(note, companyId))
  const expenses = (data.expenses || []).filter((expense) => isActiveExpense(expense, companyId))
  const receivables = (data.receivables || []).filter((receivable) => isActiveReceivable(receivable, invoices, companyId))
  const payments = (data.payments || []).filter((payment) => isActivePayment(payment, invoices, receivables, companyId))
  const cashRegister = sanitizeCashRegisterWithSources(data.cashRegister || {}, { invoices, creditNotes, expenses, receivables, payments }, companyId)
  const inventoryMovements = (data.inventoryMovements || []).filter((movement) => isActiveInventoryMovement(movement, products, invoices, companyId))
  return { products, customers, invoices, creditNotes, expenses, receivables, payments, cashRegister, inventoryMovements }
}

export function sanitizeCashRegister(cashRegister = {}, companyId = '') {
  return {
    ...cashRegister,
    movements: (cashRegister.movements || []).filter((movement) => isActiveCashMovement(movement, companyId)),
  }
}

export function sanitizeCashRegisterWithSources(cashRegister = {}, references = {}, companyId = '') {
  const movements = (cashRegister.movements || []).filter((movement) => isActiveCashMovement(movement, companyId, references))
  const expected = movements.reduce((total, movement) => total + cashMovementSignedAmount(movement), 0)
  return {
    ...cashRegister,
    expected: roundMoney(expected),
    movements,
  }
}

function cashMovementHasValidSource(movement, references = {}, companyId = '') {
  const source = String(movement.source || '').toLowerCase()
  const type = String(movement.type || '').toLowerCase()
  const manualTypes = new Set(['manual', 'opening'])
  if (source === 'manual' || manualTypes.has(type)) return true

  const invoices = references.invoices || []
  const creditNotes = references.creditNotes || []
  const expenses = references.expenses || []
  const receivables = references.receivables || []
  const payments = references.payments || []
  const hasReferenceData = invoices.length || creditNotes.length || expenses.length || receivables.length || payments.length
  if (!hasReferenceData) return true

  if (movement.payableId || source === 'payables' || type === 'payable_payment') {
    return expenses.some((expense) => expense.id === movement.payableId && isActivePayable(expense, companyId))
  }

  if (movement.creditNoteId || type === 'credit_note_refund' || normalizeText(movement.concept).includes('nota de credito')) {
    return creditNotes.some((note) => isActiveCreditNote(note, companyId) && cashMovementMatchesDocument(movement, note))
  }

  if (movement.paymentId) {
    return payments.some((payment) => payment.id === movement.paymentId && isActivePayment(payment, invoices, receivables, companyId))
  }

  if (movement.invoiceId || source === 'invoice' || type.includes('invoice') || normalizeText(movement.concept).includes('factura') || normalizeText(movement.concept).includes('pago ')) {
    return invoices.some((invoice) => isReportableInvoice(invoice, companyId) && cashMovementMatchesDocument(movement, invoice))
  }

  return source ? false : true
}

function cashMovementMatchesDocument(movement, document) {
  const tokens = [
    movement.invoiceId,
    movement.creditNoteId,
    movement.documentId,
    movement.reference,
    movement.concept,
    movement.note,
  ].map(normalizeText).filter(Boolean)
  const documentTokens = [
    document.id,
    document.number,
    document.ncf,
    document.reference,
    document.invoiceNumber,
  ].map(normalizeText).filter(Boolean)
  if (!documentTokens.length) return false
  return tokens.some((token) => documentTokens.some((documentToken) => token === documentToken || token.includes(documentToken)))
}

function cashMovementSignedAmount(movement) {
  const amount = Number(movement?.amount || 0)
  const type = String(movement?.type || '').toLowerCase()
  return ['expense', 'withdrawal', 'retiro', 'credit_note_refund', 'expense_adjustment', 'payable_payment', 'invoice_void_reversal', 'payment_void_reversal'].includes(type) ? -amount : amount
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
