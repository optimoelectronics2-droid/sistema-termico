#!/usr/bin/env node
/**
 * Trifusión Print Agent — servidor WebSocket local para impresión real.
 *
 * Expone ws://localhost:9847
 * - Detecta impresoras reales del SO (USB con driver, Serial/COM, Bluetooth SPP via puerto COM/tty virtual, Red 9100, spooler normal).
 * - Emite eventos en tiempo real cada 2.5s (polling) cuando aparece/desaparece una impresora.
 * - Responde a comandos { type: 'print' | 'printNormal' | 'list', ... }.
 *
 * Diseño resistente: todos los módulos nativos (usb, serialport, pdf-to-printer) son OPCIONALES.
 * Si no están instalados, el agente sigue funcionando con lo disponible (net + OS spooler via lp/lpr/powershell).
 */

const http = require('http')
const net = require('net')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { exec, execFile } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// ── Config ──────────────────────────────────────────────────────────
const DEFAULT_PORT = Number(process.env.PRINT_AGENT_PORT || process.env.PORT || 9847)
const POLL_MS = 2500
const TEMP_DIR = path.join(os.tmpdir(), 'trifusion-print-agent')

try { fs.mkdirSync(TEMP_DIR, { recursive: true }) } catch { /* ignore */ }

// ── Cargar ws ───────────────────────────────────────────────────────
let WebSocketServer
try {
  WebSocketServer = require('ws').WebSocketServer
} catch (e) {
  console.error('[agent] Falta dependencia "ws". Ejecuta: npm install')
  process.exit(1)
}

// ── Helpers de impresoras del SO ────────────────────────────────────
const THERMAL_KEYWORDS = [
  'epson tm', 'tm-t20', 'tm-t88', 'tm-m30', 'star', 'bixolon', 'xprinter', 'xp-',
  'zebra', 'citizen', 'rongta', 'gainscha', 'pos-', 'pos80', 'pos58', 'pos 80', 'pos 58',
  '80mm', '58mm', 'thermal', 'receipt', 'ticket', 'pos', 'etiqueta', 'label',
  'agiler', 'agi-pr', 'agi', 'pr2000', 'pr 2000'
]
const THERMAL_VENDOR_HINTS = new Set(['0x04b8', '0x0519', '0x154f', '0x28e9', '0x0a5f', '0x1e17', '0x067b', '0x0416'])

function detectKindFromName(name = '', driver = '', port = '') {
  const n = `${name} ${driver}`.toLowerCase()
  const p = String(port || '').toLowerCase()
  // Puerto 9100 raw o archivo .prn con nombre térmico es térmico aunque el nombre no contenga keyword
  if (p.includes('9100') || p.includes(':9100') || p.includes('_9100')) return 'thermal'
  // Archivo prn/txt con nombre que contenga pos/thermal -> térmico
  if ((p.endsWith('.prn') || p.endsWith('.txt') || p.includes('thermal')) && (n.includes('pos') || n.includes('thermal') || n.includes('80mm') || n.includes('58mm'))) return 'thermal'
  for (const kw of THERMAL_KEYWORDS) if (n.includes(kw)) return 'thermal'
  return 'normal'
}

function sanitizeBase64ForFile(b64) {
  // b64 puede venir con data: prefix; lo limpiamos antes de escribir
  const comma = b64.indexOf(',')
  const clean = comma >= 0 ? b64.slice(comma + 1) : b64
  return clean.replace(/[^A-Za-z0-9+/=]/g, '')
}

function getTempPath(ext = 'pdf') {
  const id = crypto.randomBytes(6).toString('hex')
  return path.join(TEMP_DIR, `job-${Date.now()}-${id}.${ext}`)
}

