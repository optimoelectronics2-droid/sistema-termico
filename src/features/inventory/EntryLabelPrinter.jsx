import { useMemo, useState } from 'react'
import { Cpu, Download, FileText, Printer, Tags } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useERPStore } from '../../store/useERPStore'
import { buildCode128Bars, getBarcodeLayout, sanitizeCode128Value } from '../../lib/barcodeEngine'
import { LABEL_SIZES, createEmptyDesign, createLabelElement, validateBarcodeReadability } from '../../lib/labelEngine'
import { renderDesignToZpl, renderDesignToEpl, renderDesignToTspl, renderDesignToCpcl, renderDesignToEscpos, downloadOutput } from '../../lib/labelOutput'
import { currency } from '../../lib/formatters'

const LABEL_CHOICES = Object.entries(LABEL_SIZES).filter(([id]) => !['letter', 'a4', '58mm', '80mm'].includes(id)).map(([id, dim]) => ({ id, name: dim.name, w: dim.w, h: dim.h }))

const THERMAL_PROTOCOLS = [
  { id: 'zpl', label: 'ZPL (Zebra, Xprinter)' },
  { id: 'escpos', label: 'ESC/POS (Epson TM)' },
  { id: 'tspl', label: 'TSPL (TSC)' },
  { id: 'epl', label: 'EPL (Zebra antiguas)' },
  { id: 'cpcl', label: 'CPCL (Honeywell, Citizen)' },
]

const MAX_LABELS_PER_PRINT = 300

function selectedCodeFor(product) {
  const raw = String(product?.barcode || product?.sku || product?.id || '')
  return sanitizeCode128Value(raw)
}

