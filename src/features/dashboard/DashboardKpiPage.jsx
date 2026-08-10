import { useMemo, useState } from 'react'
import { Bar, Doughnut, Line as LineChart } from 'react-chartjs-2'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ChevronDown, Download, ExternalLink, FileSpreadsheet, Pencil, Printer, Search, Users, Warehouse, Wallet } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { buildCashCutReport, cashMovementSignedAmount } from '../../lib/cashDeskEngine'
import { downloadCsvWorkbook } from '../../lib/csvExport'
import { dayKeyInSystemZone, parseDate as parseSystemDate, todayIso } from '../../lib/dateTime'
import { buildExecutiveDashboardModel } from '../../lib/executiveDashboardEngine'
import { currency, formatDate } from '../../lib/formatters'
import { isActiveProduct, isActiveReceivable, isReportableInvoice as isRealInvoice, sanitizeCashRegisterWithSources } from '../../lib/realDataGuards'
import { useERPStore } from '../../store/useERPStore'

const moduleConfig = {
  'ventas-hoy': { title: 'Ventas de hoy', type: 'sales', range: 'today', description: 'Ventas por hora, historial del dia, productos vendidos, caja y movimientos relacionados.' },
  'ventas-semana': { title: 'Ventas semana', type: 'sales', range: 'week', description: 'Facturas validas de la semana actual con detalle auditable.' },
  'ventas-mes': { title: 'Ventas del mes', type: 'sales', range: 'month', description: 'Listado mensual de facturas, clientes relacionados, ganancias y analisis de ventas.' },
  'ventas-credito': { title: 'Ventas credito', type: 'receivables', range: 'month', description: 'Facturas a credito, abonos, balances y estado de cuentas por cobrar.' },
  'abonos-hoy': { title: 'Abonos recibidos hoy', type: 'abonos', range: 'today', description: 'Todos los pagos recibidos en cuentas de credito durante el dia de hoy.' },
  'abonos-mes': { title: 'Abonos recibidos mes', type: 'abonos', range: 'month', description: 'Todos los pagos recibidos en cuentas de credito durante el mes actual.' },
  'cobros-hoy': { title: 'Cobros hoy', type: 'cash', range: 'today', description: 'Movimientos reales de caja registrados hoy.' },
  'cobros-semana': { title: 'Cobros semana', type: 'cash', range: 'week', description: 'Movimientos reales de caja de la semana actual.' },
  'cobros-mes': { title: 'Cobros mes', type: 'cash', range: 'month', description: 'Movimientos reales de caja del mes actual.' },
  'ganancia-mes': { title: 'Ganancia mes', type: 'profit', range: 'month', description: 'Ganancias reales, costos, margenes y productos rentables registrados.' },
  'stock-critico': { title: 'Stock critico', type: 'stock', range: 'all', description: 'Productos agotados, productos criticos, historial de movimientos y reposicion.' },
  'productos-agotados': { title: 'Productos agotados', type: 'stock', range: 'all', description: 'Productos activos con existencia cero.' },
  'productos-bajo-minimo': { title: 'Productos bajo minimo', type: 'stock', range: 'all', description: 'Productos activos por debajo de su minimo de reposicion.' },
  'clientes-nuevos': { title: 'Clientes nuevos', type: 'customers', range: 'today', description: 'Historial de clientes, balances, compras realizadas y estadisticas comerciales.' },
  'cuentas-por-cobrar': { title: 'Cuentas por cobrar', type: 'receivables', range: 'all', description: 'Balances pendientes, vencimientos, historial de pagos y estados de cuenta.' },
  'facturas-pendientes': { title: 'Facturas pendientes', type: 'receivables', range: 'all', description: 'Facturas con balance pendiente y cuenta por cobrar activa.' },
  'facturas-vencidas': { title: 'Facturas vencidas', type: 'receivables', range: 'all', description: 'Facturas pendientes con fecha de vencimiento vencida.' },
  'clientes-deuda': { title: 'Clientes con deuda', type: 'receivables', range: 'all', description: 'Clientes con cuentas por cobrar abiertas.' },
  'impuestos-mes': { title: 'Impuestos mes', type: 'taxes', range: 'month', description: 'Impuestos calculados, facturas relacionadas, resumen mensual e historial visual.' },
  'caja-actual': { title: 'Caja actual', type: 'cash', range: 'today', description: 'Aperturas, cierres, ingresos, egresos, arqueos, metodos de pago y ventas relacionadas.' },
  'facturas-credito': { title: 'Facturas credito activas', type: 'receivables', range: 'all', description: 'Facturas a credito con balance pendiente, abonos y vencimientos.' },
  'facturas-fiadas': { title: 'Facturas fiadas', type: 'receivables', range: 'all', description: 'Facturas fiadas sin abono inicial.' },
  'facturas-parciales': { title: 'Facturas parciales', type: 'receivables', range: 'all', description: 'Facturas con abonos parciales y balance pendiente.' },
  'clientes-morosos': { title: 'Clientes morosos', type: 'receivables', range: 'all', description: 'Clientes con facturas vencidas y gestion de cobro.' },
  'resumen-ejecutivo': { title: 'Resumen ejecutivo', type: 'executive', range: 'month', description: 'Panel completo con metricas clave, ventas al contado vs credito, productos destacados y flujo de caja.' },
}

