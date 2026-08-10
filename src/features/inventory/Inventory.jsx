import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Barcode, Boxes, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, ImagePlus, Layers3, Loader2, PackagePlus, Pencil, Plus, Printer, Search, SlidersHorizontal, TrendingUp, Trash2, Truck } from 'lucide-react'
import { Bar } from 'react-chartjs-2'
import { DataTable } from '../../components/ui/DataTable'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useERPStore } from '../../store/useERPStore'
import { downloadCsv } from '../../lib/csvExport'
import { currency, formatDate } from '../../lib/formatters'
import { buildCode128Bars, buildEAN13Bars, buildUPABars, barcodeToSvg, sanitizeCode128Value, getCode128Layout as getBarcodeLayout } from '../../lib/barcodeEngine'
import { generateZPL, downloadZplFile, sendToUsbPrinter, generateESCPOS, downloadEscposFile, sendEscposToUsb, renderLabelToCanvas, downloadLabelPng, LABEL_DIMENSIONS, PRINT_MODES } from '../../services/barcodeLabelService'
import { LABEL_SIZES as NEW_LABEL_SIZES, getLabelSize as newGetLabelSize, validateBarcodeReadability, createEmptyDesign, createLabelElement, generateBarcodeBars } from '../../lib/labelEngine'
import { renderDesignToPdf, renderDesignToZpl, renderDesignToEpl, renderDesignToTspl, renderDesignToCpcl, renderDesignToEscpos, renderDesign, downloadOutput } from '../../lib/labelOutput'
import LabelDesigner from '../../components/label/LabelDesigner'
import LabelPrinterProfileDialog from '../../components/label/LabelPrinterProfileDialog'
import LabelMassPrintDialog from '../../components/label/LabelMassPrintDialog'
import jsPDF from 'jspdf'

const emptyProduct = {
  name: '',
  sku: '',
  barcode: '',
  category: 'Celulares',
  brand: '',
  model: '',
  color: '',
  capacity: '',
  cost: 0,
  price: 0,
  wholesalePrice: 0,
  technicianPrice: 0,
  specialPrice: 0,
  usdPrice: 0,
  taxStatus: 'no_tax',
  unit: 'Unidad',
  stock: 0,
  initialStock: 0,
  stockMin: 1,
  stockMax: 0,
  location: '',
  supplierId: 'no-supplier',
  warrantyMonths: 0,
  requiresSerial: false,
  serialsText: '',
  description: '',
  status: 'Activo',
  image: '',
}

