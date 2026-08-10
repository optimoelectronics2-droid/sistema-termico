import { useMemo, useState } from 'react'
import { Download, History, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../hooks/useToast'
import { downloadCsv } from '../../lib/csvExport'
import { daysUntil, todayIso } from '../../lib/dateTime'
import { currency, formatDate } from '../../lib/formatters'
import { isActivePayable } from '../../lib/realDataGuards'
import { useERPStore } from '../../store/useERPStore'

const emptyPayable = () => ({ supplierId: 'no-supplier', reference: '', concept: '', amount: '', date: todayIso(), dueDate: '', method: '' })
const emptyPayment = () => ({ amount: '', method: 'Efectivo', reference: '', date: todayIso() })

export function Payables() {
  const toast = useToast()
  const company = useERPStore((state) => state.company)
  const expenses = useERPStore((state) => state.expenses)
  const suppliers = useERPStore((state) => state.suppliers)
  const createPayable = useERPStore((state) => state.createPayable)
  const updatePayable = useERPStore((state) => state.updatePayable)
  const registerPayablePayment = useERPStore((state) => state.registerPayablePayment)
  const deletePayable = useERPStore((state) => state.deletePayable)
  const [tab, setTab] = useState('Pendientes')
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState(null)
  const [editing, setEditing] = useState(null)
  const [history, setHistory] = useState(null)
  const [draft, setDraft] = useState(emptyPayable)
  const [payment, setPayment] = useState(emptyPayment)
  const [editDraft, setEditDraft] = useState(emptyPayable)

  const payables = useMemo(() => expenses.filter((item) => isActivePayable(item, company?.id)), [company?.id, expenses])
  const filtered = useMemo(() => payables.filter((item) => matchesTab(item, tab)).sort(sortPayables), [payables, tab])
  const openPayables = payables.filter((item) => payableBalance(item) > 0)
  const latePayables = openPayables.filter((item) => daysUntil(item.dueDate || item.date) < 0)
  const totalBalance = openPayables.reduce((sum, item) => sum + payableBalance(item), 0)

  function saveNewPayable() {
    try {
      createPayable(draft)
      toast.success('Cuenta por pagar registrada.')
      setDraft(emptyPayable())
      setCreating(false)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function openPayment(row) {
    setPaying(row)
    setPayment({ ...emptyPayment(), amount: moneyInput(payableBalance(row)) })
  }

  function savePayment() {
    try {
      registerPayablePayment({ payableId: paying.id, ...payment, amount: parseMoney(payment.amount) })
      toast.success('Pago registrado y caja recalculada.')
      setPaying(null)
      setPayment(emptyPayment())
    } catch (error) {
      toast.error(error.message)
    }
  }

  function openEdit(row) {
    setEditing(row)
    setEditDraft({
      supplierId: row.supplierId || 'no-supplier',
      supplierName: row.supplierName || '',
      reference: row.reference || '',
      concept: row.concept || '',
      amount: moneyInput(row.amount || row.total),
      paid: moneyInput(row.paid),
      balance: moneyInput(payableBalance(row)),
      date: row.date || todayIso(),
      dueDate: row.dueDate || '',
      status: row.status || 'pending',
      method: row.method || '',
    })
  }

  function saveEdit() {
    try {
      updatePayable(editing.id, {
        ...editDraft,
        amount: parseMoney(editDraft.amount),
        paid: parseMoney(editDraft.paid),
        balance: parseMoney(editDraft.balance),
      })
      toast.success('Cuenta por pagar actualizada.')
      setEditing(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function remove(row) {
    if (!window.confirm(`Eliminar la cuenta por pagar ${row.reference || row.supplierName || row.id}?`)) return
    try {
      deletePayable(row.id)
      toast.success('Cuenta por pagar eliminada de calculos.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function exportCsv() {
    downloadCsv('cuentas-por-pagar.csv', filtered.map((item) => ({
      Proveedor: item.supplierName || '',
      Referencia: item.reference || '',
      Concepto: item.concept || '',
      Origen: item.date || item.createdAt || '',
      Vencimiento: item.dueDate || '',
      Total: moneyInput(item.amount || item.total),
      Pagado: moneyInput(item.paid),
      Balance: moneyInput(payableBalance(item)),
      Estado: statusLabel(item),
    })))
  }

  return (
    <div className="space-y-0">
      <section className="module-header grid gap-3 md:grid-cols-4">
        <Metric title="Pendientes" value={openPayables.length} detail="Compromisos activos" />
        <Metric title="Balance CxP" value={currency.format(totalBalance)} detail="Solo cuentas abiertas" />
        <Metric title="Vencidas" value={latePayables.length} detail="Fuera de fecha" />
        <Metric title="Pagadas" value={payables.filter((item) => payableBalance(item) <= 0).length} detail="Historial activo" />
      </section>

      <div className="section-card">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold">Cuentas por pagar</h2>
            <p className="text-sm text-white/45">Proveedor, monto, origen, vencimiento, pagos, balance y estado con registros reales activos.</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="ghost" icon={Download} onClick={exportCsv}>Excel</Button>
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
            <Button icon={Plus} onClick={() => setCreating(true)}>Nueva CxP</Button>
          </div>
        </div>
        <div className="no-print mb-4 flex flex-wrap gap-2">
          {['Todas', 'Pendientes', 'Por vencer <7 dias', 'Vencidas', 'Pagadas'].map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={`quick-filter-btn${tab === item ? ' active' : ''}`}>{item}</button>
          ))}
        </div>
        <div className="section-divider" />
        <DataTable data={filtered} columns={columns({ openPayment, openEdit, remove, setHistory })} initialPageSize={25} emptyText="Sin cuentas por pagar con esos filtros." searchPlaceholder="Buscar proveedor, referencia, concepto o estado..." />
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva cuenta por pagar" size="md" footer={<Footer onCancel={() => setCreating(false)} onSave={saveNewPayable} />}>
        <PayableForm draft={draft} setDraft={setDraft} suppliers={suppliers} />
      </Modal>

      <Modal open={Boolean(paying)} onClose={() => setPaying(null)} title="Registrar pago CxP" size="md" footer={<Footer onCancel={() => setPaying(null)} onSave={savePayment} saveLabel="Confirmar pago" />}>
        {paying ? <div className="grid gap-3 md:grid-cols-2"><p className="md:col-span-2 text-white/60">Balance pendiente: {currency.format(payableBalance(paying))}</p><Input label="Monto" type="number" step="0.01" min="0" value={payment.amount} onChange={(value) => setPayment((state) => ({ ...state, amount: value }))} /><Select label="Metodo" value={payment.method} onChange={(value) => setPayment((state) => ({ ...state, method: value }))} options={['Efectivo', 'Tarjeta', 'Transferencia', 'Cheque']} /><Input label="Referencia" value={payment.reference} onChange={(value) => setPayment((state) => ({ ...state, reference: value }))} /><Input label="Fecha" type="date" value={payment.date} onChange={(value) => setPayment((state) => ({ ...state, date: value }))} /></div> : null}
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar cuenta por pagar" size="md" footer={<Footer onCancel={() => setEditing(null)} onSave={saveEdit} />}>
        {editing ? <PayableForm draft={editDraft} setDraft={setEditDraft} suppliers={suppliers} editing /> : null}
      </Modal>

      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title="Historial de pagos CxP" size="md">
        {history ? <DataTable data={history.payments || []} columns={[{ header: 'Fecha', accessorKey: 'date' }, { header: 'Monto', cell: ({ row }) => currency.format(row.original.amount || 0) }, { header: 'Metodo', accessorKey: 'method' }, { header: 'Referencia', accessorKey: 'reference' }]} emptyText="Sin pagos registrados." /> : null}
      </Modal>
    </div>
  )
}

function PayableForm({ draft, setDraft, suppliers, editing = false }) {
  const supplier = suppliers.find((item) => item.id === draft.supplierId)
  const set = (key, value) => setDraft((state) => ({
    ...state,
    [key]: value,
    supplierName: key === 'supplierId' ? suppliers.find((item) => item.id === value)?.name || '' : state.supplierName,
  }))
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label><span className="label-dark">Proveedor</span><select id="payable-supplier" value={draft.supplierId} onChange={(event) => set('supplierId', event.target.value)} className="input-dark">{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Input label="Referencia / factura" value={draft.reference} onChange={(value) => set('reference', value)} />
      <Input label="Concepto" value={draft.concept} onChange={(value) => set('concept', value)} />
      <Input label="Monto total" type="number" step="0.01" min="0" value={draft.amount} onChange={(value) => set('amount', value)} />
      {editing ? <Input label="Pagado" type="number" step="0.01" min="0" value={draft.paid} onChange={(value) => set('paid', value)} /> : null}
      {editing ? <Input label="Balance" type="number" step="0.01" min="0" value={draft.balance} onChange={(value) => set('balance', value)} /> : null}
      <Input label="Fecha origen" type="date" value={draft.date} onChange={(value) => set('date', value)} />
      <Input label="Vencimiento" type="date" value={draft.dueDate} onChange={(value) => set('dueDate', value)} />
      {editing ? <Select label="Estado" value={draft.status} onChange={(value) => set('status', value)} options={['pending', 'paid', 'cancelled']} /> : null}
      <p className="md:col-span-2 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-white/55">Proveedor seleccionado: {supplier?.name || draft.supplierName || 'Sin proveedor'}</p>
    </div>
  )
}

function Footer({ onCancel, onSave, saveLabel = 'Guardar' }) {
  return <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancelar</Button><Button variant="success" onClick={onSave}>{saveLabel}</Button></div>
}

function Metric({ title, value, detail }) {
  return <div className="summary-chip"><span className="summary-chip-label">{title}</span><span className="summary-chip-value">{value}</span><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{detail}</p></div>
}

function Status({ item }) {
  const label = statusLabel(item)
  const tone = label === 'Vencida' ? 'bg-red-500' : label === 'Por vencer' ? 'bg-amber-500' : label === 'Pagada' ? 'bg-emerald-500' : 'bg-blue-500'
  return <span className="inline-flex items-center gap-2"><span className={`h-2 w-8 rounded-full ${tone}`} />{label}</span>
}

function Icon({ icon: IconSvg, onClick, disabled = false }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="rounded-md border border-white/10 bg-white/[0.035] p-2 text-white/65 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35"><IconSvg size={15} /></button>
}

function Input({ label, value, onChange, type = 'text', step, min, id }) {
  const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined)
  return <label><span className="label-dark">{label}</span><input id={inputId} type={type} step={step} min={min} value={value || ''} onChange={(event) => onChange(event.target.value)} className="input-dark" /></label>
}

function Select({ label, value, onChange, options, id }) {
  const selectId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined)
  return <label><span className="label-dark">{label}</span><select id={selectId} value={value} onChange={(event) => onChange(event.target.value)} className="input-dark">{options.map((option) => <option key={option}>{option}</option>)}</select></label>
}

function columns({ openPayment, openEdit, remove, setHistory }) {
  return [
    { header: 'Proveedor', accessorKey: 'supplierName' },
    { header: 'Referencia', accessorKey: 'reference' },
    { header: 'Concepto', accessorKey: 'concept' },
    { header: 'Desde', cell: ({ row }) => formatDate(row.original.date || row.original.createdAt) },
    { header: 'Vence', accessorKey: 'dueDate' },
    { header: 'Total', cell: ({ row }) => currency.format(row.original.amount || row.original.total || 0) },
    { header: 'Pagado', cell: ({ row }) => currency.format(row.original.paid || 0) },
    { header: 'Balance', cell: ({ row }) => currency.format(payableBalance(row.original)) },
    { header: 'Estado', cell: ({ row }) => <Status item={row.original} /> },
    { header: 'Acciones', cell: ({ row }) => <div className="flex gap-1"><Icon icon={Wallet} disabled={payableBalance(row.original) <= 0} onClick={() => openPayment(row.original)} /><Icon icon={Pencil} onClick={() => openEdit(row.original)} /><Icon icon={Trash2} onClick={() => remove(row.original)} /><Icon icon={History} onClick={() => setHistory(row.original)} /></div> },
  ]
}

function matchesTab(item, tab) {
  const balance = payableBalance(item)
  const days = daysUntil(item.dueDate || item.date)
  if (tab === 'Pendientes') return balance > 0
  if (tab === 'Por vencer <7 dias') return balance > 0 && days >= 0 && days <= 7
  if (tab === 'Vencidas') return balance > 0 && days < 0
  if (tab === 'Pagadas') return balance <= 0 || String(item.status || '').toLowerCase() === 'paid'
  return true
}

function statusLabel(item) {
  const balance = payableBalance(item)
  if (balance <= 0 || String(item.status || '').toLowerCase() === 'paid') return 'Pagada'
  const days = daysUntil(item.dueDate || item.date)
  if (days < 0) return 'Vencida'
  if (days <= 7) return 'Por vencer'
  return 'Pendiente'
}

function sortPayables(left, right) {
  return String(left.dueDate || left.date || '').localeCompare(String(right.dueDate || right.date || ''))
}

function payableBalance(item) {
  return roundMoney(item.balance ?? Math.max(Number(item.amount || item.total || 0) - Number(item.paid || 0), 0))
}

function parseMoney(value) {
  return roundMoney(String(value || '0').replace(',', '.'))
}

function moneyInput(value) {
  return roundMoney(value).toFixed(2)
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}
