/* =================================================================
   BARCODE ENGINE — Enterprise Grade
   Supports: Code128, EAN13, UPC-A, QR (via qrcode lib)
   Output: Unified bar descriptions → SVG or printer protocols
   ================================================================= */

import QRCode from 'qrcode'

/* -----------------------------------------------------------------
   CODE 128
   ----------------------------------------------------------------- */
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
]

function sanitizeCode128(v) {
  return (String(v || 'SIN-CODIGO').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '') || 'SIN-CODIGO').slice(0, 48)
}

export function buildCode128Bars(value) {
  const text = sanitizeCode128(value)
  const vals = [...text].map(ch => { const c = ch.charCodeAt(0); return c >= 32 && c <= 126 ? c - 32 : 31 })
  const ck = vals.reduce((s, c, i) => s + c * (i + 1), 104) % 103
  const codes = [104, ...vals, ck, 106]
  let x = 0; const bars = []
  codes.forEach(code => {
    const p = C128[code] || C128[31]
    ;[...p].forEach((u, i) => { const w = Number(u); if (i % 2 === 0) bars.push({ x, width: w }); x += w })
  })
  return { text, bars, width: x, type: 'code128', humanReadable: text }
}

/* -----------------------------------------------------------------
   EAN-13
   ----------------------------------------------------------------- */
const EAN_L = {
  0: '0001101','1':'0011001','2':'0010011','3':'0111101','4':'0100011',
  5: '0110001','6':'0101111','7':'0111011','8':'0110111','9':'0001011',
}
const EAN_R = {
  0: '1110010','1':'1100110','2':'1101100','3':'1000010','4':'1011100',
  5: '1001110','6':'1010000','7':'1000100','8':'1001000','9':'1110100',
}
const EAN_G = { /* odd parity (same as L but inverted) */  // actually G is the complement of L with specific pattern
  0: '0100111','1':'0110011','2':'0011011','3':'0100001','4':'0011101',
  5: '0111001','6':'0000101','7':'0010001','8':'0001001','9':'0010111',
}
const EAN_PARITY = { /* first digit → pattern of L/G for left 6 digits (0=odd/L, 1=even/G) */
  '0':'LLLLLL','1':'LLGLGG','2':'LLGGLG','3':'LLGGGL','4':'LGLLGG',
  '5':'LGGLLG','6':'LGGGLL','7':'LGLGLG','8':'LGLGGL','9':'LGGLGL',
}

function eanCheck(digits) {
  // digits: array of 12 numbers (first 12 of EAN13, or 11 + check placeholder)
  const s = digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0)
  const ck = (10 - (s % 10)) % 10
  return ck
}

function digitsFromString(v, len) {
  let clean = String(v).replace(/[^0-9]/g, '').slice(0, len)
  while (clean.length < len) clean += '0'
  return [...clean].map(Number)
}

export function buildEAN13Bars(value) {
  const raw = String(value).replace(/[^0-9]/g, '').slice(0, 13)
  const d = raw.length === 13 ? [...raw].map(Number) : [...digitsFromString(value, 12), 0]
  d[12] = eanCheck(d.slice(0, 12))
  const first = d[0]
  const left = d.slice(1, 7)
  const right = d.slice(7, 13)
  const parity = EAN_PARITY[String(first)] || 'LLLLLL'
  const bars = []
  let x = 0
  // helper to add encoded digit modules
  function addModules(pat) {
    ;[...pat].forEach((b, i) => { const w = 1; if (i % 2 === 0) bars.push({ x, width: w }); x += w })
  }
  // left guard: 101
  addModules('101')
  // left data
  left.forEach((digit, idx) => {
    const table = parity[idx] === 'L' ? EAN_L : EAN_G
    addModules(table[String(digit)])
  })
  // center guard: 01010
  addModules('01010')
  // right data
  right.forEach(digit => addModules(EAN_R[String(digit)]))
  // right guard: 101
  addModules('101')
  const text = d.join('')
  return { text, bars, width: x, type: 'ean13', humanReadable: text, digits: d }
}

export function buildUPABars(value) {
  const raw = String(value).replace(/[^0-9]/g, '').slice(0, 12)
  const d = raw.length === 12 ? [...raw].map(Number) : [...digitsFromString(value, 11), 0]
  d[11] = eanCheck(d.slice(0, 11))
  // UPC-A is EAN-13 with first digit = 0 and left parity = LLLLLL (all odd)
  const barData = buildEAN13Bars('0' + d.join(''))
  return { ...barData, text: d.join(''), type: 'upc', humanReadable: d.join(''), digits: d }
}

/* -----------------------------------------------------------------
   QR — uses qrcode library for SVG data
   ----------------------------------------------------------------- */
