import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Autocomplete } from '../../components/ui/Autocomplete'
import { DatePicker } from '../../components/ui/DatePicker'
import { useERPStore } from '../../store/useERPStore'
import { todayIso } from '../../lib/dateTime'
import { currency } from '../../lib/formatters'
import { ENTRY_TYPES } from './entryTypes'

const blankItem = () => ({ id: crypto.randomUUID(), productId: '', quantity: 1, cost: 0, serialText: '' })

function buildForm(entry) {
  if (!entry) {
    return { type: ENTRY_TYPES[0], supplierId: 'no-supplier', date: todayIso(), supplierInvoice: '', reference: '', items: [blankItem()] }
  }
  return {
    type: entry.type,
    supplierId: entry.supplierId,
    date: entry.date,
    supplierInvoice: entry.supplierInvoice,
    reference: entry.reference,
    items: entry.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      quantity: item.quantity,
      cost: item.cost,
      serialText: (item.serials || []).join('\n'),
    })),
  }
}

export function EntryForm({ editingEntry, nextNumber, onSubmit, onCancelEdit }) {
  const products = useERPStore((state) => state.products)
  const suppliers = useERPStore((state) => state.suppliers)
  const [form, setForm] = useState(() => buildForm(editingEntry))
  const total = form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.cost || 0), 0)

  function setLine(id, patch) {
    setForm((state) => ({ ...state, items: state.items.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  }

  function handleSave() {
    onSubmit({
      ...form,
      items: form.items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        cost: Number(item.cost),
        serials: item.serialText.split(/[\n,]+/).map((serial) => serial.trim()).filter(Boolean),
      })),
    })
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold">{editingEntry ? 'Editar entrada de mercancia' : 'Entrada de mercancia'}</h2>
          <span className="rounded-full px-3 py-1 text-xs font-bold tracking-wide" style={{ background: 'rgba(96,165,250,.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.35)' }}>
            {editingEntry ? `Folio en edicion: ${nextNumber}` : `Siguiente folio: ${nextNumber}`}
          </span>
        </div>
        {editingEntry ? <Button variant="ghost" onClick={onCancelEdit}>Cancelar edicion</Button> : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <label><span className="label-dark">Tipo de entrada</span><select id="entry-type" name="entry-type" value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))} className="input-dark">{ENTRY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label><span className="label-dark">Proveedor</span><select id="entry-supplier" name="entry-supplier" value={form.supplierId} onChange={(e) => setForm((s) => ({ ...s, supplierId: e.target.value }))} className="input-dark">{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <DatePicker label="Fecha" value={form.date} onChange={(date) => setForm((s) => ({ ...s, date }))} />
        <label><span className="label-dark">Factura proveedor</span><input id="entry-supplier-invoice" name="entry-supplier-invoice" value={form.supplierInvoice} onChange={(e) => setForm((s) => ({ ...s, supplierInvoice: e.target.value }))} className="input-dark" /></label>
        <label><span className="label-dark">Referencia / nota</span><input id="entry-reference" name="entry-reference" value={form.reference} onChange={(e) => setForm((s) => ({ ...s, reference: e.target.value }))} className="input-dark" /></label>
      </div>
      <div className="premium-scroll mt-5 overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="text-left text-xs uppercase text-white/45"><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>Subtotal</th><th># Seriales</th><th></th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {form.items.map((item) => {
              const product = products.find((productItem) => productItem.id === item.productId)
              return (
                <tr key={item.id} className="align-top">
                  <td className="w-80 py-3"><Autocomplete name={`product-search-${item.id}`} id={`product-search-${item.id}`} value={product} items={products} getMeta={(p) => `${p.sku} · Stock ${p.stock}`} getSearchText={(p) => `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.model || ''} ${(p.serials || []).join(' ')}`} onSelect={(p) => setLine(item.id, { productId: p.id, cost: p.cost })} minQueryLength={1} startText="Busque el producto por nombre, codigo, modelo o serial" emptyText="Primero registre productos" /></td>
                  <td className="py-3"><input id={`entry-qty-${item.id}`} name={`entry-qty-${item.id}`} type="number" value={item.quantity} onChange={(e) => setLine(item.id, { quantity: Number(e.target.value) })} className="input-dark w-24" aria-label={`entry-qty-${item.id}`} /></td>
                  <td className="py-3"><input id={`entry-cost-${item.id}`} name={`entry-cost-${item.id}`} type="number" value={item.cost} onChange={(e) => setLine(item.id, { cost: Number(e.target.value) })} className="input-dark w-32" aria-label={`entry-cost-${item.id}`} /></td>
                  <td className="py-3 font-bold">{currency.format(Number(item.quantity || 0) * Number(item.cost || 0))}</td>
                  <td className="py-3">
                    {product?.requiresSerial ? <textarea id={`entry-serials-${item.id}`} name={`entry-serials-${item.id}`} value={item.serialText} onChange={(e) => setLine(item.id, { serialText: e.target.value })} placeholder="Uno por linea o coma" className="input-dark min-h-20 w-64" /> : <span className="text-white/35">No aplica</span>}
                  </td>
                  <td className="py-3"><button onClick={() => setForm((s) => ({ ...s, items: s.items.length === 1 ? [blankItem()] : s.items.filter((line) => line.id !== item.id) }))} className="text-red-300"><Trash2 size={16} /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" icon={Plus} onClick={() => setForm((s) => ({ ...s, items: [...s.items, blankItem()] }))}>Agregar producto</Button>
        <div className="flex items-center gap-4"><p className="font-display text-2xl font-bold">{currency.format(total)}</p><Button icon={Save} onClick={handleSave}>{editingEntry ? 'Actualizar entrada' : 'Guardar entrada'}</Button></div>
      </div>
    </section>
  )
}
