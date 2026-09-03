import { detectProtocolFromVendor, sendToSerialPort } from './barcodeLabelService'
import {
  buildInvoiceCpcl,
  buildInvoiceEpl,
  buildInvoiceEscpos,
  buildInvoiceEscposModern,
  buildInvoiceTspl,
  buildInvoiceZpl,
  buildTestCpcl,
  buildTestEpl,
  buildTestTspl,
  buildThermalTestEscpos,
  buildThermalTestEscposModern,
  buildThermalTestZpl,
  downloadThermalFile,
  THERMAL_PROTOCOLS,
} from '../lib/invoiceThermal'
import { buildReceiptPdf } from '../lib/receiptPdf'
import * as printAgentClient from './printAgentClient'

const PROFILE_KEY = 'erp.thermalPrinterProfile'
const FILE_EXTENSION = { escpos: 'prn', zpl: 'zpl', epl: 'epl', tspl: 'tspl', cpcl: 'cpl' }

const KNOWN_VENDOR_FILTERS = [
  { vendorId: 0x04B8 }, // Epson
  { vendorId: 0x0A5F }, // Zebra
  { vendorId: 0x0519 }, // Star Micronics
  { vendorId: 0x154F }, // Bixolon
  { vendorId: 0x1E17 }, // Citizen
  { vendorId: 0x067B }, // Genérica / chinas
  { vendorId: 0x28E9 }, // Xprinter / Rongta / Gainscha
  { vendorId: 0x0416 }, // Winbond (algunas genericas)
]

const PRINTER_DEVICE_FILTERS = [
  { classCode: 7 },
  ...KNOWN_VENDOR_FILTERS,
]

async function requestUsbDevice() {
  for (const filters of [PRINTER_DEVICE_FILTERS, []]) {
    try {
      return await navigator.usb.requestDevice({ filters })
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error
    }
  }
  return null
}

async function requestBluetoothDevice() {
  try {
    return await navigator.bluetooth.requestDevice({ filters: [{ services: [0xFFE0] }, { services: [0x1823] }], optionalServices: [0xFFE0, 0x1823] })
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error
  }
  return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0xFFE0, 0x1823] })
}

export async function listThermalDevices() {
  // ── Si el agente está conectado, priorizar impresoras reales del SO (USB con driver, Serial, BT COM virtual, Red)
  if (printAgentClient.isAgentConnected()) {
    try {
      const printers = await printAgentClient.listPrintersViaAgent()
      if (Array.isArray(printers) && printers.length) {
        // Mapear al formato esperado por la UI térmica existente
        return printers.map((p) => ({
          vendorId: Number(p.vendorId || p.vid || 0) || 0,
          productName: p.displayName || p.name || p.printerName || p.productName || 'Impresora',
          serialNumber: p.serialNumber || p.serial || '',
          protocol: p.protocol || detectProtocolFromVendor(Number(p.vendorId || 0)),
          // Extras para distinguir origen
          _raw: p,
          _source: p.source || 'agent',
          _kind: p.kind || (p.portName && String(p.portName).includes('9100') ? 'thermal' : 'normal'),
          printerName: p.printerName || p.name,
          portName: p.portName || '',
          connection: p.connection || (p.kind === 'thermal' ? 'usb' : 'spooler'),
        }))
      }
    } catch {
      // fallback a WebUSB
    }
  }

  if (!navigator.usb) return []
  try {
    const devices = await navigator.usb.getDevices()
    return devices.map((device) => ({
      vendorId: device.vendorId,
      productName: device.productName || 'Impresora USB',
      serialNumber: device.serialNumber || '',
      protocol: detectProtocolFromVendor(device.vendorId),
      _source: 'webusb',
    }))
  } catch {
    return []
  }
}

const DEFAULT_PROFILE = {
  protocol: 'escpos',
  connection: 'auto',
  paperWidth: '80',
  customWidthMm: 80,
  baudRate: 9600,
  networkHost: '',
  networkPort: 8001,
  printerName: '',
  printMode: 'auto', // auto | manual
  drawer: true,
  drawerPulse: 60,
  cut: 'full',
  logo: true,
  qrEnabled: true,
  barcode: true,
  bold: true,
  fontScale: 0,
  lineSpacing: 30,
  columns: '2',
  accentedText: false,
  ticketStyle: 'classic',
}

export function saveThermalProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...DEFAULT_PROFILE, ...profile }))
  } catch {
    /* almacenamiento no disponible */
  }
}

