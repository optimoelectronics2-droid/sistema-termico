import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const money = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
const num = (v) => money.format(v || 0)
const shortDate = (d) => d ? new Date(d).toLocaleDateString('es-DO') : '-'
const PAGE_W = 210; const PAGE_H = 297; const MARGIN = 18; const CONTENT_W = PAGE_W - MARGIN * 2

const COLORS = {
  blue: [37, 99, 235], primary: [15, 23, 42], secondary: [30, 41, 59], accent: [37, 99, 235],
  green: [16, 185, 129], red: [239, 68, 68], amber: [245, 158, 11], purple: [139, 92, 246],
  cyan: [6, 182, 212], indigo: [99, 102, 241], orange: [249, 115, 22], slate: [100, 116, 139],
  white: [255, 255, 255], light: [241, 245, 249], muted: [148, 163, 184], dark: [15, 23, 42],
}

export async function downloadProfessionalReportPdf({ company, reportStats, generatedAt, user }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const genDate = generatedAt || new Date()

  drawCoverPage(doc, company, reportStats, genDate, user)
  drawTableOfContents(doc, company, genDate)
  drawSection1ExecutiveSummary(doc, company, reportStats, genDate)
  drawSection2CashSales(doc, company, reportStats, genDate)
  drawSection3CreditSales(doc, company, reportStats, genDate)
  drawSection4AverageTicket(doc, company, reportStats, genDate)
  drawSection5Profitability(doc, company, reportStats, genDate)
  drawSection6AccountsReceivable(doc, company, reportStats, genDate)
  drawSection7TaxSummary(doc, company, reportStats, genDate)
  drawSection8Products(doc, company, reportStats, genDate)
  drawSection9Customers(doc, company, reportStats, genDate)
  drawSection10PaymentMethods(doc, company, reportStats, genDate)
  drawSection11Comparative(doc, company, reportStats, genDate)
  addPageFooters(doc, company, genDate)
  doc.save(`reporte-ejecutivo-${stamp(genDate)}.pdf`)
}

/* ============ COVER PAGE ============ */
function drawCoverPage(doc, company, stats, genDate, user) {
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')
  doc.setFillColor(...COLORS.accent)
  doc.rect(0, 0, PAGE_W, 8, 'F')

  doc.setTextColor(...COLORS.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(32)
  doc.text('REPORTE EJECUTIVO', MARGIN, 70)
  doc.setFontSize(18)
  doc.text('Analisis Financiero y Comercial', MARGIN, 84)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(company?.name || 'Empresa', MARGIN, 110)
  doc.text(`RNC: ${company?.rnc || 'N/A'}  |  Tel: ${company?.phone || company?.whatsapp || 'N/A'}`, MARGIN, 120)
  doc.text(company?.address || '', MARGIN, 128)

  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, 145, PAGE_W - MARGIN, 145)

  doc.setFontSize(9)
  doc.setTextColor(...COLORS.muted)
  doc.text(`Generado: ${genDate.toLocaleDateString('es-DO')} a las ${genDate.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`, MARGIN, 158)
  doc.text(`Usuario: ${user || 'Sistema'}`, MARGIN, 165)
  doc.text(`Periodo analizado: Todo el historico`, MARGIN, 172)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.accent)
  doc.text('Documento generado automaticamente por el sistema ERP', MARGIN, 190)
  doc.text('Trifusion Technologies - Todos los derechos reservados', MARGIN, 198)
}

/* ============ TABLE OF CONTENTS ============ */
function drawTableOfContents(doc, company, genDate) {
  doc.addPage()
  drawPageHeader(doc, 'Tabla de Contenido', company)
  const sections = [
    ['1', 'Resumen Ejecutivo', 'Pagina 3'],
    ['2', 'Ventas al Contado', 'Pagina 4'],
    ['3', 'Ventas a Credito', 'Pagina 5'],
    ['4', 'Ticket Promedio', 'Pagina 6'],
    ['5', 'Analisis de Rentabilidad', 'Pagina 7'],
    ['6', 'Cuentas por Cobrar', 'Pagina 8'],
    ['7', 'Resumen de ITBIS', 'Pagina 9'],
    ['8', 'Analisis de Productos', 'Pagina 10'],
    ['9', 'Analisis de Clientes', 'Pagina 11'],
    ['10', 'Metodos de Pago', 'Pagina 12'],
    ['11', 'Analisis Comparativo', 'Pagina 13'],
  ]
  autoTable(doc, {
    startY: 40,
    head: [['#', 'Seccion', 'Pagina']],
    body: sections,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: COLORS.accent, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 130 }, 2: { cellWidth: 30, halign: 'right' } },
    alternateRowStyles: { fillColor: COLORS.light },
  })
}

