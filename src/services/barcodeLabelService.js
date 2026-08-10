import { buildCode128Bars, getBarcodeLayout, sanitizeCode128Value, validateAndSanitizeForPrint } from '../lib/barcodeEngine'

const SIZES = {
  '2x1': { widthIn: 2, heightIn: 1, cols: 4, name: '2" x 1"' },
  '3x2': { widthIn: 3, heightIn: 2, cols: 3, name: '3" x 2"' },
  '4x2': { widthIn: 4, heightIn: 2, cols: 2, name: '4" x 2"' },
  '4x3': { widthIn: 4, heightIn: 3, cols: 2, name: '4" x 3"' },
  '4x6': { widthIn: 4, heightIn: 6, cols: 1, name: '4" x 6"' },
}

export const LABEL_DIMENSIONS = Object.fromEntries(
  Object.entries(SIZES).map(([id, s]) => [id, { ...s, widthDots: s.widthIn * 203, heightDots: s.heightIn * 203 }])
)

export function getLabelDim(id, dpi = 203) {
  const s = SIZES[id] || SIZES['3x2']
  return { ...s, widthDots: s.widthIn * dpi, heightDots: s.heightIn * dpi }
}

export const PRINT_MODES = [
  { id: 'browser', label: 'Navegador (PDF)', desc: 'PDF con medidas exactas en mm, compatible con cualquier impresora' },
  { id: 'zpl', label: 'ZPL archivo', desc: 'Descarga .zpl para Zebra, 2connet, Agiler, Epson ZPL' },
  { id: 'usb', label: 'ZPL WebUSB', desc: 'Envio directo por USB (Chrome/Edge) a impresoras ZPL' },
  { id: 'escpos', label: 'ESC/POS archivo', desc: 'Descarga .prn para Epson TM, Bixolon, Star, genericas' },
  { id: 'escpos-usb', label: 'ESC/POS WebUSB', desc: 'Envio directo USB a Epson TM y compatibles ESC/POS' },
  { id: 'png', label: 'Imagen PNG', desc: 'Descarga como imagen 203DPI para compartir o imprimir' },
]

function buildLabelContent(product, opts = {}) {
  const includePrice = opts.includePrice !== false
  const includeSku = opts.includeSku !== false
  const barcode = opts.barcode || product.barcode || product.sku || product.id || 'SIN-CODIGO'
  const sku = opts.sku || product.sku || ''
  return {
    name: String(product.name || 'Producto').trim().slice(0, 40),
    sku: includeSku ? String(sku).trim().slice(0, 20) : '',
    price: includePrice ? Number(product.price || product.salePrice || 0) : 0,
    barcode: sanitizeBarcodePayload(barcode),
  }
}

function sanitizeBarcodePayload(value) {
  return sanitizeCode128Value(value)
}