export function getThermalProfile() {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

export function clearThermalProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* almacenamiento no disponible */
  }
}

/* ---------------- detección en tiempo real (Parte 3) ---------------- */
// Listeners centralizados para USB/Serial + agente. No quita nada existente; solo agrega.

const thermalDeviceListeners = new Set()
let usbSerialListenersAttached = false
let agentUnsubscribe = null
let usbRefreshHandler = null
let serialRefreshHandler = null

function detachUsbSerialListenersIfNeeded() {
  if (thermalDeviceListeners.size !== 0) return
  if (!usbSerialListenersAttached) return
  try {
    if (usbRefreshHandler && typeof navigator !== 'undefined' && navigator.usb?.removeEventListener) {
      navigator.usb.removeEventListener('connect', usbRefreshHandler)
      navigator.usb.removeEventListener('disconnect', usbRefreshHandler)
    }
  } catch { /* ignore */ }
  try {
    if (serialRefreshHandler && typeof navigator !== 'undefined' && navigator.serial?.removeEventListener) {
      navigator.serial.removeEventListener('connect', serialRefreshHandler)
      navigator.serial.removeEventListener('disconnect', serialRefreshHandler)
    }
  } catch { /* ignore */ }
  if (agentUnsubscribe) {
    try { agentUnsubscribe() } catch { /* ignore */ }
    agentUnsubscribe = null
  }
  usbSerialListenersAttached = false
  usbRefreshHandler = null
  serialRefreshHandler = null
}

function emitThermalDevices(list) {
  for (const fn of thermalDeviceListeners) {
    try { fn(Array.isArray(list) ? list.slice() : []) } catch { /* ignore */ }
  }
}

function ensureUsbSerialListeners() {
  if (usbSerialListenersAttached) return
  usbSerialListenersAttached = true

  const refresh = async () => {
    try {
      const list = await listThermalDevices()
      emitThermalDevices(list)
    } catch { /* ignore */ }
  }
  usbRefreshHandler = refresh
  serialRefreshHandler = refresh

  try {
    if (typeof navigator !== 'undefined' && navigator.usb?.addEventListener) {
      navigator.usb.addEventListener('connect', refresh)
      navigator.usb.addEventListener('disconnect', refresh)
    }
  } catch { /* usb no disponible */ }

  try {
    if (typeof navigator !== 'undefined' && navigator.serial?.addEventListener) {
      navigator.serial.addEventListener('connect', refresh)
      navigator.serial.addEventListener('disconnect', refresh)
    }
  } catch { /* serial no disponible */ }

  // Suscribir al agente también (push cada 2.5s)
  try {
    if (printAgentClient.onPrinterListChanged) {
      agentUnsubscribe = printAgentClient.onPrinterListChanged((printers) => {
        // Convertir printers del agente al formato térmico para listeners legacy
        const mapped = Array.isArray(printers)
          ? printers.map((p) => ({
              vendorId: Number(p.vendorId || 0) || 0,
              productName: p.displayName || p.name || p.printerName || 'Impresora',
              serialNumber: p.serialNumber || '',
              protocol: p.protocol || detectProtocolFromVendor(Number(p.vendorId || 0)),
              _raw: p,
              _source: 'agent',
            }))
          : []
        emitThermalDevices(mapped)
      })
    }
  } catch { /* agent no disponible */ }
}

/**
 * Suscribe a cambios de lista de dispositivos térmicos (USB + Serial + agente).
 * @param {(devices:any[])=>void} callback
 * @returns {()=>void} unsubscribe
 */
export function onThermalDevicesChanged(callback) {
  if (typeof callback !== 'function') return () => {}
  ensureUsbSerialListeners()
  thermalDeviceListeners.add(callback)
  listThermalDevices().then((list) => {
    try { callback(list) } catch { /* ignore */ }
  }).catch(() => {})
  return () => {
    thermalDeviceListeners.delete(callback)
    detachUsbSerialListenersIfNeeded()
  }
}

export function offThermalDevicesChanged(callback) {
  thermalDeviceListeners.delete(callback)
  detachUsbSerialListenersIfNeeded()
}

// Compatibilidad: alias para hook usePrinterWatcher
export const subscribeToThermalDevices = onThermalDevicesChanged

/* ---------------- construccion de datos por protocolo ---------------- */

function effectivePaperWidth(profile) {
  if (profile.paperWidth === 'custom') return String(Number(profile.customWidthMm) || 80)
  return profile.paperWidth || '80'
}