// ── Enumeración de impresoras del sistema ───────────────────────────
async function getWindowsPrinters() {
  // Intento 1: PowerShell Get-Printer (más fiable, incluye PortName para detectar 9100 y archivos .prn)
  try {
    const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Printer | Select-Object Name,DriverName,PortName,Shared,PrinterStatus | ConvertTo-Json -Depth 2"', { timeout: 6000, windowsHide: true })
    const raw = stdout.trim()
    if (raw) {
      const parsed = JSON.parse(raw)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      const list = arr.filter(Boolean).map((p) => ({
        name: p.Name || 'Impresora',
        displayName: p.Name || 'Impresora',
        printerName: p.Name || 'Impresora',
        driverName: p.DriverName || '',
        portName: p.PortName || '',
        status: p.PrinterStatus || 'unknown',
        kind: detectKindFromName(p.Name || '', p.DriverName || '', p.PortName || ''),
        connection: detectKindFromName(p.Name || '', '', p.PortName || '') === 'thermal' ? 'usb' : 'spooler',
        source: 'os',
      }))
      if (list.length) return list
    }
  } catch { /* powershell falló */ }

  // Intento 2: pdf-to-printer si está instalado (fallback sin PortName)
  try {
    const ptp = require('pdf-to-printer')
    if (ptp && typeof ptp.getPrinters === 'function') {
      const list = await ptp.getPrinters()
      // pdf-to-printer devuelve [{ deviceId, name, ... }]
      return list.map((p) => ({
        name: p.name || p.deviceId || p.printer || 'Impresora',
        displayName: p.name || p.deviceId || 'Impresora',
        printerName: p.name || p.deviceId || 'Impresora',
        deviceId: p.deviceId || p.name,
        driverName: p.driverName || '',
        portName: p.portName || p.PortName || '',
        isDefault: !!p.isDefault,
        status: p.status || 'unknown',
        kind: detectKindFromName(p.name || '', p.driverName || '', p.portName || ''),
        connection: detectKindFromName(p.name || '', '', p.portName || '') === 'thermal' ? 'usb' : 'spooler',
        source: 'os',
      }))
    }
  } catch { /* pdf-to-printer no instalado o falló */ }

  // Intento 3: wmic (legacy)
  try {
    const { stdout } = await execAsync('wmic printer get name,DriverName,PortName /format:csv', { timeout: 6000, windowsHide: true })
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    // CSV: Node,DriverName,Name,PortName
    const printers = []
    for (const line of lines) {
      if (line.startsWith('Node,') || line.startsWith('Node')) continue
      const parts = line.split(',')
      if (parts.length < 4) continue
      const driver = parts[1] || ''
      const name = parts[2] || ''
      const port = parts[3] || ''
      if (!name) continue
      printers.push({
        name, displayName: name, printerName: name, driverName: driver, portName: port,
        kind: detectKindFromName(name, driver, port), connection: detectKindFromName(name, '', port) === 'thermal' ? 'usb' : 'spooler', source: 'os',
      })
    }
    if (printers.length) return printers
  } catch { /* wmic falló */ }

  return []
}

async function getUnixPrinters() {
  // Intento 1: pdf-to-printer
  try {
    const ptp = require('pdf-to-printer')
    if (ptp && typeof ptp.getPrinters === 'function') {
      const list = await ptp.getPrinters()
      return list.map((p) => ({
        name: p.name || p.deviceId || 'Impresora',
        displayName: p.name || p.deviceId || 'Impresora',
        printerName: p.name || p.deviceId || 'Impresora',
        driverName: '',
        portName: '',
        kind: detectKindFromName(p.name || '', ''),
        connection: detectKindFromName(p.name || '', '') === 'thermal' ? 'usb' : 'spooler',
        source: 'os',
      }))
    }
  } catch { /* ignore */ }

  // Intento 2: lpstat (macOS / Linux CUPS)
  try {
    const { stdout: eOut } = await execAsync('lpstat -e 2>/dev/null || lpstat -p 2>/dev/null', { timeout: 4000 })
    const names = new Set()
    for (const line of eOut.split('\n')) {
      const m = line.match(/^(?:printer\s+)?([A-Za-z0-9_\-]+)(?:\s+is|\s+idle|\s+enabled)?/i)
      if (m && m[1] && m[1] !== 'printer') names.add(m[1].trim())
      // lpstat -e lista nombres puros por línea
      const clean = line.trim()
      if (clean && !clean.includes(' ') && !clean.includes(':') && /^[A-Za-z0-9_\-]+$/.test(clean)) names.add(clean)
    }
    // Destinations default
    let defaultName = ''
    try {
      const { stdout: dOut } = await execAsync('lpstat -d 2>/dev/null', { timeout: 3000 })
      const m = dOut.match(/system default destination:\s*([A-Za-z0-9_\-]+)/i)
      if (m) defaultName = m[1]
    } catch { /* ignore */ }

    const printers = []
    for (const name of names) {
      if (!name) continue
      printers.push({
        name, displayName: name, printerName: name, driverName: '', portName: '',
        isDefault: name === defaultName,
        kind: detectKindFromName(name, ''),
        connection: detectKindFromName(name, '') === 'thermal' ? 'usb' : 'spooler',
        source: 'os',
      })
    }
    if (printers.length) return printers
  } catch { /* lpstat no disponible */ }

  return []
}

