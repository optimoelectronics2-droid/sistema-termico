import {
  doc,
  collection as firestoreCollection,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { auth } from '../lib/firebase'
import { db } from '../lib/firebase'
import { useERPStore } from '../store/useERPStore'

const COLLECTION_NAMES = [
  'branches', 'stores', 'users', 'products', 'productEntries',
  'inventoryMovements', 'customers', 'suppliers', 'invoices', 'quotes',
  'receivables', 'payments', 'financialMovements', 'expenses', 'conduces',
  'creditNotes', 'serviceOrders', 'taxSequences', 'auditLogs',
]

const SINGLETON_NAMES = ['company', 'settings', 'cashRegister', 'categories', 'selectedBranch', 'documentCounters', 'reportStats', 'inventoryReports']

const SYNC_DEBOUNCE_MS = 2000
const MAX_DOCUMENT_BYTES = 950000
const MAX_BATCH_BYTES = 8 * 1024 * 1024
const MAX_BATCH_OPERATIONS = 450

let activeUid = ''
let unsubscribers = []
let unsubscribeStore = null
let applyingRemote = false
let applyingSyncMeta = false
let syncReady = false
let syncTimer = null
let previousState = null
let pendingState = null
let writeInFlight = false
let syncSuspended = false
let syncRetries = 0
let migrationDone = false
let snapshotRetries = {}
let snapshotResubTimers = {}
let lastErrorTime = 0
const ERROR_COOLDOWN_MS = 15000

// ─── Explicit delete tracking ────────────────────────────────────────
// Documents the user has explicitly requested to delete.  If the
// deleteDoc call fails (offline), the ID stays in this map so that
// handleRemoteCollection won't re-import it from a remote snapshot.
const explicitDeletes = {}  // { collectionName: Set<docId> }

// ─── Version helper ─────────────────────────────────────────────────

function getUpdatedAt(item) {
  if (!item) return 0
  const raw = item.updatedAt
  if (!raw) return 0
  if (typeof raw === 'object' && typeof raw.toDate === 'function') return raw.toDate().getTime()
  if (raw instanceof Date) return raw.getTime()
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime()
  if (typeof raw === 'number') return raw
  return 0
}

// ─── Path helpers ────────────────────────────────────────────────────

function colRef(uid, name) {
  return firestoreCollection(db, 'accounts', uid, name)
}

function docRef_ (uid, name, docId) {
  return doc(db, 'accounts', uid, name, docId)
}

function oldStateDocRef(uid) {
  return doc(db, 'accounts', uid, 'erp', 'state')
}

function serializedSize(value) {
  return JSON.stringify(value).length
}

// ─── Public API ──────────────────────────────────────────────────────

export function startErpRealtimeSync(user) {
  stopErpRealtimeSync()
  if (!user?.uid) {
    useERPStore.setState({ syncStatus: 'offline', syncUserId: null, syncHydrated: false })
    return stopErpRealtimeSync
  }

  activeUid = user.uid
  syncSuspended = false
  previousState = null
  useERPStore.setState({
    currentUser: {
      id: user.uid,
      name: user.displayName || user.email || 'Usuario',
      email: user.email || '',
      role: 'Admin',
    },
    syncStatus: 'connecting',
    syncUserId: user.uid,
    syncHydrated: false,
    syncError: '',
  })

  initializeUserSync(user).catch((error) => {
    useERPStore.setState({ syncStatus: 'error', syncError: describeError(error) })
  })

  return stopErpRealtimeSync
}

export function stopErpRealtimeSync() {
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = null
  Object.values(snapshotResubTimers).forEach(clearTimeout)
  snapshotResubTimers = {}
  snapshotRetries = {}

  unsubscribers.forEach((fn) => fn())
  unsubscribers = []
  unsubscribeStore?.()
  unsubscribeStore = null
  activeUid = ''
  syncReady = false
  applyingRemote = false
  applyingSyncMeta = false
  previousState = null
  pendingState = null
  writeInFlight = false
  syncSuspended = false
  migrationDone = false
  lastErrorTime = 0
}

// ─── Initialization ──────────────────────────────────────────────────

async function initializeUserSync(user) {
  const uid = user.uid
  await ensureAuthenticatedUser(user)

  // 1. Migrate from old monolithic erp/state to individual collections
  await migrateFromOldState(uid)

  // 2. Migrate legacy soft-deleted documents (deletedAt) to physical delete
  setSyncMeta({ syncStatus: 'syncing' })
  await cleanupLegacySoftDeletes(uid)

  // 3. Load all collections
  const preloadedState = useERPStore.getState()
  const loaded = {}
  for (const name of COLLECTION_NAMES) {
    try {
      const snapshot = await getDocs(colRef(uid, name))
      const docs = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => !d.deletedAt)  // skip legacy soft-deleted docs
      // GUARD: Never replace local data with empty remote results on initial load.
      if (docs.length === 0 && Array.isArray(preloadedState[name]) && preloadedState[name].length > 0) {
        loaded[name] = [...preloadedState[name]]
      } else {
        loaded[name] = docs
      }
    } catch {
      loaded[name] = Array.isArray(preloadedState[name]) ? [...preloadedState[name]] : []
    }
  }
  for (const name of SINGLETON_NAMES) {
    try {
      const d = await getDoc(docRef_(uid, '_singletons', name))
      loaded[name] = d.exists() ? d.data()?.value : null
    } catch {
      loaded[name] = null
    }
  }

  // 4. Apply loaded state
  applyingRemote = true
  useERPStore.setState((state) => ({ ...state, ...loaded, syncHydrated: true }))
  applyingRemote = false

  // 5. Subscribe to real-time changes on each collection with auto-reconnect
  for (const name of COLLECTION_NAMES) {
    subscribeWithRetry(name, () =>
      onSnapshot(colRef(uid, name), (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return
        handleRemoteCollection(name, snapshot)
      }, (error) => handleSnapshotError(name, error))
    )
  }

  for (const name of SINGLETON_NAMES) {
    subscribeWithRetry(name, () =>
      onSnapshot(docRef_(uid, '_singletons', name), (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return
        if (snapshot.exists()) {
          applyingRemote = true
          useERPStore.setState({ [name]: snapshot.data()?.value ?? null })
          applyingRemote = false
        }
      }, (error) => handleSnapshotError(name, error))
    )
  }

  previousState = pickSyncState(useERPStore.getState())
  syncReady = true
  setSyncMeta({ syncStatus: 'synced', syncError: '' })

  // 6. Subscribe to local store changes
  // Only syncs creations and updates to Firestore.
  // Deletions are NEVER inferred from array diffs — they happen
  // ONLY when an explicit user action calls deleteRemoteDoc().
  let zustandPrevState = pickSyncState(useERPStore.getState())
  unsubscribeStore = useERPStore.subscribe((state) => {
    const prev = zustandPrevState
    zustandPrevState = pickSyncState(state)
    if (!syncReady || syncSuspended || applyingRemote || applyingSyncMeta || !activeUid) return
    scheduleLocalSync(state, prev)
  })
}