/* ============ SECTION 1 - EXECUTIVE SUMMARY ============ */
function drawSection1ExecutiveSummary(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '1. Resumen Ejecutivo', 'Panorama general del desempeno financiero del periodo analizado.', company)
  const exec = stats.executiveSummary
  if (!exec) { drawNoData(doc); return }

  let y = 50
  const indicators = exec.indicators || []
  const rows = chunk(indicators, 2)
  rows.forEach((row, ri) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'blue')
    })
    y += 28
  })

  drawExplanations(doc, exec, y + 8)
}

/* ============ SECTION 2 - CASH SALES ============ */
function drawSection2CashSales(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '2. Ventas al Contado', 'Transacciones pagadas de contado (efectivo, tarjeta, transferencia, cheques).', company)
  const section = stats.cashSales
  if (!section) { drawNoData(doc); return }
  let y = 50
  const indicators = section.indicators || []
  chunk(indicators, 2).forEach((row) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'green')
    })
    y += 28
  })
  drawExplanations(doc, section, y + 8)
}

/* ============ SECTION 3 - CREDIT SALES ============ */
function drawSection3CreditSales(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '3. Ventas a Credito', 'Transacciones realizadas a credito, su estado de cobro y recuperacion.', company)
  const section = stats.creditSales
  if (!section) { drawNoData(doc); return }
  let y = 50
  const indicators = section.indicators || []
  chunk(indicators, 2).forEach((row) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'amber')
    })
    y += 28
  })
  drawExplanations(doc, section, y + 8)
}

/* ============ SECTION 4 - AVERAGE TICKET ============ */
function drawSection4AverageTicket(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '4. Ticket Promedio', 'Monto promedio que gasta cada cliente por compra.', company)
  const section = stats.averageTicket
  if (!section) { drawNoData(doc); return }

  let y = 50
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.slate)
  doc.text(`Que significa? ${section.meaning || ''}`, MARGIN, y)
  y += 8
  doc.text(`Formula: ${section.formula || 'Ventas Totales ÷ Facturas Emitidas'}`, MARGIN, y)
  y += 12

  const indicators = section.indicators || []
  chunk(indicators, 2).forEach((row) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'cyan')
    })
    y += 28
  })

  if (section.howToInterpret) {
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...COLORS.accent)
    doc.text('Como interpretarlo:', MARGIN, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLORS.secondary)
    doc.text(section.howToInterpret, MARGIN, y, { maxWidth: CONTENT_W })
  }
}

/* ============ SECTION 5 - PROFITABILITY ============ */
function drawSection5Profitability(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '5. Analisis de Rentabilidad', 'Evaluacion detallada de la rentabilidad del negocio.', company)
  const section = stats.profitability
  if (!section) { drawNoData(doc); return }

  let y = 50
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.secondary)
  doc.text('Formulas de rentabilidad:', MARGIN, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const formulas = section.formulas || []
  formulas.forEach((f) => {
    doc.setTextColor(...COLORS.slate)
    doc.text(`• ${f}`, MARGIN + 4, y)
    y += 5
  })
  y += 4

  const indicators = section.indicators || []
  chunk(indicators, 2).forEach((row) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'blue')
    })
    y += 28
  })
  drawExplanations(doc, section, y + 8)
}

