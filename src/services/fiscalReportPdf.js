import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { buildFiscalBuckets, invoiceModes } from '../lib/taxEngine'

const money = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
const dateTime = new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' })

export const fiscalReportTypes = {
  taxed: {
    id: 'taxed',
    mode: invoiceModes.TAXED,
    title: 'VENTAS CON ITBIS',
    file: 'ventas-con-itbis',
    accent: [37, 99, 235],
    description: 'Reporte fiscal independiente de ventas gravadas con ITBIS.',
  },
  noTax: {
    id: 'noTax',
    mode: invoiceModes.NO_TAX,
    title: 'VENTAS SIN ITBIS',
    file: 'ventas-sin-itbis',
    accent: [16, 185, 129],
    description: 'Reporte fiscal independiente de ventas exentas o no gravadas.',
  },
  mixed: {
    id: 'mixed',
    mode: invoiceModes.MIXED,
    title: 'VENTAS MIXTAS',
    file: 'ventas-mixtas',
    accent: [100, 116, 139],
    description: 'Reporte fiscal independiente de facturas con lineas gravadas y exentas.',
  },
}

export function buildFiscalReportGroups(invoices) {
  const active = invoices.filter((invoice) => invoice.status !== 'voided')
  const buckets = buildFiscalBuckets(active)
  return Object.values(fiscalReportTypes).map((type) => {
    const groupInvoices = active.filter((invoice) => invoice.mode === type.mode)
    const split = cashCreditSplit(groupInvoices)
    return {
      ...type,
      bucket: buckets[type.id],
      invoices: groupInvoices,
      items: groupInvoices.flatMap(invoiceToItemRows),
      customers: uniqueCount(groupInvoices.map((invoice) => invoice.customerId || invoice.customerName)),
      payments: summarizePayments(groupInvoices),
      products: summarizeProducts(groupInvoices),
      cashCreditSplit: split,
    }
  })
}

function cashCreditSplit(invoices) {
  let cashTotal = 0, creditTotal = 0, cashCount = 0, creditCount = 0
  let creditPaid = 0, creditPending = 0
  invoices.forEach((inv) => {
    const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
    const hasCredit = payments.some((p) => isCreditPayment(p.method))
    const total = Number(inv.totals?.total || 0)
    const paid = Number(inv.paidAmount || 0)
    if (hasCredit) {
      creditTotal += total
      creditCount += 1
      creditPaid += paid
      creditPending += inv.balanceDue != null ? Math.max(0, Number(inv.balanceDue)) : Math.max(0, total - paid)
    } else {
      cashTotal += total
      cashCount += 1
    }
  })
  return { cashTotal, creditTotal, cashCount, creditCount, creditPaid, creditPending }
}

function isCreditPayment(method = '') {
  const m = String(method || '').toLowerCase()
  return m.includes('credito') || m.includes('crédito')
}

export async function downloadFiscalReportPdf({ company, group }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const generatedAt = new Date()
  const groupWithSplit = { ...group, cashCreditSplit: group.cashCreditSplit || cashCreditSplit(group.invoices || []) }
  const qr = await QRCode.toDataURL(JSON.stringify({
    company: company?.name || 'Trifusion Technologies',
    report: groupWithSplit.title,
    generatedAt: generatedAt.toISOString(),
    invoices: groupWithSplit.invoices.length,
    total: groupWithSplit.bucket.total,
  }), { margin: 1, width: 96 })

  drawCover(doc, company, groupWithSplit, generatedAt, qr)
  doc.addPage()
  drawSummary(doc, company, groupWithSplit, generatedAt, qr)
  doc.addPage()
  drawInvoiceTable(doc, company, groupWithSplit, generatedAt, qr)
  doc.addPage()
  drawItemTable(doc, company, groupWithSplit, generatedAt, qr)
  addPageFooters(doc, company, groupWithSplit, generatedAt, qr)
  doc.save(`${groupWithSplit.file}-${stamp(generatedAt)}.pdf`)
}

export async function downloadAllFiscalReportPdfs({ company, invoices }) {
  const groups = buildFiscalReportGroups(invoices)
  for (const group of groups) {
    await downloadFiscalReportPdf({ company, group })
  }
}

