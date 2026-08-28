/**
 * printAgentClient.js
 * Cliente WebSocket al agente local de impresión (localhost:9847).
 * - Canal principal cuando el agente está corriendo: lista impresoras reales y imprime sin diálogos (USB/Serial/BT clásico/Red 9100/PDF spooler).
 * - Fallback automático a WebUSB/WebSerial/WebBluetooth(BLE)/WebPRNT cuando no hay agente.
 * - Expone eventos onPrinterListChanged para UI en tiempo real sin recargar.
 */

const DEFAULT_URL = 'ws://localhost:9847'
const RECONNECT_BASE_MS = 1800
const RECONNECT_MAX_MS = 15000

let socket = null
let desiredUrl = DEFAULT_URL
let connected = false
let connecting = false
let reconnectTimer = null
let reconnectAttempts = 0
let manuallyClosed = false

// Estado de impresoras cacheado (último recibido del agente)
let lastPrinters = []
let lastAgentInfo = null

// listeners
const printerListeners = new Set()
const statusListeners = new Set()
const pendingRequests = new Map() // id -> { resolve, reject, timer }

let requestSeq = 1

function genId() {
  requestSeq += 1
  return `req_${Date.now()}_${requestSeq}`
}

function notifyPrinters(printers, meta = null) {
  lastPrinters = Array.isArray(printers) ? printers : []
  if (meta) lastAgentInfo = meta
  for (const fn of printerListeners) {
    try { fn(lastPrinters, lastAgentInfo) } catch { /* ignore listener error */ }
  }
}

function notifyStatus(isConnected) {
  connected = isConnected
  for (const fn of statusListeners) {
    try { fn(isConnected) } catch { /* ignore */ }
  }
}

function clearPendingWithError(message) {
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error(message))
  }
  pendingRequests.clear()
}

function sendJson(obj) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Agente no conectado')
  socket.send(JSON.stringify(obj))
}

function scheduleReconnect() {
  if (manuallyClosed) return
  if (reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_MS)
  reconnectAttempts += 1
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connect(desiredUrl).catch(() => { /* retry scheduled on close */ })
  }, delay)
}

export function getAgentUrl() {
  return desiredUrl
}

export function isAgentConnected() {
  return connected && socket && socket.readyState === WebSocket.OPEN
}

export function getLastPrinters() {
  return lastPrinters.slice()
}

export function getLastAgentInfo() {
  return lastAgentInfo
}

/**
 * Conecta al agente. Si ya está conectado, resuelve de inmediato.
 * @param {string} url - ws://localhost:9847
 */
export function connect(url = DEFAULT_URL) {
  desiredUrl = url || DEFAULT_URL

  if (isAgentConnected()) return Promise.resolve(true)
  if (connecting) {
    // Esperar a que termine el intento en curso
    return new Promise((resolve, reject) => {
      const onStatus = (ok) => {
        offStatus(onStatus)
        if (ok) resolve(true)
        else reject(new Error('No se pudo conectar al agente'))
      }
      onStatusChange(onStatus)
      // timeout 4s
      window.setTimeout(() => {
        offStatus(onStatus)
        if (isAgentConnected()) resolve(true)
        else reject(new Error('Timeout conectando al agente'))
      }, 4000)
    })
  }

  if (typeof WebSocket === 'undefined') return Promise.reject(new Error('WebSocket no disponible en este entorno'))

  connecting = true
  manuallyClosed = false

  return new Promise((resolve, reject) => {
    let settled = false
    const finishResolve = (value) => {
      if (settled) return
      settled = true
      connecting = false
      resolve(value)
    }
    const finishReject = (err) => {
      if (settled) return
      settled = true
      connecting = false
      reject(err)
    }

    try {
      const ws = new WebSocket(desiredUrl)
      socket = ws

      const openTimer = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try { ws.close() } catch { /* ignore */ }
          finishReject(new Error(`No se pudo conectar a ${desiredUrl}. Verifique que el agente esté corriendo (npm start en carpeta agent/).`))
        }
      }, 3500)

      ws.addEventListener('open', () => {
        window.clearTimeout(openTimer)
        reconnectAttempts = 0
        notifyStatus(true)
        // Pedir lista inicial
        try {
          ws.send(JSON.stringify({ type: 'list', requestId: genId() }))
        } catch { /* ignore */ }
        finishResolve(true)
      })

      ws.addEventListener('message', (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        if (!msg || typeof msg !== 'object') return

        // Respuesta a request pendiente
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
          const pending = pendingRequests.get(msg.requestId)
          pendingRequests.delete(msg.requestId)
          clearTimeout(pending.timer)
          if (msg.ok === false || msg.error) {
            pending.reject(new Error(msg.error || 'Error del agente'))
          } else {
            pending.resolve(msg)
          }
          // También puede contener printers
          if (Array.isArray(msg.printers)) notifyPrinters(msg.printers, msg.agentInfo || msg.info || null)
          return
        }

        // Evento push de lista
        if (msg.type === 'printers' && Array.isArray(msg.printers)) {
          notifyPrinters(msg.printers, msg.agentInfo || msg.info || null)
          return
        }
        if (msg.type === 'printerList' && Array.isArray(msg.printers)) {
          notifyPrinters(msg.printers, msg.agentInfo || null)
          return
        }
        // Lista genérica
        if (Array.isArray(msg.printers)) {
          notifyPrinters(msg.printers, msg.agentInfo || msg.info || null)
        }
      })

      ws.addEventListener('close', () => {
        window.clearTimeout(openTimer)
        const wasConnected = connected
        notifyStatus(false)
        if (!settled) {
          finishReject(new Error(`Conexión al agente cerrada (${desiredUrl}).`))
        }
        // Si no fue cierre manual, reintentar
        if (!manuallyClosed) {
          clearPendingWithError('Agente desconectado')
          scheduleReconnect()
        }
        // Si estaba conectado antes, ya notificamos; si no, queda desconectado
        void wasConnected
      })

      ws.addEventListener('error', () => {
        // Error suele venir seguido de close; no hacemos nada extra aquí
        // Si no abre en 3.5s, el timeout ya rechazará
      })
    } catch (err) {
      connecting = false
      finishReject(err)
    }
  })
}

