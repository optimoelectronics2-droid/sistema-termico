import { currency, formatDate } from './formatters'

const SEARCH_HISTORY_KEY = 'trifusion-global-search-history-v1'
const MAX_HISTORY = 8

const MODULES = [
  { id: 'dashboard', label: 'Dashboard ejecutivo', path: '/dashboard', keywords: ['inicio', 'kpi', 'ventas', 'ganancias', 'resumen'] },
  { id: 'pos', label: 'POS rapido', path: '/pos', keywords: ['facturar', 'venta', 'mostrador', 'cobrar'] },
  { id: 'facturas', label: 'Facturas', path: '/facturacion', keywords: ['factura', 'historial', 'documentos'] },
  { id: 'inventario', label: 'Inventario', path: '/inventario', keywords: ['stock', 'producto', 'kardex', 'imei', 'serial'] },
  { id: 'compras', label: 'Compras / entradas', path: '/inventario/entradas', keywords: ['compra', 'proveedor', 'entrada', 'recepcion'] },
  { id: 'clientes', label: 'Clientes', path: '/clientes', keywords: ['cliente', 'crm', 'frecuente'] },
  { id: 'cxc', label: 'Cuentas por cobrar', path: '/cxc', keywords: ['cxc', 'balance', 'credito', 'pendiente'] },
  { id: 'cxp', label: 'Cuentas por pagar', path: '/cxp', keywords: ['cxp', 'proveedor', 'suplidor', 'pendiente', 'pagar'] },
  { id: 'caja', label: 'Caja y movimientos', path: '/caja', keywords: ['caja', 'arqueo', 'efectivo', 'transferencia', 'tarjeta'] },
  { id: 'cotizaciones', label: 'Cotizaciones', path: '/cotizaciones', keywords: ['cotizacion', 'quote'] },
  { id: 'conduces', label: 'Conduces', path: '/conduces', keywords: ['conduce', 'entrega'] },
  { id: 'reportes', label: 'Reportes avanzados', path: '/reportes', keywords: ['reporte', 'excel', 'pdf', 'ganancia'] },
]

const INTENT_PATTERNS = [
  { id: 'ventas-hoy', label: 'Ventas de hoy', path: '/dashboard', query: 'ventas de hoy', keywords: ['ventas hoy', 'venta hoy', 'hoy'] },
  { id: 'productos-mas-vendidos', label: 'Productos mas vendidos', path: '/reportes', query: 'productos mas vendidos', keywords: ['mas vendidos', 'top productos'] },
  { id: 'clientes-frecuentes', label: 'Clientes frecuentes', path: '/reportes', query: 'clientes frecuentes', keywords: ['clientes frecuentes', 'top clientes'] },
  { id: 'stock-critico', label: 'Productos agotandose', path: '/inventario', query: 'stock critico', keywords: ['agotado', 'agotandose', 'stock bajo', 'critico'] },
  { id: 'sin-movimiento', label: 'Productos sin movimiento', path: '/reportes', query: 'productos sin movimiento', keywords: ['sin movimiento', 'sin rotacion'] },
  { id: 'ganancias', label: 'Mejores ganancias', path: '/dashboard', query: 'ganancia mes', keywords: ['ganancia', 'rentable', 'margen'] },
  { id: 'efectivo', label: 'Ventas en efectivo', path: '/reportes', query: 'efectivo', keywords: ['efectivo'] },
  { id: 'transferencia', label: 'Ventas por transferencia', path: '/reportes', query: 'transferencia', keywords: ['transferencia'] },
  { id: 'mixtas', label: 'Ventas mixtas', path: '/reportes', query: 'mixtas', keywords: ['mixta', 'mixtas'] },
]

export function buildGlobalSearchResults(state, query, options = {}) {
  const term = normalize(query)
  const limit = options.limit || 36
  const rows = [
    ...buildModuleResults(term),
    ...buildIntentResults(term),
    ...buildInvoiceResults(state.invoices || [], term),
    ...buildProductResults(state.products || [], term),
    ...buildCustomerResults(state.customers || [], term),
    ...buildPurchaseResults(state.productEntries || [], state.suppliers || [], term),
    ...buildInventoryMovementResults(state.inventoryMovements || [], term),
    ...buildCashResults(state.cashRegister?.movements || [], term),
    ...buildPayableResults(state.expenses || [], term),
    ...buildSimpleDocumentResults(state.quotes || [], term, 'Cotizacion', '/cotizaciones'),
    ...buildSimpleDocumentResults(state.conduces || [], term, 'Conduce', '/conduces'),
    ...buildSimpleDocumentResults(state.creditNotes || [], term, 'Nota de credito', '/reportes'),
    ...buildReceivableResults(state.receivables || [], term),
  ]

  return rows
    .filter((row) => term ? row.score > 0 : row.kind === 'Consulta')
    .sort((left, right) => right.score - left.score || String(left.title).localeCompare(String(right.title)))
    .slice(0, limit)
}

