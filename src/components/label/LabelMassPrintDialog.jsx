import { useState, useMemo } from 'react'
import { validateBarcodeReadability, generateBarcodeBars, getLabelSize } from '../../lib/labelEngine.js'
import { renderDesignToPdf, renderDesignToZpl, renderDesignToEscpos, downloadOutput, createLabelPdfAsync } from '../../lib/labelOutput.js'

export default function LabelMassPrintDialog({ products, design, printerProfile, onClose }) {
  const [selectedProducts, setSelectedProducts] = useState(() => products.map(p => ({ ...p, _selected: true, _qty: p.stock || 1 })))
  const [status, setStatus] = useState('')

  const validationResults = useMemo(() => {
    return selectedProducts.filter(p => p._selected).map(p => {
      const code = p.barcode || p.sku || p.id || ''
      return { product: p, ...validateBarcodeReadability(design.elements.find(el => el.type === 'barcode')?.barcodeType || 'code128', code) }
    })
  }, [selectedProducts, design])

  const invalidCount = validationResults.filter(r => !r.valid).length

  function toggleProduct(id) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, _selected: !p._selected } : p))
  }

  function setQty(id, qty) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, _qty: Math.max(1, Math.min(999, Number(qty) || 1)) } : p))
  }

  function buildProductDesign(product) {
    return {
      ...design,
      elements: design.elements.map(el => ({
        ...el,
        content: el.type === 'barcode' ? (product.barcode || product.sku || product.id || 'SIN-CODIGO') :
                 el.type === 'text' ? (el.content === 'Nombre' ? product.name : el.content === 'Precio' ? String(product.price || 0) : el.content) :
                 el.content
      }))
    }
  }

  async function handlePrintPdf() {
    setStatus('Generando PDF...')
    try {
      const { default: jsPDF } = await import('jspdf')
      const selected = selectedProducts.filter(p => p._selected)
      const cal = { ...printerProfile?.calibration, dpi: printerProfile?.dpi || 203 }
      const size = getLabelSize(design.labelSizeId)
      const labelW = Math.round((size.w * (cal.scaleX || 1)) * 100) / 100
      const labelH = Math.round((size.h * (cal.scaleY || 1)) * 100) / 100
      const orientation = labelW >= labelH ? 'landscape' : 'portrait'
      const doc = new jsPDF({ unit: 'mm', format: [labelW, labelH], orientation, hotfixes: ['px_scaling'] })
      let first = true
      let totalQty = 0
      for (const product of selected) {
        for (let i = 0; i < product._qty; i++) {
          if (!first) doc.addPage([labelW, labelH])
          first = false
          const pd = buildProductDesign(product)
          renderDesignToPdf(doc, pd, cal)
          totalQty++
        }
      }
      doc.save('etiquetas-masivas.pdf')
      setStatus(`${totalQty} etiqueta(s) PDF descargada(s)`)
    } catch (err) { setStatus('Error: ' + err.message) }
  }

  function handlePrintZpl() {
    setStatus('Generando ZPL...')
    try {
      let allZpl = ''
      selectedProducts.filter(p => p._selected).forEach(product => {
        for (let i = 0; i < product._qty; i++) {
          const pd = buildProductDesign(product)
          allZpl += renderDesignToZpl(pd, { ...printerProfile?.calibration, dpi: printerProfile?.dpi || 203 }) + '\n'
        }
      })
      downloadOutput(allZpl, 'etiquetas-masivas.zpl', 'text/plain')
      setStatus('ZPL descargado')
    } catch (err) { setStatus('Error: ' + err.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-slate-800 p-5 text-sm text-white/90 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Impresion masiva de etiquetas</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">&times;</button>
        </div>

        <div className="mb-4 rounded bg-slate-700/50 p-3 text-xs">
          {invalidCount > 0 ? (
            <p className="text-amber-300">⚠ {invalidCount} producto(s) tienen codigos que podrian no ser legibles.</p>
          ) : (
            <p className="text-emerald-300">✓ Todos los codigos superaron la validacion de legibilidad</p>
          )}
          <p className="mt-1 text-white/50">{selectedProducts.filter(p => p._selected).length} producto(s) seleccionados</p>
        </div>

        <div className="mb-4 max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-white/50">
              <th className="w-8 p-1"><input id="mass-print-select-all" type="checkbox" checked={selectedProducts.every(p => p._selected)} onChange={() => {
                const all = !selectedProducts.every(p => p._selected)
                setSelectedProducts(prev => prev.map(p => ({ ...p, _selected: all })))
              }} className="accent-blue-500" aria-label="mass-print-select-all" /></th>
              <th className="p-1">Producto</th>
              <th className="p-1">Codigo</th>
              <th className="w-16 p-1">Lectura</th>
              <th className="w-20 p-1">Cantidad</th>
            </tr></thead>
            <tbody>
              {selectedProducts.map(p => {
                const vr = validationResults.find(r => r.product.id === p.id)
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="p-1"><input id={`mass-print-select-${p.id}`} type="checkbox" checked={p._selected} onChange={() => toggleProduct(p.id)} className="accent-blue-500" aria-label={`mass-print-select-${p.id}`} /></td>
                    <td className="p-1 truncate max-w-[200px]">{p.name || 'Producto'}</td>
                    <td className="p-1 font-mono text-white/60">{p.barcode || p.sku || p.id}</td>
                    <td className="p-1">{vr ? (vr.valid ? <span className="text-emerald-400">✓</span> : <span className="text-amber-400" title={vr.reason}>⚠</span>) : '-'}</td>
                    <td className="p-1"><input id={`mass-print-qty-${p.id}`} type="number" min="1" max="999" value={p._qty} onChange={e => setQty(p.id, e.target.value)} className="w-16 rounded border border-white/20 bg-slate-700 px-1 py-0.5 text-white" aria-label={`mass-print-qty-${p.id}`} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handlePrintPdf} disabled={invalidCount > 0} className={`flex-1 rounded py-2 text-sm font-bold text-white ${invalidCount > 0 ? 'bg-white/10 text-white/30' : 'bg-blue-600 hover:bg-blue-500'}`}>
            Descargar PDF
          </button>
          <button type="button" onClick={handlePrintZpl} disabled={invalidCount > 0} className={`flex-1 rounded py-2 text-sm font-bold text-white ${invalidCount > 0 ? 'bg-white/10 text-white/30' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
            Descargar ZPL
          </button>
          <button type="button" onClick={onClose} className="rounded bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">Cerrar</button>
        </div>

        {status && <p className="mt-2 text-center text-xs text-white/50">{status}</p>}
      </div>
    </div>
  )
}
