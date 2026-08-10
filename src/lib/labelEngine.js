/* =================================================================
   LABEL ENGINE — Professional mm-based label design core
   Units: mm (primary), cm, inches
   DPI: 203 / 300 / 600 auto-detect
   ================================================================= */

import { buildCode128Bars, buildEAN13Bars, buildUPABars } from './barcodeEngine.js'

/* -----------------------------------------------------------------
   Label size presets (mm)
   ----------------------------------------------------------------- */
export const LABEL_SIZES = {
  '20x10':   { id: '20x10',   w: 20,  h: 10,  name: '20 × 10 mm' },
  '25x15':   { id: '25x15',   w: 25,  h: 15,  name: '25 × 15 mm' },
  '30x20':   { id: '30x20',   w: 30,  h: 20,  name: '30 × 20 mm' },
  '40x20':   { id: '40x20',   w: 40,  h: 20,  name: '40 × 20 mm' },
  '50x25':   { id: '50x25',   w: 50,  h: 25,  name: '50 × 25 mm' },
  '50x30':   { id: '50x30',   w: 50,  h: 30,  name: '50 × 30 mm' },
  '60x40':   { id: '60x40',   w: 60,  h: 40,  name: '60 × 40 mm' },
  '80x50':   { id: '80x50',   w: 80,  h: 50,  name: '80 × 50 mm' },
  '100x50':  { id: '100x50',  w: 100, h: 50,  name: '100 × 50 mm' },
  '100x75':  { id: '100x75',  w: 100, h: 75,  name: '100 × 75 mm' },
  '100x100': { id: '100x100', w: 100, h: 100, name: '100 × 100 mm' },
  '2x1':     { id: '2x1',     w: 50.8, h: 25.4, name: '2" × 1"' },
  '3x2':     { id: '3x2',     w: 76.2, h: 50.8, name: '3" × 2"' },
  '4x2':     { id: '4x2',     w: 101.6, h: 50.8, name: '4" × 2"' },
  '4x3':     { id: '4x3',     w: 101.6, h: 76.2, name: '4" × 3"' },
  '4x6':     { id: '4x6',     w: 101.6, h: 152.4, name: '4" × 6"' },
  'letter':  { id: 'letter',  w: 215.9, h: 279.4, name: 'Carta' },
  'a4':      { id: 'a4',      w: 210,   h: 297,   name: 'A4' },
  '58mm':    { id: '58mm',    w: 58,    h: 297,   name: '58 mm térmica' },
  '80mm':    { id: '80mm',    w: 80,    h: 297,   name: '80 mm térmica' },
}

export function getLabelSize(id) {
  return LABEL_SIZES[id] || LABEL_SIZES['3x2']
}

/* -----------------------------------------------------------------
   DPI detection & conversion
   ----------------------------------------------------------------- */
export const DPI_VALUES = [203, 300, 600]

export function mmToPx(mm, dpi) { return Math.round((mm / 25.4) * dpi) }
export function pxToMm(px, dpi)  { return (px / dpi) * 25.4 }
export function inToMm(inches)   { return inches * 25.4 }
export function mmToIn(mm)       { return mm / 25.4 }
export function cmToMm(cm)       { return cm * 10 }

/* -----------------------------------------------------------------
   Calibration offsets applied to all output
   ----------------------------------------------------------------- */
export function createCalibration(overrides = {}) {
  return {
    offsetX: overrides.offsetX ?? 0,
    offsetY: overrides.offsetY ?? 0,
    scaleX:  overrides.scaleX ?? 1,
    scaleY:  overrides.scaleY ?? 1,
    rotation: overrides.rotation ?? 0,
    cutCompensation: overrides.cutCompensation ?? 0,
    labelGap: overrides.labelGap ?? 2,
  }
}

export const DEFAULT_CALIBRATION = createCalibration()

export function applyCalibration(cal, x, y, w, h) {
  const cx = x * cal.scaleX + cal.offsetX
  const cy = y * cal.scaleY + cal.offsetY
  const cw = w * cal.scaleX
  const ch = h * cal.scaleY
  return { x: cx, y: cy, width: cw, height: ch, rotation: cal.rotation }
}

/* -----------------------------------------------------------------
   Label design model
   ----------------------------------------------------------------- */
export const ELEMENT_TYPES = {
  TEXT: 'text',
  BARCODE: 'barcode',
  QR: 'qr',
  IMAGE: 'image',
  RECT: 'rect',
  LINE: 'line',
}