function buildInvoiceData({ invoice, company, customer, qrText = '', protocol, paperWidth, drawer, cut, drawerPulse, logo, qrEnabled, barcode, bold, fontScale, lineSpacing, columns, accentedText, ticketStyle }) {
  const payload = { invoice, company, customer, qrText, paperWidth, accentedText: accentedText === true, ticketStyle }
  if (protocol === 'zpl') return { data: new TextEncoder().encode(buildInvoiceZpl(payload)), kind: 'string' }
  if (protocol === 'epl') return { data: buildInvoiceEpl(payload), kind: 'string' }
  if (protocol === 'tspl') return { data: buildInvoiceTspl(payload), kind: 'string' }
  if (protocol === 'cpcl') return { data: buildInvoiceCpcl(payload), kind: 'string' }
  const useModern = ticketStyle === 'modern'
  const builder = useModern ? buildInvoiceEscposModern : buildInvoiceEscpos
  return { data: builder({ ...payload, drawer, cut, drawerPulse, logo, qrEnabled, showBarcode: barcode !== false, bold, fontScale, lineSpacing, columns, accentedText: accentedText === true }), kind: 'blob' }
}

function buildTestData({ protocol, paperWidth, accentedText, ticketStyle }) {
  if (protocol === 'zpl') return { data: new TextEncoder().encode(buildThermalTestZpl()), kind: 'string' }
  if (protocol === 'epl') return { data: buildTestEpl(), kind: 'string' }
  if (protocol === 'tspl') return { data: buildTestTspl(), kind: 'string' }
  if (protocol === 'cpcl') return { data: buildTestCpcl(), kind: 'string' }
  const useModern = ticketStyle === 'modern'
  if (useModern) return { data: buildThermalTestEscposModern({ paperWidth, accentedText: accentedText === true }), kind: 'blob' }
  return { data: buildThermalTestEscpos({ paperWidth, accentedText: accentedText === true }), kind: 'blob' }
}

async function asBytes(payload) {
  if (payload.kind === 'blob') return new Uint8Array(await payload.data.arrayBuffer())
  return payload.data
}

// Reservado para descarga cruda explícita (.prn/.zpl) — fallback ahora usa PDF
// eslint-disable-next-line no-unused-vars
async function downloadData(invoice, payload, protocol) {
  const extension = FILE_EXTENSION[protocol] || 'prn'
  downloadThermalFile(invoice, payload.kind === 'blob' ? payload.data : payload.data, protocol)
  return extension
}

/* ---------------- conexion USB (Parte 4 — fix reclamo interfaz) ---------------- */

async function openAndClaim(device) {
  if (device.opened) return device
  try {
    await device.open()
  } catch (error) {
    const name = error?.name || ''
    if (name === 'SecurityError' || name === 'NetworkError' || /driver|SecurityError|NetworkError/i.test(String(error?.message || ''))) {
      throw new Error(
        'Esta impresora tiene el driver de Windows/macOS activo. Imprima por el dialogo del sistema (boton Ticket navegador) o instale un driver WinUSB con Zadig para acceso directo.',
        { cause: error },
      )
    }
    throw error
  }

  // Si el dispositivo quedó en estado inconsistente por sesión anterior, intentar forget
  let shouldTryForget = false
  try {
    await device.selectConfiguration(1)
  } catch (error) {
    const name = error?.name || ''
    if (name === 'SecurityError' || name === 'NetworkError' || /SecurityError|NetworkError|configuration/i.test(String(error?.message || ''))) {
      shouldTryForget = true
    } else {
      // No es error de driver, propagar
    }
  }

  // Intentar claim interface 0, luego 1, con manejo explícito SecurityError/NetworkError
  const claimErrors = []
  for (const iface of [0, 1]) {
    try {
      await device.claimInterface(iface)
      return device
    } catch (error) {
      claimErrors.push(error)
      const name = error?.name || ''
      const msg = String(error?.message || '')
      const isDriverError =
        name === 'SecurityError' ||
        name === 'NetworkError' ||
        /SecurityError|NetworkError|Access denied|cannot claim|interface/i.test(msg)

      if (isDriverError) {
        // Si tenemos forget disponible y no lo hemos intentado, proponerlo para la próxima vez
        if (device.forget && !shouldTryForget) shouldTryForget = true

        // Si es el último intento, lanzar mensaje honesto
        if (iface === 1) {
          // Intentar forget solo si ya fue reclamada por error en sesión anterior y tenemos permiso
          if (shouldTryForget && typeof device.forget === 'function') {
            try {
              // forget requiere gesto de usuario; puede fallar silenciosamente si no hay gesto
              await device.forget()
            } catch {
              /* no se pudo olvidar automáticamente; el usuario debe hacerlo manualmente en chrome://device-log o configuración USB */
            }
          }
          throw new Error(
            'Esta impresora tiene el driver de Windows/macOS activo. Imprima por el dialogo del sistema (boton Ticket navegador) o instale un driver WinUSB con Zadig para acceso directo.',
            { cause: error },
          )
        }
        // Probar siguiente interfaz
        continue
      }
      // Otro error no relacionado a driver: probar siguiente interfaz si queda
      if (iface === 1) throw error
    }
  }

  // Si llegamos aquí sin reclamar, lanzar error genérico con contexto de driver
  const lastErr = claimErrors[claimErrors.length - 1]
  if (lastErr) {
    const name = lastErr?.name || ''
    if (name === 'SecurityError' || name === 'NetworkError') {
      throw new Error(
        'Esta impresora tiene el driver de Windows/macOS activo. Imprima por el dialogo del sistema (boton Ticket navegador) o instale un driver WinUSB con Zadig para acceso directo.',
      )
    }
    throw lastErr
  }
  throw new Error('No se pudo reclamar ninguna interfaz USB. Reinicie la impresora e intente de nuevo.')
}