async function getSystemPrinters() {
  if (process.platform === 'win32') return getWindowsPrinters()
  return getUnixPrinters()
}

async function getSerialPorts() {
  try {
    const { SerialPort } = require('serialport')
    const ports = await SerialPort.list()
    return ports.map((p) => ({
      name: p.path || p.friendlyName || 'Puerto serial',
      displayName: `${p.path || 'COM?'}${p.manufacturer ? ` — ${p.manufacturer}` : ''}`,
      printerName: p.path,
      portName: p.path,
      path: p.path,
      manufacturer: p.manufacturer || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      kind: 'thermal', // la mayoría de serial térmicas
      connection: 'serial',
      source: 'serial',
    }))
  } catch {
    return []
  }
}

async function getUsbDevices() {
  try {
    const usb = require('usb')
    const devices = usb.getDeviceList() || []
    return devices.map((d) => {
      const desc = d.deviceDescriptor || {}
      const vid = desc.idVendor
      const pid = desc.idProduct
      const vidHex = `0x${Number(vid || 0).toString(16).padStart(4, '0')}`
      const isThermalVendor = THERMAL_VENDOR_HINTS.has(vidHex.toLowerCase())
      return {
        name: `USB ${vidHex}:${Number(pid || 0).toString(16).padStart(4, '0')}`,
        displayName: `USB ${vidHex} — ${isThermalVendor ? 'Térmica' : 'Dispositivo'}`,
        vendorId: vid,
        productId: pid,
        vendorIdHex: vidHex,
        kind: isThermalVendor ? 'thermal' : 'normal',
        connection: 'usb',
        source: 'usb',
      }
    })
  } catch {
    return []
  }
}

// ── Lista unificada ─────────────────────────────────────────────────
let lastPrintersCache = []
let lastPrintersJson = ''

