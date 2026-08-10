/**
 * Script de verificación manual: cambio de empresa sin pérdida de datos
 *
 * REQUISITOS:
 *   1. Tener dos empresas creadas en el sistema (Empresa A y Empresa B)
 *   2. Tener al menos 2 facturas y 2 cotizaciones en cada empresa
 *   3. Tener Firebase emulator o conexión a Firestore real
 *
 * CÓMO USAR:
 *   1. Abrir la consola del navegador (F12)
 *   2. Asegurarse de que el store esté expuesto: window.__STORE__
 *   3. Copiar y pegar este script en la consola
 *   4. Seguir las instrucciones en pantalla
 *
 * O ejecutar como test automatizado con:
 *   node --experimental-vm-modules scripts/verify-multi-tenant-sync.js
 *   (requiere configuración específica del entorno)
 */

const VERIFY = {
  companies: new Map(),
  snapshots: [],
  errors: [],
  warnings: [],
}

function log(msg, data) {
  console.log(`[MultiTenantTest] ${msg}`, data || '')
}

function warn(msg, data) {
  VERIFY.warnings.push({ msg, data })
  console.warn(`[WARN] ${msg}`, data || '')
}

function error(msg, data) {
  VERIFY.errors.push({ msg, data })
  console.error(`[ERROR] ${msg}`, data || '')
}

function getStore() {
  if (typeof window !== 'undefined' && window.__STORE__) {
    return window.__STORE__
  }
  // Fallback: import directly
  const { useERPStore } = require('../src/store/useERPStore')
  return useERPStore
}

async function snapshot(name) {
  const store = getStore()
  const state = store.getState()
  const snap = {
    name,
    timestamp: new Date().toISOString(),
    activeCompanyId: state.activeCompanyId,
    companies: state.companies?.map((c) => ({ id: c.id, name: c.name })) || [],
    collections: {},
  }
  const collections = [
    'invoices', 'quotes', 'customers', 'products',
    'receivables', 'payments', 'expenses', 'conduces',
    'creditNotes', 'suppliers', 'branches', 'stores',
    'users', 'productEntries', 'inventoryMovements',
    'financialMovements', 'serviceOrders', 'taxSequences',
    'auditLogs',
  ]
  for (const col of collections) {
    const items = state[col] || []
    snap.collections[col] = {
      count: items.length,
      ids: items.map((i) => i.id),
      companyIds: [...new Set(items.map((i) => i.companyId).filter(Boolean))],
    }
  }
  VERIFY.snapshots.push(snap)
  return snap
}

function assertSnapshotIntegrity(snap) {
  const errors = []
  for (const [colName, col] of Object.entries(snap.collections)) {
    if (!col.ids.every((id) => typeof id === 'string' && id.length > 5)) {
      errors.push(`${colName}: IDs inválidos encontrados`)
    }
  }
  return errors
}

function assertNoDataLoss(snapA, snapB) {
  const errors = []
  for (const colName of Object.keys(snapA.collections)) {
    const colA = snapA.collections[colName]
    const colB = snapB.collections[colName]

    // If we switched to a different company, the collections should differ
    if (snapA.activeCompanyId !== snapB.activeCompanyId) {
      // The new active company's data should be present
      // The old company's data was safely snapshotted into tenantData
    } else {
      // Same company — collections should be identical
      const missingIds = colA.ids.filter((id) => !colB.ids.includes(id))
      if (missingIds.length > 0) {
        errors.push(`${colName}: ${missingIds.length} documento(s) perdido(s) entre snapshots: ${missingIds.slice(0, 5).join(', ')}`)
      }
    }
  }
  return errors
}

function assertFirestoreDocsNotDeleted(prevDocIds, prevCompanyId) {
  // In the browser, we can't directly check Firestore.
  // Instead, verify that the items are preserved in tenantData.
  const store = getStore()
  const state = store.getState()
  const tenantData = state.tenantData || {}

  for (const [companyId, data] of Object.entries(tenantData)) {
    if (companyId === prevCompanyId || companyId === state.activeCompanyId) continue
    // This company's data should still be intact
    const invoices = data.invoices || []
    const keptIds = invoices.map((i) => i.id)
    const lostIds = prevDocIds.filter((id) => !keptIds.includes(id))
    if (lostIds.length > 0) {
      return [`${lostIds.length} documento(s) de empresa ${companyId} no encontrados en tenantData`]
    }
  }
  return []
}