function drawCover(doc, company, group, generatedAt, qr) {
  const [r, g, b] = group.accent
  doc.setFillColor(10, 10, 15)
  doc.rect(0, 0, 297, 210, 'F')
  doc.setFillColor(r, g, b)
  doc.rect(0, 0, 297, 16, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.text(group.title, 18, 54)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text(group.description, 18, 65)
  doc.text(company?.name || 'Trifusion Technologies', 18, 82)
  doc.text(`RNC: ${company?.rnc || 'N/A'}  |  Tel: ${company?.phone || company?.whatsapp || 'N/A'}`, 18, 90)
  doc.text(company?.address || 'Reporte fiscal generado por el sistema ERP', 18, 98)
  drawMetricCards(doc, group, 18, 120)
  doc.addImage(qr, 'PNG', 248, 142, 28, 28)
  doc.setFontSize(9)
  doc.text(`Generado: ${dateTime.format(generatedAt)}`, 18, 184)
  doc.text('Firma digital y sello empresarial generados automaticamente por Trifusion ERP Fiscal.', 18, 192)
}

function drawSummary(doc, company, group, generatedAt, qr) {
  drawHeader(doc, company, group, generatedAt, qr)
  drawMetricCards(doc, group, 12, 30)
  const split = group.cashCreditSplit || {}
  const bodyRows = group.id === 'noTax'
    ? [
        ['Cantidad de facturas', String(group.bucket.count)],
        ['Clientes unicos', String(group.customers)],
        ['Productos vendidos', String(group.items.reduce((sum, item) => sum + item.cantidad, 0))],
        ['Total Bruto', money.format(group.bucket.total)],
        ['Al Contado Neto', money.format(split.cashTotal || 0)],
        ['A Credito Neto', money.format(split.creditTotal || 0)],
        ['Cobrado de Creditos', money.format(split.creditPaid || 0)],
        ['Pendiente de Creditos', money.format(split.creditPending || 0)],
      ]
    : [
        ['Cantidad de facturas', String(group.bucket.count)],
        ['Clientes unicos', String(group.customers)],
        ['Productos vendidos', String(group.items.reduce((sum, item) => sum + item.cantidad, 0))],
        ['Subtotal', money.format(group.bucket.subtotal)],
        ['ITBIS total', money.format(group.bucket.itbis)],
        ['Total final', money.format(group.bucket.total)],
        ['Ganancia calculada', money.format(group.bucket.profit)],
      ]
  autoTable(doc, {
    startY: 74,
    head: [['Indicador', 'Valor']],
    body: bodyRows,
    styles: tableStyle(),
    headStyles: headStyle(group),
    alternateRowStyles: { fillColor: [247, 249, 252] },
  })
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 12,
    head: [['Metodo de pago', 'Facturas', 'Total']],
    body: group.payments.map((row) => [row.method, row.count, money.format(row.total)]),
    styles: tableStyle(),
    headStyles: headStyle(group),
  })
}

function drawInvoiceTable(doc, company, group, generatedAt, qr) {
  drawHeader(doc, company, group, generatedAt, qr)
  autoTable(doc, {
    startY: 28,
    head: [['Fecha', 'Factura', 'NCF', 'Cliente', 'RNC/Cedula', 'Pago', 'Vendedor', 'Subtotal', 'ITBIS', 'Total']],
    body: group.invoices.map((invoice) => [
      shortDate(invoice.issuedAt || invoice.createdAt || invoice.issueDate),
      invoice.number || '',
      invoice.ncf || invoice.ncfType || '',
      invoice.customerName || '',
      invoice.customerRnc || invoice.customerDocument || '',
      paymentText(invoice),
      invoice.seller || '',
      money.format(invoice.totals?.subtotal || invoice.totals?.total || 0),
      money.format(invoice.totals?.itbis || 0),
      money.format(invoice.totals?.total || 0),
    ]),
    styles: tableStyle(7),
    headStyles: headStyle(group),
    columnStyles: {
      3: { cellWidth: 44 },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
    },
    didDrawPage: () => drawHeader(doc, company, group, generatedAt, qr),
  })
}

function drawItemTable(doc, company, group, generatedAt, qr) {
  drawHeader(doc, company, group, generatedAt, qr)
  autoTable(doc, {
    startY: 28,
    head: [['Factura', 'Cliente', 'Producto', 'SKU', 'Cant.', 'Precio', 'Subtotal', 'ITBIS', 'Total', 'Seriales']],
    body: group.items.map((item) => [
      item.factura,
      item.cliente,
      item.producto,
      item.sku,
      item.cantidad,
      money.format(item.precio),
      money.format(item.subtotal),
      money.format(item.itbis),
      money.format(item.total),
      item.seriales,
    ]),
    styles: tableStyle(7),
    headStyles: headStyle(group),
    columnStyles: {
      2: { cellWidth: 46 },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
    },
    didDrawPage: () => drawHeader(doc, company, group, generatedAt, qr),
  })
}

