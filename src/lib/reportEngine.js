import { INVALID_INVOICE_STATUSES } from './realDataGuards.js'
import { invoiceModes } from './taxEngine.js'

export const REPORT_ENGINE_VERSION = 2

const VALID_INVOICE_STATUSES = new Set(['pagada', 'paid', 'credito', 'credit', 'parcial', 'partial', 'open', 'emitida', 'issued', 'borrador', 'draft', 'pendiente', 'pending', 'vencida', 'overdue', 'entregada', 'delivered'])

export function createEmptyReportStats() {
  const generatedAt = new Date().toISOString()
  return {
    version: REPORT_ENGINE_VERSION,
    generatedAt,
    source: {
      fingerprint: '',
      invoiceCount: 0, creditNoteCount: 0, quoteCount: 0,
      validInvoiceCount: 0, voidedInvoiceCount: 0, validCreditNoteCount: 0,
      duplicateCount: 0, invalidCount: 0,
    },
    periods: { daily: [], weekly: [], monthly: [], annual: [], historical: emptyMetrics('historical', 'Historico') },
    fiscalBuckets: emptyFiscalBuckets(),
    fiscalGroups: [],
    topProducts: [], frequentCustomers: [], paymentMethods: [],
    inventoryValuation: { totalCost: 0, products: [] },
    financialHistory: [], invalidDocuments: [], duplicateDocuments: [],
    /* === NUEVAS SECCIONES PROFESIONALES === */
    executiveSummary: null,
    cashSales: null,
    creditSales: null,
    averageTicket: null,
    profitability: null,
    accountsReceivable: null,
    taxSummary: null,
    productAnalysis: null,
    customerAnalysis: null,
    paymentMethodAnalysis: null,
    comparativeAnalysis: null,
  }
}

export function buildReportFingerprint({ invoices = [], creditNotes = [], products = [], quotes = [] } = {}) {
  const invoicePart = invoices.map((inv) => [inv?.id, inv?.number, inv?.ncf, inv?.status, inv?.updatedAt, inv?.voidedAt, inv?.issuedAt, inv?.createdAt, roundMoney(inv?.totals?.total || inv?.total || 0)].join(':')).sort().join('|')
  const notePart = creditNotes.map((n) => [n?.id, n?.number, n?.status, n?.updatedAt, n?.createdAt, roundMoney(n?.totals?.total || n?.total || 0)].join(':')).sort().join('|')
  const productPart = products.map((p) => [p?.id, p?.status, p?.updatedAt, roundMoney(p?.stock || 0), roundMoney(p?.cost || 0), roundMoney(p?.price || 0)].join(':')).sort().join('|')
  const quotePart = quotes.map((q) => [q?.id, q?.number, q?.status, q?.version || 1, q?.updatedAt, roundMoney(q?.totals?.total || 0)].join(':')).sort().join('|')
  return simpleHash(`${REPORT_ENGINE_VERSION}::${invoicePart}::${notePart}::${productPart}::${quotePart}`)
}

export function buildHistoricalReport({ invoices = [], creditNotes = [], products = [], quotes = [], generatedAt = new Date() } = {}) {
  const stats = createEmptyReportStats()
  stats.generatedAt = generatedAt.toISOString()
  stats.source.invoiceCount = invoices.length
  stats.source.creditNoteCount = creditNotes.length
  stats.source.quoteCount = quotes.length
  stats.source.fingerprint = buildReportFingerprint({ invoices, creditNotes, products, quotes })
  stats.inventoryValuation = buildInventoryValuation(products)

  const periodMaps = { daily: new Map(), weekly: new Map(), monthly: new Map(), annual: new Map() }
  const fiscalBuckets = emptyFiscalBuckets()
  const fiscalGroups = emptyFiscalGroups()
  const productsMap = new Map()
  const customersMap = new Map()
  const paymentsMap = new Map()
  const dedupedInvoices = dedupeDocuments(invoices, invoiceDocumentKey)
  const dedupedNotes = dedupeDocuments(creditNotes, creditNoteDocumentKey)

  stats.duplicateDocuments.push(...dedupedInvoices.duplicates, ...dedupedNotes.duplicates)
  stats.source.duplicateCount = stats.duplicateDocuments.length

  const refundsByInvoice = new Map()
  dedupedNotes.documents.forEach((note) => {
    if (classifyCreditNote(note) !== 'valid') return
    const refunds = (note.payments || []).filter((p) => !isCreditMethod(p.method)).reduce((s, p) => s + toNumber(p.amount), 0)
    if (refunds > 0) refundsByInvoice.set(note.invoiceId, (refundsByInvoice.get(note.invoiceId) || 0) + refunds)
  })
  const creditInvoiceIds = new Set()
  const cashInvoiceData = []
  const creditInvoiceData = []

  dedupedInvoices.documents.forEach((invoice) => {
    const validity = classifyInvoice(invoice)
    if (validity === 'duplicate') return
    if (validity === 'voided') {
      stats.source.voidedInvoiceCount += 1
      addHistory(stats.financialHistory, invoice, 'Anulacion', 0, invoice.voidReason || 'Factura anulada')
      addPeriodMetric(periodMaps, invoiceDate(invoice, 'void'), { voidedDocuments: 1 })
      return
    }
    if (validity !== 'valid') { stats.invalidDocuments.push(documentIssue(invoice, validity)); return }

    stats.source.validInvoiceCount += 1
    const refundAmount = refundsByInvoice.get(invoice.id) || 0
    const effectivePaid = Math.max(0, toNumber(invoice.paidAmount || 0) - refundAmount)
    const metric = invoiceMetric(invoice, 1, effectivePaid)
    const paymentRatio = metric.paymentRatio
    addToFiscalBucket(fiscalBuckets, invoice, metric)
    addFiscalGroupRows(fiscalGroups, invoice)
    addPeriodMetric(periodMaps, invoiceDate(invoice), metric)
    addMetric(stats.periods.historical, metric)
    addProductLines(productsMap, invoice, 1, paymentRatio)
    addCustomer(customersMap, invoice, metric)
    addPayments(paymentsMap, invoice, 1)
    addHistory(stats.financialHistory, invoice, 'Factura', metric.total, 'Venta emitida')

    const isCredit = (invoice.payments || []).some((p) => isCreditMethod(p.method))
      || isCreditMethod(invoice.paymentMethod)
    const invoiceTotal = Number(invoice.totals?.total || 0)
    if (isCredit) {
      creditInvoiceIds.add(invoice.id)
      creditInvoiceData.push(invoice)
    } else {
      cashInvoiceData.push(invoice)
    }
  })

  dedupedNotes.documents.forEach((note) => {
    const validity = classifyCreditNote(note)
    if (validity !== 'valid') { stats.invalidDocuments.push(documentIssue(note, validity)); return }
    stats.source.validCreditNoteCount += 1
    const metric = invoiceMetric(note, -1)
    const adjustment = { ...metric, creditNotes: 1, returns: Math.abs(metric.total), documents: 0 }
    addPeriodMetric(periodMaps, invoiceDate(note), adjustment)
    addMetric(stats.periods.historical, adjustment)
    addProductLines(productsMap, note, -1)
    addCustomer(customersMap, note, adjustment)
    addPayments(paymentsMap, note, -1)
    addHistory(stats.financialHistory, note, 'Nota de credito', metric.total, note.reason || 'Devolucion / credito')
  })

  stats.source.invalidCount = stats.invalidDocuments.length
  stats.periods.daily = periodRows(periodMaps.daily)
  stats.periods.weekly = periodRows(periodMaps.weekly)
  stats.periods.monthly = periodRows(periodMaps.monthly)
  stats.periods.annual = periodRows(periodMaps.annual)
  stats.fiscalBuckets = normalizeFiscalBuckets(fiscalBuckets)
  stats.fiscalGroups = Object.values(fiscalGroups).map((group) => ({ ...group, bucket: stats.fiscalBuckets[group.id], customers: new Set(group.invoices.map((inv) => inv.customerId || inv.customerName).filter(Boolean)).size }))
  stats.topProducts = [...productsMap.values()].filter((item) => item.quantity > 0 || item.revenue > 0).map(finalizeProduct).sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 100)
  stats.frequentCustomers = [...customersMap.values()].map(finalizeCustomer).sort((a, b) => b.documents - a.documents || b.netRevenue - a.netRevenue).slice(0, 100)
  stats.paymentMethods = [...paymentsMap.values()].map((item) => ({ ...item, amount: roundMoney(item.amount), refunds: roundMoney(item.refunds), netAmount: roundMoney(item.amount - item.refunds) })).sort((a, b) => b.netAmount - a.netAmount)
  stats.financialHistory.sort((a, b) => String(b.date).localeCompare(String(a.date)))

  /* === BUILDER NUEVAS SECCIONES PROFESIONALES === */
  const allInvoices = dedupedInvoices.documents.filter((inv) => classifyInvoice(inv) === 'valid')
  const historical = stats.periods.historical

  stats.executiveSummary = buildExecutiveSummary(allInvoices, dedupedNotes.documents, historical, creditInvoiceData)
  stats.cashSales = buildCashSalesSection(cashInvoiceData, allInvoices, historical)
  stats.creditSales = buildCreditSalesSection(creditInvoiceData, historical, refundsByInvoice)
  stats.averageTicket = buildAverageTicketSection(historical)
  stats.profitability = buildProfitabilitySection(allInvoices, historical)
  stats.accountsReceivable = buildAccountsReceivableSection(creditInvoiceData, dedupedInvoices.documents, refundsByInvoice)
  stats.taxSummary = buildTaxSummarySection(stats.fiscalBuckets, historical)
  stats.productAnalysis = buildProductAnalysisSection(productsMap, products, allInvoices)
  stats.customerAnalysis = buildCustomerAnalysisSection(customersMap, allInvoices)
  stats.paymentMethodAnalysis = buildPaymentMethodAnalysisSection(paymentsMap, allInvoices)
  stats.comparativeAnalysis = buildComparativeAnalysisSection(stats)

  return stats
}