export function Inventory() {
  const toast = useToast()
  const { confirmState, ask, close } = useConfirm()
  const products = useERPStore((state) => state.products)
  const categories = useERPStore((state) => state.categories)
  const suppliers = useERPStore((state) => state.suppliers)
  const movements = useERPStore((state) => state.inventoryMovements)
  const upsertProduct = useERPStore((state) => state.upsertProduct)
  const deleteProduct = useERPStore((state) => state.deleteProduct)
  const adjustInventory = useERPStore((state) => state.adjustInventory)
  const updateCategories = useERPStore((state) => state.updateCategories)
  const [filters, setFilters] = useState({ query: '', category: 'all', brand: 'all', tax: 'all', low: false })
  const debouncedQuery = useDebouncedValue(filters.query, 220)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [labeling, setLabeling] = useState(null)
  const [saving, setSaving] = useState(false)
  const [adjust, setAdjust] = useState({ type: 'incremento', quantity: 1, reason: 'Conteo fisico', note: '', serialText: '' })
  const [inventorySort, setInventorySort] = useState('category')
  const [inventoryPage, setInventoryPage] = useState(1)
  const [inventoryPageSize, setInventoryPageSize] = useState(20)
  const brands = useMemo(() => [...new Set(products.map((item) => item.brand).filter(Boolean))], [products])
  const inventoryValue = useMemo(() => products.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.stock || 0), 0), [products])
  const lowStock = useMemo(() => products.filter((item) => Number(item.stock || 0) <= Number(item.stockMin || 0)), [products])
  const categorySummary = useMemo(() => buildCategorySummary(products), [products])

  const filtered = useMemo(() => products.filter((item) => {
    const q = normalize(debouncedQuery)
    return (!q || scoreInventoryProduct(item, q) > 0)
      && (filters.category === 'all' || item.category === filters.category)
      && (filters.brand === 'all' || item.brand === filters.brand)
      && (filters.tax === 'all' || item.taxStatus === filters.tax)
      && (!filters.low || Number(item.stock || 0) <= Number(item.stockMin || 0))
  }).sort((left, right) => scoreInventoryProduct(right, normalize(debouncedQuery)) - scoreInventoryProduct(left, normalize(debouncedQuery))), [debouncedQuery, filters.brand, filters.category, filters.low, filters.tax, products])
  const sortedInventory = useMemo(() => sortInventory(filtered, inventorySort), [filtered, inventorySort])
  const inventoryTotalPages = Math.max(1, Math.ceil(sortedInventory.length / inventoryPageSize))
  const safeInventoryPage = Math.min(inventoryPage, inventoryTotalPages)
  const visibleInventory = useMemo(() => {
    const start = (safeInventoryPage - 1) * inventoryPageSize
    return sortedInventory.slice(start, start + inventoryPageSize)
  }, [inventoryPageSize, safeInventoryPage, sortedInventory])

  useEffect(() => {
    const timer = window.setTimeout(() => setInventoryPage(1), 0)
    return () => window.clearTimeout(timer)
  }, [debouncedQuery, filters.brand, filters.category, filters.low, filters.tax, inventoryPageSize, inventorySort])

  async function saveProduct(product) {
    const validation = validateProduct(product)
    if (validation) {
      toast.error(validation)
      return
    }
    setSaving(true)
    try {
      if (product.category && !categories.includes(product.category)) updateCategories([...categories, product.category])
      const saved = upsertProduct(product)
      toast.success(saved.id === product.id ? 'Producto actualizado correctamente.' : 'Producto creado correctamente.')
      setEditing(null)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeProduct(product) {
    const ok = await ask({
      title: `Eliminar producto ${product.sku || ''}`,
      description: 'El producto se ocultara del inventario activo, pero queda en auditoria para recuperar historial.',
      body: `${product.name} quedara marcado como eliminado. Las facturas y movimientos asociados no se destruyen.`,
      danger: true,
    })
    if (!ok) return
    try {
      deleteProduct(product.id, 'Soft delete desde inventario')
      toast.success('Producto eliminado del inventario activo.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function saveAdjust() {
    try {
      adjustInventory({
        productId: adjusting.id,
        ...adjust,
        serials: adjust.serialText.split(/[\n,]+/).map((serial) => serial.trim()).filter(Boolean),
        reason: `${adjust.reason}: ${adjust.note || adjust.reason}`,
      })
      toast.success('Ajuste registrado correctamente.')
      setAdjusting(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function openAdjust(product) {
    setAdjust({ type: 'incremento', quantity: 1, reason: 'Conteo fisico', note: '', serialText: '' })
    setAdjusting(product)
  }

  function exportInventory() {
    downloadCsv('trifusion-inventario.csv', buildInventoryRows(sortedInventory))
  }

  async function exportInventoryPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('Inventario completo', 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Productos: ${sortedInventory.length} | Valor costo: ${currency.format(sortedInventory.reduce((sum, item) => sum + Number(item.cost || 0) * Number(item.stock || 0), 0))}`, 12, 21)
    autoTable(doc, {
      startY: 28,
      head: [['Categoria', 'Producto', 'SKU', 'Stock', 'Costo', 'Precio', 'Valor inventario', 'Seriales']],
      body: buildInventoryRows(sortedInventory).map((row) => [row.categoria, row.producto, row.sku, row.stock, currency.format(row.costo), currency.format(row.precio), currency.format(row.valorInventario), row.seriales]),
      styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      columnStyles: { 1: { cellWidth: 48 }, 8: { cellWidth: 52 } },
    })
    doc.save('inventario-completo-trifusion.pdf')
  }

  const columns = [
    { header: 'Producto', cell: ({ row }) => <ProductIdentity product={row.original} /> },
    { header: 'Categoria / Marca', cell: ({ row }) => <span className="text-xs">{row.original.category} <span className="opacity-50">/</span> {row.original.brand || '-'}</span> },
    { header: 'Precio', cell: ({ row }) => currency.format(row.original.price) },
    { header: 'Stock', cell: ({ row }) => <StockIndicator product={row.original} /> },
    { header: 'Acciones', cell: ({ row }) => <ProductActions product={row.original} onView={setViewing} onEdit={setEditing} onAdjust={openAdjust} onLabel={setLabeling} onDelete={removeProduct} />, meta: { align: 'right' } },
  ]

  return (
    <div className="space-y-0">
      <section className="module-header grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InventoryMetric title="Productos activos" value={products.length} detail="Total en catalogo" />
        <InventoryMetric title="Valor inventario" value={currency.format(inventoryValue)} detail="Costo x stock disponible" />
        <InventoryMetric title="Stock bajo" value={lowStock.length} detail="Productos que requieren reposicion" tone="danger" />
        <InventoryMetric title="Serializados" value={products.filter((item) => item.requiresSerial).length} detail="IMEI / serial controlado" />
      </section>

      <section className="section-card">
        <div className="min-w-0">
          <p className="module-header-eyebrow"><Boxes size={14} /> Inventario avanzado</p>
          <h2 className="module-header-title">Productos, stock, seriales e IMEI</h2>
          <p className="module-header-desc">Crear, editar, eliminar, restaurar y auditar productos sin romper ventas ni movimientos existentes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="module-search-bar">
            <Search size={16} style={{ color: 'var(--text-tertiary)' }} />
            <input id="inv-query" name="inv-query" value={filters.query} onChange={(e) => setFilters((s) => ({ ...s, query: e.target.value }))} placeholder="Nombre, SKU, codigo, IMEI, serial, marca" className="min-w-0 flex-1" />
          </label>
          <select id="inv-category" name="inv-category" value={filters.category} onChange={(e) => setFilters((s) => ({ ...s, category: e.target.value }))} className="input-dark max-w-44" aria-label="inv-category"><option value="all">Todas las categorias</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select id="inv-brand" name="inv-brand" value={filters.brand} onChange={(e) => setFilters((s) => ({ ...s, brand: e.target.value }))} className="input-dark max-w-40" aria-label="inv-brand"><option value="all">Todas las marcas</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
          <select id="inv-tax" name="inv-tax" value={filters.tax} onChange={(e) => setFilters((s) => ({ ...s, tax: e.target.value }))} className="input-dark max-w-32" aria-label="inv-tax"><option value="all">ITBIS todos</option><option value="taxed">Con ITBIS</option><option value="no_tax">Sin ITBIS</option><option value="exempt">Exento</option></select>
          <select id="inv-sort" name="inv-sort" value={inventorySort} onChange={(e) => setInventorySort(e.target.value)} className="input-dark max-w-44" aria-label="inv-sort"><option value="category">Orden: categoria</option><option value="stock">Stock</option><option value="quantity">Cantidad</option><option value="value">Valor inventario</option></select>
          <Button variant={filters.low ? 'danger' : 'ghost'} onClick={() => setFilters((s) => ({ ...s, low: !s.low }))}>Stock bajo</Button>
          <Button icon={Download} variant="ghost" onClick={exportInventory}>Excel</Button>
          <Button icon={Printer} variant="ghost" onClick={exportInventoryPdf}>PDF</Button>
          <Button icon={Plus} onClick={() => setEditing({ ...emptyProduct })}>Nuevo producto</Button>
        </div>
        <InventoryCategoryStrip rows={categorySummary} />
        <div className="mt-4 flex flex-col gap-2 rounded-lg border text-xs font-bold sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--line)', color: 'var(--text-secondary)', background: 'var(--bg-table-header)', padding: '12px 16px' }}>
          <span>{sortedInventory.length} producto(s) encontrados · mostrando {visibleInventory.length} · pagina {safeInventoryPage} de {inventoryTotalPages}</span>
          <div className="flex flex-wrap items-center gap-2">
            <select id="inv-page-size" name="inv-page-size" value={inventoryPageSize} onChange={(event) => setInventoryPageSize(Number(event.target.value))} className="input-dark max-w-36 py-1.5 text-xs" aria-label="inv-page-size">
              {[12, 20, 36, 60].map((option) => <option key={option} value={option}>{option} por pagina</option>)}
            </select>
            <Button icon={ChevronLeft} variant="ghost" className="px-2 py-1.5 text-xs" disabled={safeInventoryPage <= 1} onClick={() => setInventoryPage((page) => Math.max(1, page - 1))} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--line)' }}>Anterior</Button>
            <input id="inv-page" name="inv-page" type="number" min={1} max={inventoryTotalPages} value={safeInventoryPage} onChange={(event) => { const value = Number(event.target.value); if (value >= 1 && value <= inventoryTotalPages) setInventoryPage(value) }} className="input-dark w-16 py-1 text-center text-xs" aria-label="inv-page" />
            <Button icon={ChevronRight} variant="ghost" className="px-2 py-1.5 text-xs" disabled={safeInventoryPage >= inventoryTotalPages} onClick={() => setInventoryPage((page) => Math.min(inventoryTotalPages, page + 1))} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--line)' }}>Siguiente</Button>
          </div>
        </div>
      </section>
      <div className="section-divider" />
      <DataTable data={visibleInventory} columns={columns} emptyText="No hay productos con esos filtros." initialPageSize={inventoryPageSize} pageSizeOptions={[inventoryPageSize]} searchable={false} />

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Editar producto' : 'Crear producto'} description="Formulario organizado por secciones, con validacion visible y stock inicial." size="full">
        {editing ? <ProductForm product={editing} categories={categories} suppliers={suppliers} onSave={saveProduct} saving={saving} /> : null}
      </Modal>

      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title="Detalle de producto" size="xl">
        {viewing ? <ProductDetail product={viewing} movements={movements.filter((item) => item.productId === viewing.id)} /> : null}
      </Modal>

      <Modal open={Boolean(adjusting)} onClose={() => setAdjusting(null)} title={`Ajustar stock: ${adjusting?.name || ''}`} size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAdjusting(null)}>Cancelar</Button><Button variant="success" onClick={saveAdjust}>Guardar ajuste</Button></div>}>
        <div className="grid gap-3 md:grid-cols-2">
          <label><span className="label-dark">Tipo</span><select id="inv-adjust-type" name="inv-adjust-type" value={adjust.type} onChange={(e) => setAdjust((s) => ({ ...s, type: e.target.value }))} className="input-dark"><option value="incremento">Incremento</option><option value="decremento">Decremento</option></select></label>
          <label><span className="label-dark">Cantidad</span><input id="inv-adjust-quantity" name="inv-adjust-quantity" type="number" min="1" value={adjust.quantity} onChange={(e) => setAdjust((s) => ({ ...s, quantity: Number(e.target.value) }))} className="input-dark" /></label>
          <label><span className="label-dark">Motivo</span><select id="inv-adjust-reason" name="inv-adjust-reason" value={adjust.reason} onChange={(e) => setAdjust((s) => ({ ...s, reason: e.target.value }))} className="input-dark"><option>Conteo fisico</option><option>Merma</option><option>Daño</option><option>Robo</option><option>Error administrativo</option><option>Otro</option></select></label>
          <label><span className="label-dark">Nota</span><input id="inv-adjust-note" name="inv-adjust-note" value={adjust.note} onChange={(e) => setAdjust((s) => ({ ...s, note: e.target.value }))} className="input-dark" /></label>
          {adjusting?.requiresSerial ? <label className="md:col-span-2"><span className="label-dark">Seriales / IMEI del ajuste</span><textarea id="inv-adjust-serials" name="inv-adjust-serials" value={adjust.serialText} onChange={(e) => setAdjust((s) => ({ ...s, serialText: e.target.value }))} className="input-dark min-h-24" placeholder="Uno por linea o coma" /><span className="mt-1 block text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>Para decrementos deben existir como disponibles; para incrementos no pueden existir en otro historial.</span></label> : null}
        </div>
      </Modal>
      <Modal open={Boolean(labeling)} onClose={() => setLabeling(null)} title="Imprimir etiquetas" size="lg">
        {labeling ? <BarcodeLabelPrinter product={labeling} /> : null}
      </Modal>
      <ConfirmDialog state={confirmState} onClose={close} />
    </div>
  )
}

export function InventoryCenter() {
  const products = useERPStore((state) => state.products)
  const movements = useERPStore((state) => state.inventoryMovements)
  const invoices = useERPStore((state) => state.invoices)
  const entries = useERPStore((state) => state.productEntries)
  const suppliers = useERPStore((state) => state.suppliers)
  const inventoryInsights = useMemo(() => buildInventoryInsights({ products, movements, invoices, entries, suppliers }), [products, entries, invoices, movements, suppliers])
  return (
    <div>
      <InventoryEnterpriseCenter insights={inventoryInsights} movements={movements} entries={entries} />
    </div>
  )
}

function StockIndicator({ product }) {
  const stock = Number(product.stock || 0)
  const min = Number(product.stockMin || 0)
  const max = Math.max(Number(product.stockMax || 0), min * 3)
  const pct = Math.min((stock / max) * 100, 100)
  const empty = stock <= 0
  const low = stock > 0 && stock <= min
  const barColor = empty ? 'var(--color-alert)' : low ? 'var(--color-pending)' : 'var(--color-income)'
  return (
    <div className="min-w-[100px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold" style={{ color: empty ? 'var(--color-alert)' : low ? 'var(--color-pending)' : 'var(--color-income)' }}>{stock}</span>
        {empty ? <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-alert)' }}>Agotado</span> : low ? <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-pending)' }}>Minimo</span> : null}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, empty ? 4 : 4)}%`, background: barColor }} />
      </div>
    </div>
  )
}

function ProductForm({ product, categories, suppliers, onSave, saving }) {
  const [draft, setDraft] = useState(() => ({
    ...emptyProduct,
    ...product,
    initialStock: product.id ? Number(product.stock || 0) : Number(product.initialStock || product.stock || 0),
    serialsText: product.serialsText || (product.serials || []).join('\n'),
  }))
  const [touched, setTouched] = useState(false)
  const errors = getProductErrors(draft)
  const margin = Number(draft.price) ? ((Number(draft.price) - Number(draft.cost || 0)) / Number(draft.price)) * 100 : 0
  const set = (key, value) => setDraft((state) => ({ ...state, [key]: value }))
  const submit = () => {
    setTouched(true)
    if (Object.keys(errors).length) return
    onSave({ ...draft, stock: draft.id ? draft.stock : draft.initialStock })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        <section className="rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <CompactField label="Nombre *" error={touched && errors.name}><input id="inventory-name" value={draft.name} onChange={(e) => set('name', e.target.value)} className="input-dark text-sm" placeholder="Ej. iPhone 15 Pro 256GB" /></CompactField>
            <CompactField label="Categoria *" error={touched && errors.category}><input id="inventory-category" list="category-options" value={draft.category} onChange={(e) => set('category', e.target.value)} className="input-dark text-sm" placeholder="Categoria" /><datalist id="category-options">{categories.map((item) => <option key={item} value={item} />)}</datalist></CompactField>
            <CompactField label="Marca"><input id="inventory-brand" value={draft.brand} onChange={(e) => set('brand', e.target.value)} className="input-dark text-sm" placeholder="Apple, Samsung..." /></CompactField>
            <CompactField label="Modelo"><input id="inventory-model" value={draft.model} onChange={(e) => set('model', e.target.value)} className="input-dark text-sm" /></CompactField>
            <CompactField label="SKU"><input id="inventory-sku" value={draft.sku} onChange={(e) => set('sku', e.target.value)} className="input-dark text-sm" placeholder="Autogenerado" /></CompactField>
            <CompactField label="Codigo barras"><input id="inventory-barcode" value={draft.barcode} onChange={(e) => set('barcode', e.target.value)} className="input-dark text-sm" /></CompactField>
            <CompactField label="Color"><input id="inventory-color" value={draft.color} onChange={(e) => set('color', e.target.value)} className="input-dark text-sm" /></CompactField>
            <CompactField label="Capacidad/talla"><input id="inventory-capacity" value={draft.capacity} onChange={(e) => set('capacity', e.target.value)} className="input-dark text-sm" /></CompactField>
            <CompactField label="Ubicacion"><input id="inventory-location" value={draft.location} onChange={(e) => set('location', e.target.value)} className="input-dark text-sm" placeholder="A1, vitrina..." /></CompactField>
          </div>
          <CompactField label="Descripcion" className="mt-2"><textarea id="inventory-description" value={draft.description} onChange={(e) => set('description', e.target.value)} className="input-dark min-h-16 text-sm" /></CompactField>
        </section>

        <section className="rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <CompactField label="Costo *" error={touched && errors.cost}><NumberInput value={draft.cost} onChange={(value) => set('cost', value)} /></CompactField>
            <CompactField label="Precio *" error={touched && errors.price}><NumberInput value={draft.price} onChange={(value) => set('price', value)} /></CompactField>
            <CompactField label="Mayor"><NumberInput value={draft.wholesalePrice} onChange={(value) => set('wholesalePrice', value)} /></CompactField>
            <CompactField label="Tecnico"><NumberInput value={draft.technicianPrice} onChange={(value) => set('technicianPrice', value)} /></CompactField>
            <CompactField label="Especial"><NumberInput value={draft.specialPrice} onChange={(value) => set('specialPrice', value)} /></CompactField>
            <CompactField label="USD"><NumberInput value={draft.usdPrice} onChange={(value) => set('usdPrice', value)} /></CompactField>
            <CompactField label={draft.id ? 'Stock actual' : 'Stock inicial'}><NumberInput value={draft.id ? draft.stock : draft.initialStock} onChange={(value) => draft.id ? set('stock', value) : set('initialStock', value)} /></CompactField>
            <CompactField label="Stock minimo"><NumberInput value={draft.stockMin} onChange={(value) => set('stockMin', value)} /></CompactField>
            <CompactField label="Stock maximo"><NumberInput value={draft.stockMax} onChange={(value) => set('stockMax', value)} /></CompactField>
            <CompactField label="Unidad"><select id="inventory-unit" value={draft.unit} onChange={(e) => set('unit', e.target.value)} className="input-dark text-sm"><option>Unidad</option><option>Caja</option><option>Kit</option><option>Par</option><option>Yarda</option><option>Metro</option></select></CompactField>
            <CompactField label="ITBIS"><select id="inventory-taxStatus" value={draft.taxStatus} onChange={(e) => set('taxStatus', e.target.value)} className="input-dark text-sm"><option value="no_tax">Sin ITBIS</option><option value="taxed">Con ITBIS</option><option value="exempt">Exento</option></select></CompactField>
            <CompactField label="Proveedor"><select id="inventory-supplierId" value={draft.supplierId} onChange={(e) => set('supplierId', e.target.value)} className="input-dark text-sm">{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></CompactField>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'rgba(255,255,255,.7)' }}>
              <input id="inventory-requiresSerial" type="checkbox" checked={draft.requiresSerial} onChange={(e) => set('requiresSerial', e.target.checked)} />
              Serial / IMEI
            </label>
            {draft.requiresSerial ? <input id="inventory-serialsText" value={draft.serialsText} onChange={(e) => set('serialsText', e.target.value)} className="input-dark flex-1 text-sm" placeholder="Seriales: uno por linea o coma" aria-label="inventory-serialsText" /> : null}
          </div>
        </section>
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: 'var(--line)' }}>
          <ImagePlus className="mx-auto mb-1" size={24} style={{ color: 'rgba(255,255,255,.3)' }} />
          <input id="inventory-image" value={draft.image || ''} onChange={(e) => set('image', e.target.value)} className="input-dark mt-1 text-sm" placeholder="URL imagen" aria-label="inventory-image" />
        </div>
        <div className="space-y-1 rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--line)' }}>
          <PreviewLine label="SKU" value={draft.sku || 'Autogenerado'} />
          <PreviewLine label="Precio" value={currency.format(Number(draft.price || 0))} />
          <PreviewLine label="Costo" value={currency.format(Number(draft.cost || 0))} />
          <PreviewLine label="Stock" value={draft.id ? draft.stock : draft.initialStock} />
          <PreviewLine label="Margen" value={`${Number.isFinite(margin) ? margin.toFixed(1) : '0.0'}%`} />
        </div>
        {touched && Object.keys(errors).length ? (
          <div className="rounded-lg p-2 text-xs" style={{ border: '1px solid rgba(248,113,113,.25)', background: 'rgba(239,68,68,.1)', color: 'rgb(254,202,202)' }}>
            {Object.values(errors).map((error) => <p key={error}>{error}</p>)}
          </div>
        ) : (
          <div className="flex gap-2 rounded-lg p-2 text-xs" style={{ border: '1px solid rgba(52,211,153,.2)', background: 'rgba(16,185,129,.1)', color: 'rgb(167,243,208)' }}>
            <CheckCircle2 size={14} className="shrink-0" />
            <p>Completa nombre y precio de venta.</p>
          </div>
        )}
        <Button className="w-full py-2" icon={saving ? Loader2 : PackagePlus} disabled={saving} onClick={submit}>
          {saving ? 'Guardando...' : draft.id ? 'Actualizar producto' : 'Crear producto'}
        </Button>
      </aside>
    </div>
  )
}

function ProductDetail({ product, movements }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <div className="space-y-3 text-sm">
        <ProductIdentity product={product} large />
        <p className={product.stock <= product.stockMin ? 'rounded-lg p-3' : 'rounded-lg p-3'} style={product.stock <= product.stockMin ? { background: 'rgba(239,68,68,.1)', color: 'rgb(254,202,202)' } : { background: 'rgba(16,185,129,.1)', color: 'rgb(167,243,208)' }}>Stock actual: {product.stock}</p>
        {['sku', 'barcode', 'category', 'brand', 'model', 'location', 'unit', 'taxStatus', 'status'].map((key) => <p key={key} className="rounded-lg bg-white/[0.035] p-2"><b>{key}:</b> {String(product[key] || '-')}</p>)}
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <SerialBox title="Disponibles" items={product.serials || []} />
          <SerialBox title="Vendidos" items={(product.soldSerials || []).map((s) => s.serial || s)} />
          <SerialBox title="Dañados" items={product.damagedSerials || []} />
        </div>
        <div className="h-52 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
          <Bar data={{ labels: movements.slice(0, 12).map((m) => m.date), datasets: [{ label: 'Movimientos', data: movements.slice(0, 12).map((m) => m.quantity), backgroundColor: '#3B82F6' }] }} options={{ maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }} />
        </div>
      </div>
    </div>
  )
}