async function sendBytes(device, bytes) {
  const chunkSize = 512
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, Math.min(index + chunkSize, bytes.length))
    try {
      await device.transferOut(1, chunk)
    } catch {
      try {
        await device.transferOut(2, chunk)
      } catch {
        throw new Error('Error de comunicacion USB con la impresora. Reiniciela e intente de nuevo.')
      }
    }
  }
}

async function closeDevice(device) {
  try {
    if (device?.opened) await device.close()
  } catch {
    /* ya cerrada */
  }
}

async function reconnectUsb(profile) {
  if (!navigator.usb || !profile?.vendorId) return null
  const devices = await navigator.usb.getDevices()
  const device = devices.find((item) => item.vendorId === profile.vendorId && (!profile.productName || (item.productName || '') === profile.productName))
    || devices.find((item) => item.vendorId === profile.vendorId)
  if (!device) return null
  await openAndClaim(device)
  return device
}

export async function addThermalPrinter() {
  if (!navigator.usb) throw new Error('WebUSB no esta disponible. Use Chrome o Edge.')
  const device = await requestUsbDevice()
  if (!device) return null
  const protocol = detectProtocolFromVendor(device.vendorId)
  const profile = {
    ...getThermalProfile(),
    vendorId: device.vendorId,
    productName: device.productName || 'Impresora termica',
    protocol,
    connection: 'usb',
    detectedAt: Date.now(),
  }
  saveThermalProfile(profile)
  return profile
}

export async function detectThermalPrinter() {
  if (!navigator.usb) throw new Error('WebUSB no esta disponible. Use Chrome o Edge para deteccion automatica.')
  const profile = await addThermalPrinter()
  if (!profile) return null
  try {
    const device = await reconnectUsb(profile)
    if (device) await closeDevice(device)
  } catch {
    /* la comunicacion se valida al imprimir */
  }
  return profile
}

export async function addBluetoothPrinter() {
  if (!navigator.bluetooth) throw new Error('Bluetooth Web no esta disponible. Use Chrome o Edge.')
  const device = await requestBluetoothDevice()
  if (!device) return null
  const profile = {
    ...getThermalProfile(),
    bluetoothDeviceId: device.id,
    productName: device.name || 'Impresora Bluetooth',
    protocol: 'escpos',
    connection: 'bluetooth',
    manualProtocol: false,
    detectedAt: Date.now(),
  }
  saveThermalProfile(profile)
  return profile
}

/* ---------------- conexion Red/LAN (WebPRNT y compatibles) ---------------- */

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 8192
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
    let part = ''
    for (let i = 0; i < chunk.length; i++) part += String.fromCharCode(chunk[i])
    binary += part
  }
  return btoa(binary)
}