/* ================================================================
   SECCION 1 - RESUMEN EJECUTIVO
   ================================================================ */
function buildExecutiveSummary(allInvoices, allNotes, historical, creditInvoices) {
  const totalVentas = historical.total
  const contado = allInvoices.filter((inv) => {
    const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
    return !payments.some((p) => isCreditMethod(p.method))
  })
  const totalContado = contado.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0)
  const totalCredito = creditInvoices.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0)
  const totalGanancia = historical.netProfit
  const totalItbis = historical.tax
  const clientesUnicos = new Set(allInvoices.map((inv) => inv.customerId || inv.customerName)).size
  const clientesNuevos = clientesUnicos
  const facturasEmitidas = historical.documents
  const ticketPromedio = facturasEmitidas > 0 ? totalVentas / facturasEmitidas : 0
  const productosVendidos = allInvoices.reduce((s, inv) => s + (inv.items || []).reduce((s2, item) => s2 + Number(item.quantity || 0), 0), 0)
  const creditosPendientes = creditInvoices.reduce((s, inv) => s + pendingAmt(inv), 0)

  return {
    section: 'Resumen Ejecutivo',
    description: 'Panorama general del desempeño financiero del período analizado.',
    indicators: [
      { id: 'totalSales', label: 'Ventas totales', value: totalVentas, formatted: money(totalVentas), icon: 'DollarSign', color: 'blue', formula: 'Suma del total de todas las facturas emitidas en el período.', interpretation: 'Representa el ingreso bruto generado por todas las ventas realizadas.' },
      { id: 'cashSales', label: 'Ventas al contado', value: totalContado, formatted: money(totalContado), icon: 'Banknote', color: 'green', formula: 'Suma de facturas pagadas en efectivo, tarjeta o transferencia al momento de la compra.', interpretation: 'Indica el flujo de efectivo inmediato generado por las ventas.' },
      { id: 'creditSales', label: 'Ventas a credito', value: totalCredito, formatted: money(totalCredito), icon: 'CreditCard', color: 'amber', formula: 'Suma de facturas donde el pago fue diferido total o parcialmente.', interpretation: 'Muestra el monto vendido que sera cobrado en el futuro.' },
      { id: 'totalProfit', label: 'Ganancia total', value: totalGanancia, formatted: money(totalGanancia), icon: 'TrendingUp', color: totalGanancia >= 0 ? 'green' : 'red', formula: 'Suma de (Subtotal - Costo) × Ratio de pago de cada factura.', interpretation: totalGanancia >= 0 ? 'El negocio esta generando ganancias positivas.' : 'El negocio esta operando con perdidas. Revise costos y precios.' },
      { id: 'totalItbis', label: 'ITBIS generado', value: totalItbis, formatted: money(totalItbis), icon: 'Receipt', color: 'purple', formula: 'Suma del ITBIS cobrado en todas las facturas gravadas del período.', interpretation: 'Monto total del impuesto generado que debe ser declarado a la DGII.' },
      { id: 'newCustomers', label: 'Clientes nuevos', value: clientesNuevos, formatted: String(clientesNuevos), icon: 'Users', color: 'indigo', formula: 'Conteo de clientes unicos que realizaron compras en el período.', interpretation: 'Indica la capacidad de atraer nuevos compradores al negocio.' },
      { id: 'invoicesIssued', label: 'Facturas emitidas', value: facturasEmitidas, formatted: String(facturasEmitidas), icon: 'FileText', color: 'slate', formula: 'Conteo total de facturas validas emitidas en el período.', interpretation: 'Volumen de transacciones procesadas en el período.' },
      { id: 'averageTicket', label: 'Ticket promedio', value: ticketPromedio, formatted: money(ticketPromedio), icon: 'ShoppingCart', color: 'cyan', formula: 'Ventas totales ÷ Facturas emitidas', interpretation: `Cada cliente gasta en promedio ${money(ticketPromedio)} por compra.` },
      { id: 'productsSold', label: 'Productos vendidos', value: productosVendidos, formatted: String(productosVendidos), icon: 'Package', color: 'orange', formula: 'Suma de todas las cantidades de productos vendidos en el período.', interpretation: 'Volumen total de unidades comercializadas.' },
      { id: 'pendingCredits', label: 'Creditos pendientes', value: creditosPendientes, formatted: money(creditosPendientes), icon: 'AlertTriangle', color: creditosPendientes > 0 ? 'red' : 'green', formula: 'Suma de balances por cobrar de facturas a credito.', interpretation: creditosPendientes > 0 ? `Monto total que aun no ha sido cobrado: ${money(creditosPendientes)}.` : 'No hay creditos pendientes de cobro.' },
    ],
  }
}