function ProductIdentity({ product, large }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`${large ? 'h-16 w-16' : 'h-11 w-11'} grid shrink-0 place-items-center rounded-lg`} style={{ background: 'rgba(59,130,246,.15)', color: 'rgb(191,219,254)' }}>
        {product.image ? <img src={product.image} alt="" className="h-full w-full rounded-lg object-cover" /> : <Boxes size={large ? 28 : 20} />}
      </div>
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{product.name}</p>
        <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,.45)' }}>{product.sku || 'Sin SKU'} · {product.barcode || 'Sin barcode'}</p>
      </div>
    </div>
  )
}

function ProductActions({ product, onView, onEdit, onAdjust, onLabel, onDelete }) {
  return (
    <div className="action-cluster">
      <Icon icon={Eye} label="Ver" onClick={() => onView(product)} />
      <Icon icon={Pencil} label="Editar" onClick={() => onEdit(product)} />
      <Icon icon={SlidersHorizontal} label="Stock" onClick={() => onAdjust(product)} />
      <Icon icon={Barcode} label="Etiquetas" onClick={() => onLabel(product)} />
      <Icon icon={Trash2} label="Eliminar" danger onClick={() => onDelete(product)} />
    </div>
  )
}

const LABEL_SIZES = Object.entries(NEW_LABEL_SIZES).filter(([id]) => !['letter','a4','58mm','80mm'].includes(id)).map(([id, dim]) => ({ id, name: dim.name, cols: id === '2x1' ? 4 : id.startsWith('4x') ? 2 : 3 }))
const ALL_PRINT_MODES = [
  { id: 'browser', label: 'PDF vectorial' },
  { id: 'zpl', label: 'ZPL (Zebra, Xprinter)' },
  { id: 'epl', label: 'EPL (Zebra old)' },
  { id: 'tspl', label: 'TSPL (TSC)' },
  { id: 'cpcl', label: 'CPCL (Honeywell)' },
  { id: 'escpos', label: 'ESC/POS (Epson)' },
  { id: 'usb', label: 'ZPL WebUSB' },
  { id: 'escpos-usb', label: 'ESC/POS WebUSB' },
  { id: 'png', label: 'Imagen PNG' },
]

