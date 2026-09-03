import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import { ticketWarrantyBlocks } from './invoiceThermal'

const money = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
const num = (v) => money.format(v || 0)

function sanitize(v) {
  return String(v || '').trim()
}

function displayInvoiceNumber(invoice) {
  const n = String(invoice?.number || '')
  if (!n || n === 'SIN NCF') return 'BORRADOR'
  if (n.startsWith('SIN-NCF-')) return n.replace('SIN-NCF-', 'FAC-')
  return n
}

function isFiscalInvoice(invoice) {
  return Boolean(invoice?.ncf && invoice?.ncfType !== 'NO_FISCAL')
}

function paidAmount(invoice) {
  if (invoice?.paidAmount !== undefined) return Number(invoice.paidAmount || 0)
  return (invoice?.payments || []).filter((p) => p.method !== 'Credito').reduce((s, p) => s + Number(p.amount || 0), 0)
}

function balanceDue(invoice) {
  if (invoice?.balanceDue !== undefined) return Number(invoice.balanceDue || 0)
  return Math.max(Number(invoice?.totals?.total || 0) - paidAmount(invoice), 0)
}

function fileNamePart(invoice) {
  return String(displayInvoiceNumber(invoice)).replace(/[^a-zA-Z0-9-_]/g, '_') || 'factura'
}

async function fetchImageAsDataUrl(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) return null
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
    img.onerror = reject
    img.src = dataUrl
  })
}