// ─── Migration ───────────────────────────────────────────────────────

async function migrateFromOldState(uid) {
  if (migrationDone) return
  const ref = oldStateDocRef(uid)
  let snapshot
  try {
    snapshot = await getDoc(ref)
  } catch (error) {
    if (error?.message?.includes('exceeds the maximum allowed size')) {
      setSyncMeta({ syncStatus: 'syncing', syncHydrated: true, syncError: 'Migrando: leyendo estado local en vez del remoto...' })
    }
    migrationDone = true
    return
  }
  if (!snapshot.exists()) {
    migrationDone = true
    return
  }

  setSyncMeta({ syncStatus: 'syncing', syncHydrated: true, syncError: 'Migrando datos a nueva estructura de colecciones...' })

  const data = snapshot.data()?.state || {}
  let batch = writeBatch(db)
  let ops = 0
  let batchBytes = 0

  async function queueWrite(ref, value, label) {
    const size = serializedSize(value)
    if (size > MAX_DOCUMENT_BYTES) {
      console.warn(`[realtimeSync] ${label} excede ${MAX_DOCUMENT_BYTES} bytes (${size}), se omite`)
      return
    }
    if (ops > 0 && (ops >= MAX_BATCH_OPERATIONS || batchBytes + size > MAX_BATCH_BYTES)) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
      batchBytes = 0
    }
    batch.set(ref, value)
    ops++
    batchBytes += size
  }

  for (const name of COLLECTION_NAMES) {
    const items = Array.isArray(data[name]) ? data[name] : []
    for (const item of items) {
      if (!item?.id) continue
      const sanitized = sanitize(item)
      await queueWrite(docRef_(uid, name, item.id), sanitized, `${name}/${item.id}`)
    }
  }
  for (const name of SINGLETON_NAMES) {
    if (data[name] !== undefined) {
      await queueWrite(docRef_(uid, '_singletons', name), { value: sanitize(data[name]), updatedAt: serverTimestamp() }, `_singletons/${name}`)
    }
  }

  if (ops > 0) await batch.commit()

  // Delete old monolithic document
  try {
    await deleteDoc(ref)
  } catch {
    // If deletion fails (e.g. doc still too large), that's ok - we won't use it anymore
  }

  migrationDone = true
  useERPStore.setState({ syncError: '' })
}