/* ============ SECTION 6 - ACCOUNTS RECEIVABLE ============ */
function drawSection6AccountsReceivable(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '6. Cuentas por Cobrar', 'Analisis de antiguedad de saldos pendientes de cobro.', company)
  const section = stats.accountsReceivable
  if (!section) { drawNoData(doc); return }

  let y = 50
  const totals = section.totals || {}
  drawMetricCard(doc, MARGIN, y, 'Facturas pendientes', String(totals.pendingCount || 0), 'Total de facturas con saldo pendiente.', 'Conteo de facturas no pagadas.', 'red')
  drawMetricCard(doc, MARGIN + CONTENT_W / 2 + 4, y, 'Monto pendiente total', num(totals.pendingTotal), 'Suma de todos los saldos por cobrar.', 'Suma de balances pendientes.', 'red')
  y += 28
  drawMetricCard(doc, MARGIN, y, 'Facturas vencidas', String(totals.overdueCount || 0), 'Facturas cuya fecha de vencimiento ya paso.', 'Conteo de facturas vencidas.', 'amber')
  y += 28

  const aging = section.aging || []
  if (aging.length) {
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.primary)
    doc.text('Antiguedad de saldos', MARGIN, y)
    y += 6
    autoTable(doc, {
      startY: y,
      head: [['Rango', 'Facturas', 'Monto']],
      body: aging.map((a) => [a.range === '0-30' ? '0 a 30 dias' : a.range === '31-60' ? '31 a 60 dias' : a.range === '61-90' ? '61 a 90 dias' : 'Mas de 90 dias', String(a.count), num(a.total)]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: COLORS.accent, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 80 }, 1: { halign: 'center' }, 2: { halign: 'right' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (aging.length && aging[0].invoices?.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.primary)
    doc.text(`Detalle de facturas vencidas (0-30 dias)`, MARGIN, y)
    y += 6
    autoTable(doc, {
      startY: y,
      head: [['Factura', 'Cliente', 'Monto', 'Dias vencido']],
      body: aging[0].invoices.slice(0, 15).map((inv) => [inv.number, inv.customer, num(inv.amount), `${inv.days}d`]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.red, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
  }
}

/* ============ SECTION 7 - TAX SUMMARY ============ */
function drawSection7TaxSummary(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '7. Resumen de ITBIS', 'Desglose detallado del Impuesto a la Transferencia de Bienes Industrializados y Servicios.', company)
  const section = stats.taxSummary
  if (!section) { drawNoData(doc); return }

  let y = 50
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.slate)
  const formulas = section.formulas || []
  formulas.forEach((f) => { doc.text(`• ${f}`, MARGIN + 4, y); y += 4 })
  y += 4

  const indicators = section.indicators || []
  chunk(indicators, 2).forEach((row) => {
    row.forEach((ind, ci) => {
      const x = MARGIN + ci * (CONTENT_W / 2 + 4)
      drawMetricCard(doc, x, y, ind.label, ind.formatted || String(ind.value), ind.interpretation, ind.formula, ind.color || 'purple')
    })
    y += 28
  })

  const buckets = section.buckets || []
  if (buckets.length) {
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.primary)
    doc.text('Distribucion por regimen fiscal', MARGIN, y)
    y += 6
    autoTable(doc, {
      startY: y,
      head: [['Regimen', 'Facturas', 'Total', 'ITBIS', '% del total']],
      body: buckets.map((b) => [b.name, String(b.count), num(b.total), num(b.itbis), `${b.pct.toFixed(1)}%`]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: COLORS.purple, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
  }
  drawExplanations(doc, section, (doc.lastAutoTable?.finalY || y) + 8)
}

/* ============ SECTION 8 - PRODUCTS ============ */
function drawSection8Products(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '8. Analisis de Productos', 'Rendimiento detallado del catalogo de productos.', company)
  const section = stats.productAnalysis
  if (!section) { drawNoData(doc); return }

  let y = 50

  if (section.topSelling?.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Productos mas vendidos', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'SKU', 'Cantidad', 'Ingreso', 'Ganancia', 'Margen']],
      body: section.topSelling.slice(0, 10).map((p) => [p.name, p.sku || '-', String(p.quantity), num(p.revenue), num(p.profit), `${(p.margin || 0).toFixed(1)}%`]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.green, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (section.mostProfitable?.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Productos mas rentables', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'SKU', 'Ganancia', 'Margen', 'Ingreso']],
      body: section.mostProfitable.slice(0, 10).map((p) => [p.name, p.sku || '-', num(p.profit), `${(p.margin || 0).toFixed(1)}%`, num(p.revenue)]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.cyan, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'center' }, 4: { halign: 'right' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (section.stagnantInventory?.length) {
    y += 2
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Inventario inmovilizado (sin venta en mas de 90 dias)', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'SKU', 'Stock', 'Valor retenido', 'Dias sin vender']],
      body: section.stagnantInventory.slice(0, 15).map((p) => [p.name, p.sku || '-', String(p.stock), num(p.retainedValue), `${p.daysWithoutSelling}d`]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.red, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORS.slate)
    doc.text(`Valor total retenido en inventario inmovilizado: ${num(section.totals?.retainedInventoryValue || 0)}`, MARGIN, y)
  }
}

/* ============ SECTION 9 - CUSTOMERS ============ */
function drawSection9Customers(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '9. Analisis de Clientes', 'Comportamiento de compra, credito y fidelidad de los clientes.', company)
  const section = stats.customerAnalysis
  if (!section) { drawNoData(doc); return }

  let y = 50

  if (section.bestCustomers?.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Mejores clientes por ingresos', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Cliente', 'Facturas', 'Compras totales', 'ITBIS', 'Ticket promedio']],
      body: section.bestCustomers.slice(0, 10).map((c) => [c.name, String(c.documents), num(c.netRevenue), num(c.tax || 0), num(c.averageTicket || 0)]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.indigo, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (section.creditCustomers?.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Clientes con creditos pendientes', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Cliente', 'Monto pendiente', 'Dias vencido max']],
      body: section.creditCustomers.slice(0, 10).map((c) => [c.name, num(c.pendingAmount), `${c.maxDaysOverdue}d`]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.red, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (section.inactiveCustomers?.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.primary)
    doc.text('Clientes inactivos (+90 dias sin comprar)', MARGIN, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Cliente', 'Ultima compra', 'Dias sin comprar']],
      body: section.inactiveCustomers.slice(0, 10).map((c) => [c.name, shortDate(c.lastPurchase), `${c.daysSinceLastPurchase}d`]),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.amber, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
  }
}

/* ============ SECTION 10 - PAYMENT METHODS ============ */
function drawSection10PaymentMethods(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '10. Metodos de Pago', 'Distribucion de las transacciones por metodo de pago utilizado.', company)
  const section = stats.paymentMethodAnalysis
  if (!section) { drawNoData(doc); return }

  let y = 50
  const methods = section.methods || []
  if (methods.length) {
    const grandTotal = methods.reduce((s, m) => s + m.total, 0)
    const grandCount = methods.reduce((s, m) => s + m.count, 0)
    autoTable(doc, {
      startY: y,
      head: [['Metodo de pago', 'Transacciones', 'Monto total', 'Devoluciones', 'Neto', '% de uso']],
      body: methods.map((m) => [m.method, String(m.count), num(m.total), num(m.refunds || 0), num(m.net || m.total), `${m.percentage?.toFixed(1) || '0'}%`]),
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: COLORS.accent, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' } },
      alternateRowStyles: { fillColor: COLORS.light },
    })
    y = doc.lastAutoTable.finalY + 8

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...COLORS.primary)
    doc.text(`Total transacciones: ${grandCount}`, MARGIN, y); y += 5
    doc.text(`Monto total procesado: ${num(grandTotal)}`, MARGIN, y)
  }
}

/* ============ SECTION 11 - COMPARATIVE ============ */
function drawSection11Comparative(doc, company, stats, genDate) {
  doc.addPage()
  drawSectionHeader(doc, '11. Analisis Comparativo', 'Variacion de indicadores clave entre periodos.', company)
  const section = stats.comparativeAnalysis
  if (!section) { drawNoData(doc); return }

  const comparisons = section.comparisons || []
  if (!comparisons.length) { drawNoData(doc, 'No hay suficientes datos para comparativas.'); return }

  let y = 50
  comparisons.forEach((comp) => {
    if (!comp.available) return
    const color = comp.direction === 'up' ? 'green' : comp.direction === 'down' ? 'red' : 'slate'
    drawMetricCard(doc, MARGIN, y, comp.label, `${comp.pctChange >= 0 ? '+' : ''}${comp.pctChange.toFixed(1)}%`, `Diferencia: ${num(comp.diff)}. ${comp.documentsDiff >= 0 ? '+' : ''}${comp.documentsDiff} facturas.`, 'Comparacion entre periodos.', color)
    y += 28
  })

  y += 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.primary)
  doc.text('Detalle de comparacion', MARGIN, y)
  y += 6

  const compTable = comparisons.filter((c) => c.available).map((c) => [
    c.label,
    num(c.current?.total || 0),
    num(c.previous?.total || 0),
    num(c.diff || 0),
    `${c.pctChange >= 0 ? '+' : ''}${c.pctChange.toFixed(1)}%`,
    c.direction === 'up' ? '▲ Incremento' : c.direction === 'down' ? '▼ Disminucion' : '▬ Estable',
  ])
  autoTable(doc, {
    startY: y,
    head: [['Periodo', 'Actual', 'Anterior', 'Diferencia', 'Variacion %', 'Tendencia']],
    body: compTable,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: COLORS.accent, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
    alternateRowStyles: { fillColor: COLORS.light },
  })
}

/* ============ UTILITY FUNCTIONS ============ */
function drawPageHeader(doc, title, company) {
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, PAGE_W, 18, 'F')
  doc.setFillColor(...COLORS.accent)
  doc.rect(0, 18, PAGE_W, 1.5, 'F')
  doc.setTextColor(...COLORS.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(company?.name || 'Sistema ERP', MARGIN, 8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(title, MARGIN, 13.5)
}

function drawSectionHeader(doc, title, description, company) {
  drawPageHeader(doc, title, company)
  doc.setTextColor(...COLORS.primary)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, MARGIN, 35)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.slate)
  doc.text(description || '', MARGIN, 43)
}

function drawMetricCard(doc, x, y, label, value, interpretation, formula, colorKey = 'blue') {
  const w = CONTENT_W / 2 - 2; const h = 24
  const borderColor = COLORS[colorKey] || COLORS.blue
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...borderColor)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...borderColor)
  doc.text(label.toUpperCase(), x + 3, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.primary)
  doc.text(String(value || '-'), x + 3, y + 15)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.5)
  doc.setTextColor(...COLORS.muted)
  const interpW = w - 6
  const lines = doc.splitTextToSize(interpretation || '', interpW)
  doc.text(lines.slice(0, 2), x + 3, y + 20)
}