function normalizePrinterKey(name = '') {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+usb$/i, '')
    .replace(/\s*\(usb\)\s*$/i, '')
    .replace(/\s*-\s*usb\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function portScore(port = '') {
  const p = String(port || '').toLowerCase()
  if (p.includes('usb')) return 3
  if (p.includes('9100') || p.includes('_9100') || p.includes(':9100')) return 3
  if (p.startsWith('com') || p.startsWith('serial')) return 2
  if (p.includes('spool') && p.endsWith('.prn')) return 1
  if (p.includes('wsd')) return 0
  if (p.includes('portprompt') || p.includes('nul:') || p.includes('shrfax') || p.includes('ad_port')) return -1
  if (!p) return -2
  return 0
}

async function getAllPrinters() {
  const [sys, serial, usb] = await Promise.all([
    getSystemPrinters().catch(() => []),
    getSerialPorts().catch(() => []),
    getUsbDevices().catch(() => []),
  ])

  // Deduplicar impresoras del sistema por nombre normalizado (ej: "Trifusion POS-80" y "Trifusion POS-80 USB" son la misma)
  const dedupMap = new Map() // key normalized -> printer
  for (const p of sys) {
    const key = normalizePrinterKey(p.printerName || p.name)
    const existing = dedupMap.get(key)
    if (!existing) {
      dedupMap.set(key, { ...p, id: `os:${p.printerName || p.name}`, _dedupKey: key })
    } else {
      // Quedarse con la que tiene mejor puerto (USB/9100 > spool file > WSD/portprompt)
      const scoreNew = portScore(p.portName)
      const scoreOld = portScore(existing.portName)
      if (scoreNew > scoreOld) {
        dedupMap.set(key, { ...p, id: `os:${p.printerName || p.name}`, _dedupKey: key })
      } else if (scoreNew === scoreOld) {
        // Si empate, preferir la que tiene nombre más corto (sin " USB") como canonical pero conservar port del ganador
        // No reemplazar
      }
    }
  }
  const dedupedSys = Array.from(dedupMap.values())

  // Combinar: priorizar spooler deduplicado, luego serial, luego usb genérico que no esté ya representado
  const map = new Map()

  for (const p of dedupedSys) {
    const key = `os:${p.printerName || p.name}`
    map.set(key, { ...p, id: key })
  }
  for (const p of serial) {
    const key = `serial:${p.path}`
    if (!map.has(key)) map.set(key, { ...p, id: key })
  }
  for (const p of usb) {
    const key = `usb:${p.vendorId}:${p.productId}`
    // No duplicar si ya hay una impresora del SO con mismo VID (aprox) — pero solo si el SO ya tiene una térmica con ese VID
    // Para evitar falsos duplicados, solo omitir si hay alguna impresora del SO con kind thermal y nombre que sugiere mismo vendor
    if (!map.has(key)) map.set(key, { ...p, id: key })
  }

  const printers = Array.from(map.values())

  // Orden: térmicas primero, luego normales, luego alfabético
  printers.sort((a, b) => {
    const ka = a.kind === 'thermal' ? 0 : 1
    const kb = b.kind === 'thermal' ? 0 : 1
    if (ka !== kb) return ka - kb
    return String(a.displayName || a.name).localeCompare(String(b.displayName || b.name))
  })

  return printers
}

// ── Impresión ───────────────────────────────────────────────────────
async function printRawToNetwork({ host, port = 9100, bytes }) {
  const targetPort = Number(port) || 9100
  const targetHost = String(host || '').trim()
  if (!targetHost) throw new Error('Falta IP/host de la impresora de red')
  if (!bytes || !bytes.length) throw new Error('Sin datos para enviar a la impresora de red')

  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        try { socket.destroy() } catch { /* ignore */ }
        reject(new Error(`Timeout conectando a ${targetHost}:${targetPort} (¿puerto 9100 abierto y en la misma red?)`))
      }
    }, 8000)

    socket.setTimeout(8000)
    socket.once('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`Error de red a ${targetHost}:${targetPort}: ${err.message}`))
    })
    socket.once('timeout', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* ignore */ }
      reject(new Error(`Timeout enviando a ${targetHost}:${targetPort}`))
    })
    socket.connect(targetPort, targetHost, () => {
      socket.write(bytes, (err) => {
        if (err) {
          if (done) return
          done = true
          clearTimeout(timer)
          reject(err)
          try { socket.end() } catch { /* ignore */ }
          return
        }
        // Algunas impresoras no responden; cerrar tras breve espera
        setTimeout(() => {
          if (done) return
          done = true
          clearTimeout(timer)
          try { socket.end() } catch { /* ignore */ }
          resolve({ ok: true, via: 'network', device: `${targetHost}:${targetPort}` })
        }, 300)
      })
    })
  })
}