export function disconnect() {
  manuallyClosed = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  clearPendingWithError('Cliente desconectado manualmente')
  if (socket) {
    try { socket.close() } catch { /* ignore */ }
    socket = null
  }
  notifyStatus(false)
}

/**
 * Suscribe a cambios de lista de impresoras.
 * @param {(printers: any[], agentInfo: any)=>void} callback
 * @returns {()=>void} unsubscribe
 */
export function onPrinterListChanged(callback) {
  if (typeof callback !== 'function') return () => {}
  printerListeners.add(callback)
  // Emitir inmediatamente el último valor si existe
  if (lastPrinters.length) {
    try { callback(lastPrinters.slice(), lastAgentInfo) } catch { /* ignore */ }
  }
  return () => printerListeners.delete(callback)
}

export function offPrinterListChanged(callback) {
  printerListeners.delete(callback)
}

export function onStatusChange(callback) {
  if (typeof callback !== 'function') return () => {}
  statusListeners.add(callback)
  // Emitir estado actual
  try { callback(isAgentConnected()) } catch { /* ignore */ }
  return () => statusListeners.delete(callback)
}

export function offStatus(callback) {
  statusListeners.delete(callback)
}

function requestWithTimeout(payload, timeoutMs = 8000) {
  if (!isAgentConnected()) return Promise.reject(new Error('Agente no conectado'))
  const requestId = genId()
  const withId = { ...payload, requestId }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Timeout esperando respuesta del agente'))
    }, timeoutMs)
    pendingRequests.set(requestId, { resolve, reject, timer })
    try {
      sendJson(withId)
    } catch (err) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      reject(err)
    }
  })
}

// ── API de alto nivel ───────────────────────────────────────────────

/**
 * Lista impresoras vía agente. Si no hay agente, rechaza para que el caller haga fallback a WebUSB/WebSerial.
 */
export async function listPrintersViaAgent(options = {}) {
  const res = await requestWithTimeout({ type: 'list', ...options }, options.timeout || 6000)
  if (Array.isArray(res.printers)) {
    notifyPrinters(res.printers, res.agentInfo || res.info || null)
    return res.printers
  }
  if (Array.isArray(res.data)) return res.data
  return lastPrinters
}

export async function listThermalPrintersViaAgent() {
  return listPrintersViaAgent({ kind: 'thermal' })
}

export async function listNormalPrintersViaAgent() {
  return listPrintersViaAgent({ kind: 'normal' })
}

/**
 * Imprime bytes crudos (ESC/POS, ZPL, etc.) vía agente.
 * @param {object} opts
 * @param {Uint8Array|ArrayBuffer|Blob|string} opts.bytes - datos a imprimir
 * @param {string} opts.protocol - escpos|zpl|epl|tspl|cpcl
 * @param {object} opts.target - { vendorId, productName, ip, port, printerName, portName, type }
 * @param {string} opts.kind - 'thermal' por defecto
 */
export async function printViaAgent({ bytes, protocol = 'escpos', target = {}, kind = 'thermal', extra = {} } = {}) {
  if (!bytes) throw new Error('No hay datos para imprimir')

  let base64
  let byteLength

  if (bytes instanceof Uint8Array) {
    byteLength = bytes.length
    base64 = uint8ToBase64(bytes)
  } else if (bytes instanceof ArrayBuffer) {
    const u8 = new Uint8Array(bytes)
    byteLength = u8.length
    base64 = uint8ToBase64(u8)
  } else if (typeof Blob !== 'undefined' && bytes instanceof Blob) {
    const buf = await bytes.arrayBuffer()
    const u8 = new Uint8Array(buf)
    byteLength = u8.length
    base64 = uint8ToBase64(u8)
  } else if (typeof bytes === 'string') {
    const enc = new TextEncoder().encode(bytes)
    byteLength = enc.length
    base64 = uint8ToBase64(enc)
  } else {
    throw new Error('Formato de bytes no soportado')
  }

  const payload = {
    type: 'print',
    kind,
    protocol,
    bytesBase64: base64,
    byteLength,
    target,
    ...extra,
  }
  const res = await requestWithTimeout(payload, 15000)
  if (res.ok === false) throw new Error(res.error || 'El agente reportó error al imprimir')
  return res
}