export function DashboardKpiPage() {
  const navigate = useNavigate()
  const { moduleId = 'ventas-mes' } = useParams()
  const config = moduleConfig[moduleId] || moduleConfig['ventas-mes']
  const company = useERPStore((state) => state.company)
  const invoices = useERPStore((state) => state.invoices)
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const receivables = useERPStore((state) => state.receivables)
  const payments = useERPStore((state) => state.payments)
  const expenses = useERPStore((state) => state.expenses)
  const creditNotes = useERPStore((state) => state.creditNotes)
  const cashRegister = useERPStore((state) => state.cashRegister)
  const branches = useERPStore((state) => state.branches)
  const reportStats = useERPStore((state) => state.reportStats)
  const inventoryReports = useERPStore((state) => state.inventoryReports)
  const [filters, setFilters] = useState(() => ({ ...rangeFor(config.range), query: '', timeFrom: '', timeTo: '' }))
  const [showFilters, setShowFilters] = useState(true)
  const model = useMemo(() => buildExecutiveDashboardModel({ invoices, products, customers, receivables, expenses, creditNotes, payments, cashRegister, reportStats, inventoryReports }), [cashRegister, creditNotes, customers, expenses, inventoryReports, invoices, payments, products, receivables, reportStats])
  const cashCut = useMemo(() => buildCashCutReport({ cashRegister, invoices, creditNotes, expenses, receivables, payments, company, branches }), [branches, cashRegister, company, creditNotes, expenses, invoices, payments, receivables])
  const report = useMemo(() => buildKpiReport(config.type, { filters, model, cashCut, invoices, products, customers, receivables, expenses, creditNotes, payments, cashRegister, companyId: company.id }), [cashCut, cashRegister, company.id, config.type, creditNotes, customers, expenses, filters, invoices, model, payments, products, receivables])
  const columns = useMemo(() => report.tableColumns || report.columns.map((column) => ({ header: column, accessorKey: column })), [report.columns, report.tableColumns])

  function setFilter(key, value) {
    setFilters((state) => ({ ...state, [key]: value }))
  }

  function applyRange(range) {
    setFilters((state) => ({ ...state, ...rangeFor(range) }))
  }

  function exportExcel() {
    downloadCsvWorkbook(`${report.fileName}.csv`, [
      { name: 'Resumen', rows: [report.summary] },
      { name: report.sheetName, rows: report.rows },
      { name: 'Detalle extra', rows: report.extraRows || [] },
    ])
  }

  async function exportPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 12
    doc.setFillColor(16, 24, 48)
    doc.rect(0, 0, pageW, 24, 'F')
    doc.setTextColor(255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(company?.name || 'Sistema de Facturacion', margin + 1, 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`${report.title} | ${describeRange(filters)}`, pageW - margin, 14, { align: 'right' })
    doc.text(`Generado: ${formatDate(new Date())}`, pageW - margin, 20, { align: 'right' })
    doc.setTextColor(0)
    let cursorY = 32
    const summaryEntries = Object.entries(report.summary)
    if (summaryEntries.length) {
      autoTable(doc, {
        startY: cursorY,
        head: [['Indicador', 'Valor']],
        body: summaryEntries.map(([key, value]) => [prettyLabel(key), value]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        tableLineColor: 200,
        tableLineWidth: 0.5,
      })
      cursorY = doc.lastAutoTable.finalY + 6
    }
    if (report.rows.length) {
      const cols = report.columns
      autoTable(doc, {
        startY: cursorY,
        head: [cols],
        body: report.rows.map((row) => cols.map((c) => row[c] ?? '')),
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        tableLineColor: 200,
        tableLineWidth: 0.5,
      })
      cursorY = doc.lastAutoTable.finalY + 6
    }
    ;(report.breakdowns || []).forEach((section) => {
      if (!section.rows?.length) return
      if (cursorY > 180) { doc.addPage(); cursorY = 16 }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(30, 64, 175)
      doc.text(section.title, margin, cursorY)
      cursorY += 5
      autoTable(doc, {
        startY: cursorY,
        head: [section.columns],
        body: section.rows.map((row) => section.columns.map((c) => row[c] ?? '')),
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        tableLineColor: 200,
        tableLineWidth: 0.3,
      })
      cursorY = doc.lastAutoTable.finalY + 6
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(`Generado automaticamente por el sistema de facturacion · ${new Date().toLocaleString()}`, margin, doc.internal.pageSize.getHeight() - 8)
    doc.save(`${report.fileName}.pdf`)
  }

  function openInvoicePrint(invoiceId) {
    if (!invoiceId) return
    window.open(`/facturacion/${invoiceId}/imprimir`, '_blank', 'noopener,noreferrer')
  }

  function navigateToInvoice(invoiceId) {
    if (!invoiceId) return
    navigate(`/facturacion/${invoiceId}`)
  }

  function navigateToEditInvoice(invoiceId) {
    if (!invoiceId) return
    navigate(`/facturacion/${invoiceId}/editar`)
  }

  function navigateToCxc() {
    navigate('/cxc')
  }

  function navigateToInventory() {
    navigate('/inventario')
  }

  function navigateToCrm() {
    navigate('/clientes')
  }

  return (
    <div className="space-y-5">
      <section className="module-surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <button type="button" onClick={() => navigate('/dashboard')} className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-blue-200 hover:text-white"><ArrowLeft size={16} /> Dashboard</button>
            <p className="text-xs font-extrabold uppercase text-blue-200/80">Modulo independiente</p>
            <h2 className="font-display text-3xl font-bold">{config.title}</h2>
            <p className="mt-1 max-w-4xl text-sm text-white/45">{config.description}</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
            <Button variant="ghost" icon={FileSpreadsheet} onClick={exportExcel}>Excel</Button>
            <Button variant="primary" icon={Download} onClick={exportPdf}>PDF</Button>
          </div>
        </div>
      </section>

      <section className="no-print">
        <button type="button" onClick={() => setShowFilters((s) => !s)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="text-xs font-extrabold uppercase tracking-widest text-white/35">Filtros y periodo</span>
          <ChevronDown size={16} className={`text-white/40 transition ${showFilters ? 'rotate-180' : ''}`} />
        </button>
        {showFilters ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_.7fr_.7fr_.6fr_.6fr]">
              <label className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="label-dark flex items-center gap-2"><Search size={14} /> Busqueda empresarial</span>
                <input id="kpi-search" name="kpiSearch" value={filters.query} onChange={(event) => setFilter('query', event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder="Cliente, producto, factura, metodo, estado..." />
              </label>
              <label htmlFor="kpi-date-from"><span className="label-dark flex items-center gap-2"><CalendarDays size={14} /> Desde</span><input id="kpi-date-from" name="kpiDateFrom" type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} className="input-dark" /></label>
              <label htmlFor="kpi-date-to"><span className="label-dark">Hasta</span><input id="kpi-date-to" name="kpiDateTo" type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} className="input-dark" /></label>
              <label htmlFor="kpi-time-from"><span className="label-dark">Hora inicio</span><input id="kpi-time-from" name="kpiTimeFrom" type="time" value={filters.timeFrom} onChange={(event) => setFilter('timeFrom', event.target.value)} className="input-dark" /></label>
              <label htmlFor="kpi-time-to"><span className="label-dark">Hora fin</span><input id="kpi-time-to" name="kpiTimeTo" type="time" value={filters.timeTo} onChange={(event) => setFilter('timeTo', event.target.value)} className="input-dark" /></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'year', 'lastYear', 'all'].map((range) => <button key={range} type="button" onClick={() => applyRange(range)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-extrabold text-white/65 transition hover:bg-white/[0.08] hover:text-white">{rangeLabel(range)}</button>)}
            </div>
          </>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {report.stats.map((stat) => <div key={stat.label}><p className="text-[11px] font-extrabold uppercase tracking-wider text-white/38">{stat.label}</p><p className="mt-1 font-display text-3xl font-bold tracking-tight text-white">{stat.value}</p></div>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <div className="min-h-[240px] sm:min-h-[300px]">
          <LineChart data={report.lineData} options={chartOptions} />
        </div>
        <div className="min-h-[240px] sm:min-h-[300px]">
          {report.doughnutData ? <Doughnut data={report.doughnutData} options={doughnutOptions} /> : <Bar data={report.barData} options={chartOptions} />}
        </div>
      </section>

      <section>
        <DataTable data={report.rows} columns={addActionButtons(columns, config.type, navigate)} initialPageSize={25} emptyText="No hay registros con los filtros aplicados." searchPlaceholder="Buscar dentro de este modulo..." />
      </section>

      {report.breakdowns?.length ? (
        <section className="grid gap-4 xl:grid-cols-3">
          {report.breakdowns.map((section) => (
            <div key={section.title}>
              <h3 className="font-display text-lg font-bold">{section.title}</h3>
              <div className="mt-3">
                <DataTable data={section.rows} columns={section.columns.map((column) => ({ header: column, accessorKey: column }))} initialPageSize={8} searchable={false} emptyText="Sin desglose." />
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}

function buildKpiReport(type, context) {
  if (type === 'profit') return profitReport(context)
  if (type === 'stock') return stockReport(context)
  if (type === 'customers') return customerReport(context)
  if (type === 'receivables') return receivableReport(context)
  if (type === 'abonos') return abonosReport(context)
  if (type === 'taxes') return taxReport(context)
  if (type === 'cash') return cashReport(context)
  if (type === 'executive') return executiveSummary(context)
  return salesReport(context)
}

function salesReport({ invoices, filters, model, receivables, companyId }) {
  const validInvoices = filterRows(invoices.filter((invoice) => isRealInvoice(invoice, companyId)), filters, invoiceDateValue)
  const rows = validInvoices.map(invoiceToSalesRow)
  const total = sum(rows, (row) => parseMoney(row.Total))
  const profit = sum(rows, (row) => parseMoney(row.Ganancia))
  const cashCount = validInvoices.filter((inv) => getCreditAmount(inv) === 0).length
  const creditCount = validInvoices.filter((inv) => getCreditAmount(inv) > 0).length
  const report = baseReport('Ventas detalladas', 'Ventas', 'ventas', ['Fecha', 'Hora', 'Factura', 'Cliente', 'Subtotal', 'ITBIS', 'Total', 'Ganancia', 'Pago', 'Estado'], rows, [
    ['Facturas', rows.length],
    ['Contado', cashCount],
    ['Credito', creditCount],
    ['Total', currency.format(total)],
    ['Ganancia', currency.format(profit)],
    ['Ticket promedio', currency.format(rows.length ? total / rows.length : 0)],
  ], model)
  return {
    ...report,
    tableColumns: [
      ...report.columns.map((column) => ({ header: column, accessorKey: column })),
      { id: 'print', header: 'Factura', mobileLabel: 'Factura' },
    ],
    breakdowns: [
      { title: 'Ventas por dia', columns: ['Periodo', 'Facturas', 'Total', 'Ganancia'], rows: salesByPeriod(validInvoices, 'day') },
      { title: 'Ventas contado vs credito', columns: ['Tipo', 'Facturas', 'Total', 'Pagado', 'Pendiente'], rows: creditVsCashRows(validInvoices, receivables || []) },
      { title: 'Metodos de pago', columns: ['Metodo', 'Facturas', 'Total'], rows: salesByPayment(validInvoices) },
      { title: 'Clientes principales', columns: ['Cliente', 'Facturas', 'Total'], rows: salesByCustomer(validInvoices) },
    ],
  }
}

function profitReport(context) {
  const report = salesReport(context)
  return { ...report, title: 'Ganancias y margenes', sheetName: 'Ganancias', fileName: 'ganancia-mes', columns: ['Fecha', 'Factura', 'Cliente', 'Subtotal', 'Costo', 'Ganancia', 'Margen', 'Pago'], rows: report.rows.map((row) => ({ Fecha: row.Fecha, Factura: row.Factura, Cliente: row.Cliente, Subtotal: row.Subtotal, Costo: row.Costo, Ganancia: row.Ganancia, Margen: row.Margen, Pago: row.Pago })) }
}

function stockReport({ model, filters, products }) {
  const allProducts = products.filter((product) => isActiveProduct(product))
  const source = model.lowStock.length ? model.lowStock : allProducts.filter((product) => Number(product.stock || 0) <= Number(product.stockMin || 0))
  const rows = filterText(source.map((product) => ({ Producto: product.name || '', SKU: product.sku || '', Categoria: product.category || '', Stock: Number(product.stock || 0), Minimo: Number(product.stockMin || 0), Costo: currency.format(product.cost || 0), ValorCosto: currency.format(Number(product.cost || 0) * Number(product.stock || 0)), FaltanteMinimo: Math.max(Number(product.stockMin || 0) - Number(product.stock || 0), 0) })), filters.query)
  const byCategory = new Map()
  allProducts.forEach((product) => {
    const cat = product.category || 'Sin categoria'
    const current = byCategory.get(cat) || { Categoria: cat, Productos: 0, TotalStock: 0, ValorInventario: 0 }
    current.Productos += 1
    current.TotalStock += Number(product.stock || 0)
    current.ValorInventario += Number(product.cost || 0) * Number(product.stock || 0)
    byCategory.set(cat, current)
  })
  const categoryRows = [...byCategory.values()].sort((a, b) => b.ValorInventario - a.ValorInventario).map((row) => ({ Categoria: row.Categoria, Productos: row.Productos, Stock: row.TotalStock, ValorInventario: currency.format(row.ValorInventario) }))
  const totalInventoryValue = allProducts.reduce((s, p) => s + Number(p.cost || 0) * Number(p.stock || 0), 0)
  return {
    ...baseReport('Stock critico', 'Stock', 'stock-critico', ['Producto', 'SKU', 'Categoria', 'Stock', 'Minimo', 'Costo', 'ValorCosto', 'FaltanteMinimo'], rows, [['Productos criticos', rows.length], ['Agotados', rows.filter((row) => row.Stock <= 0).length], ['Valor costo critico', currency.format(sum(rows, (row) => parseMoney(row.ValorCosto)))], ['Faltante minimo', sum(rows, (row) => row.FaltanteMinimo)], ['Valor inventario total', currency.format(totalInventoryValue)], ['Productos totales', allProducts.length]]),
    breakdowns: [{ title: 'Inventario por categoria', columns: ['Categoria', 'Productos', 'Stock', 'ValorInventario'], rows: categoryRows }],
  }
}

function customerReport({ customers, filters, invoices, companyId }) {
  const validInvoices = invoices.filter((invoice) => isRealInvoice(invoice, companyId))
  const customerInvoices = new Map()
  validInvoices.forEach((inv) => {
    const name = inv.customerName || 'Cliente'
    const current = customerInvoices.get(name) || { Cliente: name, Facturas: 0, TotalComprado: 0 }
    current.Facturas += 1
    current.TotalComprado += Number(inv.totals?.total || 0)
    customerInvoices.set(name, current)
  })
  const topBuyers = [...customerInvoices.values()].sort((a, b) => b.TotalComprado - a.TotalComprado).slice(0, 12).map((row) => ({ Cliente: row.Cliente, Facturas: row.Facturas, TotalComprado: currency.format(row.TotalComprado) }))
  const rows = filterRows(customers, filters, (customer) => customer.createdAt || customer.updatedAt).map((customer) => ({ Fecha: formatDate(customer.createdAt || customer.updatedAt), Cliente: customer.name || '', Documento: customer.rnc || customer.cedula || '', Telefono: customer.phone || customer.whatsapp || '', Email: customer.email || '', Balance: currency.format(customer.balance || 0) }))
  return {
    ...baseReport('Clientes nuevos', 'Clientes', 'clientes-nuevos', ['Fecha', 'Cliente', 'Documento', 'Telefono', 'Email', 'Balance'], rows, [['Clientes', rows.length], ['Con balance', rows.filter((row) => parseMoney(row.Balance) > 0).length], ['Balance total', currency.format(sum(rows, (row) => parseMoney(row.Balance)))], ['Promedio balance', currency.format(rows.length ? sum(rows, (row) => parseMoney(row.Balance)) / rows.length : 0)]]),
    breakdowns: [{ title: 'Top compradores', columns: ['Cliente', 'Facturas', 'TotalComprado'], rows: topBuyers }],
  }
}

function receivableReport({ receivables, invoices, filters, model, companyId }) {
  const validInvoices = invoices.filter((invoice) => isRealInvoice(invoice, companyId))
  const active = receivables.filter((item) => isActiveReceivable(item, validInvoices))
  const rows = filterRows(active, filters, (row) => row.createdAt || row.dueDate || row.updatedAt).map((row) => ({
    Cliente: row.customerName || '',
    Factura: row.invoiceNumber || row.invoiceId || '',
    Total: currency.format(row.total || 0),
    Financiado: currency.format(row.financedAmount || row.total || 0),
    Cobrado: currency.format(row.paid || 0),
    Balance: currency.format(row.balance || 0),
    Vence: row.dueDate || '',
    Abonos: (row.payments || []).filter((p) => p.status !== 'deleted').length,
    Estado: row.status || '',
    InvoiceId: row.invoiceId || '',
  }))
  const totalFacturado = sum(active, (r) => Number(r.total || 0))
  const totalFinanced = sum(active, (r) => Number(r.financedAmount || r.total || 0))
  const totalPaid = sum(active, (r) => Number(r.paid || 0))
  const totalBalance = sum(active, (r) => Number(r.balance || 0))
  const overdue = active.filter((r) => r.dueDate && new Date(r.dueDate) < new Date() && r.balance > 0)
  return {
    ...baseReport('Cuentas por cobrar', 'CxC', 'cuentas-por-cobrar', ['Cliente', 'Factura', 'Total', 'Financiado', 'Cobrado', 'Balance', 'Vence', 'Abonos', 'Estado'], rows, [
      ['Cuentas', active.length],
      ['Total facturado', currency.format(totalFacturado)],
      ['Financiado total', currency.format(totalFinanced)],
      ['Cobrado total', currency.format(totalPaid)],
      ['Balance pendiente', currency.format(totalBalance)],
      ['Vencidas', overdue.length],
      ['Monto vencido', currency.format(sum(overdue, (r) => Number(r.balance || 0)))],
      ['Abonos este mes', currency.format(model.totals.abonosMonth || 0)],
    ]),
    breakdowns: [
      { title: 'Creditos activos detalle', columns: ['Factura', 'Cliente', 'Total', 'Financiado', 'Cobrado', 'Balance', 'Abonos'], rows: creditInvoiceRows(active) },
    ],
  }
}

function abonosReport({ receivables, filters, model }) {
  const allPayments = []
  receivables.forEach((recv) => {
    (recv.payments || []).filter((p) => p.status !== 'deleted').forEach((payment) => {
      allPayments.push({
        Fecha: formatDate(payment.date || payment.createdAt),
        Hora: new Date(payment.date || payment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        Cliente: recv.customerName || payment.customerName || '',
        Factura: recv.invoiceNumber || recv.invoiceId || '',
        Metodo: payment.method || 'N/A',
        Monto: currency.format(Number(payment.amount || 0)),
        Usuario: payment.user || payment.registeredBy || '',
        Nota: payment.comment || payment.note || '',
        Referencia: payment.reference || '',
        BalanceAntes: currency.format(Number(payment.balanceBefore || 0)),
        BalanceDespues: currency.format(Number(payment.balanceAfter || 0)),
        InvoiceId: recv.invoiceId || '',
      })
    })
  })
  const rows = filterText(filterRows(allPayments, filters, (p) => p.Fecha), filters.query)
  const totalAbonos = sum(rows, (p) => parseMoney(p.Monto))
  const stats = [
    ['Abonos registrados', rows.length],
    ['Total abonado', currency.format(totalAbonos)],
    ['Abonos hoy', currency.format(model.totals.abonosToday || 0)],
    ['Abonos semana', currency.format(model.totals.abonosWeek || 0)],
    ['Abonos mes', currency.format(model.totals.abonosMonth || 0)],
    ['Abonos ano', currency.format(model.totals.abonosYear || 0)],
  ]
  return {
    ...baseReport('Abonos recibidos', 'Abonos', 'abonos', ['Fecha', 'Hora', 'Cliente', 'Factura', 'Metodo', 'Monto', 'Usuario', 'Nota'], rows, stats),
    tableColumns: [
      { header: 'Fecha', accessorKey: 'Fecha' },
      { header: 'Hora', accessorKey: 'Hora' },
      { header: 'Cliente', accessorKey: 'Cliente' },
      { header: 'Factura', accessorKey: 'Factura' },
      { header: 'Metodo', accessorKey: 'Metodo' },
      { header: 'Monto', accessorKey: 'Monto' },
      { header: 'Usuario', accessorKey: 'Usuario' },
      { header: 'Nota', accessorKey: 'Nota' },
      { id: 'print', header: 'Factura', mobileLabel: 'Factura' },
    ],
    breakdowns: [
      { title: 'Abonos por cliente', columns: ['Cliente', 'Abonos', 'TotalAbonado'], rows: abonosByCustomer(allPayments) },
      { title: 'Abonos por metodo', columns: ['Metodo', 'Abonos', 'Total'], rows: abonosByMethod(allPayments) },
      { title: 'Abonos por dia', columns: ['Periodo', 'Abonos', 'Total'], rows: abonosByPeriod(allPayments) },
    ],
  }
}

function abonosByCustomer(payments = []) {
  const rows = new Map()
  payments.forEach((p) => {
    const key = p.Cliente || 'Cliente'
    const current = rows.get(key) || { Cliente: key, Abonos: 0, TotalAbonadoValue: 0 }
    current.Abonos += 1
    current.TotalAbonadoValue += parseMoney(p.Monto)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => b.TotalAbonadoValue - a.TotalAbonadoValue).slice(0, 12).map((row) => ({ Cliente: row.Cliente, Abonos: row.Abonos, TotalAbonado: currency.format(row.TotalAbonadoValue) }))
}

function abonosByMethod(payments = []) {
  const rows = new Map()
  payments.forEach((p) => {
    const key = p.Metodo || 'N/A'
    const current = rows.get(key) || { Metodo: key, Abonos: 0, TotalValue: 0 }
    current.Abonos += 1
    current.TotalValue += parseMoney(p.Monto)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => b.TotalValue - a.TotalValue).map((row) => ({ Metodo: row.Metodo, Abonos: row.Abonos, Total: currency.format(row.TotalValue) }))
}

function abonosByPeriod(payments = []) {
  const rows = new Map()
  payments.forEach((p) => {
    const key = p.Fecha || 'Sin fecha'
    const current = rows.get(key) || { Periodo: key, Abonos: 0, TotalValue: 0 }
    current.Abonos += 1
    current.TotalValue += parseMoney(p.Monto)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => String(b.Periodo).localeCompare(String(a.Periodo))).map((row) => ({ Periodo: row.Periodo, Abonos: row.Abonos, Total: currency.format(row.TotalValue) }))
}

function taxReport(context) {
  const report = salesReport(context)
  return { ...report, title: 'Impuestos del mes', sheetName: 'Impuestos', fileName: 'impuestos-mes', columns: ['Fecha', 'Factura', 'Cliente', 'Subtotal', 'ITBIS', 'Total', 'Estado'], rows: report.rows.map((row) => ({ Fecha: row.Fecha, Factura: row.Factura, Cliente: row.Cliente, Subtotal: row.Subtotal, ITBIS: row.ITBIS, Total: row.Total, Estado: row.Estado })) }
}

function executiveSummary({ model, receivables, invoices, companyId }) {
  const totals = model.totals || {}
  const validInvoices = invoices.filter((invoice) => isRealInvoice(invoice, companyId))
  const activeReceivables = receivables.filter((r) => isActiveReceivable(r, validInvoices))
  const totalCxC = activeReceivables.reduce((s, r) => s + Number(r.balance || 0), 0)
  const totalCreditPaid = activeReceivables.reduce((s, r) => s + Number(r.paid || 0), 0)
  const totalCreditFinanced = activeReceivables.reduce((s, r) => s + Number(r.financedAmount || r.total || 0), 0)
  const totalCreditFacturado = activeReceivables.reduce((s, r) => s + Number(r.total || 0), 0)
  const stats = [
    ['Ventas contado hoy', currency.format(totals.todayCashSales || 0)],
    ['Ventas credito hoy (emitido)', currency.format(totals.todayCreditSales || 0)],
    ['Abonos recibidos hoy', currency.format(totals.abonosToday || 0)],
    ['Total ventas hoy', currency.format(totals.todaySales || 0)],
    ['Ventas contado semana', currency.format(totals.weekCashSales || 0)],
    ['Ventas credito semana (emitido)', currency.format(totals.weekCreditSales || 0)],
    ['Abonos recibidos semana', currency.format(totals.abonosWeek || 0)],
    ['Total ventas semana', currency.format(totals.weekSales || 0)],
    ['Ventas contado mes', currency.format(totals.monthCashSales || 0)],
    ['Ventas credito mes (emitido)', currency.format(totals.monthCreditSales || 0)],
    ['Abonos recibidos mes', currency.format(totals.abonosMonth || 0)],
    ['Total ventas mes', currency.format(totals.monthSales || 0)],
    ['Ventas contado ano', currency.format(totals.yearCashSales || 0)],
    ['Ventas credito ano (emitido)', currency.format(totals.yearCreditSales || 0)],
    ['Abonos recibidos ano', currency.format(totals.abonosYear || 0)],
    ['Ganancia mes', currency.format(totals.monthProfit || 0)],
    ['Costo mes', currency.format(totals.monthCost || 0)],
    ['ITBIS mes', currency.format(totals.monthTax || 0)],
    ['Facturas hoy', totals.invoicesToday || 0],
    ['Clientes nuevos hoy', totals.newCustomersToday || 0],
    ['Prod. vendidos hoy', totals.productsSoldToday || 0],
    ['CxC total facturado', currency.format(totalCreditFacturado)],
    ['CxC financiado total', currency.format(totalCreditFinanced)],
    ['CxC cobrado total', currency.format(totalCreditPaid)],
    ['CxC pendiente actual', currency.format(totalCxC)],
    ['Efectivo recibido hoy', currency.format(totals.cashToday || 0)],
    ['Efectivo recibido mes', currency.format(totals.cashMonth || 0)],
    ['CxP pendiente', currency.format(totals.payablesBalance || 0)],
  ]
  const topProductsRows = (model.topProducts || []).slice(0, 8).map((product) => ({ Producto: product.name, SKU: product.sku || '', Cantidad: product.quantity, Ingresos: currency.format(product.revenue), Ganancia: currency.format(product.profit) }))
  const creditDetail = creditInvoiceRows(activeReceivables)
  const lineData = { labels: (model.dailySeries || []).map((item) => item.label), datasets: [{ label: 'Ventas diarias', data: (model.dailySeries || []).map((item) => item.total), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.16)', tension: 0.35, fill: true }] }
  const doughnutData = model.paymentMethods?.length ? { labels: model.paymentMethods.map((item) => item.method), datasets: [{ data: model.paymentMethods.map((item) => item.net), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'] }] } : null
  return {
    title: 'Resumen ejecutivo', sheetName: 'Resumen', fileName: 'resumen-ejecutivo', columns: ['Indicador', 'Valor'],
    rows: stats.map(([label, value]) => ({ Indicador: label, Valor: value })),
    extraRows: [], summary: Object.fromEntries(stats),
    stats: stats.map(([label, value]) => ({ label, value })), lineData, doughnutData,
    barData: { labels: lineData.labels, datasets: [{ label: 'Ventas diarias', data: lineData.datasets[0].data, backgroundColor: '#3b82f6' }] },
    breakdowns: [
      { title: 'Ventas contado vs credito', columns: ['Periodo', 'Contado', 'Credito emitido', 'Abonos recibidos', 'Total'], rows: [
        { Periodo: 'Hoy', Contado: currency.format(totals.todayCashSales || 0), 'Credito emitido': currency.format(totals.todayCreditSales || 0), 'Abonos recibidos': currency.format(totals.abonosToday || 0), Total: currency.format(totals.todaySales || 0) },
        { Periodo: 'Semana', Contado: currency.format(totals.weekCashSales || 0), 'Credito emitido': currency.format(totals.weekCreditSales || 0), 'Abonos recibidos': currency.format(totals.abonosWeek || 0), Total: currency.format(totals.weekSales || 0) },
        { Periodo: 'Mes', Contado: currency.format(totals.monthCashSales || 0), 'Credito emitido': currency.format(totals.monthCreditSales || 0), 'Abonos recibidos': currency.format(totals.abonosMonth || 0), Total: currency.format(totals.monthSales || 0) },
        { Periodo: 'Ano', Contado: currency.format(totals.yearCashSales || 0), 'Credito emitido': currency.format(totals.yearCreditSales || 0), 'Abonos recibidos': currency.format(totals.abonosYear || 0), Total: currency.format((totals.yearCashSales || 0) + (totals.yearCreditSales || 0)) },
      ] },
      { title: 'Creditos activos detalle', columns: ['Factura', 'Cliente', 'Total', 'Financiado', 'Cobrado', 'Balance', 'Abonos'], rows: creditDetail },
      { title: 'Productos destacados', columns: ['Producto', 'SKU', 'Cantidad', 'Ingresos', 'Ganancia'], rows: topProductsRows },
      { title: 'Metodos de pago', columns: ['Metodo', 'Facturas', 'Total', 'Neto'], rows: (model.paymentMethods || []).slice(0, 8).map((item) => ({ Metodo: item.method, Facturas: item.count, Total: currency.format(item.total), Neto: currency.format(item.net) })) },
    ].filter((section) => section.rows.length),
  }
}

function creditInvoiceRows(allReceivables = []) {
  const receivables = allReceivables.filter((r) => r.balance > 0)
  return receivables.slice(0, 20).map((r) => ({
    Factura: r.invoiceNumber || '',
    Cliente: r.customerName || '',
    Total: currency.format(Number(r.total || 0)),
    Financiado: currency.format(Number(r.financedAmount || r.total || 0)),
    Cobrado: currency.format(Number(r.paid || 0)),
    Balance: currency.format(Number(r.balance || 0)),
    Abonos: (r.payments || []).filter((p) => p.status !== 'deleted').length,
  }))
}

function cashReport({ cashRegister, cashCut, filters, invoices, creditNotes, expenses, receivables, payments }) {
  const cleanCash = sanitizeCashRegisterWithSources(cashRegister, { invoices, creditNotes, expenses, receivables, payments })
  const periodMovements = filterRows(cleanCash.movements || [], filters, (row) => row.createdAt || row.date)
    .sort((left, right) => parseDate(left.createdAt || left.date).getTime() - parseDate(right.createdAt || right.date).getTime())
  const rows = periodMovements.map((row) => ({
    Fecha: formatDate(row.createdAt || row.date),
    Tipo: movementTypeLabel(row.type),
    Metodo: row.method || '',
    Concepto: row.concept || row.note || '',
    Referencia: row.reference || '',
    Monto: currency.format(cashMovementSignedAmount(row)),
    InvoiceId: findInvoiceForMovement(row, invoices)?.id || '',
  }))
  const income = periodMovements.reduce((sum, movement) => sum + Math.max(cashMovementSignedAmount(movement), 0), 0)
  const outflow = periodMovements.reduce((sum, movement) => sum + Math.abs(Math.min(cashMovementSignedAmount(movement), 0)), 0)
  const periodBalance = income - outflow
  const counted = Number(cashCut.counted || 0)
  const filteredCashCut = { ...cashCut, expected: periodBalance, difference: counted - periodBalance, byMethod: summarizeCashMethods(periodMovements) }
  const report = baseReport('Caja actual', 'Caja', 'caja-actual', ['Fecha', 'Tipo', 'Metodo', 'Concepto', 'Referencia', 'Monto'], rows, [['Estado', cleanCash.status || 'closed'], ['Balance calculado', currency.format(periodBalance)], ['Contado', currency.format(counted)], ['Diferencia', currency.format(counted - periodBalance)]], null, filteredCashCut)
  return {
    ...report,
    tableColumns: [
      ...report.columns.map((column) => ({ header: column, accessorKey: column })),
      { id: 'print', header: 'Factura', mobileLabel: 'Factura' },
    ],
    breakdowns: [
      { title: 'Caja por metodo', columns: ['Metodo', 'Entradas', 'Salidas', 'Neto'], rows: cashByMethod(periodMovements) },
      { title: 'Caja por tipo', columns: ['Tipo', 'Movimientos', 'Neto'], rows: cashByType(periodMovements) },
      { title: 'Caja por dia', columns: ['Periodo', 'Movimientos', 'Neto'], rows: cashByPeriod(periodMovements) },
    ],
  }
}

function baseReport(title, sheetName, fileName, columns, rows, stats, model = null, cashCut = null) {
  const chartLabels = model?.dailySeries?.map((item) => item.label) || rows.slice(0, 10).map((row, index) => row.Fecha || row.Cliente || row.Producto || `#${index + 1}`)
  const chartValues = model?.dailySeries?.map((item) => item.total) || rows.slice(0, 10).map((row) => parseMoney(row.Total || row.Monto || row.Balance || row.ValorCosto || 0))
  return {
    title,
    sheetName,
    fileName,
    columns,
    rows,
    extraRows: [],
    summary: Object.fromEntries(stats.map(([label, value]) => [label, value])),
    stats: stats.map(([label, value]) => ({ label, value })),
    lineData: { labels: chartLabels, datasets: [{ label: title, data: chartValues, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.16)', tension: 0.35, fill: true }] },
    barData: { labels: chartLabels, datasets: [{ label: title, data: chartValues, backgroundColor: '#3b82f6' }] },
    doughnutData: cashCut?.byMethod?.length ? { labels: cashCut.byMethod.map((item) => item.method), datasets: [{ data: cashCut.byMethod.map((item) => item.net), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'] }] } : null,
  }
}

function invoiceToSalesRow(invoice) {
  const date = parseDate(invoiceDateValue(invoice))
  const subtotal = Number(invoice.totals?.subtotal || 0)
  const cost = Number(invoice.totals?.cost || 0)
  const profit = Number(invoice.totals?.profit ?? subtotal - cost)
  return { Fecha: formatDate(date), Hora: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), Factura: invoice.number || invoice.ncf || '', Cliente: invoice.customerName || 'Cliente', Subtotal: currency.format(subtotal), ITBIS: currency.format(invoice.totals?.itbis || 0), Total: currency.format(invoice.totals?.total || 0), Costo: currency.format(cost), Ganancia: currency.format(profit), Margen: `${subtotal ? ((profit / subtotal) * 100).toFixed(2) : '0.00'}%`, Pago: paymentLabel(invoice), Estado: invoice.status || '', InvoiceId: invoice.id }
}

function filterRows(rows, filters, dateGetter) {
  return filterText(rows.filter((row) => {
    const date = parseDate(dateGetter(row))
    const day = dayKey(date)
    if (filters.dateFrom && day < filters.dateFrom) return false
    if (filters.dateTo && day > filters.dateTo) return false
    if (filters.timeFrom && minutesOfDay(date) < timeToMinutes(filters.timeFrom)) return false
    if (filters.timeTo && minutesOfDay(date) > timeToMinutes(filters.timeTo)) return false
    return true
  }), filters.query)
}

function filterText(rows, query) {
  const term = normalize(query)
  if (!term) return rows
  return rows.filter((row) => normalize(row).includes(term))
}

function rangeFor(range) {
  const now = new Date()
  const today = todayIso()
  if (range === 'today') return { dateFrom: today, dateTo: today }
  if (range === 'yesterday') { const date = addDays(now, -1); return { dateFrom: dayKey(date), dateTo: dayKey(date) } }
  if (range === 'week') {
    const start = new Date(now)
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
    return { dateFrom: dayKey(start), dateTo: today }
  }
  if (range === 'lastWeek') {
    const end = addDays(now, -7)
    const start = addDays(end, -6)
    return { dateFrom: dayKey(start), dateTo: dayKey(end) }
  }
  if (range === 'month') return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
  if (range === 'lastMonth') {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { dateFrom: dayKey(previous), dateTo: dayKey(new Date(now.getFullYear(), now.getMonth(), 0)) }
  }
  if (range === 'year') return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: today }
  if (range === 'lastYear') return { dateFrom: `${now.getFullYear() - 1}-01-01`, dateTo: `${now.getFullYear() - 1}-12-31` }
  return { dateFrom: '', dateTo: '' }
}

function rangeLabel(range) {
  return { today: 'Hoy', yesterday: 'Ayer', week: 'Esta semana', lastWeek: 'Semana pasada', month: 'Este mes', lastMonth: 'Mes pasado', year: 'Este ano', lastYear: 'Ano pasado', all: 'Todo' }[range] || range
}

function describeRange(filters) {
  return `${filters.dateFrom || 'inicio'} hasta ${filters.dateTo || 'hoy'}${filters.timeFrom || filters.timeTo ? ` · ${filters.timeFrom || '00:00'}-${filters.timeTo || '23:59'}` : ''}`
}

function invoiceDateValue(invoice) {
  return invoice.issuedAt || invoice.createdAt || invoice.issueDate || invoice.updatedAt
}

function paymentLabel(invoice) {
  return (invoice.payments || []).map((payment) => payment.method).join(', ') || invoice.paymentMethod || 'N/A'
}

function parseDate(value) {
  return parseSystemDate(value)
}

function dayKey(date) {
  return dayKeyInSystemZone(date)
}

function addDays(value, days) {
  const date = parseDate(value)
  date.setDate(date.getDate() + days)
  return date
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function normalize(value) {
  return JSON.stringify(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function parseMoney(value) {
  if (typeof value === 'number') return value
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''))
  return Number.isNaN(parsed) ? 0 : parsed
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + Number(getter(row) || 0), 0)
}

function movementTypeLabel(type) {
  const value = String(type || '').toLowerCase()
  if (value === 'income') return 'Ingreso'
  if (value === 'expense') return 'Egreso'
  if (value === 'withdrawal' || value === 'retiro') return 'Retiro'
  if (value === 'opening') return 'Apertura'
  if (value === 'credit_note_refund') return 'Nota credito'
  if (value === 'payable_payment') return 'Pago CxP'
  return type || 'Movimiento'
}

function summarizeCashMethods(movements = []) {
  const methods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Credito']
  const map = new Map(methods.map((method) => [method, { method, sales: 0, refunds: 0, net: 0, count: 0 }]))
  movements.forEach((movement) => {
    const method = normalizePaymentMethod(movement.method || movement.type)
    const current = map.get(method) || { method, sales: 0, refunds: 0, net: 0, count: 0 }
    const signed = cashMovementSignedAmount(movement)
    if (signed >= 0) current.sales += signed
    else current.refunds += Math.abs(signed)
    current.net = current.sales - current.refunds
    current.count += 1
    map.set(method, current)
  })
  return [...map.values()].filter((item) => item.count > 0 || item.net !== 0)
}

function normalizePaymentMethod(method = '') {
  const value = String(method || '').toLowerCase()
  if (value.includes('tarjeta')) return 'Tarjeta'
  if (value.includes('transfer')) return 'Transferencia'
  if (value.includes('credito') || value.includes('crédito')) return 'Credito'
  return 'Efectivo'
}

function salesByPeriod(invoices = [], mode = 'day') {
  const rows = new Map()
  invoices.forEach((invoice) => {
    const date = parseDate(invoiceDateValue(invoice))
    const key = mode === 'month' ? dayKey(date).slice(0, 7) : dayKey(date)
    const current = rows.get(key) || { Periodo: key, Facturas: 0, TotalValue: 0, GananciaValue: 0 }
    current.Facturas += 1
    current.TotalValue += Number(invoice.totals?.total || 0)
    current.GananciaValue += Number(invoice.totals?.profit || 0)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => String(b.Periodo).localeCompare(String(a.Periodo))).map((row) => ({ Periodo: row.Periodo, Facturas: row.Facturas, Total: currency.format(row.TotalValue), Ganancia: currency.format(row.GananciaValue) }))
}

function salesByPayment(invoices = []) {
  const rows = new Map()
  invoices.forEach((invoice) => {
    const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'No especificado', amount: invoice.totals?.total || 0 }]
    payments.forEach((payment) => {
      const key = normalizePaymentMethod(payment.method || 'No especificado')
      const current = rows.get(key) || { Metodo: key, Facturas: 0, TotalValue: 0 }
      current.Facturas += 1
      current.TotalValue += Number(payment.amount || 0)
      rows.set(key, current)
    })
  })
  return [...rows.values()].sort((a, b) => b.TotalValue - a.TotalValue).map((row) => ({ Metodo: row.Metodo, Facturas: row.Facturas, Total: currency.format(row.TotalValue) }))
}

function salesByCustomer(invoices = []) {
  const rows = new Map()
  invoices.forEach((invoice) => {
    const key = invoice.customerName || 'Cliente'
    const current = rows.get(key) || { Cliente: key, Facturas: 0, TotalValue: 0 }
    current.Facturas += 1
    current.TotalValue += Number(invoice.totals?.total || 0)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => b.TotalValue - a.TotalValue).slice(0, 12).map((row) => ({ Cliente: row.Cliente, Facturas: row.Facturas, Total: currency.format(row.TotalValue) }))
}

function creditVsCashRows(invoices = [], receivables = []) {
  let cashCount = 0, cashAmount = 0, creditCount = 0, creditAmount = 0, creditPaid = 0, creditPending = 0
  invoices.forEach((invoice) => {
    const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'No especificado', amount: invoice.totals?.total || 0 }]
    let invoiceCash = 0, invoiceCredit = 0
    payments.forEach((payment) => {
      const method = normalizePaymentMethod(payment.method)
      const amount = Number(payment.amount || 0)
      if (method === 'Credito') invoiceCredit += amount
      else invoiceCash += amount
    })
    if (invoiceCash > 0) { cashCount++; cashAmount += invoiceCash }
    if (invoiceCredit > 0) {
      creditCount++
      creditAmount += invoiceCredit
      const receivable = receivables.find((r) => r.invoiceId === invoice.id || r.invoiceNumber === invoice.number || r.invoiceNumber === invoice.ncf)
      if (receivable) { creditPaid += Number(receivable.paid || 0); creditPending += Number(receivable.balance || 0) }
      else creditPaid += invoiceCredit
    }
  })
  const grandTotal = cashAmount + creditAmount
  return [
    { Tipo: 'Al contado', Facturas: cashCount, Total: currency.format(cashAmount), Pagado: currency.format(cashAmount), Pendiente: currency.format(0) },
    { Tipo: 'A credito', Facturas: creditCount, Total: currency.format(creditAmount), Pagado: currency.format(Math.min(creditPaid, creditAmount)), Pendiente: currency.format(Math.min(creditPending, creditAmount)) },
    { Tipo: 'Total general', Facturas: cashCount + creditCount, Total: currency.format(grandTotal), Pagado: currency.format(cashAmount + Math.min(creditPaid, creditAmount)), Pendiente: currency.format(Math.min(creditPending, creditAmount)) },
  ]
}

function getCreditAmount(invoice) {
  const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'Efectivo', amount: invoice.totals?.total || 0 }]
  return payments.filter((p) => normalizePaymentMethod(p.method) === 'Credito').reduce((s, p) => s + Number(p.amount || 0), 0)
}

function cashByMethod(movements = []) {
  const rows = new Map()
  movements.forEach((movement) => {
    const key = normalizePaymentMethod(movement.method || movement.type)
    const current = rows.get(key) || { Metodo: key, EntradasValue: 0, SalidasValue: 0 }
    const signed = cashMovementSignedAmount(movement)
    if (signed >= 0) current.EntradasValue += signed
    else current.SalidasValue += Math.abs(signed)
    rows.set(key, current)
  })
  return [...rows.values()].map((row) => ({ Metodo: row.Metodo, Entradas: currency.format(row.EntradasValue), Salidas: currency.format(row.SalidasValue), Neto: currency.format(row.EntradasValue - row.SalidasValue) }))
}

function cashByType(movements = []) {
  const rows = new Map()
  movements.forEach((movement) => {
    const key = movementTypeLabel(movement.type)
    const current = rows.get(key) || { Tipo: key, Movimientos: 0, NetoValue: 0 }
    current.Movimientos += 1
    current.NetoValue += cashMovementSignedAmount(movement)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => Math.abs(b.NetoValue) - Math.abs(a.NetoValue)).map((row) => ({ Tipo: row.Tipo, Movimientos: row.Movimientos, Neto: currency.format(row.NetoValue) }))
}

function cashByPeriod(movements = []) {
  const rows = new Map()
  movements.forEach((movement) => {
    const key = dayKey(parseDate(movement.createdAt || movement.date))
    const current = rows.get(key) || { Periodo: key, Movimientos: 0, NetoValue: 0 }
    current.Movimientos += 1
    current.NetoValue += cashMovementSignedAmount(movement)
    rows.set(key, current)
  })
  return [...rows.values()].sort((a, b) => String(b.Periodo).localeCompare(String(a.Periodo))).map((row) => ({ Periodo: row.Periodo, Movimientos: row.Movimientos, Neto: currency.format(row.NetoValue) }))
}

function findInvoiceForMovement(movement, invoices = []) {
  const text = normalize([movement.invoiceId, movement.reference, movement.concept, movement.note].join(' '))
  return invoices.find((invoice) => text.includes(normalize(invoice.id)) || text.includes(normalize(invoice.number)) || text.includes(normalize(invoice.ncf)))
}

function prettyLabel(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } } } }
const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } } }

function addActionButtons(columns, type, navigate) {
  const actionCol = {
    id: 'actions',
    header: 'Acciones',
    mobileLabel: 'Acciones',
    cell: ({ row }) => {
      const data = row.original
      if (type === 'sales' || type === 'profit' || type === 'taxes') {
        return <div className="flex gap-1">
          {data.InvoiceId ? <button type="button" onClick={() => { const id = data.InvoiceId; window.open(`/facturacion/${id}/imprimir`, '_blank', 'noopener,noreferrer') }} className="rounded-md border border-blue-300/20 bg-blue-500/10 p-1.5 text-blue-100 hover:bg-blue-500/20" title="Imprimir factura"><ExternalLink size={13} /></button> : null}
          {data.InvoiceId ? <button type="button" onClick={() => navigate(`/facturacion/${data.InvoiceId}/editar`)} className="rounded-md border border-white/10 bg-white/[0.035] p-1.5 text-white/65 hover:bg-white/[0.08]" title="Editar factura"><Pencil size={13} /></button> : null}
        </div>
      }
      if (type === 'abonos') {
        return <div className="flex gap-1">
          {data.InvoiceId ? <button type="button" onClick={() => { const id = data.InvoiceId; window.open(`/facturacion/${id}/imprimir`, '_blank', 'noopener,noreferrer') }} className="rounded-md border border-blue-300/20 bg-blue-500/10 p-1.5 text-blue-100 hover:bg-blue-500/20" title="Ver factura"><ExternalLink size={13} /></button> : null}
          <button type="button" onClick={() => navigate('/cxc')} className="rounded-md border border-amber-300/20 bg-amber-500/10 p-1.5 text-amber-100 hover:bg-amber-500/20" title="Ir a CxC"><Wallet size={13} /></button>
        </div>
      }
      if (type === 'receivables') {
        return <div className="flex gap-1">
          {data.InvoiceId ? <button type="button" onClick={() => { const id = data.InvoiceId; window.open(`/facturacion/${id}/imprimir`, '_blank', 'noopener,noreferrer') }} className="rounded-md border border-blue-300/20 bg-blue-500/10 p-1.5 text-blue-100 hover:bg-blue-500/20" title="Ver factura"><ExternalLink size={13} /></button> : null}
          <button type="button" onClick={() => navigate('/cxc')} className="rounded-md border border-amber-300/20 bg-amber-500/10 p-1.5 text-amber-100 hover:bg-amber-500/20" title="Ir a CxC"><Wallet size={13} /></button>
        </div>
      }
      if (type === 'stock') {
        return <div className="flex gap-1">
          <button type="button" onClick={() => navigate('/inventario')} className="rounded-md border border-white/10 bg-white/[0.035] p-1.5 text-white/65 hover:bg-white/[0.08]" title="Ir a inventario"><Warehouse size={13} /></button>
        </div>
      }
      if (type === 'customers') {
        return <div className="flex gap-1">
          <button type="button" onClick={() => navigate('/clientes')} className="rounded-md border border-white/10 bg-white/[0.035] p-1.5 text-white/65 hover:bg-white/[0.08]" title="Ir a clientes"><Users size={13} /></button>
        </div>
      }
      return null
    },
  }
  return [...columns.filter((col) => col.id !== 'print' && col.id !== 'actions'), { id: 'print', header: 'Factura', mobileLabel: 'Factura', cell: ({ row }) => row.original.InvoiceId ? <button type="button" onClick={() => { const id = row.original.InvoiceId; window.open(`/facturacion/${id}/imprimir`, '_blank', 'noopener,noreferrer') }} className="inline-flex items-center gap-1 rounded-md border border-blue-300/20 bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-100 hover:bg-blue-500/20"><ExternalLink size={13} /> Imprimir</button> : <span className="text-white/35">-</span> }, actionCol]
}