async function printToSerial({ portName, bytes, baudRate = 9600 }) {
  if (!portName) throw new Error('Falta puerto COM/serial')
  if (!bytes || !bytes.length) throw new Error('Sin datos para puerto serial')

  let SerialPort
  try {
    SerialPort = require('serialport').SerialPort
  } catch {
    throw new Error('Módulo "serialport" no instalado en el agente. Ejecuta: npm install serialport')
  }

  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portName, baudRate: Number(baudRate) || 9600, autoOpen: false })
    port.open((err) => {
      if (err) return reject(new Error(`No se pudo abrir ${portName}: ${err.message}. Verifique que no esté en uso y que el driver esté instalado. Para Bluetooth clásico, empareje primero en Windows/macOS y use el puerto COM/tty virtual que crea el sistema.`))
      port.write(bytes, (wErr) => {
        if (wErr) {
          try { port.close(() => {}) } catch { /* ignore */ }
          return reject(new Error(`Error escribiendo a ${portName}: ${wErr.message}`))
        }
        port.drain((dErr) => {
          if (dErr) {
            try { port.close(() => {}) } catch { /* ignore */ }
            return reject(new Error(`Error drenando ${portName}: ${dErr.message}`))
          }
          setTimeout(() => {
            port.close((cErr) => {
              if (cErr) return reject(new Error(`Error cerrando ${portName}: ${cErr.message}`))
              resolve({ ok: true, via: 'serial', device: portName })
            })
          }, 300)
        })
      })
    })
    // Timeout global 10s
    setTimeout(() => {
      try { if (port.isOpen) port.close(() => {}) } catch { /* ignore */ }
      reject(new Error(`Timeout escribiendo a ${portName}`))
    }, 10000)
  })
}

async function printRawToSpooler({ printerName, bytes }) {
  // Para impresoras térmicas USB que usan driver del SO (evita claimInterface).
  // Caso virtual con PortName = archivo (C:\...\thermal.prn): escribir directo al archivo para demo/validación.
  if (!printerName) throw new Error('Falta nombre de impresora del sistema')
  if (!bytes || !bytes.length) throw new Error('Sin datos para spooler')

  // Detectar impresora virtual con puerto archivo
  try {
    const cached = lastPrintersCache.find((p) => (p.printerName || p.name) === printerName)
    const port = String(cached?.portName || '').trim()
    console.log(`[agent] lookup printer=${printerName} cached=${!!cached} port=${JSON.stringify(port)} cacheSize=${lastPrintersCache.length}`)
    const isFilePort = port && (port.match(/^[A-Z]:\\/i) || port.includes('\\')) && (port.toLowerCase().endsWith('.prn') || port.toLowerCase().endsWith('.txt') || port.includes('spool'))
    if (isFilePort) {
      try {
        // Asegurar directorio existe
        const dir = path.dirname(port)
        try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
        // Append para no perder datos previos en pruebas virtuales
        fs.appendFileSync(port, bytes)
        console.log(`[agent] RAW escrito directo a archivo puerto ${port} (${bytes.length} bytes) para ${printerName}`)
        return { ok: true, via: 'spooler-file', device: printerName, file: port }
      } catch (e) {
        console.warn(`[agent] Falló escritura directa a ${port}: ${e.message}, intentando spooler normal`)
      }
    }
  } catch { /* ignore lookup */ }

  const tmp = getTempPath('prn')
  fs.writeFileSync(tmp, bytes)

  try {
    if (process.platform === 'win32') {
      // Intento con pdf-to-printer en modo raw si existe, si no usar print / copy
      try {
        const ptp = require('pdf-to-printer')
        // pdf-to-printer no tiene raw directo; usamos comando de Windows para raw
        // Alternativa: usar `print` command o PowerShell
      } catch { /* ignore */ }

      // Método 1: PowerShell Out-Printer con -Name (para raw, usar .NET RawPrinterHelper no es trivial;
      // alternativa simple: `print /D:"\\.\printerName" file` o `copy /B file "\\localhost\printerName"`)
      // Intentamos `print` primero
      try {
        await execAsync(`print /D:"${printerName}" "${tmp}"`, { timeout: 8000, windowsHide: true })
        return { ok: true, via: 'spooler', device: printerName }
      } catch { /* probar siguiente */ }

      // Método 2: rundll32 printui con archivo
      // Método 3: usar `copy` a puerto de impresora si es.FILE? No fiable.
      // Fallback: intentar con pdf-to-printer si era PDF (no aplica a raw escpos) -> para raw, informar que se usó spooler genérico
      // Último recurso: informar error claro
      throw new Error(`No se pudo enviar datos RAW a "${printerName}" vía spooler de Windows. Verifique que la impresora esté instalada y compartida, o use la opción Red 9100 si su impresora es de red. Para USB con driver, asegúrese de que el driver esté en modo RAW/Generic.`)
    } else {
      // macOS / Linux: lp -d printerName -o raw
      try {
        await execFileAsync('lp', ['-d', printerName, '-o', 'raw', tmp], { timeout: 8000 })
        return { ok: true, via: 'spooler', device: printerName }
      } catch (e) {
        // Intentar sin -o raw
        try {
          await execFileAsync('lp', ['-d', printerName, tmp], { timeout: 8000 })
          return { ok: true, via: 'spooler', device: printerName }
        } catch (e2) {
          throw new Error(`lp falló para "${printerName}": ${e2.message}. Verifique que CUPS esté activo y la impresora exista (lpstat -p).`)
        }
      }
    }
  } finally {
    setTimeout(() => { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }, 2500)
  }
}

