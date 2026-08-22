import { useMemo, useState } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Building2,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Filter,
  LayoutDashboard,
  Package,
  Printer,
  Search,
  SlidersHorizontal,
  Tags,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { useERPStore } from '../../store/useERPStore'
import { downloadCsvWorkbook } from '../../lib/csvExport'
import { currency, formatDate } from '../../lib/formatters'
import { addDaysLocal, parseIsoLocal, toIsoLocal } from '../../lib/period'

const ENTRY_TYPES = ['Nueva mercancia', 'Devolucion proveedor', 'Ajuste positivo', 'Transferencia']

const PERIOD_MODES = [
  { id: 'day', label: 'Dia', icon: CalendarDays },
  { id: 'week', label: 'Semana', icon: CalendarRange },
  { id: 'month', label: 'Mes', icon: Calendar },
  { id: 'year', label: 'Ano', icon: CalendarCheck },
  { id: 'range', label: 'Rango', icon: SlidersHorizontal },
]

const QUICK_CHIPS = [
  { id: 'today', label: 'Hoy', mode: 'day', offsetDays: 0 },
  { id: 'yesterday', label: 'Ayer', mode: 'day', offsetDays: -1 },
  { id: 'this_week', label: 'Esta semana', mode: 'week' },
  { id: 'this_month', label: 'Este mes', mode: 'month' },
  { id: 'last_month', label: 'Mes anterior', mode: 'month', monthOffset: -1 },
  { id: 'last_30', label: 'Ultimos 30 dias', mode: 'range', daysBack: 29 },
  { id: 'this_year', label: 'Este ano', mode: 'year' },
  { id: 'all', label: 'Todo', mode: 'range', all: true },
]

const MODE_LABELS = { day: 'dia', week: 'semana', month: 'mes', year: 'ano', range: 'mes' }

