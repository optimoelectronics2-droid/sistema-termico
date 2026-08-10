function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function moneyValue(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100
}

export function assertOpenCashRegister(cashRegister, settings) {
  if (settings?.requireOpenRegister && cashRegister?.status !== 'open') {
    throw new Error('Caja cerrada: abre una caja antes de facturar.')
  }
}

export function assertUniqueSerials(serials, soldSerials = []) {
  const duplicates = serials.filter((serial, index) => serials.indexOf(serial) !== index)
  if (duplicates.length) throw new Error(`Serial duplicado en la venta: ${duplicates[0]}`)
  const soldSerialSet = new Set(soldSerials.map((entry) => typeof entry === 'string' ? entry : entry?.serial).filter(Boolean))
  const alreadySold = serials.find((serial) => soldSerialSet.has(serial))
  if (alreadySold) throw new Error(`El serial/IMEI ${alreadySold} ya fue vendido.`)
}

export function canVoidInvoice(invoice) {
  return invoice?.status !== 'voided'
}

// ─── New validations ────────────────────────────────────────────

export function assertPositiveAmount(amount, label) {
  const val = moneyValue(amount)
  if (val <= 0) throw new Error(`${label}: el monto debe ser mayor a cero (recibido: ${amount}).`)
}

export function assertNonNegativeAmount(amount, label) {
  const val = moneyValue(amount)
  if (val < 0) throw new Error(`${label}: el monto no puede ser negativo (recibido: ${amount}).`)
}

export function assertInvoiceLineItems(lines, inventory) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('La factura debe tener al menos una linea de producto.')
  for (const [idx, line] of lines.entries()) {
    assertPositiveAmount(line.quantity, `Linea ${idx + 1}: cantidad`)
    assertPositiveAmount(line.price, `Linea ${idx + 1}: precio unitario`)
    const product = inventory?.find((p) => p.id === line.productId)
    if (product?.trackSerial && line.soldSerials?.length > 0 && line.soldSerials.length !== Number(line.quantity)) {
      throw new Error(`Linea ${idx + 1}: la cantidad de seriales (${line.soldSerials.length}) no coincide con la cantidad vendida (${line.quantity}).`)
    }
  }
}

export function assertStockAvailable(productId, quantity, inventory, soldSerials) {
  const product = inventory?.find((p) => p.id === productId)
  if (!product) return
  const available = Number(product.stock) || 0
  if (product.trackSerial && Array.isArray(soldSerials)) {
    for (const serial of soldSerials) {
      const serialStr = typeof serial === 'string' ? serial : serial?.serial
      if (!serialStr) continue
      const isAlreadySold = (product.soldSerials || []).some((s) => (typeof s === 'string' ? s : s?.serial) === serialStr)
      if (isAlreadySold) throw new Error(`El serial/IMEI ${serialStr} del producto ${product.name || productId} ya fue vendido.`)
    }
  }
  if (available < Number(quantity)) {
    throw new Error(`Stock insuficiente para ${product.name || productId}: disponible ${available}, solicitado ${quantity}.`)
  }
}

export function assertStockForLines(lines, inventory) {
  for (const line of lines) {
    assertStockAvailable(line.productId, line.quantity, inventory, line.soldSerials)
  }
}

export function assertUniqueNcf(ncf, invoices, excludeId) {
  if (!ncf) return
  const duplicate = (invoices || []).find((inv) => inv.ncf === ncf && inv.id !== excludeId && inv.status !== 'voided')
  if (duplicate) throw new Error(`El comprobante fiscal NCF ${ncf} ya fue asignado a la factura ${duplicate.number || duplicate.id}.`)
}

export function assertValidInvoiceDates(issueDate, dueDate) {
  if (!issueDate) throw new Error('La fecha de emision es obligatoria.')
  if (dueDate) {
    const issue = new Date(issueDate)
    const due = new Date(dueDate)
    if (due < issue) throw new Error('La fecha de vencimiento no puede ser anterior a la fecha de emision.')
  }
}

export function assertCustomerCreditLimit(customerId, amount, customers, receivables) {
  const customer = (customers || []).find((c) => c.id === customerId)
  if (!customer) return
  const creditLimit = moneyValue(customer.creditLimit || 0)
  if (creditLimit <= 0) return
  const currentBalance = moneyValue(customer.balance || 0)
  const newTotal = currentBalance + moneyValue(amount)
  if (newTotal > creditLimit) {
    throw new Error(
      `Limite de credito excedido para ${customer.name || customerId}: ` +
      `saldo actual RD$${currentBalance.toFixed(2)}, nuevo total RD$${newTotal.toFixed(2)}, ` +
      `limite RD$${creditLimit.toFixed(2)}.`
    )
  }
}

export function assertValidPayments(payments) {
  if (!Array.isArray(payments) || payments.length === 0) throw new Error('Debe registrar al menos un metodo de pago.')
  let totalPaid = 0
  for (const [idx, payment] of payments.entries()) {
    assertPositiveAmount(payment.amount, `Pago ${idx + 1}`)
    totalPaid += moneyValue(payment.amount)
  }
  return totalPaid
}

export function assertValidInventoryMovement(type, quantity, productId, inventory) {
  assertNonNegativeAmount(quantity, 'Cantidad del movimiento')
  if (type === 'exit' || type === 'SALE' || type === 'SALE_REVERSAL') {
    assertStockAvailable(productId, quantity, inventory)
  }
}