async function printPdfToSpooler({ printerName, pdfBase64, copies = 1, paperSize, orientation }) {
  if (!printerName) throw new Error('Falta nombre de impresora')
  if (!pdfBase64) throw new Error('Falta PDF base64')

  const clean = sanitizeBase64ForFile(pdfBase64)
  const buf = Buffer.from(clean, 'base64')
  if (!buf.length) throw new Error('PDF vacío o base64 inválido')

  const tmp = getTempPath('pdf')
  fs.writeFileSync(tmp, buf)

  const nCopies = Math.max(1, Number(copies) || 1)

  try {
    if (process.platform === 'win32') {
      // Intentar pdf-to-printer (usa SumatraPDF internamente, silencioso)
      try {
        const ptp = require('pdf-to-printer')
        if (ptp && typeof ptp.print === 'function') {
          await ptp.print(tmp, { printer: printerName, copies: nCopies })
          return { ok: true, via: 'spooler', device: printerName, copies: nCopies }
        }
      } catch (e) {
        // Si pdf-to-printer no está, intentar con PowerShell Start-Process -Verb Print
        if (!String(e.message || '').includes('pdf-to-printer')) {
          // continuar a fallback
        } else {
          throw new Error(`pdf-to-printer no instalado o falló: ${e.message}. Instálalo en el agente con: npm install pdf-to-printer`)
        }
      }
      // Fallback Windows sin pdf-to-printer: intentar con Sumatra si existe, si no error claro
      throw new Error(`Impresión PDF silenciosa en Windows requiere "pdf-to-printer" en el agente. Ejecuta en carpeta agent/: npm install pdf-to-printer  — luego reinicia el agente. Sin él no hay forma silenciosa desde el navegador (limitación de seguridad).`)
    } else {
      // macOS / Linux: lp -d printerName -n copies file.pdf
      const args = ['-d', printerName, '-n', String(nCopies)]
      // paperSize/orientation: intentar mapear a opciones CUPS (opcional)
      // No forzamos; CUPS suele inferir del PDF (Letter/A4 ya está en el PDF). Si se especifica, añadir -o media
      if (paperSize && /^(letter|a4)$/i.test(paperSize)) {
        args.push('-o', `media=${paperSize.toLowerCase()}`)
      }
      if (orientation && /^(portrait|landscape)$/i.test(orientation)) {
        if (orientation.toLowerCase() === 'landscape') args.push('-o', 'landscape')
      }
      args.push(tmp)
      try {
        await execFileAsync('lp', args, { timeout: 15000 })
        return { ok: true, via: 'spooler', device: printerName, copies: nCopies }
      } catch (e) {
        throw new Error(`lp falló para "${printerName}": ${e.message}. Verifique CUPS (lpstat -p) y que la impresora exista.`)
      }
    }
  } finally {
    setTimeout(() => { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }, 4000)
  }
}

