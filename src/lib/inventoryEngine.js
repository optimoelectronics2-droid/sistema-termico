import { isActiveInventoryMovement, isActiveProduct } from './realDataGuards.js'

const STOCK_OUT_TYPES = new Set(['salida', 'ajuste_negativo', 'entrada_revertida'])
const STOCK_IN_TYPES = new Set(['entrada', 'stock_inicial', 'ajuste_positivo', 'salida_revertida', 'nota_credito_entrada'])

export const inventoryMovementTypes = {
  INITIAL: 'stock_inicial',
  ENTRY: 'entrada',
  ENTRY_REVERSAL: 'entrada_revertida',
  SALE: 'salida',
  SALE_REVERSAL: 'salida_revertida',
  CREDIT_NOTE: 'nota_credito_entrada',
  ADJUSTMENT_IN: 'ajuste_positivo',
  ADJUSTMENT_OUT: 'ajuste_negativo',
}

export function normalizeSerialValue(value) {
  return String(value || '').trim().toUpperCase()
}

export function normalizeSerialList(values = []) {
  const raw = Array.isArray(values) ? values : String(values || '').split(/\r?\n|,/)
  return [...new Set(raw.map(normalizeSerialValue).filter(Boolean))]
}

export function serialIdentity(entry) {
  return normalizeSerialValue(typeof entry === 'string' ? entry : entry?.serial)
}

export function validateGlobalSerialIntegrity(products = []) {
  const available = new Map()
  const sold = new Map()
  const damaged = new Map()

  products.forEach((product) => {
    normalizeSerialList(product.serials || []).forEach((serial) => addSerial(available, serial, product))
    normalizeSerialList((product.soldSerials || []).map(serialIdentity)).forEach((serial) => addSerial(sold, serial, product))
    normalizeSerialList(product.damagedSerials || []).forEach((serial) => addSerial(damaged, serial, product))
    if (product.requiresSerial && Number(product.stock || 0) !== normalizeSerialList(product.serials || []).length) {
      throw new Error(`${product.name} requiere que stock (${product.stock || 0}) sea igual a seriales disponibles (${normalizeSerialList(product.serials || []).length}).`)
    }
  })

  const duplicatedAvailable = [...available.entries()].find(([, owners]) => owners.length > 1)
  if (duplicatedAvailable) throw new Error(`Serial duplicado disponible: ${duplicatedAvailable[0]}.`)
  const duplicatedSold = [...sold.entries()].find(([, owners]) => owners.length > 1)
  if (duplicatedSold) throw new Error(`Serial vendido duplicado: ${duplicatedSold[0]}.`)
  const crossing = [...available.keys()].find((serial) => sold.has(serial) || damaged.has(serial))
  if (crossing) throw new Error(`Serial inconsistente entre estados: ${crossing}.`)
}

export function assertSerialsAvailable(product, serials = []) {
  const normalized = normalizeSerialList(serials)
  const available = new Set(normalizeSerialList(product?.serials || []))
  const sold = new Set(normalizeSerialList((product?.soldSerials || []).map(serialIdentity)))
  normalized.forEach((serial) => {
    if (sold.has(serial)) throw new Error(`El serial/IMEI ${serial} ya fue vendido.`)
    if (!available.has(serial)) throw new Error(`El serial/IMEI ${serial} no esta disponible para ${product?.name || 'el producto'}.`)
  })
}

export function assertNewSerialsAreUnique(products, incomingSerials, currentProductId = '') {
  const incoming = normalizeSerialList(incomingSerials)
  if (incoming.length !== (Array.isArray(incomingSerials) ? incomingSerials.filter(Boolean).length : incoming.length)) {
    throw new Error('La lista contiene seriales duplicados.')
  }
  const existing = new Set()
  products.forEach((product) => {
    if (product.id === currentProductId) return
    ;[
      ...(product.serials || []),
      ...(product.soldSerials || []).map(serialIdentity),
      ...(product.damagedSerials || []),
    ].forEach((serial) => existing.add(normalizeSerialValue(serial)))
  })
  const duplicated = incoming.find((serial) => existing.has(serial))
  if (duplicated) throw new Error(`El serial/IMEI ${duplicated} ya existe en otro producto o historial.`)
}

