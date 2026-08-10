import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, ArrowUpRight, CalendarDays, Download, FileSpreadsheet, Pencil, Printer, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { DataTable } from '../../components/ui/DataTable'
import { useToast } from '../../hooks/useToast'
import { downloadCsv } from '../../lib/csvExport'
import { useERPStore } from '../../store/useERPStore'
import { currency, formatDate } from '../../lib/formatters'

const typeConfig = {
  ingreso: { icon: ArrowDownCircle, color: 'var(--color-income)', bg: 'rgba(16,185,129,.12)' },
  income: { icon: ArrowDownCircle, color: 'var(--color-income)', bg: 'rgba(16,185,129,.12)' },
  pago: { icon: ArrowDownCircle, color: 'var(--color-income)', bg: 'rgba(16,185,129,.12)' },
  egreso: { icon: ArrowUpCircle, color: 'var(--color-alert)', bg: 'rgba(239,68,68,.12)' },
  expense: { icon: ArrowUpCircle, color: 'var(--color-alert)', bg: 'rgba(239,68,68,.12)' },
  gasto: { icon: ArrowUpCircle, color: 'var(--color-alert)', bg: 'rgba(239,68,68,.12)' },
  transferencia: { icon: RefreshCw, color: 'var(--color-nav)', bg: 'rgba(59,130,246,.12)' },
  transfer: { icon: RefreshCw, color: 'var(--color-nav)', bg: 'rgba(59,130,246,.12)' },
}

function getTypeConfig(type) {
  return typeConfig[String(type || '').toLowerCase()] || { icon: RefreshCw, color: 'var(--text-secondary)', bg: 'rgba(255,255,255,.06)' }
}

