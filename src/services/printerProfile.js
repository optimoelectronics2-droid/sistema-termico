/**
 * printerProfile.js
 * Clasifica una impresora detectada como 'thermal' o 'normal'.
 * Usa heurísticas explícitas basadas en nombre, vendorId y metadata del agente local.
 * NUNCA inventa modelos: solo clasifica a partir de datos reales.
 */

// Vendors conocidos de térmicas (VID hex). Se usa también para thermalPrinterService.
// Esta lista es heurística, no definitiva.
const THERMAL_VENDOR_IDS = new Set([
  0x04b8, // Epson TM-
  0x0519, // Star Micronics
  0x154f, // Bixolon
  0x28e9, // Xprinter / Rongta / Gainscha (genéricos chinos suelen usar este VID)
  0x0a5f, // Zebra
  0x1e17, // Citizen
  0x067b, // Prolific genérico (algunas térmicas serie)
  0x0416, // Winbond genérico
])

// Substrings de nombres comerciales térmicos (lowercase)
const THERMAL_NAME_KEYWORDS = [
  'epson tm-',
  'epson tm ',
  'tm-t20',
  'tm-t88',
  'tm-m30',
  'tm-u220',
  'star',
  'mcp',
  'tsp100',
  'tsp143',
  'bixolon',
  'srp-',
  'xprinter',
  'xp-',
  'zebra',
  'zd',
  'zq',
  'gk420',
  'citizen',
  'ct-s',
  'pos-',
  'pos80',
  'pos58',
  'pos 80',
  'pos 58',
  '80mm',
  '58mm',
  'pos',
  'etiqueta',
  'label',
  'rongta',
  'gainscha',
  'gs-',
  '2connet',
  'agiler',
  'thermal',
  'ticket',
  'recibo',
  'receipt',
]

const THERMAL_PROTOCOL_HINTS = new Set(['escpos', 'zpl', 'epl', 'tspl', 'cpcl', 'escpos-usb', 'zpl-usb'])

/**
 * @param {object} printerInfo - metadata real de la impresora (del agente o de WebUSB/WebSerial)
 *   Puede contener: name, productName, displayName, vendorId, productId, driverName, portName, protocol, kind, connection
 * @returns {'thermal'|'normal'}
 */
export function detectPrinterKind(printerInfo = {}) {
  if (!printerInfo || typeof printerInfo !== 'object') return 'normal'

  const name = String(
    printerInfo.name ||
    printerInfo.productName ||
    printerInfo.displayName ||
    printerInfo.printerName ||
    printerInfo.deviceName ||
    '',
  ).toLowerCase()

  const vendorIdRaw = printerInfo.vendorId ?? printerInfo.vid ?? printerInfo.vendorID
  const vendorIdNum = vendorIdRaw != null ? Number(vendorIdRaw) : NaN
  const vendorIdHex = Number.isFinite(vendorIdNum)
    ? `0x${vendorIdNum.toString(16).padStart(4, '0')}`
    : ''

  const driverName = String(printerInfo.driverName || printerInfo.driver || '').toLowerCase()
  const protocol = String(printerInfo.protocol || '').toLowerCase()
  const kindHint = String(printerInfo.kind || printerInfo.type || '').toLowerCase()
  const portName = String(printerInfo.portName || printerInfo.port || '').toLowerCase()

  // 1) Si el agente ya nos dice explícitamente el tipo, respetarlo
  if (kindHint === 'thermal' || kindHint === 'receipt' || kindHint === 'label') return 'thermal'
  if (kindHint === 'normal' || kindHint === 'laser' || kindHint === 'inkjet' || kindHint === 'office') return 'normal'

  // 2) VID conocido térmico -> thermal (heurística fuerte)
  if (Number.isFinite(vendorIdNum) && THERMAL_VENDOR_IDS.has(vendorIdNum)) return 'thermal'
  if (vendorIdHex && THERMAL_VENDOR_IDS.has(Number(vendorIdHex))) return 'thermal'

  // 3) Nombre contiene keyword térmico -> thermal
  for (const kw of THERMAL_NAME_KEYWORDS) {
    if (name.includes(kw)) return 'thermal'
    if (driverName.includes(kw)) return 'thermal'
  }

  // 4) Protocolo térmico explícito -> thermal
  if (THERMAL_PROTOCOL_HINTS.has(protocol)) return 'thermal'

  // 5) Puerto 9100 / raw / thermal sugiere térmica de red, y archivos .prn con nombre pos
  if (
    portName.includes('9100') ||
    portName.includes('_9100') ||
    portName.includes(':9100') ||
    portName.includes('thermal') ||
    portName.includes('escpos') ||
    portName.includes('zpl') ||
    (portName.includes('.prn') && (name.includes('pos') || name.includes('80mm') || name.includes('58mm') || name.includes('thermal')))
  ) {
    return 'thermal'
  }

  // 6) Cualquier otra impresora reportada por el SO (vía pdf-to-printer.getPrinters() / lpstat / Get-Printer)
  // que NO matcheó lo anterior se considera 'normal' (láser/inyección, A4/Carta)
  // Esto incluye: HP, Canon, Brother, Epson EcoTank/WorkForce, etc.
  return 'normal'
}

/**
 * Totem de utilidad: filtra una lista y separa térmicas vs normales
 */
export function partitionPrintersByKind(printers = []) {
  const thermal = []
  const normal = []
  for (const p of printers) {
    if (detectPrinterKind(p) === 'thermal') thermal.push(p)
    else normal.push(p)
  }
  return { thermal, normal }
}

export const THERMAL_KEYWORDS = THERMAL_NAME_KEYWORDS
export const THERMAL_VENDORS = [...THERMAL_VENDOR_IDS]
