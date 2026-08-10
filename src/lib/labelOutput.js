/* =================================================================
   LABEL OUTPUT ENGINE — Multi-format label rendering (CORREGIDO)
   Supported outputs: PDF (jsPDF), ZPL, EPL, TSPL, CPCL, ESC/POS
   All use mm-based coordinates, calibration-aware
   ================================================================= */

import { buildCode128Bars, buildEAN13Bars, buildUPABars, getBarcodeLayout, validateAndSanitizeForPrint } from './barcodeEngine.js'
import { mmToPx, applyCalibration, getLabelSize } from './labelEngine.js'

function getBars(type, value) {
  if (type === 'ean13') return buildEAN13Bars(value)
  if (type === 'upc') return buildUPABars(value)
  return buildCode128Bars(value)
}

function zplField(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/[\^~_\\]/g, c => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/* -----------------------------------------------------------------
   1. PDF vector — jsPDF (CORREGIDO: dimensiones exactas, clipping, barras mínimas)
   ----------------------------------------------------------------- */

/**
 * Create a new jsPDF document configured exactly for a label size
 * @param {object} design - Label design object with width/height
 * @param {object} calibration - Calibration with scaleX/scaleY
 * @param {number} [quantity=1] - Number of copies (pages)
 * @returns {object} jsPDF instance
 */
export async function createLabelPdf(design, calibration, quantity = 1) {
  return createLabelPdfAsync(design, calibration, quantity)
}

/**
 * Create label PDF pages with exact label dimensions (async version)
 * @param {object} design - Label design
 * @param {object} calibration - Calibration
 * @param {number} [quantity=1] - Number of labels
 * @returns {Promise<import('jspdf').jsPDF>}
 */
export async function createLabelPdfAsync(design, calibration, quantity = 1) {
  const { default: jsPDF } = await import('jspdf')
  const size = getLabelSize(design.labelSizeId)
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const labelW = Math.round((size.w * (cal.scaleX || 1)) * 100) / 100
  const labelH = Math.round((size.h * (cal.scaleY || 1)) * 100) / 100
  const orientation = labelW >= labelH ? 'landscape' : 'portrait'

  const doc = new jsPDF({ unit: 'mm', format: [labelW, labelH], orientation, hotfixes: ['px_scaling'] })
  renderDesignToPdf(doc, design, calibration)

  for (let i = 1; i < quantity; i++) {
    doc.addPage([labelW, labelH])
    renderDesignToPdf(doc, design, calibration)
  }
  return doc
}

/**
 * Render a label design onto an existing jsPDF document
 * Applies calibration, validates elements, clips text, draws vector barcodes
 * @param {import('jspdf').jsPDF} doc - jsPDF document
 * @param {object} design - Label design object
 * @param {object} calibration - Calibration settings
 */
export function renderDesignToPdf(doc, design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }

  design.elements.forEach(el => {
    if (!el.visible) return
    const a = applyCalibration(cal, el.x, el.y, el.width, el.height)
    const x = Math.round(a.x * 100) / 100
    const y = Math.round(a.y * 100) / 100
    const w = Math.round(a.width * 100) / 100
    const h = Math.round(a.height * 100) / 100

    if (x < 0 || y < 0) { console.warn('Element outside bounds, skipping'); return }

    if (el.type === 'text') {
      doc.setFont('helvetica', el.bold ? 'bold' : 'normal')
      const fontSizePt = Math.max(2, (el.fontSize || 4) * 2.835) // mm to pt
      doc.setFontSize(fontSizePt)
      doc.setTextColor(el.color || '#111827')
      const content = String(el.content || '')
      // Clip to element bounds
      doc.saveGraphicsState()
      doc.rect(x, y, w, h)
      doc.clip()
      // Split text to fit width
      const lines = doc.splitTextToSize(content, Math.max(1, w - 0.5))
      const lineHeight = Math.max(el.fontSize || 4, 2) * 1.2
      let textY = y + (h - lines.length * lineHeight) / 2 + lineHeight * 0.35
      for (let i = 0; i < lines.length; i++) {
        if (textY + lineHeight > y + h) break
        const lineW = doc.getTextWidth(lines[i])
        let textX = x + 0.25
        if (el.align === 'center') textX = x + w / 2 - lineW / 2
        else if (el.align === 'right') textX = x + w - 0.25 - lineW
        doc.text(lines[i], textX, textY)
        textY += lineHeight
      }
      doc.restoreGraphicsState()
    }

    if (el.type === 'barcode') {
      const bc = getBars(el.barcodeType || 'code128', el.content)
      if (!bc || !bc.bars) return
      const barH = Math.max(1, el.barcodeHeight || h * 0.7)
      if (barH > h) return
      // Calculate available width, adjust quiet zone if needed
      let quietZoneMm = 2
      let avail = Math.max(1, w - quietZoneMm * 2)
      let scale = avail / bc.width
      if (scale < 0.1) { quietZoneMm = 1; avail = Math.max(1, w - quietZoneMm * 2); scale = avail / bc.width }
      if (scale < 0.08) { avail = Math.max(1, w); scale = avail / bc.width }
      const totalWidth = bc.width * scale
      const startX = x + (w - totalWidth) / 2
      bc.bars.forEach(bar => {
        const bx = Math.round((startX + bar.x * scale) * 100) / 100
        const bw = Math.round(Math.max(bar.width * scale, 0.1) * 100) / 100
        doc.setFillColor(0, 0, 0)
        doc.rect(bx, y, bw, barH, 'F')
      })
      if (el.showHumanReadable !== false) {
        const codeY = y + barH + 0.3
        const codeRemain = y + h - codeY
        if (codeRemain > 0.5) {
          const humanFsMm = Math.min(el.humanFontSize || 3, codeRemain * 0.7)
          const fsPt = Math.max(4, humanFsMm * 2.835)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(fsPt)
          const text = String(bc.humanReadable || el.content || '').slice(0, 24)
          const textW = doc.getTextWidth(text)
          const textX = x + (w - textW) / 2
          doc.text(text, textX, codeY + codeRemain * 0.4)
        }
      }
    }

    if (el.type === 'qr') {
      doc.setDrawColor(0, 0, 0)
      doc.setFontSize(6)
      doc.text('QR', x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' })
    }

    if (el.type === 'rect') {
      doc.setDrawColor(el.color || '#111827')
      doc.rect(x, y, w, h)
    }
  })
}

/**
 * Download a label design as a PDF file
 * @param {object} design - Label design
 * @param {object} calibration - Calibration settings
 * @param {number} quantity - Number of copies
 * @param {string} filename - Output filename
 */
export async function downloadLabelPdf(design, calibration, quantity = 1, filename = 'etiquetas.pdf') {
  const doc = await createLabelPdfAsync(design, calibration, quantity)
  doc.save(filename)
}

/**
 * Render a label design as a multi-sheet A4 grid
 * @param {object} design - Label design
 * @param {object} calibration - Calibration
 * @param {number} quantity - Number of labels
 * @param {number} [margin=5] - Page margin in mm
 * @returns {Promise<import('jspdf').jsPDF>}
 */
export async function renderDesignToA4Grid(design, calibration, quantity = 1, margin = 5) {
  const { default: jsPDF } = await import('jspdf')
  const size = getLabelSize(design.labelSizeId)
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const labelW = size.w * (cal.scaleX || 1)
  const labelH = size.h * (cal.scaleY || 1)
  const gap = cal.labelGap ?? 2
  const pageW = 210, pageH = 297
  const cols = Math.max(1, Math.floor((pageW - margin * 2 + gap) / (labelW + gap)))
  const rows = Math.max(1, Math.floor((pageH - margin * 2 + gap) / (labelH + gap)))
  const perPage = cols * rows

  const doc = new jsPDF({ unit: 'mm', format: 'a4', hotfixes: ['px_scaling'] })
  let rendered = 0
  while (rendered < quantity) {
    if (rendered > 0) doc.addPage('a4')
    for (let r = 0; r < rows && rendered < quantity; r++) {
      for (let c = 0; c < cols && rendered < quantity; c++) {
        const ox = margin + c * (labelW + gap)
        const oy = margin + r * (labelH + gap)
        const offsetCal = { ...cal, offsetX: (cal.offsetX || 0) + ox, offsetY: (cal.offsetY || 0) + oy }
        renderDesignToPdf(doc, design, offsetCal)
        rendered++
      }
    }
  }
  return doc
}

/* -----------------------------------------------------------------
   2-6. Printer protocol outputs (ZPL, EPL, TSPL, CPCL, ESC/POS)
   ----------------------------------------------------------------- */
export function renderDesignToZpl(design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const size = getLabelSize(design.labelSizeId)
  const dpi = cal.dpi || 203
  const wDots = mmToPx(size.w, dpi)
  const hDots = mmToPx(size.h, dpi)
  let zpl = '^XA'
  zpl += `^LL${hDots}^PW${wDots}^LH0,0`
  design.elements.forEach(el => {
    if (!el.visible) return
    const a = applyCalibration(cal, el.x, el.y, el.width, el.height)
    const xDots = mmToPx(a.x, dpi); const yDots = mmToPx(a.y, dpi)
    const wDotsE = mmToPx(a.width, dpi)
    if (el.type === 'text') {
      const fs = Math.max(12, el.fontSize * dpi / 25.4)
      zpl += `^CF0,${fs}^FO${xDots},${yDots}^FH^FD${zplField(String(el.content || ''))}^FS`
    }
    if (el.type === 'barcode') {
      const bc = getBars(el.barcodeType || 'code128', el.content)
      if (!bc) return
      const bcH = mmToPx(el.barcodeHeight || a.height * 0.7, dpi)
      const avail = wDotsE > 10 ? wDotsE - 10 : wDotsE
      const layout = getBarcodeLayout(bc, avail / (dpi / 25.4), 5)
      const barModule = Math.max(1, Math.min(3, Math.round(layout.scale * (dpi / 25.4))))
      const totalBcDots = (bc.width + 10) * barModule
      const bcXDots = xDots + Math.max(0, Math.round((wDotsE - totalBcDots) / 2))
      zpl += `^FO${bcXDots},${yDots}^BY${barModule}^BCN,${Math.max(12, bcH)},Y,N,N^FH^FD${zplField(String(el.content || ''))}^FS`
    }
    if (el.type === 'qr') {
      const bcH = Math.max(12, mmToPx(a.height, dpi))
      zpl += `^FO${xDots},${yDots}^BQN,2,${bcH}^FH^FDQA,${zplField(String(el.content || ''))}^FS`
    }
    if (el.type === 'rect') {
      zpl += `^FO${xDots},${yDots}^GB${wDotsE},${mmToPx(a.height, dpi)},1^FS`
    }
  })
  zpl += '^XZ'
  return zpl
}

export function renderDesignToEpl(design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const size = getLabelSize(design.labelSizeId); const dpi = cal.dpi || 203
  let epl = `N\nq${mmToPx(size.w, dpi)}\nQ${mmToPx(size.h, dpi)},${mmToPx((cal.labelGap || 2), dpi)}\n`
  design.elements.forEach(el => {
    if (!el.visible) return
    const a = applyCalibration(cal, el.x, el.y, el.width, el.height)
    const xPx = mmToPx(a.x, dpi); const yPx = mmToPx(a.y, dpi)
    const wPx = mmToPx(a.width, dpi); const hPx = mmToPx(a.height, dpi)
    if (el.type === 'text') epl += `A${xPx},${yPx},0,4,1,1,N,"${zplField(String(el.content || ''))}"\n`
    if (el.type === 'barcode') { const bcH = Math.max(16, mmToPx(el.barcodeHeight || a.height * 0.7, dpi)); epl += `B${xPx},${yPx},0,1,1,${bcH},B,${String(el.content || '').length},"${zplField(String(el.content || ''))}"\n` }
    if (el.type === 'rect') epl += `LO${xPx},${yPx},${wPx},${hPx}\n`
  })
  epl += 'P1\n'; return epl
}

export function renderDesignToTspl(design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const size = getLabelSize(design.labelSizeId); const dpi = cal.dpi || 203
  let tspl = `SIZE ${size.w} mm, ${size.h} mm\nGAP ${cal.labelGap || 2} mm, 0\nCLS\n`
  design.elements.forEach(el => {
    if (!el.visible) return
    const a = applyCalibration(cal, el.x, el.y, el.width, el.height)
    const xDots = mmToPx(a.x, dpi); const yDots = mmToPx(a.y, dpi); const wDotsE = mmToPx(a.width, dpi)
    if (el.type === 'text') tspl += `TEXT ${xDots},${yDots},"4",0,${Math.max(1, Math.round(el.fontSize * dpi / 72))},${Math.max(1, Math.round(el.fontSize * dpi / 72))},"${zplField(String(el.content || ''))}"\n`
    if (el.type === 'barcode') { const bcH = mmToPx(el.barcodeHeight || a.height * 0.7, dpi); tspl += `BARCODE ${xDots},${yDots},"128",${Math.max(1, Math.round(2 * dpi / 25.4))},1,0,${Math.max(12, bcH)},"${zplField(String(el.content || ''))}"\n` }
    if (el.type === 'rect') tspl += `BOX ${xDots},${yDots},${xDots + wDotsE},${yDots + mmToPx(a.height, dpi)},1\n`
  })
  tspl += 'PRINT 1\n'; return tspl
}

export function renderDesignToCpcl(design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const size = getLabelSize(design.labelSizeId); const dpi = cal.dpi || 203
  const wDots = mmToPx(size.w, dpi); const hDots = mmToPx(size.h, dpi)
  let cpcl = `! 0 200 200 ${hDots} 1\nPAGE-WIDTH ${wDots}\n`
  design.elements.forEach(el => {
    if (!el.visible) return
    const a = applyCalibration(cal, el.x, el.y, el.width, el.height)
    const xDots = mmToPx(a.x, dpi); const yDots = mmToPx(a.y, dpi)
    if (el.type === 'text') cpcl += `TEXT 4 0 ${xDots} ${yDots} ${zplField(String(el.content || ''))}\n`
    if (el.type === 'barcode') { const bcH = Math.max(12, mmToPx(el.barcodeHeight || a.height * 0.7, dpi)); cpcl += `BARCODE 128 1 1 ${bcH} ${xDots} ${yDots} ${zplField(String(el.content || ''))}\n` }
  })
  cpcl += 'FORM\nPRINT\n'; return cpcl
}

export function renderDesignToEscpos(design, calibration) {
  const cal = calibration || { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
  const size = getLabelSize(design.labelSizeId); const dpi = cal.dpi || 203
  const chunks = []; const encoder = new TextEncoder()
  const cmd = (...args) => chunks.push(new Uint8Array(args))
  const raw = (arr) => chunks.push(arr)
  cmd(0x1B, 0x40); cmd(0x1B, 0x61, 0x01)
  design.elements.forEach(el => {
    if (!el.visible) return
    if (el.type === 'text') { cmd(0x1B, 0x21, el.bold ? 0x08 : 0x00); raw(encoder.encode(String(el.content || '').slice(0, 32) + '\n')) }
    if (el.type === 'barcode') {
      const barcodeBytes = encoder.encode(String(el.content || ''))
      cmd(0x1D, 0x68, Math.min(0xFF, mmToPx(el.barcodeHeight || 30, dpi)))
      cmd(0x1D, 0x77, 3); cmd(0x1D, 0x6B, 0x49, barcodeBytes.length + 2)
      raw(new Uint8Array([0x7B, 0x42])); raw(barcodeBytes)
    }
  })
  cmd(0x1D, 0x56, 0x00)
  return new Blob(chunks, { type: 'application/octet-stream' })
}

export function renderDesign(design, protocol, calibration) {
  switch (protocol) {
    case 'pdf': return { data: null, renderFn: (doc) => renderDesignToPdf(doc, design, calibration), type: 'pdf' }
    case 'zpl': return { data: renderDesignToZpl(design, calibration), type: 'text/plain' }
    case 'epl': return { data: renderDesignToEpl(design, calibration), type: 'text/plain' }
    case 'tspl': return { data: renderDesignToTspl(design, calibration), type: 'text/plain' }
    case 'cpcl': return { data: renderDesignToCpcl(design, calibration), type: 'text/plain' }
    case 'escpos': return { data: renderDesignToEscpos(design, calibration), type: 'application/octet-stream' }
    default: return { data: null, type: 'text/plain' }
  }
}

export function downloadOutput(data, filename, mimeType) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