export function readSearchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

export function rememberSearch(query) {
  const value = String(query || '').trim()
  if (!value) return readSearchHistory()
  const next = [value, ...readSearchHistory().filter((item) => normalize(item) !== normalize(value))].slice(0, MAX_HISTORY)
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
  return next
}

export function clearSearchHistory() {
  localStorage.removeItem(SEARCH_HISTORY_KEY)
}

function buildModuleResults(term) {
  return MODULES.map((item) => {
    const haystack = normalize([item.label, item.id, ...item.keywords].join(' '))
    return {
      id: `module-${item.id}`,
      kind: 'Modulo',
      title: item.label,
      subtitle: 'Abrir modulo empresarial',
      meta: item.path,
      path: item.path,
      score: scoreText(haystack, term) + (term ? 0 : 18),
    }
  })
}

function buildIntentResults(term) {
  return INTENT_PATTERNS.map((item) => {
    const haystack = normalize([item.label, item.query, ...item.keywords].join(' '))
    return {
      id: `intent-${item.id}`,
      kind: 'Consulta',
      title: item.label,
      subtitle: 'Consulta basada en registros',
      meta: item.query,
      path: item.path,
      score: scoreText(haystack, term) + (term ? 8 : 26),
    }
  })
}

function buildInvoiceResults(invoices, term) {
  return invoices.map((invoice) => {
    const haystack = normalize([
      invoice.number,
      invoice.ncf,
      invoice.customerName,
      invoice.customerRnc,
      invoice.paymentMethod,
      invoice.seller,
      invoice.status,
      ...(invoice.payments || []).map((payment) => payment.method),
      ...(invoice.items || []).flatMap((item) => [item.name, item.sku, ...(item.serials || [])]),
    ].flat().join(' '))
    const total = Number(invoice.totals?.total || invoice.total || 0)
    return {
      id: `invoice-${invoice.id || invoice.number}`,
      kind: 'Factura',
      title: invoice.number || invoice.ncf || 'Factura',
      subtitle: `${invoice.customerName || 'Cliente'} · ${currency.format(total)}`,
      meta: formatDate(invoice.issuedAt || invoice.createdAt || invoice.issueDate),
      path: invoice.id ? `/facturacion/${invoice.id}` : '/facturacion',
      score: scoreText(haystack, term),
    }
  })
}

function buildProductResults(products, term) {
  return products.map((product) => {
    const haystack = normalize([
      product.name,
      product.sku,
      product.barcode,
      product.category,
      product.brand,
      product.model,
      product.location,
      ...(product.serials || []),
      ...(product.soldSerials || []).map((item) => item.serial || item),
    ].flat().join(' '))
    return {
      id: `product-${product.id}`,
      kind: 'Producto',
      title: product.name || 'Producto',
      subtitle: `${product.sku || 'Sin SKU'} · Stock ${Number(product.stock || 0)} · ${currency.format(product.price || 0)}`,
      meta: product.category || 'Inventario',
      path: '/inventario',
      score: scoreText(haystack, term),
    }
  })
}

function buildCustomerResults(customers, term) {
  return customers.map((customer) => {
    const haystack = normalize([customer.name, customer.rnc, customer.cedula, customer.document, customer.phone, customer.whatsapp, customer.email].join(' '))
    return {
      id: `customer-${customer.id}`,
      kind: 'Cliente',
      title: customer.name || 'Cliente',
      subtitle: [customer.rnc || customer.cedula, customer.phone || customer.whatsapp, customer.email].filter(Boolean).join(' · ') || 'Ficha de cliente',
      meta: currency.format(customer.balance || 0),
      path: '/clientes',
      score: scoreText(haystack, term),
    }
  })
}

function buildPurchaseResults(entries, suppliers, term) {
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
  return entries.map((entry) => {
    const haystack = normalize([
      entry.reference,
      entry.supplierInvoice,
      entry.supplierName,
      supplierMap.get(entry.supplierId),
      entry.type,
      ...(entry.items || []).flatMap((item) => [item.productName, item.sku, ...(item.serials || [])]),
    ].flat().join(' '))
    return {
      id: `purchase-${entry.id}`,
      kind: 'Compra',
      title: entry.reference || entry.supplierInvoice || 'Entrada de mercancia',
      subtitle: `${entry.supplierName || supplierMap.get(entry.supplierId) || 'Proveedor'} · ${currency.format(entry.total || 0)}`,
      meta: formatDate(entry.date || entry.createdAt),
      path: '/inventario/entradas',
      score: scoreText(haystack, term),
    }
  })
}