function applyPeriodMode(mode, dateText) {
  const anchor = parseIsoLocal(dateText || toIsoLocal(new Date()))
  if (mode === 'day') {
    const key = toIsoLocal(anchor)
    return { dateFrom: key, dateTo: key }
  }
  if (mode === 'week') {
    const weekday = anchor.getDay() || 7
    const start = addDaysLocal(anchor, 1 - weekday)
    return { dateFrom: toIsoLocal(start), dateTo: toIsoLocal(addDaysLocal(start, 6)) }
  }
  if (mode === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    return { dateFrom: toIsoLocal(start), dateTo: toIsoLocal(end) }
  }
  if (mode === 'year') {
    return { dateFrom: `${anchor.getFullYear()}-01-01`, dateTo: `${anchor.getFullYear()}-12-31` }
  }
  return { dateFrom: '', dateTo: '' }
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function periodKey(dateText, granularity) {
  const date = dateText ? new Date(dateText) : new Date()
  if (granularity === 'year') return String(date.getFullYear())
  if (granularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  if (granularity === 'week') {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const day = utc.getUTCDay() || 7
    utc.setUTCDate(utc.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)
    return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
  }
  return toIsoLocal(date)
}

function buildEntryReportModel(entries, products, filters) {
  const dateFrom = filters.dateFrom
  const dateTo = filters.dateTo
  const type = filters.type
  const query = normalize(filters.query)

  const filtered = (entries || []).filter((entry) => {
    const date = entry.date || ''
    if (dateFrom && date < dateFrom) return false
    if (dateTo && date > dateTo) return false
    if (filters.supplierId !== 'all' && normalize(entry.supplierId) !== normalize(filters.supplierId)) return false
    if (type !== 'all' && entry.type !== type) return false
    if (query) {
      const haystack = normalize([entry.reference, entry.supplierInvoice, entry.supplierName, (entry.items || []).map((item) => `${item.productName} ${item.productId}`).join(' ')].join(' '))
      if (!haystack.includes(query)) return false
    }
    return true
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

  const productById = new Map((products || []).map((product) => [product.id, product]))
  const lines = filtered.flatMap((entry) => (entry.items || []).map((item) => {
    const product = productById.get(item.productId) || {}
    return {
      entryId: entry.id,
      entryDate: entry.date,
      entryType: entry.type,
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      reference: entry.reference,
      supplierInvoice: entry.supplierInvoice,
      productId: item.productId,
      productName: item.productName,
      sku: product.sku || '',
      category: product.category || '',
      quantity: Number(item.quantity || 0),
      cost: Number(item.cost || 0),
      subtotal: Number(item.subtotal ?? Number(item.quantity || 0) * Number(item.cost || 0)),
    }
  }))

  const byProduct = new Map()
  const bySupplier = new Map()
  const byType = new Map()
  const byPeriod = new Map()
  lines.forEach((line) => {
    const productRow = byProduct.get(line.productId) || { productId: line.productId, productName: line.productName, sku: line.sku, category: line.category, entries: 0, units: 0, cost: 0, stock: Number(productById.get(line.productId)?.stock || 0) }
    productRow.entries += 1
    productRow.units += line.quantity
    productRow.cost += line.subtotal
    byProduct.set(line.productId, productRow)

    const supplierKey = line.supplierId || 'no-supplier'
    const supplierRow = bySupplier.get(supplierKey) || { supplierId: line.supplierId, supplierName: line.supplierName || 'Sin proveedor', entries: 0, units: 0, cost: 0 }
    supplierRow.entries += 1
    supplierRow.units += line.quantity
    supplierRow.cost += line.subtotal
    bySupplier.set(supplierKey, supplierRow)

    const typeRow = byType.get(line.entryType) || { type: line.entryType || 'Sin tipo', entries: 0, units: 0, cost: 0 }
    typeRow.entries += 1
    typeRow.units += line.quantity
    typeRow.cost += line.subtotal
    byType.set(line.entryType, typeRow)

    const period = periodKey(line.entryDate, filters.granularity)
    const periodRow = byPeriod.get(period) || { period, entries: 0, units: 0, cost: 0 }
    periodRow.entries += 1
    periodRow.units += line.quantity
    periodRow.cost += line.subtotal
    byPeriod.set(period, periodRow)
  })

  const detailRows = filtered.map((entry) => ({
    id: entry.id,
    date: entry.date,
    type: entry.type,
    supplierName: entry.supplierName,
    reference: entry.reference,
    supplierInvoice: entry.supplierInvoice,
    products: (entry.items || []).length,
    units: (entry.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    cost: (entry.items || []).reduce((sum, item) => sum + Number(item.subtotal ?? Number(item.quantity || 0) * Number(item.cost || 0)), 0),
  }))

  const productRows = [...byProduct.values()].map((row) => ({ ...row, cost: roundMoney(row.cost), avgCost: row.units > 0 ? roundMoney(row.cost / row.units) : 0 })).sort((a, b) => b.cost - a.cost)
  const supplierRows = [...bySupplier.values()].map((row) => ({ ...row, cost: roundMoney(row.cost) })).sort((a, b) => b.cost - a.cost)
  const typeRows = [...byType.values()].map((row) => ({ ...row, cost: roundMoney(row.cost) })).sort((a, b) => b.cost - a.cost)
  const periodRows = [...byPeriod.values()].map((row) => ({ ...row, cost: roundMoney(row.cost) })).sort((a, b) => String(a.period).localeCompare(String(b.period)))

  const totalEntries = filtered.length
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0)
  const totalCost = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0))
  const avgUnitCost = totalUnits > 0 ? roundMoney(totalCost / totalUnits) : 0
  const avgEntryCost = totalEntries > 0 ? roundMoney(totalCost / totalEntries) : 0

  return { filtered, lines, detailRows, productRows, supplierRows, typeRows, periodRows, totalEntries, totalUnits, totalCost, avgUnitCost, avgEntryCost }
}

const chartOptions = {
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#cbd5e1', font: { weight: 'bold' } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 0 }, grid: { color: 'rgba(148,163,184,.08)' } },
    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.08)' } },
  },
}

const doughnutOptions = {
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { weight: 'bold' }, boxWidth: 12 } } },
}

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'detalle', label: 'Detalle', icon: ClipboardList },
  { id: 'productos', label: 'Productos', icon: Package },
  { id: 'proveedores', label: 'Proveedores', icon: Building2 },
  { id: 'tipos', label: 'Tipos', icon: Tags },
  { id: 'periodos', label: 'Periodos', icon: CalendarRange },
]