/* ================================================================
   SECCION 2 - VENTAS AL CONTADO
   ================================================================ */
function buildCashSalesSection(cashInvoices, allInvoices, historical) {
  const totalContado = cashInvoices.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0)
  const itbisContado = cashInvoices.reduce((s, inv) => s + Number(inv.totals?.itbis || 0), 0)
  const subtotalContado = cashInvoices.reduce((s, inv) => s + Number(inv.totals?.subtotal || inv.totals?.total || 0), 0)
  const clientesContado = new Set(cashInvoices.map((inv) => inv.customerId || inv.customerName)).size
  const facturasContado = cashInvoices.length
  const pct = historical.total > 0 ? (totalContado / historical.total) * 100 : 0

  return {
    section: 'Ventas al Contado',
    description: 'Transacciones pagadas de contado (efectivo, tarjeta, transferencia).',
    indicators: [
      { id: 'cashInvoiceCount', label: 'Facturas al contado', value: facturasContado, formatted: String(facturasContado), icon: 'FileText', color: 'green', formula: 'Conteo de facturas pagadas al contado.', interpretation: `Se emitieron ${facturasContado} facturas de contado.` },
      { id: 'cashCustomerCount', label: 'Clientes al contado', value: clientesContado, formatted: String(clientesContado), icon: 'Users', color: 'green', formula: 'Clientes unicos que pagaron al contado.', interpretation: `${clientesContado} clientes diferentes compraron al contado.` },
      { id: 'cashSubtotal', label: 'Subtotal sin impuestos', value: subtotalContado - itbisContado, formatted: money(subtotalContado - itbisContado), icon: 'FileText', color: 'green', formula: 'Suma de subtotales de facturas de contado sin incluir ITBIS.', interpretation: 'Valor neto de los productos vendidos al contado.' },
      { id: 'cashItbis', label: 'ITBIS cobrado contado', value: itbisContado, formatted: money(itbisContado), icon: 'Receipt', color: 'green', formula: 'Suma del ITBIS de facturas de contado.', interpretation: `ITBIS generado por ventas de contado: ${money(itbisContado)}.` },
      { id: 'cashTotal', label: 'Total vendido contado', value: totalContado, formatted: money(totalContado), icon: 'DollarSign', color: 'green', formula: 'Suma total de facturas de contado.', interpretation: `Ingreso total de contado: ${money(totalContado)}.` },
      { id: 'cashPercentage', label: 'Porcentaje del total', value: pct, formatted: `${pct.toFixed(1)}%`, icon: 'PieChart', color: 'green', formula: '(Ventas contado ÷ Ventas totales) × 100', interpretation: `Las ventas al contado representan el ${pct.toFixed(1)}% de las ventas totales.` },
    ],
  }
}

/* ================================================================
   SECCION 3 - VENTAS A CREDITO
   ================================================================ */
function buildCreditSalesSection(creditInvoices, historical, refundsByInvoice = new Map()) {
  const totalVendido = creditInvoices.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0)
  const totalCobrado = creditInvoices.reduce((s, inv) => {
    const paid = Number(inv.paidAmount || 0)
    const refunds = refundsByInvoice.get(inv.id) || 0
    return s + Math.max(0, paid - refunds)
  }, 0)
  const totalPendiente = creditInvoices.reduce(function(s, inv) { return s + pendingAmt(inv) }, 0)
  const clientes = new Set(creditInvoices.map((inv) => inv.customerId || inv.customerName)).size
  const facturas = creditInvoices.length
  const recuperacion = totalVendido > 0 ? (totalCobrado / totalVendido) * 100 : 0
  const now = new Date()
  const vencidas = creditInvoices.filter(function(inv) {
    var due = inv.dueDate || inv.issuedAt || inv.createdAt
    return due && new Date(due) < now && pendingAmt(inv) > 0
  })
  const totalVencido = vencidas.reduce(function(s, inv) { return s + pendingAmt(inv) }, 0)

  return {
    section: 'Ventas a Credito',
    description: 'Transacciones realizadas a credito, su estado de cobro y recuperacion.',
    indicators: [
      { id: 'creditInvoiceCount', label: 'Facturas a credito', value: facturas, formatted: String(facturas), icon: 'FileText', color: 'amber', formula: 'Conteo de facturas con pago a credito.', interpretation: `Se emitieron ${facturas} facturas a credito.` },
      { id: 'creditCustomerCount', label: 'Clientes a credito', value: clientes, formatted: String(clientes), icon: 'Users', color: 'amber', formula: 'Clientes unicos que compraron a credito.', interpretation: `${clientes} clientes utilizaron credito.` },
      { id: 'creditTotalSold', label: 'Total vendido a credito', value: totalVendido, formatted: money(totalVendido), icon: 'DollarSign', color: 'amber', formula: 'Suma total de facturas a credito.', interpretation: `Monto total vendido a credito: ${money(totalVendido)}.` },
      { id: 'creditCollected', label: 'Total cobrado', value: totalCobrado, formatted: money(totalCobrado), icon: 'Banknote', color: 'green', formula: 'Suma de pagos recibidos de facturas a credito.', interpretation: `Se ha cobrado ${money(totalCobrado)} de las ventas a credito.` },
      { id: 'creditPending', label: 'Total pendiente', value: totalPendiente, formatted: money(totalPendiente), icon: 'Clock', color: totalPendiente > 0 ? 'red' : 'green', formula: 'Total vendido - Total cobrado = Monto por cobrar.', interpretation: `Quedan ${money(totalPendiente)} por cobrar.` },
      { id: 'creditOverdue', label: 'Total vencido', value: totalVencido, formatted: money(totalVencido), icon: 'AlertTriangle', color: totalVencido > 0 ? 'red' : 'green', formula: 'Suma de balances vencidos (fecha de vencimiento pasada).', interpretation: totalVencido > 0 ? `Hay ${money(totalVencido)} vencidos que requieren gestion de cobro.` : 'No hay montos vencidos.' },
      { id: 'creditRecovery', label: 'Porcentaje recuperado', value: recuperacion, formatted: `${recuperacion.toFixed(1)}%`, icon: 'TrendingUp', color: recuperacion >= 70 ? 'green' : recuperacion >= 40 ? 'amber' : 'red', formula: '(Total cobrado ÷ Total vendido a credito) × 100', interpretation: recuperacion >= 70 ? 'La recuperacion de credito es buena.' : recuperacion >= 40 ? 'La recuperacion de credito es regular.' : 'La recuperacion de credito es baja. Active gestion de cobro.' },
    ],
  }
}

