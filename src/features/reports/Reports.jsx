import { useEffect, useMemo, useState, useCallback } from 'react'
import { Bar, Doughnut, Line as LineChart } from 'react-chartjs-2'
import { ArrowUpRight, CalendarDays, ChevronDown, Download, Filter, Printer, Search, FileText } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { useERPStore } from '../../store/useERPStore'
import { downloadCsvWorkbook } from '../../lib/csvExport'
import { createEmptyReportStats } from '../../lib/reportEngine'
import { invoiceModes } from '../../lib/taxEngine'
import { applyQuickRange, defaultReportFilters, describeFilters, filterReportRows, groupOptions, groupReportRows, quickDateRanges } from '../../lib/reportFilters'
import { currency, formatDate } from '../../lib/formatters'

const EMPTY_REPORT = createEmptyReportStats()
const reportAreas = [
  { key: 'overview', label: 'Resumen ejecutivo', accent: 'green' },
  { key: 'grouping', label: 'Agrupacion y acumulados', accent: 'blue' },
  { key: 'products', label: 'Productos y clientes', accent: 'green' },
  { key: 'cashCredit', label: 'Desglose Contado / Credito', accent: 'amber' },
  { key: 'payments', label: 'Pagos e inventario', accent: 'cyan' },
  { key: 'sheets', label: 'Hojas fiscales separadas', accent: 'violet' },
  { key: 'kardex', label: 'Kardex e historial financiero', accent: 'pink' },
  { key: 'exclusions', label: 'Exclusiones del motor', accent: 'red' },
]

function fiscalAccent(modeValue) {
  if (modeValue === invoiceModes.NO_TAX) return 'green'
  if (modeValue === invoiceModes.MIXED) return 'amber'
  return 'blue'
}

function sheetNumber(modeValue) {
  if (modeValue === invoiceModes.NO_TAX) return '02'
  if (modeValue === invoiceModes.MIXED) return '03'
  return '01'
}

function FiscalSheetLauncher({ groups, onOpen }) {
  return (
    <div className="fiscal-sheet-launcher">
      {groups.map((group) => (
        <button key={group.mode} type="button" onClick={() => onOpen(group.mode)} className={`fiscal-sheet-button report-nav-${fiscalAccent(group.mode)}`}>
          <span className="fiscal-sheet-button-main">
            <span className="report-nav-index">{sheetNumber(group.mode)}</span>
            <span className="report-nav-copy">
              <strong>{group.title}</strong>
              <small>{group.description}</small>
            </span>
          </span>
          <span className="fiscal-sheet-button-metrics">
            <em>{group.bucket?.count || 0} facturas</em>
            <em>{currency.format(group.bucket?.total || 0)}</em>
            <em>{(group.items || []).length} productos</em>
          </span>
          <span className="report-nav-action">Abrir desglose <ArrowUpRight size={15} /></span>
        </button>
      ))}
    </div>
  )
}

