import { useMemo, useState } from 'react'
import { FileCheck2, Pencil, Printer, Send, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { InvoicePreview } from '../../components/invoice/InvoicePreview'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { invoiceModes } from '../../lib/taxEngine'
import { currency } from '../../lib/formatters'

export function DeliveryNotes() {
  const toast = useToast()
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const company = useERPStore((state) => state.company)
  const conduces = useERPStore((state) => state.conduces || [])
  const createDeliveryNote = useERPStore((state) => state.createDeliveryNote)
  const convertDeliveryNoteToInvoice = useERPStore((state) => state.convertDeliveryNoteToInvoice)
  const deleteDeliveryNote = useERPStore((state) => state.deleteDeliveryNote)
  const [form, setForm] = useState({ id: '', number: '', status: 'open', customerId: customers[0]?.id || '', notesCustomer: '', items: [] })
  const [preview, setPreview] = useState(null)
  const customer = customers.find((item) => item.id === form.customerId)
  const activeProducts = useMemo(() => products, [products])

  function addProduct(productId) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    setForm((state) => ({
      ...state,
      items: [...state.items, { productId: product.id, sku: product.sku, name: product.name, quantity: 1, price: product.price, cost: product.cost, taxable: false }],
    }))
  }

  function saveConduce() {
    try {
      const saved = createDeliveryNote({ ...form, customerName: customer?.name, mode: invoiceModes.NO_TAX })
      toast.success(form.id ? `Conduce actualizado: ${saved.number}` : `Conduce creado: ${saved.number}`)
      setPreview(saved)
      resetForm()
    } catch (error) {
      toast.error(error.message)
    }
  }

  function resetForm() {
    setForm({ id: '', number: '', status: 'open', customerId: customers[0]?.id || '', notesCustomer: '', items: [] })
  }

  function editConduce(conduce) {
    setForm({
      id: conduce.id,
      number: conduce.number,
      status: conduce.status || 'open',
      customerId: conduce.customerId || '',
      notesCustomer: conduce.notesCustomer || '',
      items: (conduce.items || []).map((item) => ({ ...item })),
    })
  }

  function removeConduce(conduce) {
    try {
      deleteDeliveryNote(conduce.id, 'Eliminacion desde modulo de conduces')
      if (form.id === conduce.id) resetForm()
      toast.success('Conduce eliminado.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function convert(conduce) {
    try {
      const invoice = convertDeliveryNoteToInvoice(conduce.id, {
        ncfType: 'NO_FISCAL',
        mode: invoiceModes.NO_TAX,
        payments: [{ method: 'Credito', amount: conduce.totals?.total || 0, reference: conduce.number }],
      })
      toast.success(`Conduce convertido a factura: ${invoice.number}`)
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <div className="space-y-0">
      <section className="module-header">
        <p className="module-header-eyebrow">Conduce</p>
        <h2 className="module-header-title">Entrega de productos sin afectar ingresos</h2>
        <div className="grid gap-3 lg:grid-cols-[260px_1fr_220px]">
          <select id="delivery-customer" value={form.customerId} onChange={(event) => setForm((state) => ({ ...state, customerId: event.target.value }))} className="input-dark" aria-label="delivery-customer">
            <option value="">Seleccione cliente</option>
            {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select id="delivery-product" onChange={(event) => { addProduct(event.target.value); event.target.value = '' }} className="input-dark" aria-label="delivery-product">
            <option value="">Agregar producto</option>
            {activeProducts.map((item) => <option key={item.id} value={item.id}>{item.name} - stock {item.stock}</option>)}
          </select>
          <div className="flex gap-2">
            <Button icon={FileCheck2} onClick={saveConduce} disabled={!form.customerId || !form.items.length}>{form.id ? 'Actualizar' : 'Guardar'} conduce</Button>
            {form.id ? <Button variant="ghost" onClick={resetForm}>Nuevo</Button> : null}
          </div>
        </div>
        <textarea id="delivery-notes" value={form.notesCustomer} onChange={(event) => setForm((state) => ({ ...state, notesCustomer: event.target.value }))} className="input-dark mt-3 min-h-20" placeholder="Observaciones" />
        <div className="mt-4 space-y-2">
          {form.items.map((item, index) => (
            <div key={`${item.productId}-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm md:grid-cols-[1fr_100px_120px_40px]">
              <p className="font-bold text-white">{item.name}</p>
              <input id={`delivery-item-qty-${index}`} type="number" min="1" value={item.quantity} onChange={(event) => setForm((state) => ({ ...state, items: state.items.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: Number(event.target.value) } : line) }))} className="input-dark" aria-label={`delivery-item-qty-${index}`} />
              <p className="font-bold">{currency.format(item.price * item.quantity)}</p>
              <button type="button" onClick={() => setForm((state) => ({ ...state, items: state.items.filter((_, lineIndex) => lineIndex !== index) }))} className="grid h-10 w-10 place-items-center rounded-lg border border-red-400/20 bg-red-500/10 text-red-200"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </section>

      <div>
        <div className="section-divider" />
        <h3 className="font-display text-xl font-bold">Historial de conduces</h3>
        <div className="mt-4 space-y-2">
          {conduces.map((conduce) => (
            <div key={conduce.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm">
              <div><p className="font-bold">{conduce.number} - {conduce.customerName}</p><p className="text-white/45">{conduce.status} | {currency.format(conduce.totals?.total || 0)}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" icon={Pencil} onClick={() => editConduce(conduce)}>Editar</Button>
                <Button variant="ghost" icon={Printer} onClick={() => setPreview(conduce)}>Imprimir</Button>
                <Button variant="success" icon={Send} disabled={conduce.status === 'converted'} onClick={() => convert(conduce)}>Convertir</Button>
                <Button variant="danger" icon={Trash2} onClick={() => removeConduce(conduce)}>Eliminar</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={`Conduce ${preview?.number || ''}`} size="xl">
        {preview ? <InvoicePreview invoice={{ ...preview, ncfType: 'NO_FISCAL', ncf: '', status: preview.status }} company={company} customer={customers.find((item) => item.id === preview.customerId)} title="CONDUCE" /> : null}
      </Modal>
    </div>
  )
}
