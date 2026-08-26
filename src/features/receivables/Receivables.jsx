import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, History, MessageCircle, Pencil, ReceiptText, Search, Wallet } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { DataTable } from '../../components/ui/DataTable'
import { useToast } from '../../hooks/useToast'
import { downloadCsv } from '../../lib/csvExport'
import { daysUntil, todayIso } from '../../lib/dateTime'
import { isActiveReceivable } from '../../lib/realDataGuards'
import { useERPStore } from '../../store/useERPStore'
import { currency, formatDate } from '../../lib/formatters'

const today = todayIso
const daysTo = daysUntil

const statusLabels = {
  open: 'Pendiente',
  partial: 'Parcialmente pagada',
  paid: 'Pagada',
  overdue: 'Vencida',
  collection: 'En gestion',
  uncollectible: 'Incobrable',
}

const statusColors = {
  open: '#3B82F6',
  partial: '#F59E0B',
  paid: '#10B981',
  overdue: '#EF4444',
  collection: '#8B5CF6',
  uncollectible: '#6B7280',
}

const tabs = ['Todas', 'Pendiente', 'Vencida', 'Parcial', 'Pagada', 'Gestion', 'Incobrable']

export function Receivables() {
  const toast = useToast()
  const receivables = useERPStore((state) => state.receivables)
  const invoices = useERPStore((state) => state.invoices)
  const customers = useERPStore((state) => state.customers)
  const company = useERPStore((state) => state.company)
  const registerPayment = useERPStore((state) => state.registerPayment)
  const updateReceivable = useERPStore((state) => state.updateReceivable)
  const deleteReceivable = useERPStore((state) => state.deleteReceivable)
  const [tab, setTab] = useState('Todas')
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState(null)
  const [editing, setEditing] = useState(null)
  const [history, setHistory] = useState(null)
  const [showCollections, setShowCollections] = useState(false)
  const [colFilters, setColFilters] = useState(() => {
    const now = new Date()
    return { dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, dateTo: today(), method: 'all', query: '' }
  })
  const [payment, setPayment] = useState({ amount: '', method: 'Efectivo', reference: '', date: today(), comment: '' })
  const [editDraft, setEditDraft] = useState({ total: '', paid: '', balance: '', dueDate: '', status: 'open' })
  const activeReceivables = useMemo(() => receivables.filter((item) => isActiveReceivable(item, invoices, company?.id)), [invoices, receivables, company])

  const collections = useMemo(() => activeReceivables.flatMap((item) => (item.payments || []).map((payment) => ({
    id: payment.id,
    invoiceNumber: item.invoiceNumber,
    customerName: item.customerName,
    date: payment.date || String(payment.createdAt || '').slice(0, 10),
    method: payment.method || 'Efectivo',
    reference: payment.reference || '',
    comment: payment.comment || '',
    user: payment.user || 'Sistema',
    amount: Number(payment.amount || 0),
    balanceBefore: Number(payment.balanceBefore || 0),
    balanceAfter: Number(payment.balanceAfter || 0),
  }))), [activeReceivables])

  const paymentMethods = useMemo(() => [...new Set(collections.map((payment) => payment.method))], [collections])

  const filteredCollections = useMemo(() => collections.filter((payment) => {
    if (colFilters.dateFrom && payment.date < colFilters.dateFrom) return false
    if (colFilters.dateTo && payment.date > colFilters.dateTo) return false
    if (colFilters.method !== 'all' && payment.method !== colFilters.method) return false
    if (colFilters.query) {
      const q = colFilters.query.toLowerCase()
      return payment.invoiceNumber.toLowerCase().includes(q)
        || payment.customerName.toLowerCase().includes(q)
        || payment.reference.toLowerCase().includes(q)
    }
    return true
  }).sort((a, b) => String(b.date).localeCompare(String(a.date))), [collections, colFilters])

  const totalCollected = filteredCollections.reduce((sum, payment) => sum + payment.amount, 0)

  const statusCounts = useMemo(() => {
    const counts = { Todas: activeReceivables.length }
    tabs.forEach((t) => { if (t !== 'Todas') counts[t] = 0 })
    activeReceivables.forEach((item) => {
      const days = daysTo(item.dueDate)
      const computed = item.status === 'collection' || item.status === 'uncollectible' ? item.status : days < 0 && item.balance > 0 ? 'overdue' : item.status
      const label = { open: 'Pendiente', partial: 'Parcial', paid: 'Pagada', overdue: 'Vencida', collection: 'Gestion', uncollectible: 'Incobrable' }[computed]
      if (label) counts[label] = (counts[label] || 0) + 1
    })
    return counts
  }, [activeReceivables])

  const filtered = useMemo(() => activeReceivables.filter((item) => {
    const days = daysTo(item.dueDate)
    const computedStatus = item.status === 'collection' || item.status === 'uncollectible' ? item.status : days < 0 && item.balance > 0 ? 'overdue' : item.status
    if (tab === 'Todas') return true
    if (tab === 'Pendiente') return computedStatus === 'open'
    if (tab === 'Parcial') return computedStatus === 'partial'
    if (tab === 'Pagada') return computedStatus === 'paid'
    if (tab === 'Vencida') return computedStatus === 'overdue'
    if (tab === 'Gestion') return computedStatus === 'collection'
    if (tab === 'Incobrable') return computedStatus === 'uncollectible'
    return true
  }).filter((item) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (item.customerName || '').toLowerCase().includes(q)
      || (item.invoiceNumber || '').toLowerCase().includes(q)
      || (item.status || '').toLowerCase().includes(q)
  }), [activeReceivables, tab, query])
  const total = filtered.reduce((sum, item) => sum + Number(item.balance || 0), 0)

  function savePayment() {
    try {
      registerPayment({ invoiceId: paying.invoiceId, ...payment, amount: parseMoney(payment.amount) })
      toast.success('Pago registrado correctamente.')
      setPaying(null)
      setPayment({ amount: '', method: 'Efectivo', reference: '', date: today(), comment: '' })
    } catch (error) {
      toast.error(error.message)
    }
  }

  function openPayment(row) {
    setPaying(row)
    setPayment({ amount: moneyInput(row.balance), method: 'Efectivo', reference: '', date: today(), comment: '' })
  }

  function openEdit(row) {
    setEditing(row)
    setEditDraft({
      total: moneyInput(row.total),
      paid: moneyInput(row.paid),
      balance: moneyInput(row.balance),
      dueDate: row.dueDate || today(),
      status: row.status || 'open',
    })
  }

  function saveEdit() {
    try {
      updateReceivable(editing.id, {
        total: parseMoney(editDraft.total),
        paid: parseMoney(editDraft.paid),
        balance: parseMoney(editDraft.balance),
        dueDate: editDraft.dueDate,
        status: editDraft.status,
      })
      toast.success('Cuenta por cobrar actualizada.')
      setEditing(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function setStatus(row, newStatus) {
    try {
      updateReceivable(row.id, { status: newStatus })
      toast.success(`Estado cambiado a ${statusLabels[newStatus] || newStatus}.`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function removeReceivable(row) {
    if (!window.confirm(`Eliminar la cuenta por cobrar de la factura ${row.invoiceNumber}?`)) return
    try {
      deleteReceivable(row.id)
      toast.success('Cuenta por cobrar eliminada.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function exportAging() {
    const rows = customers.map((customer) => {
      const own = activeReceivables.filter((item) => item.customerId === customer.id && item.balance > 0)
      return own.reduce((row, item) => {
        const late = Math.max(-daysTo(item.dueDate), 0)
        const bucket = late <= 30 ? '0-30' : late <= 60 ? '31-60' : late <= 90 ? '61-90' : '+90'
        row[bucket] += item.balance
        row.Total += item.balance
        return row
      }, { Cliente: customer.name, '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0, Total: 0 })
    }).filter((row) => row.Total > 0)
    downloadCsv('trifusion-aging.csv', rows)
  }

  function exportCollections() {
    downloadCsv('trifusion-reporte-cobros.csv', filteredCollections.map((payment) => ({
      Fecha: payment.date,
      Factura: payment.invoiceNumber,
      Cliente: payment.customerName,
      Metodo: payment.method,
      Referencia: payment.reference,
      Usuario: payment.user,
      Comentario: payment.comment,
      BalanceAnterior: payment.balanceBefore,
      MontoCobrado: payment.amount,
      BalanceNuevo: payment.balanceAfter,
    })))
  }

  return (
    <div className="space-y-0">
      <section className="module-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="module-header-eyebrow">Cuentas por cobrar</p>
            <h2 className="module-header-title">CxC y gestion de cobros</h2>
            <p className="module-header-desc">{filtered.length} facturas | {currency.format(total)} pendientes</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="module-search-bar">
              <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
              <input id="receivable-query" name="receivable-query" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Buscar cliente, factura, estado" aria-label="receivable-query"  autoComplete="off" />
            </div>
            <Button variant="ghost" icon={ReceiptText} onClick={() => setShowCollections(true)}>Reporte de cobros</Button>
            <Button variant="ghost" icon={FileSpreadsheet} onClick={exportAging}>Aging Excel</Button>
          </div>
        </div>
      </section>

      <div className="section-card">
        <div className="mb-4 flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`quick-filter-btn${tab === item ? ' active' : ''}`}>
              {item}
              {statusCounts[item] > 0 ? (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: tab === item ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.1)' }}>{statusCounts[item]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="section-divider" />
        <DataTable data={filtered} columns={[
          { header: 'Cliente', accessorKey: 'customerName' },
          { header: 'Factura', accessorKey: 'invoiceNumber' },
          { header: 'Vence', cell: ({ row }) => <DueDateCell item={row.original} /> },
          { header: 'Total', cell: ({ row }) => currency.format(roundMoney(row.original.total)) },
          { header: 'Abonado', cell: ({ row }) => currency.format(roundMoney(row.original.paid)) },
          { header: 'Balance', cell: ({ row }) => <span style={{ color: row.original.balance > 0 ? 'var(--color-pending)' : 'var(--color-income)' }}>{currency.format(roundMoney(row.original.balance))}</span> },
          { header: 'Dias', cell: ({ row }) => <DaysCell item={row.original} /> },
          { header: 'Estado', cell: ({ row }) => <Status item={row.original} /> },
          { header: 'Acciones', cell: ({ row }) => <Actions row={row.original} onPay={openPayment} onEdit={openEdit} onDelete={removeReceivable} onRemind={remind} onStatus={setStatus} customers={customers} company={company} onHistory={setHistory} /> },
        ]} />
      </div>

      <Modal open={Boolean(paying)} onClose={() => setPaying(null)} title="Registrar pago" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPaying(null)}>Cancelar</Button><Button variant="success" onClick={savePayment}>Confirmar pago</Button></div>}>
        {paying ? <div className="grid gap-3"><p style={{ color: 'rgba(255,255,255,.6)' }}>Factura: <b>{paying.invoiceNumber}</b> | Cliente: <b>{paying.customerName}</b> | Vence: {paying.dueDate}</p><p style={{ color: 'rgba(255,255,255,.6)' }}>Total: {currency.format(roundMoney(paying.total))} | Abonado: {currency.format(roundMoney(paying.paid))} | <b>Balance: {currency.format(roundMoney(paying.balance))}</b></p><div className="grid gap-3 md:grid-cols-2"><Input label="Monto" name="payment-amount" type="number" step="0.01" min="0" value={payment.amount} onChange={(v) => setPayment((s) => ({ ...s, amount: v }))} /><Select label="Metodo" name="payment-method" value={payment.method} onChange={(v) => setPayment((s) => ({ ...s, method: v }))} options={['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque']} /><Input label="Referencia" name="payment-reference" value={payment.reference} onChange={(v) => setPayment((s) => ({ ...s, reference: v }))} /><Input label="Fecha" name="payment-date" type="date" value={payment.date} onChange={(v) => setPayment((s) => ({ ...s, date: v }))} /><div className="md:col-span-2"><Input label="Comentario" name="payment-comment" value={payment.comment} onChange={(v) => setPayment((s) => ({ ...s, comment: v }))} /></div></div></div> : null}
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar cuenta por cobrar" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="success" onClick={saveEdit}>Guardar cambios</Button></div>}>
        {editing ? <div className="grid gap-3 md:grid-cols-2"><Input label="Total" name="edit-total" type="number" step="0.01" min="0" value={editDraft.total} onChange={(v) => setEditDraft((s) => ({ ...s, total: v, balance: moneyInput(Math.max(parseMoney(v) - parseMoney(s.paid), 0)) }))} /><Input label="Pagado" name="edit-paid" type="number" step="0.01" min="0" value={editDraft.paid} onChange={(v) => setEditDraft((s) => ({ ...s, paid: v, balance: moneyInput(Math.max(parseMoney(s.total) - parseMoney(v), 0)) }))} /><Input label="Balance" name="edit-balance" type="number" step="0.01" min="0" value={editDraft.balance} onChange={(v) => setEditDraft((s) => ({ ...s, balance: v }))} /><Input label="Vencimiento" name="edit-due-date" type="date" value={editDraft.dueDate} onChange={(v) => setEditDraft((s) => ({ ...s, dueDate: v }))} /><Select label="Estado" name="edit-status" value={editDraft.status} onChange={(v) => setEditDraft((s) => ({ ...s, status: v }))} options={['open', 'partial', 'paid', 'overdue', 'collection', 'uncollectible']} /></div> : null}
      </Modal>
      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title="Historial de abonos" size="lg">
        {history ? <div className="space-y-3"><p className="text-sm" style={{ color: 'rgba(255,255,255,.45)' }}>Factura: <b>{history.invoiceNumber}</b> | Cliente: <b>{history.customerName}</b> | Balance: <b>{currency.format(roundMoney(history.balance))}</b></p><DataTable data={history.payments || []} columns={[
          { header: 'Fecha/Hora', cell: ({ row }) => formatDate(row.original.createdAt || row.original.date) },
          { header: 'Usuario', accessorKey: 'user' },
          { header: 'Metodo', accessorKey: 'method' },
          { header: 'Referencia', accessorKey: 'reference' },
          { header: 'Comentario', accessorKey: 'comment' },
          { header: 'Monto', cell: ({ row }) => currency.format(row.original.amount) },
          { header: 'Balance ant.', cell: ({ row }) => currency.format(row.original.balanceBefore || 0) },
          { header: 'Balance nuevo', cell: ({ row }) => currency.format(row.original.balanceAfter || 0) },
        ]} emptyText="No hay abonos registrados." /></div> : null}
      </Modal>
      <Modal open={showCollections} onClose={() => setShowCollections(false)} title="Reporte de cobros por factura" size="xl">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input label="Desde" name="collections-date-from" type="date" value={colFilters.dateFrom} onChange={(v) => setColFilters((s) => ({ ...s, dateFrom: v }))} />
            <Input label="Hasta" name="collections-date-to" type="date" value={colFilters.dateTo} onChange={(v) => setColFilters((s) => ({ ...s, dateTo: v }))} />
            <Select label="Metodo" name="collections-method" value={colFilters.method === 'all' ? 'Todos' : colFilters.method} onChange={(v) => setColFilters((s) => ({ ...s, method: v === 'Todos' ? 'all' : v }))} options={['Todos', ...paymentMethods]} />
            <Input label="Buscar factura, cliente o referencia" name="collections-query" value={colFilters.query} onChange={(v) => setColFilters((s) => ({ ...s, query: v }))} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="summary-chip" style={{ background: 'color-mix(in srgb, #34D399 9%, transparent)' }}>
              <span className="summary-chip-label">Total cobrado</span>
              <span className="summary-chip-value">{currency.format(totalCollected)}</span>
            </div>
            <div className="summary-chip" style={{ background: 'color-mix(in srgb, #60A5FA 9%, transparent)' }}>
              <span className="summary-chip-label">Cobros en el rango</span>
              <span className="summary-chip-value">{filteredCollections.length}</span>
            </div>
            <div className="flex-1" />
            <Button variant="ghost" icon={Download} onClick={exportCollections}>Exportar CSV</Button>
          </div>
          <DataTable data={filteredCollections} columns={[
            { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date) },
            { header: 'Factura', accessorKey: 'invoiceNumber' },
            { header: 'Cliente', accessorKey: 'customerName' },
            { header: 'Metodo', accessorKey: 'method' },
            { header: 'Referencia', accessorKey: 'reference' },
            { header: 'Usuario', accessorKey: 'user' },
            { header: 'Balance ant.', cell: ({ row }) => currency.format(row.original.balanceBefore) },
            { header: 'Monto cobrado', cell: ({ row }) => <span className="font-bold" style={{ color: 'var(--color-income)' }}>{currency.format(row.original.amount)}</span> },
            { header: 'Balance nuevo', cell: ({ row }) => currency.format(row.original.balanceAfter) },
          ]} initialPageSize={10} emptyText="No hay cobros en el rango seleccionado." />
        </div>
      </Modal>
    </div>
  )
}

function DueDateCell({ item }) {
  const overdue = daysTo(item.dueDate) < 0 && item.balance > 0
  return <span style={{ color: overdue ? 'var(--color-alert)' : undefined }}>{item.dueDate || '-'}</span>
}

function DaysCell({ item }) {
  const days = daysTo(item.dueDate)
  const balance = Number(item.balance || 0)
  if (balance <= 0 || days >= 0) return <span>{days}</span>
  return <span className="font-bold" style={{ color: days < -90 ? 'var(--color-alert)' : 'var(--color-pending)' }}>{days}</span>
}

function Status({ item }) {
  const days = daysTo(item.dueDate)
  const computedStatus = item.status === 'collection' || item.status === 'uncollectible' ? item.status : days < 0 && item.balance > 0 ? 'overdue' : item.status
  const color = statusColors[computedStatus] || '#6B7280'
  const text = statusLabels[computedStatus] || computedStatus
  return <span className="inline-flex items-center gap-2"><span className="h-2 w-8 rounded-full" style={{ background: color }} />{text}</span>
}

function Actions({ row, onPay, onEdit, onDelete, onRemind, onHistory, onStatus, customers, company }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="flex gap-1">
      <Icon icon={Wallet} disabled={roundMoney(row.balance) <= 0} onClick={() => onPay(row)} />
      <Icon icon={Pencil} onClick={() => onEdit(row)} />
      <Icon icon={History} onClick={() => onHistory(row)} />
      <Icon icon={MessageCircle} onClick={() => onRemind(row, customers, company)} />
      <div className="relative">
        <button onClick={() => setMenu(!menu)} className="rounded-md border p-2 text-xs font-bold transition" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }}>...</button>
        {menu ? <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border p-1 shadow-2xl" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }} onMouseLeave={() => setMenu(false)}>
          <button onClick={() => { onStatus(row, 'collection'); setMenu(false) }} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]">Marcar en gestion</button>
          <button onClick={() => { onStatus(row, 'uncollectible'); setMenu(false) }} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]" style={{ color: 'rgb(254,202,202)' }}>Marcar incobrable</button>
          <button onClick={() => { onStatus(row, 'open'); setMenu(false) }} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]">Reabrir pendiente</button>
          <button onClick={() => { onDelete(row); setMenu(false) }} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]" style={{ color: 'rgb(254,202,202)' }}>Eliminar</button>
        </div> : null}
      </div>
    </div>
  )
}

