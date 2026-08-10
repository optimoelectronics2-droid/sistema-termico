import { useMemo, useState } from 'react'
import { Eye, MessageCircle, Pencil, Plus, Search, Trash2, UserCheck, UserX, CreditCard } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { DataTable } from '../../components/ui/DataTable'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { currency } from '../../lib/formatters'

const emptyCustomer = {
  type: 'Persona fisica', name: '', rnc: '', cedula: '', phone: '', mobile: '', whatsapp: '', email: '',
  street: '', sector: '', city: '', province: '', preferredNcf: 'B02', priceList: 'Detal', paymentTerm: 'Contado',
  creditLimit: 0, balance: 0, internalNotes: '', tags: [], status: 'Activo', notes: [],
}

export function CRM() {
  const toast = useToast()
  const customers = useERPStore((state) => state.customers)
  const invoices = useERPStore((state) => state.invoices)
  const quotes = useERPStore((state) => state.quotes)
  const receivables = useERPStore((state) => state.receivables)
  const upsertCustomer = useERPStore((state) => state.upsertCustomer)
  const deleteCustomer = useERPStore((state) => state.deleteCustomer)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const statusCounts = useMemo(() => ({
    all: customers.length,
    active: customers.filter((c) => c.status === 'Activo').length,
    inactive: customers.filter((c) => c.status === 'Inactivo').length,
    credit: customers.filter((c) => Number(c.balance || 0) > 0).length,
  }), [customers])

  const statusFilters = [
    { id: 'all', label: 'Todos', count: statusCounts.all },
    { id: 'active', label: 'Activo', count: statusCounts.active },
    { id: 'inactive', label: 'Inactivo', count: statusCounts.inactive },
    { id: 'credit', label: 'Con credito', count: statusCounts.credit },
  ]

  const filtered = useMemo(() => customers.filter((c) => {
    if (!query) return true
    const q = normalize(query)
    return normalize(c.name).includes(q) || normalize(c.rnc || c.cedula || '').includes(q) || normalize(c.email || '').includes(q) || normalize(c.phone || c.whatsapp || '').includes(q)
  }).filter((c) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return c.status === 'Activo'
    if (statusFilter === 'inactive') return c.status === 'Inactivo'
    if (statusFilter === 'credit') return Number(c.balance || 0) > 0
    return true
  }), [customers, query, statusFilter])

  function save(customer) {
    try {
      validateCustomer(customer)
      upsertCustomer(customer)
      toast.success('Cliente guardado correctamente.')
      setEditing(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function remove(customer) {
    try {
      deleteCustomer(customer.id)
      toast.success('Cliente eliminado o desactivado correctamente.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <div className="space-y-0">
      <section className="module-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="module-header-eyebrow">CRM</p>
            <h2 className="module-header-title">Clientes</h2>
            <p className="module-header-desc">Registro desde cero, credito, historial y equipos comprados.</p>
          </div>
          <Button icon={Plus} onClick={() => setEditing(emptyCustomer)}>Nuevo cliente</Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="summary-chip"><span className="summary-chip-label">Total clientes</span><span className="summary-chip-value">{customers.length}</span></div>
          <div className="summary-chip"><span className="summary-chip-label">Activos</span><span className="summary-chip-value">{statusCounts.active}</span></div>
          <div className="summary-chip"><span className="summary-chip-label">Con credito</span><span className="summary-chip-value">{statusCounts.credit}</span></div>
          <div className="summary-chip"><span className="summary-chip-label">Saldo por cobrar</span><span className="summary-chip-value">{currency.format(customers.reduce((s, c) => s + Number(c.balance || 0), 0))}</span></div>
        </div>
      </section>

      <div className="section-card">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="module-search-bar">
            <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input id="crm-query" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Buscar por nombre, RNC, cedula, email, telefono..." aria-label="crm-query" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {statusFilters.map((item) => (
            <button key={item.id} onClick={() => setStatusFilter(item.id)} className={`quick-filter-btn${statusFilter === item.id ? ' active' : ''}`}>
              {item.label}
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--bg-elevated)', color: 'var(--line)' }}>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="section-divider" />
        <DataTable data={filtered} columns={[
          { header: 'Cliente', cell: ({ row }) => <CustomerInfo customer={row.original} /> },
          { header: 'Contacto', cell: ({ row }) => <div><p>{row.original.phone || row.original.whatsapp || '-'}</p><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{row.original.email || ''}</p></div> },
          { header: 'Comprobante', accessorKey: 'preferredNcf' },
          { header: 'Lista', accessorKey: 'priceList' },
          { header: 'Credito', cell: ({ row }) => currency.format(row.original.creditLimit || 0) },
          { header: 'Balance', cell: ({ row }) => <BalanceCell customer={row.original} /> },
          { header: 'Estado', cell: ({ row }) => <StatusBadge customer={row.original} /> },
          { header: 'Acciones', cell: ({ row }) => <div className="flex gap-1"><Icon icon={Eye} onClick={() => setViewing(row.original)} /><Icon icon={Pencil} onClick={() => setEditing(row.original)} /><Icon icon={MessageCircle} onClick={() => window.open(`https://wa.me/${row.original.whatsapp}`)} /><Icon icon={Trash2} onClick={() => remove(row.original)} /></div> },
        ]} emptyText="No hay clientes que coincidan con los filtros." />
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Editar cliente' : 'Crear cliente'} size="xl">
        {editing ? <CustomerForm customer={editing} onSave={save} /> : null}
      </Modal>
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title="Detalle de cliente" size="xl">
        {viewing ? <CustomerDetail customer={viewing} invoices={invoices.filter((item) => item.customerId === viewing.id)} quotes={quotes.filter((item) => item.customerId === viewing.id)} receivables={receivables.filter((item) => item.customerId === viewing.id)} /> : null}
      </Modal>
    </div>
  )
}

function CustomerInfo({ customer }) {
  return <div><p className="font-bold text-white">{customer.name}</p><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{customer.rnc || customer.cedula || 'Consumidor final'}</p></div>
}

function BalanceCell({ customer }) {
  const balance = Number(customer.balance || 0)
  const limit = Number(customer.creditLimit || 0)
  const available = Math.max(limit - balance, 0)
  return (
    <div>
      <p style={{ color: balance > limit * 0.8 ? 'var(--color-alert)' : 'var(--text-primary)' }}>{currency.format(balance)}</p>
      {limit > 0 ? <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>disp. {currency.format(available)}</p> : null}
    </div>
  )
}

function StatusBadge({ customer }) {
  const active = customer.status === 'Activo'
  const hasCredit = Number(customer.balance || 0) > 0
  if (!active) return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(239,68,68,.12)', color: 'rgb(252,165,165)' }}><UserX size={12} /> Inactivo</span>
  if (hasCredit) return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(245,158,11,.12)', color: 'rgb(252,211,77)' }}><CreditCard size={12} /> Credito</span>
  return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(16,185,129,.12)', color: 'rgb(110,231,183)' }}><UserCheck size={12} /> Activo</span>
}

function CustomerForm({ customer, onSave }) {
  const [draft, setDraft] = useState(customer)
  const set = (key, value) => setDraft((state) => ({ ...state, [key]: value }))
  const tagOptions = ['VIP', 'Credito', 'Gobierno', 'Tecnico', 'Proveedor']
  return (
    <div className="space-y-5">
      <section className="rounded-lg p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.025)' }}>
        <h3 className="mb-3 font-display text-lg font-bold">Informacion del cliente</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Select label="Tipo" name="crm-type" value={draft.type} onChange={(v) => set('type', v)} options={['Empresa', 'Persona fisica', 'Consumidor final']} />
          <Input label="Nombre / razon social *" name="crm-name" value={draft.name} onChange={(v) => set('name', v)} />
          {draft.type === 'Empresa' ? <Input label="RNC" name="crm-rnc" value={draft.rnc} onChange={(v) => set('rnc', v)} /> : null}
          {draft.type === 'Persona fisica' ? <Input label="Cedula" name="crm-cedula" value={draft.cedula} onChange={(v) => set('cedula', v)} /> : null}
        </div>
      </section>

      <section className="rounded-lg p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.025)' }}>
        <h3 className="mb-3 font-display text-lg font-bold">Contacto y direccion</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Input label="Telefono" name="crm-phone" value={draft.phone} onChange={(v) => set('phone', v)} />
          <Input label="Celular" name="crm-mobile" value={draft.mobile} onChange={(v) => set('mobile', v)} />
          <Input label="WhatsApp" name="crm-whatsapp" value={draft.whatsapp} onChange={(v) => set('whatsapp', v)} />
          <Input label="Email" name="crm-email" value={draft.email} onChange={(v) => set('email', v)} />
          <Input label="Calle" name="crm-street" value={draft.street} onChange={(v) => set('street', v)} />
          <Input label="Sector" name="crm-sector" value={draft.sector} onChange={(v) => set('sector', v)} />
          <Input label="Ciudad" name="crm-city" value={draft.city} onChange={(v) => set('city', v)} />
          <Input label="Provincia" name="crm-province" value={draft.province} onChange={(v) => set('province', v)} />
        </div>
      </section>

      <section className="rounded-lg p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.025)' }}>
        <h3 className="mb-3 font-display text-lg font-bold">Configuracion comercial y credito</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Select label="Comprobante" name="crm-ncf-type" value={draft.preferredNcf} onChange={(v) => set('preferredNcf', v)} options={['B01', 'B02']} />
          <Select label="Lista de precio" name="crm-price-list" value={draft.priceList} onChange={(v) => set('priceList', v)} options={['Detal', 'Mayor', 'Especial', 'Tecnico']} />
          <Select label="Condicion pago" name="crm-payment-term" value={draft.paymentTerm} onChange={(v) => set('paymentTerm', v)} options={['Contado', '15 dias', '30 dias', '45 dias', '60 dias', '90 dias']} />
          <Input type="number" label="Limite credito" name="crm-credit-limit" value={draft.creditLimit} onChange={(v) => set('creditLimit', Number(v))} />
          <Select label="Estado" name="crm-status" value={draft.status} onChange={(v) => set('status', v)} options={['Activo', 'Inactivo']} />
          <label className="md:col-span-3"><span className="label-dark">Etiquetas</span><div className="flex flex-wrap gap-2">{tagOptions.map((tag) => <button type="button" key={tag} onClick={() => set('tags', draft.tags?.includes(tag) ? draft.tags.filter((item) => item !== tag) : [...(draft.tags || []), tag])} className={`rounded-lg border px-3 py-2 text-sm ${draft.tags?.includes(tag) ? 'border-blue-400 bg-blue-500/15' : 'border-white/10 bg-white/[0.035]'}`}>{tag}</button>)}</div></label>
          <label className="md:col-span-3"><span className="label-dark">Notas internas</span><textarea id="crm-notes" name="crm-notes" value={draft.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} className="input-dark min-h-24" /></label>
        </div>
      </section>

      <div className="flex justify-end"><Button onClick={() => onSave(draft)}>Guardar cliente</Button></div>
    </div>
  )
}

function CustomerDetail({ customer, invoices, quotes, receivables }) {
  const [tab, setTab] = useState('Resumen')
  const tabs = ['Resumen', 'Facturas', 'Cuentas por cobrar', 'Cotizaciones', 'Equipos', 'Notas']
  const serialItems = invoices.flatMap((invoice) => invoice.items?.flatMap((item) => (item.serials || (item.serial ? [item.serial] : [])).map((serial) => ({ serial, product: item.name, invoice: invoice.number, date: invoice.issuedAt || invoice.createdAt }))) || [])
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? 'bg-blue-500' : 'bg-white/[0.06]'}`}>{item}</button>)}</div>
      {tab === 'Resumen' ? <div className="grid gap-3 md:grid-cols-3"><Box label="Balance" value={currency.format(customer.balance || 0)} /><Box label="Credito disponible" value={currency.format((customer.creditLimit || 0) - (customer.balance || 0))} /><Box label="Documento" value={customer.rnc || customer.cedula || 'N/A'} /></div> : null}
      {tab === 'Facturas' ? <SimpleRows rows={invoices.map((i) => [i.number, currency.format(i.totals?.total || 0), i.status])} /> : null}
      {tab === 'Cuentas por cobrar' ? <SimpleRows rows={receivables.map((r) => [r.invoiceNumber, currency.format(r.balance), r.status])} /> : null}
      {tab === 'Cotizaciones' ? <SimpleRows rows={quotes.map((q) => [q.number, currency.format(q.totals?.total || 0), q.status])} /> : null}
      {tab === 'Equipos' ? <SimpleRows rows={serialItems.map((s) => [s.product, s.serial, s.invoice])} /> : null}
      {tab === 'Notas' ? <p className="rounded-lg bg-white/[0.035] p-3" style={{ color: 'rgba(255,255,255,.6)' }}>{customer.internalNotes || 'Sin notas.'}</p> : null}
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  const colors = { green: 'var(--color-income)', amber: 'var(--color-pending)', blue: 'var(--color-nav)', red: 'var(--color-alert)' }
  const accentColor = accent ? colors[accent] || colors.blue : undefined
  return (
    <div className="rounded-lg p-3" style={{ border: '1px solid var(--line)', background: accentColor ? `color-mix(in srgb, ${accentColor} 8%, transparent)` : 'rgba(255,255,255,.035)' }}>
      <p className="text-xs font-bold uppercase" style={{ color: accentColor || 'rgba(255,255,255,.4)' }}>{label}</p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  )
}

function validateCustomer(customer) {
  if (!customer.name?.trim()) throw new Error('El nombre / razon social es obligatorio.')
  if (customer.type === 'Empresa' && customer.rnc && customer.rnc.replace(/\D/g, '').length < 9) throw new Error('El RNC debe tener 9 a 11 digitos.')
  if (customer.type === 'Persona fisica' && customer.cedula && customer.cedula.replace(/\D/g, '').length !== 11) throw new Error('La cedula debe tener 11 digitos.')
}
function Icon({ icon: IconSvg, onClick }) { return <button onClick={onClick} className="rounded-md border p-2 transition" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }}><IconSvg size={15} /></button> }
function Input({ label, value, onChange, type = 'text', name }) { return <label><span className="label-dark">{label}</span><input id={name} name={name} type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} className="input-dark" /></label> }
function Select({ label, value, onChange, options, name }) { return <label><span className="label-dark">{label}</span><select id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark">{options.map((o) => <option key={o}>{o}</option>)}</select></label> }
function Box({ label, value }) { return <div className="rounded-lg p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.035)' }}><p className="text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>{label}</p><p className="mt-2 font-display text-xl font-bold">{value}</p></div> }
function SimpleRows({ rows }) { return <div className="space-y-2">{rows.length ? rows.map((row, index) => <div key={index} className="grid grid-cols-3 gap-3 rounded-lg p-3 text-sm" style={{ background: 'rgba(255,255,255,.035)' }}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>) : <p style={{ color: 'rgba(255,255,255,.45)' }}>Sin registros.</p>}</div> }
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }
