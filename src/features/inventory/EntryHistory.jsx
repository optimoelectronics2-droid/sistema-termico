import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Barcode, Boxes, Calendar, CalendarCheck, CalendarDays, CalendarRange, ChevronDown, ChevronUp, ClipboardList, Eye, Package, Pencil, Search, Trash2, Wallet } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { todayIso } from '../../lib/dateTime'
import { currency, formatDate } from '../../lib/formatters'
import { compareValues, normalizeText, QUICK_DATE_CHIPS, quickChipRange } from '../../lib/period'
import { ENTRY_TYPES, TypeBadge } from './entryTypes'

const CHIP_ICONS = {
  today: CalendarDays,
  yesterday: CalendarDays,
  this_week: CalendarRange,
  this_month: Calendar,
  last_month: Calendar,
  last_30: CalendarRange,
  this_year: CalendarCheck,
  all: Calendar,
}

const SORTABLE = [
  { key: 'number', label: 'Entrada' },
  { key: 'date', label: 'Fecha' },
  { key: 'productName', label: 'Producto' },
  { key: 'quantity', label: 'Cantidad' },
  { key: 'cost', label: 'Costo unitario' },
  { key: 'subtotal', label: 'Subtotal' },
]

function flattenEntries(entries) {
  const rows = []
  for (const entry of entries || []) {
    for (const item of entry.items || []) {
      rows.push({
        entryId: entry.id,
        number: entry.number || '',
        date: entry.date,
        type: entry.type,
        supplierName: entry.supplierName,
        reference: entry.reference,
        supplierInvoice: entry.supplierInvoice,
        productId: item.productId,
        productName: item.productName,
        quantity: Number(item.quantity || 0),
        cost: Number(item.cost || 0),
        subtotal: Number(item.subtotal || 0),
        serials: item.serials || [],
      })
    }
  }
  return rows
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'linear-gradient(180deg, var(--bg-elevated), var(--bg-surface))', border: '1px solid var(--line-subtle)', boxShadow: '0 12px 30px rgba(0,0,0,.22)' }}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: accent.bg, color: accent.color, border: `1px solid ${accent.border}` }}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
        <p className="truncate font-display text-lg font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{value}</p>
      </div>
    </div>
  )
}