function buildInventoryMovementResults(movements, term) {
  return movements.map((movement) => {
    const haystack = normalize([movement.productName, movement.sku, movement.type, movement.reason, movement.documentNumber, movement.reference, ...(movement.serials || [])].flat().join(' '))
    return {
      id: `movement-${movement.id}`,
      kind: 'Movimiento',
      title: movement.productName || movement.documentNumber || 'Movimiento de inventario',
      subtitle: `${movement.type || 'Movimiento'} · ${movement.quantityBefore ?? '-'} -> ${movement.quantityAfter ?? '-'}`,
      meta: formatDate(movement.createdAt || movement.date),
      path: '/reportes',
      score: scoreText(haystack, term),
    }
  })
}

function buildCashResults(movements, term) {
  return movements.map((movement) => {
    const haystack = normalize([movement.type, movement.method, movement.concept, movement.reference].join(' '))
    return {
      id: `cash-${movement.id}`,
      kind: 'Caja',
      title: movement.concept || movement.type || 'Movimiento de caja',
      subtitle: `${movement.method || 'Metodo'} · ${currency.format(movement.amount || 0)}`,
      meta: formatDate(movement.createdAt),
      path: '/caja',
      score: scoreText(haystack, term),
    }
  })
}

function buildSimpleDocumentResults(rows, term, kind, path) {
  return rows.map((row) => {
    const haystack = normalize([row.number, row.ncf, row.customerName, row.status, row.reason, ...(row.items || []).map((item) => item.name)].flat().join(' '))
    return {
      id: `${kind}-${row.id || row.number}`,
      kind,
      title: row.number || row.ncf || kind,
      subtitle: `${row.customerName || 'Cliente'} · ${currency.format(row.totals?.total || row.total || 0)}`,
      meta: formatDate(row.createdAt || row.issuedAt || row.date),
      path,
      score: scoreText(haystack, term),
    }
  })
}

function buildReceivableResults(rows, term) {
  return rows.map((row) => {
    const haystack = normalize([row.customerName, row.invoiceNumber, row.status, row.dueDate].join(' '))
    return {
      id: `receivable-${row.id}`,
      kind: 'CxC',
      title: row.customerName || 'Cuenta por cobrar',
      subtitle: `${row.invoiceNumber || 'Factura'} · Balance ${currency.format(row.balance || 0)}`,
      meta: row.dueDate || '',
      path: '/cxc',
      score: scoreText(haystack, term),
    }
  })
}

function buildPayableResults(rows, term) {
  return rows
    .filter((row) => String(row.type || '').toLowerCase() === 'account_payable' && !row.deletedAt && !['cancelled', 'cancelado'].includes(String(row.status || '').toLowerCase()))
    .map((row) => {
      const haystack = normalize([row.supplierName, row.reference, row.concept, row.status, row.dueDate].join(' '))
      return {
        id: `payable-${row.id}`,
        kind: 'CxP',
        title: row.supplierName || 'Cuenta por pagar',
        subtitle: `${row.reference || 'Sin referencia'} · Balance ${currency.format(row.balance || row.amount || 0)}`,
        meta: row.dueDate || '',
        path: '/cxp',
        score: scoreText(haystack, term),
      }
    })
}

function scoreText(haystack, term) {
  if (!term) return 0
  if (!haystack) return 0
  if (haystack === term) return 140
  if (haystack.startsWith(term)) return 110
  if (haystack.includes(term)) return 80
  const parts = term.split(/\s+/).filter(Boolean)
  if (parts.length > 1 && parts.every((part) => haystack.includes(part))) return 58
  if (term.length >= 4 && levenshtein(haystack.slice(0, term.length + 2), term) <= 2) return 28
  return 0
}

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, index) => [index])
  for (let index = 0; index <= a.length; index += 1) matrix[0][index] = index
  for (let row = 1; row <= b.length; row += 1) {
    for (let col = 1; col <= a.length; col += 1) {
      matrix[row][col] = b[row - 1] === a[col - 1]
        ? matrix[row - 1][col - 1]
        : Math.min(matrix[row - 1][col - 1] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col] + 1)
    }
  }
  return matrix[b.length][a.length]
}