function drawExplanations(doc, section, startY) {
  let y = startY
  if (!section || !section.section) return
  doc.setDrawColor(...COLORS.light)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.accent)
  doc.text(`Que es "${section.section}"?`, MARGIN, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLORS.secondary)
  doc.text(section.description || '', MARGIN, y, { maxWidth: CONTENT_W })
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.accent)
  doc.text('Como se interpreta?', MARGIN, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLORS.secondary)

  const indicators = section.indicators || []
  const interpretations = indicators.slice(0, 3).map((ind) => `${ind.label}: ${ind.interpretation}`)
  interpretations.forEach((text) => {
    const lines = doc.splitTextToSize(`• ${text}`, CONTENT_W)
    doc.text(lines, MARGIN, y)
    y += lines.length * 3.5 + 1
  })
}

function drawNoData(doc, msg = 'No hay datos disponibles para esta seccion.') {
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.slate)
  doc.text(msg, MARGIN, 60)
}

function addPageFooters(doc, company, genDate) {
  const count = doc.getNumberOfPages()
  for (let page = 1; page <= count; page++) {
    doc.setPage(page)
    doc.setTextColor(...COLORS.muted)
    doc.setFontSize(7)
    doc.text(`${company?.name || 'Sistema ERP'} | Reporte Ejecutivo | ${genDate.toLocaleDateString('es-DO')}`, MARGIN, PAGE_H - 12)
    doc.text(`Pagina ${page} de ${count}`, PAGE_W - MARGIN, PAGE_H - 12, { align: 'right' })
    doc.setDrawColor(...COLORS.light)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, PAGE_H - 16, PAGE_W - MARGIN, PAGE_H - 16)
  }
  if (count > 1) {
    doc.setPage(2); doc.setDrawColor(...COLORS.light); doc.line(MARGIN, PAGE_H - 16, PAGE_W - MARGIN, PAGE_H - 16)
    doc.setTextColor(...COLORS.muted); doc.setFontSize(7)
    doc.text(`${company?.name || 'Sistema ERP'} | Reporte Ejecutivo | ${genDate.toLocaleDateString('es-DO')}`, MARGIN, PAGE_H - 12)
    doc.text(`Pagina 2 de ${count}`, PAGE_W - MARGIN, PAGE_H - 12, { align: 'right' })
  }
}

function chunk(arr, size) {
  const result = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

function stamp(date) {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, '')
}