/* ================================================================
   SECCION 4 - TICKET PROMEDIO
   ================================================================ */
function buildAverageTicketSection(historical) {
  const ventas = historical.total
  const facturas = historical.documents
  const ticket = facturas > 0 ? ventas / facturas : 0
  const interpretation = ticket > 0
    ? `Cada cliente gasta en promedio ${money(ticket)} por compra. Un ticket alto indica que cada venta genera mayor valor.`
    : 'No hay datos suficientes para calcular el ticket promedio.'

  return {
    section: 'Ticket Promedio',
    description: 'Indicador clave que mide el valor promedio de cada transaccion.',
    formula: 'Ticket Promedio = Ventas Totales ÷ Facturas Emitidas',
    indicators: [
      { id: 'atTotalSales', label: 'Ventas totales', value: ventas, formatted: money(ventas), icon: 'DollarSign', color: 'blue', formula: 'Suma total de todas las facturas.', interpretation: 'Base para el calculo del ticket promedio.' },
      { id: 'atInvoiceCount', label: 'Facturas emitidas', value: facturas, formatted: String(facturas), icon: 'FileText', color: 'blue', formula: 'Total de facturas en el período.', interpretation: 'Cantidad de transacciones realizadas.' },
      { id: 'atTicket', label: 'Ticket promedio', value: ticket, formatted: money(ticket), icon: 'ShoppingCart', color: 'cyan', formula: `${money(ventas)} ÷ ${facturas} = ${money(ticket)}`, interpretation },
    ],
    meaning: 'El ticket promedio representa el monto promedio que gasta cada cliente por compra.',
    howToInterpret: ticket > 5000 ? 'Ticket promedio alto: los clientes estan comprando multiples productos o productos de alto valor.' : ticket > 1000 ? 'Ticket promedio medio: los clientes compran algunos productos por transaccion.' : 'Ticket promedio bajo: considere estrategias de upselling o ventas por paquetes para aumentarlo.',
  }
}

/* ================================================================
   SECCION 5 - RENTABILIDAD
   ================================================================ */
function buildProfitabilitySection(allInvoices, historical) {
  const ventas = historical.total
  const costos = historical.cost
  const gananciaBruta = ventas - costos
  const gananciaNeta = historical.netProfit
  const margenBruto = ventas > 0 ? (gananciaBruta / ventas) * 100 : 0
  const margenNeto = ventas > 0 ? (gananciaNeta / ventas) * 100 : 0
  const interpretationBruto = margenBruto >= 40 ? 'Margen bruto saludable. La empresa cubre bien sus costos directos.' : margenBruto >= 20 ? 'Margen bruto aceptable. Revise oportunidades de mejora en costos.' : 'Margen bruto bajo. Evalue precios de venta y costos de productos.'
  const interpretationNeto = margenNeto >= 15 ? 'Rentabilidad neta excelente.' : margenNeto >= 5 ? 'Rentabilidad neta aceptable.' : 'Rentabilidad neta baja. Revise gastos operativos y estructura de costos.'

  return {
    section: 'Analisis de Rentabilidad',
    description: 'Evaluacion detallada de la rentabilidad del negocio.',
    formulas: [
      'Ganancia Bruta = Ventas Totales - Costo de Ventas',
      'Ganancia Neta = Ganancia Bruta - Ajustes por credito no cobrado',
      'Margen Bruto = (Ganancia Bruta ÷ Ventas) × 100',
      'Margen Neto = (Ganancia Neta ÷ Ventas) × 100',
    ],
    indicators: [
      { id: 'profSales', label: 'Ventas totales', value: ventas, formatted: money(ventas), icon: 'DollarSign', color: 'blue', formula: 'Suma total de facturas emitidas en el período.', interpretation: 'Ingreso bruto generado por las ventas.' },
      { id: 'profCost', label: 'Costos totales', value: costos, formatted: money(costos), icon: 'TrendingDown', color: 'red', formula: 'Suma del costo de los productos vendidos, ajustado por pago.', interpretation: `Costo total de la mercancia vendida: ${money(costos)}.` },
      { id: 'profGrossProfit', label: 'Ganancia bruta', value: gananciaBruta, formatted: money(gananciaBruta), icon: 'TrendingUp', color: gananciaBruta >= 0 ? 'green' : 'red', formula: 'Ventas totales - Costos totales', interpretation: interpretationBruto },
      { id: 'profNetProfit', label: 'Ganancia neta', value: gananciaNeta, formatted: money(gananciaNeta), icon: 'TrendingUp', color: gananciaNeta >= 0 ? 'green' : 'red', formula: 'Ganancia bruta ajustada por ratio de cobro real.', interpretation: interpretationNeto },
      { id: 'profGrossMargin', label: 'Margen bruto', value: margenBruto, formatted: `${margenBruto.toFixed(1)}%`, icon: 'Percent', color: margenBruto >= 40 ? 'green' : margenBruto >= 20 ? 'amber' : 'red', formula: '(Ganancia bruta ÷ Ventas) × 100', interpretation: `Por cada peso vendido, ${margenBruto.toFixed(1)}% queda despues de cubrir el costo del producto.` },
      { id: 'profNetMargin', label: 'Margen neto', value: margenNeto, formatted: `${margenNeto.toFixed(1)}%`, icon: 'Percent', color: margenNeto >= 15 ? 'green' : margenNeto >= 5 ? 'amber' : 'red', formula: '(Ganancia neta ÷ Ventas) × 100', interpretation: `Por cada peso vendido, ${margenNeto.toFixed(1)}% es ganancia real despues de todo.` },
    ],
  }
}

/* ================================================================
   SECCION 6 - CUENTAS POR COBRAR
   ================================================================ */
function pendingAmt(inv, effectivePaid) {
  if (inv.balanceDue != null) return Math.max(0, Number(inv.balanceDue))
  if (effectivePaid != null) return Math.max(0, Number(inv.totals?.total || 0) - effectivePaid)
  return Math.max(0, Number(inv.totals?.total || 0) - Number(inv.paidAmount || 0))
}

function buildAccountsReceivableSection(creditInvoices, allInvoices, refundsByInvoice = new Map()) {
  const now = new Date()
  const buckets = { '0-30': [], '31-60': [], '61-90': [], '90+': [] }
  const effectivePending = (inv) => {
    return pendingAmt(inv)
  }
  const validWithBalance = creditInvoices.filter((inv) => classifyInvoice(inv) === 'valid' && effectivePending(inv) > 0)

  const overdue = validWithBalance.filter((inv) => {
    const due = inv.dueDate || inv.issuedAt || inv.createdAt
    return due && new Date(due) < now
  })

  validWithBalance.forEach((inv) => {
    const due = inv.dueDate || inv.issuedAt || inv.createdAt
    const dueDate = due ? new Date(due) : now
    const daysOverdue = Math.max(0, Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)))
    const pend = effectivePending(inv)
    const entry = { ...inv, daysOverdue, pendingAmount: pend }
    if (daysOverdue <= 30) buckets['0-30'].push(entry)
    else if (daysOverdue <= 60) buckets['31-60'].push(entry)
    else if (daysOverdue <= 90) buckets['61-90'].push(entry)
    else buckets['90+'].push(entry)
  })

  const aging = Object.entries(buckets).map(([range, items]) => ({
    range,
    count: items.length,
    total: items.reduce((s, i) => s + i.pendingAmount, 0),
    invoices: items.map((i) => ({ id: i.id, number: i.number || i.ncf || '', customer: i.customerName || '', amount: i.pendingAmount, days: i.daysOverdue })),
  }))

  return {
    section: 'Cuentas por Cobrar',
    description: 'Analisis de antigüedad de saldos pendientes de cobro.',
    aging,
    totals: {
      pendingCount: validWithBalance.length,
      pendingTotal: validWithBalance.reduce((s, i) => s + effectivePending(i), 0),
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((s, i) => s + effectivePending(i), 0),
    },
  }
}