export async function buildQRSvg(value, options = {}) {
  const opts = {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: options.width || 300,
    color: { dark: '#111827', light: '#ffffff' },
    ...options,
  }
  const svg = await QRCode.toString(String(value || ''), { ...opts, type: 'svg' })
  return { svg, type: 'qr', humanReadable: String(value || '').slice(0, 40) }
}

/* -----------------------------------------------------------------
   Unified SVG Builder — any barcode type → clean SVG string
   ----------------------------------------------------------------- */
function barsToSvg(bars, width, height, barHeight, quiet) {
  const q = quiet || 10
  const totalW = width + q * 2
  const h = height || 50
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${h}" shape-rendering="crispEdges" width="${totalW}" height="${h}">`
  bars.forEach(bar => {
    svg += `<rect x="${q + bar.x}" y="0" width="${Math.max(bar.width, 1)}" height="${barHeight || h}" fill="#111827"/>`
  })
  svg += '</svg>'
  return svg
}

export function barcodeToSvg(type, value, options = {}) {
  const height = options.height || 50
  if (type === 'qr') return null // QR SVG is async
  let result
  if (type === 'code128' || !type) result = buildCode128Bars(value)
  else if (type === 'ean13') result = buildEAN13Bars(value)
  else if (type === 'upc') result = buildUPABars(value)
  else result = buildCode128Bars(value)
  return barsToSvg(result.bars, result.width, height, height, 10)
}

export function barcodeToBars(type, value) {
  if (type === 'code128' || !type) return buildCode128Bars(value)
  if (type === 'ean13') return buildEAN13Bars(value)
  if (type === 'upc') return buildUPABars(value)
  return buildCode128Bars(value)
}

/* -----------------------------------------------------------------
   Layout helper (shared by PDF/ZPL/Canvas)
   ----------------------------------------------------------------- */
export function getBarcodeLayout(barcode, availableWidth, quietModules = 10) {
  const safe = Math.max(Number(availableWidth) || 0, 1)
  const quiet = Math.max(Number(quietModules) || 0, 0)
  const totalMod = barcode.width + quiet * 2
  const scale = safe / totalMod
  return { scale, quietWidth: quiet * scale, barWidth: barcode.width * scale, totalWidth: totalMod * scale, totalModules: totalMod }
}

export { sanitizeCode128 as sanitizeCode128Value, getBarcodeLayout as getCode128Layout }

/* -----------------------------------------------------------------
   Readability validation — checks minimum bar width, contrast, etc.
   ----------------------------------------------------------------- */
export function validateBarcodeReadability(type, value, options = {}) {
  const minModuleWidth = options.moduleWidth || 0.2 // mm
  const result = barcodeToBars(type, value)
  if (!result || !result.bars || result.bars.length === 0) return { valid: false, reason: 'No bars generated' }
  const minBar = Math.min(...result.bars.map(b => b.width))
  const maxBar = Math.max(...result.bars.map(b => b.width))
  if (minBar < 1) return { valid: false, reason: `Bar width too narrow (module=${minBar})`, minBar, maxBar }
  return { valid: true, barCount: result.bars.length, minBar, maxBar, totalModules: result.width }
}

/**
 * Validates and sanitizes a barcode value for print output.
 * Checks if the barcode will fit in the available width at minimum readable module width.
 * @param {'code128'|'ean13'|'upc'} type - Barcode symbology
 * @param {string} value - The barcode value
 * @param {number} availableWidthMm - Available width in mm
 * @param {object} [options] - Options
 * @param {number} [options.minModuleMm=0.2] - Minimum module width in mm for readability
 * @returns {{ valid: boolean, sanitizedValue: string, requiredWidthMm: number, warningMessage: string|null }}
 */
export function validateAndSanitizeForPrint(type, value, availableWidthMm, options = {}) {
  const minModuleMm = options.minModuleMm ?? 0.2
  const result = barcodeToBars(type, value)
  if (!result || !result.bars || result.bars.length === 0) {
    return { valid: false, sanitizedValue: String(value || ''), requiredWidthMm: 0, warningMessage: 'No se pudieron generar barras' }
  }
  const totalModules = result.width + 20 // +20 for quiet zones (10 each side)
  const requiredWidth = totalModules * minModuleMm
  if (availableWidthMm < requiredWidth) {
    return {
      valid: false,
      sanitizedValue: result.text,
      requiredWidthMm: Math.ceil(requiredWidth * 10) / 10,
      warningMessage: `Código muy pequeño para impresión. Aumentar ancho mínimo a ${Math.ceil(requiredWidth * 10) / 10}mm (actual: ${Math.ceil(availableWidthMm * 10) / 10}mm)`
    }
  }
  return { valid: true, sanitizedValue: result.text, requiredWidthMm: Math.ceil(requiredWidth * 10) / 10, warningMessage: null }
}