export function EntryReports() {
  const products = useERPStore((state) => state.products)
  const entries = useERPStore((state) => state.productEntries)
  const suppliers = useERPStore((state) => state.suppliers)
  const company = useERPStore((state) => state.company)
  const [filters, setFilters] = useState(() => ({ ...applyPeriodMode('month', toIsoLocal(new Date())), supplierId: 'all', type: 'all', query: '' }))
  const [periodMode, setPeriodMode] = useState('month')
  const [focusDate, setFocusDate] = useState('')
  const [activeChip, setActiveChip] = useState('this_month')
  const [showExtraFilters, setShowExtraFilters] = useState(false)
  const [activeTab, setActiveTab] = useState('resumen')
  const [rowDetail, setRowDetail] = useState(null)

  const granularity = periodMode === 'range' ? 'month' : periodMode
  const model = useMemo(() => buildEntryReportModel(entries, products, { ...filters, granularity }), [entries, filters, products, granularity])

  const periodChartData = useMemo(() => {
    const rows = model.periodRows.slice(-12)
    return {
      labels: rows.map((row) => row.period),
      datasets: [
        { label: 'Costo invertido', data: rows.map((row) => row.cost), backgroundColor: '#3B82F6', borderRadius: 6 },
        { label: 'Unidades recibidas', data: rows.map((row) => row.units), backgroundColor: 'rgba(16,185,129,.55)', borderRadius: 6 },
      ],
    }
  }, [model.periodRows])

  const supplierChartData = useMemo(() => {
    const top = model.supplierRows.slice(0, 6)
    const rest = model.supplierRows.slice(6).reduce((sum, row) => sum + row.cost, 0)
    return {
      labels: [...top.map((row) => row.supplierName), ...(rest > 0 ? ['Otros'] : [])],
      datasets: [{
        data: [...top.map((row) => row.cost), ...(rest > 0 ? [roundMoney(rest)] : [])],
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#64748B'],
      }],
    }
  }, [model.supplierRows])

  function setFilter(key, value) {
    setFilters((state) => ({ ...state, [key]: value }))
  }

  function applyChip(chip) {
    const now = new Date()
    if (chip.all) {
      setPeriodMode('range')
      setFocusDate('')
      setFilters((state) => ({ ...state, dateFrom: '', dateTo: '' }))
      setActiveChip(chip.id)
      return
    }
    if (chip.mode === 'range') {
      setPeriodMode('range')
      setFocusDate('')
      setFilters((state) => ({ ...state, dateFrom: toIsoLocal(addDaysLocal(now, -chip.daysBack)), dateTo: toIsoLocal(now) }))
      setActiveChip(chip.id)
      return
    }
    const anchor = chip.mode === 'day' ? addDaysLocal(now, chip.offsetDays || 0) : new Date(now)
    if (chip.monthOffset) anchor.setMonth(anchor.getMonth() + chip.monthOffset)
    setPeriodMode(chip.mode)
    setFocusDate(chip.mode === 'day' ? toIsoLocal(anchor) : '')
    setFilters((state) => ({ ...state, ...applyPeriodMode(chip.mode, toIsoLocal(anchor)) }))
    setActiveChip(chip.id)
  }

  function switchMode(mode) {
    if (mode === periodMode) return
    setActiveChip('')
    if (mode === 'range') {
      setPeriodMode('range')
      if (!filters.dateFrom) setFilters((state) => ({ ...state, ...applyPeriodMode('month', toIsoLocal(new Date())) }))
      return
    }
    setPeriodMode(mode)
    setFilters((state) => ({ ...state, ...applyPeriodMode(mode, focusDate) }))
  }

  function jumpToDate(dateText) {
    setFocusDate(dateText || '')
    if (periodMode !== 'range') setFilters((state) => ({ ...state, ...applyPeriodMode(periodMode, dateText) }))
  }

  function exportExcel() {
    downloadCsvWorkbook('trifusion-reporte-entradas.csv', [
      { name: 'Resumen', rows: [
        { Indicador: 'Entradas', Valor: model.totalEntries },
        { Indicador: 'Unidades recibidas', Valor: model.totalUnits },
        { Indicador: 'Costo total invertido', Valor: model.totalCost },
        { Indicador: 'Costo promedio por unidad', Valor: model.avgUnitCost },
        { Indicador: 'Costo promedio por entrada', Valor: model.avgEntryCost },
      ] },
      { name: 'Entradas', rows: model.detailRows.map((row) => ({ Fecha: row.date, Tipo: row.type, Proveedor: row.supplierName, Referencia: row.reference, Factura: row.supplierInvoice, Productos: row.products, Unidades: row.units, Costo: row.cost })) },
      { name: 'Productos', rows: model.productRows.map((row) => ({ Producto: row.productName, SKU: row.sku, Categoria: row.category, Entradas: row.entries, Unidades: row.units, CostoTotal: row.cost, CostoPromedio: row.avgCost, StockActual: row.stock })) },
      { name: 'Proveedores', rows: model.supplierRows.map((row) => ({ Proveedor: row.supplierName, Entradas: row.entries, Unidades: row.units, Costo: row.cost })) },
      { name: 'Tipos', rows: model.typeRows.map((row) => ({ Tipo: row.type, Entradas: row.entries, Unidades: row.units, Costo: row.cost })) },
      { name: 'Periodos', rows: model.periodRows.map((row) => ({ Periodo: row.period, Entradas: row.entries, Unidades: row.units, Costo: row.cost })) },
    ])
  }

  async function exportPdf() {
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text('Reporte avanzado de entradas de productos', 12, 14)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(`${company?.name || 'Empresa'} | ${filters.dateFrom || 'inicio'} a ${filters.dateTo || 'hoy'} | ${model.totalEntries} entrada(s)`, 12, 21)

      autoTable(doc, {
        startY: 27,
        head: [['Indicador', 'Valor']],
        body: [
          ['Entradas registradas', String(model.totalEntries)],
          ['Unidades recibidas', String(model.totalUnits)],
          ['Costo total invertido', currency.format(model.totalCost)],
          ['Costo promedio por unidad', currency.format(model.avgUnitCost)],
          ['Costo promedio por entrada', currency.format(model.avgEntryCost)],
        ],
        headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        head: [['Fecha', 'Tipo', 'Proveedor', 'Referencia', 'Factura', 'Productos', 'Unidades', 'Costo']],
        body: model.detailRows.map((row) => [formatDate(row.date), row.type, row.supplierName, row.reference, row.supplierInvoice, row.products, row.units, currency.format(row.cost)]),
        styles: { fontSize: 7, cellPadding: 1.4 },
        headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        head: [['Producto', 'SKU', 'Categoria', 'Entradas', 'Unidades', 'Costo total', 'Costo promedio', 'Stock actual']],
        body: model.productRows.slice(0, 80).map((row) => [row.productName, row.sku, row.category, row.entries, row.units, currency.format(row.cost), currency.format(row.avgCost), row.stock]),
        styles: { fontSize: 7, cellPadding: 1.4 },
        headStyles: { fillColor: [139, 92, 246], textColor: 255 },
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        head: [['Proveedor', 'Entradas', 'Unidades', 'Costo']],
        body: model.supplierRows.map((row) => [row.supplierName, row.entries, row.units, currency.format(row.cost)]),
        styles: { fontSize: 7, cellPadding: 1.4 },
        headStyles: { fillColor: [245, 158, 11], textColor: 255 },
      })

      doc.save('reporte-entradas-productos.pdf')
    } catch (error) {
      console.error('Error generando PDF de entradas:', error)
    }
  }

  function openEntryDetail(row) {
    const entry = model.filtered.find((item) => item.id === row.id) || { items: [] }
    setRowDetail({
      title: `Entrada · ${formatDate(row.date)} · ${row.supplierName}`,
      subtitle: `${row.type} · Referencia ${row.reference || '-'} · Factura ${row.supplierInvoice || '-'} · ${entry.items.length} producto(s), ${row.units} unidad(es)`,
      head: ['Producto', 'Cantidad', 'Costo unit.', 'Subtotal'],
      body: (entry.items || []).map((item) => [item.productName, String(item.quantity), currency.format(item.cost), currency.format(Number(item.subtotal ?? Number(item.quantity || 0) * Number(item.cost || 0)))]),
    })
  }

  function openProductDetail(row) {
    const lines = model.lines.filter((line) => line.productId === row.productId)
    setRowDetail({
      title: row.productName,
      subtitle: `${row.sku ? `SKU ${row.sku} · ` : ''}${row.category ? `${row.category} · ` : ''}${lines.length} entrada(s) · ${row.units} unidades · ${currency.format(row.cost)} recibidos`,
      head: ['Fecha', 'Tipo', 'Proveedor', 'Cantidad', 'Costo unit.', 'Subtotal'],
      body: lines.map((line) => [formatDate(line.entryDate), line.entryType, line.supplierName, String(line.quantity), currency.format(line.cost), currency.format(line.subtotal)]),
    })
  }

  function openSupplierDetail(row) {
    const lines = model.lines.filter((line) => line.supplierId === row.supplierId)
    setRowDetail({
      title: row.supplierName,
      subtitle: `${lines.length} entrada(s) · ${row.units} unidades · ${currency.format(row.cost)} recibidos`,
      head: ['Fecha', 'Tipo', 'Producto', 'Referencia', 'Cantidad', 'Costo'],
      body: lines.map((line) => [formatDate(line.entryDate), line.entryType, line.productName, line.reference || '-', String(line.quantity), currency.format(line.subtotal)]),
    })
  }

  function openTypeDetail(row) {
    const lines = model.lines.filter((line) => line.entryType === row.type)
    setRowDetail({
      title: row.type,
      subtitle: `${lines.length} entrada(s) · ${row.units} unidades · ${currency.format(row.cost)}`,
      head: ['Fecha', 'Proveedor', 'Producto', 'Cantidad', 'Costo'],
      body: lines.map((line) => [formatDate(line.entryDate), line.supplierName, line.productName, String(line.quantity), currency.format(line.subtotal)]),
    })
  }

  function openPeriodDetail(row) {
    const lines = model.lines.filter((line) => periodKey(line.entryDate, granularity) === row.period)
    setRowDetail({
      title: `Periodo ${row.period}`,
      subtitle: `${lines.length} linea(s) · ${row.units} unidades · ${currency.format(row.cost)}`,
      head: ['Fecha', 'Tipo', 'Proveedor', 'Producto', 'Cantidad', 'Costo'],
      body: lines.map((line) => [formatDate(line.entryDate), line.entryType, line.supplierName, line.productName, String(line.quantity), currency.format(line.subtotal)]),
    })
  }

  const actionColumn = (handler) => ({ id: 'actions', header: '', cell: ({ row }) => <Button variant="ghost" icon={Eye} onClick={() => handler(row.original)}>Detalle</Button> })

  const detailColumns = [
    { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date) },
    { header: 'Tipo', accessorKey: 'type' },
    { header: 'Proveedor', accessorKey: 'supplierName' },
    { header: 'Referencia', accessorKey: 'reference' },
    { header: 'Factura', accessorKey: 'supplierInvoice' },
    { header: 'Productos', accessorKey: 'products' },
    { header: 'Unidades', accessorKey: 'units' },
    { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost) },
    actionColumn(openEntryDetail),
  ]

  const productColumns = [
    { header: 'Producto', accessorKey: 'productName' },
    { header: 'SKU', accessorKey: 'sku' },
    { header: 'Categoria', accessorKey: 'category' },
    { header: 'Entradas', accessorKey: 'entries' },
    { header: 'Unidades', accessorKey: 'units' },
    { header: 'Costo total', cell: ({ row }) => currency.format(row.original.cost) },
    { header: 'Costo prom.', cell: ({ row }) => currency.format(row.original.avgCost) },
    { header: 'Stock', accessorKey: 'stock' },
    actionColumn(openProductDetail),
  ]

  const supplierColumns = [
    { header: 'Proveedor', accessorKey: 'supplierName' },
    { header: 'Entradas', accessorKey: 'entries' },
    { header: 'Unidades', accessorKey: 'units' },
    { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost) },
    { header: 'Participacion', cell: ({ row }) => `${model.totalCost > 0 ? ((row.original.cost / model.totalCost) * 100).toFixed(1) : 0}%` },
    actionColumn(openSupplierDetail),
  ]

  const typeColumns = [
    { header: 'Tipo de entrada', accessorKey: 'type' },
    { header: 'Entradas', accessorKey: 'entries' },
    { header: 'Unidades', accessorKey: 'units' },
    { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost) },
    actionColumn(openTypeDetail),
  ]

  const periodColumns = [
    { header: 'Periodo', accessorKey: 'period' },
    { header: 'Entradas', accessorKey: 'entries' },
    { header: 'Unidades', accessorKey: 'units' },
    { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost) },
    actionColumn(openPeriodDetail),
  ]

  const tabCounts = {
    detalle: model.detailRows.length,
    productos: model.productRows.length,
    proveedores: model.supplierRows.length,
    tipos: model.typeRows.length,
    periodos: model.periodRows.length,
  }

  const isEmpty = model.totalEntries === 0

  return (
    <div className="printable-report space-y-5">
      <div className="module-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="module-header-eyebrow">Reporte avanzado de entradas</p>
            <h2 className="module-header-title">Cantidades recibidas y costo invertido</h2>
            <p className="module-header-desc">Filtre por dia, semana, mes o ano y explore los detalles de cada entrada.</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="primary" icon={FileText} onClick={exportPdf}>PDF</Button>
            <Button variant="ghost" icon={Download} onClick={exportExcel}>Excel</Button>
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Entradas registradas" value={String(model.totalEntries)} accent="blue" />
          <KpiCard label="Unidades recibidas" value={model.totalUnits.toLocaleString('es-DO')} accent="green" />
          <KpiCard label="Costo total invertido" value={currency.format(model.totalCost)} accent="amber" />
          <KpiCard label="Costo promedio por unidad" value={currency.format(model.avgUnitCost)} accent="violet" />
          <KpiCard label="Costo promedio por entrada" value={currency.format(model.avgEntryCost)} accent="cyan" />
        </div>
      </div>

      <section className="no-print rounded-2xl border border-[#243244] bg-[#111827] p-5">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => applyChip(chip)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${activeChip === chip.id ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25' : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.1] hover:text-white'}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-xl border border-[#243244]">
            {PERIOD_MODES.map((mode) => {
              const Icon = mode.icon
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => switchMode(mode.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold transition ${periodMode === mode.id ? 'bg-blue-500 text-white' : 'bg-white/[0.03] text-white/55 hover:bg-white/[0.08] hover:text-white'}`}
                >
                  <Icon size={14} /> {mode.label}
                </button>
              )
            })}
          </div>

          {periodMode === 'range' ? (
            <>
              <label className="block"><span className="label-dark">Desde</span><input type="date" value={filters.dateFrom || ''} onChange={(e) => setFilter('dateFrom', e.target.value)} className="input-dark" /></label>
              <label className="block"><span className="label-dark">Hasta</span><input type="date" value={filters.dateTo || ''} onChange={(e) => setFilter('dateTo', e.target.value)} className="input-dark" /></label>
            </>
          ) : (
            <label className="block">
              <span className="label-dark">Buscar fecha de {MODE_LABELS[periodMode]}</span>
              <input type="date" value={focusDate} onChange={(e) => jumpToDate(e.target.value)} className="input-dark" />
            </label>
          )}

          <button type="button" onClick={() => setShowExtraFilters((s) => !s)} className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${showExtraFilters ? 'border-blue-400/40 bg-blue-500/10 text-blue-300' : 'border-[#243244] bg-white/[0.03] text-white/55 hover:bg-white/[0.08] hover:text-white'}`}>
            <Filter size={14} /> Mas filtros
          </button>
        </div>

        {showExtraFilters ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label><span className="label-dark">Proveedor</span><select value={filters.supplierId} onChange={(e) => setFilter('supplierId', e.target.value)} className="input-dark"><option value="all">Todos</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label><span className="label-dark">Tipo de entrada</span><select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className="input-dark"><option value="all">Todos</option>{ENTRY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label><span className="label-dark">Busqueda</span>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
                <input value={filters.query} onChange={(e) => setFilter('query', e.target.value)} className="input-dark pl-9" placeholder="Proveedor, referencia, factura, producto..." />
              </div>
            </label>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#243244] pt-3 text-xs font-bold text-[#94A3B8]">
          <span className="flex items-center gap-1.5"><CalendarDays size={14} /> {filters.dateFrom || 'Inicio'} a {filters.dateTo || 'Hoy'}</span>
          <span>{model.totalEntries} entrada(s) filtrada(s)</span>
          <span>{model.lines.length} linea(s) de producto</span>
        </div>
      </section>

      <div className="no-print premium-scroll flex flex-wrap items-center gap-2 overflow-x-auto rounded-2xl border border-[#243244] bg-[#111827] p-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const count = tabCounts[tab.id]
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${isActive ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}
            >
              <Icon size={15} /> {tab.label}
              {tab.id !== 'resumen' ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/25 text-white' : 'bg-white/[0.07] text-white/45'}`}>{count}</span> : null}
            </button>
          )
        })}
      </div>

      {isEmpty ? (
        <section className="no-print rounded-2xl border border-dashed border-[#243244] bg-[#111827] p-12 text-center">
          <Package size={36} className="mx-auto text-white/15" />
          <p className="mt-4 font-display text-lg font-bold text-white/70">No hay entradas en el periodo seleccionado</p>
          <p className="mt-1 text-sm text-white/40">Cambie el filtro de fecha, el modo de periodo o los filtros adicionales.</p>
        </section>
      ) : null}

      {!isEmpty && activeTab === 'resumen' ? (
        <section className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Costo y unidades por {MODE_LABELS[granularity]}</h3>
              <span className="text-xs font-bold text-white/40">Ultimos 12 periodos</span>
            </div>
            <div className="h-64"><Bar data={periodChartData} options={chartOptions} /></div>
          </div>
          <div className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Costo por proveedor</h3>
              <span className="text-xs font-bold text-white/40">Top 6</span>
            </div>
            <div className="h-64"><Doughnut data={supplierChartData} options={doughnutOptions} /></div>
          </div>
        </section>
      ) : null}

      {!isEmpty && activeTab === 'detalle' ? (
        <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><ClipboardList size={16} className="text-blue-400" /> Detalle de entradas</h3>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-white/50">{model.detailRows.length}</span>
          </div>
          <DataTable data={model.detailRows} columns={detailColumns} initialPageSize={10} emptyText="No hay entradas con los filtros seleccionados." searchPlaceholder="Buscar entrada..." />
        </section>
      ) : null}

      {!isEmpty && activeTab === 'productos' ? (
        <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Package size={16} className="text-blue-400" /> Resumen por producto</h3>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-white/50">{model.productRows.length}</span>
          </div>
          <DataTable data={model.productRows} columns={productColumns} initialPageSize={10} emptyText="Sin productos en el rango." searchPlaceholder="Buscar producto, SKU o categoria..." />
        </section>
      ) : null}

      {!isEmpty && activeTab === 'proveedores' ? (
        <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Building2 size={16} className="text-blue-400" /> Resumen por proveedor</h3>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-white/50">{model.supplierRows.length}</span>
          </div>
          <DataTable data={model.supplierRows} columns={supplierColumns} initialPageSize={10} emptyText="Sin proveedores." searchPlaceholder="Buscar en tabla..." />
        </section>
      ) : null}

      {!isEmpty && activeTab === 'tipos' ? (
        <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Tags size={16} className="text-blue-400" /> Resumen por tipo de entrada</h3>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-white/50">{model.typeRows.length}</span>
          </div>
          <DataTable data={model.typeRows} columns={typeColumns} initialPageSize={10} emptyText="Sin tipos." searchPlaceholder="Buscar en tabla..." />
        </section>
      ) : null}

      {!isEmpty && activeTab === 'periodos' ? (
        <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><CalendarRange size={16} className="text-blue-400" /> Acumulados por {MODE_LABELS[granularity]}</h3>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-white/50">{model.periodRows.length}</span>
          </div>
          <DataTable data={model.periodRows} columns={periodColumns} initialPageSize={10} emptyText="Sin periodos." searchPlaceholder="Buscar en tabla..." />
        </section>
      ) : null}

      <DetailModal detail={rowDetail} onClose={() => setRowDetail(null)} />
    </div>
  )
}

function KpiCard({ label, value, accent }) {
  const colors = { blue: '#60A5FA', green: '#34D399', amber: '#FBBF24', violet: '#A78BFA', cyan: '#22D3EE' }
  return (
    <div className="summary-chip" style={{ background: `color-mix(in srgb, ${colors[accent] || colors.blue} 9%, transparent)` }}>
      <span className="summary-chip-label">{label}</span>
      <span className="summary-chip-value">{value}</span>
    </div>
  )
}

function DetailModal({ detail, onClose }) {
  return (
    <Modal open={Boolean(detail)} onClose={onClose} title={detail?.title || ''} size="xl">
      {detail ? (
        <div className="space-y-3">
          <p className="text-sm text-white/55">{detail.subtitle}</p>
          <div className="premium-scroll max-h-[60vh] overflow-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-white/45">
                <tr>{detail.head.map((head) => <th key={head} className="bg-black/40 px-3 py-2">{head}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {detail.body.map((cells, index) => (
                  <tr key={index}>
                    {cells.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-white/70">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
