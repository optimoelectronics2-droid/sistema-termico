import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { assertValidTaxSequence, calculateInvoice, invoiceModes, nextNcf } from '../lib/taxEngine'
import { buildHistoricalReport, buildReportFingerprint, createEmptyReportStats } from '../lib/reportEngine'
import {
  assertNewSerialsAreUnique,
  assertSerialsAvailable,
  buildInventoryReports,
  inventoryMovementTypes,
  makeInventoryMovement,
  normalizeSerialList,
  serialIdentity,
  validateGlobalSerialIntegrity,
} from '../lib/inventoryEngine'
import { assertOpenCashRegister, assertStockForLines, assertUniqueNcf, assertUniqueSerials, assertValidInvoiceDates, assertCustomerCreditLimit, assertPositiveAmount, assertInvoiceLineItems } from '../lib/validators'
import {
  defaultBranding,
  defaultFiscalSettings,
  normalizeCompany,
  scopeRecord,
} from '../lib/tenantEngine'
import { buildCashCutReport, normalizeCashOpenInput } from '../lib/cashDeskEngine'
import { addDaysIso, nowIso, todayIso } from '../lib/dateTime'
import { entryNumberSeq, nextEntryNumber } from '../lib/entryNumber'
import { randomUuid, randomValues } from '../lib/id'
import { sanitizeCashRegister, sanitizeOperationalData } from '../lib/realDataGuards'
import { rebuildReports, auditIntegrity, detectDuplicates, reconcileInventory, reconcileFinancials, systemHealth } from '../lib/auditEngine'
import { deleteRemoteDoc } from '../services/realtimeSync'

const today = todayIso
const now = nowIso
const id = (prefix) => `${prefix}-${randomUuid()}`
const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}
const moneyValue = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round((num + Number.EPSILON) * 100) / 100
}
const CREDIT_PAYMENT_METHOD = 'Credito'

const emptyCompany = {
  id: 'company-local',
  ownerId: 'local-admin',
  name: '',
  legalName: '',
  rnc: '',
  address: '',
  city: '',
  province: '',
  phone: '',
  whatsapp: '',
  email: '',
  logoUrl: '',
  signatureUrl: '',
  warrantyText: 'Garantia segun politicas de la empresa.',
  invoiceTerms: 'Gracias por su compra.',
  requireOpenRegister: true,
  defaultCurrency: 'DOP',
  exchangeRate: 58.5,
  maxDiscountPercent: 10,
  taxRate: 18,
  fiscal: defaultFiscalSettings,
  branding: defaultBranding,
  plan: 'starter',
  status: 'active',
}

const emptyCashRegister = {
  id: null,
  branchId: null,
  name: 'Caja principal',
  status: 'closed',
  openedAt: null,
  closedAt: null,
  openedBy: null,
  openingAmount: 0,
  expected: 0,
  counted: 0,
  movements: [],
}