// ── WebSocket server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ ok: true, service: 'trifusion-print-agent', version: '1.0.0', port: actualPort, platform: process.platform, printers: lastPrintersCache.length }))
    return
  }
  res.writeHead(404); res.end('Not found')
})

const wss = new WebSocketServer({ server })

let actualPort = DEFAULT_PORT

function broadcast(obj) {
  const data = JSON.stringify(obj)
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      try { client.send(data) } catch { /* ignore */ }
    }
  }
}

async function refreshAndBroadcastIfChanged() {
  try {
    const printers = await getAllPrinters()
    const json = JSON.stringify(printers)
    if (json !== lastPrintersJson) {
      lastPrintersJson = json
      lastPrintersCache = printers
      broadcast({ type: 'printers', printers, agentInfo: { platform: process.platform, ts: Date.now() } })
    }
  } catch (e) {
    console.error('[agent] refresh error:', e.message)
  }
}

wss.on('connection', async (ws) => {
  console.log('[agent] cliente conectado')
  // Enviar lista actual al conectar
  try {
    const printers = lastPrintersCache.length ? lastPrintersCache : await getAllPrinters()
    if (!lastPrintersCache.length) {
      lastPrintersCache = printers
      lastPrintersJson = JSON.stringify(printers)
    }
    ws.send(JSON.stringify({ type: 'printers', printers, agentInfo: { platform: process.platform, ts: Date.now() } }))
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', error: e.message }))
  }

  ws.on('message', async (raw) => {
    let msg = null
    try { msg = JSON.parse(String(raw)) } catch { ws.send(JSON.stringify({ ok: false, error: 'JSON inválido' })); return }
    const requestId = msg.requestId || null
    const reply = (obj) => {
      const out = requestId ? { ...obj, requestId } : obj
      try { ws.send(JSON.stringify(out)) } catch { /* ignore */ }
    }

    try {
      if (msg.type === 'ping') {
        reply({ ok: true, type: 'pong', ts: Date.now() })
        return
      }

      if (msg.type === 'list') {
        const kind = String(msg.kind || 'all').toLowerCase()
        const all = lastPrintersCache.length ? lastPrintersCache : await getAllPrinters()
        let filtered = all
        if (kind === 'thermal') filtered = all.filter((p) => p.kind === 'thermal')
        else if (kind === 'normal') filtered = all.filter((p) => p.kind === 'normal')
        reply({ ok: true, printers: filtered, agentInfo: { platform: process.platform } })
        return
      }

      if (msg.type === 'print') {
        // Thermal raw: bytesBase64 + protocol + target
        const bytesBase64 = msg.bytesBase64 || msg.data || msg.base64 || ''
        const protocol = msg.protocol || 'escpos'
        const target = msg.target || {}
        if (!bytesBase64) { reply({ ok: false, error: 'Falta bytesBase64' }); return }

        const clean = sanitizeBase64ForFile(bytesBase64)
        const bytes = Buffer.from(clean, 'base64')
        if (!bytes.length) { reply({ ok: false, error: 'Bytes vacíos tras decodificar base64' }); return }

        // Decidir ruta según target
        const tType = String(target.type || target.connection || msg.connection || '').toLowerCase()
        const host = target.host || target.ip || target.networkHost
        const port = target.port || target.networkPort || 9100
        const printerName = target.printerName || target.name || target.displayName
        const portName = target.portName || target.path || target.comPort || target.serialPort
        const baudRate = target.baudRate || 9600

        // Prioridad: si hay host -> red 9100; si hay portName/COM -> serial; si hay printerName -> spooler raw; si no, intentar spooler con primer thermal
        if (host) {
          const res = await printRawToNetwork({ host, port, bytes })
          reply({ ok: true, via: 'network', device: res.device, protocol })
          return
        }
        if (portName || tType === 'serial' || (target.type === 'serial')) {
          const res = await printToSerial({ portName: portName || printerName, bytes, baudRate })
          reply({ ok: true, via: 'serial', device: res.device, protocol })
          return
        }
        if (printerName) {
          // Intentar spooler raw (útil para USB con driver que acepta RAW)
          try {
            const res = await printRawToSpooler({ printerName, bytes })
            reply({ ok: true, via: 'spooler', device: res.device, protocol })
            return
          } catch (e) {
            // Si spooler raw falla y hay alternativa de red, no intentar red sin host; informar error claro
            reply({ ok: false, error: e.message })
            return
          }
        }
        // Sin target específico: si hay una impresora thermal por defecto, usarla
        const fallbackThermal = lastPrintersCache.find((p) => p.kind === 'thermal')
        if (fallbackThermal && fallbackThermal.printerName) {
          try {
            const res = await printRawToSpooler({ printerName: fallbackThermal.printerName, bytes })
            reply({ ok: true, via: 'spooler', device: res.device, protocol, note: 'Usada impresora térmica por defecto del sistema' })
            return
          } catch (e) {
            reply({ ok: false, error: `Sin destino específico y spooler por defecto falló: ${e.message}. Especifique IP:9100 para red, puerto COM para serial, o nombre de impresora del sistema.` })
            return
          }
        }
        reply({ ok: false, error: 'Falta destino: especifique { host, port } para Red 9100, { portName } para Serial/COM, o { printerName } para USB vía spooler.' })
        return
      }

      if (msg.type === 'printNormal' || msg.type === 'printPdf') {
        const pdfBase64 = msg.pdfBase64 || msg.pdf || msg.data || ''
        const printerName = msg.printerName || msg.printer || (msg.target && msg.target.printerName)
        const copies = msg.copies || 1
        const paperSize = msg.paperSize || 'Letter'
        const orientation = msg.orientation || 'portrait'
        if (!pdfBase64) { reply({ ok: false, error: 'Falta pdfBase64' }); return }
        if (!printerName) { reply({ ok: false, error: 'Falta printerName' }); return }
        const res = await printPdfToSpooler({ printerName, pdfBase64, copies, paperSize, orientation })
        reply({ ok: true, via: 'spooler', device: res.device, copies: res.copies })
        return
      }

      reply({ ok: false, error: `Tipo no soportado: ${msg.type}` })
    } catch (e) {
      console.error('[agent] error handling message:', e)
      reply({ ok: false, error: e.message || String(e) })
    }
  })

  ws.on('close', () => console.log('[agent] cliente desconectado'))
  ws.on('error', (e) => console.error('[agent] ws error:', e.message))
})