function getSelectedBarcode(product, source, manualCode) {
  const value = source === 'manual'
    ? manualCode
    : source === 'barcode'
      ? product.barcode
      : source === 'sku'
        ? product.sku
        : product.id
  const raw = String(value || '').trim()
  return raw ? sanitizeCode128Value(raw) : ''
}

function getLabelQuantity(product, quantity, mode) {
  const base = mode === 'stock' ? Number(product.stock || 0) : Number(quantity || 1)
  const min = mode === 'stock' ? 0 : 1
  return Math.max(min, Math.min(Math.round(base || 0), 120))
}

function sanitizeFilename(value) {
  return String(value || 'producto').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
}

function fitPdfLines(pdf, text, maxWidth, maxLines) {
  const words = String(text || '').trim().slice(0, 40).split(/\s+/).filter(Boolean)
  const lines = []
  for (const word of words) {
    const current = lines[lines.length - 1] || ''
    const test = current ? current + ' ' + word : word
    if (!current || pdf.getTextWidth(test) <= maxWidth) {
      if (current) lines[lines.length - 1] = test
      else lines.push(test)
      continue
    }
    if (lines.length >= maxLines) break
    lines.push(word)
  }
  if (lines.length > maxLines) lines.length = maxLines
  const full = words.join(' ')
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]
    const shouldEllipsize = index === lines.length - 1 && full !== lines.join(' ')
    while (line.length > 1 && pdf.getTextWidth(line + (shouldEllipsize ? '...' : '')) > maxWidth) line = line.slice(0, -1).trim()
    lines[index] = line + (shouldEllipsize ? '...' : '')
  }
  return lines.length ? lines : ['Producto']
}