/* ================================================================
   SECCION 7 - IMPUESTOS (ITBIS)
   ================================================================ */
function buildTaxSummarySection(fiscalBuckets, historical) {
  const taxed = fiscalBuckets.taxed
  const noTax = fiscalBuckets.noTax
  const mixed = fiscalBuckets.mixed
  const ventasGravadas = taxed.total + (mixed.taxableSubtotal > 0 ? mixed.total : 0)
  const ventasExentas = noTax.total + (mixed.exemptSubtotal > 0 ? mixed.total : 0)
  const itbisCobrado = taxed.tax + mixed.tax
  const itbisPorCobrar = (taxed.total + mixed.total) * 0.18 * 0.1

  return {
    section: 'Resumen de ITBIS',
    description: 'Desglose detallado del Impuesto a la Transferencia de Bienes Industrializados y Servicios.',
    formulas: [
      'ITBIS Cobrado = Suma de ITBIS de facturas gravadas + mixtas',
      'Ventas Gravadas = Facturas con ITBIS + parte gravada de mixtas',
      'Ventas Exentas = Facturas sin ITBIS + parte exenta de mixtas',
    ],
    indicators: [
      { id: 'taxGravadas', label: 'Ventas gravadas', value: ventasGravadas, formatted: money(ventasGravadas), icon: 'FileText', color: 'purple', formula: 'Suma de facturas con ITBIS + porcion gravada de mixtas.', interpretation: `Monto total de ventas sujetas a ITBIS: ${money(ventasGravadas)}.` },
      { id: 'taxExentas', label: 'Ventas exentas', value: ventasExentas, formatted: money(ventasExentas), icon: 'FileText', color: 'slate', formula: 'Suma de facturas sin ITBIS + porcion exenta de mixtas.', interpretation: `Monto total de ventas exentas de ITBIS: ${money(ventasExentas)}.` },
      { id: 'taxCollected', label: 'ITBIS cobrado', value: itbisCobrado, formatted: money(itbisCobrado), icon: 'Receipt', color: 'purple', formula: 'ITBIS de facturas con ITBIS + ITBIS de facturas mixtas.', interpretation: `ITBIS total cobrado a clientes: ${money(itbisCobrado)}.` },
      { id: 'taxPending', label: 'ITBIS por cobrar estimado', value: itbisPorCobrar, formatted: money(itbisPorCobrar), icon: 'Clock', color: 'amber', formula: 'Estimado basado en creditos pendientes.', interpretation: itbisPorCobrar > 0 ? `ITBIS estimado pendiente de cobro en creditos: ${money(itbisPorCobrar)}.` : 'No hay ITBIS pendiente de cobro.' },
      { id: 'taxTotal', label: 'Total ventas periodo', value: historical.total, formatted: money(historical.total), icon: 'DollarSign', color: 'blue', formula: 'Ventas gravadas + exentas del período.', interpretation: `Base total sobre la cual se calcula el ITBIS: ${money(historical.total)}.` },
    ],
    buckets: [
      { name: 'Con ITBIS', count: taxed.documents, total: taxed.total, itbis: taxed.tax, pct: historical.total > 0 ? (taxed.total / historical.total) * 100 : 0 },
      { name: 'Sin ITBIS', count: noTax.documents, total: noTax.total, itbis: 0, pct: historical.total > 0 ? (noTax.total / historical.total) * 100 : 0 },
      { name: 'Mixtas', count: mixed.documents, total: mixed.total, itbis: mixed.tax, pct: historical.total > 0 ? (mixed.total / historical.total) * 100 : 0 },
    ],
  }
}

/* ================================================================
   SECCION 8 - PRODUCTOS
   ================================================================ */
function buildProductAnalysisSection(productsMap, allProducts, allInvoices) {
  const products = [...productsMap.values()].filter((p) => p.quantity > 0 || p.revenue > 0).map(finalizeProduct)

  const topSelling = [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 20)
  const leastSelling = [...products].filter((p) => p.quantity > 0).sort((a, b) => a.quantity - b.quantity).slice(0, 20)
  const mostProfitable = [...products].filter((p) => p.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 20)

  const now = new Date()
  const stagnantProducts = allProducts.filter((p) => {
    if (p.category === 'Servicios' || p.deletedAt) return false
    const lastSale = allInvoices
      .filter((inv) => (inv.items || []).some((item) => item.productId === p.id || item.sku === p.sku))
      .reduce((latest, inv) => {
        const d = new Date(inv.issuedAt || inv.createdAt || 0)
        return d > latest ? d : latest
      }, new Date(0))
    const daysSinceLastSale = Math.floor((now - lastSale) / (1000 * 60 * 60 * 24))
    return daysSinceLastSale > 90 && Number(p.stock || 0) > 0
  }).map((p) => {
    const lastSale = allInvoices
      .filter((inv) => (inv.items || []).some((item) => item.productId === p.id || item.sku === p.sku))
      .reduce((latest, inv) => {
        const d = new Date(inv.issuedAt || inv.createdAt || 0)
        return d > latest ? d : latest
      }, new Date(0))
    const daysSinceLastSale = Math.floor((now - lastSale) / (1000 * 60 * 60 * 24))
    return { id: p.id, name: p.name, sku: p.sku, stock: Number(p.stock || 0), cost: Number(p.cost || 0), retainedValue: roundMoney(Number(p.stock || 0) * Number(p.cost || 0)), daysWithoutSelling: daysSinceLastSale }
  }).sort((a, b) => b.retainedValue - a.retainedValue)

  return {
    section: 'Analisis de Productos',
    description: 'Rendimiento detallado del catalogo de productos.',
    topSelling: topSelling.map((p) => ({
      name: p.name, sku: p.sku, quantity: p.quantity, revenue: p.revenue, profit: p.profit, margin: p.margin,
    })),
    leastSelling: leastSelling.map((p) => ({
      name: p.name, sku: p.sku, quantity: p.quantity, revenue: p.revenue, daysWithoutSelling: 0,
    })),
    mostProfitable: mostProfitable.map((p) => ({
      name: p.name, sku: p.sku, profit: p.profit, margin: p.margin, revenue: p.revenue,
    })),
    stagnantInventory: stagnantProducts,
    totals: {
      totalProducts: allProducts.filter((p) => !p.deletedAt).length,
      activeProducts: products.length,
      retainedInventoryValue: stagnantProducts.reduce((s, p) => s + p.retainedValue, 0),
    },
  }
}