// ── Inicio ──────────────────────────────────────────────────────────
function start(port = DEFAULT_PORT) {
  actualPort = Number(port) || DEFAULT_PORT
  server.listen(actualPort, '127.0.0.1', () => {
    console.log(`[agent] Trifusión Print Agent escuchando en ws://localhost:${actualPort}`)
    console.log(`[agent] Plataforma: ${process.platform} ${os.release()} — Node ${process.version}`)
    console.log(`[agent] Health: http://localhost:${actualPort}/health`)
    // Primer refresh inmediato y luego polling
    refreshAndBroadcastIfChanged().catch(() => {})
    setInterval(refreshAndBroadcastIfChanged, POLL_MS)
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[agent] Puerto ${actualPort} en uso. ¿Ya hay un agente corriendo?`)
      console.error(`[agent] Use otro puerto: PRINT_AGENT_PORT=9848 npm start`)
      process.exit(1)
    }
    console.error('[agent] server error:', err)
    process.exit(1)
  })
}

// Permitir --port o -p
const cliPort = (() => {
  const idx = process.argv.findIndex((a) => a === '--port' || a === '-p')
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1])
  return null
})()

start(cliPort || DEFAULT_PORT)

// Manejo de cierre limpio
process.on('SIGINT', () => { console.log('\n[agent] Cerrando...'); server.close(() => process.exit(0)) })
process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