export async function buildReceiptPdf({ invoice, company, customer, qrText = '', paperWidth = '80' } = {}) {
  const width = Math.max(40, Math.min(150, Number(paperWidth) || 80))
  const items = invoice?.items || []
  const hasQr = Boolean(qrText)
  // La garantia/devoluciones siempre se imprimen (texto por defecto si la empresa no define uno).
  // Dos parrafos en negrita: ~11 lineas + 2 titulos en papel 80 mm.
  const warrantyHeight = 52
  // Estimate height: base 70 + header 25 + factura 30 + cliente 25 + productos 12*items + totales 40 + qr 40 + warranty 20 + footer 20
  const base = 70
  const itemsHeight = items.length * 12 + 10
  const qrHeight = hasQr ? 45 : 0
  const estimated = base + itemsHeight + qrHeight + warrantyHeight + 60
  const height = Math.max(120, Math.min(600, estimated))

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, height], compress: true })
  const M = 4
  const contentW = width - M * 2
  let y = 6

  // Termica = solo negro puro. Grises/azules salen punteados y borrosos en 203 dpi.
  const COLORS = {
    primary: [0, 0, 0],
    accent: [0, 0, 0],
    muted: [0, 0, 0],
    light: [255, 255, 255],
    dark: [0, 0, 0],
  }

  function textCenter(str, size = 8, bold = false, color = COLORS.dark) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(String(str || ''), contentW)
    lines.forEach((line) => {
      doc.text(line, width / 2, y, { align: 'center' })
      y += size * 0.45
    })
  }

  function textLeft(str, size = 8, bold = false, color = COLORS.dark) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(String(str || ''), contentW)
    lines.forEach((line) => {
      doc.text(line, M, y)
      y += size * 0.45
    })
  }

  function textRight(str, size = 8, bold = false, color = COLORS.dark) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const line = String(str || '')
    doc.text(line, width - M, y, { align: 'right' })
    y += size * 0.45
  }

  function drawUnderline() {
    doc.setDrawColor(...COLORS.accent)
    doc.setLineWidth(0.3)
    doc.line(M, y, width - M, y)
    y += 3
  }

  function drawHeavyLine() {
    doc.setDrawColor(...COLORS.primary)
    doc.setLineWidth(0.5)
    doc.line(M, y, width - M, y)
    y += 3.5
  }

  function drawLightLine() {
    doc.setDrawColor(...COLORS.muted)
    doc.setLineWidth(0.2)
    doc.line(M, y, width - M, y)
    y += 3
  }

  function seal(textStr, color = COLORS.primary) {
    const h = 8
    const padY = 2
    doc.setFillColor(...color)
    doc.rect(M, y - 4, contentW, h, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    doc.text(String(textStr).toUpperCase(), width / 2, y + 1.5, { align: 'center' })
    y += h + padY
  }

  // Header — logo de la tienda centrado en su propia franja, con su aspecto
  // real (sin deformar) y separado del nombre para que no se encimen.
  if (company?.logoUrl) {
    try {
      const dataUrl = await fetchImageAsDataUrl(company.logoUrl)
      if (dataUrl) {
        const dims = await getImageDimensions(dataUrl).catch(() => null)
        const maxW = Math.min(38, contentW * 0.7)
        const maxH = 18
        let logoW = maxW
        let logoH = 12
        if (dims && dims.width > 0 && dims.height > 0) {
          logoH = Math.min(maxH, Math.max(8, maxW * (dims.height / dims.width)))
          logoW = Math.min(maxW, logoH / (dims.height / dims.width))
        }
        doc.addImage(dataUrl, 'PNG', (width - logoW) / 2, y, logoW, logoH, undefined, 'FAST')
        y += logoH + 3
      }
    } catch { /* sin logo: el nombre en negrita sigue identificando la tienda */ }
  }
  textCenter(sanitize(company?.name) || 'EMPRESA', 14, true, COLORS.primary)
  y += 1
  if (isFiscalInvoice(invoice) && company?.rnc) textCenter(`RNC: ${company.rnc}`, 6, false, COLORS.muted)
  // Cabecera del ticket: sin correo arriba (el correo solo va en el pie).
  const headerInfos = []
  if (company?.address) headerInfos.push(company.address)
  const contactParts = [company?.phone && `Tel: ${company.phone}`, company?.whatsapp && `WA: ${company.whatsapp}`].filter(Boolean)
  if (contactParts.length) headerInfos.push(contactParts.join(' | '))
  if (headerInfos.length) {
    const headerLine = headerInfos.join(' | ')
    const lines = doc.splitTextToSize(headerLine, contentW)
    lines.forEach((l) => textCenter(l, 6, false, COLORS.muted))
  }
  y += 2
  drawHeavyLine()

  // FACTURA
  textCenter('FACTURA', 11, true, COLORS.primary)
  textCenter(`No. ${displayInvoiceNumber(invoice)}`, 9, true, COLORS.dark)
  const bal = balanceDue(invoice)
  const paid = paidAmount(invoice)
  const isCreditMethod = (invoice?.payments || []).some((p) => String(p.method || '').toLowerCase().includes('credito')) || String(invoice?.paymentMethod || '').toLowerCase().includes('credito')
  let sealText = 'PAGADA'
  if (bal > 0) {
    if (paid > 0) sealText = 'PENDIENTE'
    else sealText = isCreditMethod ? 'CREDITO' : 'PENDIENTE'
  }
  y += 1
  seal(` ${sealText} `, COLORS.primary)
  if (invoice?.ncf) textCenter(`NCF: ${invoice.ncf}`, 7, false, COLORS.dark)
  const dateStr = (() => {
    const d = invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate
    try { return d ? new Date(d).toLocaleDateString('es-DO') : new Date().toLocaleDateString('es-DO') } catch { return '' }
  })()
  textCenter(`FECHA EMISION: ${dateStr}`, 8, true, COLORS.dark)
  drawLightLine()

  // Cliente
  textLeft('CLIENTE', 7, true, COLORS.primary)
  drawUnderline()
  textLeft(sanitize(customer?.name || invoice?.customerName || 'Consumidor final'), 8, true, COLORS.dark)
  const fiscal = isFiscalInvoice(invoice)
  const custDoc = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `CEDULA: ${customer.cedula}` : ''
  if (custDoc) textLeft(custDoc, 7, false, COLORS.muted)
  if (customer?.phone || customer?.whatsapp) textLeft(`Tel: ${customer.phone || customer.whatsapp}`, 7, true, COLORS.dark)
  y += 1
  drawLightLine()

  // Productos
  textLeft('PRODUCTOS', 7, true, COLORS.primary)
  drawUnderline()
  items.forEach((item, idx) => {
    const name = `${idx + 1}. ${item.name || 'Producto'}`
    textLeft(name, 7, true, COLORS.dark)
    const qtyPrice = `${item.quantity} x ${num(item.price || 0)}`
    const lineTotal = num((Number(item.net || 0) || 0) + (Number(item.tax || 0) || 0))
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COLORS.dark)
    doc.text(qtyPrice, M, y)
    doc.text(lineTotal, width - M, y, { align: 'right' })
    y += 3.5
    const serials = item.serials || (item.serial ? [item.serial] : [])
    serials.forEach((serial) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...COLORS.muted)
      doc.text(`SERIAL: ${serial}`, width - M, y, { align: 'right' })
      y += 3
    })
  })
  drawLightLine()

  // Totales
  const fiscalTotals = fiscal
  if (fiscalTotals && invoice?.totals?.taxableSubtotal) {
    textRight(`SUBTOTAL GRAVADO  ${num(invoice.totals.taxableSubtotal)}`, 7, false, COLORS.dark)
  }
  if (fiscalTotals && invoice?.totals?.exemptSubtotal) {
    textRight(`SUBTOTAL EXENTO  ${num(invoice.totals.exemptSubtotal)}`, 7, false, COLORS.dark)
  }
  if (fiscalTotals && invoice?.totals?.itbis) {
    textRight(`ITBIS 18%  ${num(invoice.totals.itbis)}`, 7, false, COLORS.dark)
  }
  textRight(`PAGADO  ${num(paidAmount(invoice))}`, 7, false, COLORS.dark)
  textRight(`PENDIENTE  ${num(balanceDue(invoice))}`, 7, false, COLORS.dark)
  y += 1
  // TOTAL invertido
  const totalStr = `TOTAL  ${num(invoice?.totals?.total || 0)}`
  seal(totalStr, COLORS.accent)
  drawHeavyLine()

  // Nota cliente
  if (invoice?.notesCustomer) {
    textLeft('NOTA', 7, true, COLORS.primary)
    drawUnderline()
    const lines = doc.splitTextToSize(String(invoice.notesCustomer), contentW)
    lines.forEach((l) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...COLORS.dark)
      doc.text(l, M, y)
      y += 3
    })
    drawLightLine()
  }

  // Garantía y devoluciones en párrafos separados, siempre impresas, antes del QR.
  for (const block of ticketWarrantyBlocks(company)) {
    textLeft(block.heading, 7, true, COLORS.primary)
    drawUnderline()
    const warrantyLines = doc.splitTextToSize(block.body, contentW)
    warrantyLines.forEach((l) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...COLORS.dark)
      doc.text(l, M, y)
      y += 3
    })
    y += 1.5
  }
  drawLightLine()

  // QR
  if (qrText) {
    try {
      const dataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1, errorCorrectionLevel: 'M' })
      const qrSize = Math.min(28, contentW * 0.6)
      const x = (width - qrSize) / 2
      doc.addImage(dataUrl, 'PNG', x, y, qrSize, qrSize)
      y += qrSize + 3
    } catch { /* QR generation failed - continue without image */ }
    textCenter('Escanea para verificar tu factura', 6, true, COLORS.dark)
    drawLightLine()
  }

  // Pie
  y += 2
  textCenter('¡Gracias por su compra!', 8, true, COLORS.primary)
  textCenter(sanitize(company?.name) || 'EMPRESA', 8, true, COLORS.dark)
  if (company?.phone || company?.whatsapp || company?.email) {
    const footContact = [company.phone && `Tel: ${company.phone}`, company.whatsapp && `WA: ${company.whatsapp}`, company.email].filter(Boolean).join(' | ')
    if (footContact) textCenter(footContact, 6, false, COLORS.muted)
  }

  // Ajustar altura si sobra mucho? jsPDF already has fixed height, we leave blank at bottom (paper feed)
  return doc
}