/* ================================================================
   SECCION 9 - CLIENTES
   ================================================================ */
function buildCustomerAnalysisSection(customersMap, allInvoices) {
  const customers = [...customersMap.values()].map(finalizeCustomer)
  const now = new Date()

  const bestCustomers = [...customers].sort((a, b) => b.netRevenue - a.netRevenue).slice(0, 20)
    .map((c) => ({
      id: c.id, name: c.name, documents: c.documents, netRevenue: c.netRevenue, tax: c.tax, netProfit: c.netProfit,
      averageTicket: c.documents > 0 ? c.netRevenue / c.documents : 0,
    }))

  const creditCustomers = allInvoices
    .filter((inv) => (inv.payments || []).some((p) => isCreditMethod(p.method)) || isCreditMethod(inv.paymentMethod))
    .reduce((map, inv) => {
      const key = inv.customerId || inv.customerName || 'sin-cliente'
      const pend = pendingAmt(inv)
      if (pend <= 0) return map
      const due = inv.dueDate || inv.issuedAt || inv.createdAt
      const daysOverdue = due ? Math.max(0, Math.floor((now - new Date(due)) / (1000 * 60 * 60 * 24))) : 0
      const current = map.get(key) || { id: key, name: inv.customerName || 'Cliente', pendingAmount: 0, maxDaysOverdue: 0, invoices: [] }
      current.pendingAmount += pend
      current.maxDaysOverdue = Math.max(current.maxDaysOverdue, daysOverdue)
      current.invoices.push({ number: inv.number || inv.ncf || '', pending: pend, days: daysOverdue })
      map.set(key, current)
      return map
    }, new Map())

  const inactiveCustomers = allInvoices.reduce((map, inv) => {
    const key = inv.customerId || inv.customerName || 'sin-cliente'
    const date = new Date(inv.issuedAt || inv.createdAt || 0)
    const current = map.get(key)
    if (!current || date > current.lastPurchase) map.set(key, { id: key, name: inv.customerName || 'Cliente', lastPurchase: date })
    return map
  }, new Map())

  const inactiveList = [...inactiveCustomers.values()]
    .map((c) => ({ ...c, daysSinceLastPurchase: Math.floor((now - c.lastPurchase) / (1000 * 60 * 60 * 24)) }))
    .filter((c) => c.daysSinceLastPurchase > 90)
    .sort((a, b) => b.daysSinceLastPurchase - a.daysSinceLastPurchase)
    .slice(0, 20)

  return {
    section: 'Analisis de Clientes',
    description: 'Comportamiento de compra, credito y fidelidad de los clientes.',
    bestCustomers,
    creditCustomers: [...creditCustomers.values()].sort((a, b) => b.pendingAmount - a.pendingAmount),
    inactiveCustomers: inactiveList,
    totals: {
      totalCustomers: customers.length,
      customersWithCredit: creditCustomers.size,
      inactiveCount: inactiveList.length,
    },
  }
}

/* ================================================================
   SECCION 10 - METODOS DE PAGO
   ================================================================ */
function buildPaymentMethodAnalysisSection(paymentsMap, allInvoices) {
  const totalAmount = [...paymentsMap.values()].reduce((s, p) => s + p.amount, 0)
  const methods = [...paymentsMap.values()].map((item) => ({
    method: item.method,
    count: item.count,
    total: item.amount,
    refunds: item.refunds,
    net: item.amount - item.refunds,
    percentage: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0,
  })).sort((a, b) => b.total - a.total)

  return {
    section: 'Metodos de Pago',
    description: 'Distribucion de las transacciones por metodo de pago utilizado.',
    methods,
    totals: {
      totalTransactions: methods.reduce((s, m) => s + m.count, 0),
      totalAmount,
      totalNet: methods.reduce((s, m) => s + m.net, 0),
    },
  }
}

/* ================================================================
   SECCION 11 - COMPARATIVAS
   ================================================================ */
function buildComparativeAnalysisSection(stats) {
  const daily = stats.periods.daily || []
  const monthly = stats.periods.monthly || []
  const today = daily.find((d) => d.period === dayKey(new Date()))
  const yesterday = daily.find((d) => d.period === dayKey(addDays(new Date(), -1)))
  const weekly = monthly.length > 0 ? monthly[monthly.length - 1] : null
  const prevWeek = monthly.length > 1 ? monthly[monthly.length - 2] : null

  function compare(current, previous, label) {
    if (!current || !previous) return { current, previous, label, available: false }
    const diff = current.total - previous.total
    const pctChange = previous.total > 0 ? ((current.total - previous.total) / previous.total) * 100 : 0
    const netDiff = (current.netProfit || 0) - (previous.netProfit || 0)
    return {
      current, previous, label, available: true, diff, pctChange, netDiff,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
      documentsDiff: current.documents - previous.documents,
    }
  }

  return {
    section: 'Analisis Comparativo',
    description: 'Variacion de indicadores clave entre periodos.',
    comparisons: [
      compare(today, yesterday, 'Hoy vs Ayer'),
      compare(weekly, prevWeek, 'Este mes vs Mes anterior'),
      compare(monthly.length > 0 ? monthly[0] : null, monthly.length > 1 ? monthly[1] : null, 'Ultimo mes completo vs Anterior'),
    ].filter(Boolean),
  }
}

/* === HELPER FUNCTIONS === */

function dedupeDocuments(documents, keyBuilder) {
  const byKey = new Map(); const duplicates = []
  documents.forEach((doc) => {
    const key = keyBuilder(doc)
    if (!key) { duplicates.push(documentIssue(doc, 'sin identidad documental')); return }
    const current = byKey.get(key)
    if (!current) { byKey.set(key, doc); return }
    duplicates.push(documentIssue(doc, `duplicado de ${key}`))
    if (documentTimestamp(doc) > documentTimestamp(current)) byKey.set(key, doc)
  })
  return { documents: [...byKey.values()], duplicates }
}

function invoiceDocumentKey(invoice) { return invoice?.ncf || invoice?.number || invoice?.id || '' }
function creditNoteDocumentKey(note) { return note?.ncf || note?.number || note?.id || '' }

function classifyInvoice(invoice) {
  const status = String(invoice?.status || '').toLowerCase()
  if (status === 'voided' || status === 'anulada') return 'voided'
  if (INVALID_INVOICE_STATUSES.has(status)) return status || 'invalid'
  if (status && !VALID_INVOICE_STATUSES.has(status)) return `estado no reportable: ${status}`
  if (!invoice?.items?.length) return 'sin productos'
  if (roundMoney(invoice?.totals?.total || invoice?.total || 0) <= 0) return 'monto invalido'
  return 'valid'
}

function classifyCreditNote(note) {
  const status = String(note?.status || '').toLowerCase()
  if (status === 'voided' || status === 'anulada' || status === 'draft' || status === 'deleted') return status || 'invalid'
  if (!note?.items?.length) return 'sin productos'
  if (roundMoney(note?.totals?.total || note?.total || 0) <= 0) return 'monto invalido'
  return 'valid'
}