function fitPdfLines(pdf, text, maxWidth, maxLines) {
  const words = String(text || '').trim().slice(0, 42).split(/\s+/).filter(Boolean)
  const lines = []
  for (const word of words) {
    const current = lines[lines.length - 1] || ''
    const test = current ? `${current} ${word}` : word
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

function moneyText(value) {
  return Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function LabelPreviewItem({ line, code, showPrice, showCost, showSku }) {
  return (
    <div className="label-item flex flex-col items-center justify-center rounded border border-slate-300 bg-white p-1.5 text-center text-slate-950 print:break-inside-avoid">
      <p className="w-full truncate text-[11px] font-black leading-tight">{line.productName}</p>
      {showSku && line.sku ? <p className="w-full truncate text-[9px] font-semibold leading-tight">{line.sku}</p> : null}
      {showCost && Number(line.cost || 0) > 0 ? <p className="w-full truncate text-[10px] font-black text-slate-700">Costo: RD$ {moneyText(line.cost)}</p> : null}
      {showPrice && Number(line.price || 0) > 0 ? <p className="w-full truncate text-[11px] font-black text-slate-950">{currency.format(Number(line.price))}</p> : null}
      <BarcodeSvg value={code} />
      <p className="mt-[1px] w-full truncate font-mono text-[9px] font-black tracking-wide">{code || 'SIN-CODIGO'}</p>
    </div>
  )
}

function BarcodeSvg({ value, height = 26 }) {
  const barcode = buildCode128Bars(value)
  if (!barcode || !barcode.bars) return <div className="text-[8px] text-red-400">Error</div>
  const quiet = 10
  const width = barcode.width + quiet * 2
  return (
    <svg viewBox={`0 0 ${width} ${height + 6}`} role="img" aria-label={`Codigo ${barcode.text}`} shapeRendering="crispEdges" className="mx-auto w-full max-w-[200px] bg-white" style={{ height: `${height + 6}px` }}>
      {barcode.bars.map((bar, index) => <rect key={`${bar.x}-${index}`} x={quiet + bar.x} y="3" width={Math.max(bar.width, 1)} height={height} fill="#111827" />)}
    </svg>
  )
}

export function EntryLabelPrinter({ entry, onClose }) {
  const products = useERPStore((state) => state.products)
  const company = useERPStore((state) => state.company)
  const [format, setFormat] = useState('pdf')
  const [labelSize, setLabelSize] = useState(() => LABEL_CHOICES.find((size) => size.id === company?.defaultLabelSize) || LABEL_CHOICES.find((size) => size.id === '3x2') || LABEL_CHOICES[0])
  const [showPrice, setShowPrice] = useState(company?.labelShowPrice ?? true)
  const [showCost, setShowCost] = useState(true)
  const [showSku, setShowSku] = useState(true)
  const [protocol, setProtocol] = useState(company?.labelPrintMode && ['zpl', 'escpos', 'tspl', 'epl', 'cpcl'].includes(company.labelPrintMode) ? company.labelPrintMode : 'zpl')
  const [status, setStatus] = useState('')

  const lines = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]))
    return (entry?.items || []).map((item) => {
      const product = byId.get(item.productId) || {}
      return {
        ...item,
        sku: product.sku || '',
        price: Number(product.price || 0),
        code: selectedCodeFor(product) || item.productId,
      }
    })
  }, [entry, products])

  const totalLabels = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, Math.min(Number(line.quantity || 0), MAX_LABELS_PER_PRINT)), 0), [lines])
  const previewItems = useMemo(() => lines.flatMap((line) => {
    const count = Math.max(0, Math.min(Number(line.quantity || 0), MAX_LABELS_PER_PRINT))
    return Array.from({ length: count }, () => line)
  }), [lines])

  function sanitizeFilename(value) {
    return String(value || 'entrada').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
  }

  function buildDesignFor(line) {
    const size = LABEL_SIZES[labelSize.id]
    const design = createEmptyDesign(labelSize.id)
    const margin = 2
    const nameH = Math.round(size.h * 0.2)
    const lineH = Math.round(size.h * 0.11)
    let y = margin
    design.elements.push(createLabelElement('text', { x: margin, y, width: size.w - margin * 2, height: nameH, fontSize: Math.max(5, Math.round(size.h * 0.13)), bold: true, align: 'left', content: line.productName }))
    y += nameH
    if (showSku && line.sku) {
      design.elements.push(createLabelElement('text', { x: margin, y, width: size.w - margin * 2, height: lineH, fontSize: Math.max(4, Math.round(size.h * 0.08)), align: 'left', content: `SKU: ${line.sku}` }))
      y += lineH
    }
    if (showCost && Number(line.cost || 0) > 0) {
      design.elements.push(createLabelElement('text', { x: margin, y, width: size.w - margin * 2, height: lineH, fontSize: Math.max(4, Math.round(size.h * 0.09)), bold: true, align: 'left', content: `Costo: RD$${moneyText(line.cost)}` }))
      y += lineH
    }
    if (showPrice && Number(line.price || 0) > 0) {
      design.elements.push(createLabelElement('text', { x: margin, y, width: size.w - margin * 2, height: lineH, fontSize: Math.max(4, Math.round(size.h * 0.1)), bold: true, align: 'left', content: `Precio: ${currency.format(Number(line.price))}` }))
      y += lineH
    }
    const remaining = size.h - y - margin
    const barcodeH = Math.max(8, Math.round(remaining * 0.72))
    design.elements.push(createLabelElement('barcode', { x: margin, y: y + 1, width: size.w - margin * 2, height: barcodeH, barcodeHeight: Math.round(barcodeH * 0.72), showHumanReadable: true, humanFontSize: Math.max(2.5, size.h * 0.04), barcodeType: 'code128', content: line.code }))
    return design
  }

  async function downloadPdf() {
    try {
      const { default: jsPDF } = await import('jspdf')
      const size = LABEL_SIZES[labelSize.id]
      const doc = new jsPDF({ unit: 'mm', format: [size.w, size.h], hotfixes: ['px_scaling'] })
      let pageIndex = 0
      for (const line of lines) {
        const count = Math.max(0, Math.min(Number(line.quantity || 0), MAX_LABELS_PER_PRINT))
        for (let i = 0; i < count; i++) {
          if (pageIndex > 0) doc.addPage([size.w, size.h])
          renderPdfLabel(doc, line, labelSize.id, { showPrice, showCost, showSku })
          pageIndex += 1
        }
      }
      doc.save(`etiquetas-entrada-${sanitizeFilename(entry?.reference || entry?.supplierInvoice || entry?.id)}.pdf`)
      setStatus('PDF generado con medidas exactas para impresora de etiquetas.')
      window.setTimeout(() => setStatus(''), 4000)
    } catch (error) {
      setStatus(`Error: ${error.message}`)
    }
  }

  function downloadThermal() {
    const cal = { dpi: company?.labelDpi || 203, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
    const chunks = []
    const filename = `etiquetas-entrada-${sanitizeFilename(entry?.reference || entry?.supplierInvoice || entry?.id)}`
    for (const line of lines) {
      const count = Math.max(0, Math.min(Number(line.quantity || 0), MAX_LABELS_PER_PRINT))
      const design = buildDesignFor(line)
      for (let i = 0; i < count; i++) {
        if (protocol === 'zpl') chunks.push(renderDesignToZpl(design, cal))
        else if (protocol === 'epl') chunks.push(renderDesignToEpl(design, cal))
        else if (protocol === 'tspl') chunks.push(renderDesignToTspl(design, cal))
        else if (protocol === 'cpcl') chunks.push(renderDesignToCpcl(design, cal))
        else if (protocol === 'escpos') chunks.push(renderDesignToEscpos(design, cal))
      }
    }
    if (!chunks.length) {
      setStatus('No hay etiquetas que generar.')
      return
    }
    if (protocol === 'escpos') {
      const blob = new Blob(chunks, { type: 'application/octet-stream' })
      downloadOutput(blob, `${filename}.prn`, 'application/octet-stream')
    } else {
      downloadOutput(chunks.join('\n'), `${filename}.${protocol}`, 'text/plain')
    }
    setStatus(`Archivo ${protocol.toUpperCase()} generado con ${totalLabels} etiqueta(s).`)
    window.setTimeout(() => setStatus(''), 4000)
  }

  function validateForPrint() {
    const invalid = lines.find((line) => {
      if (!line.code) return false
      const result = validateBarcodeReadability('code128', line.code)
      return result && result.valid === false
    })
    return invalid
  }

  async function handlePrint() {
    const invalid = validateForPrint()
    if (invalid) {
      setStatus(`Aviso: el codigo de ${invalid.productName} es demasiado largo para etiquetas termicas; la etiqueta igualmente se genera.`)
    }
    if (format === 'pdf') await downloadPdf()
    else downloadThermal()
  }

  function renderPdfLabel(doc, line, sizeId, opts) {
    const dim = LABEL_SIZES[sizeId]
    const mmW = dim.w
    const mmH = dim.h
    const margin = mmW * 0.04
    const usableW = mmW - margin * 2
    const maxY = mmH - margin
    let y = margin

    let nameFs = Math.min(mmH * 0.24, 9)
    let infoFs = Math.max(2.5, Math.min(mmH * 0.16, 6))
    let priceFs = Math.max(3, Math.min(mmH * 0.3, 10))
    const maxNameLines = mmH <= 25.4 ? 1 : 2
    const linesForName = fitPdfLines(doc, line.productName || 'Producto', usableW, maxNameLines)
    let nameH = nameFs * 0.62 * linesForName.length
    let infoH = 0
    if (opts.showSku && line.sku) infoH += infoFs * 0.62
    if (opts.showCost && Number(line.cost || 0) > 0) infoH += infoFs * 0.62
    if (opts.showPrice && Number(line.price || 0) > 0) infoH += priceFs * 0.62
    let barH = Math.min(mmH * 0.32, Math.max(5, Math.round(mmH * 0.24)))
    let totalH = nameH + infoH + barH + margin * 0.4

    if (totalH > maxY) {
      const s = maxY / totalH
      nameFs = Math.max(3.5, nameFs * s)
      infoFs = Math.max(2, infoFs * s)
      priceFs = Math.max(2.5, priceFs * s)
      barH = Math.max(3, barH * s)
      nameH = nameFs * 0.58 * linesForName.length
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(nameFs)
    linesForName.forEach((textLine, index) => doc.text(textLine, mmW / 2, y + index * nameFs * 0.52, { align: 'center' }))
    y += nameH

    if (opts.showSku && line.sku) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(infoFs)
      doc.text(`SKU: ${String(line.sku).slice(0, 22)}`, mmW / 2, y, { align: 'center' })
      y += infoFs * 0.62
    }
    if (opts.showCost && Number(line.cost || 0) > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(infoFs)
      doc.text(`Costo: RD$${moneyText(line.cost)}`, mmW / 2, y, { align: 'center' })
      y += infoFs * 0.62
    }
    if (opts.showPrice && Number(line.price || 0) > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(priceFs)
      doc.text(`Precio: ${currency.format(Number(line.price))}`, mmW / 2, y, { align: 'center' })
      y += priceFs * 0.62
    }

    const bc = buildCode128Bars(line.code)
    if (bc && bc.bars.length) {
      const barAvail = usableW > 6 ? usableW - 4 : usableW
      const layout = getBarcodeLayout(bc, barAvail)
      const startX = margin + 2 + Math.max(0, (barAvail - layout.totalWidth) / 2)
      bc.bars.forEach((bar) => {
        const x = startX + layout.quietWidth + bar.x * layout.scale
        const w = Math.max(bar.width * layout.scale, 0.1)
        doc.rect(Math.round(x * 10) / 10, y + 0.3, Math.round(w * 10) / 10, barH, 'F')
      })
      y += barH + mmH * 0.03
    }

    const codeRemain = maxY - y
    if (codeRemain > 1.5) {
      const codeText = String(line.code).slice(0, 24)
      const maxFs = Math.min(mmH * 0.03, codeRemain * 0.8)
      let fs = maxFs
      doc.setFont('helvetica', 'bold')
      while (fs > 1.5 && doc.getTextWidth(codeText) > usableW) fs -= 0.25
      doc.setFontSize(Math.max(1.5, fs))
      doc.text(codeText, mmW / 2, y + codeRemain * 0.5, { align: 'center' })
    }
  }

  const gridCols = labelSize.id === '2x1' ? 'grid-cols-4' : labelSize.id.startsWith('4x') || labelSize.id === '4x6' ? 'grid-cols-2' : labelSize.w >= 100 ? 'grid-cols-3' : 'grid-cols-4'

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFormat('pdf')}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-extrabold transition ${format === 'pdf' ? 'border-blue-300/40 bg-blue-500/20 text-white' : 'border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07]'}`}
        >
          <FileText size={15} /> Formato 1 · PDF vectorial
        </button>
        <button
          type="button"
          onClick={() => setFormat('thermal')}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-extrabold transition ${format === 'thermal' ? 'border-blue-300/40 bg-blue-500/20 text-white' : 'border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07]'}`}
        >
          <Cpu size={15} /> Formato 2 · Termica (ZPL/ESC-POS)
        </button>
        <span className="ml-auto rounded-full bg-white/[0.06] px-3 py-1 text-xs font-bold text-white/60">{totalLabels} etiqueta(s) · {lines.length} producto(s)</span>
      </div>

      <div className="no-print grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2"><span className="label-dark">Tamaño de etiqueta</span><select id="entry-label-size" value={labelSize.id} onChange={(event) => setLabelSize(LABEL_CHOICES.find((size) => size.id === event.target.value) || LABEL_CHOICES[0])} className="input-dark" autoComplete="off" name="entry-label-size">{LABEL_CHOICES.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select></label>
        {format === 'thermal' ? (
          <label><span className="label-dark">Protocolo termico</span><select id="entry-label-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)} className="input-dark" autoComplete="off" name="entry-label-protocol">{THERMAL_PROTOCOLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        ) : null}
        <label className="flex items-end gap-2 pb-2 text-sm"><input id="entry-label-price" type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)}  autoComplete="off"  name="entry-label-price" /> Precio</label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input id="entry-label-cost" type="checkbox" checked={showCost} onChange={(e) => setShowCost(e.target.checked)}  autoComplete="off"  name="entry-label-cost" /> Costo</label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input id="entry-label-sku" type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)}  autoComplete="off"  name="entry-label-sku" /> SKU</label>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <Button icon={Printer} variant="primary" onClick={handlePrint} disabled={!totalLabels}>
          {format === 'pdf' ? 'Descargar PDF de etiquetas' : `Descargar archivo ${protocol.toUpperCase()}`}
        </Button>
        <Button variant="ghost" icon={Download} onClick={() => window.print()}>Imprimir desde navegador</Button>
        <Button variant="ghost" icon={Tags} onClick={onClose}>Cerrar</Button>
        {status ? <span className="text-sm font-bold text-emerald-300">{status}</span> : null}
      </div>

      <div className={`label-grid label-print-${labelSize.id} grid gap-2 ${gridCols}`}>
        {previewItems.slice(0, 40).map((line, index) => <LabelPreviewItem key={`${line.productId}-${index}`} line={line} code={line.code} showPrice={showPrice} showCost={showCost} showSku={showSku} />)}
      </div>
      {previewItems.length > 40 ? <p className="text-xs text-white/40">Mostrando 40 de {previewItems.length} etiquetas en la vista previa; el archivo se genera con todas.</p> : null}
    </div>
  )
}