export async function downloadReceiptPdf(invoice, company, customer, qrText, paperWidth) {
  const doc = await buildReceiptPdf({ invoice, company, customer, qrText, paperWidth })
  const name = `factura-${fileNamePart(invoice)}.pdf`
  doc.save(name)
  return name
}

export async function buildTestReceiptPdf({ paperWidth = '80' } = {}) {
  const fakeInvoice = {
    number: 'PRUEBA-001',
    ncf: 'E310000000001',
    ncfType: 'E31',
    issuedAt: new Date().toISOString(),
    totals: { total: 118, taxableSubtotal: 100, exemptSubtotal: 0, itbis: 18, subtotal: 100 },
    items: [{ name: 'Producto Demo - Prueba PDF', quantity: 1, price: 100, net: 100, tax: 18 }],
    payments: [{ method: 'Efectivo', amount: 118 }],
    seller: 'Sistema',
  }
  const fakeCompany = { name: 'Empresa Demo', rnc: '000-00000-0', address: 'Calle Demo 123', phone: '809-000-0000', email: 'demo@empresa.do', warrantyText: 'Garantía de prueba 30 días.' }
  const fakeCustomer = { name: 'Cliente Prueba', rnc: '000-00000-0', phone: '809-111-2222' }
  return buildReceiptPdf({ invoice: fakeInvoice, company: fakeCompany, customer: fakeCustomer, qrText: `PRUEBA-PDF-${Date.now()}`, paperWidth })
}