/**
 * Imprime PDF en impresora normal vía agente (spooler del SO sin diálogo).
 * @param {object} opts
 * @param {string|Blob|Uint8Array|ArrayBuffer} opts.pdf - jsPDF blob/base64/arrayBuffer o string base64
 * @param {string} opts.printerName - nombre exacto de la impresora del SO
 * @param {number} opts.copies
 * @param {string} opts.paperSize - Letter|A4
 * @param {string} opts.orientation - portrait|landscape
 */
export async function printPdfViaAgent({ pdf, printerName, copies = 1, paperSize = 'Letter', orientation = 'portrait' } = {}) {
  if (!printerName) throw new Error('Se requiere el nombre de la impresora')

  let pdfBase64
  if (typeof pdf === 'string') {
    // Asumir ya es base64 o data URI
    if (pdf.startsWith('data:')) {
      const comma = pdf.indexOf(',')
      pdfBase64 = comma >= 0 ? pdf.slice(comma + 1) : pdf
    } else {
      pdfBase64 = pdf
    }
  } else if (pdf instanceof Uint8Array) {
    pdfBase64 = uint8ToBase64(pdf)
  } else if (pdf instanceof ArrayBuffer) {
    pdfBase64 = uint8ToBase64(new Uint8Array(pdf))
  } else if (typeof Blob !== 'undefined' && pdf instanceof Blob) {
    const buf = await pdf.arrayBuffer()
    pdfBase64 = uint8ToBase64(new Uint8Array(buf))
  } else if (pdf && typeof pdf.output === 'function') {
    // jsPDF instance
    const blob = pdf.output('blob')
    const buf = await blob.arrayBuffer()
    pdfBase64 = uint8ToBase64(new Uint8Array(buf))
  } else {
    throw new Error('Formato PDF no soportado')
  }

  const payload = {
    type: 'printNormal',
    kind: 'normal',
    printerName,
    pdfBase64,
    copies: Math.max(1, Number(copies) || 1),
    paperSize,
    orientation,
  }
  const res = await requestWithTimeout(payload, 20000)
  if (res.ok === false) throw new Error(res.error || 'El agente reportó error al imprimir PDF')
  return res
}

// ── Auto-connect helper ─────────────────────────────────────────────
let autoConnectStarted = false
let autoConnectCount = 0
let visibilityHandler = null
/**
 * Inicia conexión persistente al agente (intenta reconectar solo). Llamar al montar la pantalla de configuración.
 * Devuelve función para detener. Soporta múltiples callers (contador).
 */
export function ensureAgentConnection(url = DEFAULT_URL) {
  desiredUrl = url || DEFAULT_URL
  autoConnectCount += 1
  if (!autoConnectStarted) {
    autoConnectStarted = true
    manuallyClosed = false
    connect(desiredUrl).catch(() => { /* reconexión automática via scheduleReconnect */ })
    visibilityHandler = () => {
      if (document.visibilityState === 'visible' && !isAgentConnected()) {
        connect(desiredUrl).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }
  return () => {
    autoConnectCount = Math.max(0, autoConnectCount - 1)
    if (autoConnectCount === 0 && autoConnectStarted) {
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler)
        visibilityHandler = null
      }
      autoConnectStarted = false
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
function uint8ToBase64(u8) {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, Math.min(i + chunkSize, u8.length))
    let part = ''
    for (let j = 0; j < chunk.length; j++) part += String.fromCharCode(chunk[j])
    binary += part
  }
  return btoa(binary)
}

export function base64ToUint8(b64) {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Estado para UI textual honesto
export function getAgentStatusMessage() {
  if (isAgentConnected()) return 'Agente local conectado — impresión silenciosa disponible.'
  return 'Agente local no conectado — se usará WebUSB/BLE/Serial como respaldo y, para impresión normal, se abrirá el diálogo del sistema.'
}

export function getAgentDownloadInfo() {
  return {
    path: 'agent/README.md',
    label: 'Descargar agente de impresión local',
    message: 'Para impresión silenciosa sin diálogos (USB con driver, Bluetooth clásico y Red 9100), instale y ejecute el agente local. Sin él, la impresión depende de las APIs del navegador.',
  }
}

// Para compatibilidad: exponer objeto por defecto
const printAgentClient = {
  connect,
  disconnect,
  isConnected: isAgentConnected,
  isAgentConnected,
  getAgentUrl,
  getLastPrinters,
  onPrinterListChanged,
  offPrinterListChanged,
  onStatusChange,
  offStatus,
  listPrintersViaAgent,
  listThermalPrintersViaAgent,
  listNormalPrintersViaAgent,
  printViaAgent,
  printPdfViaAgent,
  ensureAgentConnection,
  getAgentStatusMessage,
  getAgentDownloadInfo,
}

export default printAgentClient