function isCreditMethod(method = '') {
  return String(method || '').toLowerCase().includes('credito') || String(method || '').toLowerCase().includes('crédito')
}

function invoiceMetric(document, sign = 1, effectivePaid) {
  const totals = document?.totals || {}
  const subtotal = sign * roundMoney(totals.subtotal ?? totals.total ?? document.total ?? 0)
  const taxableSubtotal = sign * roundMoney(totals.taxableSubtotal || 0)
  const exemptSubtotal = sign * roundMoney(totals.exemptSubtotal || 0)
  const tax = sign * roundMoney(totals.itbis || totals.tax || 0)
  const total = sign * roundMoney(totals.total ?? document.total ?? subtotal + tax)
  const cost = sign * roundMoney(totals.cost ?? (document.items || []).reduce((sum, item) => sum + toNumber(item.cost) * toNumber(item.quantity), 0))
  const units = sign * roundMoney((document.items || []).reduce((sum, item) => sum + toNumber(item.quantity), 0))
  const rawProfit = subtotal - cost
  const absoluteTotal = Math.abs(total)
  const paymentRatio = sign > 0
    ? (document.balanceDue <= 0 || document.status === 'paid' ? 1
        : absoluteTotal > 0 ? Math.min(Math.max(absoluteTotal - toNumber(document.balanceDue), 0) / absoluteTotal, 1) : 0)
    : 1
  const effectiveProfit = roundMoney(rawProfit * paymentRatio)
  return { documents: sign > 0 ? 1 : 0, subtotal, taxableSubtotal, exemptSubtotal, tax, total, grossSales: sign > 0 ? total : 0, netRevenue: total, cost: sign > 0 ? roundMoney(cost * paymentRatio) : cost, utility: effectiveProfit, netProfit: effectiveProfit, creditNotes: 0, returns: 0, voidedDocuments: 0, unitsSold: units, paymentRatio }
}

function addPeriodMetric(periodMaps, date, metric) {
  const safeDate = parseDate(date)
  const keys = { daily: dayKey(safeDate), weekly: weekKey(safeDate), monthly: monthKey(safeDate), annual: annualKey(safeDate) }
  Object.entries(keys).forEach(([type, key]) => {
    const current = periodMaps[type].get(key) || emptyMetrics(key, periodLabel(type, key))
    addMetric(current, metric)
    periodMaps[type].set(key, current)
  })
}

function addMetric(target, metric) {
  Object.keys(emptyMetricValues()).forEach((key) => { target[key] = roundMoney(toNumber(target[key]) + toNumber(metric[key])) })
  target.averageTicket = target.documents > 0 ? roundMoney(target.total / target.documents) : 0
  target.margin = target.subtotal > 0 ? roundMoney((target.netProfit / target.subtotal) * 100) : 0
}

function addToFiscalBucket(buckets, invoice, metric) {
  const key = invoice.mode === invoiceModes.NO_TAX ? 'noTax' : invoice.mode === invoiceModes.MIXED ? 'mixed' : 'taxed'
  addMetric(buckets[key], metric)
}

function addFiscalGroupRows(groups, invoice) {
  const key = invoice.mode === invoiceModes.NO_TAX ? 'noTax' : invoice.mode === invoiceModes.MIXED ? 'mixed' : 'taxed'
  groups[key].invoices.push(invoiceReportRow(invoice))
  groups[key].items.push(...invoiceItemRows(invoice))
}

function addProductLines(productsMap, document, sign, paymentRatio = 1) {
  ;(document.items || []).forEach((item) => {
    const key = item.productId || item.sku || item.name; if (!key) return
    const current = productsMap.get(key) || { id: key, productId: item.productId || '', sku: item.sku || '', name: item.name || 'Producto', quantity: 0, revenue: 0, tax: 0, cost: 0, profit: 0, frequency: 0, returns: 0 }
    const quantity = toNumber(item.quantity)
    const subtotal = roundMoney(item.net ?? toNumber(item.price) * quantity)
    const tax = roundMoney(item.tax || 0)
    const cost = roundMoney(toNumber(item.cost) * quantity)
    current.quantity += sign * quantity; current.revenue += sign * (subtotal + tax); current.tax += sign * tax
    current.cost += sign > 0 ? sign * roundMoney(cost * paymentRatio) : sign * cost
    current.profit += sign > 0 ? sign * roundMoney((subtotal - cost) * paymentRatio) : sign * (subtotal - cost)
    current.frequency += sign > 0 ? 1 : 0; current.returns += sign < 0 ? quantity : 0
    productsMap.set(key, current)
  })
}

function addCustomer(customersMap, document, metric) {
  const key = document.customerId || document.customerName || 'sin-cliente'
  const current = customersMap.get(key) || { id: key, name: document.customerName || 'Cliente', rnc: document.customerRnc || document.customerDocument || '', documents: 0, creditNotes: 0, netRevenue: 0, tax: 0, netProfit: 0 }
  current.documents += metric.documents || 0; current.creditNotes += metric.creditNotes || 0; current.netRevenue += metric.netRevenue || 0; current.tax += metric.tax || 0; current.netProfit += metric.netProfit || 0
  customersMap.set(key, current)
}

function addPayments(paymentsMap, document, sign) {
  const total = roundMoney(document?.totals?.total || document?.total || 0)
  const payments = document.payments?.length ? document.payments : [{ method: document.paymentMethod || 'No especificado', amount: total }]
  payments.forEach((payment) => {
    const key = payment.method || 'No especificado'; const amount = roundMoney(payment.amount || total)
    const current = paymentsMap.get(key) || { method: key, count: 0, amount: 0, refunds: 0 }
    if (sign > 0) { current.count += 1; current.amount += amount } else { current.refunds += amount }
    paymentsMap.set(key, current)
  })
}

function addHistory(history, document, type, amount, description) {
  history.push({
    id: `${type}-${document.id || document.number || document.ncf || history.length}`, date: invoiceDate(document), type,
    number: document.ncf || document.number || '', customer: document.customerName || '',
    subtotal: roundMoney(document.totals?.subtotal || 0), tax: roundMoney(document.totals?.itbis || 0),
    total: roundMoney(document.totals?.total || document.total || 0), amount: roundMoney(amount),
    status: document.status || '', description,
  })
}

function buildInventoryValuation(products) {
  const rows = products.filter((p) => p && !p.deletedAt && p.status !== 'Eliminado').map((p) => {
    const stock = toNumber(p.stock); const cost = toNumber(p.cost)
    return { id: p.id, sku: p.sku || '', name: p.name || '', category: p.category || '', stock, cost, costValue: roundMoney(stock * cost) }
  }).sort((a, b) => b.costValue - a.costValue)
  return { totalCost: roundMoney(rows.reduce((sum, item) => sum + item.costValue, 0)), products: rows.slice(0, 250) }
}