function zplField(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/[\^~_\\]/g, (char) => `_${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/* =================================================================
   ZPL
   ================================================================= */
function zplFit(c, dim, includePrice) {
  const margin = Math.round(dim.widthDots * 0.04)
  const usableW = dim.widthDots - margin * 2
  let y = margin
  const maxY = dim.heightDots - margin
  const bc = buildCode128Bars(c.barcode)
  const totalModules = bc.width + 20
  const barModule = Math.max(1, Math.min(3, Math.floor(usableW / totalModules) || 1))
  const bcTotalDots = totalModules * barModule
  const bcX = margin + Math.max(0, Math.round((usableW - bcTotalDots) / 2)) + 10 * barModule
  let nameFs = Math.min(Math.round(dim.heightDots * 0.13), 35)
  let priceFs = Math.min(Math.round(dim.heightDots * 0.17), 48)
  let skuFs = Math.round(nameFs * 0.65)
  let nameH = nameFs + Math.round(dim.heightDots * 0.04)
  let skuH = c.sku ? skuFs + Math.round(dim.heightDots * 0.025) : 0
  let priceH = (c.price > 0 && includePrice) ? priceFs + Math.round(dim.heightDots * 0.04) : 0
  let totalNeeded = nameH + skuH + priceH + Math.round(dim.heightDots * 0.22) + 8
  let dropSku = false; let dropPrice = false
  if (totalNeeded > maxY) {
    const s = maxY / totalNeeded
    nameFs = Math.max(10, Math.round(nameFs * s)); priceFs = Math.max(14, Math.round(priceFs * s))
    skuFs = Math.round(nameFs * 0.65); nameH = nameFs + Math.round(dim.heightDots * 0.03)
    skuH = c.sku ? skuFs + Math.round(dim.heightDots * 0.02) : 0; priceH = (c.price > 0 && includePrice) ? priceFs + Math.round(dim.heightDots * 0.03) : 0
    totalNeeded = nameH + skuH + priceH + Math.round(dim.heightDots * 0.16) + 6
  }
  if (totalNeeded > maxY) { dropSku = true; totalNeeded = nameH + priceH + Math.round(dim.heightDots * 0.16) + 6 }
  if (totalNeeded > maxY && c.price > 0) { dropPrice = true; totalNeeded = nameH + Math.round(dim.heightDots * 0.16) + 6 }
  if (totalNeeded > maxY) { nameFs = Math.max(8, nameFs - 2); nameH = nameFs + Math.round(dim.heightDots * 0.02) }
  const bcH = Math.max(18, Math.min(Math.round(maxY * 0.4), maxY - y - nameH - (dropSku ? 0 : skuH) - (dropPrice ? 0 : priceH) - 6))
  const lines = []
  function z(t) { lines.push(t) }
  z('^XA'); z(`^LL${dim.heightDots}`); z(`^PW${dim.widthDots}`)
  z(`^CF0,${nameFs}`); z(`^FO${margin},${y}^FH^FD${zplField(c.name)}^FS`); y += nameH
  if (c.sku && !dropSku) { z(`^CF0,${skuFs}`); z(`^FO${margin},${y}^FH^FDSKU:${zplField(c.sku)}^FS`); y += skuH }
  if (c.price > 0 && includePrice && !dropPrice) {
    z(`^CF0,${priceFs}`); z(`^FO${margin},${y}^FH^FDRD$${zplField(c.price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}^FS`); y += priceH
  }
  z(`^FO${bcX},${y}^BY${barModule}^BCN,${bcH},Y,N,N`); z(`^FH^FD${zplField(c.barcode)}^FS`)
  lines.push('^XZ')
  return lines.join('\n')
}

export function generateZPL(product, { labelSize = '3x2', includePrice = true, includeSku = true, quantity = 1, dpi = 203, barcode = '', sku = '' } = {}) {
  const dim = getLabelDim(labelSize, dpi)
  const c = buildLabelContent(product, { includePrice, includeSku, barcode, sku })
  let result = ''
  for (let i = 0; i < quantity; i++) result += zplFit(c, dim, includePrice) + '\n'
  return result.trim()
}

export function downloadZplFile(zpl, filename = 'etiquetas.zpl') {
  const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* =================================================================
   ESC/POS
   ================================================================= */
function encodeText(str, maxChars) {
  return new TextEncoder().encode((str || '').slice(0, maxChars || 48) + '\n')
}

function fitCanvasLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').trim().slice(0, 40).split(/\s+/).filter(Boolean)
  const lines = []
  for (const word of words) {
    const current = lines[lines.length - 1] || ''
    const test = current ? current + ' ' + word : word
    if (!current || ctx.measureText(test).width <= maxWidth) {
      if (current) lines[lines.length - 1] = test; else lines.push(test)
      continue
    }
    if (lines.length >= maxLines) break
    lines.push(word)
  }
  if (lines.length > maxLines) lines.length = maxLines
  if (!lines.length) lines.push('Producto')
  const full = words.join(' ')
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]
    const shouldEllipsize = index === lines.length - 1 && full !== lines.join(' ')
    while (line.length > 1 && ctx.measureText(line + (shouldEllipsize ? '...' : '')).width > maxWidth) line = line.slice(0, -1).trim()
    lines[index] = line + (shouldEllipsize ? '...' : '')
  }
  return lines
}

export function generateESCPOS(product, { labelSize = '3x2', includePrice = true, includeSku = true, quantity = 1, dpi = 203, barcode = '', sku = '' } = {}) {
  const dim = getLabelDim(labelSize, dpi)
  const c = buildLabelContent(product, { includePrice, includeSku, barcode, sku })
  const maxChars = dim.widthDots > 300 ? 32 : 20; const encoder = new TextEncoder()
  function build() {
    const chunks = []
    function cmd(...args) { chunks.push(new Uint8Array(args)) }
    function raw(arr) { chunks.push(arr) }
    cmd(0x1B, 0x40); cmd(0x1B, 0x61, 0x01); cmd(0x1B, 0x21, 0x08); raw(encodeText(c.name, maxChars))
    if (c.sku) { cmd(0x1B, 0x21, 0x01); raw(encodeText('SKU: ' + c.sku, maxChars)) }
    if (c.price > 0) { cmd(0x1B, 0x21, 0x30); raw(encodeText('RD$' + c.price.toFixed(2), maxChars)) }
    const barcodeBytes = encoder.encode(sanitizeBarcodePayload(c.barcode))
    cmd(0x1D, 0x68, Math.min(0xFF, Math.round(dim.heightDots * 0.35)))
    const bc = buildCode128Bars(c.barcode)
    const moduleWidth = Math.max(1, Math.min(6, Math.floor((dim.widthDots * 0.9) / (bc.width + 20)) || 1))
    cmd(0x1D, 0x77, moduleWidth); cmd(0x1D, 0x6B, 0x49, barcodeBytes.length + 2)
    raw(new Uint8Array([0x7B, 0x42])); raw(barcodeBytes)
    cmd(0x1D, 0x56, 0x00)
    return chunks
  }
  const all = []
  for (let i = 0; i < quantity; i++) all.push(...build())
  return new Blob(all, { type: 'application/octet-stream' })
}

export function downloadEscposFile(blob, filename = 'etiquetas.prn') {
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* =================================================================
   WebUSB mejorado — detección automática de protocolo por vendorId
   ================================================================= */

const VENDOR_PROTOCOLS = {
  '0x0A5F': 'zpl',    // Zebra
  '0x04B8': 'escpos', // Epson
  '0x0519': 'escpos', // Star Micronics
  '0x154F': 'escpos', // Bixolon
  '0x1E17': 'escpos', // Citizen
  '0x067B': 'escpos', // Genérica
}

/**
 * Detect protocol from USB vendor ID
 * @param {number} vendorId - USB vendor ID
 * @returns {'zpl'|'escpos'}
 */
export function detectProtocolFromVendor(vendorId) {
  const hex = `0x${vendorId.toString(16).toUpperCase().padStart(4, '0')}`
  return VENDOR_PROTOCOLS[hex] || 'escpos'
}

/**
 * Request a USB printer device and send data
 * @param {string|Blob} data - ZPL string or ESC/POS Blob
 * @param {'zpl'|'escpos'} protocol - Protocol to use
 * @returns {Promise<{deviceName: string, vendorId: number, protocol: string}>}
 */
export async function sendToUsbPrinter(data, protocol = 'zpl') {
  if (!navigator.usb) throw new Error('WebUSB no soportado en este navegador. Use Chrome/Edge.')

  // Intentar con filtros de todas las marcas conocidas; si falla, usar vacío
  let device
  try {
    device = await navigator.usb.requestDevice({ filters: VENDOR_PROTOCOLS.keys })
  } catch {
    device = await navigator.usb.requestDevice({ filters: [] })
  }

  await device.open()
  await device.selectConfiguration(1)

  // Intentar claimInterface(0), si falla probar interface 1
  try {
    await device.claimInterface(0)
  } catch {
    try {
      await device.claimInterface(1)
    } catch {
      throw new Error('No se pudo reclamar ninguna interfaz USB. Reiniciar la impresora y volver a intentar.')
    }
  }

  const encoder = new TextEncoder()
  const payload = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : encoder.encode(data)

  // Chunk size adaptativo
  let chunkSize = 512
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, Math.min(i + chunkSize, payload.length))
    try {
      await device.transferOut(1, chunk)
    } catch {
      // Si falla con 512, reintentar con 256
      if (chunkSize === 512) { chunkSize = 256; i -= chunkSize }
      else throw new Error('Error de comunicación USB. Reiniciar impresora.')
    }
  }

  await device.close()
  const detectedProtocol = detectProtocolFromVendor(device.vendorId)
  return { deviceName: device.productName || 'Impresora USB', vendorId: device.vendorId, protocol: detectedProtocol }
}

/**
 * Send ZPL (string) to USB printer
 * @param {string} zpl - ZPL data
 * @returns {Promise<{deviceName: string, vendorId: number, protocol: string}>}
 */
export async function sendZplToUsb(zpl) {
  return sendToUsbPrinter(zpl, 'zpl')
}

/**
 * Send ESC/POS (Blob) to USB printer
 * @param {Blob} blob - ESC/POS data blob
 * @returns {Promise<{deviceName: string, vendorId: number, protocol: string}>}
 */
export async function sendEscposToUsb(blob) {
  return sendToUsbPrinter(blob, 'escpos')
}

/* =================================================================
   WebSerial — puerto serial/COM
   ================================================================= */

/**
 * Request a serial port and send data
 * @param {string|Blob} data - Data to send
 * @param {object} [options] - Serial options
 * @param {number} [options.baudRate=9600]
 * @returns {Promise<string>} Port info
 */
export async function sendToSerialPort(data, options = {}) {
  if (!navigator.serial) throw new Error('WebSerial no soportado en este navegador. Use Chrome/Edge.')

  const port = await navigator.serial.requestPort()
  const baudRate = options.baudRate || 9600
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' })

  const encoder = new TextEncoder()
  const payload = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : encoder.encode(data)

  const writer = port.writable.getWriter()
  const chunkSize = 256
  for (let i = 0; i < payload.length; i += chunkSize) {
    await writer.write(payload.slice(i, Math.min(i + chunkSize, payload.length)))
  }
  writer.releaseLock()
  await port.close()
  return 'Puerto serial: datos enviados correctamente'
}

/**
 * Get available baud rates for WebSerial
 * @returns {number[]}
 */
export function getBaudRates() {
  return [9600, 19200, 38400, 57600, 115200]
}

/* =================================================================
   PNG
   ================================================================= */
function crc32(data) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) { crc ^= data[i]; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0) }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

async function canvasToPngBlob(canvas, dpi) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!dpi || dpi <= 0) return blob
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return blob
  const ppm = Math.round(dpi / 0.0254)
  const pHYsData = new Uint8Array(9)
  pHYsData[0] = (ppm >> 24) & 0xFF; pHYsData[1] = (ppm >> 16) & 0xFF
  pHYsData[2] = (ppm >> 8) & 0xFF; pHYsData[3] = ppm & 0xFF
  pHYsData[4] = (ppm >> 24) & 0xFF; pHYsData[5] = (ppm >> 16) & 0xFF
  pHYsData[6] = (ppm >> 8) & 0xFF; pHYsData[7] = ppm & 0xFF
  pHYsData[8] = 1
  const type = new TextEncoder().encode('pHYs')
  const crcInput = new Uint8Array(type.length + pHYsData.length)
  crcInput.set(type, 0); crcInput.set(pHYsData, type.length)
  const crcVal = crc32(crcInput)
  const chunkLen = pHYsData.length
  const chunk = new Uint8Array(4 + type.length + pHYsData.length + 4)
  chunk[0] = (chunkLen >> 24) & 0xFF; chunk[1] = (chunkLen >> 16) & 0xFF
  chunk[2] = (chunkLen >> 8) & 0xFF; chunk[3] = chunkLen & 0xFF
  chunk.set(type, 4); chunk.set(pHYsData, 8)
  chunk[17] = (crcVal >> 24) & 0xFF; chunk[18] = (crcVal >> 16) & 0xFF
  chunk[19] = (crcVal >> 8) & 0xFF; chunk[20] = crcVal & 0xFF
  const sigLen = 8
  const ihdrLength = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11]
  const insertAt = sigLen + 4 + 4 + ihdrLength + 4
  const result = new Uint8Array(bytes.length + chunk.length)
  result.set(bytes.subarray(0, insertAt), 0); result.set(chunk, insertAt); result.set(bytes.subarray(insertAt), insertAt + chunk.length)
  return new Blob([result], { type: 'image/png' })
}

export function renderLabelToCanvas(product, { labelSize = '3x2', includePrice = true, includeSku = true, dpi = 203, barcode = '', sku = '' } = {}) {
  const dim = getLabelDim(labelSize, dpi)
  const c = buildLabelContent(product, { includePrice, includeSku, barcode, sku })
  const pxW = Math.round(dim.widthIn * dpi); const pxH = Math.round(dim.heightIn * dpi)
  const margin = Math.round(pxW * 0.03); const usableW = pxW - margin * 2; const maxY = pxH - margin
  const canvas = document.createElement('canvas'); canvas.width = pxW; canvas.height = pxH
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pxW, pxH)
  let nameFs = Math.max(10, pxH * 0.065); let skuFs = Math.max(8, pxH * 0.045); let priceFs = Math.max(14, pxH * 0.085)
  const maxNameLines = dim.heightIn <= 1 ? 1 : 2
  let nameH = nameFs * 1.05 * maxNameLines; let skuH = c.sku ? skuFs * 1.1 : 0
  let priceH = (c.price > 0 && includePrice) ? priceFs * 1.3 : 0; let barH = Math.max(20, pxH * 0.18)
  let totalH = nameH + skuH + priceH + barH + margin * 2; let dropSku = false; let dropPrice = false
  if (totalH > maxY) {
    const s = maxY / totalH; nameFs = Math.max(7, nameFs * s); skuFs = Math.max(5, skuFs * s); priceFs = Math.max(10, priceFs * s)
    nameH = nameFs * 1.0 * maxNameLines; skuH = c.sku ? skuFs * 1.05 : 0; priceH = (c.price > 0 && includePrice) ? priceFs * 1.2 : 0
    barH = Math.max(14, barH * s); totalH = nameH + skuH + priceH + barH + margin * 1.5
  }
  if (totalH > maxY && c.sku) { dropSku = true; skuH = 0; totalH = nameH + priceH + barH + margin * 1.5 }
  if (totalH > maxY && c.price > 0) { dropPrice = true; priceH = 0; totalH = nameH + barH + margin * 1.5 }
  if (totalH > maxY) { nameFs = Math.max(6, nameFs - 1); nameH = nameFs * 0.9 * maxNameLines; barH = Math.max(10, barH - 2) }
  let y = margin + nameFs * 0.3; ctx.textAlign = 'center'; ctx.fillStyle = '#111827'
  ctx.font = `bold ${nameFs}px sans-serif`
  const nameLines = fitCanvasLines(ctx, c.name, usableW, maxNameLines)
  nameLines.forEach((line, index) => ctx.fillText(line, pxW / 2, y + index * nameFs * 0.9)); y += nameH
  if (c.sku && !dropSku) { ctx.font = `${skuFs}px sans-serif`; ctx.fillStyle = '#374151'; ctx.fillText('SKU: ' + c.sku, pxW / 2, y); y += skuH; ctx.fillStyle = '#111827' }
  if (c.price > 0 && includePrice && !dropPrice) { ctx.font = `bold ${priceFs}px sans-serif`; ctx.fillText('RD$ ' + c.price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), pxW / 2, y); y += priceH }
  const bc = buildCode128Bars(c.barcode)
  if (bc && bc.bars.length) {
    const barAvail = usableW > 6 ? usableW - 4 : usableW
    const layout = getBarcodeLayout(bc, barAvail)
    const startX = margin + 2 + Math.max(0, (barAvail - layout.totalWidth) / 2)
    const barY = Math.round(y); const barHH = Math.round(barH)
    for (const bar of bc.bars) {
      const x = Math.round(startX + layout.quietWidth + bar.x * layout.scale)
      ctx.fillRect(x, barY, Math.max(Math.round(bar.width * layout.scale), 1), barHH)
    }
    y = barY + barHH + Math.round(margin * 0.5)
  }
  const codeTextH = maxY - y
  if (codeTextH > 3) {
    const codeText = String(c.barcode).slice(0, 24)
    const maxFs = Math.min(pxH * 0.024, codeTextH * 0.8); let fs = maxFs
    ctx.font = 'bold ${fs}px monospace'
    while (fs > 3 && ctx.measureText(codeText).width > usableW) { fs -= 1; ctx.font = 'bold ${fs}px monospace' }
    ctx.fillText(codeText, pxW / 2, y + codeTextH * 0.5)
  }
  return canvas
}

export async function downloadLabelPng(canvas, filename = 'etiqueta.png', dpi = 203) {
  const blob = await canvasToPngBlob(canvas, dpi)
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
