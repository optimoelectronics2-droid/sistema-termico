import { detectProtocolFromVendor, sendToSerialPort } from './barcodeLabelService'
import {
  buildInvoiceCpcl,
  buildInvoiceEpl,
  buildInvoiceEscpos,
  buildInvoiceTspl,
  buildInvoiceZpl,
  buildTestCpcl,
  buildTestEpl,
  buildTestTspl,
  buildThermalTestEscpos,
  buildThermalTestZpl,
  downloadThermalFile,
  THERMAL_PROTOCOLS,
} from '../lib/invoiceThermal'

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
  if (!navigator.usb) return []
  try {
    const devices = await navigator.usb.getDevices()
    return devices.map((device) => ({
      vendorId: device.vendorId,
      productName: device.productName || 'Impresora USB',
      serialNumber: device.serialNumber || '',
      protocol: detectProtocolFromVendor(device.vendorId),
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

/* ---------------- construccion de datos por protocolo ---------------- */

function effectivePaperWidth(profile) {
  if (profile.paperWidth === 'custom') return String(Number(profile.customWidthMm) || 80)
  return profile.paperWidth || '80'
}

function buildInvoiceData({ invoice, company, customer, qrText = '', protocol, paperWidth, drawer, cut, drawerPulse, logo, qrEnabled, barcode, bold, fontScale, lineSpacing, columns }) {
  const payload = { invoice, company, customer, qrText, paperWidth }
  if (protocol === 'zpl') return { data: new TextEncoder().encode(buildInvoiceZpl(payload)), kind: 'string' }
  if (protocol === 'epl') return { data: buildInvoiceEpl(payload), kind: 'string' }
  if (protocol === 'tspl') return { data: buildInvoiceTspl(payload), kind: 'string' }
  if (protocol === 'cpcl') return { data: buildInvoiceCpcl(payload), kind: 'string' }
  return { data: buildInvoiceEscpos({ ...payload, drawer, cut, drawerPulse, logo, qrEnabled, showBarcode: barcode !== false, bold, fontScale, lineSpacing, columns }), kind: 'blob' }
}

function buildTestData({ protocol, paperWidth }) {
  if (protocol === 'zpl') return { data: new TextEncoder().encode(buildThermalTestZpl()), kind: 'string' }
  if (protocol === 'epl') return { data: buildTestEpl(), kind: 'string' }
  if (protocol === 'tspl') return { data: buildTestTspl(), kind: 'string' }
  if (protocol === 'cpcl') return { data: buildTestCpcl(), kind: 'string' }
  return { data: buildThermalTestEscpos({ paperWidth }), kind: 'blob' }
}

async function asBytes(payload) {
  if (payload.kind === 'blob') return new Uint8Array(await payload.data.arrayBuffer())
  return payload.data
}

async function downloadData(invoice, payload, protocol) {
  const extension = FILE_EXTENSION[protocol] || 'prn'
  downloadThermalFile(invoice, payload.kind === 'blob' ? payload.data : payload.data, protocol)
  return extension
}

/* ---------------- conexion USB ---------------- */

async function openAndClaim(device) {
  if (device.opened) return device
  await device.open()
  await device.selectConfiguration(1)
  try {
    await device.claimInterface(0)
  } catch {
    try {
      await device.claimInterface(1)
    } catch {
      throw new Error('No se pudo reclamar ninguna interfaz USB. Reinicie la impresora e intente de nuevo.')
    }
  }
  return device
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
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

async function sendNetworkBytes(bytes, { networkHost, networkPort }) {
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
    return { ok: false, error: `La impresora respondio HTTP ${response.status}. Verifique IP, puerto y soporte WebPRNT.` }
  } catch (error) {
    return { ok: false, error: `Sin respuesta de ${networkHost}:${port} (${error.message}). Verifique que la impresora este en red y soporte WebPRNT.` }
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
  if (!characteristic) throw new Error('No se encontro canal de escritura en la impresora Bluetooth.')
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

/* ---------------- envio segun configuracion ---------------- */

function resolveProtocol(profile, fallback) {
  if (profile.manualProtocol && THERMAL_PROTOCOLS.some((item) => item.id === profile.protocol)) return profile.protocol
  if (profile.protocol) return profile.protocol
  return fallback
}

async function routeSend({ bytes, profile, paperWidth, downloadName }) {
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
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const result = await sendToSerialPort(blob, { baudRate: profile.baudRate || 9600 })
    return { ok: true, via: 'serial', device: String(result) }
  }
  if (connection === 'usb' || connection === 'auto') {
    const remembered = profile.vendorId ? await reconnectUsb(profile) : null
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
        ? 'La impresora USB no esta conectada. Conectela e intente de nuevo.'
        : 'No hay impresora configurada. Abra Configuracion y agregue su impresora por USB o Bluetooth.',
    }
  }
  return { ok: false, via: 'none' }
}

export async function printInvoiceThermal({ invoice, company, customer, qrText = '', protocol, paperWidth, profileOverride }) {
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
  })
  try {
    const result = await routeSend({ bytes: await asBytes(payload), profile, paperWidth, downloadName: invoice?.number })
    if (result.ok) return result
    if (result.via === 'file' || result.via === 'none') {
      const extension = await downloadData(invoice, payload, useProtocol)
      return { ok: false, via: 'download', error: `Sin canal de impresion activo; se descargo el archivo .${extension}.` }
    }
    if (result.via === 'config') return result
    return result
  } catch (error) {
    const extension = await downloadData(invoice, payload, useProtocol)
    return { ok: false, via: 'download', error: `${error.message} Se descargo el archivo .${extension} como respaldo.` }
  }
}

export async function printThermalTest({ protocol, paperWidth, profileOverride } = {}) {
  const profile = { ...getThermalProfile(), ...(profileOverride || {}) }
  const useProtocol = resolveProtocol(profile, protocol || 'escpos')
  const payload = buildTestData({ protocol: useProtocol, paperWidth: effectivePaperWidth(profile) })
  try {
    const result = await routeSend({ bytes: await asBytes(payload), profile, paperWidth })
    if (result.ok) return result
    if (result.via === 'config') return result
    const extension = await downloadData({ number: 'PRUEBA' }, payload, useProtocol)
    return { ok: false, via: 'download', error: `Sin canal de impresion activo; se descargo la prueba .${extension}.` }
  } catch (error) {
    const extension = await downloadData({ number: 'PRUEBA' }, payload, useProtocol)
    return { ok: false, via: 'download', error: `${error.message} Se descargo la prueba .${extension} como respaldo.` }
  }
}