async function sendNetworkBytes(bytes, { networkHost, networkPort }) {
  // Si el agente está conectado, preferir socket TCP crudo 9100 vía agente en vez de WebPRNT HTTP
  if (printAgentClient.isAgentConnected() && networkHost) {
    try {
      // El agente usa type: 'print' con target host/port para raw 9100
      const res = await printAgentClient.printViaAgent({
        bytes,
        protocol: 'escpos',
        target: { host: networkHost, port: networkPort || 9100 },
        kind: 'thermal',
      })
      if (res && res.ok !== false) return { ok: true, device: `${networkHost}:${networkPort || 9100}` }
      // Si el agente respondió con error, caemos a WebPRNT como fallback
    } catch {
      // fallback a WebPRNT
    }
  }

  const port = networkPort || 8001
  const url = `http://${networkHost}:${port}/webprnt`
  const body = `data=${encodeURIComponent(bytesToBase64(bytes))}&isRawData=true`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) return { ok: true, device: `${networkHost}:${port}` }
    return { ok: false, error: `La impresora respondio HTTP ${response.status}. Verifique IP, puerto y soporte WebPRNT. Si es una impresora de red genérica (9100), verifique IP/puerto o imprima por el diálogo del sistema.` }
  } catch (error) {
    return { ok: false, error: `Sin respuesta de ${networkHost}:${port} (${error.message}). Verifique que la impresora este en red y soporte WebPRNT. Para impresoras 9100 genéricas, verifique IP/puerto o imprima por el diálogo del sistema.` }
  }
}

/* ---------------- conexion Bluetooth ---------------- */

async function findRememberedBluetooth(deviceId) {
  if (!navigator.bluetooth || !deviceId) return null
  try {
    const devices = await navigator.bluetooth.getDevices()
    return devices.find((device) => device.id === deviceId) || null
  } catch {
    return null
  }
}

async function sendBluetoothBytes(bytes, profile = {}) {
  if (!navigator.bluetooth) throw new Error('Bluetooth Web no esta disponible. Use Chrome o Edge.')
  let device = await findRememberedBluetooth(profile.bluetoothDeviceId)
  if (!device) {
    device = await requestBluetoothDevice()
    if (!device) return null
  }
  const server = await device.gatt.connect()
  let characteristic = null
  for (const serviceUuid of [0xFFE0, 0x1823]) {
    try {
      const service = await server.getPrimaryService(serviceUuid)
      const characteristics = await service.getCharacteristics()
      characteristic = characteristics.find((item) => item.properties.write || item.properties.writeWithoutResponse) || null
      if (characteristic) break
    } catch {
      /* probar siguiente servicio */
    }
  }
  if (!characteristic) throw new Error('No se encontro canal de escritura en la impresora Bluetooth. Nota: la mayoría de impresoras térmicas de recibo son Bluetooth Clásico (SPP/RFCOMM), no BLE. Para ellas, empareje en el sistema operativo (crea puerto COM/tty) e imprima por el diálogo del sistema.')
  const chunkSize = 180
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, Math.min(index + chunkSize, bytes.length))
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk)
    } else {
      await characteristic.writeValue(chunk)
    }
    await new Promise((resolve) => setTimeout(resolve, 24))
  }
  return { name: device.name || 'Impresora Bluetooth', id: device.id }
}

/* ---------------- envio segun configuracion (Parte 2: agente como canal principal) ---------------- */

function resolveProtocol(profile, fallback) {
  if (profile.manualProtocol && THERMAL_PROTOCOLS.some((item) => item.id === profile.protocol)) return profile.protocol
  if (profile.protocol) return profile.protocol
  return fallback
}