export function FinancialMovements() {
  const navigate = useNavigate()
  const toast = useToast()
  const movements = useERPStore((state) => state.financialMovements || [])
  const company = useERPStore((state) => state.company)
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const filtered = useMemo(() => {
    let result = movements
    if (query) {
      const q = query.toLowerCase()
      result = result.filter((m) =>
        (m.documentNumber || '').toLowerCase().includes(q)
        || (m.customerName || '').toLowerCase().includes(q)
        || (m.type || '').toLowerCase().includes(q)
        || (m.method || '').toLowerCase().includes(q)
        || (m.observations || '').toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') {
      result = result.filter((m) => String(m.type || '').toLowerCase() === typeFilter.toLowerCase())
    }
    if (dateFrom) {
      result = result.filter((m) => String(m.createdAt || m.date || '').slice(0, 10) >= dateFrom)
    }
    if (dateTo) {
      result = result.filter((m) => String(m.createdAt || m.date || '').slice(0, 10) <= dateTo)
    }
    return result
  }, [movements, query, typeFilter, dateFrom, dateTo])

  const types = useMemo(() => [...new Set(movements.map((m) => m.type).filter(Boolean))], [movements])
  const summary = useMemo(() => buildMovementSummary(filtered), [filtered])

  function openEdit(movement) {
    setEditing(movement)
    setEditForm({
      type: movement.type || '',
      method: movement.method || '',
      amount: String(movement.amount || '0'),
      observations: movement.observations || '',
      reference: movement.reference || '',
    })
  }

  function saveEdit() {
    try {
      const state = useERPStore.getState()
      const updated = (state.financialMovements || []).map((m) =>
        m.id === editing.id
          ? { ...m, ...editForm, amount: Number(editForm.amount), updatedAt: new Date().toISOString() }
          : m
      )
      useERPStore.setState({ financialMovements: updated })
      toast.success('Movimiento actualizado.')
      setEditing(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function deleteMovement(movement) {
    if (!window.confirm(`Eliminar movimiento ${movement.id}?`)) return
    try {
      const state = useERPStore.getState()
      useERPStore.setState({
        financialMovements: (state.financialMovements || []).filter((m) => m.id !== movement.id),
      })
      toast.success('Movimiento eliminado.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function exportCsv() {
    const rows = filtered.map((m) => ({
      ID: m.id || '',
      Fecha: m.date || '',
      Hora: m.time || '',
      Usuario: m.user || '',
      Tipo: m.type || '',
      Documento: m.documentNumber || '',
      Cliente: m.customerName || '',
      Monto: m.amount || 0,
      Comentario: m.observations || '',
    }))
    downloadCsv('movimientos-financieros.csv', rows)
  }

  async function downloadAdvancedPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    const title = 'Registro avanzado de movimientos financieros'
    const generatedAt = new Date()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text(title, 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${company?.name || 'Mi Empresa'} | Generado: ${formatDate(generatedAt)} | ${filtered.length} movimiento(s)`, 12, 20)
    doc.text(`Rango: ${dateFrom || 'inicio'} a ${dateTo || 'hoy'} | Tipo: ${typeFilter === 'all' ? 'Todos' : typeFilter} | Busqueda: ${query || 'Sin busqueda'}`, 12, 25)

    autoTable(doc, {
      startY: 31,
      head: [['Indicador', 'Valor']],
      body: [
        ['Ingresos', currency.format(summary.income)],
        ['Egresos', currency.format(summary.expense)],
        ['Balance neto', currency.format(summary.net)],
        ['Movimientos', summary.count],
        ['Promedio por movimiento', currency.format(summary.average)],
        ['Mayor movimiento', currency.format(summary.maxAmount)],
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 7,
      head: [['Tipo', 'Movimientos', 'Ingresos', 'Egresos', 'Neto']],
      body: summary.byType.map((row) => [row.label, row.count, currency.format(row.income), currency.format(row.expense), currency.format(row.net)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 7,
      head: [['Metodo', 'Movimientos', 'Total neto']],
      body: summary.byMethod.map((row) => [row.label, row.count, currency.format(row.net)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [139, 92, 246], textColor: 255 },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 7,
      head: [['Fecha', 'Tipo', 'Documento', 'Cliente', 'Metodo', 'Monto', 'Usuario', 'Observacion']],
      body: filtered.slice(0, 250).map((m) => [
        formatDate(m.createdAt || m.date),
        m.type || '',
        m.documentNumber || m.reference || '',
        m.customerName || '',
        m.method || '',
        currency.format(m.amount || 0),
        m.user || '',
        m.observations || '',
      ]),
      styles: { fontSize: 7, cellPadding: 1.8 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    })
    doc.save(`movimientos-financieros-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  function printMovements() {
    window.print()
  }

  return (
    <div className="space-y-0">
      <section className="module-header financial-movements-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="module-header-eyebrow">Modulo financiero</p>
            <h2 className="module-header-title">Registro de movimientos</h2>
            <p className="module-header-desc">Auditoria separada de ingresos, egresos, abonos, ajustes, reversiones y cobros.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Download} onClick={downloadAdvancedPdf}>PDF avanzado</Button>
            <Button variant="ghost" icon={Printer} onClick={printMovements}>Imprimir</Button>
            <Button variant="primary" icon={FileSpreadsheet} onClick={exportCsv}>Exportar CSV</Button>
          </div>
        </div>
        <div className="movement-kpi-strip">
          <MovementKpi label="Ingresos" value={currency.format(summary.income)} accent="green" />
          <MovementKpi label="Egresos" value={currency.format(summary.expense)} accent="red" />
          <MovementKpi label="Balance neto" value={currency.format(summary.net)} accent={summary.net >= 0 ? 'blue' : 'amber'} />
          <MovementKpi label="Movimientos" value={summary.count} accent="violet" />
        </div>
      </section>

      <section className="movement-command-board no-print">
        {[
          { label: 'Facturas', path: '/facturacion/historial', accent: 'blue' },
          { label: 'Caja', path: '/caja', accent: 'green' },
          { label: 'CxC', path: '/cxc', accent: 'amber' },
          { label: 'Contabilidad', path: '/contabilidad', accent: 'violet' },
          { label: 'Reportes', path: '/reportes', accent: 'cyan' },
        ].map((item) => (
          <button key={item.path} type="button" onClick={() => navigate(item.path)} className={`movement-link-card report-nav-${item.accent}`}>
            <span>{item.label}</span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </section>

      <section className="section-card movement-workspace">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg px-3 py-2" style={{ border: '1px solid var(--line)', background: 'var(--bg-input)' }}>
            <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input id="financial-query" name="financial-query" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Buscar por documento, cliente, tipo, metodo, comentario..." aria-label="financial-query" />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            <CalendarDays size={14} />
            <input id="financial-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-dark max-w-36" />
            <span>-</span>
            <input id="financial-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-dark max-w-36" />
          </label>
          <select id="financial-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-dark max-w-40" aria-label="financial-type-filter">
            <option value="all">Todos los tipos</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="movement-breakdown-grid">
          <BreakdownList title="Por tipo" rows={summary.byType} />
          <BreakdownList title="Por metodo" rows={summary.byMethod} />
        </div>
        <div className="mt-3 border-t" style={{ borderColor: 'var(--line)' }} />
        <div className="mt-4">
          <DataTable data={filtered} columns={[
            { header: 'ID', cell: ({ row }) => <span className="text-xs" style={{ color: 'rgba(255,255,255,.5)' }}>{row.original.id?.slice(0, 12)}...</span> },
            { header: 'Fecha', cell: ({ row }) => formatDate(row.original.createdAt || row.original.date) },
            { header: 'Usuario', accessorKey: 'user' },
            { header: 'Tipo', cell: ({ row }) => <TypeBadge type={row.original.type} /> },
            { header: 'Documento', accessorKey: 'documentNumber' },
            { header: 'Cliente', accessorKey: 'customerName' },
            { header: 'Monto', cell: ({ row }) => <span style={{ color: getTypeConfig(row.original.type).color }}>{currency.format(row.original.amount || 0)}</span> },
            { header: 'Comentario', accessorKey: 'observations' },
            { header: 'Acciones', cell: ({ row }) => (
              <div className="flex gap-1">
                <button onClick={() => openEdit(row.original)} className="rounded-md border p-2 transition" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }} title="Editar"><Pencil size={15} /></button>
                <button onClick={() => deleteMovement(row.original)} className="rounded-md border p-2 transition" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }} title="Eliminar"><Trash2 size={15} /></button>
              </div>
            )},
          ]} />
        </div>
      </section>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar movimiento" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="success" onClick={saveEdit}>Guardar</Button></div>}>
        {editing ? <div className="grid gap-3 md:grid-cols-2">
          <Input label="Tipo" name="financial-type" value={editForm.type} onChange={(v) => setEditForm((s) => ({ ...s, type: v }))} />
          <Input label="Metodo" name="financial-method" value={editForm.method} onChange={(v) => setEditForm((s) => ({ ...s, method: v }))} />
          <Input label="Monto" name="financial-amount" type="number" step="0.01" value={editForm.amount} onChange={(v) => setEditForm((s) => ({ ...s, amount: v }))} />
          <Input label="Referencia" name="financial-reference" value={editForm.reference} onChange={(v) => setEditForm((s) => ({ ...s, reference: v }))} />
          <div className="md:col-span-2"><Input label="Observaciones" name="financial-observations" value={editForm.observations} onChange={(v) => setEditForm((s) => ({ ...s, observations: v }))} /></div>
        </div> : null}
      </Modal>
    </div>
  )
}

function MovementKpi({ label, value, accent }) {
  return <div className={`movement-kpi report-nav-${accent}`}><span>{label}</span><strong>{value}</strong></div>
}

function BreakdownList({ title, rows }) {
  return (
    <div className="movement-breakdown">
      <p>{title}</p>
      <div>
        {rows.slice(0, 5).map((row) => (
          <span key={row.label}>
            <strong>{row.label}</strong>
            <small>{currency.format(row.net)}</small>
          </span>
        ))}
        {!rows.length ? <em>Sin datos</em> : null}
      </div>
    </div>
  )
}

function buildMovementSummary(rows) {
  const summary = { count: rows.length, income: 0, expense: 0, net: 0, average: 0, maxAmount: 0, byType: [], byMethod: [] }
  const byType = new Map()
  const byMethod = new Map()
  rows.forEach((movement) => {
    const amount = Math.abs(Number(movement.amount || 0))
    const signed = signedMovementAmount(movement)
    if (signed >= 0) summary.income += amount
    else summary.expense += amount
    summary.net += signed
    summary.maxAmount = Math.max(summary.maxAmount, amount)
    addBreakdown(byType, movement.type || 'Sin tipo', signed, amount)
    addBreakdown(byMethod, movement.method || 'Sin metodo', signed, amount)
  })
  summary.average = summary.count ? Math.abs(summary.net) / summary.count : 0
  summary.byType = finalizeBreakdown(byType)
  summary.byMethod = finalizeBreakdown(byMethod)
  return summary
}

function signedMovementAmount(movement) {
  const amount = Math.abs(Number(movement.amount || 0))
  const type = String(movement.type || '').toLowerCase()
  if (['egreso', 'expense', 'gasto', 'salida', 'debit'].some((word) => type.includes(word))) return -amount
  return amount
}

function addBreakdown(map, label, signed, amount) {
  const row = map.get(label) || { label, count: 0, income: 0, expense: 0, net: 0 }
  row.count += 1
  if (signed >= 0) row.income += amount
  else row.expense += amount
  row.net += signed
  map.set(label, row)
}

function finalizeBreakdown(map) {
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
}

function TypeBadge({ type }) {
  const config = getTypeConfig(type)
  const Icon = config.icon
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: config.bg, color: config.color }}>
      <Icon size={12} /> {type || 'Movimiento'}
    </span>
  )
}

function Input({ label, value, onChange, type = 'text', step, name }) {
  return <label><span className="label-dark">{label}</span><input id={name} name={name} type={type} step={step} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark" /></label>
}
