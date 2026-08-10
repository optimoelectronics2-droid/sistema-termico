import { addDoc, collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, startAfter, where } from 'firebase/firestore'
import { db } from '../lib/firebase'

export const collections = [
  'users',
  'products',
  'product_serials',
  'customers',
  'suppliers',
  'invoices',
  'invoice_items',
  'quotes',
  'payments',
  'financial_movements',
  'expenses',
  'purchases',
  'purchase_items',
  'inventory_movements',
  'cash_registers',
  'cash_movements',
  'service_orders',
  'warranties',
  'settings',
  'branches',
  'audit_logs',
  'notifications',
  'reports',
  'tax_sequences',
  'companies',
  'company_members',
]

export const tenantScopedCollections = collections.filter((name) => !['users', 'companies', 'company_members'].includes(name))

export function tenantCollection(companyId, name) {
  if (!companyId) throw new Error('companyId es obligatorio para consultar datos multiempresa.')
  if (!tenantScopedCollections.includes(name)) throw new Error(`Coleccion no permitida para tenant: ${name}`)
  return collection(db, 'companies', companyId, name)
}

export function tenantDocument(companyId, name, id) {
  if (!id) return doc(tenantCollection(companyId, name))
  return doc(db, 'companies', companyId, name, id)
}

export async function listCollection(name, pageSize = 50) {
  const q = query(collection(db, name), orderBy('createdAt', 'desc'), limit(pageSize))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function listCollectionPage({ name, pageSize = 25, cursor = null, orderField = 'createdAt', direction = 'desc', filters = [] }) {
  const constraints = [
    ...filters.map((filter) => where(filter.field, filter.operator, filter.value)),
    orderBy(orderField, direction),
    limit(pageSize),
  ]
  if (cursor) constraints.splice(constraints.length - 1, 0, startAfter(cursor))
  const snapshot = await getDocs(query(collection(db, name), ...constraints))
  return {
    rows: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === pageSize,
  }
}

export async function listTenantCollectionPage({ companyId, name, pageSize = 25, cursor = null, orderField = 'createdAt', direction = 'desc', filters = [] }) {
  const constraints = [
    ...filters.map((filter) => where(filter.field, filter.operator, filter.value)),
    orderBy(orderField, direction),
    limit(pageSize),
  ]
  if (cursor) constraints.splice(constraints.length - 1, 0, startAfter(cursor))
  const snapshot = await getDocs(query(tenantCollection(companyId, name), ...constraints))
  return {
    rows: snapshot.docs.map((item) => ({ id: item.id, companyId, ...item.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === pageSize,
  }
}

export async function saveDocument(name, id, payload) {
  const ref = id ? doc(db, name, id) : doc(collection(db, name))
  await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true })
  return ref.id
}

export async function saveTenantDocument(companyId, name, id, payload) {
  const ref = tenantDocument(companyId, name, id)
  await setDoc(ref, { ...payload, companyId, tenantId: companyId, updatedAt: serverTimestamp() }, { merge: true })
  return ref.id
}

export async function appendAuditLog(payload) {
  return addDoc(collection(db, 'audit_logs'), {
    ...payload,
    createdAt: serverTimestamp(),
  })
}

export async function createFiscalInvoiceTransaction({ invoice, movements, sequenceId }) {
  return runTransaction(db, async (transaction) => {
    const invoiceRef = doc(collection(db, 'invoices'))
    transaction.set(invoiceRef, { ...invoice, createdAt: serverTimestamp() })
    movements.forEach((movement) => transaction.set(doc(collection(db, 'inventory_movements')), movement))
    if (sequenceId) {
      const sequenceRef = doc(db, 'tax_sequences', sequenceId)
      transaction.update(sequenceRef, { next: invoice.sequenceNext })
    }
    return invoiceRef.id
  })
}
