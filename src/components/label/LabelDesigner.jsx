import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createEmptyDesign, createLabelElement, validateDesign, generateBarcodeBars, getLabelSize, LABEL_SIZES, ELEMENT_TYPES } from '../../lib/labelEngine.js'
import { renderDesignToPdf, createLabelPdfAsync, renderDesignToA4Grid } from '../../lib/labelOutput.js'

export default function LabelDesigner({ initialDesign, onSave, onClose, calibration, dpi = 203 }) {
  const [design, setDesign] = useState(() => initialDesign || createEmptyDesign('3x2'))
  const [selectedId, setSelectedId] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [resizing, setResizing] = useState(null)
  const [zoom, setZoom] = useState(2)
  const [exportModal, setExportModal] = useState(null) // { type: 'single'|'sheet', quantity: 1 }
  const previewRef = useRef(null)

  const size = getLabelSize(design.labelSizeId)
  const pxPerMm = zoom * (dpi / 25.4)
  const labelW = size.w * pxPerMm
  const labelH = size.h * pxPerMm
  const selectedEl = design.elements.find(e => e.id === selectedId)

  function addElement(type) {
    const el = createLabelElement(type, {
      x: 5, y: 5, width: design.width - 10, height: type === 'barcode' ? 30 : 10,
      content: type === 'text' ? 'Texto' : '123456',
      barcodeType: type === 'barcode' ? 'code128' : undefined,
      fontSize: type === 'text' ? 8 : 4,
    })
    setDesign(s => ({ ...s, elements: [...s.elements, el] }))
    setSelectedId(el.id)
  }

  function updateElement(id, patch) {
    setDesign(s => ({ ...s, elements: s.elements.map(e => e.id === id ? { ...e, ...patch } : e) }))
  }

  function deleteElement(id) {
    setDesign(s => ({ ...s, elements: s.elements.filter(e => e.id !== id) }))
    if (selectedId === id) setSelectedId(null)
  }

  function moveToFront(id) {
    setDesign(s => {
      const el = s.elements.find(e => e.id === id)
      if (!el) return s
      return { ...s, elements: [...s.elements.filter(e => e.id !== id), el] }
    })
  }

  const handleMouseDown = useCallback((e, elId) => {
    if (e.target.closest('.el-handle')) return
    e.preventDefault(); e.stopPropagation()
    const rect = previewRef.current.getBoundingClientRect()
    const el = design.elements.find(el => el.id === elId)
    if (!el) return
    const startX = (e.clientX - rect.left) / pxPerMm
    const startY = (e.clientY - rect.top) / pxPerMm
    setDragging({ id: elId, startElX: el.x, startElY: el.y, startMouseX: startX, startMouseY: startY })
    setSelectedId(elId)
  }, [design.elements, pxPerMm])

  const handleResizeStart = useCallback((e, elId, corner) => {
    e.preventDefault(); e.stopPropagation()
    const rect = previewRef.current.getBoundingClientRect()
    const el = design.elements.find(el => el.id === elId)
    if (!el) return
    const startX = (e.clientX - rect.left) / pxPerMm
    const startY = (e.clientY - rect.top) / pxPerMm
    setResizing({ id: elId, corner, startElX: el.x, startElY: el.y, startElW: el.width, startElH: el.height, startMouseX: startX, startMouseY: startY })
  }, [design.elements, pxPerMm])

  useEffect(() => {
    if (!dragging && !resizing) return
    function onMouseMove(e) {
      const rect = previewRef.current.getBoundingClientRect()
      const mx = (e.clientX - rect.left) / pxPerMm
      const my = (e.clientY - rect.top) / pxPerMm
      if (dragging) {
        const dx = mx - dragging.startMouseX; const dy = my - dragging.startMouseY
        updateElement(dragging.id, { x: Math.max(0, dragging.startElX + dx), y: Math.max(0, dragging.startElY + dy) })
      }
      if (resizing) {
        const dx = mx - resizing.startMouseX; const dy = my - resizing.startMouseY; const c = resizing.corner
        let { x, y, width, height } = resizing
        if (c.includes('e')) { width = Math.max(5, resizing.startElW + dx) }
        if (c.includes('w')) { x = Math.max(0, resizing.startElX + dx); width = Math.max(5, resizing.startElW - dx) }
        if (c.includes('s')) { height = Math.max(3, resizing.startElH + dy) }
        if (c.includes('n')) { y = Math.max(0, resizing.startElY + dy); height = Math.max(3, resizing.startElH - dy) }
        updateElement(resizing.id, { x, y, width, height })
      }
    }
    function onMouseUp() { setDragging(null); setResizing(null) }
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [dragging, resizing, pxPerMm])

  /* Render barcode SVG — viewBox en unidades de módulos (CORREGIDO) */
  function renderBarcodeSvg(el) {
    const bc = generateBarcodeBars(el.barcodeType || 'code128', el.content)
    if (!bc || !bc.bars) return null
    const quiet = 5
    const barHeightUnits = 100
    const totalMod = bc.width + quiet * 2
    return (
      <svg viewBox={`0 0 ${totalMod} ${barHeightUnits}`} shapeRendering="crispEdges" preserveAspectRatio="none" className="w-full h-full" style={{ display: 'block' }}>
        {bc.bars.map((bar, i) => (
          <rect key={i} x={quiet + bar.x} y="0" width={Math.max(bar.width, 1)} height={barHeightUnits} fill="#111827" />
        ))}
      </svg>
    )
  }

  async function handleExportPdf(type) {
    if (!exportModal) return
    const quantity = exportModal.quantity || 1
    try {
      if (exportModal.type === 'single') {
        const doc = await createLabelPdfAsync(design, calibration, quantity)
        doc.save('etiqueta.pdf')
      } else {
        const doc = await renderDesignToA4Grid(design, calibration, quantity)
        doc.save('etiquetas-hoja.pdf')
      }
    } catch (err) {
      alert('Error al generar PDF: ' + err.message)
    }
    setExportModal(null)
  }

  const validation = validateDesign(design)
  const RULER_SIZE = 20
  const totalPreviewW = RULER_SIZE + labelW
  const totalPreviewH = RULER_SIZE + labelH

  return (
    <div className="fixed inset-0 z-50 flex bg-black/70" style={{ backdropFilter: 'blur(2px)' }}>
      {/* Toolbar */}
      <div className="flex w-12 flex-col items-center gap-2 border-r border-white/10 bg-slate-900 p-2">
        <button title="Texto" onClick={() => addElement('text')} className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-xs font-bold text-white hover:bg-white/20">T</button>
        <button title="Codigo de barras" onClick={() => addElement('barcode')} className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-xs font-bold text-white hover:bg-white/20">|||</button>
        <button title="QR" onClick={() => addElement('qr')} className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-xs font-bold text-white hover:bg-white/20">QR</button>
        <button title="Rectangulo" onClick={() => addElement('rect')} className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-xs font-bold text-white hover:bg-white/20">[]</button>
        <div className="mt-2 border-t border-white/10 pt-2">
          <button title="Exportar PDF" onClick={() => setExportModal({ type: 'single', quantity: 1 })} className="flex h-9 w-9 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white hover:bg-blue-500">PDF</button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex flex-1 flex-col overflow-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-xs text-white/60">
          <span>Zoom:</span>
          <input id="designer-zoom" type="range" min="0.5" max="5" step="0.1" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="w-24" aria-label="designer-zoom" />
          <span>{zoom.toFixed(1)}x</span>
          <span className="ml-4 text-white/40">{size.name} ({size.w}×{size.h} mm)</span>
          {!validation.valid && <span className="ml-4 text-amber-300">⚠ {validation.errors[0]}</span>}
        </div>

        <div className="relative self-center" style={{ width: totalPreviewW, height: totalPreviewH }}>
          {/* Top ruler */}
          <svg className="absolute left-0 top-0" width={totalPreviewW} height={RULER_SIZE} style={{ overflow: 'visible' }}>
            {Array.from({ length: Math.ceil(size.w) + 1 }).map((_, i) => {
              const xPx = RULER_SIZE + i * pxPerMm
              return <React.Fragment key={i}>
                {i % 10 === 0 ? <line x1={xPx} y1={RULER_SIZE - 8} x2={xPx} y2={RULER_SIZE} stroke="#666" strokeWidth="0.5" /> :
                 i % 5 === 0 ? <line x1={xPx} y1={RULER_SIZE - 5} x2={xPx} y2={RULER_SIZE} stroke="#555" strokeWidth="0.5" /> :
                 <line x1={xPx} y1={RULER_SIZE - 3} x2={xPx} y2={RULER_SIZE} stroke="#444" strokeWidth="0.5" />}
                {i % 10 === 0 && <text x={xPx + 1} y={RULER_SIZE - 10} fill="#888" fontSize="7">{i}</text>}
              </React.Fragment>
            })}
          </svg>
          {/* Left ruler */}
          <svg className="absolute left-0 top-0" width={RULER_SIZE} height={totalPreviewH} style={{ overflow: 'visible' }}>
            {Array.from({ length: Math.ceil(size.h) + 1 }).map((_, i) => {
              const yPx = RULER_SIZE + i * pxPerMm
              return <React.Fragment key={i}>
                {i % 10 === 0 ? <line x1={RULER_SIZE - 8} y1={yPx} x2={RULER_SIZE} y2={yPx} stroke="#666" strokeWidth="0.5" /> :
                 i % 5 === 0 ? <line x1={RULER_SIZE - 5} y1={yPx} x2={RULER_SIZE} y2={yPx} stroke="#555" strokeWidth="0.5" /> :
                 <line x1={RULER_SIZE - 3} y1={yPx} x2={RULER_SIZE} y2={yPx} stroke="#444" strokeWidth="0.5" />}
                {i % 10 === 0 && <text x={3} y={yPx - 2} fill="#888" fontSize="7">{i}</text>}
              </React.Fragment>
            })}
          </svg>

          {/* Label canvas */}
          <div ref={previewRef} className="absolute bg-white shadow-2xl" style={{ left: RULER_SIZE, top: RULER_SIZE, width: labelW, height: labelH, position: 'relative' }}
            onMouseDown={e => { if (e.target === previewRef.current || e.target === e.currentTarget) setSelectedId(null) }}>
            {design.elements.map(el => {
              if (!el.visible) return null
              const isSelected = el.id === selectedId
              const elPx = { x: el.x * pxPerMm, y: el.y * pxPerMm, w: el.width * pxPerMm, h: el.height * pxPerMm }
              return (
                <div key={el.id} className={`absolute cursor-move ${isSelected ? 'ring-2 ring-blue-400' : 'hover:ring-1 hover:ring-blue-300/50'}`}
                  style={{ left: elPx.x, top: elPx.y, width: elPx.w, height: elPx.h, overflow: 'hidden', clipPath: 'inset(0)' }}
                  onMouseDown={e => handleMouseDown(e, el.id)}>
                  
                  {el.type === 'text' && (
                    <div className="flex h-full w-full" style={{
                      fontSize: `${el.fontSize * pxPerMm}px`,
                      fontWeight: el.bold ? 'bold' : 'normal',
                      color: el.color,
                      alignItems: 'center',
                      justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      hyphens: 'auto',
                    }}>{el.content || 'Texto'}</div>
                  )}
                  {el.type === 'barcode' && (
                    <div className="flex h-full w-full flex-col" style={{ overflow: 'hidden' }}>
                      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                        {renderBarcodeSvg(el)}
                      </div>
                      {el.showHumanReadable !== false && (
                        <div className="text-center font-bold leading-tight" style={{
                          fontSize: `${(el.humanFontSize || 3) * pxPerMm}px`,
                          lineHeight: 1.1,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}>{el.content}</div>
                      )}
                    </div>
                  )}
                  {el.type === 'qr' && (
                    <div className="flex h-full w-full items-center justify-center bg-white text-[6px] font-mono text-slate-950">QR</div>
                  )}
                  {el.type === 'rect' && (
                    <div className="h-full w-full border" style={{ borderColor: el.color || '#111827', borderWidth: '1px' }} />
                  )}

                  {isSelected && (
                    <>
                      {['nw', 'ne', 'sw', 'se'].map(corner => (
                        <div key={corner} className="el-handle absolute h-3 w-3 cursor-nwse-resize border-2 border-white bg-blue-500"
                          style={{ [corner.includes('n') ? 'top' : 'bottom']: -5, [corner.includes('w') ? 'left' : 'right']: -5 }}
                          onMouseDown={e => handleResizeStart(e, el.id, corner)} />
                      ))}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Properties panel */}
      <div className="w-72 border-l border-white/10 bg-slate-900 p-3 text-xs text-white/80 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-white">Propiedades</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-white/50 hover:bg-white/10">&times;</button>
        </div>

        <label className="mb-2 block">
          <span className="text-white/50">Etiqueta</span>
          <select id="designer-label-size" value={design.labelSizeId} onChange={e => setDesign(s => ({ ...s, labelSizeId: e.target.value, width: getLabelSize(e.target.value).w, height: getLabelSize(e.target.value).h }))} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white">
            {Object.values(LABEL_SIZES).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <div className="mb-2">
          <span className="text-white/50">Elementos ({design.elements.length})</span>
          {design.elements.map(el => (
            <div key={el.id} className={`mt-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 ${el.id === selectedId ? 'bg-blue-600/30' : 'hover:bg-white/5'}`} onClick={() => setSelectedId(el.id)}>
              <span className="w-5 text-center text-white/40">{el.type === 'text' ? 'T' : el.type === 'barcode' ? '|||' : el.type === 'qr' ? 'QR' : '[]'}</span>
              <span className="flex-1 truncate">{el.content || '(vacio)'}</span>
              <button className="text-white/30 hover:text-white" onClick={e => { e.stopPropagation(); moveToFront(el.id) }}>↑</button>
              <button className="text-red-400/50 hover:text-red-400" onClick={e => { e.stopPropagation(); deleteElement(el.id) }}>&times;</button>
            </div>
          ))}
        </div>

        {selectedEl && (
          <div className="space-y-2 border-t border-white/10 pt-2">
            <h4 className="font-bold text-white">{selectedEl.type.toUpperCase()}</h4>
            <label className="block"><span className="text-white/50">Contenido</span>
              <input id="designer-content" value={selectedEl.content || ''} onChange={e => updateElement(selectedId, { content: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-white/50">X (mm)</span>
                <input id="designer-x" type="number" step="0.5" value={selectedEl.x} onChange={e => updateElement(selectedId, { x: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
              </label>
              <label className="block"><span className="text-white/50">Y (mm)</span>
                <input id="designer-y" type="number" step="0.5" value={selectedEl.y} onChange={e => updateElement(selectedId, { y: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
              </label>
              <label className="block"><span className="text-white/50">Ancho (mm)</span>
                <input id="designer-width" type="number" step="0.5" value={selectedEl.width} onChange={e => updateElement(selectedId, { width: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
              </label>
              <label className="block"><span className="text-white/50">Alto (mm)</span>
                <input id="designer-height" type="number" step="0.5" value={selectedEl.height} onChange={e => updateElement(selectedId, { height: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
              </label>
            </div>
            {selectedEl.type === 'barcode' && (
              <>
                <label className="block"><span className="text-white/50">Tipo</span>
                  <select id="designer-barcode-type" value={selectedEl.barcodeType || 'code128'} onChange={e => updateElement(selectedId, { barcodeType: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white">
                    <option value="code128">Code128</option>
                    <option value="ean13">EAN-13</option>
                    <option value="upc">UPC-A</option>
                  </select>
                </label>
                <label className="block"><span className="text-white/50">Altura código (mm)</span>
                  <input id="designer-barcode-height" type="number" step="0.5" value={selectedEl.barcodeHeight || 30} onChange={e => updateElement(selectedId, { barcodeHeight: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
                </label>
                <label className="flex items-center gap-2"><input id="designer-show-human-readable" type="checkbox" checked={selectedEl.showHumanReadable !== false} onChange={e => updateElement(selectedId, { showHumanReadable: e.target.checked })} className="accent-blue-500" /> Texto legible</label>
              </>
            )}
            {selectedEl.type === 'text' && (
              <>
                <label className="block"><span className="text-white/50">Tamaño (mm)</span>
                  <input id="designer-font-size" type="number" step="0.5" value={selectedEl.fontSize} onChange={e => updateElement(selectedId, { fontSize: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/20 bg-slate-800 px-2 py-1 text-white" />
                </label>
                <label className="flex items-center gap-2"><input id="designer-bold" type="checkbox" checked={selectedEl.bold} onChange={e => updateElement(selectedId, { bold: e.target.checked })} className="accent-blue-500" /> Negrita</label>
                <label className="block"><span className="text-white/50">Color</span>
                  <input id="designer-color" type="color" value={selectedEl.color || '#111827'} onChange={e => updateElement(selectedId, { color: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-800" />
                </label>
              </>
            )}
            <label className="flex items-center gap-2"><input id="designer-locked" type="checkbox" checked={selectedEl.locked} onChange={e => updateElement(selectedId, { locked: e.target.checked })} className="accent-blue-500" /> Bloquear</label>
            <label className="flex items-center gap-2"><input id="designer-visible" type="checkbox" checked={selectedEl.visible} onChange={e => updateElement(selectedId, { visible: e.target.checked })} className="accent-blue-500" /> Visible</label>
          </div>
        )}

        {/* Save / Cancel */}
        <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
          <button onClick={() => onSave && onSave(design)} className="flex-1 rounded bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-500">Guardar diseño</button>
          <button onClick={onClose} className="flex-1 rounded bg-white/10 py-2 text-sm text-white hover:bg-white/20">Cancelar</button>
        </div>
      </div>

      {/* Export PDF modal */}
      {exportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setExportModal(null)}>
          <div className="w-80 rounded-lg bg-slate-800 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-bold text-white">Exportar PDF</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="radio" name="export-type" checked={exportModal.type === 'single'} onChange={() => setExportModal({ ...exportModal, type: 'single' })} className="accent-blue-500" />
                Una etiqueta por página
              </label>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="radio" name="export-type" checked={exportModal.type === 'sheet'} onChange={() => setExportModal({ ...exportModal, type: 'sheet' })} className="accent-blue-500" />
                Múltiples etiquetas por página (A4)
              </label>
              <label className="block">
                <span className="text-xs text-white/50">Cantidad</span>
                <input type="number" min="1" max="999" value={exportModal.quantity} onChange={e => setExportModal({ ...exportModal, quantity: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleExportPdf} className="flex-1 rounded bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-500">Generar PDF</button>
              <button type="button" onClick={() => setExportModal(null)} className="flex-1 rounded bg-white/10 py-2 text-sm text-white hover:bg-white/20">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
