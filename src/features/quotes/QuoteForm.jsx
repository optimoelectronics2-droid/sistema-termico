import { useMemo, useState } from 'react'
import { Copy, Download, FileText, Pencil, Plus, Printer, Save, Send, Share2, Trash2, UserPlus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { QuotePreview } from './QuotePreview'
import { addDaysIso, todayIso } from '../../lib/dateTime'
import { calculateInvoice, invoiceModes } from '../../lib/taxEngine'
import { currency } from '../../lib/formatters'
import { downloadQuotePdf, printQuotePdf } from '../../lib/quotePdf'

const today = todayIso
const addDays = (days) => addDaysIso(today(), days)
const blankLine = () => ({ id: crypto.randomUUID(), productId: '', sku: '', name: '', description: '', quantity: 1, price: 0, cost: 0, discount: 0, taxable: true })

export function QuoteForm({ initialQuote, onDone }) {
  const toast = useToast()
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const upsertQuote = useERPStore((state) => state.upsertQuote)
  const convertQuoteToInvoice = useERPStore((state) => state.convertQuoteToInvoice)
  const upsertCustomer = useERPStore((state) => state.upsertCustomer)
  const company = useERPStore((state) => state.company)
  const [showPreview, setShowPreview] = useState(null)
  const [customerModal, setCustomerModal] = useState(false)
  const [customerDraft, setCustomerDraft] = useState({ type: 'persona', name: '', document: '', phone: '', whatsapp: '' })
  const [form, setForm] = useState(() => ({
    ...initialQuote,
    mode: initialQuote?.mode || invoiceModes.TAXED,
    customerId: initialQuote?.customerId || '',
    customerName: initialQuote?.customerName || '',
    date: initialQuote?.date || today(),
    validUntil: initialQuote?.validUntil || addDays(15),
    commercialTerms: initialQuote?.commercialTerms || 'Precios sujetos a disponibilidad. Esta cotizacion no constituye documento fiscal.',
    items: initialQuote?.items?.map((item) => ({ ...blankLine(), ...item, id: crypto.randomUUID() })) || [blankLine()],
    status: initialQuote?.status || 'Borrador',
  }))
  const customer = customers.find((item) => item.id === form.customerId)
  const totals = useMemo(() => calculateInvoice(form.items, form.mode), [form.items, form.mode])
  const productList = useMemo(() => products, [products])

  function setLine(lineId, patch) {
    setForm((state) => ({
      ...state,
      items: state.items.map((line) => line.id === lineId ? { ...line, ...patch, taxable: state.mode === invoiceModes.NO_TAX ? false : state.mode === invoiceModes.TAXED ? true : patch.taxable ?? line.taxable } : line),
    }))
  }

  function save(status = form.status, closeAfterSave = true) {
    try {
      const data = { ...form }
      if (!data.customerId) {
        const existingGeneric = customers.find((c) => c.name === 'Consumidor Final')
        const generic = existingGeneric || upsertCustomer({ type: 'final', name: 'Consumidor Final', rnc: '', cedula: '', phone: '', whatsapp: '', balance: 0 })
        data.customerId = generic.id
        data.customerName = 'Consumidor Final'
      }
      if (!data.items.some((item) => item.productId || item.name)) throw new Error('Agregue al menos un producto o servicio.')
      data.customerName = customer?.name || data.customerName
      const saved = upsertQuote({ ...data, status, totals })
      toast.success(status === 'Enviada' ? 'Cotizacion enviada correctamente.' : 'Cotizacion guardada correctamente.')
      if (closeAfterSave) onDone?.(saved)
      return saved
    } catch (error) {
      console.error('[QuoteForm] save error:', error)
      toast.error(error.message)
      return null
    }
  }

  function chooseProduct(lineId, item) {
    setLine(lineId, { productId: item.id, sku: item.sku || item.barcode || '', name: item.name, description: [item.brand, item.model, item.category].filter(Boolean).join(' · '), price: item.price, cost: item.cost, taxable: item.taxable })
  }

  function removeLine(lineId) {
    setForm((state) => ({ ...state, items: state.items.length === 1 ? [blankLine()] : state.items.filter((item) => item.id !== lineId) }))
  }

  function convertToInvoice() {
    const saved = save('Aprobada', false)
    if (!saved) return
    try {
      const draft = convertQuoteToInvoice(saved.id, 'NO_FISCAL')
      toast.success(`Cotizacion convertida a borrador ${draft.number}.`)
      onDone?.(saved)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function downloadQuote() {
    const saved = save(form.status, false)
    if (saved) setShowPreview(saved)
  }

  function printQuote() {
    const saved = save(form.status, false)
    if (saved) setShowPreview(saved)
  }

  async function shareQuote() {
    const saved = save('Enviada', false)
    if (!saved) return
    const text = `Cotizacion ${saved.number} para ${saved.customerName}: ${currency.format(saved.totals?.total || 0)}. Valida hasta ${saved.validUntil}.`
    if (navigator.share) await navigator.share({ title: saved.number, text })
    else navigator.clipboard?.writeText(text)
    toast.success(navigator.share ? 'Cotizacion compartida.' : 'Resumen copiado para compartir.')
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

  return (
    <div className="flex h-full gap-5">
      <aside className="w-[300px] shrink-0 space-y-4 overflow-y-auto">
        <section className="panel rounded-lg p-4">
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Cliente</p>
          <div className="mt-3 flex gap-2">
            <div className="min-w-0 flex-1">
              <Autocomplete
                value={customer}
                items={customers}
                placeholder="Buscar cliente"
                name="quote-customer-search"
                getMeta={(item) => `${item.rnc || item.cedula || item.phone || 'Sin documento'} · ${currency.format(item.balance || 0)}`}
                getSearchText={(item) => `${item.name || ''} ${item.rnc || ''} ${item.cedula || ''} ${item.phone || ''} ${item.whatsapp || ''}`}
                onSelect={(item) => setForm((state) => ({ ...state, customerId: item.id, customerName: item.name }))}
              />
            </div>
            <button type="button" title="Cliente rapido" onClick={() => setCustomerModal(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.08]"><UserPlus size={18} /></button>
          </div>
          {customer ? <p className="mt-3 text-xs text-white/45">{customer.rnc || customer.cedula || 'Consumidor final'} · {customer.priceList || 'Detal'} · Balance {currency.format(customer.balance || 0)}</p> : null}
        </section>

        <section className="panel rounded-lg p-4">
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Detalles</p>
          <div className="mt-3 space-y-3">
            <label htmlFor="quote-status-fld"><span className="label-dark">Estado</span><select id="quote-status-fld" name="quote-status" value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))} className="input-dark">
              <option>Borrador</option><option>Enviada</option><option>Aprobada</option><option>Convertida</option><option>Rechazada</option>
            </select></label>
            <label htmlFor="quote-mode-fld"><span className="label-dark">Modalidad</span><select id="quote-mode-fld" name="quote-mode" value={form.mode} onChange={(e) => setForm((s) => ({ ...s, mode: e.target.value }))} className="input-dark">
              <option value={invoiceModes.TAXED}>Con ITBIS</option>
              <option value={invoiceModes.NO_TAX}>Sin ITBIS</option>
              <option value={invoiceModes.MIXED}>Mixta</option>
            </select></label>
            <label htmlFor="quote-date-fld"><span className="label-dark">Fecha</span><input id="quote-date-fld" name="quote-date" type="date" value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} className="input-dark" /></label>
            <label htmlFor="quote-valid-until-fld"><span className="label-dark">Valida hasta</span><input id="quote-valid-until-fld" name="quote-valid-until" type="date" value={form.validUntil} onChange={(e) => setForm((s) => ({ ...s, validUntil: e.target.value }))} className="input-dark" /></label>
            <label htmlFor="quote-seller-fld"><span className="label-dark">Vendedor</span><input id="quote-seller-fld" name="quote-seller" value={form.seller || ''} onChange={(e) => setForm((s) => ({ ...s, seller: e.target.value }))} className="input-dark" placeholder="Vendedor" /></label>
            <label htmlFor="quote-commercial-terms-fld"><span className="label-dark">Condiciones comerciales</span><textarea id="quote-commercial-terms-fld" name="quote-commercial-terms" value={form.commercialTerms} onChange={(e) => setForm((s) => ({ ...s, commercialTerms: e.target.value }))} className="input-dark min-h-16" /></label>
          </div>
        </section>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <section>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold">Cotizacion</h2>
              <p className="text-sm text-white/45">{form.items.length} producto(s) · {customer?.name || 'Sin cliente'}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white/60">
                {initialQuote?.number || 'Nueva cotizacion'}
              </div>
              <Button variant="ghost" icon={Plus} onClick={() => setForm((s) => ({ ...s, items: [...s.items, blankLine()] }))}>Agregar</Button>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col panel rounded-lg">
          <div className="premium-scroll min-h-0 flex-1 overflow-auto">
            <table className="min-w-[960px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#171822] text-left text-xs uppercase text-white/45">
                <tr><th className="p-3">Producto</th><th className="p-3">Descripcion</th><th className="p-3">Cant.</th><th className="p-3">Precio</th><th className="p-3">ITBIS</th><th className="p-3">Desc.%</th><th className="p-3">Total</th><th className="p-3 w-12"></th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {form.items.length ? form.items.map((line, index) => {
                  const product = products.find((item) => item.id === line.productId)
                  const calc = calculateInvoice([line], form.mode).items[0]
                  return (
                    <tr key={line.id} className="align-top hover:bg-white/[0.02]">
                      <td className="min-w-72 p-3">
                        <Autocomplete
                          name={`quote-product-${index + 1}`}
                          value={product}
                          items={productList}
                          getMeta={(item) => `${item.sku} · ${item.brand || 'Sin marca'} · Stock ${item.stock ?? 0} · ${currency.format(item.price)}`}
                          onSelect={(item) => chooseProduct(line.id, item)}
                          emptyText="No hay productos"
                          getSearchText={(item) => `${item.name || ''} ${item.sku || ''} ${item.barcode || ''} ${item.brand || ''} ${item.model || ''} ${item.category || ''} ${(item.serials || []).join(' ')}`}
                        />
                        {product ? <p className="mt-1 text-xs text-white/40">{line.sku || product.sku || 'Sin codigo'} · {product.category || 'Producto'}</p> : null}
                      </td>
                      <td className="p-3">
                        <input id={`quote-desc-${line.id}`} name={`quoteDescription-${index + 1}`} value={line.description || ''} onChange={(event) => setLine(line.id, { description: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm outline-none" placeholder="Descripcion" aria-label={`quote-desc-${line.id}`} />
                      </td>
                      <td className="p-3">
                        <input id={`quote-qty-${line.id}`} name={`quoteQuantity-${index + 1}`} type="number" min="1" value={line.quantity} onChange={(event) => setLine(line.id, { quantity: Math.max(1, Number(event.target.value)) })} className="input-dark w-20 text-center" aria-label={`quote-qty-${line.id}`} />
                      </td>
                      <td className="p-3">
                        <input id={`quote-price-${line.id}`} name={`quotePrice-${index + 1}`} type="number" min="0" value={line.price} onChange={(event) => setLine(line.id, { price: Number(event.target.value) })} className="input-dark w-32" aria-label={`quote-price-${line.id}`} />
                      </td>
                      <td className="p-3">
                        {form.mode === invoiceModes.MIXED ? (
                          <button type="button" onClick={() => setLine(line.id, { taxable: !line.taxable })} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${line.taxable ? 'border-emerald-300 bg-emerald-500/15 text-emerald-100' : 'border-white/10 bg-white/[0.035] text-white/55'}`}>{line.taxable ? 'Si' : 'No'}</button>
                        ) : <span className="text-white/45 text-sm">{line.taxable ? 'Si' : 'No'}</span>}
                      </td>
                      <td className="p-3">
                        <input id={`quote-discount-${line.id}`} name={`quoteDiscount-${index + 1}`} type="number" min="0" max="100" value={line.discount} onChange={(event) => setLine(line.id, { discount: Number(event.target.value) })} className="input-dark w-24" aria-label={`quote-discount-${line.id}`} />
                      </td>
                      <td className="p-3 font-bold text-white">{currency.format((calc?.net || 0) + (calc?.tax || 0))}</td>
                      <td className="p-3 text-right"><button type="button" onClick={() => removeLine(line.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"><Trash2 size={15} /></button></td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan="8" className="p-10 text-center text-sm text-white/40">Agregue un producto para iniciar la cotizacion.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="w-[340px] shrink-0 space-y-4 overflow-y-auto">
        <section>
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Resumen</p>
          <div className="mt-4 space-y-2">
            <SummaryLine label="Subtotal" value={totals.subtotal} />
            <SummaryLine label="ITBIS" value={totals.itbis} />
            <SummaryLine label="Descuento" value={discountTotal(form.items)} />
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-xs font-extrabold uppercase text-emerald-200/70">Total general</p>
              <p className="font-display text-3xl font-extrabold text-white">{currency.format(totals.total)}</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-white/55">
            <p>{form.items.length} producto(s) · {form.status}</p>
            <p>{customer?.name || 'Sin cliente'} · {form.mode === invoiceModes.TAXED ? 'Con ITBIS' : form.mode === invoiceModes.NO_TAX ? 'Sin ITBIS' : 'Mixta'}</p>
          </div>
        </section>

        <section>
          <p className="text-xs font-extrabold uppercase text-blue-200/80">Acciones</p>
          <div className="mt-4 grid gap-2">
            <Button variant="success" icon={Save} className="py-3 text-base" disabled={!form.items.some((item) => item.productId || item.name)} onClick={() => save('Borrador')}>Guardar</Button>
            <Button variant="ghost" icon={Pencil} onClick={() => save(form.status)}>Actualizar cotizacion</Button>
            <Button variant="primary" icon={Copy} onClick={convertToInvoice}>Convertir en factura</Button>
            <Button variant="ghost" icon={Download} onClick={downloadQuote}>Descargar PDF</Button>
            <Button variant="ghost" icon={Printer} onClick={printQuote}>Imprimir</Button>
            <Button variant="ghost" icon={Share2} onClick={shareQuote}>Compartir</Button>
            <Button variant="primary" icon={Send} onClick={() => save('Enviada')}>Marcar como enviada</Button>
          </div>
        </section>
      </aside>

      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title="Cliente rapido" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCustomerModal(false)}>Cancelar</Button><Button variant="success" onClick={saveQuickCustomer}>Guardar</Button></div>}>
        <div className="grid gap-3 md:grid-cols-2">
          <label htmlFor="quick-customer-type"><span className="label-dark">Tipo</span><select id="quick-customer-type" name="quickCustomerType" value={customerDraft.type} onChange={(e) => setCustomerDraft((s) => ({ ...s, type: e.target.value }))} className="input-dark"><option value="persona">Persona</option><option value="empresa">Empresa</option><option value="final">Final</option></select></label>
          <label htmlFor="quick-customer-name"><span className="label-dark">Nombre</span><input id="quick-customer-name" name="quickCustomerName" value={customerDraft.name} onChange={(e) => setCustomerDraft((s) => ({ ...s, name: e.target.value }))} className="input-dark" autoFocus /></label>
          <label htmlFor="quick-customer-document"><span className="label-dark">RNC / Cedula</span><input id="quick-customer-document" name="quickCustomerDocument" value={customerDraft.document} onChange={(e) => setCustomerDraft((s) => ({ ...s, document: e.target.value }))} className="input-dark" /></label>
          <label htmlFor="quick-customer-phone"><span className="label-dark">Telefono</span><input id="quick-customer-phone" name="quickCustomerPhone" value={customerDraft.phone} onChange={(e) => setCustomerDraft((s) => ({ ...s, phone: e.target.value, whatsapp: e.target.value }))} className="input-dark" /></label>
        </div>
      </Modal>

      <Modal open={Boolean(showPreview)} onClose={() => setShowPreview(null)} title={`Cotizacion ${showPreview?.number || ''}`} size="xl">
        {showPreview ? <QuotePreview quote={showPreview} company={company} customer={customers.find((c) => c.id === showPreview.customerId)} /> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { downloadQuotePdf(showPreview).catch((e) => { console.error('[QuoteForm] PDF error:', e); toast.error('Error al descargar PDF.') }).finally(() => setShowPreview(null)) }}>Descargar PDF</Button>
          <Button variant="primary" onClick={() => { printQuotePdf().catch((e) => { console.error('[QuoteForm] PDF error:', e); toast.error('Error al imprimir.') }).finally(() => setShowPreview(null)) }}>Imprimir</Button>
        </div>
      </Modal>
    </div>
  )
}

function SummaryLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
      <span className="text-white/62">{label}</span>
      <b className="text-white">{currency.format(value || 0)}</b>
    </div>
  )
}

function discountTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.price || 0) * Number(item.quantity || 0) * Number(item.discount || 0)) / 100), 0)
}