function periodRows(map) { return [...map.values()].map(finalizeMetric).sort((a, b) => String(b.period).localeCompare(String(a.period))) }
function normalizeFiscalBuckets(buckets) { return { taxed: finalizeMetric(buckets.taxed), noTax: finalizeMetric(buckets.noTax), mixed: finalizeMetric(buckets.mixed) } }

function emptyFiscalGroups() {
  return {
    taxed: { id: 'taxed', mode: invoiceModes.TAXED, title: 'VENTAS CON ITBIS', sheetName: 'Con ITBIS', description: 'Facturas gravadas, ITBIS cobrado, ganancia y detalle de productos.', invoices: [], items: [] },
    noTax: { id: 'noTax', mode: invoiceModes.NO_TAX, title: 'VENTAS SIN ITBIS', sheetName: 'Sin ITBIS', description: 'Ventas no gravadas con detalle de facturas, productos y ganancia.', noTax: true, invoices: [], items: [] },
    mixed: { id: 'mixed', mode: invoiceModes.MIXED, title: 'VENTAS MIXTAS', sheetName: 'Mixtas', description: 'Facturas con lineas gravadas y exentas separadas para revision fiscal.', invoices: [], items: [] },
  }
}

function invoiceReportRow(invoice) {
  return {
    id: invoice.id, number: invoice.number || '', ncf: invoice.ncf || '', ncfType: invoice.ncfType || '',
    customerId: invoice.customerId || '', customerName: invoice.customerName || '', customerRnc: invoice.customerRnc || invoice.customerDocument || '',
    date: invoiceDate(invoice), issuedAt: invoice.issuedAt || invoice.createdAt || invoice.issueDate || '',
    mode: invoice.mode || '', status: invoice.status || '',
    paymentMethod: (invoice.payments || []).map((p) => p.method).join(', ') || invoice.paymentMethod || '',
    seller: invoice.seller || '', products: (invoice.items || []).length,
    totals: {
      subtotal: roundMoney(invoice.totals?.subtotal || invoice.totals?.total || 0),
      taxableSubtotal: roundMoney(invoice.totals?.taxableSubtotal || 0), exemptSubtotal: roundMoney(invoice.totals?.exemptSubtotal || 0),
      itbis: roundMoney(invoice.totals?.itbis || 0), total: roundMoney(invoice.totals?.total || invoice.total || 0),
      cost: roundMoney(invoice.totals?.cost ?? (invoice.items?.length ? invoice.items.reduce((s, i) => s + Number(i.cost || 0) * Number(i.quantity || 0), 0) : 0)),
      profit: roundMoney(invoice.items?.length ? invoice.items.reduce((s, i) => s + Number(i.net || 0) - Number(i.cost || 0) * Number(i.quantity || 0), 0) : (invoice.totals?.profit ?? (Number(invoice.totals?.subtotal || 0) - Number(invoice.totals?.cost || 0)))),
    },
  }
}

function invoiceItemRows(invoice) {
  return (invoice.items || []).map((item) => {
    const quantity = toNumber(item.quantity); const subtotal = roundMoney(item.net ?? toNumber(item.price) * quantity)
    const itbis = roundMoney(item.tax || 0); const cost = roundMoney(toNumber(item.cost) * quantity)
    return {
      factura: invoice.ncf || invoice.number || '', cliente: invoice.customerName || '', fecha: invoiceDate(invoice),
      producto: item.name || '', sku: item.sku || '', modelo: item.model || '', cantidad: quantity,
      precio: roundMoney(item.price || 0), descuento: roundMoney(item.discount || 0), subtotal, itbis,
      total: roundMoney(subtotal + itbis), costo: cost, ganancia: roundMoney(subtotal - cost),
      seriales: (item.serials || (item.serial ? [item.serial] : [])).join(', '), gravado: item.taxable ? 'Si' : 'No',
    }
  })
}

function emptyFiscalBuckets() { return { taxed: emptyMetrics('taxed', 'Ventas con ITBIS'), noTax: emptyMetrics('no_tax', 'Ventas sin ITBIS'), mixed: emptyMetrics('mixed', 'Ventas mixtas') } }
function emptyMetrics(period, label) { return { period, label, ...emptyMetricValues() } }
function emptyMetricValues() { return { documents: 0, subtotal: 0, taxableSubtotal: 0, exemptSubtotal: 0, tax: 0, total: 0, grossSales: 0, netRevenue: 0, cost: 0, utility: 0, netProfit: 0, creditNotes: 0, returns: 0, voidedDocuments: 0, unitsSold: 0, averageTicket: 0, margin: 0 } }
function finalizeMetric(metric) {
  const next = { ...metric }; Object.keys(emptyMetricValues()).forEach((key) => { next[key] = roundMoney(next[key]) })
  next.averageTicket = next.documents > 0 ? roundMoney(next.total / next.documents) : 0; next.margin = next.subtotal > 0 ? roundMoney((next.netProfit / next.subtotal) * 100) : 0
  next.count = next.documents; next.itbis = next.tax; next.profit = next.netProfit; return next
}
function finalizeProduct(product) { return { ...product, quantity: roundMoney(product.quantity), revenue: roundMoney(product.revenue), tax: roundMoney(product.tax), cost: roundMoney(product.cost), profit: roundMoney(product.profit), margin: product.revenue > 0 ? roundMoney((product.profit / Math.max(product.revenue - product.tax, 1)) * 100) : 0 } }
function finalizeCustomer(customer) { return { ...customer, netRevenue: roundMoney(customer.netRevenue), tax: roundMoney(customer.tax), netProfit: roundMoney(customer.netProfit) } }
function documentIssue(document, reason) { return { id: document?.id || document?.number || document?.ncf || '', number: document?.ncf || document?.number || '', status: document?.status || '', reason, date: invoiceDate(document) } }

function invoiceDate(document, fallback = 'issued') {
  if (fallback === 'void') return document?.voidedAt || document?.updatedAt || document?.issuedAt || document?.createdAt || document?.issueDate || new Date().toISOString()
  return document?.issuedAt || document?.createdAt || document?.issueDate || document?.updatedAt || new Date().toISOString()
}
function documentTimestamp(document) { return parseDate(document?.updatedAt || document?.issuedAt || document?.createdAt || document?.issueDate).getTime() }
function parseDate(value) { const date = value ? new Date(value) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date }
function dayKey(date) { return date.toISOString().slice(0, 10) }
function monthKey(date) { return date.toISOString().slice(0, 7) }
function annualKey(date) { return String(date.getFullYear()) }
function addDays(value, days) { const date = parseDate(value); date.setDate(date.getDate() + days); return date }

function weekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7; utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
function periodLabel(type, key) { if (type === 'daily') return key; if (type === 'weekly') return `Semana ${key}`; return key }
function toNumber(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0 }
function roundMoney(value) { return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100 }
const moneyFmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
const money = (v) => moneyFmt.format(v || 0)
function simpleHash(value) { let hash = 0; for (let i = 0; i < value.length; i++) { hash = ((hash << 5) - hash) + value.charCodeAt(i); hash |= 0 } return `${REPORT_ENGINE_VERSION}-${Math.abs(hash).toString(36)}-${value.length.toString(36)}` }