const defaultSequences = [
  { id: 'B01', prefix: 'B01', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'B02', prefix: 'B02', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'B04', prefix: 'B04', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'B14', prefix: 'B14', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'B15', prefix: 'B15', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'B16', prefix: 'B16', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E31', prefix: 'E31', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E32', prefix: 'E32', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E33', prefix: 'E33', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E34', prefix: 'E34', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E41', prefix: 'E41', next: 1, limit: 0, expiresAt: '', enabled: false },
  { id: 'E43', prefix: 'E43', next: 1, limit: 0, expiresAt: '', enabled: false },
]

const defaultCategories = ['Celulares', 'Laptops', 'Tablets', 'Accesorios', 'Servicios', 'Impresoras', 'Monitores', 'UPS']
const defaultSuppliers = [{ id: 'no-supplier', name: 'Sin proveedor', rnc: '', phone: '', email: '', active: true }]
const genericCustomer = {
  id: 'generic-customer',
  name: 'Cliente Generico',
  type: 'final',
  rnc: '',
  cedula: '',
  phone: '',
  whatsapp: '',
  email: '',
  balance: 0,
  status: 'Activo',
  paymentTerm: 'Contado',
  priceList: 'Detal',
  creditLimit: 0,
}
const defaultCompany = normalizeCompany({ ...emptyCompany, name: 'Empresa principal', legalName: 'Empresa principal' })


export const useERPStore = create(
  persist(
    (set, get) => ({
      activeCompanyId: defaultCompany.id,
      company: defaultCompany,
      settings: defaultCompany,
      branches: [],
      stores: [],
      users: [],
      products: [],
      productEntries: [],
      inventoryMovements: [],
      customers: customerListWithGeneric(),
      suppliers: defaultSuppliers,
      invoices: [],
      quotes: [],
      receivables: [],
      payments: [],
      financialMovements: [],
      expenses: [],
      conduces: [],
      creditNotes: [],
      documentCounters: {},
      cashRegister: emptyCashRegister,
      serviceOrders: [],
      taxSequences: defaultSequences,
      auditLogs: [],
      categories: defaultCategories,
      commandOpen: false,
      collapsed: false,
      selectedBranch: null,
      currentUser: { id: 'local-admin', name: 'Administrador', role: 'Admin' },
      syncStatus: 'local-first',
      syncUserId: null,
      syncHydrated: false,
      syncError: '',
      reportStats: createEmptyReportStats(),
      inventoryReports: buildInventoryReports(),

      toggleSidebar: () => set((state) => ({ collapsed: !state.collapsed })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),

      bootstrapTenantForUser(user = {}) {
        const state = get()
        const ownerId = user.uid || state.currentUser?.id || 'local-admin'
        const company = normalizeCompany(state.company || defaultCompany, { id: ownerId })
        set({
          activeCompanyId: company.id,
          company,
          settings: company,
        })
        get().refreshReportStats()
      },

      updateFiscalSettings(partialSettings) {
        set((state) => {
          const fiscal = { ...defaultFiscalSettings, ...(state.company.fiscal || {}), ...partialSettings }
          const company = { ...state.company, fiscal, updatedAt: now() }
          return { company, settings: { ...state.settings, fiscal } }
        })
        get().addAudit('fiscal_settings.update', 'Fiscal DGII', null, partialSettings)
        get().refreshReportStats()
      },

      updateBrandingSettings(partialSettings) {
        set((state) => {
          const branding = { ...defaultBranding, ...(state.company.branding || {}), ...partialSettings }
          const company = {
            ...state.company,
            ...('invoiceTerms' in partialSettings ? { invoiceTerms: partialSettings.invoiceTerms } : {}),
            branding,
            updatedAt: now(),
          }
          return { company, settings: { ...state.settings, ...company } }
        })
        get().addAudit('branding.update', 'Empresa', null, partialSettings)
      },

      refreshReportStats() {
        const state = get()
        const clean = sanitizeOperationalData(state, state.activeCompanyId)
        const reportStats = buildHistoricalReport({
          invoices: clean.invoices,
          creditNotes: clean.creditNotes,
          products: clean.products,
          quotes: clean.quotes,
          inventoryMovements: clean.inventoryMovements,
        })
        const inventoryReports = buildInventoryReports({
          products: clean.products,
          movements: clean.inventoryMovements,
          reportStats,
        })
        set({ reportStats, inventoryReports })
        return reportStats
      },

      ensureReportStats() {
        const state = get()
        const fingerprint = buildReportFingerprint({
          invoices: state.invoices,
          creditNotes: state.creditNotes,
          products: state.products,
          quotes: state.quotes,
        })
        if (state.reportStats?.source?.fingerprint === fingerprint) return state.reportStats
        return get().refreshReportStats()
      },

      refreshInventoryReports() {
        const state = get()
        const clean = sanitizeOperationalData(state, state.activeCompanyId)
        const inventoryReports = buildInventoryReports({
          products: clean.products,
          movements: clean.inventoryMovements,
          reportStats: state.reportStats,
        })
        set({ inventoryReports })
        return inventoryReports
      },

      rebuildReports() {
        return rebuildReports(get())
      },

      systemHealth() {
        return systemHealth(get())
      },

      auditIntegrity() {
        return auditIntegrity(get())
      },

      detectDuplicates() {
        return detectDuplicates(get())
      },

      reconcileInventory() {
        return reconcileInventory(get())
      },

      reconcileFinancials() {
        return reconcileFinancials(get())
      },

      addAudit(action, module, before = null, after = null) {
        const user = get().currentUser
        const log = {
          id: id('log'),
          user: user?.name || 'Sistema',
          action,
          module,
          date: now(),
          before,
          after,
          ip: 'local',
          device: navigator.userAgent,
        }
        set((state) => ({ auditLogs: [log, ...state.auditLogs] }))
        return log
      },

      updateSettings(partialSettings) {
        set((state) => ({
          company: { ...state.company, ...partialSettings, updatedAt: now() },
          settings: { ...state.settings, ...partialSettings, updatedAt: now() },
        }))
        get().addAudit('settings.update', 'Configuracion', null, partialSettings)
        get().refreshReportStats()
      },

      updateExchangeRate(rate) {
        if (toNumber(rate) <= 0) throw new Error('La tasa de cambio debe ser mayor que cero.')
        get().updateSettings({ exchangeRate: toNumber(rate) })
      },

      updateCategories(categories) {
        const clean = categories.map((item) => item.trim()).filter(Boolean)
        if (!clean.length) throw new Error('Debe existir al menos una categoria.')
        set({ categories: [...new Set(clean)] })
        get().addAudit('categories.update', 'Configuracion', null, clean)
      },

      updateTaxSequence({ type, next, limit, expiresAt, enabled }) {
        set((state) => ({
          taxSequences: state.taxSequences.map((sequence) =>
            sequence.id === type
              ? {
                  ...sequence,
                  next: next === undefined ? sequence.next : toNumber(next),
                  limit: limit === undefined ? sequence.limit : toNumber(limit),
                  expiresAt: expiresAt === undefined ? sequence.expiresAt : expiresAt,
                  enabled: enabled === undefined ? sequence.enabled : Boolean(enabled),
                }
              : sequence,
          ),
        }))
        get().addAudit('tax_sequence.update', 'Fiscal', type, { next, limit, expiresAt, enabled })
      },

      upsertBranch(branch) {
        const payload = scopeRecord({ ...branch, id: branch.id || id('branch'), updatedAt: now() }, get().activeCompanyId)
        const exists = get().branches.some((item) => item.id === payload.id)
        set((state) => ({
          branches: exists ? state.branches.map((item) => (item.id === payload.id ? payload : item)) : [payload, ...state.branches],
          selectedBranch: state.selectedBranch || payload.id,
        }))
        get().addAudit(exists ? 'branch.update' : 'branch.create', 'Sucursales', exists ? payload.id : null, payload)
        return payload
      },

      upsertSupplier(supplier) {
        const payload = scopeRecord({ ...supplier, id: supplier.id || id('supplier'), active: supplier.active ?? true, updatedAt: now() }, get().activeCompanyId)
        const exists = get().suppliers.some((item) => item.id === payload.id)
        set((state) => ({
          suppliers: exists ? state.suppliers.map((item) => (item.id === payload.id ? payload : item)) : [payload, ...state.suppliers],
        }))
        get().addAudit(exists ? 'supplier.update' : 'supplier.create', 'Proveedores', exists ? payload.id : null, payload)
        return payload
      },

      // ─── Soft-delete / Papelera ──────────────────────────────────

      upsertProduct(product) {
        const products = get().products
        const sku = product.sku?.trim() || buildSku(product.name)
        if (!product.name?.trim()) throw new Error('El nombre del producto es obligatorio.')
        if (!product.barcode?.trim()) product = { ...product, barcode: buildBarcode() }
        if (products.some((item) => item.sku?.toLowerCase() === sku.toLowerCase() && item.id !== product.id)) {
          throw new Error(`El SKU ${sku} ya existe. Use otro SKU.`)
        }
        if (toNumber(product.cost) < 0) throw new Error('El costo no puede ser negativo.')
        if (toNumber(product.price) <= 0) throw new Error('El precio de venta al detal debe ser mayor que cero.')
        const existing = products.find((item) => item.id === product.id)
        const incomingStock = product.stock === undefined ? product.initialStock : product.stock
        const nextStock = existing ? toNumber(incomingStock ?? existing.stock) : toNumber(incomingStock)
        const incomingSerials = Array.isArray(product.serials)
          ? normalizeSerialList(product.serials)
          : normalizeSerialList(product.serialsText || '')
        const serialsWereProvided = Array.isArray(product.serials) || product.serialsText !== undefined
        const nextSerials = serialsWereProvided ? incomingSerials : normalizeSerialList(existing?.serials || incomingSerials)
        assertNewSerialsAreUnique(products, nextSerials, product.id)
        if (product.requiresSerial && nextStock > 0 && nextSerials.length !== nextStock) {
          throw new Error(`Este producto requiere serial/IMEI. Debe registrar ${nextStock} serial(es) o dejar el stock inicial en 0.`)
        }
        const stockDelta = existing ? nextStock - toNumber(existing.stock) : nextStock
        const payload = scopeRecord({
          ...existing,
          ...product,
          id: product.id || id('product'),
          sku,
          cost: toNumber(product.cost),
          price: toNumber(product.price),
          wholesalePrice: toNumber(product.wholesalePrice),
          technicianPrice: toNumber(product.technicianPrice),
          specialPrice: toNumber(product.specialPrice),
          usdPrice: toNumber(product.usdPrice),
          stock: nextStock,
          stockMin: toNumber(product.stockMin),
          stockMax: toNumber(product.stockMax),
          serials: nextSerials,
          soldSerials: existing?.soldSerials || [],
          damagedSerials: existing?.damagedSerials || [],
          status: product.status || 'Activo',
          taxable: product.taxStatus ? product.taxStatus === 'taxed' : Boolean(product.taxable),
          taxStatus: product.taxStatus || (product.taxable ? 'taxed' : 'exempt'),
          updatedAt: now(),
          createdAt: existing?.createdAt || now(),
        }, get().activeCompanyId)
        set((state) => ({
          products: existing ? state.products.map((item) => (item.id === payload.id ? payload : item)) : [payload, ...state.products],
          inventoryMovements: !existing && nextStock > 0
            ? [makeInventoryMovement({
                id: id('mov'),
                product: payload,
                type: inventoryMovementTypes.INITIAL,
                reason: 'Creacion de producto',
                quantity: nextStock,
                quantityBefore: 0,
                quantityAfter: nextStock,
                cost: payload.cost,
                serials: nextSerials,
                date: today(),
                createdAt: now(),
                source: 'producto',
                documentId: payload.id,
                documentNumber: payload.sku,
                reference: 'Stock inicial',
                user: get().currentUser?.name || 'Sistema',
              }), ...state.inventoryMovements]
            : existing && stockDelta !== 0
              ? [makeInventoryMovement({
                  id: id('mov'),
                  product: payload,
                  type: stockDelta > 0 ? inventoryMovementTypes.ADJUSTMENT_IN : inventoryMovementTypes.ADJUSTMENT_OUT,
                  reason: 'Edicion de producto',
                  quantity: Math.abs(stockDelta),
                  quantityBefore: toNumber(existing.stock),
                  quantityAfter: nextStock,
                  cost: payload.cost,
                  serials: stockDelta > 0 ? nextSerials.filter((serial) => !normalizeSerialList(existing.serials || []).includes(serial)) : normalizeSerialList(existing.serials || []).filter((serial) => !nextSerials.includes(serial)),
                  date: today(),
                  createdAt: now(),
                  source: 'producto',
                  documentId: payload.id,
                  documentNumber: payload.sku,
                  reference: 'Cambio manual de stock',
                  user: get().currentUser?.name || 'Sistema',
                }), ...state.inventoryMovements]
            : state.inventoryMovements,
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit(existing ? 'product.update' : 'product.create', 'Inventario', existing || null, payload)
        return payload
      },

      deleteProduct(productId, reason = 'Eliminacion manual') {
        const product = get().products.find((item) => item.id === productId)
        if (!product) throw new Error('El producto no existe.')
        const state = get()
        const hasHistory = state.productEntries.some((entry) => entry.items?.some((item) => item.productId === productId))
          || state.invoices.some((invoice) => invoice.items?.some((item) => item.productId === productId))
          || state.inventoryMovements.some((movement) => movement.productId === productId)
        if (hasHistory) {
          throw new Error('No se puede eliminar un producto con historial. Marquelo como Inactivo para conservar la trazabilidad de inventario y facturas.')
        }
        set((state) => ({ products: state.products.filter((item) => item.id !== productId) }))
        get().refreshReportStats()
        get().addAudit('product.delete', 'Inventario', product, { reason })
        deleteRemoteDoc('products', productId).catch(() => {})
      },

      restoreProduct(productId) {
        throw new Error('La papelera de reciclaje fue desactivada. Los productos eliminados no se pueden recuperar.')
      },

      updateFinancialMovement(movementId, patch) {
        const movement = get().financialMovements.find((item) => item.id === movementId)
        if (!movement) throw new Error('Movimiento no existe.')
        const before = { ...movement }
        const updated = { ...movement, ...patch, amount: patch.amount !== undefined ? moneyValue(patch.amount) : movement.amount, updatedAt: now() }
        set((state) => ({
          financialMovements: state.financialMovements.map((item) => item.id === movementId ? updated : item),
        }))
        get().refreshReportStats()
        get().addAudit('financial_movement.update', 'Finanzas', before, updated)
        return updated
      },

      deleteFinancialMovement(movementId) {
        const movement = get().financialMovements.find((item) => item.id === movementId)
        if (!movement) throw new Error('Movimiento no existe.')
        set((state) => ({ financialMovements: state.financialMovements.filter((item) => item.id !== movementId) }))
        get().refreshReportStats()
        get().addAudit('financial_movement.delete', 'Finanzas', movement, null)
        deleteRemoteDoc('financialMovements', movementId).catch(() => {})
      },

      adjustInventory({ productId, quantity, type, reason, serials = [] }) {
        const amount = toNumber(quantity)
        if (amount <= 0) throw new Error('La cantidad del ajuste debe ser mayor que cero.')
        if (!reason?.trim()) throw new Error('El motivo del ajuste es obligatorio.')
        const product = get().products.find((item) => item.id === productId)
        if (!product) throw new Error('Seleccione un producto valido.')
        const sign = type === 'decremento' ? -1 : 1
        const nextStock = toNumber(product.stock) + sign * amount
        if (nextStock < 0) throw new Error('El ajuste deja el stock en negativo.')
        const normalizedSerials = normalizeSerialList(serials)
        if (product.requiresSerial && normalizedSerials.length !== amount) throw new Error(`${product.name} requiere ${amount} serial(es)/IMEI para ajustar.`)
        if (sign < 0) assertSerialsAvailable(product, normalizedSerials)
        if (sign > 0) assertNewSerialsAreUnique(get().products, normalizedSerials, product.id)
        const movement = scopeRecord(makeInventoryMovement({
          id: id('mov'),
          product,
          type: sign > 0 ? inventoryMovementTypes.ADJUSTMENT_IN : inventoryMovementTypes.ADJUSTMENT_OUT,
          reason,
          quantity: amount,
          quantityBefore: toNumber(product.stock),
          quantityAfter: nextStock,
          cost: product.cost,
          serials: normalizedSerials,
          date: today(),
          createdAt: now(),
          source: 'ajuste',
          documentId: product.id,
          documentNumber: product.sku,
          reference: reason,
          user: get().currentUser?.name || 'Sistema',
        }), get().activeCompanyId)
        set((state) => ({
          products: state.products.map((item) => (item.id === productId ? {
            ...item,
            stock: nextStock,
            serials: sign > 0
              ? [...normalizeSerialList(item.serials || []), ...normalizedSerials]
              : normalizeSerialList(item.serials || []).filter((serial) => !normalizedSerials.includes(serial)),
            damagedSerials: sign < 0 && reason.toLowerCase().includes('dañ')
              ? [...normalizeSerialList(item.damagedSerials || []), ...normalizedSerials]
              : item.damagedSerials || [],
            updatedAt: now(),
          } : item)),
          inventoryMovements: [movement, ...state.inventoryMovements],
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('inventory.adjust', 'Inventario', { productId, stock: product.stock }, { stock: nextStock, reason })
        return movement
      },

      receiveProducts({ supplierId = 'no-supplier', reference = '', supplierInvoice = '', date = today(), items = [], type = 'Nueva mercancia' }) {
        if (!items.length) throw new Error('Agregue al menos un producto a la entrada.')
        const products = get().products
        const incomingSerials = items.flatMap((item) => item.serials || [])
        assertNewSerialsAreUnique(products, incomingSerials)

        const entryItems = items.map((item) => {
          const product = products.find((productItem) => productItem.id === item.productId)
          if (!product) throw new Error('Uno de los productos de la entrada no existe.')
          const quantity = toNumber(item.quantity)
          const cost = toNumber(item.cost)
          if (quantity <= 0) throw new Error(`La cantidad para ${product.name} debe ser mayor que cero.`)
          if (cost <= 0) throw new Error(`El costo para ${product.name} debe ser mayor que cero.`)
          const serials = normalizeSerialList(item.serials || [])
          if (product.requiresSerial && serials.length !== quantity) {
            throw new Error(`${product.name} requiere ${quantity} serial(es), recibidos ${serials.length}.`)
          }
          return { productId: product.id, productName: product.name, quantity, cost, serials, subtotal: quantity * cost }
        })

        const entryYear = String(date || today()).slice(0, 4) || String(new Date().getFullYear())
        const entryCounterKey = `ENT-${entryYear}`
        const entryNumber = nextEntryNumber(get().productEntries, date, get().documentCounters?.[entryCounterKey])
        const entry = scopeRecord({
          id: id('entry'),
          number: entryNumber,
          supplierId,
          supplierName: get().suppliers.find((supplier) => supplier.id === supplierId)?.name || 'Sin proveedor',
          reference,
          supplierInvoice,
          date,
          type,
          items: entryItems,
          total: entryItems.reduce((sum, item) => sum + item.subtotal, 0),
          createdAt: now(),
        }, get().activeCompanyId)

        // ── Movimientos con cursor secuencial por producto (soporta duplicados en la misma entrada)
        const stockCursor = new Map(products.map((product) => [product.id, toNumber(product?.stock)]))
        const movements = entryItems.map((item) => {
          const product = products.find((productItem) => productItem.id === item.productId)
          const before = stockCursor.get(item.productId) ?? toNumber(product?.stock)
          const after = before + item.quantity
          stockCursor.set(item.productId, after)
          return scopeRecord(makeInventoryMovement({
            id: id('mov'),
            product,
            type: inventoryMovementTypes.ENTRY,
            reason: type,
            quantity: item.quantity,
            quantityBefore: before,
            quantityAfter: after,
            cost: item.cost,
            serials: item.serials,
            date,
            createdAt: now(),
            source: 'entrada',
            documentId: entry.id,
            documentNumber: entry.number || entry.reference || entry.supplierInvoice || entry.id,
            reference: entry.supplierInvoice || entry.reference || '',
            user: get().currentUser?.name || 'Sistema',
            extra: { entryId: entry.id, supplierId, supplierName: entry.supplierName },
          }), get().activeCompanyId)
        })

        // ── Agregación por productId para soportar líneas duplicadas del mismo producto
        const aggregates = new Map()
        entryItems.forEach((item) => {
          const existing = aggregates.get(item.productId) || { quantity: 0, costValue: 0, serials: [] }
          existing.quantity += item.quantity
          existing.costValue += item.quantity * item.cost
          existing.serials.push(...normalizeSerialList(item.serials || []))
          aggregates.set(item.productId, existing)
        })

        set((state) => ({
          products: state.products.map((product) => {
            const aggregated = aggregates.get(product.id)
            if (!aggregated) return product
            const currentStock = toNumber(product.stock)
            const newStock = currentStock + aggregated.quantity
            const totalCurrentCost = currentStock * toNumber(product.cost)
            const averageCost = newStock === 0 ? (aggregated.costValue / (aggregated.quantity || 1)) : (totalCurrentCost + aggregated.costValue) / newStock
            return {
              ...product,
              stock: newStock,
              cost: Math.round(averageCost * 100) / 100,
              serials: [...normalizeSerialList(product.serials || []), ...aggregated.serials],
              updatedAt: now(),
            }
          }),
          productEntries: [entry, ...state.productEntries],
          inventoryMovements: [...movements, ...state.inventoryMovements],
          documentCounters: { ...(state.documentCounters || {}), [entryCounterKey]: entryNumberSeq(entry.number) + 1 },
          expenses: supplierInvoice
            ? [
                scopeRecord({
                  id: id('payable'),
                  entryId: entry.id,
                  type: 'account_payable',
                  supplierId,
                  supplierName: entry.supplierName,
                  reference: supplierInvoice,
                  concept: `Compra ${entry.reference || supplierInvoice}`,
                  amount: entry.total,
                  paid: 0,
                  balance: entry.total,
                  status: 'pending',
                  date,
                  dueDate: addDays(date, 30),
                  payments: [],
                  createdAt: now(),
                }, get().activeCompanyId),
                ...state.expenses,
              ]
            : state.expenses,
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('inventory.receive', 'Inventario', null, entry)
        return entry
      },

      deleteProductEntry(entryId, reason = 'Eliminacion de entrada') {
        const entry = get().productEntries.find((item) => item.id === entryId)
        if (!entry) throw new Error('La entrada no existe.')
        // ── Agregación por producto para validación con líneas duplicadas
        const deleteAggregates = new Map()
        entry.items.forEach((line) => {
          const existing = deleteAggregates.get(line.productId) || { quantity: 0, serials: [], productName: line.productName }
          existing.quantity += toNumber(line.quantity)
          existing.serials.push(...normalizeSerialList(line.serials || []))
          deleteAggregates.set(line.productId, existing)
        })
        deleteAggregates.forEach((aggregated, productId) => {
          const product = get().products.find((item) => item.id === productId)
          if (!product) return
          if (toNumber(product.stock) < aggregated.quantity) throw new Error(`${product.name} no tiene stock suficiente para revertir esta entrada (necesita ${aggregated.quantity}, disponible ${product.stock}).`)
          const productSerials = normalizeSerialList(product.serials || [])
          const unavailableSerial = aggregated.serials.find((serial) => !productSerials.includes(serial))
          if (unavailableSerial) throw new Error(`El serial ${unavailableSerial} ya no esta disponible; no se puede eliminar la entrada.`)
        })
        const reversalCursor = new Map(get().products.map((product) => [product.id, toNumber(product?.stock)]))
        const reversalMovements = entry.items.map((line) => {
          const product = get().products.find((item) => item.id === line.productId)
          const quantity = toNumber(line.quantity)
          const before = reversalCursor.get(line.productId) ?? toNumber(product?.stock ?? 0)
          const after = before - quantity
          reversalCursor.set(line.productId, after)
          return makeInventoryMovement({
            id: id('mov'),
            product: product || { id: line.productId, name: line.productName, sku: '' },
            type: inventoryMovementTypes.ENTRY_REVERSAL,
            reason,
            quantity,
            quantityBefore: before,
            quantityAfter: after,
            cost: toNumber(line.cost),
            serials: line.serials || [],
            date: today(),
            createdAt: now(),
            source: 'entrada',
            documentId: entryId,
            documentNumber: entry.reference || entry.supplierInvoice || entry.number || entryId,
            reference: reason,
            user: get().currentUser?.name || 'Sistema',
            extra: { entryId, productId: line.productId, productName: line.productName },
          })
        })
        set((state) => ({
          products: state.products.map((product) => {
            const aggregated = deleteAggregates.get(product.id)
            if (!aggregated) return product
            return {
              ...product,
              stock: toNumber(product.stock) - aggregated.quantity,
              serials: normalizeSerialList(product.serials || []).filter((serial) => !aggregated.serials.includes(serial)),
              updatedAt: now(),
            }
          }),
          productEntries: state.productEntries.filter((item) => item.id !== entryId),
          inventoryMovements: [...reversalMovements, ...state.inventoryMovements],
          expenses: state.expenses.map((item) => (item.entryId === entryId ? { ...item, status: 'cancelled', balance: 0, cancelledAt: now(), cancelReason: reason } : item)),
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('inventory.entry.delete', 'Inventario', entry, reason)
        deleteRemoteDoc('productEntries', entryId).catch(() => {})
      },

      updateProductEntry(entryId, payload) {
        const entry = get().productEntries.find((item) => item.id === entryId)
        if (!entry) throw new Error('La entrada no existe.')
        get().deleteProductEntry(entryId, 'Reverso automatico por edicion de entrada')
        const updated = get().receiveProducts(payload)
        get().addAudit('inventory.entry.update', 'Inventario', entry, updated)
        return updated
      },

      upsertCustomer(customer) {
        if (!customer.name?.trim()) throw new Error('El nombre o razon social del cliente es obligatorio.')
        const payload = scopeRecord({
          ...customer,
          id: customer.id || id('customer'),
          status: customer.status || 'Activo',
          creditLimit: toNumber(customer.creditLimit),
          balance: toNumber(customer.balance),
          tags: customer.tags || [],
          notes: customer.notes || [],
          updatedAt: now(),
          createdAt: customer.createdAt || now(),
        }, get().activeCompanyId)
        const exists = get().customers.some((item) => item.id === payload.id)
        set((state) => ({ customers: exists ? state.customers.map((item) => (item.id === payload.id ? payload : item)) : [payload, ...state.customers] }))
        get().refreshReportStats()
        get().addAudit(exists ? 'customer.update' : 'customer.create', 'Clientes', exists ? payload.id : null, payload)
        return payload
      },

      deleteCustomer(customerId) {
        const customer = get().customers.find((item) => item.id === customerId)
        if (!customer) throw new Error('El cliente no existe.')
        const hasReceivables = get().receivables.some((item) => item.customerId === customerId && item.balance > 0)
        if (hasReceivables) throw new Error('El cliente tiene cuentas pendientes. No se puede eliminar.')
        set((state) => ({ customers: state.customers.filter((item) => item.id !== customerId) }))
        get().refreshReportStats()
        get().addAudit('customer.delete', 'Clientes', customer, null)
        deleteRemoteDoc('customers', customerId).catch(() => {})
      },

      saveInvoiceDraft(invoiceData) {
        const mode = invoiceData.mode || invoiceModes.TAXED
        const items = freezeInvoiceItemCosts(applyGlobalDiscount(invoiceData), get().products)
        const totals = calculateInvoice(items, mode)
        const existing = get().invoices.find((invoice) => invoice.id === invoiceData.id)
        const draft = scopeRecord({
          ...invoiceData,
          items,
          mode,
          id: invoiceData.id || id('draft'),
          number: invoiceData.number || existing?.number || get().nextDocumentNumber('BOR'),
          ncf: '',
          status: 'draft',
          totals,
          createdAt: invoiceData.createdAt || now(),
          updatedAt: now(),
        }, get().activeCompanyId)
        const exists = Boolean(existing)
        set((state) => ({ invoices: exists ? state.invoices.map((invoice) => (invoice.id === draft.id ? draft : invoice)) : [draft, ...state.invoices] }))
        get().refreshReportStats()
        get().addAudit(exists ? 'invoice_draft.update' : 'invoice_draft.create', 'Facturacion', exists ? draft.id : null, draft)
        return draft
      },

      updateInvoiceDraft(idValue, data) {
        const invoice = get().invoices.find((item) => item.id === idValue)
        if (!invoice) throw new Error('La factura borrador no existe.')
        if (invoice.status !== 'draft') throw new Error('Solo se pueden editar facturas en borrador.')
        return get().saveInvoiceDraft({ ...invoice, ...data, id: idValue })
      },

      createInvoice(invoiceData) {
        assertOpenCashRegister(get().cashRegister, get().settings)
        assertInvoiceLineItems(invoiceData.items, get().products)
        assertStockForLines(invoiceData.items, get().products)
        assertValidInvoiceDates(invoiceData.issueDate, invoiceData.dueDate)
        if (invoiceData.ncf) assertUniqueNcf(invoiceData.ncf, get().invoices)
        const normalizedInvoiceData = withGenericCustomer(invoiceData)
        const maxDiscount = Math.min(Number(get().settings.maxDiscountPercent || 10), 10)
        if (toNumber(normalizedInvoiceData.globalDiscount) > maxDiscount) throw new Error(`El descuento global supera el maximo permitido de ${maxDiscount}%.`)
        const mode = normalizedInvoiceData.mode || invoiceModes.TAXED
        const items = freezeInvoiceItemCosts(applyGlobalDiscount({ ...normalizedInvoiceData, mode }), get().products)
        const totals = calculateInvoice(items, mode)
        const payments = normalizePayments(normalizedInvoiceData.payments, normalizedInvoiceData.paymentMethod, totals.total, normalizedInvoiceData.paymentPlan)
        const paymentTotal = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
        if (Math.abs(paymentTotal - totals.total) > 0.005) throw new Error(`Los pagos no cuadran. Faltan o sobran RD$${Math.abs(totals.total - paymentTotal).toFixed(2)}.`)
        const paymentSummary = buildInvoicePaymentSummary(payments, totals.total)
        items.forEach((item) => {
          const product = get().products.find((productItem) => productItem.id === item.productId)
          if (!product) throw new Error(`El producto ${item.name || item.productId} no existe.`)
          if (product.status === 'Inactivo') throw new Error(`${product.name} no esta disponible para facturar.`)
          if (product.category !== 'Servicios' && toNumber(product.stock) < toNumber(item.quantity)) throw new Error(`${product.name} no tiene stock suficiente. Disponible: ${product.stock || 0}.`)
          if (toNumber(item.discount) > maxDiscount) throw new Error(`${product.name} supera el descuento maximo permitido de ${maxDiscount}%.`)
          const minimumPrice = Math.max(toNumber(product.cost), toNumber(item.registeredPrice || product.price) * 0.9)
          if (toNumber(item.price) < minimumPrice) throw new Error(`${product.name} no puede venderse por debajo del costo ni con rebaja mayor al 10%.`)
          const serials = normalizeSerials(item)
          if (product.requiresSerial && serials.length !== toNumber(item.quantity)) throw new Error(`${product.name} requiere seleccionar ${item.quantity} serial(es).`)
          const availableSerials = new Set(product.serials || [])
          const unavailable = serials.find((serial) => !availableSerials.has(serial))
          if (unavailable) throw new Error(`El serial/IMEI ${unavailable} no esta disponible para ${product.name}.`)
        })
        const selectedSerials = items.flatMap(normalizeSerials)
        const soldSerials = get().products.flatMap((product) => (product.soldSerials || []).map(serialIdentity))
        assertUniqueSerials(selectedSerials, soldSerials)

        const sequence = normalizedInvoiceData.ncfType && normalizedInvoiceData.ncfType !== 'NO_FISCAL' ? get().taxSequences.find((item) => item.id === normalizedInvoiceData.ncfType) : null
        if (normalizedInvoiceData.ncfType && normalizedInvoiceData.ncfType !== 'NO_FISCAL' && !sequence) throw new Error(`Configure la secuencia fiscal ${normalizedInvoiceData.ncfType}.`)
        if (sequence) assertValidTaxSequence(sequence)
        if (normalizedInvoiceData.ncf && get().invoices.some((invoice) => invoice.ncf === normalizedInvoiceData.ncf)) throw new Error(`El NCF ${normalizedInvoiceData.ncf} ya existe en otra factura.`)
        const fiscalNumber = sequence ? nextNcf(sequence) : get().nextDocumentNumber('FAC')
        const issuedAt = now()
        const existingInvoices = get().invoices
        const authenticationSerial = buildInvoiceSerial(existingInvoices, issuedAt)
        const verificationToken = buildVerificationToken(existingInvoices)
        const invoice = scopeRecord({
          ...normalizedInvoiceData,
          items,
          id: normalizedInvoiceData.id || id('invoice'),
          number: fiscalNumber,
          ncf: sequence ? fiscalNumber : '',
          ncfType: sequence?.id || normalizedInvoiceData.ncfType || 'NO_FISCAL',
          payments,
          paymentPlan: normalizedInvoiceData.paymentPlan || paymentSummary.plan,
          paidAmount: paymentSummary.paid,
          creditAmount: paymentSummary.credit,
          balanceDue: paymentSummary.balance,
          paymentStatus: paymentSummary.paymentStatus,
          authenticationSerial,
          verificationToken,
          mode,
          status: paymentSummary.status,
          totals,
          version: normalizedInvoiceData.version || 1,
          versions: normalizedInvoiceData.versions || [],
          createdAt: normalizedInvoiceData.createdAt || now(),
          issuedAt,
          updatedAt: now(),
          fiscalProfile: {
            ncfEnabled: Boolean(get().company?.fiscal?.ncfEnabled),
            ecfEnabled: Boolean(get().company?.fiscal?.ecfEnabled),
            dgiiEnabled: Boolean(get().company?.fiscal?.dgiiEnabled),
            autoSequenceEnabled: get().company?.fiscal?.autoSequenceEnabled !== false,
          },
        }, get().activeCompanyId)

        const movements = invoice.items
          .filter((item) => isStockProduct(get().products.find((product) => product.id === item.productId)))
          .map((item) => {
            const product = get().products.find((productItem) => productItem.id === item.productId)
            const quantity = toNumber(item.quantity)
            return scopeRecord(makeInventoryMovement({
              id: id('mov'),
              product,
              type: inventoryMovementTypes.SALE,
              reason: 'Factura emitida',
              quantity,
              quantityBefore: toNumber(product?.stock),
              quantityAfter: toNumber(product?.stock) - quantity,
              cost: toNumber(item.cost),
              serials: item.serials || (item.serial ? [item.serial] : []),
              date: invoice.issueDate || today(),
              createdAt: now(),
              source: 'factura',
              documentId: invoice.id,
              documentNumber: invoice.ncf || invoice.number,
              reference: invoice.customerName,
              user: get().currentUser?.name || 'Sistema',
              extra: { invoiceId: invoice.id },
            }), get().activeCompanyId)
          })

        const creditAmount = getCreditAmount(invoice)
        if (creditAmount > 0) {
          assertCustomerCreditLimit(invoice.customerId, creditAmount, get().customers, get().receivables)
        }
        const customer = get().customers.find((item) => item.id === invoice.customerId)
        const initialPaid = getNonCreditAmount(invoice)
        const receivable = creditAmount > 0 ? scopeRecord(buildReceivable(invoice, customer, creditAmount, initialPaid), get().activeCompanyId) : null
        const financialMovements = [
          makeFinancialMovement({
            type: creditAmount > 0 ? 'Factura Crédito Creada' : 'Factura Emitida',
            documentId: invoice.id,
            documentNumber: invoice.number || invoice.ncf,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            amount: creditAmount > 0 ? creditAmount : totals.total,
            method: creditAmount > 0 ? 'Credito' : invoice.paymentMethod,
            observations: creditAmount > 0 ? `Balance financiado ${invoice.paymentPlan || paymentSummary.plan}` : 'Factura emitida de contado',
            user: get().currentUser?.name || invoice.seller || 'Sistema',
            createdAt: issuedAt,
          }, get().activeCompanyId),
          ...(receivable?.payments || []).map((payment) => makeFinancialMovement({
            type: 'Abono Inicial',
            documentId: invoice.id,
            documentNumber: invoice.number || invoice.ncf,
            invoiceId: invoice.id,
            paymentId: payment.id,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            amount: payment.amount,
            method: payment.method,
            reference: payment.reference,
            observations: payment.comment,
            user: payment.user || get().currentUser?.name || 'Sistema',
            createdAt: payment.createdAt,
          }, get().activeCompanyId)),
        ]

        set((state) => ({
          invoices: [invoice, ...state.invoices.filter((item) => item.id !== invoice.id)],
          products: state.products.map((product) => {
            const soldLines = invoice.items.filter((item) => item.productId === product.id)
            if (!soldLines.length || product.category === 'Servicios') return product
            const qty = soldLines.reduce((sum, item) => sum + toNumber(item.quantity), 0)
            const lineSerials = normalizeSerialList(soldLines.flatMap((item) => item.serials || (item.serial ? [item.serial] : [])))
            return {
              ...product,
              stock: toNumber(product.stock) - qty,
              serials: normalizeSerialList(product.serials || []).filter((serial) => !lineSerials.includes(serial)),
              soldSerials: [...(product.soldSerials || []), ...lineSerials.map((serial) => ({ serial, invoiceId: invoice.id, invoiceNumber: invoice.number, customerId: invoice.customerId, soldAt: now() }))],
              updatedAt: now(),
            }
          }),
          taxSequences: sequence ? state.taxSequences.map((item) => (item.id === sequence.id ? { ...item, next: toNumber(item.next) + 1 } : item)) : state.taxSequences,
          inventoryMovements: [...movements, ...state.inventoryMovements],
          receivables: receivable ? [receivable, ...state.receivables] : state.receivables,
          financialMovements: [...financialMovements, ...(state.financialMovements || [])],
          customers: receivable ? state.customers.map((item) => (item.id === invoice.customerId ? { ...item, balance: toNumber(item.balance) + creditAmount } : item)) : state.customers,
          cashRegister: {
            ...state.cashRegister,
            expected: state.cashRegister.expected + getNonCreditAmount(invoice),
            movements: [
              ...invoice.payments.filter((payment) => payment.method !== CREDIT_PAYMENT_METHOD).map((payment) => ({
                id: id('cashmov'),
                type: 'income',
                amount: toNumber(payment.amount),
                method: payment.method,
                concept: `Factura ${invoice.number}`,
                reference: payment.reference || '',
                invoiceId: invoice.id,
                source: 'invoice',
                status: 'active',
                createdAt: now(),
              })),
              ...state.cashRegister.movements,
            ],
          },
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('invoice.issue', 'Facturacion', invoiceData.id || null, invoice)
        return invoice
      },

      updateInvoice(invoiceId, invoiceData) {
        const state = get()
        const previous = state.invoices.find((item) => item.id === invoiceId)
        if (!previous) throw new Error('La factura no existe.')
        if (!invoiceData.customerId) throw new Error('Seleccione un cliente antes de guardar la factura.')
        if (!invoiceData.items?.length) throw new Error('Agregue al menos un producto o servicio.')
        const maxDiscount = Math.min(Number(state.settings.maxDiscountPercent || 10), 10)
        if (toNumber(invoiceData.globalDiscount) > maxDiscount) throw new Error(`El descuento global supera el maximo permitido de ${maxDiscount}%.`)
        const items = freezeInvoiceItemCosts(applyGlobalDiscount(invoiceData), state.products, previous)
        const totals = calculateInvoice(items, invoiceData.mode || previous.mode || invoiceModes.TAXED)
        const payments = normalizePayments(invoiceData.payments, invoiceData.paymentMethod, totals.total, invoiceData.paymentPlan)
        const paymentTotal = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
        if (Math.abs(paymentTotal - totals.total) > 0.005) throw new Error(`Los pagos no cuadran. Faltan o sobran RD$${Math.abs(totals.total - paymentTotal).toFixed(2)}.`)
        const paymentSummary = buildInvoicePaymentSummary(payments, totals.total)
        if (invoiceData.ncf && state.invoices.some((invoice) => invoice.id !== invoiceId && invoice.ncf === invoiceData.ncf)) throw new Error(`El NCF ${invoiceData.ncf} ya existe en otra factura.`)
        if (invoiceData.number && state.invoices.some((invoice) => invoice.id !== invoiceId && invoice.number === invoiceData.number)) throw new Error(`El numero ${invoiceData.number} ya existe en otra factura.`)

        validateEditableInvoiceItems({ items, products: state.products, maxDiscount, originalProductIds: new Set((previous.items || []).map((item) => item.productId).filter(Boolean)) })
        const nextInvoice = {
          ...previous,
          ...invoiceData,
          items,
          payments,
          paymentPlan: invoiceData.paymentPlan || paymentSummary.plan,
          paidAmount: paymentSummary.paid,
          creditAmount: paymentSummary.credit,
          balanceDue: paymentSummary.balance,
          paymentStatus: paymentSummary.paymentStatus,
          mode: invoiceData.mode || previous.mode || invoiceModes.TAXED,
          customerName: invoiceData.customerName || state.customers.find((item) => item.id === invoiceData.customerId)?.name || previous.customerName,
          totals,
          status: invoiceData.status === 'voided' ? 'voided' : paymentSummary.status,
          version: toNumber(previous.version || 1) + 1,
          versions: [
            {
              snapshot: stripInvoiceVersionHistory(previous),
              archivedAt: now(),
              archivedBy: state.currentUser?.name || 'Sistema',
            },
            ...(previous.versions || []),
          ],
          updatedAt: now(),
        }
        const nextCredit = getCreditAmount(nextInvoice)
        const previousReceivable = state.receivables.find((item) => item.invoiceId === invoiceId)
        if (nextCredit > 0) {
          if (previous.customerId === nextInvoice.customerId) {
            const previousBalance = moneyValue(previousReceivable?.balance || 0)
            const delta = moneyValue(nextCredit - previousBalance)
            if (delta > 0) assertCustomerCreditLimit(nextInvoice.customerId, delta, get().customers, get().receivables)
          } else {
            assertCustomerCreditLimit(nextInvoice.customerId, nextCredit, get().customers, get().receivables)
          }
        }
        const previousNonCredit = getNonCreditAmount(previous)
        const nextNonCredit = getNonCreditAmount(nextInvoice)
        var carriedPayments = previous.customerId === nextInvoice.customerId
          ? (previousReceivable?.payments || []).filter(function(p) { return p.origin !== 'initial' && !['voided', 'deleted', 'cancelled'].includes(String(p.status || '').toLowerCase()) })
          : []
        var carriedPaid = carriedPayments.reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
        var prevCreditNoteReduction = (state.creditNotes || []).filter(function(n) { return n.invoiceId === invoiceId && n.status !== 'voided' && n.status !== 'draft' && n.status !== 'deleted' }).reduce(function(s, n) {
          var creditCash = (n.payments || []).filter(function(p) { return !String(p.method || '').toLowerCase().includes('credito') }).reduce(function(s2, p) { return s2 + toNumber(p.amount) }, 0)
          return s + Math.max(0, toNumber(n.totals?.total || n.total || 0) - creditCash)
        }, 0)
        var nextInitialPaid = nextNonCredit
        var nextPaid = moneyValue(nextInitialPaid + carriedPaid)
        var nextReceivableBalance = moneyValue(Math.max(nextCredit - carriedPaid - prevCreditNoteReduction, 0))
        const rebuiltReceivable = nextCredit > 0 ? buildReceivable(nextInvoice, state.customers.find((item) => item.id === nextInvoice.customerId), nextCredit, nextInitialPaid) : null
        const nextReceivable = nextCredit > 0
          ? {
              ...(previousReceivable || rebuiltReceivable),
              ...rebuiltReceivable,
              id: previousReceivable?.id || rebuiltReceivable.id,
              total: moneyValue(totals.total),
              financedAmount: nextCredit,
              paid: nextPaid,
              balance: nextReceivableBalance,
              dueDate: nextInvoice.dueDate || previousReceivable?.dueDate || addDays(today(), 30),
              status: receivableStatus({ ...rebuiltReceivable, paid: nextPaid, balance: nextReceivableBalance }),
              creditType: nextInitialPaid > 0 ? 'credito' : 'fiado',
              payments: [...(rebuiltReceivable.payments || []), ...carriedPayments],
              updatedAt: now(),
            }
          : null
        const cashDelta = nextNonCredit - previousNonCredit
        const cashAdjustment = Math.abs(cashDelta) > 0.01
          ? {
              id: id('cashmov'),
              type: cashDelta > 0 ? 'income_adjustment' : 'expense_adjustment',
              amount: Math.abs(cashDelta),
              method: 'Ajuste',
              concept: `Edicion factura ${nextInvoice.number}`,
              reference: `v${nextInvoice.version}`,
              invoiceId: nextInvoice.id,
              source: 'invoice',
              status: 'active',
              createdAt: now(),
            }
          : null

        set((current) => {
          const receivables = reconcileReceivables(current.receivables, invoiceId, nextReceivable)
          const customers = reconcileCustomerBalances(current.customers, previous, nextInvoice, previousReceivable, nextReceivable)
          return {
            invoices: current.invoices.map((invoice) => (invoice.id === invoiceId ? nextInvoice : invoice)),
            products: current.products,
            inventoryMovements: current.inventoryMovements,
            receivables,
            financialMovements: cashAdjustment
              ? [makeFinancialMovement({
                  type: 'Ajuste de Saldo',
                  documentId: nextInvoice.id,
                  documentNumber: nextInvoice.number || nextInvoice.ncf,
                  invoiceId: nextInvoice.id,
                  customerId: nextInvoice.customerId,
                  customerName: nextInvoice.customerName,
                  amount: Math.abs(cashDelta),
                  method: 'Ajuste',
                  observations: `Edicion de factura v${nextInvoice.version}`,
                  user: current.currentUser?.name || 'Sistema',
                }, current.activeCompanyId), ...(current.financialMovements || [])]
              : current.financialMovements,
            customers,
            cashRegister: {
              ...current.cashRegister,
              expected: current.cashRegister.expected + cashDelta,
              movements: cashAdjustment ? [cashAdjustment, ...current.cashRegister.movements] : current.cashRegister.movements,
            },
          }
        })
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('invoice.update', 'Facturacion', stripInvoiceVersionHistory(previous), stripInvoiceVersionHistory(nextInvoice))
        return nextInvoice
      },

      voidInvoice(invoiceId, reason) {
        if (!reason?.trim() || reason.trim().length < 10) throw new Error('La anulacion requiere un motivo obligatorio de al menos 10 caracteres.')
        const invoice = get().invoices.find((item) => item.id === invoiceId)
        if (!invoice) throw new Error('La factura no existe.')
        if (invoice.status === 'voided' || invoice.status === 'anulada') throw new Error('La factura ya esta anulada.')
        const nonCreditCash = getNonCreditAmount(invoice)
        const relatedReceivable = get().receivables.find((item) => item.invoiceId === invoiceId)
        const relatedPayments = get().payments.filter((payment) => payment.invoiceId === invoiceId && payment.status !== 'voided')
        const paidCash = relatedPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
        const reversalMovements = buildInvoiceReversalMovements(invoice, get().inventoryMovements, get().products, reason)
        set((state) => ({
          invoices: state.invoices.map((item) => (item.id === invoiceId ? { ...item, status: 'voided', voidReason: reason, voidedAt: now(), updatedAt: now() } : item)),
          products: state.products.map((product) => {
            const lines = invoice.items.filter((item) => item.productId === product.id)
            if (!lines.length || product.category === 'Servicios') return product
            const qty = lines.reduce((sum, line) => sum + toNumber(line.quantity), 0)
            const serials = [...new Set(lines.flatMap(normalizeSerials))]
            const currentSerials = new Set(normalizeSerialList(product.serials || []))
            serials.forEach((serial) => currentSerials.add(serial))
            return {
              ...product,
              stock: toNumber(product.stock) + qty,
              serials: [...currentSerials],
              soldSerials: (product.soldSerials || []).filter((entry) => {
                const serial = typeof entry === 'string' ? entry : entry?.serial
                const soldInvoiceId = typeof entry === 'string' ? null : entry?.invoiceId
                return soldInvoiceId !== invoiceId && !serials.includes(serial)
              }),
              updatedAt: now(),
            }
          }),
          inventoryMovements: [...reversalMovements, ...state.inventoryMovements],
          payments: state.payments.map((payment) => (payment.invoiceId === invoiceId ? { ...payment, status: 'voided', voidedAt: now(), voidReason: reason } : payment)),
          receivables: state.receivables.map((item) => (item.invoiceId === invoiceId ? { ...item, status: 'cancelled', balance: 0, cancelledAt: now(), cancelReason: reason } : item)),
          customers: relatedReceivable
            ? state.customers.map((customer) => (customer.id === relatedReceivable.customerId ? { ...customer, balance: Math.max(toNumber(customer.balance) - toNumber(relatedReceivable.balance), 0), updatedAt: now() } : customer))
            : state.customers,
          cashRegister: {
            ...state.cashRegister,
            expected: state.cashRegister.expected - nonCreditCash - paidCash,
            movements: [
              ...(invoice.payments || []).filter((payment) => payment.method !== 'Credito').map((payment) => ({
                id: id('cashmov'),
                type: 'invoice_void_reversal',
                amount: toNumber(payment.amount),
                method: payment.method || 'Efectivo',
                concept: `Anulacion factura ${invoice.number}`,
                reference: invoice.id,
                invoiceId: invoice.id,
                source: 'invoice',
                status: 'active',
                createdAt: now(),
              })),
              ...relatedPayments.map((payment) => ({
                id: id('cashmov'),
                type: 'payment_void_reversal',
                amount: toNumber(payment.amount),
                method: payment.method,
                concept: `Reversa pago ${invoice.number}`,
                reference: payment.reference || payment.id,
                invoiceId: invoice.id,
                paymentId: payment.id,
                source: 'receivables',
                status: 'active',
                createdAt: now(),
              })),
              ...state.cashRegister.movements,
            ],
          },
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('invoice.void', 'Fiscal', invoice.number, reason)
      },

      deleteInvoice(invoiceId, reason = '') {
        const state = get()
        const invoice = state.invoices.find((item) => item.id === invoiceId)
        if (!invoice) throw new Error('La factura no existe.')
        const canDelete = invoice.status === 'draft' || invoice.ncfType === 'NO_FISCAL' || !invoice.ncf
        if (!canDelete) throw new Error('Las facturas fiscales emitidas se anulan, no se eliminan. Use anulacion con motivo.')
        if (invoice.status !== 'draft' && (!reason?.trim() || reason.trim().length < 10)) throw new Error('La eliminacion requiere un motivo de al menos 10 caracteres.')
        const activeCreditNotes = state.creditNotes.filter((note) => note.invoiceId === invoiceId && note.status !== 'voided' && note.status !== 'anulada')
        if (activeCreditNotes.length) throw new Error('No se puede eliminar una factura con notas de credito activas. Anule o elimine primero sus notas de credito.')
        const removesIssuedInvoice = invoice.status !== 'draft'
        const alreadyReversed = invoice.status === 'voided' || invoice.status === 'anulada'
          || state.inventoryMovements.some((movement) => movement.invoiceId === invoiceId && movement.type === inventoryMovementTypes.SALE_REVERSAL)
        // A previously voided non-fiscal invoice has already returned stock and
        // reversed cash. Deleting its record must only remove its traces.
        const needsReversal = removesIssuedInvoice && !alreadyReversed
        const nonCreditCash = needsReversal ? getNonCreditAmount(invoice) : 0
        const relatedPayments = state.payments.filter((payment) => payment.invoiceId === invoiceId && payment.status !== 'voided')
        const paidCash = needsReversal ? relatedPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0) : 0
        const relatedPaymentIds = state.payments.filter((payment) => payment.invoiceId === invoiceId).map((payment) => payment.id)
        const relatedReceivableIds = state.receivables.filter((item) => item.invoiceId === invoiceId).map((item) => item.id)
        const relatedFinancialMovementIds = state.financialMovements.filter((movement) => movement.invoiceId === invoiceId || movement.documentId === invoiceId).map((movement) => movement.id)
        const relatedInventoryMovementIds = state.inventoryMovements.filter((movement) => isInventoryMovementLinkedToInvoice(movement, invoice)).map((movement) => movement.id)
        set((state) => ({
          invoices: state.invoices.filter((item) => item.id !== invoiceId),
          products: needsReversal ? state.products.map((product) => restoreProductFromDeletedInvoice(product, invoice)) : state.products,
          inventoryMovements: state.inventoryMovements.filter((movement) => !isInventoryMovementLinkedToInvoice(movement, invoice)),
          payments: state.payments.filter((payment) => payment.invoiceId !== invoiceId),
          receivables: state.receivables.filter((item) => item.invoiceId !== invoiceId),
          financialMovements: state.financialMovements.filter((movement) => movement.invoiceId !== invoiceId && movement.documentId !== invoiceId),
          conduces: state.conduces.map((deliveryNote) => deliveryNote.invoiceId === invoiceId ? { ...deliveryNote, status: 'open', invoiceId: '', updatedAt: now() } : deliveryNote),
          customers: state.receivables.some((r) => r.invoiceId === invoiceId)
            ? state.customers.map((customer) => {
                const relatedReceivable = state.receivables.find((r) => r.invoiceId === invoiceId && r.customerId === customer.id)
                return relatedReceivable
                  ? { ...customer, balance: Math.max(toNumber(customer.balance) - toNumber(relatedReceivable.balance), 0), updatedAt: now() }
                  : customer
              })
            : state.customers,
          cashRegister: removesIssuedInvoice
            ? {
                ...state.cashRegister,
                expected: moneyValue(state.cashRegister.expected - nonCreditCash - paidCash),
                movements: state.cashRegister.movements.filter((movement) => !isCashMovementLinkedToInvoice(movement, invoice)),
              }
            : state.cashRegister,
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('invoice.delete', 'Facturacion', invoice, reason || 'Borrador eliminado')
        deleteRemoteDoc('invoices', invoiceId).catch(() => {})
        relatedPaymentIds.forEach((idValue) => deleteRemoteDoc('payments', idValue).catch(() => {}))
        relatedReceivableIds.forEach((idValue) => deleteRemoteDoc('receivables', idValue).catch(() => {}))
        relatedFinancialMovementIds.forEach((idValue) => deleteRemoteDoc('financialMovements', idValue).catch(() => {}))
        relatedInventoryMovementIds.forEach((idValue) => deleteRemoteDoc('inventoryMovements', idValue).catch(() => {}))
      },

      duplicateInvoice(invoiceId) {
        const invoice = get().invoices.find((item) => item.id === invoiceId)
        if (!invoice) throw new Error('La factura no existe.')
        const draft = {
          ...invoice,
          id: id('draft'),
          number: get().nextDocumentNumber('BOR'),
          ncf: '',
          authenticationSerial: '',
          verificationToken: '',
          status: 'draft',
          issueDate: today(),
          createdAt: now(),
          updatedAt: now(),
        }
        set((state) => ({ invoices: [draft, ...state.invoices] }))
        get().refreshReportStats()
        get().addAudit('invoice.duplicate', 'Facturacion', invoice.number, draft.number)
        return draft
      },

      upsertQuote(quote) {
        const totals = calculateInvoice(quote.items || [], quote.mode || invoiceModes.TAXED)
        const existing = get().quotes.find((item) => item.id === quote.id)
        const customer = get().customers.find((c) => c.id === quote.customerId)
        const payload = {
          ...quote,
          id: quote.id || id('quote'),
          customerName: quote.customerName || customer?.name || 'Cliente',
          number: quote.number || existing?.number || get().nextDocumentNumber('COT'),
          version: quote.version || existing?.version || 1,
          status: quote.status || 'Borrador',
          validUntil: quote.validUntil || addDays(today(), 15),
          totals,
          createdAt: quote.createdAt || now(),
          updatedAt: now(),
          versions: quote.versions || existing?.versions || [],
        }
        set((state) => ({ quotes: existing ? state.quotes.map((item) => (item.id === payload.id ? payload : item)) : [payload, ...state.quotes] }))
        get().refreshReportStats()
        get().addAudit(existing ? 'quote.update' : 'quote.create', 'Cotizaciones', existing || null, payload)
        return payload
      },

      createDeliveryNote(data) {
        if (!data.customerId) throw new Error('Seleccione un cliente para el conduce.')
        if (!data.items?.length) throw new Error('Agregue productos al conduce.')
        const customer = get().customers.find((item) => item.id === data.customerId)
        const existing = get().conduces.find((item) => item.id === data.id)
        const totals = calculateInvoice(data.items, data.mode || invoiceModes.NO_TAX)
        const deliveryNote = {
          ...existing,
          ...data,
          id: data.id || id('conduce'),
          number: data.number || existing?.number || get().nextDocumentNumber('CON'),
          customerName: data.customerName || customer?.name || 'Cliente',
          status: data.status || existing?.status || 'open',
          totals,
          createdAt: data.createdAt || existing?.createdAt || now(),
          updatedAt: now(),
        }
        set((state) => ({ conduces: [deliveryNote, ...state.conduces.filter((item) => item.id !== deliveryNote.id)] }))
        get().refreshReportStats()
        get().addAudit(existing ? 'delivery_note.update' : 'delivery_note.create', 'Conduce', existing || null, deliveryNote)
        return deliveryNote
      },

      deleteDeliveryNote(deliveryNoteId, reason = 'Eliminacion manual') {
        const deliveryNote = get().conduces.find((item) => item.id === deliveryNoteId)
        if (!deliveryNote) throw new Error('El conduce no existe.')
        set((state) => ({ conduces: state.conduces.filter((item) => item.id !== deliveryNoteId) }))
        get().refreshReportStats()
        get().addAudit('delivery_note.delete', 'Conduce', deliveryNote, reason)
        deleteRemoteDoc('conduces', deliveryNoteId).catch(() => {})
      },

      convertDeliveryNoteToInvoice(deliveryNoteId, invoiceData = {}) {
        const deliveryNote = get().conduces.find((item) => item.id === deliveryNoteId)
        if (!deliveryNote) throw new Error('El conduce no existe.')
        if (deliveryNote.status === 'converted') throw new Error('Este conduce ya fue convertido a factura.')
        const { id: _deliveryNoteId, ...deliveryNoteRest } = deliveryNote
        void _deliveryNoteId
        const invoice = get().createInvoice({
          ...deliveryNoteRest,
          ...invoiceData,
          customerId: invoiceData.customerId || deliveryNote.customerId,
          items: invoiceData.items || deliveryNote.items,
          notesCustomer: invoiceData.notesCustomer || deliveryNote.notesCustomer,
          sourceDeliveryNoteId: deliveryNote.id,
        })
        set((state) => {
          const updatedReceivables = state.receivables.map((rec) => rec.invoiceId === deliveryNoteId ? { ...rec, invoiceId: invoice.id, invoiceNumber: invoice.number, updatedAt: now() } : rec)
          const updatedPayments = state.payments.map((pay) => pay.invoiceId === deliveryNoteId ? { ...pay, invoiceId: invoice.id, updatedAt: now() } : pay)
          const updatedFinancialMovements = (state.financialMovements || []).map((fm) => fm.invoiceId === deliveryNoteId ? { ...fm, invoiceId: invoice.id, documentId: invoice.id, documentNumber: invoice.number, updatedAt: now() } : fm)
          return {
            conduces: state.conduces.map((item) => (item.id === deliveryNoteId ? { ...item, status: 'converted', invoiceId: invoice.id, updatedAt: now() } : item)),
            receivables: updatedReceivables,
            payments: updatedPayments,
            financialMovements: updatedFinancialMovements,
          }
        })
        get().refreshReportStats()
        get().addAudit('delivery_note.convert', 'Conduce', deliveryNote.number, invoice.number)
        return invoice
      },

      createCreditNote({ invoiceId, items = [], reason = '', payments = [] }) {
        if (!reason?.trim() || reason.trim().length < 10) throw new Error('La nota de credito requiere un motivo de al menos 10 caracteres.')
        const invoice = get().invoices.find((item) => item.id === invoiceId)
        if (!invoice) throw new Error('La factura original no existe.')
        if (invoice.status === 'voided') throw new Error('No se puede hacer nota de credito a una factura anulada.')
        const previousCreditNotes = get().creditNotes.filter((note) => note.invoiceId === invoiceId && note.status !== 'voided')
        const creditItems = normalizeCreditNoteItems(invoice, items, previousCreditNotes)
        const totals = calculateInvoice(creditItems, invoice.mode || invoiceModes.TAXED)
        const creditSequence = invoice.ncf ? get().taxSequences.find((sequence) => sequence.id === 'B04') : null
        if (invoice.ncf && !creditSequence) throw new Error('Configure la secuencia B04 para emitir nota de credito fiscal.')
        if (creditSequence) assertValidTaxSequence(creditSequence)
        const creditNumber = creditSequence ? nextNcf(creditSequence) : get().nextDocumentNumber('NC')
        const note = {
          id: id('credit-note'),
          number: creditNumber,
          ncf: creditSequence ? creditNumber : '',
          invoiceId,
          invoiceNumber: invoice.number,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          ncfType: 'B04',
          mode: invoice.mode,
          items: creditItems,
          totals,
          reason,
          payments,
          status: 'issued',
          createdAt: now(),
          updatedAt: now(),
        }
        const reversalMovements = buildCreditNoteMovements(note, get().products)
        const creditCash = payments.filter((payment) => payment.method !== 'Credito').reduce((sum, payment) => sum + toNumber(payment.amount), 0)
        const creditReduction = moneyValue(Math.max(totals.total - creditCash, 0))
        set((state) => ({
          creditNotes: [note, ...state.creditNotes],
          taxSequences: creditSequence ? state.taxSequences.map((sequence) => (sequence.id === 'B04' ? { ...sequence, next: toNumber(sequence.next) + 1 } : sequence)) : state.taxSequences,
          products: state.products.map((product) => restoreProductFromCreditNote(product, creditItems, note)),
          inventoryMovements: [...reversalMovements, ...state.inventoryMovements],
          invoices: state.invoices.map((inv) => {
            if (inv.id !== invoiceId) return inv
            var currentBalanceDue = toNumber(inv.balanceDue)
            if (currentBalanceDue <= 0 && inv.id) currentBalanceDue = Math.max(0, toNumber(inv.totals?.total || 0) - toNumber(inv.paidAmount || 0))
            var newBalanceDue = Math.max(currentBalanceDue - creditReduction, 0)
            var newPaidAmount = Math.max(toNumber(inv.paidAmount || 0) - creditCash, 0)
            const newCreditAmount = Math.max(toNumber(inv.creditAmount || 0) - creditReduction, 0)
            return { ...inv, balanceDue: newBalanceDue, paidAmount: newPaidAmount, creditAmount: newCreditAmount, paymentStatus: newBalanceDue <= 0 ? 'paid' : inv.paymentStatus, status: newBalanceDue <= 0 ? 'paid' : inv.status }
          }),
          receivables: state.receivables.map((receivable) => (
            receivable.invoiceId === invoiceId
              ? { ...receivable, balance: Math.max(toNumber(receivable.balance) - creditReduction, 0), status: toNumber(receivable.balance) - creditReduction <= 0 ? 'paid' : receivable.status, updatedAt: now() }
              : receivable
          )),
          customers: state.customers.map((customer) => (customer.id === invoice.customerId ? { ...customer, balance: Math.max(toNumber(customer.balance) - creditReduction, 0), updatedAt: now() } : customer)),
          cashRegister: {
            ...state.cashRegister,
            expected: state.cashRegister.expected - creditCash,
            movements: creditCash > 0
              ? [{
                  id: id('cashmov'),
                  type: 'credit_note_refund',
                  amount: creditCash,
                  method: payments.find((payment) => payment.method !== 'Credito')?.method || 'Reembolso',
                  concept: `Nota de credito ${note.number}`,
                  reference: invoice.number,
                  invoiceId: invoice.id,
                  creditNoteId: note.id,
                  source: 'credit_note',
                  status: 'active',
                  createdAt: now(),
                }, ...state.cashRegister.movements]
              : state.cashRegister.movements,
          },
        }))
        validateGlobalSerialIntegrity(get().products)
        get().refreshReportStats()
        get().addAudit('credit_note.create', 'Facturacion', invoice.number, note)
        return note
      },

      nextDocumentNumber(prefix) {
        const state = get()
        const counterNext = toNumber(state.documentCounters?.[prefix])
        const existingNext = maxNumberForPrefix(prefix, [
          ...state.invoices,
          ...state.quotes,
          ...(state.conduces || []),
          ...(state.creditNotes || []),
        ]) + 1
        const next = Math.max(counterNext || 1, existingNext)
        const number = `${prefix}-${String(next).padStart(6, '0')}`
        set((current) => ({ documentCounters: { ...(current.documentCounters || {}), [prefix]: next + 1 } }))
        return number
      },

      deleteQuote(quoteId) {
        const quote = get().quotes.find((item) => item.id === quoteId)
        if (!quote) throw new Error('La cotizacion no existe.')
        const versionIds = new Set([quoteId, ...(quote.versions || []).map((v) => v.id)])
        set((state) => ({ quotes: state.quotes.filter((item) => !versionIds.has(item.id)) }))
        get().refreshReportStats()
        get().addAudit('quote.delete', 'Cotizaciones', quote, null)
        deleteRemoteDoc('quotes', quoteId).catch(() => {})
      },

      newQuoteVersion(quoteId) {
        const quote = get().quotes.find((item) => item.id === quoteId)
        if (!quote) throw new Error('La cotizacion no existe.')
        const archived = { ...quote, archivedAt: now() }
        const versioned = {
          ...quote,
          id: id('quote'),
          number: get().nextDocumentNumber('COT'),
          sourceQuoteId: quote.sourceQuoteId || quote.id,
          previousQuoteId: quote.id,
          version: toNumber(quote.version || 1) + 1,
          status: 'Borrador',
          invoiceId: '',
          versions: [...(quote.versions || []), archived],
          createdAt: now(),
          updatedAt: now(),
        }
        set((state) => ({ quotes: [versioned, ...state.quotes.map((item) => (item.id === quoteId ? { ...item, status: item.status === 'Convertida' ? item.status : 'Versionada', updatedAt: now() } : item))] }))
        get().refreshReportStats()
        get().addAudit('quote.version', 'Cotizaciones', quote.version, versioned.version)
        return versioned
      },

      convertQuoteToInvoice(quoteId, ncfType) {
        const quote = get().quotes.find((item) => item.id === quoteId)
        if (!quote) throw new Error('La cotizacion no existe.')
        const draft = get().saveInvoiceDraft({
          customerId: quote.customerId,
          customerName: quote.customerName,
          mode: quote.mode,
          ncfType,
          items: quote.items,
          issueDate: today(),
          dueDate: quote.dueDate,
          seller: quote.seller,
          notesCustomer: quote.notesCustomer,
          payments: [],
        })
        set((state) => ({ quotes: state.quotes.map((item) => (item.id === quoteId ? { ...item, status: 'Convertida', invoiceId: draft.id } : item)) }))
        get().refreshReportStats()
        get().addAudit('quote.convert', 'Cotizaciones', quote.number, draft.number)
        return draft
      },

      registerPayment({ invoiceId, amount, method, reference, comment = '', date = today() }) {
        assertPositiveAmount(amount, 'Monto del pago')
        const paymentAmount = moneyValue(amount)
        const receivable = get().receivables.find((item) => item.invoiceId === invoiceId)
        if (!receivable) throw new Error('La cuenta por cobrar no existe.')
        const currentBalance = moneyValue(receivable.balance)
        if (paymentAmount > currentBalance) throw new Error(`El pago excede el balance pendiente de RD$${currentBalance.toFixed(2)}.`)
        const nextBalance = moneyValue(currentBalance - paymentAmount)
        const payment = {
          id: id('payment'),
          invoiceId,
          receivableId: receivable.id,
          amount: paymentAmount,
          method,
          reference,
          comment,
          date,
          createdAt: now(),
          user: get().currentUser?.name || 'Sistema',
          balanceBefore: currentBalance,
          balanceAfter: nextBalance,
          origin: 'receivable',
          status: 'active',
        }
        const nextPaid = moneyValue(toNumber(receivable.paid) + paymentAmount)
        const cashMovement = {
          id: id('cashmov'),
          type: 'income',
          amount: paymentAmount,
          method,
          concept: `Pago ${receivable.invoiceNumber}`,
          reference,
          invoiceId,
          paymentId: payment.id,
          source: 'receivables',
          status: 'active',
          createdAt: now(),
        }
        set((state) => ({
          payments: [payment, ...state.payments],
          receivables: state.receivables.map((item) =>
            item.invoiceId === invoiceId
              ? { ...item, paid: nextPaid, balance: nextBalance, status: receivableStatus({ ...item, paid: nextPaid, balance: nextBalance }), lastPaymentAt: payment.createdAt, payments: [payment, ...(item.payments || [])], updatedAt: now() }
              : item,
          ),
          financialMovements: [makeFinancialMovement({
            type: nextBalance <= 0 ? 'Pago Completo' : 'Abono Registrado',
            documentId: invoiceId,
            documentNumber: receivable.invoiceNumber,
            invoiceId,
            paymentId: payment.id,
            customerId: receivable.customerId,
            customerName: receivable.customerName,
            amount: paymentAmount,
            method,
            reference,
            observations: comment || `Balance ${currentBalance.toFixed(2)} -> ${nextBalance.toFixed(2)}`,
            user: payment.user,
            createdAt: payment.createdAt,
          }, state.activeCompanyId), ...(state.financialMovements || [])],
          invoices: state.invoices.map((invoice) => {
            if (invoice.id !== invoiceId) return invoice
            const paidAmount = moneyValue(toNumber(invoice.paidAmount) + paymentAmount)
            const balanceDue = nextBalance
            return {
              ...invoice,
              paidAmount,
              balanceDue,
              paymentStatus: balanceDue <= 0 ? 'paid' : 'partial',
              status: balanceDue <= 0 ? 'paid' : 'partial',
              updatedAt: now(),
            }
          }),
          customers: state.customers.map((customer) => (customer.id === receivable.customerId ? { ...customer, balance: moneyValue(Math.max(toNumber(customer.balance) - paymentAmount, 0)), updatedAt: now() } : customer)),
          cashRegister: {
            ...state.cashRegister,
            expected: moneyValue(toNumber(state.cashRegister.expected) + paymentAmount),
            movements: [cashMovement, ...state.cashRegister.movements],
          },
        }))
        get().refreshReportStats()
        get().addAudit('receivable.payment', 'Cuentas por cobrar', receivable.balance, nextBalance)
        return payment
      },

      updateReceivablePayment(paymentId, updates = {}) {
        const state = get()
        const previous = state.payments.find((item) => item.id === paymentId)
        if (!previous) throw new Error('El abono no existe.')
        if (previous.origin === 'initial') throw new Error('El abono inicial se edita desde la factura.')
        const receivable = state.receivables.find((item) => item.invoiceId === previous.invoiceId)
        if (!receivable) throw new Error('La cuenta por cobrar no existe.')
        const nextAmount = 'amount' in updates ? moneyValue(updates.amount) : moneyValue(previous.amount)
        assertPositiveAmount(nextAmount, 'Monto del abono')
        const delta = moneyValue(nextAmount - moneyValue(previous.amount))
        const currentBalance = moneyValue(receivable.balance)
        if (delta > currentBalance) throw new Error(`El ajuste excede el balance pendiente de RD$${currentBalance.toFixed(2)}.`)
        const nextBalance = moneyValue(currentBalance - delta)
        const nextPaid = moneyValue(toNumber(receivable.paid) + delta)
        const next = {
          ...previous,
          ...updates,
          amount: nextAmount,
          balanceBefore: moneyValue(toNumber(previous.balanceBefore) || currentBalance + moneyValue(previous.amount)),
          balanceAfter: nextBalance,
          updatedAt: now(),
          updatedBy: state.currentUser?.name || 'Sistema',
        }
        set((current) => ({
          payments: current.payments.map((payment) => (payment.id === paymentId ? next : payment)),
          receivables: current.receivables.map((item) => (
            item.invoiceId === previous.invoiceId
              ? { ...item, paid: nextPaid, balance: nextBalance, status: receivableStatus({ ...item, paid: nextPaid, balance: nextBalance }), payments: (item.payments || []).map((payment) => (payment.id === paymentId ? next : payment)), updatedAt: now() }
              : item
          )),
          invoices: current.invoices.map((invoice) => (
            invoice.id === previous.invoiceId
              ? { ...invoice, paidAmount: nextPaid, balanceDue: nextBalance, paymentStatus: nextBalance <= 0 ? 'paid' : 'partial', status: nextBalance <= 0 ? 'paid' : 'partial', updatedAt: now() }
              : invoice
          )),
          customers: current.customers.map((customer) => (
            customer.id === receivable.customerId
              ? { ...customer, balance: moneyValue(Math.max(toNumber(customer.balance) - delta, 0)), updatedAt: now() }
              : customer
          )),
          cashRegister: {
            ...current.cashRegister,
            expected: moneyValue(toNumber(current.cashRegister.expected) + delta),
            movements: (current.cashRegister.movements || []).map((movement) => (movement.paymentId === paymentId ? { ...movement, amount: nextAmount, method: next.method, reference: next.reference, updatedAt: now() } : movement)),
          },
          financialMovements: [makeFinancialMovement({
            type: 'Abono Editado',
            documentId: previous.invoiceId,
            documentNumber: receivable.invoiceNumber,
            invoiceId: previous.invoiceId,
            paymentId,
            customerId: receivable.customerId,
            customerName: receivable.customerName,
            amount: Math.abs(delta),
            method: next.method,
            reference: next.reference,
            observations: `Abono ajustado de ${moneyValue(previous.amount).toFixed(2)} a ${nextAmount.toFixed(2)}. ${next.comment || ''}`.trim(),
            user: current.currentUser?.name || 'Sistema',
          }, current.activeCompanyId), ...(current.financialMovements || [])],
        }))
        get().refreshReportStats()
        get().addAudit('receivable.payment.update', 'Cuentas por cobrar', previous, next)
        return next
      },

      deleteReceivablePayment(paymentId, reason = 'Eliminacion de abono') {
        const state = get()
        const payment = state.payments.find((item) => item.id === paymentId)
        if (!payment) throw new Error('El abono no existe.')
        if (payment.origin === 'initial') throw new Error('El abono inicial se elimina editando la factura.')
        const receivable = state.receivables.find((item) => item.invoiceId === payment.invoiceId)
        if (!receivable) throw new Error('La cuenta por cobrar no existe.')
        const paymentAmount = moneyValue(payment.amount)
        const nextBalance = moneyValue(toNumber(receivable.balance) + paymentAmount)
        const nextPaid = moneyValue(Math.max(toNumber(receivable.paid) - paymentAmount, 0))
        set((current) => ({
          payments: current.payments.filter((item) => item.id !== paymentId),
          receivables: current.receivables.map((item) => (
            item.invoiceId === payment.invoiceId
              ? { ...item, paid: nextPaid, balance: nextBalance, status: receivableStatus({ ...item, paid: nextPaid, balance: nextBalance }), payments: (item.payments || []).filter((row) => row.id !== paymentId), updatedAt: now() }
              : item
          )),
          invoices: current.invoices.map((invoice) => (
            invoice.id === payment.invoiceId
              ? { ...invoice, paidAmount: nextPaid, balanceDue: nextBalance, paymentStatus: nextBalance <= 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'pending', status: nextBalance <= 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'credit', updatedAt: now() }
              : invoice
          )),
          customers: current.customers.map((customer) => (
            customer.id === receivable.customerId
              ? { ...customer, balance: moneyValue(toNumber(customer.balance) + paymentAmount), updatedAt: now() }
              : customer
          )),
          cashRegister: {
            ...current.cashRegister,
            expected: moneyValue(toNumber(current.cashRegister.expected) - paymentAmount),
            movements: (current.cashRegister.movements || []).filter((movement) => movement.paymentId !== paymentId),
          },
          financialMovements: [makeFinancialMovement({
            type: 'Reversión',
            documentId: payment.invoiceId,
            documentNumber: receivable.invoiceNumber,
            invoiceId: payment.invoiceId,
            paymentId,
            customerId: receivable.customerId,
            customerName: receivable.customerName,
            amount: paymentAmount,
            method: payment.method,
            reference: payment.reference,
            observations: reason,
            user: current.currentUser?.name || 'Sistema',
          }, current.activeCompanyId), ...(current.financialMovements || [])],
        }))
        get().refreshReportStats()
        get().addAudit('receivable.payment.delete', 'Cuentas por cobrar', payment, { reason })
        deleteRemoteDoc('payments', paymentId).catch(() => {})
        return payment
      },

      updateReceivable(receivableId, updates = {}) {
        const state = get()
        const previous = state.receivables.find((item) => item.id === receivableId || item.invoiceId === receivableId)
        if (!previous) throw new Error('La cuenta por cobrar no existe.')
        const total = 'total' in updates ? moneyValue(updates.total) : moneyValue(previous.total)
        const paid = 'paid' in updates ? moneyValue(updates.paid) : moneyValue(previous.paid)
        const balance = 'balance' in updates ? moneyValue(updates.balance) : moneyValue(Math.max(total - paid, 0))
        if (total < 0 || paid < 0 || balance < 0) throw new Error('Los montos no pueden ser negativos.')
        if (paid > total) throw new Error('El monto pagado no puede ser mayor que el total.')
        const next = {
          ...previous,
          ...updates,
          total,
          paid,
          balance,
          status: updates.status || (balance <= 0 ? 'paid' : 'open'),
          updatedAt: now(),
        }
        const balanceDelta = moneyValue(next.balance - moneyValue(previous.balance))
        set((current) => ({
          receivables: current.receivables.map((item) => (item.id === previous.id ? next : item)),
          invoices: current.invoices.map((invoice) => (
            invoice.id === previous.invoiceId
              ? { ...invoice, status: next.balance <= 0 ? 'paid' : toNumber(next.paid) > 0 ? 'partial' : 'credit', paidAmount: toNumber(next.paid), balanceDue: toNumber(next.balance), paymentStatus: next.balance <= 0 ? 'paid' : toNumber(next.paid) > 0 ? 'partial' : 'pending', updatedAt: now() }
              : invoice
          )),
          customers: current.customers.map((customer) => (
            customer.id === previous.customerId
              ? { ...customer, balance: moneyValue(Math.max(toNumber(customer.balance) + balanceDelta, 0)), updatedAt: now() }
              : customer
          )),
        }))
        get().refreshReportStats()
        get().addAudit('receivable.update', 'Cuentas por cobrar', previous, next)
        return next
      },

      deleteReceivable(receivableId, reason = 'Eliminacion manual') {
        const state = get()
        const receivable = state.receivables.find((item) => item.id === receivableId || item.invoiceId === receivableId)
        if (!receivable) throw new Error('La cuenta por cobrar no existe.')
        set((current) => ({
          receivables: current.receivables.filter((item) => item.id !== receivable.id),
          invoices: current.invoices.map((invoice) => (
            invoice.id === receivable.invoiceId && ['credit', 'partial'].includes(invoice.status)
              ? { ...invoice, status: 'paid', paymentStatus: 'paid', paidAmount: toNumber(invoice.paidAmount || 0) + toNumber(receivable.balance), balanceDue: 0, updatedAt: now() }
              : invoice
          )),
          customers: current.customers.map((customer) => (
            customer.id === receivable.customerId
              ? { ...customer, balance: moneyValue(Math.max(toNumber(customer.balance) - toNumber(receivable.balance), 0)), updatedAt: now() }
              : customer
          )),
        }))
        get().refreshReportStats()
        get().addAudit('receivable.delete', 'Cuentas por cobrar', receivable, { reason })
        deleteRemoteDoc('receivables', receivable.id).catch(() => {})
        return receivable
      },

      createPayable({ supplierId = 'no-supplier', supplierName = '', reference = '', concept = '', amount, date = today(), dueDate = '', method = '' }) {
        assertPositiveAmount(amount, 'Monto de la cuenta por pagar')
        const value = moneyValue(amount)
        const supplier = get().suppliers.find((item) => item.id === supplierId)
        const payable = scopeRecord({
          id: id('payable'),
          type: 'account_payable',
          supplierId,
          supplierName: supplierName || supplier?.name || 'Sin proveedor',
          reference: reference || get().nextDocumentNumber('CXP'),
          concept: concept || 'Cuenta por pagar',
          amount: value,
          paid: 0,
          balance: value,
          status: 'pending',
          method,
          date,
          dueDate: dueDate || addDays(date, 30),
          payments: [],
          createdAt: now(),
          updatedAt: now(),
        }, get().activeCompanyId)
        set((state) => ({ expenses: [payable, ...state.expenses] }))
        get().refreshReportStats()
        get().addAudit('payable.create', 'Cuentas por pagar', null, payable)
        return payable
      },

      updatePayable(payableId, updates = {}) {
        const previous = get().expenses.find((item) => item.id === payableId && item.type === 'account_payable')
        if (!previous) throw new Error('La cuenta por pagar no existe.')
        const amount = 'amount' in updates ? moneyValue(updates.amount) : moneyValue(previous.amount || previous.total)
        const paid = 'paid' in updates ? moneyValue(updates.paid) : moneyValue(previous.paid)
        const balance = 'balance' in updates ? moneyValue(updates.balance) : moneyValue(Math.max(amount - paid, 0))
        if (amount < 0 || paid < 0 || balance < 0) throw new Error('Los montos no pueden ser negativos.')
        if (paid > amount) throw new Error('El monto pagado no puede ser mayor que el total.')
        const supplier = updates.supplierId ? get().suppliers.find((item) => item.id === updates.supplierId) : null
        const next = {
          ...previous,
          ...updates,
          supplierName: updates.supplierName || supplier?.name || previous.supplierName,
          amount,
          paid,
          balance,
          total: amount,
          status: updates.status || (balance <= 0 ? 'paid' : 'pending'),
          updatedAt: now(),
        }
        set((state) => ({ expenses: state.expenses.map((item) => (item.id === previous.id ? next : item)) }))
        get().refreshReportStats()
        get().addAudit('payable.update', 'Cuentas por pagar', previous, next)
        return next
      },

      registerPayablePayment({ payableId, amount, method = 'Efectivo', reference = '', date = today() }) {
        assertPositiveAmount(amount, 'Monto del pago')
        const paymentAmount = moneyValue(amount)
        const payable = get().expenses.find((item) => item.id === payableId && item.type === 'account_payable')
        if (!payable) throw new Error('La cuenta por pagar no existe.')
        const balance = moneyValue(payable.balance || payable.amount || payable.total)
        if (paymentAmount > balance) throw new Error(`El pago excede el balance pendiente de RD$${balance.toFixed(2)}.`)
        const payment = scopeRecord({
          id: id('payable-payment'),
          payableId,
          amount: paymentAmount,
          method,
          reference,
          date,
          createdAt: now(),
        }, get().activeCompanyId)
        const nextPaid = moneyValue(toNumber(payable.paid) + paymentAmount)
        const nextBalance = moneyValue(balance - paymentAmount)
        const cashMovement = scopeRecord({
          id: id('cashmov'),
          type: 'payable_payment',
          amount: paymentAmount,
          method,
          concept: `Pago CxP ${payable.reference || payable.supplierName || payable.id}`,
          reference: reference || payable.reference || payable.id,
          payableId,
          source: 'payables',
          status: 'active',
          createdAt: now(),
        }, get().activeCompanyId)
        set((state) => ({
          expenses: state.expenses.map((item) => (
            item.id === payable.id
              ? { ...item, paid: nextPaid, balance: nextBalance, status: nextBalance <= 0 ? 'paid' : 'pending', payments: [payment, ...(item.payments || [])], updatedAt: now() }
              : item
          )),
          cashRegister: {
            ...state.cashRegister,
            expected: moneyValue(toNumber(state.cashRegister.expected) - paymentAmount),
            movements: [cashMovement, ...(state.cashRegister.movements || [])],
          },
        }))
        get().refreshReportStats()
        get().addAudit('payable.payment', 'Cuentas por pagar', payable.balance, nextBalance)
        return payment
      },

      deletePayable(payableId, reason = 'Eliminacion manual') {
        const payable = get().expenses.find((item) => item.id === payableId && item.type === 'account_payable')
        if (!payable) throw new Error('La cuenta por pagar no existe.')
        set((state) => ({ expenses: state.expenses.filter((item) => item.id !== payable.id) }))
        get().refreshReportStats()
        get().addAudit('payable.delete', 'Cuentas por pagar', payable, { reason })
        deleteRemoteDoc('expenses', payable.id).catch(() => {})
        return payable
      },

      registerCashMovement({ type, amount, method, concept, reference = '', category = '', destination = '', messenger = '', movementDate = '', channel = '', notes = '' }) {
        const value = toNumber(amount)
        if (value <= 0) throw new Error('El monto del movimiento debe ser mayor que cero.')
        if (!concept?.trim()) throw new Error('El concepto del movimiento es obligatorio.')
        const movement = scopeRecord({ id: id('cashmov'), type, amount: value, method, concept, reference, category, destination, messenger, movementDate, channel, notes, source: 'manual', status: 'active', createdAt: now() }, get().activeCompanyId)
        const decreasesCash = ['expense', 'withdrawal', 'retiro'].includes(String(type || '').toLowerCase())
        set((state) => ({
          cashRegister: {
            ...state.cashRegister,
            expected: moneyValue(state.cashRegister.expected + (decreasesCash ? -value : value)),
            movements: [movement, ...state.cashRegister.movements],
          },
        }))
        get().refreshReportStats()
        get().addAudit('cash.movement', 'Caja', null, movement)
        return movement
      },

      deleteCashMovement(movementId, reason = 'Eliminacion manual') {
        const movement = (get().cashRegister?.movements || []).find((item) => item.id === movementId)
        if (!movement) throw new Error('El movimiento de caja no existe.')
        const signedAmount = cashMovementValue(movement)
        set((state) => ({
          cashRegister: {
            ...state.cashRegister,
            expected: moneyValue(toNumber(state.cashRegister.expected) - signedAmount),
            movements: (state.cashRegister.movements || []).filter((item) => item.id !== movementId),
          },
        }))
        get().refreshReportStats()
        get().addAudit('cash.movement.delete', 'Caja', movement, { reason })
        return movement
      },

      openCashRegister(input) {
        const payload = normalizeCashOpenInput(input, {
          branchId: get().selectedBranch,
          branchName: get().branches.find((branch) => branch.id === get().selectedBranch)?.name,
          cashier: get().currentUser?.name || 'Usuario',
        })
        const value = toNumber(payload.amount)
        if (value < 0) throw new Error('El monto de apertura no puede ser negativo.')
        const opened = {
          ...emptyCashRegister,
          id: id('cash'),
          status: 'open',
          branchId: payload.branchId || null,
          branchName: payload.branchName || '',
          name: payload.cashName || 'Caja principal',
          cashier: payload.cashier || get().currentUser?.name || 'Usuario',
          openedAt: now(),
          openedBy: get().currentUser?.name || 'Usuario',
          openingAmount: value,
          expected: value,
          counted: value,
          movements: [scopeRecord({ id: id('cashmov'), type: 'opening', amount: value, method: 'Efectivo', concept: 'Apertura de caja', reference: payload.branchName || '', status: 'active', createdAt: now() }, get().activeCompanyId)],
        }
        set({ cashRegister: opened })
        get().refreshReportStats()
        get().addAudit('cash.open', 'Caja', 'closed', opened)
      },

      closeCashRegister(counted) {
        const current = get().cashRegister
        if (current.status !== 'open') throw new Error('No hay una caja abierta para cerrar.')
        const closedAt = now()
        const clean = sanitizeOperationalData(get(), get().activeCompanyId)
        const report = buildCashCutReport({
          cashRegister: sanitizeCashRegister({ ...current, closedAt, counted: toNumber(counted) }, get().activeCompanyId),
          invoices: clean.invoices,
          creditNotes: clean.creditNotes,
          expenses: clean.expenses,
          company: get().company,
          branches: get().branches,
        })
        const closed = { ...current, status: 'closed', closedAt, counted: toNumber(counted), closedBy: get().currentUser?.name || 'Usuario', closingSummary: report }
        set({ cashRegister: closed })
        get().refreshReportStats()
        get().addAudit('cash.close', 'Caja', current, { counted: toNumber(counted), difference: toNumber(counted) - current.expected, summary: report })
      },

      verifyDataIntegrity() {
        const state = get()
        const invalidStatuses = new Set(['deleted', 'eliminado', 'voided', 'anulada', 'anulado'])
        const report = { orphanInvoices: 0, orphanReceivables: 0, orphanPayments: 0, orphanInventoryMovements: 0, orphanFinancialMovements: 0, orphanCreditNotes: 0, invalidStatusInvoices: 0, details: [] }
        const validInvoiceIds = new Set(state.invoices.map((inv) => inv.id))
        const validProductIds = new Set(state.products.map((p) => p.id))

        state.invoices.forEach((inv) => {
          const s = String(inv.status || '').toLowerCase()
          if (invalidStatuses.has(s)) {
            report.invalidStatusInvoices += 1; report.details.push(`Factura ${inv.number || inv.ncf || inv.id} estado '${inv.status}' (debe eliminarse)`)
          }
        })
        ;(state.receivables || []).forEach((rec) => {
          const invoice = state.invoices.find((inv) => inv.id === rec.invoiceId)
          if (!invoice) {
            report.orphanReceivables += 1; report.details.push(`CxC ${rec.id} referencia factura inexistente: ${rec.invoiceId}`)
          } else if (invalidStatuses.has(String(invoice.status || '').toLowerCase())) {
            report.orphanReceivables += 1; report.details.push(`CxC ${rec.id} referencia factura ${invoice.status}: ${invoice.number || invoice.ncf || invoice.id}`)
          }
        })
        ;(state.payments || []).forEach((pay) => {
          const invoiceExists = pay.invoiceId && state.invoices.some((inv) => inv.id === pay.invoiceId && !invalidStatuses.has(String(inv.status || '').toLowerCase()))
          const receivableExists = pay.receivableId && (state.receivables || []).some((r) => r.id === pay.receivableId)
          if (!invoiceExists && !receivableExists) {
            report.orphanPayments += 1; report.details.push(`Pago ${pay.id} sin factura ni CxC valida`)
          }
        })
        ;(state.inventoryMovements || []).forEach((mov) => {
          if (mov.productId && !validProductIds.has(mov.productId)) {
            report.orphanInventoryMovements += 1; report.details.push(`Mov inv ${mov.id} referencia producto inexistente: ${mov.productId}`)
          }
        })
        ;(state.financialMovements || []).forEach((fm) => {
          if (fm.invoiceId && !validInvoiceIds.has(fm.invoiceId)) {
            report.orphanFinancialMovements += 1; report.details.push(`Mov fin ${fm.id} referencia documento inexistente: ${fm.invoiceId}`)
          }
        })
        ;(state.creditNotes || []).forEach((note) => {
          if (!note.invoiceId) return
          const invoice = state.invoices.find((inv) => inv.id === note.invoiceId)
          if (!invoice || invalidStatuses.has(String(invoice.status || '').toLowerCase())) {
            report.orphanCreditNotes += 1; report.details.push(`NC ${note.number || note.ncf || note.id} referencia factura invalida: ${note.invoiceId}`)
          }
        })
        return report
      },

      cleanupOrphanData() {
        const state = get()
        const invalidStatuses = new Set(['deleted', 'eliminado', 'voided', 'anulada', 'anulado'])
        const removed = { invoices: 0, receivables: 0, payments: 0, inventoryMovements: 0, financialMovements: 0, creditNotes: 0 }
        const allProductIds = new Set(state.products.map((p) => p.id))
        const validInvoiceIds = new Set()
        const keptInvoiceIds = new Set()
        const keptReceivableIds = new Set()

        state.invoices.forEach((inv) => {
          const s = String(inv.status || '').toLowerCase()
          if (invalidStatuses.has(s)) { removed.invoices += 1 }
          else { validInvoiceIds.add(inv.id); keptInvoiceIds.add(inv.id) }
        })
        ;(state.receivables || []).forEach((rec) => {
          const invoice = state.invoices.find((inv) => inv.id === rec.invoiceId)
          const invoiceStatus = invoice ? String(invoice.status || '').toLowerCase() : ''
          if (!invoice || invalidStatuses.has(invoiceStatus)) { removed.receivables += 1 }
          else { keptReceivableIds.add(rec.id) }
        })
        ;(state.payments || []).forEach((pay) => {
          const hasInvoice = pay.invoiceId && keptInvoiceIds.has(pay.invoiceId)
          const hasReceivable = pay.receivableId && keptReceivableIds.has(pay.receivableId)
          if (!hasInvoice && !hasReceivable) removed.payments += 1
        })
        ;(state.inventoryMovements || []).forEach((mov) => {
          if (mov.productId && !allProductIds.has(mov.productId)) removed.inventoryMovements += 1
        })
        ;(state.financialMovements || []).forEach((fm) => {
          if (fm.invoiceId && !validInvoiceIds.has(fm.invoiceId)) removed.financialMovements += 1
        })
        ;(state.creditNotes || []).forEach((note) => {
          const invoiceExists = note.invoiceId && state.invoices.some((inv) => inv.id === note.invoiceId && !invalidStatuses.has(String(inv.status || '').toLowerCase()))
          if (note.invoiceId && !invoiceExists) removed.creditNotes += 1
        })

        if (Object.values(removed).every((v) => v === 0)) {
          return { removed, message: 'No se encontraron datos huerfanos.' }
        }

        set((current) => ({
          invoices: current.invoices.filter((inv) => !invalidStatuses.has(String(inv.status || '').toLowerCase())),
          receivables: (current.receivables || []).filter((rec) => {
            const invoice = current.invoices.find((inv) => inv.id === rec.invoiceId)
            if (!invoice) return false
            const invStatus = String(invoice.status || '').toLowerCase()
            if (invalidStatuses.has(invStatus)) return false
            return true
          }),
          payments: (current.payments || []).filter((pay) => {
            const hasInvoice = pay.invoiceId && keptInvoiceIds.has(pay.invoiceId)
            const hasReceivable = pay.receivableId && keptReceivableIds.has(pay.receivableId)
            return hasInvoice || hasReceivable
          }),
          inventoryMovements: (current.inventoryMovements || []).filter((mov) => !(mov.productId && !allProductIds.has(mov.productId))),
          financialMovements: (current.financialMovements || []).filter((fm) => !(fm.invoiceId && !validInvoiceIds.has(fm.invoiceId))),
          creditNotes: (current.creditNotes || []).filter((note) => {
            if (!note.invoiceId) return true
            const invoice = current.invoices.find((inv) => inv.id === note.invoiceId)
            return invoice && !invalidStatuses.has(String(invoice.status || '').toLowerCase())
          }),
        }))
        get().refreshReportStats()
        get().addAudit('data.cleanup', 'Sistema', null, removed)
        try {
          var persistKey = 'trifusion-erp-state-v2'
          var raw = localStorage.getItem(persistKey)
          if (raw) {
            var parsed = JSON.parse(raw)
            var fresh = get()
            parsed.state.invoices = fresh.invoices
            parsed.state.receivables = fresh.receivables
            parsed.state.payments = fresh.payments
            parsed.state.creditNotes = fresh.creditNotes
            parsed.state.financialMovements = fresh.financialMovements || []
            parsed.state.inventoryMovements = fresh.inventoryMovements
            parsed.state.tenantData = fresh.tenantData
            localStorage.setItem(persistKey, JSON.stringify(parsed))
          }
        } catch(e) { console.error('Force persist error:', e) }
        return { removed, message: `Limpieza completada. Se eliminaron ${Object.values(removed).reduce((a, b) => a + b, 0)} registros huerfanos.` }
      },

      cleanupOrphanReferences() {
        const state = get()
        const invoiceIds = new Set(state.invoices.map((inv) => inv.id))
        const keptRecvIds = new Set()
        const removed = { receivables: 0, payments: 0 }

        const safeRecvs = (state.receivables || []).filter((rec) => {
          if (invoiceIds.has(rec.invoiceId)) { keptRecvIds.add(rec.id); return true }
          removed.receivables += 1
          return false
        })

        const safePmts = (state.payments || []).filter((pay) => {
          const hasInvoice = pay.invoiceId && invoiceIds.has(pay.invoiceId)
          const hasRecv = pay.receivableId && keptRecvIds.has(pay.receivableId)
          if (hasInvoice || hasRecv) return true
          removed.payments += 1
          return false
        })

        if (removed.receivables > 0 || removed.payments > 0) {
          set({ receivables: safeRecvs, payments: safePmts })
          try {
            var persistKey = 'trifusion-erp-state-v2'
            var raw = localStorage.getItem(persistKey)
            if (raw) {
              var parsed = JSON.parse(raw)
              var fresh = get()
              parsed.state.receivables = fresh.receivables
              parsed.state.payments = fresh.payments
              localStorage.setItem(persistKey, JSON.stringify(parsed))
            }
          } catch(e) { console.error('Force persist after orphan cleanup error:', e) }
        }
        return removed
      },

      repairConduceOrphans() {
        const state = get()
        try {
          const conduceToInvoice = new Map()
          ;(state.conduces || []).forEach((c) => {
            if (c.status === 'converted' && c.invoiceId && state.invoices.some((inv) => inv.id === c.invoiceId)) {
              conduceToInvoice.set(c.id, c.invoiceId)
            }
          })
          ;(state.invoices || []).forEach((inv) => {
            if (inv.sourceDeliveryNoteId && !conduceToInvoice.has(inv.sourceDeliveryNoteId)) {
              if (state.conduces.some((c) => c.id === inv.sourceDeliveryNoteId) && state.invoices.some((i) => i.id === inv.id)) {
                conduceToInvoice.set(inv.sourceDeliveryNoteId, inv.id)
              }
            }
          })
          if (conduceToInvoice.size === 0) return { repaired: { receivables: 0, payments: 0, financialMovements: 0 }, message: 'No hay mapeos conduce->factura para reparar.' }

          let receivablesFixed = 0
          let paymentsFixed = 0
          let financialFixed = 0

          const invoiceIds = new Set(state.invoices.map((inv) => inv.id))
          const receivablesByConduce = {}
          ;(state.receivables || []).forEach((rec) => {
            if (conduceToInvoice.has(rec.invoiceId) && !invoiceIds.has(rec.invoiceId)) {
              const target = conduceToInvoice.get(rec.invoiceId)
              const countForConduce = (state.receivables || []).filter((r) => r.invoiceId === rec.invoiceId).length
              const alreadyExistsForTarget = (state.receivables || []).some((r) => r.invoiceId === target)
              if (countForConduce === 1 && !alreadyExistsForTarget) {
                if (!receivablesByConduce[rec.invoiceId]) receivablesByConduce[rec.invoiceId] = target
              }
            }
          })

          const paymentsByConduce = {}
          ;(state.payments || []).forEach((pay) => {
            if (conduceToInvoice.has(pay.invoiceId) && !invoiceIds.has(pay.invoiceId)) {
              const target = conduceToInvoice.get(pay.invoiceId)
              const countForConduce = (state.payments || []).filter((p) => p.invoiceId === pay.invoiceId).length
              if (countForConduce >= 1) {
                if (!paymentsByConduce[pay.invoiceId]) paymentsByConduce[pay.invoiceId] = target
              }
            }
          })

          const financialsByConduce = {}
          ;(state.financialMovements || []).forEach((fm) => {
            if (fm.invoiceId && conduceToInvoice.has(fm.invoiceId) && !invoiceIds.has(fm.invoiceId)) {
              const target = conduceToInvoice.get(fm.invoiceId)
              if (!financialsByConduce[fm.invoiceId]) financialsByConduce[fm.invoiceId] = target
            }
          })

          if (Object.keys(receivablesByConduce).length === 0 && Object.keys(paymentsByConduce).length === 0 && Object.keys(financialsByConduce).length === 0) {
            return { repaired: { receivables: 0, payments: 0, financialMovements: 0 }, message: 'No hay huérfanos reparables sin ambigüedad.' }
          }

          let nextReceivables = state.receivables
          let nextPayments = state.payments
          let nextFinancials = state.financialMovements || []

          if (Object.keys(receivablesByConduce).length > 0) {
            nextReceivables = state.receivables.map((rec) => {
              const target = receivablesByConduce[rec.invoiceId]
              if (target) {
                receivablesFixed += 1
                const invoice = state.invoices.find((inv) => inv.id === target)
                return { ...rec, invoiceId: target, invoiceNumber: invoice?.number || rec.invoiceNumber, updatedAt: now() }
              }
              return rec
            })
          }
          if (Object.keys(paymentsByConduce).length > 0) {
            nextPayments = state.payments.map((pay) => {
              const target = paymentsByConduce[pay.invoiceId]
              if (target) {
                paymentsFixed += 1
                return { ...pay, invoiceId: target, updatedAt: now() }
              }
              return pay
            })
            // también actualizar pagos embebidos dentro de receivables
            nextReceivables = nextReceivables.map((rec) => {
              if (!rec.payments || rec.payments.length === 0) return rec
              let changed = false
              const updatedPayments = rec.payments.map((p) => {
                const target = p.invoiceId && paymentsByConduce[p.invoiceId] ? paymentsByConduce[p.invoiceId] : (p.invoiceId && conduceToInvoice.has(p.invoiceId) ? conduceToInvoice.get(p.invoiceId) : null)
                if (target && p.invoiceId !== target) { changed = true; return { ...p, invoiceId: target } }
                return p
              })
              return changed ? { ...rec, payments: updatedPayments } : rec
            })
          }
          if (Object.keys(financialsByConduce).length > 0) {
            nextFinancials = (state.financialMovements || []).map((fm) => {
              const target = financialsByConduce[fm.invoiceId]
              if (target) {
                financialFixed += 1
                const invoice = state.invoices.find((inv) => inv.id === target)
                return { ...fm, invoiceId: target, documentId: target, documentNumber: invoice?.number || fm.documentNumber, updatedAt: now() }
              }
              return fm
            })
          }

          if (receivablesFixed > 0 || paymentsFixed > 0 || financialFixed > 0) {
            set({ receivables: nextReceivables, payments: nextPayments, financialMovements: nextFinancials })
            try {
              const persistKey = 'trifusion-erp-state-v2'
              const raw = localStorage.getItem(persistKey)
              if (raw) {
                const parsed = JSON.parse(raw)
                const fresh = get()
                parsed.state.receivables = fresh.receivables
                parsed.state.payments = fresh.payments
                parsed.state.financialMovements = fresh.financialMovements
                localStorage.setItem(persistKey, JSON.stringify(parsed))
              }
            } catch (e) { console.error('Persist repair conduce orphans error', e) }
            get().addAudit('data.repair_conduce_orphans', 'Sistema', null, { receivablesFixed, paymentsFixed, financialFixed })
          }

          return { repaired: { receivables: receivablesFixed, payments: paymentsFixed, financialMovements: financialFixed }, message: receivablesFixed + paymentsFixed + financialFixed > 0 ? `Reparados ${receivablesFixed} CxC, ${paymentsFixed} pagos y ${financialFixed} movimientos huérfanos.` : 'No se requirió reparación.' }
        } catch (e) {
          console.error('[ERP] Error en repairConduceOrphans:', e)
          return { repaired: { receivables: 0, payments: 0, financialMovements: 0 }, message: 'Error en reparación automática.' }
        }
      },

      recalculateFinancialFields() {
        const state = get()
        var fixed = { invoices: 0, receivables: 0, customers: 0 }
        var nowVal = now()

        var allPaymentsByInvoice = {}
        ;(state.payments || []).forEach(function(p) {
          if (p.status === 'deleted' || p.status === 'voided') return
          if (!p.invoiceId) return
          if (!allPaymentsByInvoice[p.invoiceId]) allPaymentsByInvoice[p.invoiceId] = []
          allPaymentsByInvoice[p.invoiceId].push(p)
        })
        var creditNoteReductions = {}
        ;(state.creditNotes || []).forEach(function(n) {
          if (n.status === 'voided' || n.status === 'draft' || n.status === 'deleted') return
          if (!n.invoiceId) return
          var creditCash = (n.payments || []).filter(function(p) { return !p.method || !p.method.toLowerCase().includes('credito') }).reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
          var reduction = moneyValue(Math.max(toNumber(n.totals?.total || n.total || 0) - creditCash, 0))
          if (reduction > 0) creditNoteReductions[n.invoiceId] = (creditNoteReductions[n.invoiceId] || 0) + reduction
        })
        var nextReceivables = (state.receivables || []).map(function(rec) {
          var globalPayments = allPaymentsByInvoice[rec.invoiceId] || []
          var recvPayments = (rec.payments || []).filter(function(p) { return p.status !== 'deleted' })
          var allPayments = globalPayments.length > recvPayments.length ? globalPayments : recvPayments
          var totalPaid = allPayments.reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
          var initialPaymentsSum = allPayments.filter(function(p) { return p.origin === 'initial' }).reduce(function(s, p) { return s + toNumber(p.amount) }, 0)
          var againstCreditPaid = totalPaid - initialPaymentsSum
          var creditNoteReduction = creditNoteReductions[rec.invoiceId] || 0
          var invoice = state.invoices.find(function(inv) { return inv.id === rec.invoiceId })
          var financed = toNumber(rec.financedAmount)
          if (financed <= 0 && invoice) {
            financed = toNumber(invoice.creditAmount) || Math.max(0, toNumber(invoice.totals?.total || invoice.total || 0) - toNumber(invoice.paidAmount || 0))
          } else if (financed <= 0) {
            financed = toNumber(rec.total || 0)
          }
          var newBalance = moneyValue(Math.max(financed - againstCreditPaid - creditNoteReduction, 0))
          var newPaid = moneyValue(totalPaid)
          var newStatus = newBalance <= 0 ? 'paid' : againstCreditPaid > 0 ? 'partial' : 'open'
          if (Math.abs(toNumber(rec.balance) - newBalance) > 0.01 || Math.abs(toNumber(rec.paid) - newPaid) > 0.01 || rec.status !== newStatus) {
            fixed.receivables++
          }
          return { ...rec, paid: newPaid, balance: newBalance, status: newStatus, updatedAt: nowVal }
        })

        var recvByInvoice = {}
        nextReceivables.forEach(function(rec) { if (rec.invoiceId) recvByInvoice[rec.invoiceId] = rec })

        var nextInvoices = state.invoices.map(function(inv) {
          var recv = recvByInvoice[inv.id]
          if (!recv) return inv
          var newPaidAmount = toNumber(recv.paid)
          var newBalanceDue = toNumber(recv.balance)
          var newStatus = newBalanceDue <= 0 ? 'paid' : newPaidAmount > 0 ? 'partial' : 'credit'
          var newPaymentStatus = newBalanceDue <= 0 ? 'paid' : newPaidAmount > 0 ? 'partial' : 'pending'
          if (Math.abs(toNumber(inv.paidAmount) - newPaidAmount) > 0.01 || Math.abs(toNumber(inv.balanceDue) - newBalanceDue) > 0.01 || inv.status !== newStatus) {
            fixed.invoices++
          }
          return { ...inv, paidAmount: newPaidAmount, balanceDue: newBalanceDue, status: newStatus, paymentStatus: newPaymentStatus, updatedAt: nowVal }
        })

        var customerReceivables = {}
        nextReceivables.forEach(function(rec) {
          if (rec.balance > 0 && rec.customerId) {
            customerReceivables[rec.customerId] = (customerReceivables[rec.customerId] || 0) + rec.balance
          }
        })

        var nextCustomers = state.customers.map(function(cust) {
          var expectedBalance = moneyValue(customerReceivables[cust.id] || 0)
          if (Math.abs(toNumber(cust.balance) - expectedBalance) > 0.01) {
            fixed.customers++
          }
          return { ...cust, balance: expectedBalance, updatedAt: nowVal }
        })

        var needsUpdate = fixed.invoices > 0 || fixed.receivables > 0 || fixed.customers > 0

        if (needsUpdate) {
          set({ receivables: nextReceivables, invoices: nextInvoices, customers: nextCustomers })
          get().refreshReportStats()
          try {
            var persistKey2 = 'trifusion-erp-state-v2'
            var raw2 = localStorage.getItem(persistKey2)
            if (raw2) {
              var parsed2 = JSON.parse(raw2)
              var fresh2 = get()
              parsed2.state.invoices = fresh2.invoices
              parsed2.state.receivables = fresh2.receivables
              parsed2.state.payments = fresh2.payments
              parsed2.state.customers = fresh2.customers
              parsed2.state.tenantData = fresh2.tenantData
              localStorage.setItem(persistKey2, JSON.stringify(parsed2))
            }
          } catch(e) { console.error('Force persist error:', e) }
          get().addAudit('data.recalculate', 'Sistema', null, fixed)
        }

        return { fixed, message: needsUpdate ? 'Balances recalculados desde pagos reales.' : 'Balances correctos, no requieren ajuste.' }
      },
    }),
    {
      name: 'trifusion-erp-state-v2',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      partialize: (state) => ({
        activeCompanyId: state.activeCompanyId,
        company: state.company,
        settings: state.settings,
        branches: state.branches,
        stores: state.stores,
        users: state.users,
        products: state.products,
        productEntries: state.productEntries,
        inventoryMovements: state.inventoryMovements,
        customers: state.customers,
        suppliers: state.suppliers,
        invoices: state.invoices,
        quotes: state.quotes,
        receivables: state.receivables,
        payments: state.payments,
        financialMovements: state.financialMovements,
        expenses: state.expenses,
        conduces: state.conduces,
        creditNotes: state.creditNotes,
        cashRegister: state.cashRegister,
        serviceOrders: state.serviceOrders,
        taxSequences: state.taxSequences,
        auditLogs: state.auditLogs,
        categories: state.categories,
        selectedBranch: state.selectedBranch,
        documentCounters: state.documentCounters,
        // NOT persisted - recomputed on every page load
        // reportStats: state.reportStats,
        // inventoryReports: state.inventoryReports,
        collapsed: state.collapsed,
        commandOpen: false,
      }),
      migrate: (persistedState) => {
        const backupKey = 'trifusion-erp-state-migration-backup-' + Date.now()
        try { localStorage.setItem(backupKey, JSON.stringify(persistedState)) } catch {}
        const migrated = migrateTenantState(persistedState)
        // Post-migration validation: ensure critical arrays survived
        const criticalArrays = ['invoices', 'quotes', 'customers', 'products', 'receivables', 'payments', 'financialMovements', 'expenses', 'conduces', 'creditNotes', 'suppliers', 'branches', 'stores', 'users', 'productEntries', 'inventoryMovements', 'serviceOrders', 'taxSequences', 'auditLogs']
        const missing = criticalArrays.filter((name) => !Array.isArray(migrated[name]))
        if (missing.length > 0) {
          console.error('[Migrate] Migracion produjo datos corruptos. Colecciones perdidas:', missing.join(', '), 'Backup guardado en', backupKey)
          // Return the best we have — migrated state may have missing arrays but won't crash
          for (const name of missing) migrated[name] = []
        }
        if (!migrated.companies?.length) {
          console.warn('[Migrate] No hay empresas tras migracion, usando predeterminada.')
        }
        return migrated
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[Persist] Error de rehidratacion, intentando recuperar datos:', error)
          const persistKey = 'trifusion-erp-state-v2'
          try {
            var raw = localStorage.getItem(persistKey)
            if (raw) {
              // 1. Save backup BEFORE any destructive action
              var backupKey = 'trifusion-erp-state-backup-' + Date.now()
              localStorage.setItem(backupKey, raw)
              console.warn('[Persist] Backup guardado en', backupKey, 'por si se necesita recuperacion manual.')

              // 2. Try field-by-field recovery: parse what we can, discard only broken fields
              var parsed = tryParseJson(raw)
              if (parsed && parsed.state && typeof parsed.state === 'object') {
                var recovered = { ...parsed.state }
                var corrupted = []
                for (var key of Object.keys(recovered)) {
                  // Expected arrays that should not be null/undefined
                  if (['invoices', 'quotes', 'customers', 'products', 'receivables', 'payments', 'expenses', 'conduces', 'creditNotes', 'suppliers', 'branches', 'stores', 'users', 'productEntries', 'inventoryMovements', 'financialMovements', 'serviceOrders', 'taxSequences', 'auditLogs', 'companies', 'companyMemberships'].includes(key)) {
                    if (!Array.isArray(recovered[key])) {
                      if (recovered[key] === null || recovered[key] === undefined) {
                        recovered[key] = []
                      } else {
                        corrupted.push(key)
                        delete recovered[key]
                      }
                    }
                  }
                }
                if (Object.keys(recovered).length > 3) {
                  // Replace storage with cleaned version
                  localStorage.setItem(persistKey, JSON.stringify({ state: recovered, version: 3 }))
                  console.warn('[Persist] Storage reparado campo por campo. Campos corruptos eliminados:', corrupted.length > 0 ? corrupted.join(', ') : 'ninguno')
                  window.location.reload()
                  return
                }
              }
            }
          } catch(e) { console.error('[Persist] No se pudo recuperar storage:', e) }
          // Last resort: full clear
          try {
            var raw2 = localStorage.getItem(persistKey)
            if (raw2) localStorage.setItem('trifusion-erp-state-backup-' + Date.now(), raw2)
            localStorage.removeItem(persistKey)
          } catch { /* ignore */ }
          window.location.reload()
        } else if (state && state.invoices && state.verifyDataIntegrity) {
          setTimeout(function() {
            try {
              var report = state.verifyDataIntegrity()
              var total = (report.invalidStatusInvoices||0)+(report.orphanReceivables||0)+(report.orphanPayments||0)+(report.orphanInventoryMovements||0)+(report.orphanFinancialMovements||0)+(report.orphanCreditNotes||0)
              if (total > 0) {
                try {
                  if (state.repairConduceOrphans) {
                    var repairResult = state.repairConduceOrphans()
                    if ((repairResult.repaired.receivables + repairResult.repaired.payments + repairResult.repaired.financialMovements) > 0) {
                      console.info('[ERP] Reparación automática de huérfanos conduce->factura:', repairResult)
                      report = state.verifyDataIntegrity()
                      total = (report.invalidStatusInvoices||0)+(report.orphanReceivables||0)+(report.orphanPayments||0)+(report.orphanInventoryMovements||0)+(report.orphanFinancialMovements||0)+(report.orphanCreditNotes||0)
                    }
                  }
                } catch (e) { console.error('[ERP] Error en reparación automática de huérfanos:', e) }
                if (total > 0) {
                  console.warn('[ERP] Inconsistencias detectadas al cargar, NO se eliminan datos automaticamente:', report)
                }
              }
              state.recalculateFinancialFields()
              state.refreshReportStats()
            } catch(e) { console.error('Post-hydration cleanup error:', e) }
          }, 100)
        }
      },
    },
  ),
)
if (import.meta.env.DEV) window.__STORE__ = useERPStore

function migrateTenantState(state = {}) {
  const company = normalizeCompany({ ...defaultCompany, ...(state.company || state.settings || {}) })
  return {
    ...state,
    customers: customerListWithGeneric(state.customers),
    activeCompanyId: company.id,
    company,
    settings: { ...company, ...(state.settings || {}) },
  }
}



function customerListWithGeneric(customers = []) {
  const list = Array.isArray(customers) ? customers : []
  return list.some((customer) => customer.id === genericCustomer.id) ? list : [genericCustomer, ...list]
}

function withGenericCustomer(invoiceData = {}) {
  return {
    ...invoiceData,
    customerId: invoiceData.customerId || genericCustomer.id,
    customerName: invoiceData.customerName || genericCustomer.name,
  }
}

function buildReceivable(invoice, customer, amount, paid = 0) {
  const initialPaid = moneyValue(paid)
  const initialPayments = invoice.payments
    ?.filter((payment) => payment.method !== CREDIT_PAYMENT_METHOD && toNumber(payment.amount) > 0)
    .map((payment) => ({
      ...payment,
      id: payment.id || id('payment'),
      invoiceId: invoice.id,
      amount: moneyValue(payment.amount),
      date: invoice.issueDate || today(),
      createdAt: invoice.issuedAt || now(),
      user: invoice.seller || 'Sistema',
      comment: 'Abono inicial registrado al emitir la factura.',
      origin: 'initial',
      balanceBefore: moneyValue(amount),
      balanceAfter: moneyValue(amount),
      status: 'active',
    })) || []
  return {
    id: id('recv'),
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerId: invoice.customerId,
    customerName: invoice.customerName || customer?.name || 'Cliente',
    total: moneyValue(invoice.totals?.total || amount),
    financedAmount: moneyValue(amount),
    paid: initialPaid,
    balance: moneyValue(amount),
    dueDate: invoice.dueDate || addDays(today(), 30),
    issueDate: invoice.issueDate || invoice.issuedAt || invoice.createdAt || today(),
    status: initialPaid > 0 ? 'partial' : 'open',
    creditType: initialPaid > 0 ? 'credito' : 'fiado',
    lastPaymentAt: initialPayments[0]?.createdAt || '',
    collectionNotes: [],
    payments: initialPayments,
    createdAt: now(),
  }
}

function makeFinancialMovement(input = {}, companyId) {
  const createdAt = input.createdAt || now()
  return scopeRecord({
    id: input.id || id('finmov'),
    date: input.date || createdAt.slice(0, 10),
    time: input.time || new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    user: input.user || 'Sistema',
    type: input.type || 'Movimiento',
    documentId: input.documentId || input.invoiceId || input.reference || '',
    documentNumber: input.documentNumber || input.invoiceNumber || '',
    invoiceId: input.invoiceId || '',
    paymentId: input.paymentId || '',
    customerId: input.customerId || '',
    customerName: input.customerName || '',
    method: input.method || '',
    reference: input.reference || '',
    amount: moneyValue(input.amount),
    observations: input.observations || input.comment || '',
    status: input.status || 'active',
  }, companyId)
}

function receivableStatus(receivable) {
  if (receivable?.status === 'collection' || receivable?.status === 'uncollectible') return receivable.status
  const balance = moneyValue(receivable?.balance)
  if (balance <= 0) return 'paid'
  const due = receivable?.dueDate ? new Date(`${receivable.dueDate}T23:59:59`) : null
  if (due && due.getTime() < Date.now()) return 'overdue'
  return toNumber(receivable?.paid) > 0 ? 'partial' : 'open'
}

function maxNumberForPrefix(prefix, documents = []) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`)
  return documents.reduce((max, document) => {
    const match = String(document?.number || '').match(pattern)
    return match ? Math.max(max, Number(match[1] || 0)) : max
  }, 0)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildInvoiceReversalMovements(invoice, existingMovements, products, reason) {
  const alreadyReversed = new Set(
    existingMovements
      .filter((movement) => movement.invoiceId === invoice.id && movement.type === 'salida_revertida')
      .map((movement) => movement.productId),
  )
  const linesByProduct = new Map()
  ;(invoice.items || []).forEach((item) => {
    const current = linesByProduct.get(item.productId) || {
      productId: item.productId,
      productName: item.name,
      quantity: 0,
      cost: toNumber(item.cost),
      serials: [],
    }
    current.quantity += toNumber(item.quantity)
    current.serials.push(...normalizeSerials(item))
    linesByProduct.set(item.productId, current)
  })
  return [...linesByProduct.values()]
    .filter((line) => line.productId && !alreadyReversed.has(line.productId) && isStockProduct(products.find((product) => product.id === line.productId)))
    .map((line) => {
      const product = products.find((item) => item.id === line.productId)
      return makeInventoryMovement({
        id: id('mov'),
        product,
        type: inventoryMovementTypes.SALE_REVERSAL,
        reason,
        quantity: line.quantity,
        quantityBefore: toNumber(product?.stock),
        quantityAfter: toNumber(product?.stock) + line.quantity,
        cost: line.cost,
        serials: line.serials,
        date: today(),
        createdAt: now(),
        source: 'anulacion',
        documentId: invoice.id,
        documentNumber: invoice.ncf || invoice.number,
        reference: reason,
        extra: { invoiceId: invoice.id },
      })
    })
}

function normalizeCreditNoteItems(invoice, items, previousCreditNotes) {
  const requested = items.length ? items : invoice.items
  return requested.map((item) => {
    const original = (invoice.items || []).find((line) => line.id === item.id || line.productId === item.productId)
    if (!original) throw new Error(`El producto ${item.name || item.productId} no pertenece a la factura original.`)
    const alreadyReturned = previousCreditNotes
      .flatMap((note) => note.items || [])
      .filter((line) => line.productId === original.productId)
      .reduce((sum, line) => sum + toNumber(line.quantity), 0)
    const quantity = toNumber(item.quantity || original.quantity)
    const available = toNumber(original.quantity) - alreadyReturned
    if (quantity <= 0) throw new Error(`La cantidad de ${original.name} debe ser mayor que cero.`)
    if (quantity > available) throw new Error(`La nota de credito excede lo disponible para ${original.name}. Disponible: ${available}.`)
    const serials = normalizeSerials(item)
    const originalSerials = normalizeSerials(original)
    if (serials.length && serials.some((serial) => !originalSerials.includes(serial))) {
      throw new Error(`Uno de los seriales de ${original.name} no pertenece a la factura original.`)
    }
    return {
      ...original,
      ...item,
      quantity,
      serials: serials.length ? serials : originalSerials.slice(0, quantity),
    }
  })
}

function buildCreditNoteMovements(note, products) {
  return (note.items || [])
    .filter((item) => isStockProduct(products.find((product) => product.id === item.productId)))
    .map((item) => {
      const product = products.find((productItem) => productItem.id === item.productId)
      const quantity = toNumber(item.quantity)
      return makeInventoryMovement({
        id: id('mov'),
        product,
        type: inventoryMovementTypes.CREDIT_NOTE,
        reason: note.reason,
        quantity,
        quantityBefore: toNumber(product?.stock),
        quantityAfter: toNumber(product?.stock) + quantity,
        cost: toNumber(item.cost),
        serials: normalizeSerials(item),
        date: today(),
        createdAt: now(),
        source: 'nota_credito',
        documentId: note.id,
        documentNumber: note.ncf || note.number,
        reference: note.invoiceNumber,
        extra: { creditNoteId: note.id, invoiceId: note.invoiceId },
      })
    })
}

function restoreProductFromCreditNote(product, creditItems, note) {
  const lines = creditItems.filter((item) => item.productId === product.id)
  if (!lines.length || !isStockProduct(product)) return product
  const qty = lines.reduce((sum, line) => sum + toNumber(line.quantity), 0)
  const returnedSerials = [...new Set(lines.flatMap(normalizeSerials))]
  const serials = new Set(normalizeSerialList(product.serials || []))
  returnedSerials.forEach((serial) => serials.add(serial))
  return {
    ...product,
    stock: toNumber(product.stock) + qty,
    serials: [...serials],
    soldSerials: (product.soldSerials || []).filter((entry) => {
      const serial = typeof entry === 'string' ? entry : entry?.serial
      return !returnedSerials.includes(serial)
    }),
    updatedAt: note.createdAt || now(),
  }
}

function restoreProductFromDeletedInvoice(product, invoice) {
  const lines = (invoice.items || []).filter((item) => item.productId === product.id)
  if (!lines.length || !isStockProduct(product)) return product
  const qty = lines.reduce((sum, line) => sum + toNumber(line.quantity), 0)
  const returnedSerials = [...new Set(lines.flatMap(normalizeSerials))]
  const serials = new Set(normalizeSerialList(product.serials || []))
  returnedSerials.forEach((serial) => serials.add(serial))
  return {
    ...product,
    stock: toNumber(product.stock) + qty,
    serials: [...serials],
    soldSerials: (product.soldSerials || []).filter((entry) => {
      const serial = typeof entry === 'string' ? entry : entry?.serial
      const soldInvoiceId = typeof entry === 'string' ? null : entry?.invoiceId
      return soldInvoiceId !== invoice.id && !returnedSerials.includes(serial)
    }),
    updatedAt: now(),
  }
}

function isInventoryMovementLinkedToInvoice(movement, invoice) {
  return movement?.invoiceId === invoice.id || movement?.documentId === invoice.id
}

function isCashMovementLinkedToInvoice(movement, invoice) {
  const concept = String(movement?.concept || '')
  const reference = String(movement?.reference || '')
  return reference === invoice.id
    || reference === invoice.number
    || reference === invoice.ncf
    || concept.includes(invoice.number || invoice.ncf || invoice.id)
}

function cashMovementValue(movement) {
  const amount = toNumber(movement?.amount)
  const type = String(movement?.type || '').toLowerCase()
  return ['expense', 'withdrawal', 'retiro', 'credit_note_refund', 'expense_adjustment', 'payable_payment', 'invoice_void_reversal', 'payment_void_reversal'].includes(type) ? -amount : amount
}

function addDays(dateText, days) {
  return addDaysIso(dateText, days)
}

function buildSku(name = 'PRODUCTO') {
  const prefix = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18)
    .toUpperCase() || 'PRODUCTO'
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-5)}`
}

function buildBarcode() {
  const timestamp = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `2${timestamp}${random}`
}

function applyGlobalDiscount(invoiceData) {
  const globalDiscount = toNumber(invoiceData.globalDiscount)
  return (invoiceData.items || []).map((item) => ({ ...item, discount: toNumber(item.discount) + globalDiscount }))
}

function freezeInvoiceItemCosts(items, products, previousInvoice = null) {
  return items.map((item) => {
    const previousLine = (previousInvoice?.items || []).find((line) => line.id === item.id || (line.productId === item.productId && sameSerialSet(line, item)))
    const product = products.find((productItem) => productItem.id === item.productId)
    return {
      ...item,
      cost: toNumber(previousLine?.cost ?? product?.cost ?? item.cost),
      historicalCost: toNumber(previousLine?.historicalCost ?? previousLine?.cost ?? product?.cost ?? item.cost),
    }
  })
}

function normalizePayments(payments = [], paymentMethod = 'Efectivo', total = 0, paymentPlan = '') {
  const clean = payments
    .filter(Boolean)
    .map((payment) => ({
      id: payment.id || id('pay'),
      method: payment.method || paymentMethod || 'Efectivo',
      amount: toNumber(payment.amount),
      reference: payment.reference || '',
    }))
    .filter((payment) => payment.amount > 0)
  const plan = String(paymentPlan || '').toLowerCase()
  if (!clean.length) {
    if (plan === 'fiado' || plan === 'credito') return [{ id: id('pay'), method: CREDIT_PAYMENT_METHOD, amount: moneyValue(total), reference: plan === 'fiado' ? 'Fiado sin inicial' : '' }]
    return [{ id: id('pay'), method: paymentMethod || 'Efectivo', amount: moneyValue(total), reference: '' }]
  }
  const hasCreditLine = clean.some((payment) => payment.method === CREDIT_PAYMENT_METHOD)
  const nonCreditTotal = clean.filter((payment) => payment.method !== CREDIT_PAYMENT_METHOD).reduce((sum, payment) => sum + toNumber(payment.amount), 0)
  const currentTotal = clean.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
  const remaining = moneyValue(toNumber(total) - currentTotal)
  if ((plan === 'credito' || plan === 'fiado') && remaining > 0) {
    return [...clean, { id: id('pay'), method: CREDIT_PAYMENT_METHOD, amount: remaining, reference: plan === 'fiado' && nonCreditTotal <= 0 ? 'Fiado sin inicial' : 'Balance financiado' }]
  }
  if ((plan === 'credito' || plan === 'fiado') && !hasCreditLine && nonCreditTotal < toNumber(total)) {
    return [...clean, { id: id('pay'), method: CREDIT_PAYMENT_METHOD, amount: moneyValue(toNumber(total) - nonCreditTotal), reference: 'Balance financiado' }]
  }
  return clean
}

function buildInvoicePaymentSummary(payments = [], total = 0) {
  const invoiceTotal = moneyValue(total)
  const paid = moneyValue(payments.filter((payment) => payment.method !== CREDIT_PAYMENT_METHOD).reduce((sum, payment) => sum + toNumber(payment.amount), 0))
  const credit = moneyValue(payments.filter((payment) => payment.method === CREDIT_PAYMENT_METHOD).reduce((sum, payment) => sum + toNumber(payment.amount), 0))
  const balance = moneyValue(Math.max(credit, invoiceTotal - paid))
  if (balance <= 0) return { paid, credit: 0, balance: 0, status: 'paid', paymentStatus: 'paid', plan: 'contado' }
  if (paid > 0) return { paid, credit: balance, balance, status: 'partial', paymentStatus: 'partial', plan: 'credito' }
  return { paid: 0, credit: balance, balance, status: 'credit', paymentStatus: 'pending', plan: 'fiado' }
}

function normalizeSerials(item) {
  return normalizeSerialList(item.serials || (item.serial ? [item.serial] : []))
}

function isStockProduct(product) {
  return product && product.category !== 'Servicios'
}

function sameSerialSet(left, right) {
  const leftSerials = normalizeSerials(left).sort().join('|')
  const rightSerials = normalizeSerials(right).sort().join('|')
  return leftSerials === rightSerials
}

function getCreditAmount(invoice) {
  return moneyValue((invoice.payments || []).filter((payment) => payment.method === CREDIT_PAYMENT_METHOD).reduce((sum, payment) => sum + toNumber(payment.amount), 0))
}

function getNonCreditAmount(invoice) {
  return moneyValue((invoice.payments || []).filter((payment) => payment.method !== CREDIT_PAYMENT_METHOD).reduce((sum, payment) => sum + toNumber(payment.amount), 0))
}

function stripInvoiceVersionHistory(invoice) {
  const snapshot = { ...(invoice || {}) }
  delete snapshot.versions
  return snapshot
}

function validateEditableInvoiceItems({ items, products, maxDiscount, originalProductIds }) {
  const productIds = new Set(items.map((item) => item.productId).filter(Boolean))
  productIds.forEach((productId) => {
    if (originalProductIds?.has(productId)) return
    const product = products.find((item) => item.id === productId)
    if (!product) throw new Error(`El producto ${productId} no existe.`)
    if (product.status === 'Inactivo') throw new Error(`${product.name} no esta disponible para facturar.`)
  })
  items.forEach((item) => {
    const product = products.find((productItem) => productItem.id === item.productId)
    const productName = item.name || product?.name || item.productId || 'Producto'
    if (toNumber(item.quantity) <= 0) throw new Error(`La cantidad de ${productName} debe ser mayor que cero.`)
    if (toNumber(item.discount) > maxDiscount) throw new Error(`${productName} supera el descuento maximo permitido de ${maxDiscount}%.`)
    if (originalProductIds?.has(item.productId) && !product) return
    if (!product) throw new Error(`Producto invalido: ${item.name || item.productId}.`)
    const serials = normalizeSerials(item)
    if (product.requiresSerial && serials.length !== toNumber(item.quantity)) throw new Error(`${product.name} requiere seleccionar ${item.quantity} serial(es).`)
  })
}

function reconcileReceivables(receivables, invoiceId, nextReceivable) {
  const withoutCurrent = receivables.filter((item) => item.invoiceId !== invoiceId)
  return nextReceivable ? [nextReceivable, ...withoutCurrent] : withoutCurrent
}

function reconcileCustomerBalances(customers, previous, nextInvoice, previousReceivable, nextReceivable) {
  const previousBalance = toNumber(previousReceivable?.balance)
  const nextBalance = toNumber(nextReceivable?.balance)
  return customers.map((customer) => {
    let balance = toNumber(customer.balance)
    if (customer.id === previous.customerId) balance -= previousBalance
    if (customer.id === nextInvoice.customerId) balance += nextBalance
    return customer.id === previous.customerId || customer.id === nextInvoice.customerId
      ? { ...customer, balance: Math.max(balance, 0), updatedAt: now() }
      : customer
  })
}

function buildInvoiceSerial(existingInvoices = [], date = now()) {
  const year = new Date(date).getFullYear()
  const existing = new Set(existingInvoices.map((invoice) => invoice.authenticationSerial).filter(Boolean))
  let serial
  do {
    serial = `TFT-${year}-${randomCode(6)}`
  } while (existing.has(serial))
  return serial
}

function buildVerificationToken(existingInvoices = []) {
  const existing = new Set(existingInvoices.map((invoice) => invoice.verificationToken).filter(Boolean))
  let token
  do {
    token = `AUTH-${randomCode(4)}-${randomCode(4)}`
  } while (existing.has(token))
  return token
}

function tryParseJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

function randomCode(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const values = new Uint32Array(length)
  randomValues(values)
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}