function drawHeader(doc, company, group, generatedAt, qr) {
  const [r, g, b] = group.accent
  doc.setFillColor(10, 10, 15)
  doc.rect(0, 0, 297, 18, 'F')
  doc.setFillColor(r, g, b)
  doc.rect(0, 18, 297, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(company?.name || 'Trifusion Technologies', 12, 8)
  doc.setFont('helvetica', 'normal')
  doc.text(group.title, 12, 14)
  doc.text(dateTime.format(generatedAt), 225, 8)
  doc.addImage(qr, 'PNG', 278, 3, 10, 10)
  doc.setTextColor(15, 23, 42)
}

function drawMetricCards(doc, group, x, y) {
  const split = group.cashCreditSplit || { cashTotal: 0, creditTotal: 0, creditPaid: 0, creditPending: 0 }
  const cards = group.id === 'noTax'
    ? [
        ['Total Bruto', money.format(group.bucket.total)],
        ['Al Contado', money.format(split.cashTotal)],
        ['Credito Vendido', money.format(split.creditTotal)],
        ['Deuda Pendiente', money.format(split.creditPending)],
      ]
    : [
        ['Facturas', String(group.bucket.count)],
        ['Subtotal', money.format(group.bucket.subtotal)],
        ['ITBIS', money.format(group.bucket.itbis)],
        ['Total', money.format(group.bucket.total)],
      ]
  cards.forEach((card, index) => {
    const left = x + (index * 66)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(left, y, 58, 26, 3, 3, 'F')
    doc.setTextColor(80, 90, 110)
    doc.setFontSize(8)
    doc.text(card[0].toUpperCase(), left + 5, y + 8)
    doc.setTextColor(15, 23, 42)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(card[1], left + 5, y + 18)
    doc.setFont('helvetica', 'normal')
  })
}

function addPageFooters(doc, company, group, generatedAt) {
  const count = doc.getNumberOfPages()
  for (let page = 1; page <= count; page += 1) {
    doc.setPage(page)
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8)
    doc.text(`${group.title} | ${company?.name || 'Trifusion Technologies'} | ${dateTime.format(generatedAt)}`, 12, 202)
    doc.text(`Pagina ${page} de ${count}`, 268, 202)
    doc.setDrawColor(220, 226, 236)
    doc.line(12, 198, 285, 198)
  }
}

function invoiceToItemRows(invoice) {
  return (invoice.items || []).map((item) => {
    const subtotal = Number(item.net ?? Number(item.price || 0) * Number(item.quantity || 0))
    const itbis = Number(item.tax || 0)
    return {
      factura: invoice.ncf || invoice.number || '',
      cliente: invoice.customerName || '',
      producto: item.name || '',
      sku: item.sku || '',
      cantidad: Number(item.quantity || 0),
      precio: Number(item.price || 0),
      subtotal,
      itbis,
      total: subtotal + itbis,
      seriales: (item.serials || (item.serial ? [item.serial] : [])).join(', '),
    }
  })
}

function summarizePayments(invoices) {
  const totals = new Map()
  invoices.forEach((invoice) => {
    const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'No especificado', amount: invoice.totals?.total || 0 }]
    payments.forEach((payment) => {
      const key = payment.method || 'No especificado'
      const current = totals.get(key) || { method: key, count: 0, total: 0 }
      current.count += 1
      current.total += Number(payment.amount || invoice.totals?.total || 0)
      totals.set(key, current)
    })
  })
  return [...totals.values()]
}

function summarizeProducts(invoices) {
  const totals = new Map()
  invoices.flatMap(invoiceToItemRows).forEach((item) => {
    const key = item.sku || item.producto
    const current = totals.get(key) || { name: item.producto, sku: item.sku, quantity: 0, total: 0 }
    current.quantity += item.cantidad
    current.total += item.total
    totals.set(key, current)
  })
  return [...totals.values()].sort((a, b) => b.total - a.total)
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size
}

function tableStyle(fontSize = 8) {
  return {
    font: 'helvetica',
    fontSize,
    cellPadding: 2,
    lineColor: [226, 232, 240],
    lineWidth: 0.1,
    overflow: 'linebreak',
  }
}

function headStyle(group) {
  return {
    fillColor: group.accent,
    textColor: 255,
    fontStyle: 'bold',
  }
}

function paymentText(invoice) {
  return (invoice.payments || []).map((payment) => payment.method).join(', ') || invoice.paymentMethod || '-'
}

function shortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10)
}

function stamp(date) {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, '')
}