export function Reports() {
  const company = useERPStore((state) => state.company)
  const reportStats = useERPStore((state) => state.reportStats)
  const inventoryReports = useERPStore((state) => state.inventoryReports)
  const ensureReportStats = useERPStore((state) => state.ensureReportStats)
  const creditNotes = useERPStore((state) => state.creditNotes || [])
  const [mode, setMode] = useState('all')
  const [profitPeriod, setProfitPeriod] = useState('filtered')
  const [periodTable, setPeriodTable] = useState('monthly')
  const [filters, setFilters] = useState(() => defaultReportFilters())
  const [showFilters, setShowFilters] = useState(false)
  const [showDetail, setShowDetail] = useState({})
  const [activeArea, setActiveArea] = useState('overview')
  const [selectedSheetMode, setSelectedSheetMode] = useState('all')
  const report = reportStats?.version ? reportStats : EMPTY_REPORT
  const inventory = inventoryReports || {}

  useEffect(() => { ensureReportStats() }, [ensureReportStats])

  const allInvoices = useMemo(() => (report.fiscalGroups || []).flatMap((group) => group.invoices || []), [report])
  const allItems = useMemo(() => (report.fiscalGroups || []).flatMap((group) => group.items || []), [report])
  const filteredInvoices = useMemo(() => filterReportRows(allInvoices, filters, { searchableFields: ['number', 'ncf', 'customerName', 'paymentMethod', 'seller', 'status'] }), [allInvoices, filters])
  const filteredItems = useMemo(() => filterReportRows(allItems, filters, { searchableFields: ['factura', 'cliente', 'producto', 'sku', 'modelo', 'seriales', 'gravado'] }), [allItems, filters])
  const filteredHistory = useMemo(() => filterReportRows(report.financialHistory || [], filters, { searchableFields: ['type', 'number', 'customer', 'status', 'description'] }), [report, filters])
  const fiscalSheetGroups = useMemo(() => buildReportGroups(report.fiscalGroups || [], filteredInvoices, filteredItems), [report, filteredInvoices, filteredItems])
  const visibleReportGroups = useMemo(() => {
    if (!showDetail.sheets) return []
    if (selectedSheetMode === 'all') return []
    return fiscalSheetGroups.filter((group) => group.mode === selectedSheetMode || group.id === selectedSheetMode)
  }, [showDetail.sheets, fiscalSheetGroups, selectedSheetMode])
  const buckets = useMemo(() => buildBuckets(filteredInvoices), [filteredInvoices])
  const filtered = useMemo(() => (mode === 'all' ? filteredInvoices : filteredInvoices.filter((invoice) => invoice.mode === mode)), [filteredInvoices, mode])
  const groupedRows = useMemo(() => groupReportRows(filteredInvoices, filters.groupBy), [filteredInvoices, filters.groupBy])
  const profitReport = useMemo(() => buildProfitReport({ filteredInvoices, filteredItems, filteredHistory, report, profitPeriod }), [filteredInvoices, filteredItems, filteredHistory, report, profitPeriod])
  const monthlySeries = useMemo(() => [...(report.periods?.monthly || [])].slice(0, 12).reverse(), [report])
  const periodRows = report.periods?.[periodTable] || []
  const totalGeneral = buckets.taxed.total + buckets.noTax.total + buckets.mixed.total

  const refundsByInvoice = useMemo(() => {
    const map = new Map()
    ;(creditNotes || []).forEach((note) => {
      if (note.status === 'voided' || note.status === 'anulada' || note.status === 'draft' || note.status === 'deleted') return
      const refunds = (note.payments || []).filter((p) => !String(p.method || '').toLowerCase().includes('credito')).reduce((s, p) => s + Number(p.amount), 0)
      if (refunds > 0) map.set(note.invoiceId, (map.get(note.invoiceId) || 0) + refunds)
    })
    return map
  }, [creditNotes])

  const cashCreditSplitData = useMemo(() => {
    let cashTotal = 0, creditTotal = 0, cashCount = 0, creditCount = 0, creditPaid = 0, creditPending = 0
    filteredInvoices.forEach((inv) => {
      const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
      const hasCredit = payments.some((p) => String(p.method || '').toLowerCase().includes('credito'))
      const total = Number(inv.totals?.total || 0)
      const paid = Number(inv.paidAmount || 0)
      if (hasCredit) {
        const refunds = refundsByInvoice.get(inv.id) || 0
        const effectivePaid = Math.max(0, paid - refunds)
        creditTotal += total; creditCount += 1; creditPaid += effectivePaid; creditPending += Math.max(0, total - effectivePaid)
      } else { cashTotal += total; cashCount += 1 }
    })
    return { cashTotal, creditTotal, cashCount, creditCount, creditPaid, creditPending, pctCash: (cashTotal + creditTotal) > 0 ? (cashTotal / (cashTotal + creditTotal)) * 100 : 0 }
  }, [filteredInvoices, refundsByInvoice])

  const creditInvoiceDetails = useMemo(() => {
    return filteredInvoices.filter((inv) => {
      const payments = inv.payments?.length ? inv.payments : [{ method: inv.paymentMethod || 'Efectivo', amount: inv.totals?.total || 0 }]
      return payments.some((p) => String(p.method || '').toLowerCase().includes('credito'))
    }).map((inv) => {
      const total = Number(inv.totals?.total || 0); const paid = Number(inv.paidAmount || 0)
      const refunds = refundsByInvoice.get(inv.id) || 0
      const effectivePaid = Math.max(0, paid - refunds)
      return {
        number: inv.number || inv.ncf || '', customer: inv.customerName || '', date: inv.issuedAt || inv.createdAt || '',
        total: currency.format(total), paid: currency.format(effectivePaid), pending: currency.format(Math.max(0, total - effectivePaid)),
        pctPaid: total > 0 ? ((effectivePaid / total) * 100).toFixed(1) + '%' : '0%', status: inv.status || '',
      }
    })
  }, [filteredInvoices, refundsByInvoice])

  const barData = useMemo(() => ({
    labels: ['Filtrado'],
    datasets: [
      { label: 'Con ITBIS', data: [buckets.taxed.total], backgroundColor: '#3B82F6' },
      { label: 'Sin ITBIS', data: [buckets.noTax.total], backgroundColor: '#10B981' },
      { label: 'Mixtas', data: [buckets.mixed.total], backgroundColor: '#64748B' },
    ],
  }), [buckets])

  const monthlyData = useMemo(() => ({
    labels: monthlySeries.map((period) => period.label),
    datasets: [
      { label: 'ITBIS', data: monthlySeries.map((period) => period.tax || 0), borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, .16)', tension: 0.35, fill: true },
      { label: 'Ganancia neta', data: monthlySeries.map((period) => period.netProfit || 0), borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, .12)', tension: 0.35, fill: true },
    ],
  }), [monthlySeries])

  const distributionData = useMemo(() => ({
    labels: ['Con ITBIS', 'Sin ITBIS', 'Mixta'],
    datasets: [{ data: [buckets.taxed.total, buckets.noTax.total, buckets.mixed.total], backgroundColor: ['#3B82F6', '#10B981', '#64748B'] }],
  }), [buckets])

  function setFilter(key, value) {
    setFilters((state) => ({ ...state, [key]: value, quickRange: key.startsWith('date') || key.startsWith('time') || key === 'exactDate' ? 'custom' : state.quickRange }))
  }
  function setQuickRange(quickRange) { setFilters((state) => applyQuickRange(state, quickRange)) }
  function toggleDetail(key) {
    setActiveArea(key)
    setShowDetail((s) => ({ ...s, [key]: !s[key] }))
  }
  function scrollToReportTarget(targetId) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    })
  }
  function openReportArea(key, targetId = `report-area-${key}`) {
    setActiveArea(key)
    setShowDetail({ [key]: true })
    scrollToReportTarget(targetId)
  }
  function jumpToArea(key) {
    if (key === 'sheets') setSelectedSheetMode('all')
    openReportArea(key)
  }
  function focusReportPart(key, targetId) {
    openReportArea(key, targetId)
  }
  function openFiscalSheet(modeValue = 'all') {
    setSelectedSheetMode(modeValue)
    openReportArea('sheets', modeValue === 'all' ? 'report-area-sheets' : `report-sheet-${sheetIdFromMode(modeValue)}`)
  }

  const downloadProfessionalPdf = useCallback(async () => {
    try {
      const { downloadProfessionalReportPdf } = await import('../../services/professionalReportPdf')
      await downloadProfessionalReportPdf({ company, reportStats, generatedAt: new Date(), user: 'Usuario' })
    } catch (err) { console.error('Error generating professional PDF:', err) }
  }, [company, reportStats])

  function exportExcel() {
    const exportReportGroups = buildReportGroups(report.fiscalGroups || [], filteredInvoices, filteredItems)
    downloadCsvWorkbook('trifusion-reportes-avanzados.csv', [
      { name: 'Resumen', rows: [summaryRow(profitReport, filters)] },
      { name: 'Agrupacion', rows: groupedRows },
      { name: 'Facturas', rows: filteredInvoices.map(invoiceToExcelRow) },
      { name: 'Productos', rows: filteredItems },
      { name: 'Top productos', rows: report.topProducts || [] },
      { name: 'Clientes frecuentes', rows: report.frequentCustomers || [] },
      { name: 'Pagos', rows: report.paymentMethods || [] },
      { name: 'Inventario', rows: inventory.valuation?.products || report.inventoryValuation?.products || [] },
      { name: 'Kardex', rows: inventory.movements || [] },
      { name: 'Historial financiero', rows: filteredHistory },
      { name: 'Invalidos', rows: report.invalidDocuments || [] },
      { name: 'Duplicados', rows: report.duplicateDocuments || [] },
      ...exportReportGroups.flatMap((group) => [
        { name: `${group.sheetName} facturas`, rows: (group.invoices || []).map(invoiceToExcelRow) },
        { name: `${group.sheetName} productos`, rows: group.items || [] },
      ]),
    ])
  }

  async function downloadProfitPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(`Reporte de ganancias netas ${profitReport.label}`, 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${company?.name || 'Trifusion Technologies'} | ${describeFilters(filters)}`, 12, 21)
    autoTable(doc, { startY: 28, head: [['Indicador', 'Valor']], body: [['Ventas brutas', currency.format(profitReport.grossRevenue)], ['Notas de credito / devoluciones', currency.format(profitReport.creditTotal)], ['Ventas netas', currency.format(profitReport.netRevenue)], ['ITBIS', currency.format(profitReport.tax)], ['Costos reales', currency.format(profitReport.cost)], ['Ganancia neta', currency.format(profitReport.netProfit)], ['Margen', `${profitReport.margin.toFixed(2)}%`]], headStyles: { fillColor: [37, 99, 235], textColor: 255 } })
    autoTable(doc, { startY: doc.lastAutoTable.finalY + 10, head: [['Ranking', 'Producto', 'Cantidad', 'Ingresos', 'Ganancia', 'Seriales']], body: profitReport.topProducts.slice(0, 40).map((item, index) => [index + 1, item.name, item.quantity, currency.format(item.revenue), currency.format(item.profit), item.seriales || '']), styles: { fontSize: 8 }, headStyles: { fillColor: [16, 185, 129], textColor: 255 } })
    doc.save(`ganancias-netas-${profitPeriod}.pdf`)
  }

  async function downloadPdfGroup(modeValue) {
    const { downloadFiscalReportPdf } = await import('../../services/fiscalReportPdf')
    const group = buildReportGroups(report.fiscalGroups || [], filteredInvoices, filteredItems).find((item) => item.mode === modeValue)
    if (group) await downloadFiscalReportPdf({ company, group: withPdfMeta(group) })
  }
  async function downloadAllPdfs() {
    const { downloadFiscalReportPdf } = await import('../../services/fiscalReportPdf')
    for (const group of buildReportGroups(report.fiscalGroups || [], filteredInvoices, filteredItems)) await downloadFiscalReportPdf({ company, group: withPdfMeta(group) })
  }

  function export607() {
    const rows = filteredInvoices.filter((inv) => [invoiceModes.TAXED, invoiceModes.MIXED].includes(inv.mode)).map((inv) => `${inv.customerRnc || ''}|${inv.ncfType}|${inv.ncf || inv.number}|${String(inv.issuedAt || inv.date || '').slice(0, 10)}|${inv.totals?.subtotal || 0}|${inv.totals?.itbis || 0}`)
    const blob = new Blob([rows.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'DGII-607-Trifusion.txt'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="printable-report report-print-area space-y-4">
        <div className="module-header">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="module-header-eyebrow">Motor de reportes</p>
              <h2 className="module-header-title">Reportes ejecutivos</h2>
              <p className="module-header-desc">Ultima reconstruccion: {formatDate(report.generatedAt)}</p>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              <Button variant="primary" icon={FileText} onClick={downloadProfessionalPdf}>Reporte ejecutivo PDF</Button>
              <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
              <Button variant="ghost" icon={ArrowUpRight} onClick={() => openFiscalSheet(invoiceModes.TAXED)}>VENTAS CON ITBIS</Button>
              <Button variant="ghost" icon={ArrowUpRight} onClick={() => openFiscalSheet(invoiceModes.NO_TAX)}>VENTAS SIN ITBIS</Button>
              <Button variant="ghost" icon={ArrowUpRight} onClick={() => openFiscalSheet(invoiceModes.MIXED)}>VENTAS MIXTAS</Button>
              <Button variant="ghost" icon={Download} onClick={exportExcel}>Excel</Button>
              <Button variant="ghost" icon={Download} onClick={export607}>607</Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCardReport label="Ganancia neta" value={currency.format(profitReport.netProfit)} accent="green" />
            <MetricCardReport label="Margen de ganancia" value={`${profitReport.margin.toFixed(2)}%`} accent={profitReport.margin > 20 ? 'green' : profitReport.margin > 10 ? 'amber' : 'red'} />
            <MetricCardReport label="Ventas filtradas" value={currency.format(totalGeneral)} accent="blue" />
            <MetricCardReport label="Facturas analizadas" value={report.source?.validInvoiceCount || 0} accent="violet" raw />
          </div>
        </div>

        <section className="no-print rounded-2xl border border-[#243244] bg-[#111827] p-6 shadow-lg shadow-black/20 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                <Filter size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#F8FAFC]">Filtros avanzados</h3>
                <p className="text-xs text-[#94A3B8]">Encuentra exactamente la informacion que necesitas</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-300">{filteredInvoices.length} resultados</span>
              <button type="button" onClick={() => setShowFilters((s) => !s)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-[#94A3B8] transition hover:bg-[#1d4ed8]/10 hover:text-blue-300">
                <Filter size={14} />
                {showFilters ? 'Ocultar' : 'Mostrar'} filtros
              </button>
            </div>
          </div>

          {showFilters ? (
            <div className="mt-6 space-y-5">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  id="report-query"
                  value={filters.query}
                  onChange={(e) => setFilter('query', e.target.value)}
                  className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] pl-11 pr-4 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  placeholder="Buscar factura, cliente, producto, NCF, serie, vendedor..."
                 autoComplete="off" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1.5">
                  <label htmlFor="report-quick-range" className="text-xs font-bold text-[#94A3B8]">Periodo</label>
                  <select id="report-quick-range" value={filters.quickRange} onChange={(e) => setQuickRange(e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" autoComplete="off">{quickDateRanges.map((item) => <option key={item.id} value={item.id} className="bg-[#0f172a]">{item.label}</option>)}</select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-date-from" className="text-xs font-bold text-[#94A3B8]">Fecha inicio</label>
                  <input id="report-date-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-date-to" className="text-xs font-bold text-[#94A3B8]">Fecha fin</label>
                  <input id="report-date-to" type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-time-from" className="text-xs font-bold text-[#94A3B8]">Hora inicio</label>
                  <input id="report-time-from" type="time" value={filters.timeFrom} onChange={(e) => setFilter('timeFrom', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-time-to" className="text-xs font-bold text-[#94A3B8]">Hora fin</label>
                  <input id="report-time-to" type="time" value={filters.timeTo} onChange={(e) => setFilter('timeTo', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-exact-date" className="text-xs font-bold text-[#94A3B8]">Dia exacto</label>
                  <div className="relative">
                    <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                    <input id="report-exact-date" type="date" value={filters.exactDate} onChange={(e) => setFilter('exactDate', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] pl-9 pr-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1.5">
                  <label htmlFor="report-month" className="text-xs font-bold text-[#94A3B8]">Mes</label>
                  <input id="report-month" type="month" value={filters.month} onChange={(e) => setFilter('month', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-year" className="text-xs font-bold text-[#94A3B8]">Ano</label>
                  <input id="report-year" type="number" value={filters.year} onChange={(e) => setFilter('year', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="2026"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-amount-min" className="text-xs font-bold text-[#94A3B8]">Monto minimo</label>
                  <input id="report-amount-min" type="number" value={filters.amountMin} onChange={(e) => setFilter('amountMin', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="RD$ 0"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-amount-max" className="text-xs font-bold text-[#94A3B8]">Monto maximo</label>
                  <input id="report-amount-max" type="number" value={filters.amountMax} onChange={(e) => setFilter('amountMax', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="RD$ 999,999"  autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="report-status" className="text-xs font-bold text-[#94A3B8]">Estado</label>
                  <select id="report-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" autoComplete="off">
                    <option value="all" className="bg-[#0f172a]">Todos</option>
                    <option value="paid" className="bg-[#0f172a]">Pagada</option>
                    <option value="credit" className="bg-[#0f172a]">Credito</option>
                    <option value="voided" className="bg-[#0f172a]">Anulada</option>
                    <option value="issued" className="bg-[#0f172a]">Emitida</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#94A3B8]">Agrupar por</label>
                  <select id="report-group-by" value={filters.groupBy} onChange={(e) => setFilter('groupBy', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" autoComplete="off">
                    {groupOptions.map((item) => <option key={item.id} value={item.id} className="bg-[#0f172a]">{item.label}</option>)}
                  </select>
                </div>

              </div>

              <AdvancedFilters filters={filters} setFilter={setFilter} setQuickRange={setQuickRange} />

              <div className="flex items-center justify-between gap-3 border-t border-[#243244] pt-5">
                <button
                  type="button"
                  onClick={() => setFilters(() => applyQuickRange(defaultReportFilters(), 'today'))}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
                >
                  Limpiar filtros
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-[#94A3B8] transition hover:bg-white/[0.05] hover:text-[#F8FAFC]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:from-blue-500 hover:to-blue-400"
                  >
                    Aplicar filtros
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="report-nav-board no-print">
          <div className="report-nav-head">
            <div>
              <p className="module-header-eyebrow">Navegacion interna</p>
              <h3 className="font-display text-2xl font-bold">Areas del reporte</h3>
            </div>
            <span>{filteredInvoices.length} registro(s) filtrados</span>
          </div>
          <div className="report-nav-grid">
            {reportAreas.map((area) => {
              const meta = detailMeta(area.label)
              const open = Boolean(showDetail[area.key])
              const active = activeArea === area.key
              return (
                <button
                  key={area.key}
                  type="button"
                  onClick={() => jumpToArea(area.key)}
                  className={`report-nav-card report-nav-${area.accent} ${active ? 'active' : ''}`}
                >
                  <span className="report-nav-index">{meta.index}</span>
                  <span className="report-nav-copy">
                    <strong>{area.label}</strong>
                    <small>{meta.description}</small>
                  </span>
                  <span className="report-nav-action">
                    {open ? 'Abierto' : 'Abrir'}
                    <ArrowUpRight size={15} />
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <DetailSection id="report-area-overview" label="Resumen ejecutivo" open={showDetail['overview']} onToggle={() => toggleDetail('overview')}>
          <SectionActions actions={[
            { label: 'VENTAS CON ITBIS', accent: 'blue', onClick: () => openFiscalSheet(invoiceModes.TAXED) },
            { label: 'VENTAS SIN ITBIS', accent: 'green', onClick: () => openFiscalSheet(invoiceModes.NO_TAX) },
            { label: 'VENTAS MIXTAS', accent: 'violet', onClick: () => openFiscalSheet(invoiceModes.MIXED) },
            { label: 'Ganancias', accent: 'amber', onClick: () => focusReportPart('overview', 'report-profit-summary') },
          ]} />
          <div className="report-overview-stack">
            <section id="report-profit-summary" className="section-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase" style={{ color: 'var(--color-income)' }}>Rentabilidad</p>
                  <h3 className="font-display text-2xl font-bold">Resumen de ganancias {profitReport.label}</h3>
                </div>
                <div className="no-print flex items-center gap-2">
                  <select id="report-profit-period" value={profitPeriod} onChange={(e) => setProfitPeriod(e.target.value)} className="input-dark w-40" autoComplete="off">
                    <option value="filtered">Periodo filtrado</option>
                    <option value="historical">Historico</option>
                  </select>
                  <Button variant="primary" icon={Download} onClick={downloadProfitPdf}>PDF</Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <KpiBlock label="Ventas brutas" value={currency.format(profitReport.grossRevenue)} />
                <KpiBlock label="Devoluciones" value={currency.format(profitReport.creditTotal)} />
                <KpiBlock label="Ventas netas" value={currency.format(profitReport.netRevenue)} />
                <KpiBlock label="ITBIS" value={currency.format(profitReport.tax)} />
                <KpiBlock label="Costos" value={currency.format(profitReport.cost)} />
                <KpiBlock label="Ganancia neta" value={currency.format(profitReport.netProfit)} accent />
              </div>
            </section>
            <section className="grid gap-4 xl:grid-cols-3">
              <Bucket title="Facturas con ITBIS" bucket={buckets.taxed} />
              <Bucket title="Facturas sin ITBIS" bucket={buckets.noTax} noTax />
              <Bucket title="Facturas mixtas" bucket={buckets.mixed} />
            </section>
            <section className="grid gap-5 xl:grid-cols-3">
              <ChartPanel title="Ventas por tipo fiscal"><Bar data={barData} options={chartOptions} /></ChartPanel>
              <ChartPanel title="ITBIS y ganancia mensual"><LineChart data={monthlyData} options={chartOptions} /></ChartPanel>
              <ChartPanel title="Distribucion fiscal"><Doughnut data={distributionData} options={doughnutOptions} /></ChartPanel>
            </section>
          </div>
        </DetailSection>

        <DetailSection id="report-area-grouping" label="Agrupacion y acumulados" open={showDetail['grouping']} onToggle={() => toggleDetail('grouping')}>
          <SectionActions actions={[
            { label: 'Diario', accent: 'blue', onClick: () => { setPeriodTable('daily'); focusReportPart('grouping', 'report-period-table') } },
            { label: 'Semanal', accent: 'cyan', onClick: () => { setPeriodTable('weekly'); focusReportPart('grouping', 'report-period-table') } },
            { label: 'Mensual', accent: 'violet', onClick: () => { setPeriodTable('monthly'); focusReportPart('grouping', 'report-period-table') } },
            { label: 'Anual', accent: 'green', onClick: () => { setPeriodTable('annual'); focusReportPart('grouping', 'report-period-table') } },
          ]} />
          <div className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]">
            <div id="report-grouped-table">
            <Panel title={`Agrupacion por ${filters.groupBy}`}>
              <DataTable data={groupedRows} columns={groupColumns} emptyText="No hay datos agrupados." initialPageSize={12} />
            </Panel>
            </div>
            <div id="report-period-table">
            <Panel title="Acumulados por fecha">
              <div className="no-print mb-3 flex justify-end">
                <select id="report-period-select" value={periodTable} onChange={(e) => setPeriodTable(e.target.value)} className="input-dark w-36" autoComplete="off">
                  <option value="daily">Diario</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="annual">Anual</option>
                </select>
              </div>
              <DataTable data={periodRows} columns={periodColumns} emptyText="No hay acumulados." initialPageSize={12} />
            </Panel>
            </div>
          </div>
        </DetailSection>

        <DetailSection id="report-area-products" label="Productos y clientes" open={showDetail['products']} onToggle={() => toggleDetail('products')}>
          <SectionActions actions={[
            { label: 'Productos vendidos', accent: 'green', onClick: () => focusReportPart('products', 'report-products-table') },
            { label: 'Clientes frecuentes', accent: 'cyan', onClick: () => focusReportPart('products', 'report-customers-table') },
            { label: 'Ranking ganancia', accent: 'amber', onClick: () => focusReportPart('products', 'report-products-table') },
          ]} />
          <div className="grid gap-5 xl:grid-cols-2">
            <div id="report-products-table">
            <Panel title="Productos mas vendidos">
              <DataTable data={profitReport.topProducts} columns={productColumns} emptyText="Sin datos." initialPageSize={10} />
            </Panel>
            </div>
            <div id="report-customers-table">
            <Panel title="Clientes mas frecuentes">
              <DataTable data={report.frequentCustomers || []} columns={customerColumns} emptyText="Sin datos." initialPageSize={10} />
            </Panel>
            </div>
          </div>
        </DetailSection>

        <DetailSection id="report-area-cashCredit" label="Desglose Contado / Credito" open={showDetail['cashCredit']} onToggle={() => toggleDetail('cashCredit')}>
          <SectionActions actions={[
            { label: 'Resumen contado', accent: 'green', onClick: () => focusReportPart('cashCredit', 'report-cash-credit-summary') },
            { label: 'Ventas a credito', accent: 'amber', onClick: () => focusReportPart('cashCredit', 'report-credit-detail') },
            { label: 'Pendientes', accent: 'red', onClick: () => focusReportPart('cashCredit', 'report-credit-detail') },
          ]} />
          <div className="grid gap-5 xl:grid-cols-2">
            <div id="report-cash-credit-summary">
            <Panel title="Resumen Contado vs Credito">
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiBlock label="Ventas Contado" value={currency.format(cashCreditSplitData.cashTotal)} accent />
                <KpiBlock label="Ventas Credito" value={currency.format(cashCreditSplitData.creditTotal)} />
                <KpiBlock label="Porc. Contado" value={`${cashCreditSplitData.pctCash.toFixed(1)}%`} accent />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <KpiBlock label="Facturas Contado" value={String(cashCreditSplitData.cashCount)} accent />
                <KpiBlock label="Facturas Credito" value={String(cashCreditSplitData.creditCount)} />
                <KpiBlock label="Total Facturas" value={String(cashCreditSplitData.cashCount + cashCreditSplitData.creditCount)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <KpiBlock label="Cobrado de Creditos" value={currency.format(cashCreditSplitData.creditPaid)} />
                <KpiBlock label="Pendiente de Creditos" value={currency.format(cashCreditSplitData.creditPending)} accent="red" />
                <KpiBlock label="% Recuperado" value={cashCreditSplitData.creditTotal > 0 ? `${((cashCreditSplitData.creditPaid / cashCreditSplitData.creditTotal) * 100).toFixed(1)}%` : '0%'} />
                <KpiBlock label="Deuda Promedio" value={currency.format(cashCreditSplitData.creditCount > 0 ? cashCreditSplitData.creditPending / cashCreditSplitData.creditCount : 0)} />
              </div>
            </Panel>
            </div>
            <div id="report-credit-detail">
            <Panel title="Detalle de Ventas a Credito">
              <DataTable data={creditInvoiceDetails} columns={creditInvoiceColumns} emptyText="No hay facturas a credito." initialPageSize={10} />
            </Panel>
            </div>
          </div>
        </DetailSection>

        <DetailSection id="report-area-payments" label="Pagos e inventario" open={showDetail['payments']} onToggle={() => toggleDetail('payments')}>
          <SectionActions actions={[
            { label: 'Metodos de pago', accent: 'green', onClick: () => focusReportPart('payments', 'report-payment-methods') },
            { label: 'Inventario valorizado', accent: 'cyan', onClick: () => focusReportPart('payments', 'report-inventory-value') },
            { label: 'Costos', accent: 'violet', onClick: () => focusReportPart('payments', 'report-inventory-value') },
          ]} />
          <div className="grid gap-5 xl:grid-cols-2">
            <div id="report-payment-methods">
            <Panel title="Ingresos por metodo de pago">
              <DataTable data={groupReportRows(filteredInvoices, 'payment')} columns={paymentGroupColumns} emptyText="Sin pagos." initialPageSize={10} />
            </Panel>
            </div>
            <div id="report-inventory-value">
            <Panel title="Inventario valorizado">
              <div className="mb-3 grid gap-3 sm:grid-cols-3">
                <KpiBlock label="Costo total" value={currency.format(inventory.valuation?.totalCost || report.inventoryValuation?.totalCost || 0)} />
                <KpiBlock label="Productos" value={(inventory.valuation?.products || report.inventoryValuation?.products || []).length} raw />
              </div>
              <DataTable data={inventory.valuation?.products || report.inventoryValuation?.products || []} columns={inventoryColumns} emptyText="Sin inventario." initialPageSize={10} />
            </Panel>
            </div>
          </div>
        </DetailSection>



        <DetailSection id="report-area-sheets" label="Hojas fiscales separadas" open={showDetail['sheets']} onToggle={() => toggleDetail('sheets')}>
          <SectionActions actions={[
            { label: 'Todas', accent: 'violet', onClick: () => openFiscalSheet('all') },
            { label: 'Con ITBIS', accent: 'blue', onClick: () => openFiscalSheet(invoiceModes.TAXED) },
            { label: 'Sin ITBIS', accent: 'green', onClick: () => openFiscalSheet(invoiceModes.NO_TAX) },
            { label: 'Mixtas', accent: 'amber', onClick: () => openFiscalSheet(invoiceModes.MIXED) },
          ]} />
          {selectedSheetMode === 'all' ? (
            <FiscalSheetLauncher groups={fiscalSheetGroups} onOpen={openFiscalSheet} />
          ) : (
            <div className="space-y-5">
              {visibleReportGroups.map((group) => <ReportSheet key={group.mode} group={group} onBack={() => openFiscalSheet('all')} onDownload={() => downloadPdfGroup(group.mode)} />)}
            </div>
          )}
        </DetailSection>

        <DetailSection id="report-area-kardex" label="Kardex e historial financiero" open={showDetail['kardex']} onToggle={() => toggleDetail('kardex')}>
          <SectionActions actions={[
            { label: 'Kardex', accent: 'cyan', onClick: () => focusReportPart('kardex', 'report-kardex-table') },
            { label: 'Historial financiero', accent: 'violet', onClick: () => focusReportPart('kardex', 'report-history-table') },
            { label: 'Trazabilidad', accent: 'green', onClick: () => focusReportPart('kardex', 'report-history-table') },
          ]} />
          <div className="grid gap-5 xl:grid-cols-2">
            <div id="report-kardex-table">
            <Panel title="Kardex / movimientos">
              <DataTable data={filterReportRows(inventory.movements || [], filters, { searchableFields: ['productName', 'sku', 'type', 'documentNumber', 'reference', 'serials'] })} columns={movementColumns} emptyText="Sin movimientos." initialPageSize={25} />
            </Panel>
            </div>
            <div id="report-history-table">
            <Panel title="Historial financiero">
              <DataTable data={filteredHistory} columns={historyColumns} emptyText="Sin historial." initialPageSize={25} />
            </Panel>
            </div>
          </div>
        </DetailSection>

        <DetailSection id="report-area-exclusions" label="Exclusiones del motor" open={showDetail['exclusions']} onToggle={() => toggleDetail('exclusions')}>
          <SectionActions actions={[
            { label: 'Invalidos', accent: 'red', onClick: () => focusReportPart('exclusions', 'report-exclusions-table') },
            { label: 'Duplicados', accent: 'amber', onClick: () => focusReportPart('exclusions', 'report-exclusions-table') },
            { label: 'Revision motor', accent: 'blue', onClick: () => focusReportPart('exclusions', 'report-exclusions-table') },
          ]} />
          <div id="report-exclusions-table">
          <Panel title="Documentos invalidos y duplicados">
            <DataTable data={[...(report.invalidDocuments || []), ...(report.duplicateDocuments || [])]} columns={exclusionColumns} emptyText="Sin documentos invalidos ni duplicados." initialPageSize={10} />
          </Panel>
          </div>
        </DetailSection>
      </div>
    </div>
  )
}

function DetailSection({ id, label, open, onToggle, children }) {
  const meta = detailMeta(label)
  if (!open) return null
  return (
    <section id={id} className="report-workspace-section">
      <div className="report-workspace-titlebar">
        <span className="report-entry-index">{meta.index}</span>
        <span className="min-w-0 flex-1">
          <span className="report-entry-title">{label}</span>
          <span className="report-entry-desc">{meta.description}</span>
        </span>
        <span className="report-entry-action">Activo</span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function SectionActions({ actions }) {
  return (
    <div className="report-section-actions no-print">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={`report-section-action report-nav-${action.accent || 'blue'}`}
        >
          <span>{action.label}</span>
          <ArrowUpRight size={15} />
        </button>
      ))}
    </div>
  )
}

function detailMeta(label) {
  const items = {
    'Resumen ejecutivo': { index: '00', description: 'Indicadores principales, rentabilidad y graficas del periodo.' },
    'Agrupacion y acumulados': { index: '01', description: 'Resumen por criterio y acumulados por periodo.' },
    'Productos y clientes': { index: '02', description: 'Ranking de productos vendidos y clientes frecuentes.' },
    'Desglose Contado / Credito': { index: '03', description: 'Comparacion de ventas, pagos y balances por condicion.' },
    'Pagos e inventario': { index: '04', description: 'Ingresos por metodo y valorizacion del inventario.' },
    'Hojas fiscales separadas': { index: '05', description: 'Carga el dia actual; usa busqueda o filtros para historicos.' },
    'Kardex e historial financiero': { index: '06', description: 'Movimientos de inventario y trazabilidad financiera.' },
    'Exclusiones del motor': { index: '07', description: 'Documentos ignorados, duplicados o invalidos.' },
  }
  return items[label] || { index: '00', description: 'Abrir detalle del reporte.' }
}

function MetricCardReport({ label, value, accent, raw }) {
  const colors = { green: 'var(--color-income)', blue: 'var(--color-nav)', amber: 'var(--color-pending)', red: 'var(--color-alert)', violet: 'var(--color-analytics)' }
  return (
    <div className="summary-chip" style={{ background: `color-mix(in srgb, ${colors[accent] || colors.blue} 8%, transparent)` }}>
      <span className="summary-chip-label">{label}</span>
      <span className="summary-chip-value">{raw ? value : value}</span>
    </div>
  )
}

function KpiBlock({ label, value, raw, accent }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: accent ? 'rgba(16,185,129,.08)' : 'rgba(255,255,255,.035)' }}>
      <p className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: accent ? 'var(--color-income)' : 'var(--text-secondary)' }}>{label}</p>
      <p className="mt-1 font-display text-xl font-bold tracking-tight" style={{ color: accent ? 'var(--color-income)' : 'var(--text-primary)' }}>{raw ? value : value}</p>
    </div>
  )
}

function AdvancedFilters({ filters, setFilter, setQuickRange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-[#243244]">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-[#94A3B8] transition hover:bg-white/[0.03] hover:text-[#F8FAFC]"
      >
        <span>Mas filtros</span>
        <ChevronDown size={15} className={`transition duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-[#243244] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#94A3B8]">Vendedor</label>
            <input id="report-seller" value={filters.seller || ''} onChange={(e) => setFilter('seller', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="Vendedor"  autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#94A3B8]">Metodo de pago</label>
            <input id="report-payment-method" value={filters.paymentMethod || ''} onChange={(e) => setFilter('paymentMethod', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="Efectivo, Tarjeta..."  autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#94A3B8]">Tipo NCF</label>
            <input id="report-ncf-type" value={filters.ncfType || ''} onChange={(e) => setFilter('ncfType', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="B01, B02..."  autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#94A3B8]">Cliente</label>
            <input id="report-customer" value={filters.customer || ''} onChange={(e) => setFilter('customer', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="Nombre del cliente"  autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#94A3B8]">Categoria</label>
            <input id="report-category" value={filters.category || ''} onChange={(e) => setFilter('category', e.target.value)} className="h-11 w-full rounded-xl border border-[#243244] bg-[#0f172a] px-3 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#94A3B8]/60 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" placeholder="Categoria"  autoComplete="off" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReportSheet({ group, onDownload, onBack }) {
  const [activeView, setActiveView] = useState('summary')
  return (
    <article id={`report-sheet-${group.id || sheetIdFromMode(group.mode)}`}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase" style={{ color: 'var(--color-nav)' }}>Hoja separada</p>
          <h2 className="font-display text-2xl font-bold">{group.title}</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{group.description}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onBack}>Volver a hojas</Button>
          <Button variant="ghost" icon={Download} onClick={onDownload}>PDF</Button>
        </div>
      </div>

      <div className="fiscal-sheet-tabs no-print">
        {[
          { id: 'summary', label: 'Resumen', value: currency.format(group.bucket?.total || 0) },
          { id: 'invoices', label: 'Facturas', value: group.bucket?.count || 0 },
          { id: 'items', label: 'Productos vendidos', value: (group.items || []).length },
        ].map((item) => (
          <button key={item.id} type="button" onClick={() => setActiveView(item.id)} className={activeView === item.id ? 'active' : ''}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </button>
        ))}
      </div>

      {activeView === 'summary' ? (
        <div className="fiscal-sheet-summary">
          <Line label="Facturas" value={group.bucket?.count || 0} raw />
          <Line label="Subtotal" value={group.noTax ? group.bucket?.total : group.bucket?.subtotal} />
          <Line label="ITBIS" value={group.noTax ? 0 : group.bucket?.itbis} />
          <Line label="Total" value={group.bucket?.total} />
          <Line label="Ganancia" value={group.bucket?.profit} />
          <Line label="Productos" value={(group.items || []).length} raw />
        </div>
      ) : null}

      {activeView === 'invoices' ? (
        <div id={`report-sheet-${group.id || sheetIdFromMode(group.mode)}-invoices`} className="report-sheet-detail">
          <DataTable data={group.invoices || []} columns={invoiceColumns} emptyText={`Sin facturas en ${group.title}.`} />
        </div>
      ) : null}

      {activeView === 'items' ? (
        <div id={`report-sheet-${group.id || sheetIdFromMode(group.mode)}-items`} className="report-sheet-detail">
          <DataTable data={group.items || []} columns={itemColumns} emptyText="Sin productos." />
        </div>
      ) : null}
    </article>
  )
}

function sheetIdFromMode(modeValue) {
  if (modeValue === invoiceModes.NO_TAX) return 'noTax'
  if (modeValue === invoiceModes.MIXED) return 'mixed'
  return 'taxed'
}

function buildReportGroups(baseGroups, invoices, items) {
  return (baseGroups.length ? baseGroups : EMPTY_REPORT.fiscalGroups).map((group) => {
    const groupInvoices = invoices.filter((inv) => inv.mode === group.mode)
    const invoiceKeys = new Set(groupInvoices.map((inv) => inv.ncf || inv.number))
    const groupItems = items.filter((item) => invoiceKeys.has(item.factura) || groupInvoices.some((inv) => inv.customerName === item.cliente && String(inv.issuedAt || inv.date || '').slice(0, 10) === String(item.fecha || '').slice(0, 10)))
    return { ...group, invoices: groupInvoices, items: groupItems, bucket: buildBucket(groupInvoices) }
  })
}

function buildBuckets(invoices) {
  return {
    taxed: buildBucket(invoices.filter((inv) => inv.mode === invoiceModes.TAXED)),
    noTax: buildBucket(invoices.filter((inv) => inv.mode === invoiceModes.NO_TAX)),
    mixed: buildBucket(invoices.filter((inv) => inv.mode === invoiceModes.MIXED)),
  }
}

function buildBucket(invoices) {
  return invoices.reduce((bucket, inv) => ({
    count: bucket.count + 1, documents: bucket.documents + 1,
    subtotal: bucket.subtotal + Number(inv.totals?.subtotal || 0),
    tax: bucket.tax + Number(inv.totals?.itbis || 0),
    itbis: bucket.itbis + Number(inv.totals?.itbis || 0),
    total: bucket.total + Number(inv.totals?.total || 0),
    profit: bucket.profit + itemProfit(inv),
    netProfit: bucket.netProfit + itemProfit(inv),
  }), { count: 0, documents: 0, subtotal: 0, tax: 0, itbis: 0, total: 0, profit: 0, netProfit: 0 })
}

function buildProfitReport({ filteredInvoices, filteredItems, filteredHistory, report, profitPeriod }) {
  if (profitPeriod === 'historical') {
    const h = report.periods?.historical || {}
    return { label: 'historica', grossRevenue: h.grossSales || h.total || 0, creditTotal: h.returns || 0, netRevenue: h.total || 0, tax: h.tax || h.itbis || 0, cost: h.cost || 0, netProfit: h.netProfit || h.profit || 0, margin: h.margin || 0, topProducts: report.topProducts || [] }
  }
  const grossRevenue = filteredInvoices.reduce((s, inv) => s + Number(inv.totals?.total || 0), 0)
  const tax = filteredInvoices.reduce((s, inv) => s + Number(inv.totals?.itbis || 0), 0)
  const cost = filteredItems.reduce((s, item) => s + Number(item.costo || 0), 0)
  const subtotal = filteredInvoices.reduce((s, inv) => s + Number(inv.totals?.subtotal || 0), 0)
  const creditTotal = filteredHistory.filter((item) => item.type === 'Nota de credito').reduce((s, item) => s + Math.abs(Number(item.amount || item.total || 0)), 0)
  const netRevenue = Math.max(grossRevenue - creditTotal, 0)
  const netProfit = subtotal - cost - creditTotal
  return { label: 'filtrada', grossRevenue, creditTotal, netRevenue, tax, cost, netProfit, margin: subtotal > 0 ? (netProfit / subtotal) * 100 : 0, topProducts: buildTopProducts(filteredItems) }
}

function buildTopProducts(items) {
  const map = new Map()
  items.forEach((item) => {
    const key = item.sku || item.producto
    const cur = map.get(key) || { name: item.producto || 'Producto', sku: item.sku || '', quantity: 0, revenue: 0, cost: 0, profit: 0, seriales: '' }
    cur.quantity += Number(item.cantidad || 0); cur.revenue += Number(item.total || 0); cur.cost += Number(item.costo || 0); cur.profit += Number(item.ganancia || 0); cur.seriales = [cur.seriales, item.seriales].filter(Boolean).join(', ')
    map.set(key, cur)
  })
  return [...map.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 100)
}

function withPdfMeta(group) {
  const meta = { taxed: { file: 'ventas-con-itbis', accent: [37, 99, 235] }, noTax: { file: 'ventas-sin-itbis', accent: [16, 185, 129] }, mixed: { file: 'ventas-mixtas', accent: [100, 116, 139] } }[group.id] || { file: 'reporte-fiscal', accent: [37, 99, 235] }
  return { ...group, ...meta, payments: groupReportRows(group.invoices || [], 'payment').map((row) => ({ method: row.group, count: row.documents, total: row.total })) }
}

function summaryRow(profitReport, filters) {
  return { filtros: describeFilters(filters), ventasBrutas: profitReport.grossRevenue, notasCredito: profitReport.creditTotal, ventasNetas: profitReport.netRevenue, itbis: profitReport.tax, costos: profitReport.cost, ganancia: profitReport.netProfit, margen: profitReport.margin }
}

function itemProfit(invoice) {
  if (invoice.items?.length) return invoice.items.reduce((s, item) => s + Number(item.net || 0) - Number(item.cost || 0) * Number(item.quantity || 0), 0)
  return invoice.totals?.profit ?? (invoice.totals?.subtotal ?? 0) - (invoice.totals?.cost ?? 0)
}

function invoiceToExcelRow(invoice) {
  return { factura: invoice.number || '', ncf: invoice.ncf || '', tipoNCF: invoice.ncfType || '', cliente: invoice.customerName || '', rncCedula: invoice.customerRnc || '', fecha: invoice.issuedAt || invoice.date || '', modo: invoice.mode || '', estado: invoice.status || '', metodoPago: invoice.paymentMethod || '', vendedor: invoice.seller || '', productos: invoice.products || 0, subtotal: invoice.totals?.subtotal || 0, subtotalGravado: invoice.totals?.taxableSubtotal || 0, subtotalExento: invoice.totals?.exemptSubtotal || 0, itbis: invoice.totals?.itbis || 0, total: invoice.totals?.total || 0, costo: invoice.totals?.cost ?? (invoice.items?.length ? invoice.items.reduce((s, item) => s + Number(item.cost || 0) * Number(item.quantity || 0), 0) : 0), ganancia: itemProfit(invoice) }
}

function Bucket({ title, bucket, noTax }) {
  return <div ><h3 className="font-display text-xl font-bold">{title}</h3><div className="mt-4 space-y-2 text-sm"><Line label="Facturas" value={bucket.count || bucket.documents} raw /><Line label={noTax ? 'Total' : 'Subtotal'} value={noTax ? bucket.total : bucket.subtotal} />{!noTax ? <Line label="ITBIS" value={bucket.itbis || bucket.tax} /> : null}<Line label="Total neto" value={bucket.total} /><Line label="Ganancia" value={bucket.profit || bucket.netProfit} /></div></div>
}

function Line({ label, value, raw }) {
  return <div className="flex justify-between gap-4"><span style={{ color: 'rgba(255,255,255,.5)' }}>{label}</span><span className="font-bold">{raw ? value : currency.format(value || 0)}</span></div>
}

function ChartPanel({ title, children }) {
  return <div className="flex min-h-[240px] flex-col sm:min-h-[300px]"><h3 className="mb-3 font-display text-lg font-bold">{title}</h3><div className="min-h-0 flex-1">{children}</div></div>
}

function Panel({ title, children }) {
  return <section className="section-card"><h3 className="mb-4 font-display text-xl font-bold">{title}</h3>{children}</section>
}

const groupColumns = [
  { header: 'Grupo', accessorKey: 'group' }, { header: 'Docs', accessorKey: 'documents' }, { header: 'Cantidad', accessorKey: 'quantity' },
  { header: 'Total', cell: ({ row }) => currency.format(row.original.total) }, { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.profit) },
]
const periodColumns = [
  { header: 'Periodo', accessorKey: 'label' }, { header: 'Docs', cell: ({ row }) => row.original.documents || row.original.count || 0 },
  { header: 'Ventas brutas', cell: ({ row }) => currency.format(row.original.grossSales || 0) }, { header: 'Ventas netas', cell: ({ row }) => currency.format(row.original.total || 0) },
  { header: 'ITBIS', cell: ({ row }) => currency.format(row.original.tax || row.original.itbis || 0) }, { header: 'Costos', cell: ({ row }) => currency.format(row.original.cost || 0) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.netProfit || row.original.profit || 0) },
]
const invoiceColumns = [
  { header: 'No.', accessorKey: 'number' }, { header: 'NCF', cell: ({ row }) => row.original.ncf || row.original.number },
  { header: 'Cliente', accessorKey: 'customerName' }, { header: 'Fecha', cell: ({ row }) => formatDate(row.original.issuedAt || row.original.date) },
  { header: 'Modo', accessorKey: 'mode' }, { header: 'Pago', accessorKey: 'paymentMethod' },
  { header: 'Subtotal', cell: ({ row }) => currency.format(row.original.totals?.subtotal || 0) }, { header: 'ITBIS', cell: ({ row }) => currency.format(row.original.totals?.itbis || 0) },
  { header: 'Total', cell: ({ row }) => currency.format(row.original.totals?.total || 0) }, { header: 'Ganancia', cell: ({ row }) => currency.format(itemProfit(row.original)) },
]
const itemColumns = [
  { header: 'Factura', accessorKey: 'factura' }, { header: 'Cliente', accessorKey: 'cliente' }, { header: 'Producto', accessorKey: 'producto' }, { header: 'SKU', accessorKey: 'sku' },
  { header: 'Cantidad', accessorKey: 'cantidad' }, { header: 'Precio', cell: ({ row }) => currency.format(row.original.precio) }, { header: 'Subtotal', cell: ({ row }) => currency.format(row.original.subtotal) },
  { header: 'ITBIS', cell: ({ row }) => currency.format(row.original.itbis) }, { header: 'Total', cell: ({ row }) => currency.format(row.original.total) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.ganancia) },
]
const productColumns = [
  { header: 'Producto', accessorKey: 'name' }, { header: 'SKU', accessorKey: 'sku' }, { header: 'Cantidad', accessorKey: 'quantity' },
  { header: 'Ingresos', cell: ({ row }) => currency.format(row.original.revenue || 0) }, { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost || 0) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.profit || 0) },
]
const customerColumns = [
  { header: 'Cliente', accessorKey: 'name' }, { header: 'RNC/Cedula', accessorKey: 'rnc' }, { header: 'Facturas', accessorKey: 'documents' },
  { header: 'Notas', accessorKey: 'creditNotes' }, { header: 'Ventas netas', cell: ({ row }) => currency.format(row.original.netRevenue || 0) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.netProfit || 0) },
]
const paymentGroupColumns = [
  { header: 'Metodo', accessorKey: 'group' }, { header: 'Operaciones', accessorKey: 'documents' }, { header: 'Ingresos netos', cell: ({ row }) => currency.format(row.original.total || 0) }, { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.profit || 0) },
]
const creditInvoiceColumns = [
  { header: 'Factura', accessorKey: 'number' }, { header: 'Cliente', accessorKey: 'customer' }, { header: 'Fecha', accessorKey: 'date' },
  { header: 'Total', accessorKey: 'total' }, { header: 'Pagado', accessorKey: 'paid' }, { header: 'Pendiente', accessorKey: 'pending' },
  { header: '% Pagado', accessorKey: 'pctPaid' }, { header: 'Estado', accessorKey: 'status' },
]
const inventoryColumns = [
  { header: 'Producto', accessorKey: 'name' }, { header: 'SKU', accessorKey: 'sku' }, { header: 'Categoria', accessorKey: 'category' },
  { header: 'Stock', accessorKey: 'stock' }, { header: 'Costo unit.', cell: ({ row }) => currency.format(row.original.cost || 0) }, { header: 'Valor costo', cell: ({ row }) => currency.format(row.original.valueCost || row.original.costValue || 0) },
]
const movementColumns = [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.createdAt || row.original.date) }, { header: 'Tipo', accessorKey: 'type' },
  { header: 'Producto', accessorKey: 'productName' }, { header: 'Documento', accessorKey: 'documentNumber' },
  { header: 'Antes', accessorKey: 'quantityBefore' }, { header: 'Despues', accessorKey: 'quantityAfter' }, { header: 'Cantidad', accessorKey: 'signedQuantity' }, { header: 'Seriales', cell: ({ row }) => (row.original.serials || []).join(', ') },
]
const historyColumns = [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date) }, { header: 'Tipo', accessorKey: 'type' }, { header: 'Documento', accessorKey: 'number' },
  { header: 'Cliente', accessorKey: 'customer' }, { header: 'Monto', cell: ({ row }) => currency.format(row.original.amount || 0) }, { header: 'Estado', accessorKey: 'status' }, { header: 'Detalle', accessorKey: 'description' },
]
const exclusionColumns = [
  { header: 'Documento', accessorKey: 'number' }, { header: 'Estado', accessorKey: 'status' }, { header: 'Motivo', accessorKey: 'reason' }, { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date) },
]

const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } } } }
const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } } }
