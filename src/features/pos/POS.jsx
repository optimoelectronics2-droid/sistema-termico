import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Keyboard, Mail, Minus, Plus, RotateCcw, Save, ScanBarcode, Send, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { InvoicePreview } from '../../components/invoice/InvoicePreview'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { calculateInvoice, invoiceModes } from '../../lib/taxEngine'
import { currency } from '../../lib/formatters'
import { nowIso } from '../../lib/dateTime'

const POS_DRAFT_KEY = 'trifusion-pos-autosave-v2'

export function POS() {
  const toast = useToast()
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const company = useERPStore((state) => state.company)
  const cashRegister = useERPStore((state) => state.cashRegister)
  const openCashRegister = useERPStore((state) => state.openCashRegister)
  const createInvoice = useERPStore((state) => state.createInvoice)
  const saveInvoiceDraft = useERPStore((state) => state.saveInvoiceDraft)
  const upsertCustomer = useERPStore((state) => state.upsertCustomer)
  const [initialDraft] = useState(readPosDraft)
  const productInputRef = useRef(null)
  const [mode, setMode] = useState(() => initialDraft?.mode || invoiceModes.NO_TAX)
  const [ncfType, setNcfType] = useState(() => initialDraft?.ncfType || 'NO_FISCAL')
  const [query, setQuery] = useState('')
  const [customerQuery, setCustomerQuery] = useState(() => initialDraft?.customerQuery || '')
  const [customerId, setCustomerId] = useState(() => initialDraft?.customerId || '')
  const [customerModal, setCustomerModal] = useState(false)
  const [customerDraft, setCustomerDraft] = useState({ name: '', document: '', phone: '', whatsapp: '', type: 'persona', preferredNcf: 'B02', paymentTerm: 'Contado', priceList: 'Detal', creditLimit: 0 })
  const [paymentMethod, setPaymentMethod] = useState(() => initialDraft?.paymentMethod || 'Efectivo')
  const [cart, setCart] = useState(() => initialDraft?.cart || [])
  const [lastInvoice, setLastInvoice] = useState(null)
  const [lastCustomer, setLastCustomer] = useState(null)
  const [draftStatus, setDraftStatus] = useState(() => initialDraft?.cart?.length ? 'Borrador recuperado' : 'Listo')
  const selectedCustomerId = customerId || ''
  const customer = customers.find((item) => item.id === selectedCustomerId)
  const totals = useMemo(() => calculateInvoice(cart, mode), [cart, mode])
  const filtered = useMemo(() => {
    if (!query.trim()) return []
    return products
      .filter((product) => `${product.name} ${product.sku} ${product.barcode} ${(product.serials || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  }, [products, query])
  const customerResults = useMemo(() => {
    const text = normalize(customerQuery)
    if (customerId) return []
    if (!text) return []
    return customers
      .map((item) => ({ customer: item, score: scoreCustomer(item, text) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || String(left.customer.name || '').localeCompare(String(right.customer.name || '')))
      .slice(0, 8)
      .map((entry) => entry.customer)
  }, [customerId, customerQuery, customers])

  useEffect(() => {
    if (cashRegister?.status !== 'open') {
      try {
        openCashRegister(0)
      } catch (error) {
        toast.error(error.message)
      }
    }
  }, [cashRegister?.status, openCashRegister, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload = { mode, ncfType, customerId, customerQuery, paymentMethod, cart, savedAt: nowIso() }
      localStorage.setItem(POS_DRAFT_KEY, JSON.stringify(payload))
      setDraftStatus(cart.length ? 'Autoguardado ahora' : 'Listo')
    }, 350)
    return () => window.clearTimeout(timer)
  }, [cart, customerId, customerQuery, mode, ncfType, paymentMethod])

  useEffect(() => {
    const handler = (event) => {
      const key = event.key.toLowerCase()
      if (event.key === 'F2') {
        event.preventDefault()
        productInputRef.current?.focus()
      }
      if (event.key === 'F4') {
        event.preventDefault()
        if (cart.length) sell()
      }
      if ((event.ctrlKey || event.metaKey) && key === 'backspace') {
        event.preventDefault()
        clearCurrentSale()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  useEffect(() => {
    function handleClickOutside(event) {
      if (productInputRef.current && !productInputRef.current.closest('.relative')?.contains(event.target)) {
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function addProduct(product) {
    if (product.category !== 'Servicios' && Number(product.stock || 0) <= 0) {
      toast.error(`${product.name} no tiene stock disponible.`)
      return
    }
    const usedSerials = new Set(cart.flatMap((item) => item.serials || []))
    const serial = product.requiresSerial ? (product.serials || []).find((item) => !usedSerials.has(item)) : ''
    if (product.requiresSerial && !serial) {
      toast.error(`${product.name} requiere serial/IMEI disponible.`)
      return
    }
    setCart((items) => {
      const existing = items.find((item) => item.productId === product.id && !product.requiresSerial)
      if (existing) {
        const nextQty = existing.quantity + 1
        if (product.category !== 'Servicios' && nextQty > Number(product.stock || 0)) {
          toast.error(`${product.name} no tiene stock suficiente.`)
          return items
        }
        return items.map((item) => (item.productId === product.id ? { ...item, quantity: nextQty } : item))
      }
      return [
        ...items,
        { productId: product.id, sku: product.sku, model: product.model || product.brand || '', name: product.name, quantity: 1, price: product.price, registeredPrice: product.price, cost: product.cost, discount: 0, taxable: product.taxable, serials: serial ? [serial] : [] },
      ]
    })
  }

  function updateCartLine(target, patch) {
    setCart((items) => items.map((item) => (item === target ? { ...item, ...patch } : item)))
  }

  function sell() {
    try {
      const invoice = createInvoice({
        customerId: selectedCustomerId || 'generic-customer',
        customerName: customer?.name || 'Cliente Generico',
        mode,
        ncfType,
        items: cart,
        payments: [{ method: paymentMethod, amount: totals.total, reference: '' }],
        paymentMethod,
        seller: 'Admin Trifusion',
      })
      setLastInvoice(null)
      setLastCustomer(null)
      setCart([])
      setQuery('')
      setCustomerId('')
      setCustomerQuery('')
      setPaymentMethod('Efectivo')
      setNcfType('NO_FISCAL')
      setMode(invoiceModes.NO_TAX)
      localStorage.removeItem(POS_DRAFT_KEY)
      setDraftStatus('Venta completada')
      toast.success(`Factura emitida: ${invoice.number}`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function clearCurrentSale() {
    setCart([])
    setQuery('')
    setCustomerId('')
    setCustomerQuery('')
    setPaymentMethod('Efectivo')
    setNcfType('NO_FISCAL')
    setMode(invoiceModes.NO_TAX)
    setLastInvoice(null)
    setLastCustomer(null)
    localStorage.removeItem(POS_DRAFT_KEY)
    setDraftStatus('Venta limpia')
  }

  function saveDraft() {
    try {
      if (!cart.length) {
        toast.error('Agregue productos antes de guardar el borrador.')
        return
      }
      const draft = saveInvoiceDraft({
        customerId: selectedCustomerId || 'generic-customer',
        customerName: customer?.name || customerQuery || 'Cliente Generico',
        mode,
        ncfType,
        items: cart,
        payments: [{ method: paymentMethod, amount: totals.total, reference: '' }],
        paymentMethod,
        seller: 'Admin Trifusion',
      })
      clearCurrentSale()
      setDraftStatus(`Borrador ${draft.number} guardado`)
      toast.success(`Borrador guardado: ${draft.number}`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function changeNcfType(value) {
    setNcfType(value)
    if (value === 'NO_FISCAL') setMode(invoiceModes.NO_TAX)
    if (value !== 'NO_FISCAL' && mode === invoiceModes.NO_TAX) setMode(invoiceModes.TAXED)
  }

  function saveQuickCustomer() {
    try {
      const saved = upsertCustomer({
        ...customerDraft,
        rnc: customerDraft.type === 'empresa' ? customerDraft.document : '',
        cedula: customerDraft.type !== 'empresa' ? customerDraft.document : '',
        balance: 0,
      })
      setCustomerId(saved.id)
      setCustomerQuery(saved.name)
      setCustomerModal(false)
      setCustomerDraft({ name: '', document: '', phone: '', whatsapp: '', type: 'persona', preferredNcf: 'B02', paymentTerm: 'Contado', priceList: 'Detal', creditLimit: 0 })
      toast.success('Cliente registrado y seleccionado.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
      <section className="min-w-0 space-y-4">
        <div>
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase text-blue-200/80"><Sparkles size={14} /> POS ultra rapido</p>
              <h2 className="font-display text-2xl font-bold">Venta mostrador inteligente</h2>
              <p className="text-sm text-white/45">Autoguardado, atajos, busqueda manual y recuperacion inmediata sin friccion.</p>
            </div>
            <div className="grid gap-2 text-xs font-bold text-white/50 sm:grid-cols-3 xl:min-w-[520px]">
              <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2"><Keyboard size={14} className="mr-1 inline text-blue-200" /> F2 buscar</p>
              <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2"><Send size={14} className="mr-1 inline text-emerald-200" /> F4 facturar</p>
              <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2"><Clock3 size={14} className="mr-1 inline text-amber-200" /> {draftStatus}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                <ScanBarcode size={19} className="text-blue-300" />
                <input ref={productInputRef} id="pos-query" name="pos-query" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-white/35" placeholder="Escanea codigo de barras, SKU, IMEI o busca producto" aria-label="pos-query" />
              </div>
              {filtered.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-[9999] mt-1 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-[#111118] p-2 shadow-2xl">
                  {filtered.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => { addProduct(product); setQuery('') }}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/[0.07]"
                    >
                      <div>
                        <p className="font-bold text-white">{product.name}</p>
                        <p className="text-xs text-white/45">{product.sku} · Stock: {product.stock}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-white">{currency.format(product.price)}</p>
                        <p className={product.taxable ? 'text-xs font-bold text-blue-300' : 'text-xs font-bold text-emerald-300'}>{product.taxable ? 'ITBIS' : 'Exento'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!query.trim() && (
                <p className="mt-2 text-xs text-white/40">Busca o escanea un producto para comenzar.</p>
              )}
            </div>
            <select id="pos-ncf-type" name="pos-ncf-type" value={ncfType} onChange={(event) => changeNcfType(event.target.value)} className="rounded-lg border border-white/10 bg-[#111118] px-3 py-3 text-sm font-bold outline-none" aria-label="pos-ncf-type">
              <option value="NO_FISCAL">Sin comprobante</option>
              <option value="B01">B01 Credito fiscal</option>
              <option value="B02">B02 Consumo</option>
            </select>
            <select id="pos-mode" name="pos-mode" value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-lg border border-white/10 bg-[#111118] px-3 py-3 text-sm font-bold outline-none" aria-label="pos-mode">
              <option value={invoiceModes.TAXED}>Factura con ITBIS</option>
              <option value={invoiceModes.NO_TAX}>Factura sin ITBIS</option>
              <option value={invoiceModes.MIXED}>Factura mixta</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel min-w-0 rounded-lg p-4">
        <h2 className="font-display text-2xl font-bold">Venta mostrador</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="relative flex gap-2">
            <div className="min-w-0 flex-1">
              <input
                id="pos-customer-query"
                name="pos-customer-query"
                value={customerQuery}
                onChange={(event) => { setCustomerQuery(event.target.value); setCustomerId('') }}
                className="w-full rounded-lg border border-white/10 bg-[#0d0e14] px-3 py-3 text-sm outline-none placeholder:text-white/35"
                placeholder="Buscar cliente por nombre, RNC, cedula, telefono o WhatsApp"
                aria-label="pos-customer-query"
              />
              {customerResults.length ? (
                <div className="absolute left-0 right-12 top-12 z-[9999] max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#111118] p-2 shadow-2xl">
                  {customerResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setCustomerId(item.id); setCustomerQuery(item.name || '') }}
                      className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.07]"
                    >
                      <span className="block font-bold text-white">{item.name}</span>
                      <span className="block text-xs text-white/45">{[item.rnc, item.cedula, item.phone, item.whatsapp].filter(Boolean).join(' · ') || 'Sin datos adicionales'}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {customerId ? <p className="mt-1 text-xs font-bold text-emerald-300">Cliente seleccionado: {customer?.name}</p> : null}
              {customerQuery.trim() && !customerId && !customerResults.length ? <p className="mt-1 text-xs font-bold text-amber-300">No encontramos ese cliente. Puedes registrarlo con el boton +.</p> : null}
            </div>
            <button type="button" title="Registrar cliente" onClick={() => setCustomerModal(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.08]"><UserPlus size={18} /></button>
          </div>
          <select id="pos-payment-method" name="pos-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-lg border border-white/10 bg-[#0d0e14] px-3 py-3 text-sm outline-none" aria-label="pos-payment-method">
            <option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option><option>Credito</option>
          </select>
        </div>
        <div className="premium-scroll mt-4 max-h-[340px] space-y-2 overflow-y-auto">
          {cart.map((item, index) => (
            <div key={`${item.productId}-${item.serials?.join('-') || 'bulk'}`} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{item.name}</p>
                  {item.serials?.length ? <p className="text-xs text-blue-200">Serial/IMEI {item.serials.join(', ')}</p> : null}
                </div>
                <button onClick={() => setCart((items) => items.filter((i) => i !== item))} className="text-white/45 hover:text-red-300"><Trash2 size={16} /></button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button className="rounded bg-white/10 p-1" onClick={() => updateCartLine(item, { quantity: Math.max(1, item.quantity - 1) })}><Minus size={14} /></button>
                  <span className="w-8 text-center font-bold">{item.quantity}</span>
                  <button disabled={Boolean(item.serials?.length)} className="rounded bg-white/10 p-1 disabled:opacity-35" onClick={() => updateCartLine(item, { quantity: item.quantity + 1 })}><Plus size={14} /></button>
                </div>
                <span className="font-bold">{currency.format(lineTotal(item, mode))}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="label-dark">Precio</span>
                  <input type="number" min="0" step="0.01" id={"pos-item-price-" + index} name={"pos-item-price-" + index} value={item.price} onChange={(event) => updateCartLine(item, { price: Number(event.target.value) })} className="input-dark py-2" />
                </label>
                <label>
                  <span className="label-dark">Rebaja %</span>
                  <input type="number" min="0" max="10" step="0.01" id={"pos-item-discount-" + index} name={"pos-item-discount-" + index} value={item.discount || 0} onChange={(event) => updateCartLine(item, { discount: Math.min(Math.max(Number(event.target.value), 0), 10) })} className="input-dark py-2" />
                </label>
              </div>
            </div>
          ))}
        </div>
        <Totals totals={totals} fiscal={ncfType !== 'NO_FISCAL'} />
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
          <Button variant="ghost" icon={Save} onClick={saveDraft}>Guardar borrador</Button>
          <Button variant="ghost" icon={RotateCcw} onClick={clearCurrentSale}>Limpiar</Button>
          <Button disabled={!cart.length} onClick={sell} className="py-3" icon={Send}>Facturar en menos de 30 segundos</Button>
        </div>
        {lastInvoice ? (
          <div className="mt-5 space-y-3">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={clearCurrentSale}>Limpiar factura</Button>
              <Button variant="ghost" icon={Mail} onClick={() => window.open(`mailto:?subject=Factura ${lastInvoice.number}`)}>Email</Button>
            </div>
            <InvoicePreview invoice={lastInvoice} company={company} customer={lastCustomer} />
          </div>
        ) : null}
      </section>
      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title="Registrar cliente" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCustomerModal(false)}>Cancelar</Button><Button variant="success" onClick={saveQuickCustomer}>Guardar cliente</Button></div>}>
        <div className="grid gap-3 md:grid-cols-2">
          <label><span className="label-dark">Tipo</span><select id="pos-customer-type" name="pos-customer-type" value={customerDraft.type} onChange={(event) => setCustomerDraft((state) => ({ ...state, type: event.target.value }))} className="input-dark"><option value="persona">Persona</option><option value="empresa">Empresa</option><option value="final">Final</option></select></label>
          <label><span className="label-dark">Nombre</span><input id="pos-customer-name" name="pos-customer-name" value={customerDraft.name} onChange={(event) => setCustomerDraft((state) => ({ ...state, name: event.target.value }))} className="input-dark" autoFocus /></label>
          <label><span className="label-dark">RNC / Cedula</span><input id="pos-customer-document" name="pos-customer-document" value={customerDraft.document} onChange={(event) => setCustomerDraft((state) => ({ ...state, document: event.target.value }))} className="input-dark" /></label>
          <label><span className="label-dark">Telefono</span><input id="pos-customer-phone" name="pos-customer-phone" value={customerDraft.phone} onChange={(event) => setCustomerDraft((state) => ({ ...state, phone: event.target.value, whatsapp: event.target.value }))} className="input-dark" /></label>
        </div>
      </Modal>
    </div>
  )
}

export function Invoicing() {
  return <POS />
}

function Totals({ totals, fiscal }) {
  return (
    <div className="mt-5 space-y-2 rounded-lg border border-white/10 bg-black/20 p-4">
      {fiscal ? <Row label="Subtotal gravado" value={totals.taxableSubtotal} /> : null}
      {fiscal ? <Row label="Subtotal exento / sin ITBIS" value={totals.exemptSubtotal} /> : null}
      {fiscal ? <Row label="ITBIS 18%" value={totals.itbis} /> : null}
      <Row label="Total" value={totals.total} strong />
    </div>
  )
}

function Row({ label, value, strong }) {
  return <div className={`flex justify-between ${strong ? 'text-xl font-extrabold text-white' : 'text-sm text-white/62'}`}><span>{label}</span><span>{currency.format(value)}</span></div>
}

function lineTotal(item, mode) {
  const calculated = calculateInvoice([item], mode).items[0]
  return (calculated?.net || 0) + (calculated?.tax || 0)
}

function scoreCustomer(customer, query) {
  const fields = [
    customer.name,
    customer.rnc,
    customer.cedula,
    customer.document,
    customer.phone,
    customer.whatsapp,
    customer.email,
    customer.address,
    customer.fullAddress,
  ].map(normalize)
  const parts = query.split(/\s+/).filter(Boolean)
  return fields.reduce((score, field) => {
    if (!field) return score
    if (field === query) return score + 120
    if (field.startsWith(query)) return score + 90
    if (field.includes(query)) return score + 60
    if (parts.length > 1 && parts.every((part) => field.includes(part))) return score + 45
    if (query.length >= 4 && levenshtein(field.slice(0, query.length + 2), query) <= 2) return score + 15
    return score
  }, 0)
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

function readPosDraft() {
  try {
    return JSON.parse(localStorage.getItem(POS_DRAFT_KEY) || 'null')
  } catch {
    return null
  }
}
