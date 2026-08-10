import { currency, formatDate } from './formatters'

const ESC = 0x1B
const GS = 0x1D

export const THERMAL_MODES = [
  { id: 'escpos', label: 'Termica directa (ESC/POS)', desc: 'Papel termico sensible al calor · Epson TM, Bixolon, Star, genericas' },
  { id: 'zpl', label: 'Transferencia termica (ZPL)', desc: 'Con cinta/tinta · Zebra, Xprinter, Rongta, 2connet' },
]

export const THERMAL_PROTOCOLS = [
  { id: 'escpos', label: 'ESC/POS', desc: 'Termica directa para tickets de factura — la mas universal' },
  { id: 'zpl', label: 'ZPL', desc: 'Transferencia termica para etiquetas y tickets de alto detalle' },
  { id: 'epl', label: 'EPL', desc: 'Lenguaje legacy de etiquetas para impresoras mas antiguas' },
  { id: 'tspl', label: 'TSPL', desc: 'Lenguaje de etiquetas con compatibilidad amplia' },
  { id: 'cpcl', label: 'CPCL', desc: 'Para impresoras portatiles y de etiquetas' },
]

export const THERMAL_CONNECTIONS = [
  { id: 'auto', label: 'Automatica', desc: 'Detecta impresora USB y aplica su protocolo real' },
  { id: 'usb', label: 'USB (WebUSB)', desc: 'Chrome/Edge · deteccion de marca automatica' },
  { id: 'serial', label: 'Serial / COM', desc: 'Puerto serie industrial (baud rate configurable)' },
  { id: 'bluetooth', label: 'Bluetooth', desc: 'Impresoras termicas portatiles BLE' },
  { id: 'file', label: 'Archivo', desc: 'Descarga .prn/.zpl/.epl/.tspl/.cpl para enviar por red o herramienta' },
]

export function thermalModeFromSettings(labelPrintMode) {
  if (labelPrintMode === 'zpl' || labelPrintMode === 'usb') return 'zpl'
  if (labelPrintMode === 'escpos-usb') return 'escpos'
  if (['escpos', 'epl', 'tspl', 'cpcl'].includes(labelPrintMode)) return labelPrintMode
  return 'escpos'
}

