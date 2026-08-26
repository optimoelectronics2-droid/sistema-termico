import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Barcode, ChevronDown, CreditCard, FileCheck2, Minus, Plus, Save, Search, Trash2, UserPlus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { InvoicePreview } from '../../components/invoice/InvoicePreview'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { addDaysIso, todayIso } from '../../lib/dateTime'
import { assertValidTaxSequence, calculateInvoice, invoiceModes, ncfTypes, nextNcf } from '../../lib/taxEngine'
import { currency } from '../../lib/formatters'
import { randomUuid } from '../../lib/id'

const today = todayIso
const emptyPayment = () => ({ id: randomUuid(), method: 'Efectivo', amount: 0, reference: '' })
const emptyLineFromProduct = (product, customer) => ({
  id: randomUuid(),
  productId: product.id,
  sku: product.sku || '',
  model: product.model || product.brand || '',
  name: product.name,
  quantity: 1,
  price: priceForCustomer(product, customer),
  registeredPrice: priceForCustomer(product, customer),
  cost: product.cost || 0,
  discount: 0,
  taxable: product.taxable,
  serials: product.requiresSerial && product.serials?.[0] ? [product.serials[0]] : [],
})

export function InvoiceForm({ initialInvoice, duplicateOf, onDone }) {
  const toast = useToast()
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const users = useERPStore((state) => state.users)
  const company = useERPStore((state) => state.company)
  const taxSequences = useERPStore((state) => state.taxSequences)
  const upsertCustomer = useERPStore((state) => state.upsertCustomer)
  const saveInvoiceDraft = useERPStore((state) => state.saveInvoiceDraft)
  const updateInvoiceDraft = useERPStore((state) => state.updateInvoiceDraft)
  const createInvoice = useERPStore((state) => state.createInvoice)
  const updateInvoice = useERPStore((state) => state.updateInvoice)
  const source = duplicateOf || initialInvoice
  const editingIssued = Boolean(initialInvoice?.id && initialInvoice.status !== 'draft')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [successInvoice, setSuccessInvoice] = useState(null)
  const [successCustomer, setSuccessCustomer] = useState(null)
  const [customerModal, setCustomerModal] = useState(false)
  const [customerDraft, setCustomerDraft] = useState({ type: 'persona', name: '', document: '', phone: '', whatsapp: '', preferredNcf: 'B02', paymentTerm: 'Contado', priceList: 'Detal', creditLimit: 0 })
  const [form, setForm] = useState(() => ({
    id: initialInvoice?.id,
    mode: source?.mode || invoiceModes.TAXED,
    ncfType: source?.ncfType || defaultNcfType(company),
    number: source?.number || '',
    ncf: source?.ncf || '',
    status: source?.status || 'draft',
    customerId: source?.customerId || '',
    customerName: source?.customerName || '',
    issueDate: source?.issueDate || today(),
    dueDate: source?.dueDate || today(),
    seller: source?.seller || users[0]?.name || 'Administrador',
    paymentPlan: source?.paymentPlan || inferPaymentPlan(source),
    paymentMethod: source?.payments?.[0]?.method || source?.paymentMethod || 'Efectivo',
    notesCustomer: source?.notesCustomer || '',
    notesInternal: source?.notesInternal || '',
    globalDiscount: source?.globalDiscount || 0,
    items: source?.items?.map((item) => ({ ...item, id: randomUuid(), serials: item.serials || (item.serial ? [item.serial] : []) })) || [],
    payments: source?.payments || [emptyPayment()],
  }))

  const selectedCustomer = customers.find((customer) => customer.id === form.customerId)
  const sequence = taxSequences.find((item) => item.id === form.ncfType)
  const visibleProducts = useMemo(() => uniqueById(products), [products])
  const discountedItems = useMemo(() => form.items.map((item) => ({ ...item, discount: Number(item.discount || 0) + Number(form.globalDiscount || 0) })), [form.globalDiscount, form.items])
  const totals = useMemo(() => calculateInvoice(discountedItems, form.mode), [discountedItems, form.mode])
  const invoiceForPreview = { ...form, number: previewDocumentNumber(sequence), ncf: form.ncfType === 'NO_FISCAL' ? '' : previewDocumentNumber(sequence), totals, createdAt: form.issueDate, status: 'preview' }
  const paidNow = useMemo(() => form.payments.filter((payment) => payment.method !== 'Credito').reduce((sum, payment) => sum + Number(payment.amount || 0), 0), [form.payments])
  const creditBalance = Math.max(Number(totals.total || 0) - paidNow, 0)

  function setField(key, value) {
    setForm((state) => withBalancedSinglePayment({
      ...state,
      [key]: value,
    }))
  }

  function addProduct(product) {
    if (!product) return
    if (product.category !== 'Servicios' && Number(product.stock || 0) <= 0) {
      toast.error(`${product.name} no tiene stock disponible.`)
      return
    }
    setForm((state) => {
      const existing = state.items.find((item) => item.productId === product.id && !product.requiresSerial)
      if (existing) {
        return withBalancedSinglePayment({
          ...state,
          items: state.items.map((item) => item.id === existing.id ? { ...item, quantity: Number(item.quantity || 0) + 1 } : item),
        })
      }
      return withBalancedSinglePayment({ ...state, items: [...state.items, emptyLineFromProduct(product, selectedCustomer)] })
    })
  }

  function updateLine(lineId, patch) {
    setForm((state) => withBalancedSinglePayment({
      ...state,
      items: state.items.map((item) => {
        if (item.id !== lineId) return item
        const next = { ...item, ...patch }
        if (state.mode === invoiceModes.TAXED) next.taxable = true
        if (state.mode === invoiceModes.NO_TAX) next.taxable = false
        return next
      }),
    }))
  }

  function removeLine(lineId) {
    setForm((state) => withBalancedSinglePayment({ ...state, items: state.items.filter((item) => item.id !== lineId) }))
  }

  function resetForm() {
    setAdvancedOpen(false)
    setPreviewOpen(false)
    setForm({
      id: undefined,
      mode: invoiceModes.TAXED,
      ncfType: defaultNcfType(company),
      number: '',
      ncf: '',
      status: 'draft',
      customerId: '',
      customerName: '',
      issueDate: today(),
      dueDate: today(),
      seller: users[0]?.name || 'Administrador',
      paymentPlan: 'contado',
      paymentMethod: 'Efectivo',
      notesCustomer: '',
      notesInternal: '',
      globalDiscount: 0,
      items: [],
      payments: [emptyPayment()],
    })
  }

  function buildPayload(status = 'draft') {
    const sourcePayments = form.paymentPlan === 'fiado' ? [] : form.payments
    const payments = sourcePayments.length
      ? sourcePayments.map((payment, index) => ({
          id: payment.id || randomUuid(),
          method: payment.method || form.paymentMethod || 'Efectivo',
          amount: Number(payment.amount || (form.paymentPlan === 'contado' && sourcePayments.length === 1 && index === 0 ? totals.total : 0)),
          reference: payment.reference || '',
        }))
      : []
    return { ...form, payments, customerId: form.customerId || 'generic-customer', customerName: selectedCustomer?.name || form.customerName || 'Cliente Generico', totals, status }
  }

  function validateIssue() {
    if (!form.items.length) throw new Error('Agregue al menos un producto.')
    if (form.ncfType !== 'NO_FISCAL') assertValidTaxSequence(sequence)
    const originalIds = new Set((editingIssued ? initialInvoice?.items || [] : []).map((item) => item.productId))
    form.items.forEach((item) => {
      if (!editingIssued || !originalIds.has(item.productId)) {
        const product = products.find((productItem) => productItem.id === item.productId)
        if (!product) throw new Error(`Producto invalido: ${item.name || 'sin nombre'}.`)
        if (Number(item.quantity || 0) <= 0) throw new Error(`La cantidad de ${item.name} debe ser mayor que cero.`)
        if (!editingIssued && product.category !== 'Servicios' && Number(product.stock || 0) < Number(item.quantity || 0)) throw new Error(`${product.name} no tiene stock suficiente. Disponible: ${product.stock || 0}.`)
        if (product.requiresSerial && (item.serials || []).length !== Number(item.quantity)) throw new Error(`${product.name} requiere seleccionar ${item.quantity} serial(es).`)
      }
    })
  }

  function handleSaveDraft() {
    try {
      if (!form.items.length) throw new Error('Agregue al menos un producto.')
      const saved = editingIssued ? updateInvoice(form.id, buildPayload(form.status)) : form.id ? updateInvoiceDraft(form.id, buildPayload('draft')) : saveInvoiceDraft(buildPayload('draft'))
      setField('id', saved.id)
      toast.success(editingIssued ? `Factura actualizada a version ${saved.version}.` : 'Borrador guardado.')
      onDone?.(saved)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function handleIssue() {
    try {
      validateIssue()
      if (editingIssued) {
        const updated = updateInvoice(form.id, buildPayload(form.status))
        toast.success(`Factura actualizada a version ${updated.version}.`)
        onDone?.(updated)
        return
      }
      const invoice = createInvoice(buildPayload('paid'))
      setSuccessCustomer(selectedCustomer || { id: 'generic-customer', name: 'Cliente Generico', type: 'final' })
      setSuccessInvoice(invoice)
      resetForm()
      toast.success(`Factura emitida: ${invoice.number}`)
      onDone?.(invoice)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function saveQuickCustomer() {
    try {
      const saved = upsertCustomer({
        ...customerDraft,
        rnc: customerDraft.type === 'empresa' ? customerDraft.document : '',
        cedula: customerDraft.type === 'persona' ? customerDraft.document : '',
        balance: 0,
      })
      setForm((state) => ({ ...state, customerId: saved.id, customerName: saved.name }))
      setCustomerModal(false)
      toast.success('Cliente agregado.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function updatePayment(paymentId, patch) {
    setForm((state) => ({
      ...state,
      payments: state.payments.map((payment) => (payment.id === paymentId ? { ...payment, ...patch } : payment)),
      paymentMethod: patch.method || state.paymentMethod,
    }))
  }

  function addPayment() {
    setForm((state) => ({ ...state, payments: [...state.payments, emptyPayment()] }))
  }

  function removePayment(paymentId) {
    setForm((state) => ({ ...state, payments: state.payments.length === 1 ? state.payments : state.payments.filter((payment) => payment.id !== paymentId) }))
  }

  function setPaymentPlan(paymentPlan) {
    setForm((state) => {
      const isCredit = paymentPlan === 'credito' || paymentPlan === 'fiado'
      const dueDate = isCredit && (!state.dueDate || state.dueDate === today()) ? addDaysIso(today(), 30) : state.dueDate
      if (paymentPlan === 'contado') return withBalancedSinglePayment({ ...state, paymentPlan, dueDate, payments: state.payments.length ? state.payments.map((payment, index) => ({ ...payment, method: index === 0 ? payment.method === 'Credito' ? 'Efectivo' : payment.method : payment.method })) : [emptyPayment()] })
      if (paymentPlan === 'fiado') return { ...state, paymentPlan, dueDate, payments: [] }
      return { ...state, paymentPlan, dueDate, payments: state.payments.length ? state.payments.filter((payment) => payment.method !== 'Credito') : [{ ...emptyPayment(), amount: 0 }] }
    })
  }

  const paymentTotal = form.paymentPlan === 'fiado' ? 0 : paidNow
  const paymentDifference = form.paymentPlan === 'contado' ? totals.total - paymentTotal : creditBalance

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <aside className="space-y-4">
        <section className="panel rounded-lg p-4">
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Cliente</p>
          <div className="mt-3 flex gap-2">
            <div className="min-w-0 flex-1">
              <Autocomplete
                value={selectedCustomer}
                items={customers}
                placeholder="Buscar cliente"
                name="invoice-customer-search"
                getMeta={(customer) => `${customer.rnc || customer.cedula || customer.phone || 'Sin documento'} · ${currency.format(customer.balance || 0)}`}
                getSearchText={(customer) => `${customer.name || ''} ${customer.rnc || ''} ${customer.cedula || ''} ${customer.phone || ''} ${customer.whatsapp || ''}`}
                onSelect={(customer) => setForm((state) => ({ ...state, customerId: customer.id, customerName: customer.name, ncfType: customer.preferredNcf || state.ncfType }))}
              />
            </div>
            <button type="button" title="Cliente rapido" onClick={() => setCustomerModal(true)} className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.08]"><UserPlus size={18} /></button>
          </div>
          {selectedCustomer ? <p className="mt-3 text-xs text-white/45">{selectedCustomer.rnc || selectedCustomer.cedula || 'Consumidor final'} · {selectedCustomer.priceList || 'Detal'}</p> : null}
        </section>

        <section className="panel rounded-lg p-4">
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Factura</p>
          <div className="mt-3 space-y-3">
            <select id="invoice-ncf-type" name="invoice-ncf-type" value={form.ncfType} onChange={(event) => setField('ncfType', event.target.value)} className="input-dark" aria-label="invoice-ncf-type" autoComplete="off">
              {ncfOptions(form.mode).map((type) => <option key={type} value={type}>{type} {ncfTypes[type] || ''}</option>)}
            </select>
            {editingIssued ? <input id="invoice-number" name="invoice-number" value={form.number} onChange={(event) => setField('number', event.target.value)} className="input-dark" placeholder="Numero / correlativo" aria-label="invoice-number"  autoComplete="off" /> : null}
            {editingIssued ? <input id="invoice-ncf" name="invoice-ncf" value={form.ncf} onChange={(event) => setField('ncf', event.target.value)} className="input-dark" placeholder="NCF editable" aria-label="invoice-ncf"  autoComplete="off" /> : null}
            <select id="invoice-mode" name="invoice-mode" value={form.mode} onChange={(event) => setField('mode', event.target.value)} className="input-dark" aria-label="invoice-mode" autoComplete="off">
              <option value={invoiceModes.TAXED}>Con ITBIS</option>
              <option value={invoiceModes.NO_TAX}>Sin ITBIS</option>
              <option value={invoiceModes.MIXED}>Mixta</option>
            </select>
          </div>
          <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-bold text-white/60">
            Mas opciones <ChevronDown size={16} />
          </button>
          {advancedOpen ? (
            <div className="mt-3 space-y-3">
              <input id="invoice-issue-date" name="invoice-issue-date" type="date" value={form.issueDate} onChange={(event) => setField('issueDate', event.target.value)} className="input-dark" aria-label="invoice-issue-date"  autoComplete="off" />
              <select id="invoice-seller" name="invoice-seller" value={form.seller} onChange={(event) => setField('seller', event.target.value)} className="input-dark" aria-label="invoice-seller" autoComplete="off">
                {['Administrador', ...users.map((user) => user.name)].map((user) => <option key={user}>{user}</option>)}
              </select>
              <input id="invoice-global-discount" name="invoice-global-discount" type="number" min="0" max="10" value={form.globalDiscount} onChange={(event) => setField('globalDiscount', Number(event.target.value))} className="input-dark" placeholder="Descuento global %" aria-label="invoice-global-discount"  autoComplete="off" />
              <textarea id="invoice-customer-notes" name="invoice-customer-notes" value={form.notesCustomer} onChange={(event) => setField('notesCustomer', event.target.value)} className="input-dark min-h-20" placeholder="Nota para el cliente"  autoComplete="off" />
            </div>
          ) : null}
        </section>
      </aside>

      <main className="min-w-0 space-y-4">
        <section>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold">Facturacion rapida</h2>
              <p className="text-sm text-white/45">Busca, agrega y emite sin recorrer formularios largos.</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white/60">
              {previewDocumentNumber(sequence)}
            </div>
          </div>
          <ProductSearch products={visibleProducts} onSelect={addProduct} />
        </section>

        <section className="panel rounded-lg p-4">
          <div className="premium-scroll overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="text-left text-xs uppercase text-white/45">
                <tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>ITBIS</th><th>Total</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {form.items.length ? form.items.map((line) => {
                  const product = products.find((item) => item.id === line.productId)
                  const calc = calculateInvoice([{ ...line, discount: Number(line.discount || 0) + Number(form.globalDiscount || 0) }], form.mode).items[0]
                  return (
                    <tr key={line.id} className="align-middle">
                      <td className="py-3">
                        <p className="font-bold text-white">{line.name}</p>
                        <p className="text-xs text-white/40">{line.sku || 'Sin SKU'} · Stock {product?.stock ?? 'N/A'} · {product?.category || 'Producto'}</p>
                        {product?.requiresSerial ? <select id={`line-${line.id}-serial`} name={`line-${line.id}-serial`} value={line.serials?.[0] || ''} onChange={(event) => updateLine(line.id, { serials: event.target.value ? [event.target.value] : [] })} className="input-dark mt-2 max-w-48" aria-label={`line-${line.id}-serial`} autoComplete="off"><option value="">Serial/IMEI</option>{(product.serials || []).map((serial) => <option key={serial}>{serial}</option>)}</select> : null}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => updateLine(line.id, { quantity: Math.max(1, Number(line.quantity || 1) - 1) })} className="rounded bg-white/10 p-1"><Minus size={14} /></button>
                          <input id={`line-${line.id}-quantity`} name={`line-${line.id}-quantity`} type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} className="input-dark w-16 text-center" aria-label={`line-${line.id}-quantity`}  autoComplete="off" />
                          <button type="button" onClick={() => updateLine(line.id, { quantity: Number(line.quantity || 0) + 1 })} className="rounded bg-white/10 p-1"><Plus size={14} /></button>
                        </div>
                      </td>
                      <td className="py-3"><input id={`line-${line.id}-price`} name={`line-${line.id}-price`} type="number" value={line.price} onChange={(event) => updateLine(line.id, { price: Number(event.target.value) })} className="input-dark w-28" aria-label={`line-${line.id}-price`}  autoComplete="off" /></td>
                      <td className="py-3">{form.mode === invoiceModes.MIXED ? <input id={`line-${line.id}-taxable`} name={`line-${line.id}-taxable`} type="checkbox" checked={line.taxable} onChange={(event) => updateLine(line.id, { taxable: event.target.checked })} aria-label={`line-${line.id}-taxable`}  autoComplete="off" /> : line.taxable ? 'Si' : 'No'}</td>
                      <td className="py-3 font-bold">{currency.format((calc?.net || 0) + (calc?.tax || 0))}</td>
                      <td className="py-3 text-right"><button type="button" onClick={() => removeLine(line.id)} className="text-red-300"><Trash2 size={17} /></button></td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan="6" className="py-10 text-center text-sm text-white/40">Busca un producto o escanea un codigo para iniciar la factura.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="h-fit xl:sticky xl:top-24 z-10">
        <p className="text-xs font-extrabold uppercase text-blue-200/80">Resumen</p>
        <div className="mt-4 space-y-2">
          <Line label="Subtotal" value={totals.subtotal} />
          <Line label="ITBIS" value={totals.itbis} />
          <Line label="Total" value={totals.total} strong />
        </div>
        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-white/55">
          <p>{form.items.length} producto(s)</p>
          <p>{form.payments.map((payment) => payment.method).join(' + ') || form.paymentMethod}</p>
          <p>{selectedCustomer?.name || 'Cliente Generico'}</p>
        </div>
        <div className="mt-4 space-y-2">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-blue-200/80">Condicion de venta</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['contado', 'Contado'],
                ['credito', 'Credito'],
                ['fiado', 'Fiado'],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={() => setPaymentPlan(id)} className={`rounded-lg border px-2 py-2 text-xs font-extrabold transition ${form.paymentPlan === id ? 'border-emerald-300 bg-emerald-500/15 text-emerald-100' : 'border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07]'}`}>{label}</button>
              ))}
            </div>
          </div>
          <label htmlFor="invoice-due-date"><span className="label-dark">Vencimiento</span><input id="invoice-due-date" name="invoice-due-date" type="date" value={form.dueDate} onChange={(event) => setField('dueDate', event.target.value)} className="input-dark"  autoComplete="off" /></label>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase text-blue-200/80">Pagos</p>
            <button type="button" onClick={addPayment} disabled={form.paymentPlan === 'fiado'} className="rounded-md border border-white/10 px-2 py-1 text-xs font-bold text-white/60 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-35">Agregar</button>
          </div>
          {form.paymentPlan === 'fiado' ? <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-amber-100">Fiado: no se registra pago inicial. Se genera CxC por el total.</div> : form.payments.map((payment) => (
            <div key={payment.id} className="grid gap-2 rounded-lg border border-white/10 bg-black/15 p-2">
              <select id={`payment-${payment.id}-method`} name={`payment-${payment.id}-method`} value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value })} className="input-dark py-2" aria-label={`payment-${payment.id}-method`} autoComplete="off">
                <option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option><option>Cheque</option>
              </select>
              <input id={`payment-${payment.id}-amount`} name={`payment-${payment.id}-amount`} type="number" min="0" value={payment.amount} onChange={(event) => updatePayment(payment.id, { amount: Number(event.target.value) })} className="input-dark py-2" placeholder="Monto" aria-label={`payment-${payment.id}-amount`}  autoComplete="off" />
              <div className="flex gap-2">
                <input id={`payment-${payment.id}-reference`} name={`payment-${payment.id}-reference`} value={payment.reference || ''} onChange={(event) => updatePayment(payment.id, { reference: event.target.value })} className="input-dark py-2" placeholder="Referencia" aria-label={`payment-${payment.id}-reference`}  autoComplete="off" />
                <button type="button" onClick={() => removePayment(payment.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-red-400/20 bg-red-500/10 text-red-200"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm">
            <p className="flex items-center gap-2 font-bold text-white"><CreditCard size={15} /> Resumen de cobro</p>
            <p className="mt-2 text-white/60">Pagado ahora: <b className="text-white">{currency.format(paymentTotal)}</b></p>
            <p className={form.paymentPlan === 'contado' && Math.abs(paymentDifference) > 0.01 ? 'text-amber-300' : 'text-white/60'}>{form.paymentPlan === 'contado' ? 'Diferencia' : 'Pendiente CxC'}: <b>{currency.format(paymentDifference)}</b></p>
          </div>
        </div>
        <div className="mt-5 grid gap-2">
          <Button variant="success" icon={FileCheck2} className="py-3 text-base" disabled={!form.items.length} onClick={handleIssue}>{editingIssued ? 'Guardar cambios' : 'Facturar ahora'}</Button>
          <Button variant="ghost" icon={Save} disabled={!form.items.length} onClick={handleSaveDraft}>{editingIssued ? 'Guardar version' : 'Guardar borrador'}</Button>
          <Button variant="ghost" disabled={!form.items.length} onClick={() => setPreviewOpen(true)}>Vista previa</Button>
        </div>
      </aside>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Vista previa" size="xl">
        <InvoicePreview invoice={invoiceForPreview} company={company} customer={selectedCustomer} format="letter" showActions={false} />
      </Modal>

      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title="Cliente rapido" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCustomerModal(false)}>Cancelar</Button><Button variant="success" onClick={saveQuickCustomer}>Guardar</Button></div>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipo"><select id="invoiceform-quick-customer-type" name="invoiceform-quick-customer-type" value={customerDraft.type} onChange={(event) => setCustomerDraft((state) => ({ ...state, type: event.target.value }))} className="input-dark" autoComplete="off"><option value="persona">Persona</option><option value="empresa">Empresa</option><option value="final">Final</option></select></Field>
          <Field label="Nombre"><input id="invoiceform-quick-customer-name" name="invoiceform-quick-customer-name" value={customerDraft.name} onChange={(event) => setCustomerDraft((state) => ({ ...state, name: event.target.value }))} className="input-dark" autoFocus  autoComplete="off" /></Field>
          <Field label="RNC / Cedula"><input id="invoiceform-quick-customer-document" name="invoiceform-quick-customer-document" value={customerDraft.document} onChange={(event) => setCustomerDraft((state) => ({ ...state, document: event.target.value }))} className="input-dark"  autoComplete="off" /></Field>
          <Field label="Telefono"><input id="invoiceform-quick-customer-phone" name="invoiceform-quick-customer-phone" value={customerDraft.phone} onChange={(event) => setCustomerDraft((state) => ({ ...state, phone: event.target.value, whatsapp: event.target.value }))} className="input-dark"  autoComplete="tel" /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(successInvoice)} onClose={() => setSuccessInvoice(null)} title={`Factura emitida: ${successInvoice?.number}`} size="xl">
        {successInvoice ? <InvoicePreview invoice={successInvoice} company={company} customer={successCustomer} format="letter" /> : null}
      </Modal>
    </div>
  )
}

function ProductSearch({ products, onSelect }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(() => {
    const text = normalize(deferredQuery)
    if (!text) return []
    return uniqueById(products)
      .map((product) => ({ product, score: scoreProduct(product, text) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.product)
  }, [deferredQuery, products])

  function choose(product) {
    onSelect(product)
    setQuery('')
    setActiveIndex(0)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((value) => Math.max(value - 1, 0))
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      choose(results[activeIndex])
    }
  }

  const [menuRect, setMenuRect] = useState(null)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  useLayoutEffect(() => {
    if (!query || !containerRef.current) return undefined
    const updatePosition = () => {
      const rect = containerRef.current.getBoundingClientRect()
      setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [query])

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
        <Search className="text-blue-200" size={20} />
        <input
          ref={inputRef}
          id="invoice-product-search"
          name="invoice-product-search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:text-white/35"
          placeholder="Buscar producto, SKU, marca, modelo, categoria, serial o codigo"
          aria-label="invoice-product-search"
         autoComplete="off" />
        <Barcode className="text-white/35" size={20} />
      </div>
      {query.trim() && results.length > 0 && menuRect ? createPortal(
        <div
          className="fixed z-[35] max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-[#111118] p-2 shadow-2xl shadow-black/60"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {results.map((product, index) => (
            <button
              key={`${product.id}-${index}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(product)}
              className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition ${activeIndex === index ? 'bg-blue-500/20' : 'hover:bg-white/[0.06]'}`}
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-100">
                {product.image ? <img src={product.image} alt="" className="h-full w-full object-cover rounded-lg" /> : <Barcode size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-white">{product.name}</p>
                <p className="truncate text-xs text-white/45">{product.sku || product.barcode || 'Sin codigo'} · {product.category || ''} · {product.brand || ''}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-display font-bold text-white">{currency.format(product.price || 0)}</p>
                <p className={Number(product.stock || 0) > 0 || product.category === 'Servicios' ? 'text-xs text-emerald-300' : 'text-xs text-red-300'}>
                  Stock {product.category === 'Servicios' ? 'ilimitado' : product.stock || 0}
                </p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      ) : null}
      {!query.trim() ? (
        <p className="mt-3 rounded-lg border border-dashed border-white/10 bg-white/[0.025] px-3 py-4 text-center text-sm text-white/40">
          Escribe o escanea un producto para ver resultados.
        </p>
      ) : null}
      {query.trim() && results.length === 0 ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-4 text-center text-sm text-white/40">
          No hay productos con esa busqueda.
        </p>
      ) : null}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-white/45">{label}</span>{children}</label>
}

function Line({ label, value, strong }) {
  return <div className={`flex justify-between gap-3 ${strong ? 'border-t border-white/10 pt-3 text-3xl font-black' : 'text-sm text-white/62'}`}><span>{label}</span><span>{currency.format(value || 0)}</span></div>
}

function ncfOptions(mode) {
  if (mode === invoiceModes.TAXED) return ['NO_FISCAL', 'B01', 'B14', 'B15', 'E31', 'E33', 'E34', 'E41', 'E43']
  if (mode === invoiceModes.NO_TAX) return ['NO_FISCAL', 'B02', 'E32']
  return ['NO_FISCAL', 'B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34', 'E41', 'E43']
}

function previewDocumentNumber(sequence) {
  if (!sequence) return 'No fiscal'
  try {
    return nextNcf(sequence)
  } catch {
    return `${sequence.id || sequence.prefix} sin configurar`
  }
}

function priceForCustomer(product, customer) {
  const list = customer?.priceList
  if (list === 'Mayor') return product.wholesalePrice || product.price
  if (list === 'Tecnico') return product.technicianPrice || product.price
  if (list === 'Especial') return product.specialPrice || product.price
  return product.price || 0
}

function defaultNcfType(company) {
  if (company?.fiscal?.ecfEnabled) return 'E32'
  if (company?.fiscal?.ncfEnabled || company?.fiscal?.fiscalEnabled) return 'B01'
  return 'NO_FISCAL'
}

function withBalancedSinglePayment(form) {
  if (form.paymentPlan && form.paymentPlan !== 'contado') return form
  if (form.payments.length !== 1) return form
  const items = (form.items || []).map((item) => ({ ...item, discount: Number(item.discount || 0) + Number(form.globalDiscount || 0) }))
  const total = calculateInvoice(items, form.mode).total
  return {
    ...form,
    payments: [{ ...form.payments[0], amount: total }],
  }
}

function inferPaymentPlan(invoice) {
  if (!invoice) return 'contado'
  const payments = invoice.payments || []
  const hasCredit = payments.some((payment) => payment.method === 'Credito')
  if (!hasCredit) return 'contado'
  const paid = payments.filter((payment) => payment.method !== 'Credito').reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  return paid > 0 ? 'credito' : 'fiado'
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function scoreProduct(product, query) {
  const fields = [
    product.name,
    product.sku,
    product.barcode,
    product.brand,
    product.model,
    product.category,
    ...(product.serials || []),
  ].map(normalize)
  let score = 0
  fields.forEach((field) => {
    if (!field) return
    if (field === query) score += 100
    else if (field.startsWith(query)) score += 70
    else if (field.includes(query)) score += 40
    else if (query.split(/\s+/).every((part) => field.includes(part))) score += 25
    else if (levenshtein(field.slice(0, query.length + 2), query) <= 2) score += 10
  })
  return score
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, index) => [index])
  for (let index = 0; index <= a.length; index += 1) matrix[0][index] = index
  for (let row = 1; row <= b.length; row += 1) {
    for (let col = 1; col <= a.length; col += 1) {
      matrix[row][col] = b[row - 1] === a[col - 1]
        ? matrix[row - 1][col - 1]
        : Math.min(matrix[row - 1][col - 1] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col] + 1)
    }
  }
  return matrix[b.length][a.length]
}