// ─── Remote change handling ──────────────────────────────────────────

function handleRemoteCollection(name, snapshot) {
  if (applyingRemote) return
  applyingRemote = true

  const localState = useERPStore.getState()
  const localItems = Array.isArray(localState[name]) ? localState[name] : []
  const snapshotItems = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => !d.deletedAt)  // skip legacy soft-deleted docs

  // ── Explicitly-deleted items ──────────────────────────────────
  // Keep an optimistic deletion hidden until a server-confirmed snapshot no
  // longer contains it. Without this tombstone, a stale snapshot can restore
  // the record between the local delete and Firestore's delete acknowledgement.
  const currentExplicit = explicitDeletes[name]
  if (currentExplicit && !snapshot.metadata.fromCache) {
    const serverIds = new Set(snapshotItems.map((item) => item.id))
    currentExplicit.forEach((itemId) => {
      if (!serverIds.has(itemId)) currentExplicit.delete(itemId)
    })
    if (currentExplicit.size === 0) delete explicitDeletes[name]
  }
  let remoteItems = snapshotItems
  if (currentExplicit && currentExplicit.size > 0) {
    remoteItems = remoteItems.filter((d) => !currentExplicit.has(d.id))
  }

  // GUARD: Only protect empty remote when data is from cache (initial offline). Server-confirmed empty is allowed to propagate.
  if (remoteItems.length === 0 && localItems.length > 0 && snapshot.metadata.fromCache) {
    applyingRemote = false
    return
  }

  const localMap = new Map(localItems.map((i) => [i.id, i]))
  const remoteMap = new Map(remoteItems.map((i) => [i.id, i]))

  // ── Version-aware merge ────────────────────────────────────────
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()])
  const merged = []

  for (const id of allIds) {
    const local = localMap.get(id)
    const remote = remoteMap.get(id)

    // Remote-only → new remote document
    if (!local && remote) {
      merged.push(remote)
      continue
    }

    // Local-only → check if server confirms deletion
    if (local && !remote) {
      if (!snapshot.metadata.fromCache) {
        continue
      }
      merged.push(local)
      continue
    }

    // Both local and remote exist → deterministic conflict resolution by updatedAt
    const localTime = getUpdatedAt(local)
    const remoteTime = getUpdatedAt(remote)

    if (remoteTime > localTime) {
      merged.push(remote)   // remote is strictly newer
    } else {
      merged.push(local)    // local is newer or equal (prefer local on tie)
    }
  }

  useERPStore.setState({ [name]: merged })
  applyingRemote = false

  // Clear sync error on successful snapshot
  const now = Date.now()
  if (remoteItems.length > 0 && now - lastErrorTime > ERROR_COOLDOWN_MS) {
    lastErrorTime = now
    useERPStore.setState({ syncStatus: 'synced', syncError: '' })
  }
}

// ─── Local write direction ──────────────────────────────────────────

function scheduleLocalSync(state) {
  // Deletions are NEVER inferred from array diffs.  They happen ONLY
  // when an explicit user action calls deleteRemoteDoc().
  // This function only syncs creations and updates to Firestore.
  scheduleFlushOnly(state)
}

function scheduleFlushOnly(state) {
  pendingState = pickSyncState(state)
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncTimer = null
    flushChanges().catch(handleSyncError)
  }, SYNC_DEBOUNCE_MS)
}