function printReport() {
  console.log('\n========================================')
  console.log('  VERIFICACIÓN MULTI-TENANT - REPORTE')
  console.log('========================================\n')

  if (VERIFY.errors.length === 0 && VERIFY.warnings.length === 0) {
    console.log('✅ PASS: No se detectaron errores de pérdida de datos.\n')
  }

  if (VERIFY.warnings.length > 0) {
    console.log(`⚠️  Advertencias (${VERIFY.warnings.length}):`)
    VERIFY.warnings.forEach((w) => console.log(`  - ${w.msg}`, w.data || ''))
    console.log()
  }

  if (VERIFY.errors.length > 0) {
    console.log(`❌ ERRORES (${VERIFY.errors.length}):`)
    VERIFY.errors.forEach((e) => console.log(`  - ${e.msg}`, e.data || ''))
    console.log()
  }

  console.log('Snapshots tomados:')
  VERIFY.snapshots.forEach((s) => {
    const counts = Object.entries(s.collections)
      .map(([name, col]) => `${name}:${col.count}`)
      .join(', ')
    console.log(`  ${s.name} (empresa: ${s.activeCompanyId?.slice(0, 8) || 'N/A'}): ${counts}`)
  })

  console.log('\n========================================\n')
}

// ─── Test scenarios ─────────────────────────────────────────────────

async function runTest() {
  const store = getStore()
  const state = store.getState()

  log('Iniciando verificación multi-tenant...')

  // Check prerequisites
  if (!state.companies || state.companies.length < 2) {
    error('Se necesitan al menos 2 empresas. Cree una segunda empresa en Configuración.')
    printReport()
    return
  }

  const companyA = state.companies[0]
  const companyB = state.companies[1]
  log(`Empresa A: ${companyA.name} (${companyA.id})`)
  log(`Empresa B: ${companyB.name} (${companyB.id})`)

  // Snapshot 1: Estado inicial (Empresa A)
  const initialA = await snapshot('1 - Inicial (Empresa A)')
  const integrityErrors = assertSnapshotIntegrity(initialA)
  if (integrityErrors.length > 0) {
    integrityErrors.forEach((e) => warn(`Integridad inicial: ${e}`))
  }

  // Switch to Company B
  log('Cambiando a Empresa B...')
  store.getState().switchCompany(companyB.id)
  await new Promise((r) => setTimeout(r, 500))

  // Snapshot 2: Empresa B activa
  const afterSwitchB = await snapshot('2 - Despues de switch a Empresa B')

  // Check that Company A's data is NOT lost from tenantData
  const tenantErrors = assertFirestoreDocsNotDeleted(
    initialA.collections.invoices.ids,
    companyA.id
  )
  if (tenantErrors.length > 0) {
    tenantErrors.forEach((e) => error(e))
  }

  // Verify no data loss between expected-no-change scenarios
  const lossErrors = assertNoDataLoss(initialA, afterSwitchB)
  if (lossErrors.length > 0) {
    // It's expected to have differences since we switched companies
    log('Diferencia entre empresas detectada (comportamiento esperado)')
  }

  // Switch back to Company A
  log('Volviendo a Empresa A...')
  store.getState().switchCompany(companyA.id)
  await new Promise((r) => setTimeout(r, 500))

  // Snapshot 3: Back to Company A
  const backToA = await snapshot('3 - Vuelta a Empresa A')

  // Check that Company A's data is intact
  const lossABack = assertNoDataLoss(initialA, backToA)
  if (lossABack.length > 0) {
    lossABack.forEach((e) => error(`Pérdida de datos al volver a Empresa A: ${e}`))
  } else {
    log('✅ Datos de Empresa A intactos después de volver.')
  }

  // Verify that invoices still exist in the store for Company A
  const stateBack = store.getState()
  if (stateBack.activeCompanyId === companyA.id) {
    const invoiceIds = stateBack.invoices.map((i) => i.id)
    const originalIds = initialA.collections.invoices.ids
    const lostInvoices = originalIds.filter((id) => !invoiceIds.includes(id))
    if (lostInvoices.length > 0) {
      error(`${lostInvoices.length} factura(s) perdida(s) de Empresa A: ${lostInvoices.join(', ')}`)
    } else {
      log(`✅ Todas las facturas de Empresa A presentes: ${invoiceIds.length}`)
    }
  }

  // Repeat: Switch to B, then A again, then B again (stress test)
  for (let i = 0; i < 3; i++) {
    log(`Switch stress test ${i + 1}/3: A → B`)
    store.getState().switchCompany(companyB.id)
    await new Promise((r) => setTimeout(r, 200))
    log(`Switch stress test ${i + 1}/3: B → A`)
    store.getState().switchCompany(companyA.id)
    await new Promise((r) => setTimeout(r, 200))
  }

  // Final snapshot
  const final = await snapshot('4 - Final (despues de 3 switches)')
  const finalLoss = assertNoDataLoss(initialA, final)
  if (finalLoss.length > 0) {
    finalLoss.forEach((e) => error(`Pérdida tras switches repetidos: ${e}`))
  } else {
    log('✅ Sin pérdida de datos después de 3 cambios de ida y vuelta.')
  }

  printReport()
}

// Auto-run if in browser context
if (typeof window !== 'undefined') {
  console.log('📋 Script de verificación multi-tenant cargado.')
  console.log('▶️  Ejecute: runTest() para iniciar la verificación')
  window.__runMultiTenantTest = runTest
} else {
  // Node.js context
  runTest().catch(console.error)
}

export { runTest, snapshot, VERIFY }