async function tryPrintViaAgent({ bytes, profile, protocol }) {
  if (!printAgentClient.isAgentConnected()) return null

  // Mapear perfil a target del agente
  const connection = profile.connection || 'auto'
  let target = {}
  let kind = 'thermal'

  if (connection === 'network' && profile.networkHost) {
    target = { host: profile.networkHost, port: profile.networkPort || 9100, type: 'network' }
  } else if (connection === 'serial') {
    // Para Bluetooth clásico emparejado, el SO crea un COM; reusamos serial
    target = { portName: profile.serialPortName || profile.portName || profile.comPort || '', baudRate: profile.baudRate || 9600, type: 'serial' }
    // Si no hay portName pero hay bluetoothDeviceId, informar que use COM virtual
    if (!target.portName && profile.bluetoothDeviceId) {
      return { ok: false, via: 'config', error: 'Bluetooth clásico detectado. Empareje la impresora en Windows/macOS (creará un puerto COM/tty virtual) y seleccione ese puerto en la configuración.' }
    }
    if (!target.portName) {
      // Intentar listar puertos del agente y usar el primero disponible
      try {
        const printers = await printAgentClient.listPrintersViaAgent()
        const serialCandidate = (printers || []).find((p) => p.connection === 'serial' || String(p.portName || '').toUpperCase().startsWith('COM') || String(p.path || '').includes('tty'))
        if (serialCandidate) target.portName = serialCandidate.portName || serialCandidate.path || serialCandidate.name
      } catch { /* ignore */ }
    }
  } else if (connection === 'usb' || connection === 'auto') {
    // El agente es la fuente de verdad: en automático solo elegimos una cola
    // que realmente está instalada en el SO, nunca un nombre inventado o viejo.
    let printerName = ''
    try {
      const printers = await printAgentClient.listPrintersViaAgent()
      const thermal = (printers || []).filter((p) => p.kind === 'thermal')
      const requestedName = String(profile.printerName || profile.productName || '').trim().toLowerCase()
      const selected = requestedName
        ? thermal.find((p) => String(p.printerName || p.name || '').trim().toLowerCase() === requestedName)
        : null
      const automatic = profile.printMode !== 'manual'
      const candidate = selected || (automatic ? thermal.find((p) => p.isDefault) || thermal[0] : null)
      printerName = candidate?.printerName || candidate?.name || candidate?.displayName || ''
      if (candidate && /trifusion\s+pos-?80/i.test(String(candidate.printerName || candidate.name || ''))) {
        console.debug('[print] Trifusion POS-80 detectada por agente', { kind: candidate.kind, route: 'spooler', printerName })
      }
    } catch { /* el agente ya reportará un error o se aplicará el respaldo navegador */ }
    // En modo manual se conserva el nombre escrito solo si el agente no pudo
    // listar; el agente validará que la cola exista antes de imprimir.
    if (!printerName && profile.printMode === 'manual') printerName = profile.printerName || profile.productName || ''
    if (printerName) target = { printerName, type: 'usb', vendorId: profile.vendorId }
    else if (profile.vendorId) target = { vendorId: profile.vendorId, type: 'usb' }
  } else if (connection === 'bluetooth') {
    // Bluetooth BLE vía WebBluetooth sigue siendo local; para clásico el agente espera serial portName
    // No intentar agente para BLE puro (WebBluetooth)
    return null
  }

  // Si no hay target concreto pero el agente tiene impresoras, intentar igual con bytes crudos (el agente elegirá por defecto)
  try {
    const res = await printAgentClient.printViaAgent({ bytes, protocol, target, kind })
    // printViaAgent ya valida ok/error; si ok, devolver éxito
    if (res && res.ok !== false) {
      return { ok: true, via: 'agent', device: res.device || target.printerName || target.host || target.portName || 'Agente', protocol }
    }
    // Si el agente respondió ok:false, propagar error honesto
    return { ok: false, via: 'agent', error: res?.error || 'El agente no pudo imprimir' }
  } catch (error) {
    // No romper; dejar que el caller haga fallback a WebUSB/WebSerial/WebPRNT
    // Si el error es claro de agente (ej. impresora no encontrada), informar
    const msg = String(error?.message || error)
    if (/no encontrada|not found|No se pudo/i.test(msg)) {
      return { ok: false, via: 'agent', error: msg }
    }
    return null
  }
}