function textForLabel(value, maxChars) {
  return sanitizeThermalText(value).replace(/"/g, "'").slice(0, maxChars || 46)
}

function sanitizeThermalText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

function zplEscape(value) {
  return sanitizeThermalText(value).replace(/[\^~_\\]/g, (char) => `_${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function displayInvoiceNumber(invoice) {
  const number = String(invoice?.number || '')
  if (!number || number === 'SIN NCF') return 'BORRADOR'
  if (number.startsWith('SIN-NCF-')) return number.replace('SIN-NCF-', 'FAC-')
  return number
}

function isFiscalInvoice(invoice) {
  return Boolean(invoice?.ncf && invoice?.ncfType !== 'NO_FISCAL')
}

function paidAmount(invoice) {
  if (invoice?.paidAmount !== undefined) return Number(invoice.paidAmount || 0)
  return (invoice?.payments || []).filter((payment) => payment.method !== 'Credito').reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
}

function balanceDue(invoice) {
  if (invoice?.balanceDue !== undefined) return Number(invoice.balanceDue || 0)
  return Math.max(Number(invoice?.totals?.total || 0) - paidAmount(invoice), 0)
}

function wrapLines(str, cols) {
  const words = String(str || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (test.length <= cols) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word.length > cols ? word.slice(0, cols) : word
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 60)
}

function fileNamePart(invoice) {
  return sanitizeThermalText(displayInvoiceNumber(invoice)) || 'factura'
}

/* =================================================================
   ESC/POS — impresion termica directa (Epson TM, Bixolon, Star, generic)
   ================================================================= */

function pushQrEscpos(chunks, payload) {
  const data = new TextEncoder().encode(sanitizeThermalText(payload))
  const cmd = (...bytes) => chunks.push(new Uint8Array(bytes))
  cmd(GS, 0x28, 0x6B, 3, 0, 49, 0x41, 50, 0)
  cmd(GS, 0x28, 0x6B, 3, 0, 49, 0x43, 6, 0)
  cmd(GS, 0x28, 0x6B, 3, 0, 49, 0x45, 48, 0)
  const length = data.length + 2
  cmd(GS, 0x28, 0x6B, length & 0xFF, (length >> 8) & 0xFF, 49, 0x50)
  chunks.push(data)
  cmd(GS, 0x28, 0x6B, 3, 0, 49, 0x51, 48, 0)
}

export function buildInvoiceEscpos({ invoice, company, customer, qrText = '', paperWidth = '80', drawer = false, showBarcode = true, cut = 'full', drawerPulse = 60, logo = true, qrEnabled = true, bold = true, fontScale = 0, lineSpacing = 30, columns = '2' }) {
  const widthMm = Number(paperWidth) || 80
  const cols = widthMm >= 100 ? 64 : widthMm >= 75 ? 48 : 32
  const chunks = []
  const cmd = (...bytes) => chunks.push(new Uint8Array(bytes))
  const useBold = bold !== false
  const scaleValues = [0, 0x11, 0x22, 0x33]
  const text = (str, { align = 'left', bold = false, size = 'normal', scale = 0 } = {}) => {
    if (align === 'center') cmd(ESC, 0x61, 0x01)
    else if (align === 'right') cmd(ESC, 0x61, 0x02)
    else cmd(ESC, 0x61, 0x00)
    if (scale > 0) cmd(GS, 0x21, scaleValues[Math.min(scale, 3)] || 0)
    else if (size === 'lg') cmd(GS, 0x21, 0x11)
    else if (size === 'xl') cmd(GS, 0x21, 0x22)
    else cmd(GS, 0x21, 0x00)
    if (bold && useBold) cmd(ESC, 0x45, 0x01)
    chunks.push(new TextEncoder().encode(sanitizeThermalText(str).slice(0, cols * 8) + '\n'))
    cmd(ESC, 0x45, 0x00)
    cmd(GS, 0x21, 0x00)
    cmd(ESC, 0x61, 0x00)
  }
  const separator = (char = '-') => chunks.push(new TextEncoder().encode(sanitizeThermalText(char).slice(0, cols).padEnd(cols, char || '-').slice(0, cols) + '\n'))

  cmd(ESC, 0x40)
  if (lineSpacing) cmd(ESC, 0x33, Math.min(255, Math.max(20, Number(lineSpacing) || 30)))
  if (logo) text(company?.name || 'EMPRESA', { align: 'center', bold: true, size: 'xl', scale: fontScale })
  if (isFiscalInvoice(invoice) && company?.rnc) text(`RNC: ${company.rnc}`, { align: 'center' })
  if (company?.address) text(company.address, { align: 'center' })
  if (company?.phone || company?.whatsapp) text([company.phone && `Tel: ${company.phone}`, company.whatsapp && `WA: ${company.whatsapp}`].filter(Boolean).join(' | '), { align: 'center' })
  if (company?.email) text(company.email, { align: 'center' })
  separator()

  text('FACTURA', { align: 'center', bold: true, size: 'lg', scale: fontScale })
  text(`No. ${displayInvoiceNumber(invoice)}`, { align: 'center', bold: true })
  const barcodeNumber = displayInvoiceNumber(invoice)
  if (showBarcode && barcodeNumber !== 'BORRADOR') {
    const barcodeBytes = new TextEncoder().encode(sanitizeThermalText(barcodeNumber))
    if (barcodeBytes.length) {
      cmd(GS, 0x68, 100)
      cmd(GS, 0x48, 64)
      cmd(GS, 0x6B, 73, barcodeBytes.length)
      chunks.push(barcodeBytes)
    }
  }
  if (invoice?.ncf) text(`NCF: ${invoice.ncf}`, { align: 'center' })
  text(formatDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate), { align: 'center' })
  separator()

  text(`CLIENTE: ${customer?.name || invoice?.customerName || 'Consumidor final'}`, { bold: true })
  const fiscal = isFiscalInvoice(invoice)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (customerDocument) text(customerDocument)
  if (customer?.phone || customer?.whatsapp) text(`Tel: ${customer.phone || customer.whatsapp}`)
  if (invoice?.seller) text(`VENDEDOR: ${invoice.seller}`)
  separator()

  const items = invoice?.items || []
  items.forEach((item, index) => {
    for (const line of wrapLines(`${index + 1}. ${item.name || 'Producto'}`, cols - 8)) text(line)
    const qtyPrice = `${item.quantity} x ${currency.format(item.price || 0)}`
    const lineTotal = currency.format((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))
    if (columns === '3') {
      text(qtyPrice, { align: 'left' })
      text(`${'Subtotal'.padEnd(cols - 8)}${lineTotal}`, { align: 'right' })
    } else {
      const detailPadded = qtyPrice.padEnd(cols - 14 - lineTotal.length)
      text(`${detailPadded}${lineTotal}`, { align: 'right' })
    }
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => text(`SERIAL: ${serial}`, { align: 'right' }))
  })
  separator()

  if (fiscal && invoice?.totals?.taxableSubtotal) text(`${'SUBTOTAL GRAVADO'.padEnd(cols - 8)}${currency.format(invoice.totals.taxableSubtotal)}`, { align: 'right' })
  if (fiscal && invoice?.totals?.exemptSubtotal) text(`${'SUBTOTAL EXENTO'.padEnd(cols - 8)}${currency.format(invoice.totals.exemptSubtotal)}`, { align: 'right' })
  if (fiscal && invoice?.totals?.itbis) text(`${'ITBIS 18%'.padEnd(cols - 8)}${currency.format(invoice.totals.itbis)}`, { align: 'right' })
  text(`${'PAGADO'.padEnd(cols - 8)}${currency.format(paidAmount(invoice))}`, { align: 'right' })
  text(`${'PENDIENTE'.padEnd(cols - 8)}${currency.format(balanceDue(invoice))}`, { align: 'right' })
  text(`${'TOTAL'.padEnd(cols - 10)}${currency.format(invoice?.totals?.total || 0)}`, { align: 'right', bold: true, size: 'lg', scale: fontScale })
  separator('=')

  if (qrEnabled && qrText) pushQrEscpos(chunks, qrText)
  if (qrEnabled) text('Escanee el QR para validar', { align: 'center' })
  separator()

  if (company?.warrantyText) {
    for (const line of wrapLines(company.warrantyText, cols - 6)) text(line)
    separator()
  }
  text(company?.name || 'EMPRESA', { align: 'center', bold: true })
  const endBytes = [10, 10, 10]
  if (drawer) {
    const pulse = Math.min(255, Math.max(10, Number(drawerPulse) || 60))
    endBytes.push(ESC, 0x70, 0x00, pulse, 240)
  }
  if (cut !== 'none') endBytes.push(GS, 0x56, cut === 'partial' ? 66 : 65)
  chunks.push(new Uint8Array(endBytes))
  return new Blob(chunks, { type: 'application/octet-stream' })
}

/* =================================================================
   ZPL — impresion por transferencia termica (Zebra, Xprinter, Rongta)
   ================================================================= */

export function buildInvoiceZpl({ invoice, company, customer, qrText = '' }) {
  const width = 800
  const items = invoice?.items || []
  const estimatedHeight = Math.min(2200, 660 + items.length * 58 + (qrText ? 300 : 0))
  const lines = []
  let y = 24
  const push = (text) => lines.push(text)
  const separator = () => {
    push(`^FO16,${y}^GB768,2,2^FS`)
    y += 12
  }
  const field = (text, { size = 26, bold = false, align = 'left', width = 768, maxLines = 3 } = {}) => {
    const safe = zplEscape(text)
    const charsPerLine = Math.max(1, Math.floor(width / (size * 0.62)))
    const usedLines = Math.max(1, Math.min(maxLines, Math.ceil(safe.length / charsPerLine)))
    const x = align === 'center' ? Math.round((width - 768) / 2 + 16) : align === 'right' ? 784 - width : 16
    push(`^FO${x},${y}`)
    push(`^A${bold ? '2' : '0'}N,${size},${size}`)
    push(`^FB${width},${maxLines},0,${align === 'center' ? 'C' : align === 'right' ? 'R' : 'L'}`)
    push(`^FD${safe}^FS`)
    y += usedLines * size + 8
  }
  const centered = (text, size, bold = false) => field(text, { size, bold, align: 'center', width: 768, maxLines: 2 })

  push('^XA')
  push(`^PW${width}`)
  push(`^LL${estimatedHeight}`)

  centered(company?.name || 'EMPRESA', 46, true)
  if (isFiscalInvoice(invoice) && company?.rnc) centered(`RNC: ${company.rnc}`, 24)
  if (company?.address) centered(company.address, 22, false)
  if (company?.phone || company?.whatsapp) centered([company.phone && `Tel: ${company.phone}`, company.whatsapp && `WA: ${company.whatsapp}`].filter(Boolean).join(' | '), 22)
  if (company?.email) centered(company.email, 22)
  separator()

  centered('FACTURA', 40, true)
  centered(`No. ${displayInvoiceNumber(invoice)}`, 26, true)
  const barcodeNumber = zplEscape(displayInvoiceNumber(invoice))
  if (barcodeNumber && barcodeNumber !== 'BORRADOR') {
    push(`^FO${Math.round((width - 360) / 2)},${y}^BY3^BXN,80,220,N,N`)
    push(`^FD${barcodeNumber}^FS`)
    y += 108
  }
  if (invoice?.ncf) centered(`NCF: ${invoice.ncf}`, 24)
  centered(formatDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate), 24)
  separator()

  field(`CLIENTE: ${customer?.name || invoice?.customerName || 'Consumidor final'}`, { size: 26, bold: true })
  const fiscal = isFiscalInvoice(invoice)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (customerDocument) field(customerDocument, { size: 24 })
  if (customer?.phone || customer?.whatsapp) field(`Tel: ${customer.phone || customer.whatsapp}`, { size: 24 })
  if (invoice?.seller) field(`VENDEDOR: ${invoice.seller}`, { size: 24 })
  separator()

  items.forEach((item, index) => {
    field(`${index + 1}. ${item.name || 'Producto'}`, { size: 26, maxLines: 2 })
    field(`${item.quantity} x ${currency.format(item.price || 0)}     ${currency.format((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))}`, { size: 24, align: 'right', width: 768, maxLines: 1 })
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => field(`SERIAL: ${serial}`, { size: 22, align: 'right', width: 700, maxLines: 1 }))
  })
  separator()

  const totalLine = (label, value, size = 24, bold = false) => field(`${label.padEnd(26, '.')}${value}`, { size, bold, align: 'right', width: 768, maxLines: 1 })
  if (fiscal && invoice?.totals?.taxableSubtotal) totalLine('SUBTOTAL GRAVADO', currency.format(invoice.totals.taxableSubtotal))
  if (fiscal && invoice?.totals?.exemptSubtotal) totalLine('SUBTOTAL EXENTO', currency.format(invoice.totals.exemptSubtotal))
  if (fiscal && invoice?.totals?.itbis) totalLine('ITBIS 18%', currency.format(invoice.totals.itbis))
  totalLine('PAGADO', currency.format(paidAmount(invoice)))
  totalLine('PENDIENTE', currency.format(balanceDue(invoice)))
  totalLine('TOTAL', currency.format(invoice?.totals?.total || 0), 34, true)
  separator('=')

  if (qrText) {
    field('', { size: 8 })
    push(`^FO${Math.round((width - 240) / 2)},${y}^BQN,2,6`)
    push(`^FH^FDMM,A${zplEscape(qrText)}^FS`)
    y += 250
    centered('Escanee el QR para validar', 20)
    separator()
  }

  if (company?.warrantyText) {
    field(company.warrantyText, { size: 22, maxLines: 8 })
    separator()
  }
  centered(company?.name || 'EMPRESA', 24, true)
  push('^XZ')
  return lines.join('\n')
}

const THERMAL_FILE_EXTENSIONS = { escpos: 'prn', zpl: 'zpl', epl: 'epl', tspl: 'tspl', cpcl: 'cpl' }

export function downloadThermalFile(invoice, data, mode) {
  const extension = THERMAL_FILE_EXTENSIONS[mode] || 'prn'
  const filename = `factura-${fileNamePart(invoice)}.${extension}`
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain;charset=utf-8' }) : data
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/* =================================================================
   Paginas de prueba termica
   ================================================================= */

export function buildThermalTestEscpos({ paperWidth = '80' } = {}) {
  const cols = paperWidth === '58' ? 32 : 48
  const chunks = []
  const cmd = (...bytes) => chunks.push(new Uint8Array(bytes))
  const text = (str, { align = 'left', bold = false, size = 'normal' } = {}) => {
    if (align === 'center') cmd(ESC, 0x61, 0x01)
    else if (align === 'right') cmd(ESC, 0x61, 0x02)
    else cmd(ESC, 0x61, 0x00)
    if (size === 'lg') cmd(GS, 0x21, 0x11)
    else if (size === 'xl') cmd(GS, 0x21, 0x22)
    else cmd(GS, 0x21, 0x00)
    if (bold) cmd(ESC, 0x45, 0x01)
    chunks.push(new TextEncoder().encode(sanitizeThermalText(str).slice(0, cols * 8) + '\n'))
    cmd(ESC, 0x45, 0x00)
    cmd(GS, 0x21, 0x00)
    cmd(ESC, 0x61, 0x00)
  }
  cmd(ESC, 0x40)
  text('PRUEBA DE IMPRESION TERMICA', { align: 'center', bold: true, size: 'xl' })
  text('Si puede leer este texto, la impresora', { align: 'center' })
  text('esta configurada correctamente.', { align: 'center' })
  cmd(GS, 0x68, 100)
  cmd(GS, 0x48, 64)
  const testBarcode = new TextEncoder().encode('PRUEBA-TERMICA-123')
  cmd(GS, 0x6B, 73, testBarcode.length)
  chunks.push(testBarcode)
  text('', {})
  text(`Fecha: ${new Date().toLocaleString()}`, { align: 'center' })
  text('Directa: papel termico sin cinta', { align: 'center' })
  text('Transferencia: usa cinta/tinta', { align: 'center' })
  text('', {})
  pushQrEscpos(chunks, `PRUEBA-TERMICA-${Date.now()}`)
  text('Escanee el QR', { align: 'center' })
  const endBytes = [10, 10, 10, ESC, 0x70, 0x00, 60, 240, GS, 0x56, 0x00]
  chunks.push(new Uint8Array(endBytes))
  return new Blob(chunks, { type: 'application/octet-stream' })
}

export function buildThermalTestZpl({ width = 800 } = {}) {
  const lines = []
  let y = 24
  const push = (text) => lines.push(text)
  const centered = (text, size, bold = false) => {
    push(`^FO16,${y}`)
    push(`^A${bold ? '2' : '0'}N,${size},${size}`)
    push(`^FB768,2,0,C`)
    push(`^FD${zplEscape(text)}^FS`)
    y += size * 2 + 8
  }
  push('^XA')
  push(`^PW${width}`)
  push('^LL640')
  centered('PRUEBA DE IMPRESION', 46, true)
  centered('Si puede leer este texto, la impresora esta configurada correctamente.', 24)
  push(`^FO${Math.round((width - 300) / 2)},${y}^BY3^BXN,80,220,N,N`)
  push('^FDPRUEBA-TERMICA-123^FS')
  y += 110
  centered(`Fecha: ${new Date().toLocaleString()}`, 24)
  centered('Directa: papel termico sin cinta', 22)
  centered('Transferencia: usa cinta/tinta', 22)
  push(`^FO${Math.round((width - 240) / 2)},${y}^BQN,2,6`)
  push(`^FH^FDMM,A${zplEscape(`PRUEBA-TERMICA-${Date.now()}`)}^FS`)
  y += 260
  centered('Escanee el QR', 22)
  push('^XZ')
  return lines.join('\n')
}

/* =================================================================
   EPL2 — Zebra legacy (LP2824+, GK420, TLP2844)
   ================================================================= */

export function buildInvoiceEpl({ invoice, company, customer, qrText = '' }) {
  const items = invoice?.items || []
  const lines = ['N']
  let y = 40
  const text = (value, size = 2, bold = false) => {
    lines.push(`A30,${y},0,${bold ? 4 : size},1,1,N,"${textForLabel(value, 40)}"`)
    y += size * 28 + 14
  }
  const centered = (value, size = 2, bold = false) => {
    lines.push(`A320,${y},0,${bold ? 4 : size},1,1,C,"${textForLabel(value, 36)}"`)
    y += size * 28 + 14
  }
  const fiscal = isFiscalInvoice(invoice)
  centered(company?.name || 'EMPRESA', 4, true)
  if (fiscal && company?.rnc) centered(`RNC: ${company.rnc}`, 2)
  if (company?.address) centered(company.address, 1)
  if (company?.phone) centered(`Tel: ${company.phone}`, 1)
  lines.push('LO30,10,740,2')
  y += 10
  centered('FACTURA', 3, true)
  centered(`No. ${displayInvoiceNumber(invoice)}`, 2)
  const barcodeNumber = textForLabel(displayInvoiceNumber(invoice), 30)
  if (barcodeNumber !== 'BORRADOR') {
    lines.push(`B280,${y},0,1,2,2,70,B,"${barcodeNumber}"`)
    y += 96
  }
  if (invoice?.ncf) centered(`NCF: ${invoice.ncf}`, 2)
  centered(formatDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate), 1)
  lines.push('LO30,20,740,2')
  y += 10
  text(`CLIENTE: ${customer?.name || invoice?.customerName || 'Consumidor final'}`, 2, true)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (customerDocument) text(customerDocument, 1)
  if (invoice?.seller) text(`VENDEDOR: ${invoice.seller}`, 1)
  items.forEach((item, index) => {
    text(`${index + 1}. ${item.name || 'Producto'}`, 2, true)
    text(`${item.quantity} x ${currency.format(item.price || 0)} = ${currency.format((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))}`, 1)
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => text(`SERIAL: ${serial}`, 1))
  })
  lines.push('LO30,10,740,2')
  y += 10
  const totalLine = (label, value, size = 1, bold = false) => {
    const padded = textForLabel(label, 26).padEnd(30, '.')
    lines.push(`A750,${y},0,${bold ? 4 : size},1,1,R,"${textForLabel(`${padded}${value}`, 34)}"`)
    y += size * 24 + 10
  }
  if (fiscal && invoice?.totals?.itbis) totalLine('ITBIS 18%', currency.format(invoice.totals.itbis))
  totalLine('PAGADO', currency.format(paidAmount(invoice)))
  totalLine('PENDIENTE', currency.format(balanceDue(invoice)))
  totalLine('TOTAL', currency.format(invoice?.totals?.total || 0), 2, true)
  if (qrText) {
    y += 14
    lines.push(`b8,300,${y},2,2,5,"${textForLabel(qrText, 220)}"`)
    y += 90
    lines.push(`A400,${y},0,1,1,1,C,"Escanee el QR"`)
    y += 30
  }
  if (company?.warrantyText) text(company.warrantyText, 1)
  centered(company?.name || 'EMPRESA', 2, true)
  lines.push(`Q${Math.ceil(y / 10) + 60},024`)
  lines.push('P1')
  lines.push('C')
  return lines.join('\n')
}

export function buildTestEpl() {
  return ['N', 'A200,40,0,4,1,1,C,"PRUEBA DE IMPRESION"', 'A100,110,0,2,1,1,C,"Impresora EPL2 configurada correctamente"', 'B280,180,0,1,2,2,70,B,"PRUEBA-EPL-123"', 'b8,280,330,2,2,5,"PRUEBA-EPL"', 'Q420,024', 'P1', 'C'].join('\n')
}

/* =================================================================
   TSPL — TSC, Printronix Auto ID
   ================================================================= */

export function buildInvoiceTspl({ invoice, company, customer, qrText = '' }) {
  const items = invoice?.items || []
  const lines = ['SIZE 80 mm,120 mm', 'GAP 2 mm,0', 'DIRECTION 1', 'CLS']
  let y = 30
  const text = (value, size = 24, bold = false) => {
    lines.push(`TEXT 40,${y},"${bold ? 'TSS32.BF2' : 'TSS24.BF'}",0,1,1,"${textForLabel(value, 42)}"`)
    y += size + 8
  }
  const centered = (value, size = 30, bold = false) => {
    lines.push(`TEXT 80,${y},"${bold ? 'TSS32.BF2' : 'TSS24.BF'}",0,2,1,"${textForLabel(value, 38)}"`)
    y += size + 8
  }
  const fiscal = isFiscalInvoice(invoice)
  centered(company?.name || 'EMPRESA', 36, true)
  if (fiscal && company?.rnc) centered(`RNC: ${company.rnc}`, 22)
  if (company?.address) centered(company.address, 20)
  centered('FACTURA', 30, true)
  centered(`No. ${displayInvoiceNumber(invoice)}`, 24)
  const barcodeNumber = textForLabel(displayInvoiceNumber(invoice), 30)
  if (barcodeNumber !== 'BORRADOR') {
    lines.push(`BARCODE 160,${y},"128",90,1,0,2,2,"${barcodeNumber}"`)
    y += 100
  }
  if (invoice?.ncf) centered(`NCF: ${invoice.ncf}`, 22)
  centered(formatDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate), 20)
  y += 6
  text(`CLIENTE: ${customer?.name || invoice?.customerName || 'Consumidor final'}`, 22, true)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (customerDocument) text(customerDocument, 20)
  if (invoice?.seller) text(`VENDEDOR: ${invoice.seller}`, 20)
  items.forEach((item, index) => {
    text(`${index + 1}. ${item.name || 'Producto'}`, 22, true)
    text(`${item.quantity} x ${currency.format(item.price || 0)} = ${currency.format((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))}`, 20)
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => text(`SERIAL: ${serial}`, 18))
  })
  y += 8
  const totalLine = (label, value, size = 20, bold = false) => {
    const padded = textForLabel(label, 26).padEnd(28, '.')
    lines.push(`TEXT 400,${y},"${bold ? 'TSS32.BF2' : 'TSS24.BF'}",0,2,1,"${textForLabel(`${padded}${value}`, 34)}"`)
    y += size + 8
  }
  if (fiscal && invoice?.totals?.itbis) totalLine('ITBIS 18%', currency.format(invoice.totals.itbis))
  totalLine('PAGADO', currency.format(paidAmount(invoice)))
  totalLine('PENDIENTE', currency.format(balanceDue(invoice)))
  totalLine('TOTAL', currency.format(invoice?.totals?.total || 0), 30, true)
  if (qrText) {
    y += 12
    lines.push(`QRCODE 300,${y},M,4,A,0,"${textForLabel(qrText, 220)}"`)
    y += 200
    lines.push('TEXT 160,300,"TSS24.BF",0,1,1,"Escanee el QR"')
    y += 40
  }
  if (company?.warrantyText) text(company.warrantyText, 18)
  centered(company?.name || 'EMPRESA', 22, true)
  lines.push('PRINT 1')
  return lines.join('\n')
}

export function buildTestTspl() {
  return ['SIZE 80 mm,100 mm', 'GAP 2 mm,0', 'DIRECTION 1', 'CLS', 'TEXT 120,30,"TSS32.BF2",0,2,1,"PRUEBA DE IMPRESION"', 'TEXT 60,90,"TSS24.BF",0,1,1,"Impresora TSPL configurada correctamente"', 'BARCODE 160,170,"128",90,1,0,2,2,"PRUEBA-TSPL-123"', 'QRCODE 300,170,M,4,A,0,"PRUEBA-TSPL"', 'PRINT 1'].join('\n')
}

/* =================================================================
   CPCL — Honeywell, Intermec, Citizen, portatiles
   ================================================================= */

export function buildInvoiceCpcl({ invoice, company, customer, qrText = '' }) {
  const items = invoice?.items || []
  const lines = ['! 0 200 200 800 1']
  let y = 24
  const text = (value, size = 3) => {
    lines.push(`TEXT ${size} 0 30 ${y} ${textForLabel(value, 44)}`)
    y += size * 22 + 8
  }
  const centered = (value, size = 3) => {
    lines.push('CENTER')
    lines.push(`TEXT ${size} 0 30 ${y} ${textForLabel(value, 40)}`)
    lines.push('CENTER')
    y += size * 22 + 8
  }
  const fiscal = isFiscalInvoice(invoice)
  centered(company?.name || 'EMPRESA', 5)
  if (fiscal && company?.rnc) centered(`RNC: ${company.rnc}`, 2)
  if (company?.address) centered(company.address, 2)
  centered('FACTURA', 4)
  centered(`No. ${displayInvoiceNumber(invoice)}`, 2)
  const barcodeNumber = textForLabel(displayInvoiceNumber(invoice), 30)
  if (barcodeNumber !== 'BORRADOR') {
    lines.push(`BARCODE 30 ${y} 128 1 1 80 3 ${barcodeNumber}`)
    y += 100
  }
  if (invoice?.ncf) centered(`NCF: ${invoice.ncf}`, 2)
  centered(formatDate(invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate), 2)
  text(`CLIENTE: ${customer?.name || invoice?.customerName || 'Consumidor final'}`, 3)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (customerDocument) text(customerDocument, 2)
  if (invoice?.seller) text(`VENDEDOR: ${invoice.seller}`, 2)
  items.forEach((item, index) => {
    text(`${index + 1}. ${item.name || 'Producto'}`, 3)
    text(`${item.quantity} x ${currency.format(item.price || 0)} = ${currency.format((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))}`, 2)
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => text(`SERIAL: ${serial}`, 2))
  })
  const totalLine = (label, value, size = 2) => {
    const padded = textForLabel(label, 22).padEnd(26, '.')
    lines.push(`TEXT ${size + 1} 0 500 ${y} ${textForLabel(`${padded}${value}`, 32)}`)
    y += (size + 1) * 22 + 6
  }
  if (fiscal && invoice?.totals?.itbis) totalLine('ITBIS 18%', currency.format(invoice.totals.itbis))
  totalLine('PAGADO', currency.format(paidAmount(invoice)))
  totalLine('PENDIENTE', currency.format(balanceDue(invoice)))
  totalLine('TOTAL', currency.format(invoice?.totals?.total || 0), 3)
  if (qrText) {
    y += 10
    lines.push(`QR 3 30 ${y} 50 M 1 "${textForLabel(qrText, 220)}"`)
    y += 130
    centered('Escanee el QR', 2)
  }
  if (company?.warrantyText) text(company.warrantyText, 2)
  centered(company?.name || 'EMPRESA', 3)
  lines.push('FORM')
  lines.push('PRINT')
  return lines.join('\n')
}

export function buildTestCpcl() {
  return ['! 0 200 200 800 1', 'CENTER', 'TEXT 4 0 30 24 PRUEBA DE IMPRESION', 'CENTER', 'TEXT 2 0 30 80 Impresora CPCL configurada correctamente', 'BARCODE 30 150 128 1 1 80 3 PRUEBA-CPCL-123', 'QR 3 30 250 50 M 1 "PRUEBA-CPCL"', 'FORM', 'PRINT'].join('\n')
}
