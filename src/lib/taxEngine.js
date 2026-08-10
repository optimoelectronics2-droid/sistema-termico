export const ITBIS_RATE = 0.18

export const invoiceModes = {
  TAXED: 'taxed',
  NO_TAX: 'no_tax',
  MIXED: 'mixed',
}

export const ncfTypes = {
  B01: 'Credito fiscal',
  B02: 'Consumo',
  B04: 'Nota de credito',
  B14: 'Regimen especial',
  B15: 'Gubernamental',
  B16: 'Exportaciones',
  E31: 'e-CF credito fiscal',
  E32: 'e-CF consumo',
  E33: 'e-CF nota de debito',
  E34: 'e-CF nota de credito',
  E41: 'e-CF compras',
  E43: 'e-CF gastos menores',
}

export function calculateInvoice(items, mode = invoiceModes.TAXED) {
  const normalized = items.map((item) => {
    const quantity = Number(item.quantity || 1)
    const price = Number(item.price || 0)
    const discountPercent = Math.min(Math.max(Number(item.discount || 0), 0), 100)
    const taxable =
      mode === invoiceModes.NO_TAX ? false : mode === invoiceModes.TAXED ? true : Boolean(item.taxable)
    const gross = quantity * price
    const discountAmount = roundMoney(gross * (discountPercent / 100))
    const net = Math.max(gross - discountAmount, 0)
    const tax = taxable ? roundMoney(net * ITBIS_RATE) : 0
    return { ...item, quantity, price, discount: discountPercent, discountAmount, taxable, net: roundMoney(net), tax }
  })

  const taxableSubtotal = roundMoney(normalized.filter((i) => i.taxable).reduce((sum, i) => sum + i.net, 0))
  const exemptSubtotal = roundMoney(normalized.filter((i) => !i.taxable).reduce((sum, i) => sum + i.net, 0))
  const subtotal = roundMoney(taxableSubtotal + exemptSubtotal)
  const itbis = roundMoney(normalized.reduce((sum, i) => sum + i.tax, 0))
  const total = roundMoney(subtotal + itbis)
  const cost = roundMoney(normalized.reduce((sum, i) => sum + Number(i.cost || 0) * i.quantity, 0))
  const profit = roundMoney(subtotal - cost)

  return {
    mode,
    items: normalized,
    taxableSubtotal,
    exemptSubtotal,
    subtotal,
    itbis,
    total,
    cost,
    profit,
  }
}

export function nextNcf(sequence) {
  assertValidTaxSequence(sequence)
  const next = Number(sequence.next || sequence.current || 1)
  const padded = String(next).padStart(8, '0')
  return `${sequence.prefix}${padded}`
}

export function assertValidTaxSequence(sequence, at = new Date()) {
  if (!sequence) throw new Error('La secuencia fiscal no existe.')
  if (!sequence.enabled) throw new Error(`La secuencia ${sequence.id || sequence.prefix} no esta habilitada.`)
  const next = Number(sequence.next || sequence.current || 1)
  const limit = Number(sequence.limit || 0)
  if (!sequence.prefix) throw new Error(`La secuencia ${sequence.id || ''} no tiene prefijo fiscal.`)
  if (!Number.isFinite(next) || next <= 0) throw new Error(`La secuencia ${sequence.id || sequence.prefix} tiene un proximo numero invalido.`)
  if (limit > 0 && next > limit) throw new Error(`La secuencia ${sequence.id || sequence.prefix} esta fuera de rango.`)
  if (sequence.expiresAt) {
    const expiresAt = new Date(`${sequence.expiresAt}T23:59:59`)
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt < at) {
      throw new Error(`La secuencia ${sequence.id || sequence.prefix} esta vencida.`)
    }
  }
}

export function buildFiscalBuckets(invoices) {
  return invoices.reduce(
    (acc, invoice) => {
      const key = invoice.mode === invoiceModes.NO_TAX ? 'noTax' : invoice.mode === invoiceModes.MIXED ? 'mixed' : 'taxed'
      acc[key].count += 1
      acc[key].subtotal += invoice.totals?.subtotal || 0
      acc[key].itbis += invoice.totals?.itbis || 0
      acc[key].total += invoice.totals?.total || 0
      acc[key].profit += invoice.totals?.profit || 0
      return acc
    },
    {
      taxed: emptyBucket(),
      noTax: emptyBucket(),
      mixed: emptyBucket(),
    },
  )
}

function emptyBucket() {
  return { count: 0, subtotal: 0, itbis: 0, total: 0, profit: 0 }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}