export function makeInventoryMovement({
  id,
  product,
  type,
  reason = '',
  quantity = 0,
  quantityBefore = 0,
  quantityAfter,
  cost = 0,
  serials = [],
  date,
  createdAt,
  documentId = '',
  documentNumber = '',
  source = '',
  reference = '',
  user = '',
  extra = {},
}) {
  const amount = Math.abs(Number(quantity || 0))
  const signedQuantity = movementSign(type) * amount
  const before = Number(quantityBefore || 0)
  const after = quantityAfter === undefined ? before + signedQuantity : Number(quantityAfter || 0)
  const unitCost = roundMoney(cost)
  return {
    id,
    productId: product?.id || extra.productId || '',
    productName: product?.name || extra.productName || '',
    sku: product?.sku || extra.sku || '',
    type,
    reason,
    quantity: amount,
    signedQuantity,
    quantityBefore: before,
    quantityAfter: after,
    cost: unitCost,
    unitCost,
    total: roundMoney(amount * unitCost),
    serials: normalizeSerialList(serials),
    date: date || new Date().toISOString().slice(0, 10),
    createdAt: createdAt || new Date().toISOString(),
    documentId,
    documentNumber,
    source,
    reference,
    user,
    ...extra,
  }
}

export function buildInventoryReports({ products = [], movements = [], reportStats = null } = {}) {
  const activeProducts = products.filter((product) => isActiveProduct(product))
  const movementRows = movements
    .filter((movement) => isActiveInventoryMovement(movement, activeProducts))
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
  const valuedProducts = activeProducts.map((product) => {
    const stock = Number(product.stock || 0)
    const cost = Number(product.cost || 0)
    const price = Number(product.price || 0)
    return {
      id: product.id,
      name: product.name || '',
      sku: product.sku || '',
      category: product.category || '',
      brand: product.brand || '',
      stock,
      stockMin: Number(product.stockMin || 0),
      cost,
      price,
      valueCost: roundMoney(stock * cost),
      requiresSerial: Boolean(product.requiresSerial),
      serialsAvailable: normalizeSerialList(product.serials || []).length,
      serialsSold: normalizeSerialList((product.soldSerials || []).map(serialIdentity)).length,
    }
  })
  const topSold = reportStats?.topProducts || summarizeProductsFromMovements(movementRows)
  return {
    movements: movementRows,
    outOfStock: valuedProducts.filter((product) => product.stock <= 0),
    lowStock: valuedProducts.filter((product) => product.stock > 0 && product.stock <= product.stockMin),
    topSold,
    valuation: {
      products: valuedProducts.sort((a, b) => b.valueCost - a.valueCost),
      totalCost: roundMoney(valuedProducts.reduce((sum, product) => sum + product.valueCost, 0)),
    },
    profitByProduct: (reportStats?.topProducts || []).map((item) => ({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      revenue: item.revenue,
      cost: item.cost,
      profit: item.profit,
      margin: item.margin,
    })),
  }
}

function summarizeProductsFromMovements(movements) {
  const totals = new Map()
  movements.filter((movement) => movement.type === inventoryMovementTypes.SALE).forEach((movement) => {
    const key = movement.productId || movement.sku || movement.productName
    const current = totals.get(key) || { productId: movement.productId, sku: movement.sku, name: movement.productName, quantity: 0, cost: 0, frequency: 0 }
    current.quantity += Number(movement.quantity || 0)
    current.cost += Number(movement.total || 0)
    current.frequency += 1
    totals.set(key, current)
  })
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity)
}

function addSerial(map, serial, product) {
  if (!serial) return
  const owners = map.get(serial) || []
  owners.push(product)
  map.set(serial, owners)
}

function movementSign(type) {
  if (STOCK_OUT_TYPES.has(type)) return -1
  if (STOCK_IN_TYPES.has(type)) return 1
  return 0
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