export function createLabelElement(type, overrides = {}) {
  return {
    id: overrides.id || 'el_' + Math.random().toString(36).slice(2, 9),
    type,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 30,
    height: overrides.height ?? 10,
    rotation: overrides.rotation ?? 0,
    locked: overrides.locked ?? false,
    visible: overrides.visible ?? true,
    content: overrides.content ?? '',
    fontSize: overrides.fontSize ?? 8,
    fontFamily: overrides.fontFamily ?? 'sans-serif',
    bold: overrides.bold ?? false,
    align: overrides.align ?? 'center',
    color: overrides.color ?? '#111827',
    barcodeType: overrides.barcodeType ?? 'code128',
    barcodeHeight: overrides.barcodeHeight ?? 30,
    showHumanReadable: overrides.showHumanReadable ?? true,
    humanFontSize: overrides.humanFontSize ?? 4,
    src: overrides.src ?? '',
  }
}

export function createEmptyDesign(labelSizeId) {
  const size = getLabelSize(labelSizeId)
  return {
    labelSizeId: size.id,
    width: size.w,
    height: size.h,
    margin: 2,
    gap: 2,
    elements: [],
    background: '#ffffff',
  }
}

/* -----------------------------------------------------------------
   Design validation
   ----------------------------------------------------------------- */
export function validateDesign(design) {
  const errors = []
  if (!design || !design.width || !design.height) { errors.push('Label dimensions required'); return { valid: false, errors } }
  if (design.elements) {
    design.elements.forEach((el, i) => {
      if (el.x + el.width > design.width) errors.push(`Element ${i} (${el.type}) exceeds right edge`)
      if (el.y + el.height > design.height) errors.push(`Element ${i} (${el.type}) exceeds bottom edge`)
      if (el.x < 0 || el.y < 0) errors.push(`Element ${i} (${el.type}) outside bounds`)
    })
  }
  return { valid: errors.length === 0, errors }
}

/* -----------------------------------------------------------------
   Barcode readability validation
   ----------------------------------------------------------------- */
export function validateBarcodeReadability(type, value, options = {}) {
  const { minModuleWidth = 0.2, maxModules = 200 } = options
  if (!value) return { valid: false, reason: 'No value' }
  if (type === 'qr') return { valid: true, barCount: 1 }
  const fn = type === 'ean13' ? buildEAN13Bars : type === 'upc' ? buildUPABars : buildCode128Bars
  const bars = fn(value)
  if (!bars || !bars.bars || bars.bars.length === 0) return { valid: false, reason: 'No bars generated' }
  const widths = bars.bars.map(b => b.width)
  const minBar = Math.min(...widths)
  const total = bars.width
  if (minBar < 1) return { valid: false, reason: `Bar module too narrow (${minBar})`, minBar, total }
  if (total > maxModules) return { valid: false, reason: `Too many modules (${total} > ${maxModules})` }
  return { valid: true, bars: bars.bars.length, minBar, total }
}

export function generateBarcodeBars(type, value) {
  const fn = type === 'ean13' ? buildEAN13Bars : type === 'upc' ? buildUPABars : buildCode128Bars
  return fn(value)
}

/* -----------------------------------------------------------------
   Printer profile
   ----------------------------------------------------------------- */
export function createPrinterProfile(overrides = {}) {
  return {
    id: overrides.id || 'prof_' + Math.random().toString(36).slice(2, 9),
    name: overrides.name || 'Nueva impresora',
    brand: overrides.brand || '',
    model: overrides.model || '',
    protocol: overrides.protocol || 'zpl',
    dpi: overrides.dpi ?? 203,
    calibration: createCalibration(overrides.calibration),
    defaultLabelSize: overrides.defaultLabelSize || '3x2',
    notes: overrides.notes || '',
  }
}

/**
 * Generate a calibration test label design with crosshair and border marks
 */
export function createCalibrationLabel() {
  return {
    labelSizeId: '100x100',
    width: 100,
    height: 100,
    margin: 2,
    gap: 2,
    elements: [
      { id: 'cross-v', type: 'rect', x: 49, y: 0, width: 2, height: 100, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
      { id: 'cross-h', type: 'rect', x: 0, y: 49, width: 100, height: 2, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
      { id: 'corner1', type: 'rect', x: 0, y: 0, width: 10, height: 2, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
      { id: 'corner2', type: 'rect', x: 90, y: 0, width: 10, height: 2, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
      { id: 'corner3', type: 'rect', x: 0, y: 98, width: 10, height: 2, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
      { id: 'corner4', type: 'rect', x: 90, y: 98, width: 10, height: 2, locked: true, visible: true, content: '', fontSize: 8, fontFamily: 'sans-serif', bold: false, align: 'center', color: '#111827', barcodeType: 'code128', barcodeHeight: 30, showHumanReadable: true, humanFontSize: 4, src: '' },
    ],
    background: '#ffffff',
  }
}