async function flushChanges() {
  if (!activeUid || syncSuspended || !pendingState || writeInFlight) return

  const nextState = pendingState

  if (previousState && stableStr(previousState) === stableStr(nextState)) {
    pendingState = null
    return
  }

  writeInFlight = true
  pendingState = null
  setSyncMeta({ syncStatus: 'syncing' })

  try {
    await writeDiff(activeUid, previousState || {}, nextState)
    previousState = nextState
    syncRetries = 0
    // Clear error with cooldown to prevent flickering on transient issues
    const now = Date.now()
    if (now - lastErrorTime > ERROR_COOLDOWN_MS) {
      lastErrorTime = now
      setSyncMeta({ syncStatus: 'synced', syncError: '' })
    } else {
      setSyncMeta({ syncStatus: 'synced' })
    }
  } catch (error) {
    if (isBlocking(error)) {
      suspendSync(error)
      return
    }
    if (!pendingState) pendingState = nextState
    const delay = Math.min(10_000, (syncRetries + 1) * 2_000)
    syncRetries++
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      flushChanges().catch(handleSyncError)
    }, delay)
    setSyncMeta({ syncStatus: 'error', syncError: describeError(error) })
    return
  } finally {
    writeInFlight = false
  }

  if (pendingState && (!previousState || stableStr(previousState) !== stableStr(pendingState))) {
    scheduleFlushOnly(pendingState)
  }
}

async function writeDiff(uid, prev, next) {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('La sesion de Firebase no esta lista para sincronizar.')
  }

  let batch = writeBatch(db)
  let ops = 0
  let batchBytes = 0

  async function flushIfNeeded(size) {
    if (ops > 0 && (ops >= MAX_BATCH_OPERATIONS || batchBytes + size > MAX_BATCH_BYTES)) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
      batchBytes = 0
    }
  }

  // Collections: diff and write individual docs (creates + updates only).
  // Deletions are NEVER performed by writeDiff — they happen ONLY via
  // an explicit user action that calls deleteRemoteDoc().
  for (const name of COLLECTION_NAMES) {
    const prevItems = Array.isArray(prev[name]) ? prev[name] : []
    const nextItems = Array.isArray(next[name]) ? next[name] : []

    const prevMap = new Map(prevItems.filter((i) => i?.id).map((i) => [i.id, i]))
    // Added or updated items
    for (const item of nextItems) {
      if (!item?.id) continue
      const prevItem = prevMap.get(item.id)
      if (!prevItem || stableStr(prevItem) !== stableStr(item)) {
        const sanitized = sanitize(item)
        const payloadSize = serializedSize(sanitized)
        if (payloadSize > MAX_DOCUMENT_BYTES) {
          console.warn(`[realtimeSync] ${name}/${item.id} excede ${MAX_DOCUMENT_BYTES} bytes (${payloadSize}), se omite`)
          continue
        }
        await flushIfNeeded(payloadSize)
        batch.set(docRef_(uid, name, item.id), sanitized)
        ops++
        batchBytes += payloadSize
      }
    }
  }

  // Singletons
  for (const name of SINGLETON_NAMES) {
    const prevVal = prev[name]
    const nextVal = next[name]
    if (stableStr(prevVal) !== stableStr(nextVal)) {
      if (nextVal !== undefined && nextVal !== null) {
        const sanitizedVal = sanitize(nextVal)
        const payloadSize = serializedSize(sanitizedVal)
        if (payloadSize > MAX_DOCUMENT_BYTES) {
          console.warn(`[realtimeSync] singleton ${name} excede ${MAX_DOCUMENT_BYTES} bytes, se omite`)
          continue
        }
        await flushIfNeeded(payloadSize)
        batch.set(docRef_(uid, '_singletons', name), { value: sanitizedVal, updatedAt: serverTimestamp() })
        batchBytes += payloadSize
      } else {
        await flushIfNeeded(0)
        batch.delete(docRef_(uid, '_singletons', name))
      }
      ops++
    }
  }

  if (ops > 0) await batch.commit()
}

// ─── deleteRemoteDoc — the ONLY way to delete from Firestore ────────
// Called directly from store deletion actions (deleteInvoice, etc.).
// Never inferred from array diffs.  If the call fails (offline), the
// ID is tracked so handleRemoteCollection won't re-import it.

export async function deleteRemoteDoc(collectionName, id) {
  const uid = activeUid
  // Record the intent before any I/O so older snapshots cannot resurrect it.
  if (!explicitDeletes[collectionName]) explicitDeletes[collectionName] = new Set()
  explicitDeletes[collectionName].add(id)
  if (!uid) {
    console.warn(`[realtimeSync] ${collectionName}/${id} se elimino localmente sin una sesion de sincronizacion activa.`)
    return false
  }
  try {
    await deleteDoc(docRef_(uid, collectionName, id))
    return true
  } catch (error) {
    console.error(`[realtimeSync] Error al eliminar ${collectionName}/${id}. Se evitara la reimportacion:`, error?.message)
    return false
  }
}

// ─── Legacy soft-delete cleanup ─────────────────────────────────────
// One-time migration: physically delete any documents that still carry
// a deletedAt field (legacy soft-delete from previous versions).