function BarcodeLabelPrinter({ product }) {
  const company = useERPStore((state) => state.company)
  const [quantity, setQuantity] = useState(1)
  const [quantityMode, setQuantityMode] = useState('manual')
  const [source, setSource] = useState(product.barcode ? 'barcode' : product.sku ? 'sku' : 'id')
  const [manualCode, setManualCode] = useState('')
  const [labelSize, setLabelSize] = useState(() => LABEL_SIZES.find((size) => size.id === company?.defaultLabelSize) || LABEL_SIZES[0])
  const [showPrice, setShowPrice] = useState(company?.labelShowPrice ?? true)
  const [showSku, setShowSku] = useState(true)
  const [printMode, setPrintMode] = useState(company?.labelPrintMode || 'browser')
  const [zplStatus, setZplStatus] = useState('')
  const [barcodeType, setBarcodeType] = useState('code128')
  const [showDesigner, setShowDesigner] = useState(false)
  const [showProfiles, setShowProfiles] = useState(false)
  const [showMassPrint, setShowMassPrint] = useState(false)
  const [designProfiles, setDesignProfiles] = useState(() => company?.labelProfiles || [])
  const [customDesign, setCustomDesign] = useState(null)
  const code = getSelectedBarcode(product, source, manualCode)
  const qty = getLabelQuantity(product, quantity, quantityMode)
  const labels = Array.from({ length: qty })

  async function handlePrint() {
    const selectedCode = getSelectedBarcode(product, source, manualCode)
    if (!selectedCode) {
      setZplStatus('Error: indique un codigo valido para imprimir.')
      return
    }
    const qty = getLabelQuantity(product, quantity, quantityMode)
    if (qty < 1) {
      setZplStatus('Error: no hay etiquetas para imprimir con la cantidad actual.')
      return
    }
    const opts = { labelSize: labelSize.id, includePrice: showPrice, includeSku: showSku, quantity: qty, barcode: selectedCode, sku: product.sku, dpi: company?.labelDpi || 203 }
    const sku = sanitizeFilename(product.sku || selectedCode || product.id)

    /* ── Validate readability for thermal protocols ── */
    if (!['browser','png'].includes(printMode)) {
      const vr = validateBarcodeReadability(barcodeType, selectedCode)
      if (!vr.valid) {
        setZplStatus('⚠ Codigo invalido: ' + vr.reason + '. Corrija el codigo o use PDF.')
        return
      }
    }

    try {
      /* ── PDF vectorial (jsPDF) ── */
      if (printMode === 'browser') {
        const dim = LABEL_DIMENSIONS[labelSize.id] || LABEL_DIMENSIONS['3x2']
        const mmW = dim.widthIn * 25.4; const mmH = dim.heightIn * 25.4
        const pdf = new jsPDF({ unit: 'mm', format: [mmW, mmH], hotfixes: ['px_scaling'] })
        const margin = mmW * 0.04; const usableW = mmW - margin * 2; const maxY = mmH - margin

        for (let i = 0; i < qty; i++) {
          if (i > 0) pdf.addPage([mmW, mmH])
          let y = margin

          let nameFs = Math.min(mmH * 0.28, 9)
          let priceFs = Math.min(mmH * 0.38, 12)
          let skuFs = nameFs * 0.7
          const maxNameLines = mmH <= 25.4 ? 1 : 2
          let nameH = nameFs * 0.72 * maxNameLines; let skuH = showSku && product.sku ? skuFs * 0.6 : 0; let priceH = (showPrice && Number(product.price || 0) > 0) ? priceFs * 0.65 : 0
          let barH = Math.min(mmH * 0.32, Math.max(6, Math.round(mmH * 0.25)))
          let totalH = nameH + skuH + priceH + barH + margin * 0.5
          let dropSku = false; let dropPrice = false

          if (totalH > maxY) { const s = maxY / totalH; nameFs = Math.max(4, nameFs * s); priceFs = Math.max(5, priceFs * s); skuFs = nameFs * 0.7; barH = Math.max(3, barH * s); nameH = nameFs * 0.65 * maxNameLines; skuH = showSku && product.sku ? skuFs * 0.55 : 0; priceH = priceFs * 0.55; totalH = nameH + skuH + priceH + barH + margin * 0.35 }
          if (totalH > maxY && showSku && product.sku) { dropSku = true; skuH = 0; totalH = nameH + priceH + barH + margin * 0.35 }
          if (totalH > maxY) { dropPrice = true; priceH = 0; totalH = nameH + barH + margin * 0.35 }
          if (totalH > maxY) { nameFs = Math.max(3, nameFs - 1); nameH = nameFs * 0.55 * maxNameLines; barH = Math.max(2, barH - 2); totalH = nameH + barH + margin * 0.25 }

          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(nameFs)
          const nameLines = fitPdfLines(pdf, product.name || 'Producto', usableW, maxNameLines)
          nameLines.forEach((line, index) => pdf.text(line, mmW / 2, y + index * nameFs * 0.58, { align: 'center' }))
          y += nameH

          if (!dropSku && showSku && product.sku) {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(skuFs)
            pdf.text('SKU: ' + product.sku, mmW / 2, y, { align: 'center' }); y += skuH
          }
          if (!dropPrice && showPrice && Number(product.price || 0) > 0) {
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(priceFs)
            pdf.text('RD$ ' + Number(product.price).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','), mmW / 2, y, { align: 'center' }); y += priceH
          }

          const bc = buildCode128Bars(selectedCode)
          const barAvail = usableW > 6 ? usableW - 4 : usableW
          const layout = getBarcodeLayout(bc, barAvail)
          const startX = margin + 2 + Math.max(0, (barAvail - layout.totalWidth) / 2)
          bc.bars.forEach((bar) => {
            const x = startX + layout.quietWidth + bar.x * layout.scale
            const w = Math.max(bar.width * layout.scale, 0.1)
            pdf.rect(Math.round(x * 10) / 10, y + 0.5, Math.round(w * 10) / 10, barH, 'F')
          })
          y += barH + mmH * 0.04

          const codeRemain = maxY - y
          if (codeRemain > 1.5) {
            const codeText = String(selectedCode).slice(0, 24)
            const maxFs = Math.min(mmH * 0.028, codeRemain * 0.8)
            let fs = maxFs
            pdf.setFont('helvetica', 'bold')
            while (fs > 1.5 && pdf.getTextWidth(codeText) > usableW) { fs -= 0.25 }
            pdf.setFontSize(Math.max(1.5, fs))
            pdf.text(codeText, mmW / 2, y + codeRemain * 0.5, { align: 'center' })
          }
        }

        pdf.save('etiquetas.pdf')
        return
      }

      /* ── ZPL ── */
      if (printMode === 'zpl') {
        const design = customDesign || createEmptyDesign(labelSize.id)
        const filledDesign = fillDesignWithProduct(design, product, selectedCode)
        const cal = findProfileCalibration(designProfiles, printMode)
        const zpl = renderDesignToZpl(filledDesign, { ...cal, dpi: opts.dpi })
        let full = ''
        for (let i = 0; i < qty; i++) full += zpl + '\n'
        downloadOutput(full, 'etiqueta-' + sku + '.zpl', 'text/plain')
        setZplStatus('Archivo ZPL descargado'); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── EPL ── */
      if (printMode === 'epl') {
        const design = customDesign || createEmptyDesign(labelSize.id)
        const filledDesign = fillDesignWithProduct(design, product, selectedCode)
        const cal = findProfileCalibration(designProfiles, 'epl')
        const epl = renderDesignToEpl(filledDesign, { ...cal, dpi: opts.dpi })
        downloadOutput(epl, 'etiqueta-' + sku + '.epl', 'text/plain')
        setZplStatus('Archivo EPL descargado'); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── TSPL ── */
      if (printMode === 'tspl') {
        const design = customDesign || createEmptyDesign(labelSize.id)
        const filledDesign = fillDesignWithProduct(design, product, selectedCode)
        const cal = findProfileCalibration(designProfiles, 'tspl')
        const tspl = renderDesignToTspl(filledDesign, { ...cal, dpi: opts.dpi })
        downloadOutput(tspl, 'etiqueta-' + sku + '.tspl', 'text/plain')
        setZplStatus('Archivo TSPL descargado'); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── CPCL ── */
      if (printMode === 'cpcl') {
        const design = customDesign || createEmptyDesign(labelSize.id)
        const filledDesign = fillDesignWithProduct(design, product, selectedCode)
        const cal = findProfileCalibration(designProfiles, 'cpcl')
        const cpcl = renderDesignToCpcl(filledDesign, { ...cal, dpi: opts.dpi })
        downloadOutput(cpcl, 'etiqueta-' + sku + '.cpcl', 'text/plain')
        setZplStatus('Archivo CPCL descargado'); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── ZPL WebUSB ── */
      if (printMode === 'usb') {
        setZplStatus('Conectando impresora USB...')
        const name = await sendToUsbPrinter(generateZPL(product, opts))
        setZplStatus('Impreso en ' + name); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── ESC/POS ── */
      if (printMode === 'escpos') {
        downloadEscposFile(generateESCPOS(product, opts), 'etiqueta-' + sku + '.prn')
        setZplStatus('Archivo ESC/POS descargado'); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── ESC/POS WebUSB ── */
      if (printMode === 'escpos-usb') {
        setZplStatus('Conectando impresora ESC/POS...')
        const name = await sendEscposToUsb(generateESCPOS(product, opts))
        setZplStatus('Impreso en ' + name); setTimeout(() => setZplStatus(''), 3000)
        return
      }

      /* ── PNG ── */
      if (printMode === 'png') {
        const canvas = renderLabelToCanvas(product, opts)
        downloadLabelPng(canvas, 'etiqueta-' + sku + '.png', opts.dpi || 203)
        setZplStatus('Imagen PNG descargada'); setTimeout(() => setZplStatus(''), 3000)
      }
    } catch (error) {
      setZplStatus('Error: ' + error.message)
      if (error.message.includes('WebUSB')) {
        if (printMode === 'usb' || printMode === 'escpos-usb') {
          const fn = printMode === 'usb' ? () => downloadZplFile(generateZPL(product, opts), 'etiqueta-' + sku + '.zpl') : () => downloadEscposFile(generateESCPOS(product, opts), 'etiqueta-' + sku + '.prn')
          fn(); setZplStatus('USB no disponible, archivo descargado como fallback')
        }
      }
    }
  }

  /* ── Helper: fill design template with product data ── */
  function fillDesignWithProduct(design, product, code) {
    return {
      ...design,
      elements: design.elements.map(el => ({
        ...el,
        content: el.type === 'barcode' ? (code || product.barcode || product.sku || product.id || 'SIN-CODIGO') :
                 el.type === 'text' ? (el.content === 'Nombre' ? (product.name || 'Producto') : el.content === 'Precio' ? String(product.price || 0) : el.content) :
                 el.content
      }))
    }
  }

  /* ── Helper: find calibration for profile matching protocol ── */
  function findProfileCalibration(profiles, protocol) {
    const profile = profiles.find(p => p.protocol === protocol)
    return profile?.calibration || {}
  }

  function getPrintModeDesc(mode) {
    const descs = {
      browser: 'PDF vectorial con medidas exactas en mm. Compatible con cualquier impresora.',
      zpl: 'Lenguaje ZPL para Zebra, Xprinter, Rongta, 2connet, Agiler.',
      epl: 'Lenguaje EPL para impresoras Zebra antiguas (LP2824+, GK420).',
      tspl: 'Lenguaje TSPL para TSC, Printronix Auto ID.',
      cpcl: 'Lenguaje CPCL para Honeywell, Citizen, Godex.',
      usb: 'ZPL directo por USB usando WebUSB (Chrome/Edge).',
      escpos: 'ESC/POS para Epson TM, Bixolon, Star Micronics.',
      'escpos-usb': 'ESC/POS directo por USB usando WebUSB (Chrome/Edge).',
      png: 'Descarga imagen PNG a 203 DPI para compartir o imprimir.',
    }
    return descs[mode] || ''
  }

  return (
    <div className="space-y-4">
      <div className="no-print grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_130px_120px_80px_auto_auto]">
        <label><span className="label-dark">Codigo a imprimir</span><select id="label-source" value={source} onChange={(event) => setSource(event.target.value)} className="input-dark"><option value="barcode" disabled={!product.barcode}>Codigo de barras</option><option value="sku" disabled={!product.sku}>SKU</option><option value="id">ID interno</option><option value="manual">Manual</option></select></label>
        <label><span className="label-dark">Tamaño</span><select id="label-size" value={labelSize.id} onChange={(event) => setLabelSize(LABEL_SIZES.find((s) => s.id === event.target.value) || LABEL_SIZES[0])} className="input-dark">{LABEL_SIZES.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select></label>
        <label><span className="label-dark">Cantidad</span><input id="label-quantity" type="number" min="1" max="120" value={quantityMode === 'stock' ? qty : quantity} onChange={(event) => setQuantity(event.target.value)} disabled={quantityMode === 'stock'} className="input-dark" /></label>
        <label className="flex items-center gap-2 pt-6 text-sm"><input id="label-showPrice" type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Precio</label>
        <label><span className="label-dark">Metodo</span><select id="label-printMode" value={printMode} onChange={(event) => setPrintMode(event.target.value)} className="input-dark">{ALL_PRINT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <Button icon={Printer} variant="primary" className="self-end" onClick={handlePrint} disabled={!code || qty < 1}>
          {printMode === 'browser' ? 'Imprimir' : printMode === 'usb' || printMode === 'escpos-usb' ? 'Enviar a USB' : 'Descargar'}
        </Button>
      </div>
      <div className="no-print flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {source === 'manual' ? <label className="flex items-center gap-1"><span className="text-xs text-white/50">Codigo manual</span><input id="label-manualCode" value={manualCode} onChange={(event) => setManualCode(event.target.value)} className="input-dark w-36" placeholder="Escanee o escriba" /></label> : <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)' }}><span className="block text-xs font-bold uppercase text-white/40">Codigo real</span><b className="font-mono">{code || 'SIN-CODIGO'}</b></div>}
          <label className="flex items-center gap-1"><span className="text-xs text-white/50">Cantidad</span><select id="label-quantityMode" value={quantityMode} onChange={(event) => setQuantityMode(event.target.value)} className="input-dark w-28"><option value="manual">Manual</option><option value="stock">Automatica x stock</option></select></label>
          <label className="flex items-center gap-1 pt-5 text-sm"><input id="label-showSku" type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} /> SKU</label>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setShowDesigner(true)} className="rounded bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20" title="Disenar etiqueta personalizada">Disenar</button>
          <button onClick={() => setShowProfiles(true)} className="rounded bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20" title="Perfiles de impresora">Perfiles</button>
          <button onClick={() => setShowMassPrint(true)} className="rounded bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20" title="Impresion masiva">Masiva</button>
        </div>
      </div>
      {zplStatus && <p className="text-sm text-emerald-300">{zplStatus}</p>}
      {!code ? <p className="text-sm text-amber-300">Seleccione un codigo existente o use el modo manual.</p> : null}
      {quantityMode === 'stock' && qty === 0 ? <p className="text-sm text-amber-300">El producto no tiene stock disponible para generar etiquetas automaticas.</p> : null}
      <div className="mt-2 text-xs text-white/40">{getPrintModeDesc(printMode)}</div>
      <div className={`label-grid grid gap-2 ${labelSize.id === '2x1' ? 'grid-cols-4' : labelSize.id === '4x2' || labelSize.id === '4x3' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {labels.map((_, index) => (
          <div key={index} className="label-item flex flex-col items-center justify-center rounded border border-slate-300 bg-white p-2 text-center text-slate-950 print:break-inside-avoid">
            <p className="w-full truncate text-xs font-black leading-tight">{product.name}</p>
            {showSku && product.sku && <p className="w-full truncate text-[10px] font-semibold leading-tight">{product.sku}</p>}
            {showPrice && Number(product.price || 0) > 0 && (
              <p className="w-full truncate text-sm font-black text-slate-950">{currency.format(Number(product.price))}</p>
            )}
            <BarcodeSvg value={code} />
            <p className="mt-[2px] w-full truncate font-mono text-[10px] font-black tracking-wide">{code || 'SIN-CODIGO'}</p>
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}
      {showDesigner && (
        <LabelDesigner
          initialDesign={customDesign}
          onSave={(design) => { setCustomDesign(design); setShowDesigner(false); setZplStatus('Diseno guardado') }}
          onClose={() => setShowDesigner(false)}
          dpi={company?.labelDpi || 203}
        />
      )}
      {showProfiles && (
        <LabelPrinterProfileDialog
          design={customDesign || createEmptyDesign(labelSize.id)}
          profiles={designProfiles}
          onSave={(profiles) => { setDesignProfiles(profiles); setShowProfiles(false); setZplStatus('Perfiles guardados') }}
          onClose={() => setShowProfiles(false)}
        />
      )}
      {showMassPrint && (
        <LabelMassPrintDialog
          products={[product]}
          design={customDesign || createEmptyDesign(labelSize.id)}
          printerProfile={designProfiles.find(p => p.protocol === printMode)}
          onClose={() => setShowMassPrint(false)}
        />
      )}
    </div>
  )
}

function BarcodeSvg({ value, height = 32, type = 'code128' }) {
  const fn = type === 'ean13' ? buildEAN13Bars : type === 'upc' ? buildUPABars : buildCode128Bars
  const barcode = fn(value)
  if (!barcode || !barcode.bars) return <div className="text-[8px] text-red-400">Error</div>
  const quiet = 10
  const width = barcode.width + quiet * 2
  return (
    <svg viewBox={`0 0 ${width} ${height + 6}`} role="img" aria-label={`Codigo ${barcode.text}`} shapeRendering="crispEdges" className="mx-auto w-full max-w-[220px] bg-white" style={{ height: `${height + 6}px` }}>
      {barcode.bars.map((bar, index) => <rect key={`${bar.x}-${index}`} x={quiet + bar.x} y="3" width={Math.max(bar.width, 1)} height={height} fill="#111827" />)}
    </svg>
  )
}

function InventoryEnterpriseCenter({ insights, movements, entries }) {
  const [tab, setTab] = useState('alerts')
  const tabs = [
    ['alerts', 'Alertas', AlertTriangle],
    ['kardex', 'Kardex', Activity],
    ['valuation', 'Valorizacion', Layers3],
    ['rotation', 'Rotacion', TrendingUp],
    ['purchases', 'Compras', Truck],
  ]
  return (
    <section>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase" style={{ color: 'rgb(191,219,254)' }}><Layers3 size={15} /> Inventario empresarial</p>
          <h2 className="mt-1 font-display text-2xl font-bold">Centro de control de stock, kardex y reposicion</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Valorizacion, alertas, entradas, salidas y productos sin rotacion con tablas accionables y carga ligera.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[560px]">
          <InventoryMetric title="Costo promedio" value={currency.format(insights.averageCost)} detail="Promedio activos" />
          <InventoryMetric title="Valor al costo" value={currency.format(insights.totalCost)} detail="Inventario activo registrado" />
          <InventoryMetric title="Sin rotacion" value={insights.noRotation.length} detail="Sin venta o movimiento reciente" tone={insights.noRotation.length ? 'danger' : ''} />
        </div>
      </div>
      <div className="no-print mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-extrabold transition ${tab === id ? 'border-blue-300/40 bg-blue-500/20 text-white shadow-lg shadow-blue-950/20' : 'border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'alerts' ? <InventoryAlertPanel insights={insights} /> : null}
        {tab === 'kardex' ? <DataTable data={movements} columns={kardexColumns} initialPageSize={25} emptyText="Sin movimientos de inventario." searchPlaceholder="Buscar producto, serial, documento o tipo..." /> : null}
        {tab === 'valuation' ? <DataTable data={insights.valuationRows} columns={valuationColumns} initialPageSize={25} emptyText="No hay productos valorizados." searchPlaceholder="Buscar producto, categoria o SKU..." /> : null}
        {tab === 'rotation' ? <InventoryRotationPanel insights={insights} /> : null}
        {tab === 'purchases' ? <DataTable data={entries} columns={purchaseColumns} initialPageSize={15} emptyText="Sin entradas o compras registradas." searchPlaceholder="Buscar proveedor, referencia o producto..." /> : null}
      </div>
    </section>
  )
}

function InventoryAlertPanel({ insights }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <div className="space-y-3">
        {insights.smartAlerts.length ? insights.smartAlerts.map((alert) => (
          <div key={alert.id} className={`rounded-xl border p-4 ${alert.tone === 'danger' ? 'border-red-400/25 bg-red-500/10 text-red-100' : 'border-amber-400/25 bg-amber-500/10 text-amber-100'}`}>
            <p className="flex items-center gap-2 font-bold"><AlertTriangle size={17} /> {alert.title}</p>
            <p className="mt-1 text-sm opacity-75">{alert.detail}</p>
          </div>
        )) : <p className="rounded-xl border p-4 text-sm font-bold" style={{ borderColor: 'rgba(52,211,153,.2)', background: 'rgba(16,185,129,.1)', color: 'rgb(167,243,208)' }}>Inventario sin alertas criticas.</p>}
      </div>
      <DataTable data={insights.reorderRows} columns={reorderColumns} initialPageSize={12} emptyText="Sin productos para reponer." searchPlaceholder="Buscar reposicion..." />
    </div>
  )
}

function InventoryRotationPanel({ insights }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section>
        <h3 className="mb-3 font-display text-xl font-bold">Productos top</h3>
        <DataTable data={insights.topProducts} columns={rotationColumns} initialPageSize={10} emptyText="Aun no hay ventas para ranking." />
      </section>
      <section>
        <h3 className="mb-3 font-display text-xl font-bold">Sin rotacion</h3>
        <DataTable data={insights.noRotation} columns={noRotationColumns} initialPageSize={10} emptyText="Todos los productos tienen movimiento reciente." />
      </section>
    </div>
  )
}

function InventoryMetric({ title, value, detail, tone }) {
  return <div className="summary-chip"><span className="summary-chip-label">{title}</span><span className="summary-chip-value">{value}</span><p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,.45)' }}>{detail}</p></div>
}

function InventoryCategoryStrip({ rows }) {
  if (!rows.length) return null
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {rows.slice(0, 4).map((row) => (
        <div key={row.category} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.03)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold">{row.category}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,.45)' }}>{row.count} producto(s) · {row.units} unidad(es)</p>
            </div>
            <span className="shrink-0 text-xs font-black" style={{ color: 'rgb(167,243,208)' }}>{currency.format(row.value)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${row.share}%`, background: 'var(--color-income)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CompactField({ label, children, error, className }) {
  return <label className={className}><span className="label-dark text-xs">{label}</span>{children}{error ? <span className="mt-0.5 block text-xs font-bold" style={{ color: 'rgb(252,165,165)' }}>{error}</span> : null}</label>
}
function NumberInput({ value, onChange, id, name }) {
  return <input type="number" min="0" step="0.01" value={value ?? 0} onChange={(event) => onChange(Number(event.target.value))} className="input-dark" id={id} name={name} />
}
function PreviewLine({ label, value }) {
  return <div className="flex justify-between gap-3"><span style={{ color: 'rgba(255,255,255,.45)' }}>{label}</span><b className="text-white">{value}</b></div>
}
function Icon({ icon: IconSvg, onClick, label, danger }) {
  return <button type="button" title={label} onClick={onClick} className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border p-2 ${danger ? 'border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20' : 'border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/[0.08]'}`}><IconSvg size={15} /></button>
}
function SerialBox({ title, items }) {
  return <div className="rounded-lg p-3" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.035)' }}><p className="font-bold">{title}</p><div className="premium-scroll mt-2 max-h-32 overflow-auto text-xs" style={{ color: 'rgba(255,255,255,.5)' }}>{items.length ? items.map((item, index) => <p key={`${item}-${index}`}>{item}</p>) : 'Sin registros'}</div></div>
}
function validateProduct(product) {
  const errors = getProductErrors(product)
  return Object.values(errors)[0] || ''
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function scoreInventoryProduct(product, query) {
  if (!query) return 1
  const fields = [
    product.name,
    product.sku,
    product.barcode,
    product.model,
    product.brand,
    product.category,
    product.description,
    ...(product.serials || []),
  ].map(normalize)
  return fields.reduce((score, field) => {
    if (!field) return score
    if (field === query) return score + 100
    if (field.startsWith(query)) return score + 70
    if (field.includes(query)) return score + 40
    if (query.split(/\s+/).every((part) => field.includes(part))) return score + 25
    return score
  }, 0)
}
function getProductErrors(product) {
  const errors = {}
  const stock = Number(product.id ? product.stock : product.initialStock)
  const serials = String(product.serialsText || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
  if (!product.name?.trim() || product.name.trim().length < 2) errors.name = 'El nombre debe tener minimo 2 caracteres.'
  if (!product.category?.trim()) errors.category = 'La categoria es obligatoria.'
  if (Number(product.cost || 0) < 0) errors.cost = 'El costo no puede ser negativo.'
  if (Number(product.price || 0) <= 0) errors.price = 'El precio de venta debe ser mayor que cero.'
  if (product.requiresSerial && stock > 0 && serials.length !== stock) errors.serialsText = `Registra ${stock} serial(es)/IMEI o cambia el stock.`
  return errors
}

function buildInventoryRows(products) {
  return products.map((product) => {
    const stock = Number(product.stock || 0)
    const cost = Number(product.cost || 0)
    const price = Number(product.price || 0)
    return {
      categoria: product.category || '',
      producto: product.name || '',
      sku: product.sku || '',
      stock,
      costo: cost,
      precio: price,
      valorInventario: cost * stock,
      seriales: product.requiresSerial ? (product.serials || []).join(', ') : '',
    }
  })
}

function buildCategorySummary(products) {
  const totalValue = products.reduce((sum, product) => sum + Number(product.cost || 0) * Number(product.stock || 0), 0)
  const rows = new Map()
  products.forEach((product) => {
    const category = product.category || 'Sin categoria'
    const current = rows.get(category) || { category, count: 0, units: 0, value: 0, share: 0 }
    const stock = Number(product.stock || 0)
    current.count += 1
    current.units += stock
    current.value += Number(product.cost || 0) * stock
    rows.set(category, current)
  })
  return [...rows.values()]
    .map((row) => ({ ...row, share: totalValue > 0 ? Math.max(4, Math.round((row.value / totalValue) * 100)) : 4 }))
    .sort((left, right) => right.value - left.value || right.count - left.count)
}

function buildInventoryInsights({ products, movements, invoices, entries, suppliers }) {
  const now = Date.now()
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
  const sold = new Map()
  invoices
    .filter((invoice) => !['draft', 'voided', 'anulada', 'deleted', 'cancelled'].includes(String(invoice.status || '').toLowerCase()))
    .forEach((invoice) => {
      ;(invoice.items || []).forEach((item) => {
        const current = sold.get(item.productId) || { productId: item.productId, Producto: item.name || '', SKU: item.sku || '', Cantidad: 0, Ingresos: 0, Ganancia: 0 }
        const quantity = Number(item.quantity || 0)
        const revenue = Number(item.net || 0) + Number(item.tax || 0)
        current.Cantidad += quantity
        current.Ingresos += revenue
        current.Ganancia += Number(item.net || 0) - Number(item.cost || 0) * quantity
        sold.set(item.productId, current)
      })
    })
  const movementByProduct = new Map()
  movements.forEach((movement) => {
    const date = parseDate(movement.createdAt || movement.date)
    const current = movementByProduct.get(movement.productId) || { count: 0, last: 0 }
    current.count += 1
    current.last = Math.max(current.last, date.getTime())
    movementByProduct.set(movement.productId, current)
  })
  const valuationRows = products.map((product) => {
    const stock = Number(product.stock || 0)
    const cost = Number(product.cost || 0)
    const relatedEntries = entries.filter((entry) => (entry.items || []).some((item) => item.productId === product.id))
    const lastEntry = relatedEntries[0]
    return {
      Producto: product.name || '',
      SKU: product.sku || '',
      Categoria: product.category || '',
      Stock: stock,
      Minimo: Number(product.stockMin || 0),
      Costo: cost,
      ValorCosto: cost * stock,
      Proveedor: supplierMap.get(product.supplierId) || lastEntry?.supplierName || 'Sin proveedor',
    }
  })
  const reorderRows = products
    .filter((product) => Number(product.stock || 0) <= Number(product.stockMin || 0))
    .map((product) => {
      const max = Number(product.stockMax || 0)
      const min = Number(product.stockMin || 0)
      const stock = Number(product.stock || 0)
      const suggested = Math.max(max ? max - stock : min * 2 - stock, 1)
      return {
        Producto: product.name || '',
        SKU: product.sku || '',
        Stock: stock,
        Minimo: min,
        FaltanteMinimo: Math.max(min - stock, 0),
        ReposicionMaxima: suggested,
        Proveedor: supplierMap.get(product.supplierId) || 'Sin proveedor',
      }
    })
  const noRotation = products
    .map((product) => {
      const movement = movementByProduct.get(product.id)
      const days = movement?.last ? Math.floor((now - movement.last) / 86400000) : 999
      return {
        Producto: product.name || '',
        SKU: product.sku || '',
        Categoria: product.category || '',
        Stock: Number(product.stock || 0),
        DiasSinMovimiento: days,
        ValorCosto: Number(product.cost || 0) * Number(product.stock || 0),
      }
    })
    .filter((row) => row.Stock > 0 && row.DiasSinMovimiento >= 30)
    .sort((left, right) => right.DiasSinMovimiento - left.DiasSinMovimiento)
  const topProducts = [...sold.values()].sort((left, right) => right.Ingresos - left.Ingresos).slice(0, 50)
  const totalCost = valuationRows.reduce((sum, row) => sum + row.ValorCosto, 0)
  const critical = reorderRows.filter((row) => row.Stock <= 0).length
  const smartAlerts = [
    critical ? { id: 'out', tone: 'danger', title: 'Productos agotados', detail: `${critical} producto(s) sin disponibilidad requieren reposicion inmediata.` } : null,
    reorderRows.length ? { id: 'low', tone: 'warning', title: 'Stock critico', detail: `${reorderRows.length} producto(s) estan por debajo del minimo configurado.` } : null,
    noRotation.length ? { id: 'rotation', tone: 'warning', title: 'Capital inmovilizado', detail: `${noRotation.length} producto(s) tienen mas de 30 dias sin movimiento.` } : null,
  ].filter(Boolean)
  return {
    averageCost: products.length ? totalCost / products.length : 0,
    totalCost,
    valuationRows,
    reorderRows,
    noRotation,
    topProducts,
    smartAlerts,
  }
}

function sortInventory(products, sortBy) {
  const sorted = [...products]
  if (sortBy === 'stock' || sortBy === 'quantity') return sorted.sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0))
  if (sortBy === 'value') return sorted.sort((a, b) => (Number(b.cost || 0) * Number(b.stock || 0)) - (Number(a.cost || 0) * Number(a.stock || 0)))
  return sorted.sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')))
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

const kardexColumns = [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.createdAt || row.original.date) },
  { header: 'Tipo', accessorKey: 'type' },
  { header: 'Producto', accessorKey: 'productName' },
  { header: 'Documento', accessorKey: 'documentNumber' },
  { header: 'Antes', accessorKey: 'quantityBefore' },
  { header: 'Despues', accessorKey: 'quantityAfter' },
  { header: 'Cantidad', cell: ({ row }) => row.original.signedQuantity ?? row.original.quantity },
  { header: 'Costo', cell: ({ row }) => currency.format(row.original.cost || 0) },
  { header: 'Seriales', cell: ({ row }) => (row.original.serials || []).join(', ') },
]

const valuationColumns = [
  { header: 'Producto', accessorKey: 'Producto' },
  { header: 'SKU', accessorKey: 'SKU' },
  { header: 'Categoria', accessorKey: 'Categoria' },
  { header: 'Stock', accessorKey: 'Stock' },
  { header: 'Costo', cell: ({ row }) => currency.format(row.original.Costo || 0) },
  { header: 'Valor costo', cell: ({ row }) => currency.format(row.original.ValorCosto || 0) },
  { header: 'Proveedor', accessorKey: 'Proveedor' },
]

const reorderColumns = [
  { header: 'Producto', accessorKey: 'Producto' },
  { header: 'SKU', accessorKey: 'SKU' },
  { header: 'Stock', accessorKey: 'Stock' },
  { header: 'Minimo', accessorKey: 'Minimo' },
  { header: 'Faltante minimo', accessorKey: 'FaltanteMinimo' },
  { header: 'Reposicion maxima', accessorKey: 'ReposicionMaxima' },
  { header: 'Proveedor', accessorKey: 'Proveedor' },
]

const rotationColumns = [
  { header: 'Producto', accessorKey: 'Producto' },
  { header: 'SKU', accessorKey: 'SKU' },
  { header: 'Cantidad', accessorKey: 'Cantidad' },
  { header: 'Ingresos', cell: ({ row }) => currency.format(row.original.Ingresos || 0) },
  { header: 'Ganancia', cell: ({ row }) => currency.format(row.original.Ganancia || 0) },
]

const noRotationColumns = [
  { header: 'Producto', accessorKey: 'Producto' },
  { header: 'SKU', accessorKey: 'SKU' },
  { header: 'Categoria', accessorKey: 'Categoria' },
  { header: 'Stock', accessorKey: 'Stock' },
  { header: 'Dias sin mov.', accessorKey: 'DiasSinMovimiento' },
  { header: 'Valor costo', cell: ({ row }) => currency.format(row.original.ValorCosto || 0) },
]

const purchaseColumns = [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date || row.original.createdAt) },
  { header: 'Proveedor', accessorKey: 'supplierName' },
  { header: 'Factura prov.', accessorKey: 'supplierInvoice' },
  { header: 'Referencia', accessorKey: 'reference' },
  { header: 'Productos', cell: ({ row }) => (row.original.items || []).map((item) => `${item.productName} x${item.quantity}`).join(', ') },
  { header: 'Total', cell: ({ row }) => currency.format(row.original.total || 0) },
]