async function routeSend({ bytes, profile }) {
  // ── Intento principal: agente local (si está conectado) ──
  const agentAttempt = await tryPrintViaAgent({ bytes, profile, protocol: profile.protocol || 'escpos' })
  if (agentAttempt) {
    if (agentAttempt.ok) return agentAttempt
    // Si el agente respondió con error de configuración claro, retornarlo directamente (no hacer fallback silencioso)
    if (agentAttempt.via === 'config' || agentAttempt.via === 'agent') {
      // Si es error de agente pero existe fallback local viable, podríamos intentar fallback;
      // por ahora retornamos el error del agente para que la UI muestre mensaje honesto,
      // salvo que el error indique que pruebe fallback
      if (agentAttempt.error && /Bluetooth clásico/i.test(agentAttempt.error)) return agentAttempt
      // Para otros casos, si agentAttempt es via:'agent' con error, intentar fallback local como respaldo
      // (mantener comportamiento existente)
      if (agentAttempt.via === 'agent' && agentAttempt.error) {
        // Intentar ruta local como respaldo solo si no es error de validación de target
        // Dejar caer al siguiente bloque (fallback)
      } else {
        return agentAttempt
      }
    }
  }

  const connection = profile.connection || 'auto'
  if (connection === 'file') return { ok: false, via: 'file' }
  if (connection === 'network') {
    if (!profile.networkHost) return { ok: false, via: 'config', error: 'Configure la direccion IP de la impresora en Configuracion > Red/LAN.' }
    const sent = await sendNetworkBytes(bytes, { networkHost: profile.networkHost, networkPort: profile.networkPort })
    if (sent.ok) return { ok: true, via: 'network', device: sent.device }
    return { ok: false, via: 'config', error: sent.error }
  }
  if (connection === 'bluetooth') {
    const sent = await sendBluetoothBytes(bytes, profile)
    if (!sent) return { ok: false, via: 'config', error: 'Se cancelo la seleccion de la impresora Bluetooth.' }
    saveThermalProfile({ ...profile, bluetoothDeviceId: sent.id, connection: 'bluetooth', manualProtocol: false })
    return { ok: true, via: 'bluetooth', device: sent.name }
  }
  if (connection === 'serial') {
    // Si el agente está disponible y hay puerto, ya se intentó arriba; aquí fallback a WebSerial
    if (printAgentClient.isAgentConnected()) {
      // El agente ya intentó; si falló, probar WebSerial como último recurso
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    try {
      const result = await sendToSerialPort(blob, { baudRate: profile.baudRate || 9600 })
      return { ok: true, via: 'serial', device: String(result) }
    } catch (error) {
      const msg = String(error?.message || error)
      if (/no soportado|not supported/i.test(msg)) {
        return { ok: false, via: 'config', error: 'WebSerial no está disponible en este navegador. Use Chrome/Edge de escritorio.' }
      }
      throw error
    }
  }
  if (connection === 'usb' || connection === 'auto') {
    const remembered = profile.vendorId ? await reconnectUsb(profile).catch((e) => { throw e }) : null
    if (remembered) {
      await sendBytes(remembered, bytes)
      await closeDevice(remembered)
      return { ok: true, via: 'usb', device: profile.productName || 'Impresora USB', protocol: profile.protocol }
    }
    if (connection === 'usb' && navigator.usb) {
      const device = await requestUsbDevice()
      if (!device) return { ok: false, via: 'config', error: 'Se cancelo la seleccion de la impresora.' }
      await openAndClaim(device)
      const detected = detectProtocolFromVendor(device.vendorId)
      const productName = device.productName || 'Impresora termica'
      saveThermalProfile({ ...profile, vendorId: device.vendorId, productName, protocol: detected, connection: 'usb', detectedAt: Date.now() })
      await sendBytes(device, bytes)
      await closeDevice(device)
      return { ok: true, via: 'usb', device: productName, protocol: detected }
    }
    if (connection === 'usb') return { ok: false, via: 'config', error: 'WebUSB no esta disponible. Use Chrome o Edge.' }
    return {
      ok: false,
      via: 'config',
      error: profile.vendorId
        ? 'La impresora USB no esta conectada. Conectela e intente de nuevo, o imprima por el diálogo del sistema (botón Ticket navegador).'
        : 'No hay impresora configurada. Abra Configuracion y agregue su impresora por USB/Bluetooth.',
    }
  }
  return { ok: false, via: 'none' }
}

export async function printInvoiceThermal({ invoice, company, customer, qrText = '', protocol, paperWidth, profileOverride }) {
  void paperWidth
  const profile = { ...getThermalProfile(), ...(profileOverride || {}) }
  const useProtocol = resolveProtocol(profile, protocol || 'escpos')
  const payload = buildInvoiceData({
    invoice, company, customer, qrText,
    protocol: useProtocol,
    paperWidth: effectivePaperWidth(profile),
    drawer: profile.drawer !== false,
    cut: profile.cut,
    drawerPulse: profile.drawerPulse,
    logo: profile.logo !== false,
    qrEnabled: profile.qrEnabled !== false,
    barcode: profile.barcode !== false,
    bold: profile.bold !== false,
    fontScale: Number(profile.fontScale) || 0,
    lineSpacing: Number(profile.lineSpacing) || 30,
    columns: profile.columns || '2',
    accentedText: profile.accentedText === true,
    ticketStyle: profile.ticketStyle || 'classic',
  })
  try {
    const result = await routeSend({ bytes: await asBytes(payload), profile: { ...profile, protocol: useProtocol } })
    if (result.ok) return result
    if (result.via === 'file' || result.via === 'none') {
      // Profesional: imprimir no puede descargar — ofrecer diálogo navegador donde elige Trifusion POS-80 u otra
      return { ok: false, via: 'dialog', error: `Sin impresora configurada para impresión directa. Se abrirá el diálogo del sistema: elija su impresora (ej: Trifusion POS-80) y confirme. Puede usar "Ticket navegador" para 80mm o "Carta navegador" para A4.` }
    }
    // El botón "Imprimir" no debe terminar en una descarga ni dejar al usuario
    // sin una acción. Si la ruta directa no está disponible, el llamador abre
    // el diálogo del navegador con la propia factura/ticket como respaldo.
    if (result.via === 'config' || result.via === 'agent') {
      return {
        ok: false,
        via: 'dialog',
        error: `${result.error || 'No fue posible usar la impresora configurada.'} Se abrirá el diálogo del sistema con esta factura para que elija la impresora.`,
      }
    }
    return result
  } catch (error) {
    // Fallback profesional: diálogo navegador, no descarga automática
    return { ok: false, via: 'dialog', error: `${error.message} Se abrirá el diálogo del sistema para elegir impresora.` }
  }
}

export async function printThermalTest({ protocol, paperWidth, profileOverride } = {}) {
  void paperWidth
  const profile = { ...getThermalProfile(), ...(profileOverride || {}) }
  const useProtocol = resolveProtocol(profile, protocol || 'escpos')
  const payload = buildTestData({ protocol: useProtocol, paperWidth: effectivePaperWidth(profile), accentedText: profile.accentedText === true, ticketStyle: profile.ticketStyle || 'classic' })
  try {
    const result = await routeSend({ bytes: await asBytes(payload), profile: { ...profile, protocol: useProtocol } })
    if (result.ok) return result
    if (result.via === 'config' || result.via === 'agent') return result
    return { ok: false, via: 'dialog', error: `Sin canal activo; se abrirá el diálogo del sistema para prueba. Elija Trifusion POS-80 y confirme.` }
  } catch (error) {
    const msg = String(error?.message || '')
    if (/driver de Windows|agente local|WinUSB|Zadig/i.test(msg)) {
      return { ok: false, via: 'config', error: msg }
    }
    return { ok: false, via: 'dialog', error: `${error.message} Se abrirá el diálogo del sistema para prueba.` }
  }
}

/**
 * Impresión directa desde el navegador (fallback honesto, siempre muestra diálogo del sistema).
 * Usa el PDF de recibo (80mm) o factura limpia y lo manda a un iframe con autoPrint.
 * Útil para impresoras virtuales como "Trifusion POS-80" cuando el agente no está o el usuario prefiere diálogo.
 */
export async function printThermalViaBrowser({ invoice, company, customer, qrText = '' } = {}) {
  const profile = getThermalProfile()
  const paperWidth = effectivePaperWidth(profile)
  try {
    // Ticket navegador y descarga usan exactamente el mismo PDF térmico. Así
    // se conserva el diseño fiscal completo de la factura, incluido QR, notas,
    // garantía, artículos y totales; solo cambia la salida (imprimir vs guardar).
    const pdf = await buildReceiptPdf({ invoice, company, customer, qrText, paperWidth })
    pdf.autoPrint()
    // Data URI en vez de Blob URL: el visor PDF de Chrome obtiene el Blob
    // desde otra particion de almacenamiento y lo bloquea ("Fetching
    // partitioned blob URL"); el data URI viaja inline sin lookup de particion.
    const url = pdf.output('datauristring')
    const frame = document.createElement('iframe')
    frame.setAttribute('title', 'Ticket de factura')
    frame.style.position = 'fixed'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'
    document.body.appendChild(frame)
    frame.onload = () => {
      // Solo imprimir el PDF cargado dentro del iframe. No usar window.print()
      // de la aplicación, porque eso imprimía la ruta /facturacion vacía.
      try { frame.contentWindow?.focus(); frame.contentWindow?.print() } catch { /* el PDF conserva la acción autoPrint */ }
      window.setTimeout(() => { frame.remove() }, 60000)
    }
    frame.src = url
    return { ok: false, via: 'dialog', error: 'Impresión directa desde navegador: se abrirá el diálogo del sistema para elegir impresora (ej: Trifusion POS-80). Seleccione su impresora virtual y confirme.', silent: false }
  } catch (error) {
    return { ok: false, via: 'config', error: `No se pudo preparar el ticket para imprimir. ${String(error.message || '')}`, silent: false }
  }
}