export function EntryHistory({ entries, onView, onLabels, onEdit, onDelete, showReport, onToggleReport }) {
  const [chip, setChip] = useState('today')
  const [dateFrom, setDateFrom] = useState(todayIso())
  const [dateTo, setDateTo] = useState(todayIso())
  const [typeFilter, setTypeFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const rows = useMemo(() => flattenEntries(entries), [entries])

  const filteredRows = useMemo(() => {
    const term = normalizeText(query)
    return rows.filter((row) => {
      const key = String(row.date || '').slice(0, 10)
      if (dateFrom && key < dateFrom) return false
      if (dateTo && key > dateTo) return false
      if (typeFilter !== 'all' && row.type !== typeFilter) return false
      if (term && !normalizeText(`${row.productName} ${row.supplierName} ${row.reference} ${row.supplierInvoice}`).includes(term)) return false
      return true
    })
  }, [rows, dateFrom, dateTo, typeFilter, query])

  const sortedRows = useMemo(() => {
    const direction = sort.direction === 'desc' ? -1 : 1
    return [...filteredRows].sort((left, right) => compareValues(left[sort.key], right[sort.key]) * direction)
  }, [filteredRows, sort])

  const stats = useMemo(() => {
    const entryIds = new Set()
    let lines = 0
    let units = 0
    let invested = 0
    for (const row of filteredRows) {
      entryIds.add(row.entryId)
      lines += 1
      units += row.quantity
      invested += row.subtotal
    }
    return { entries: entryIds.size, lines, units, invested }
  }, [filteredRows])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const visibleRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [rows, dateFrom, dateTo, typeFilter, query, sort, pageSize])

  function applyChip(id) {
    const range = quickChipRange(id)
    setChip(id)
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl font-bold">Historial de entradas</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Cada linea de producto recibida en detalle, con filtros por fecha, tipo y proveedor.</p>
        </div>
        <Button variant={showReport ? 'primary' : 'ghost'} icon={BarChart3} onClick={onToggleReport}>{showReport ? 'Ocultar reporte avanzado' : 'Reporte avanzado'}</Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {QUICK_DATE_CHIPS.map(({ id, label }) => {
          const Icon = CHIP_ICONS[id] || Calendar
          return (
            <button
              key={id}
              type="button"
              onClick={() => applyChip(id)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition"
              style={chip === id
                ? { background: 'linear-gradient(135deg, var(--blue), var(--violet))', color: '#fff', boxShadow: '0 8px 20px rgba(99,102,241,.35)' }
                : { background: 'transparent', border: '1px solid var(--line-subtle)', color: 'var(--text-secondary)' }}
              onMouseEnter={(event) => { if (chip !== id) { event.currentTarget.style.background = 'rgba(255,255,255,.05)'; event.currentTarget.style.color = 'var(--text-primary)' } }}
              onMouseLeave={(event) => { if (chip !== id) { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = 'var(--text-secondary)' } }}
            >
              <Icon size={13} />
              {label}
            </button>
          )
        })}
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label>
          <span className="label-dark">Desde</span>
          <input id="history-from" name="history-from" type="date" value={dateFrom || ''} onChange={(event) => { setChip(''); setDateFrom(event.target.value) }} className="input-dark" />
        </label>
        <label>
          <span className="label-dark">Hasta</span>
          <input id="history-to" name="history-to" type="date" value={dateTo || ''} onChange={(event) => { setChip(''); setDateTo(event.target.value) }} className="input-dark" />
        </label>
        <label>
          <span className="label-dark">Tipo de entrada</span>
          <select id="history-type" name="history-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="input-dark">
            <option value="all">Todos los tipos</option>
            {ENTRY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="min-w-[240px] flex-1">
          <span className="label-dark">Buscar</span>
          <span className="flex items-center gap-2 rounded-[10px] border px-3" style={{ background: 'var(--bg-input)', borderColor: 'var(--line)' }}>
            <Search size={14} style={{ color: 'var(--text-tertiary)' }} />
            <input id="history-search" name="history-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Producto, proveedor, referencia o factura" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/30" />
          </span>
        </label>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ClipboardList} label="Entradas" value={stats.entries} accent={{ color: '#60a5fa', bg: 'rgba(96,165,250,.12)', border: 'rgba(96,165,250,.35)' }} />
        <StatCard icon={Boxes} label="Lineas de producto" value={stats.lines} accent={{ color: '#34d399', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.35)' }} />
        <StatCard icon={Package} label="Unidades recibidas" value={stats.units} accent={{ color: '#fbbf24', bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.35)' }} />
        <StatCard icon={Wallet} label="Total invertido" value={currency.format(stats.invested)} accent={{ color: '#e879f9', bg: 'rgba(232,121,249,.12)', border: 'rgba(232,121,249,.35)' }} />
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: 'linear-gradient(180deg, var(--bg-elevated), var(--bg-surface))', border: '1px solid var(--line-subtle)', boxShadow: '0 24px 60px rgba(0,0,0,.30)' }}>
        <div className="premium-scroll overflow-x-auto">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide" style={{ background: 'rgba(255,255,255,.03)', borderBottom: '1px solid var(--line)' }}>
                {SORTABLE.map(({ key, label }) => (
                  <th key={key} className="px-4 py-3.5">
                    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider transition hover:text-white" style={{ color: 'var(--text-secondary)' }}>
                      {label}
                      {sort.key === key ? (sort.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3.5 font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Tipo</th>
                <th className="px-4 py-3.5 font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Proveedor</th>
                <th className="px-4 py-3.5 font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Referencia</th>
                <th className="px-4 py-3.5 font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Seriales</th>
                <th className="px-4 py-3.5 text-right font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row) => {
                const entry = entries.find((item) => item.id === row.entryId)
                const serialsText = row.serials.join(', ')
                return (
                  <tr key={`${row.entryId}-${row.productId}`} className="border-t transition hover:bg-white/[.03]" style={{ borderColor: 'rgba(255,255,255,.06)' }}>
                    <td className="px-4 py-3.5 whitespace-nowrap font-bold" style={{ color: '#60a5fa' }}>{row.number || '—'}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-3.5"><TypeBadge type={row.type} /></td>
                    <td className="px-4 py-3.5">
                      <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{row.productName || 'Producto eliminado'}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>x{row.quantity} {row.serials.length > 0 ? `· ${row.serials.length} serial(es)` : ''}</p>
                    </td>
                    <td className="px-4 py-3.5 font-semibold">{row.quantity}</td>
                    <td className="px-4 py-3.5">{currency.format(row.cost)}</td>
                    <td className="px-4 py-3.5 font-bold" style={{ color: 'var(--text-primary)' }}>{currency.format(row.subtotal)}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{row.supplierName || 'Sin proveedor'}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{row.reference || (row.supplierInvoice ? `Factura ${row.supplierInvoice}` : '—')}</td>
                    <td className="px-4 py-3.5" title={serialsText}>
                      {row.serials.length ? <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{row.serials.slice(0, 2).join(', ')}{row.serials.length > 2 ? ` +${row.serials.length - 2}` : ''}</span> : <span className="text-white/30">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" title="Ver detalle" onClick={() => onView(entry)} className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white" style={{ color: 'var(--text-secondary)' }}><Eye size={15} /></button>
                        <button type="button" title="Imprimir etiquetas" onClick={() => onLabels(entry)} className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white" style={{ color: 'var(--text-secondary)' }}><Barcode size={15} /></button>
                        <button type="button" title="Editar entrada" onClick={() => onEdit(entry)} className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white" style={{ color: 'var(--text-secondary)' }}><Pencil size={15} /></button>
                        <button type="button" title="Eliminar entrada" onClick={() => onDelete(entry)} className="rounded-lg p-2 transition hover:bg-red-500/15 hover:text-red-300" style={{ color: 'var(--text-secondary)' }}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center">
                    <Search size={28} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                    <p className="font-bold" style={{ color: 'var(--text-secondary)' }}>No hay entradas para los filtros seleccionados</p>
                    <button type="button" onClick={() => { applyChip('today'); setTypeFilter('all'); setQuery('') }} className="mt-3 text-xs font-bold underline underline-offset-4 transition hover:text-white" style={{ color: 'var(--text-tertiary)' }}>Limpiar filtros</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.02)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>{sortedRows.length ? `Mostrando ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sortedRows.length)} de ${sortedRows.length} linea(s) · ${stats.entries} entrada(s)` : 'Sin resultados'}</span>
          <div className="flex items-center gap-2">
            <select id="history-page-size" name="history-page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="input-dark max-w-32 py-1.5 text-xs" aria-label="history-page-size">
              {[10, 25, 50, 100].map((option) => <option key={option} value={option}>{option} por pagina</option>)}
            </select>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} className="rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Anterior</button>
            <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>{safePage} / {totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={safePage >= totalPages} className="rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Siguiente</button>
          </div>
        </div>
      </div>
    </section>
  )
}