function Icon({ icon: IconSvg, onClick, disabled = false }) { return <button disabled={disabled} onClick={onClick} className="rounded-md border p-2 transition disabled:cursor-not-allowed disabled:opacity-35" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }}><IconSvg size={15} /></button> }
function Input({ label, value, onChange, type = 'text', step, min, name }) { return <label><span className="label-dark">{label}</span><input id={name} name={name} type={type} step={step} min={min} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark"  autoComplete="off" /></label> }
function Select({ label, value, onChange, options, name }) { return <label><span className="label-dark">{label}</span><select id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark" autoComplete="off">{options.map((option) => <option key={option}>{option}</option>)}</select></label> }
function remind(item, customers, company) { const customer = customers.find((c) => c.id === item.customerId); window.open(`https://wa.me/${customer?.whatsapp || company.whatsapp}?text=${encodeURIComponent(`Estimado ${item.customerName}, le recordamos que tiene una factura No. ${item.invoiceNumber} por ${currency.format(item.balance)} con vencimiento el ${item.dueDate}. Para consultas: ${company.phone || company.whatsapp}. Gracias.`)}`) }
function roundMoney(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round((num + Number.EPSILON) * 100) / 100
}
function parseMoney(value) { return roundMoney(String(value || '0').replace(',', '.')) }
function moneyInput(value) { return roundMoney(value).toFixed(2) }