async function cleanupLegacySoftDeletes(uid) {
  let totalPurged = 0
  for (const name of COLLECTION_NAMES) {
    try {
      const snapshot = await getDocs(colRef(uid, name))
      const legacy = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.deletedAt)
      if (legacy.length === 0) continue

      let batch = writeBatch(db)
      let ops = 0
      for (const doc of legacy) {
        batch.delete(docRef_(uid, name, doc.id))
        ops++
        if (ops >= 500) { await batch.commit(); batch = writeBatch(db); ops = 0 }
      }
      if (ops > 0) await batch.commit()
      totalPurged += legacy.length
    } catch {
      // Silently skip collections that fail (e.g. permission issues)
    }
  }
  if (totalPurged > 0) {
    console.log(`[realtimeSync] Migracion: ${totalPurged} documentos legacy soft-delete purgados fisicamente.`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickSyncState(state) {
  const picked = {}
  COLLECTION_NAMES.forEach((name) => {
    picked[name] = Array.isArray(state[name]) ? dedupe(state[name]) : []
  })
  SINGLETON_NAMES.forEach((name) => {
    picked[name] = state[name]
  })
  return picked
}

function dedupe(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (!item?.id) return false
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function sanitize(value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitize)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => typeof v !== 'function' && v !== undefined)
      .map(([k, v]) => [k, sanitize(v)])
  )
}

function stableStr(value) {
  return JSON.stringify(value ?? null)
}

function isBlocking(error) {
  if (/permission-denied|unauthenticated/i.test(error?.code || '')) return true
  if (error?.message?.includes('exceeds the maximum allowed size')) {
    suspendSync(error)
    return true
  }
  return false
}

function describeError(error) {
  const msg = error?.message || 'Error de sincronizacion'
  return error?.syncPath ? `${msg} (${error.syncPath})` : msg
}

function subscribeWithRetry(name, subscribeFn) {
  if (snapshotResubTimers[name]) {
    clearTimeout(snapshotResubTimers[name])
    delete snapshotResubTimers[name]
  }
  if (snapshotRetries[name]) snapshotRetries[name].count = 0
  const unsub = subscribeFn()
  unsubscribers.push(unsub)
}

function handleSnapshotError(name, error) {
  if (!snapshotRetries[name]) snapshotRetries[name] = { count: 0 }
  snapshotRetries[name].count++
  const delay = Math.min(30000, Math.pow(2, snapshotRetries[name].count) * 1000)

  const now = Date.now()
  if (now - lastErrorTime > ERROR_COOLDOWN_MS) {
    lastErrorTime = now
    setSyncMeta({
      syncStatus: 'error',
      syncError: `Error de conexion (${name}): ${describeError(error)}. Reintentando en ${Math.round(delay/1000)}s...`
    })
  }

  snapshotResubTimers[name] = setTimeout(() => {
    delete snapshotResubTimers[name]
    const uid = activeUid
    if (!uid) return
    if (COLLECTION_NAMES.includes(name)) {
      const unsub = onSnapshot(colRef(uid, name), (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return
        handleRemoteCollection(name, snapshot)
      }, (err) => handleSnapshotError(name, err))
      unsubscribers.push(unsub)
    } else if (SINGLETON_NAMES.includes(name)) {
      const unsub = onSnapshot(docRef_(uid, '_singletons', name), (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return
        if (snapshot.exists()) {
          applyingRemote = true
          useERPStore.setState({ [name]: snapshot.data()?.value ?? null })
          applyingRemote = false
        }
      }, (err) => handleSnapshotError(name, err))
      unsubscribers.push(unsub)
    }
  }, delay)
}

function handleSyncError(error) {
  const now = Date.now()
  if (now - lastErrorTime > ERROR_COOLDOWN_MS) {
    lastErrorTime = now
    setSyncMeta({ syncStatus: 'error', syncError: `Error de sincronizacion: ${describeError(error)}` })
  }
}

function setSyncMeta(patch) {
  applyingSyncMeta = true
  useERPStore.setState(patch)
  applyingSyncMeta = false
}

function suspendSync(error) {
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = null
  syncSuspended = true
  syncReady = false
  pendingState = null
  setSyncMeta({
    syncStatus: 'error',
    syncError: `${describeError(error)}. Sincronizacion pausada.`,
  })
}

async function ensureAuthenticatedUser(user) {
  if (!user?.uid) throw new Error('No hay usuario autenticado para sincronizar.')
  await user.getIdToken()
}
