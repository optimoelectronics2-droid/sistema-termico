/**
 * normalPrinterService.js
 * Cliente del agente local para impresoras normales (láser/inyección, Carta/A4).
 * - Con agente: impresión directa al spooler del SO sin window.print() ni diálogos.
 * - Sin agente: fallback honesto a window.print() con mensaje claro (limitación de seguridad del navegador).
 *
 * Análogo a thermalPrinterService.js pero para el caso 'normal'.
 */

import { buildCleanInvoicePdf } from '../components/invoice/invoicePdf'
import * as printAgentClient from './printAgentClient'
import { detectPrinterKind } from './printerProfile'
import { printInvoiceThermal } from './thermalPrinterService'

const NORMAL_PROFILE_KEY = 'erp.normalPrinterProfile'

const DEFAULT_NORMAL_PROFILE = {
  printerName: '',
  paperSize: 'Letter', // Letter | A4
  orientation: 'portrait', // portrait | landscape
  copies: 1,
}

export function getNormalProfile() {
  try {
    return { ...DEFAULT_NORMAL_PROFILE, ...JSON.parse(localStorage.getItem(NORMAL_PROFILE_KEY) || 'null') }
  } catch {
    return { ...DEFAULT_NORMAL_PROFILE }
  }
}

export function saveNormalProfile(profile) {
  try {
    localStorage.setItem(NORMAL_PROFILE_KEY, JSON.stringify({ ...DEFAULT_NORMAL_PROFILE, ...profile }))
  } catch { /* storage no disponible */ }
}

export function clearNormalProfile() {
  try { localStorage.removeItem(NORMAL_PROFILE_KEY) } catch { /* ignore */ }
}

/**
 * Lista impresoras normales reales vía agente.
 * @returns {Promise<Array>} lista de impresoras con kind === 'normal' (nombre, driver, etc.)
 */
export async function listNormalPrinters() {
  if (!printAgentClient.isAgentConnected()) {
    // Sin agente no podemos enumerar impresoras del SO; retornamos lista vacía y se informará en UI
    return []
  }
  try {
    const printers = await printAgentClient.listNormalPrintersViaAgent()
    // Filt rar opcionalmente por detectPrinterKind ya lo hace el agente, pero reforzamos
    return Array.isArray(printers) ? printers : []
  } catch {
    return []
  }
}

/**
 * Lista TODAS las impresoras vía agente (térmicas + normales) para UI combinada.
 */
export async function listAllPrintersViaAgent() {
  if (!printAgentClient.isAgentConnected()) return []
  try {
    return await printAgentClient.listPrintersViaAgent()
  } catch {
    return []
  }
}

function findPreviewForPdf() {
  const byData = document.querySelectorAll('[data-invoice-preview]')
  for (let i = byData.length - 1; i >= 0; i--) {
    const el = byData[i]
    if (el && el.getBoundingClientRect().width > 0) return el
  }
  if (byData.length) return byData[byData.length - 1]
  return document.getElementById('invoice-preview') || document.querySelector('[id^="invoice-preview-"]')
}

function canSilentPrint() {
  return printAgentClient.isAgentConnected()
}

// Respaldo común para cualquier fallo de impresión silenciosa. Mantiene la
// factura actual en el flujo de impresión y nunca dispara una descarga.
async function openBrowserPrintDialog(sourceElement) {
  const el = sourceElement || findPreviewForPdf()
  try {
    const pdfInstance = await buildCleanInvoicePdf(el)
    if (pdfInstance) {
      pdfInstance.autoPrint()
      // Data URI en vez de Blob URL (misma razon: particion de almacenamiento de Chrome).
      const url = pdfInstance.output('datauristring')
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      frame.src = url
      document.body.appendChild(frame)
      frame.onload = () => {
        // No caer a window.print() de la aplicación: ese respaldo imprime el
        // dashboard en vez de la factura. El iframe contiene solo el PDF.
        try { frame.contentWindow?.focus(); frame.contentWindow?.print() } catch { /* no imprimir la página principal */ }
        window.setTimeout(() => { frame.remove() }, 4000)
      }
      return { ok: false, via: 'dialog', error: 'Impresión silenciosa no disponible; se abrió el diálogo de impresión de tu sistema.', silent: false, fallbackToDialog: true }
    }
  } catch {
    // El último respaldo sigue siendo el diálogo del documento actual.
  }
  return { ok: false, via: 'config', error: 'No hay una vista de factura lista para abrir el diálogo de impresión.', silent: false, fallbackToDialog: false }
}

/**
 * Imprime factura en impresora normal.
 * - Con agente: envía PDF base64 al agente, que lo manda al spooler sin diálogo (Windows: pdf-to-printer / Sumatra, macOS/Linux: lp -d).
 * - Sin agente: fallback a window.print() con aviso honesto (no se puede evitar el diálogo por seguridad del navegador).
 *
 * @param {object} opts
 * @param {string} opts.printerName - nombre exacto del SO (requerido para silencioso)
 * @param {string} opts.paperSize - Letter|A4
 * @param {string} opts.orientation - portrait|landscape
 * @param {number} opts.copies
 * @param {HTMLElement} opts.sourceElement - opcional, elemento a capturar si hay varios
 */
export async function printInvoiceNormal({
  printerName,
  paperSize,
  orientation,
  copies,
  sourceElement,
} = {}) {
  const profile = getNormalProfile()
  const finalPrinter = printerName || profile.printerName
  const finalPaper = paperSize || profile.paperSize || 'Letter'
  const finalOrientation = orientation || profile.orientation || 'portrait'
  const finalCopies = Math.max(1, Number(copies ?? profile.copies) || 1)

  // ── Ruta silenciosa vía agente ──
  if (canSilentPrint()) {
    if (!finalPrinter) {
      return openBrowserPrintDialog(sourceElement)
    }
    try {
      // Genera PDF desde el DOM actual
      const el = sourceElement || findPreviewForPdf()
      const pdfInstance = await buildCleanInvoicePdf(el)
      if (!pdfInstance) {
        return openBrowserPrintDialog(sourceElement)
      }
      // Si el agente prefiere blob directo, lo enviamos como base64 vía printPdfViaAgent
      const res = await printAgentClient.printPdfViaAgent({
        pdf: pdfInstance,
        printerName: finalPrinter,
        copies: finalCopies,
        paperSize: finalPaper,
        orientation: finalOrientation,
      })
      // Persistir elección
      saveNormalProfile({ printerName: finalPrinter, paperSize: finalPaper, orientation: finalOrientation, copies: finalCopies })
      return { ok: true, via: 'agent', device: finalPrinter, raw: res, silent: true }
    } catch (error) {
      const msg = String(error?.message || error)
      const fallback = await openBrowserPrintDialog(sourceElement)
      return { ...fallback, error: `No se pudo imprimir silenciosamente${finalPrinter ? ` en "${finalPrinter}"` : ''}: ${msg}. Se abrió el diálogo de impresión.` }
    }
  }

  // ── Sin agente: NO existe forma de imprimir silencioso desde una pestaña del navegador ──
  // Limitación real de seguridad de TODOS los navegadores (Chrome/Firefox/Safari).
  // Fallback honesto: window.print() con aviso.
  return openBrowserPrintDialog(sourceElement)
}

/**
 * Totem de conveniencia: un solo botón "Imprimir" que decide ruta automáticamente según tipo detectado.
 * Analizado vía printerProfile.detectPrinterKind.
 * @param {object} opts
 * @param {object} opts.printer - objeto impresora detectada (debe tener name/vendorId etc.)
 * @param {object} opts.invoice, company, customer
 * @param {object} opts.thermalOptions - opciones térmicas si es thermal
 * @param {object} opts.normalOptions - opciones normales si es normal
 */
export async function printInvoiceAuto({ printer, invoice, company, customer, thermalOptions, normalOptions } = {}) {
  const kind = detectPrinterKind(printer || {})
  if (kind === 'thermal') {
    return printInvoiceThermal({ invoice, company, customer, ...thermalOptions })
  }
  return printInvoiceNormal({ invoice, company, customer, printerName: printer?.name || printer?.printerName || printer?.displayName || '', ...normalOptions })
}

export function isSilentNormalAvailable() {
  return printAgentClient.isAgentConnected()
}

export function getSilentPrintLimitationMessage() {
  if (isSilentNormalAvailable()) return ''
  return 'Se abrirá el diálogo de impresión de tu sistema para elegir impresora y confirmar.'
}

// Hook-friendly helper para UI
export function getNormalPrintStatus() {
  const connected = printAgentClient.isAgentConnected()
  return {
    silent: connected,
    message: connected
      ? 'Impresión directa disponible.'
      : 'La impresión usará el diálogo del sistema.',
    limitation: getSilentPrintLimitationMessage(),
  }
}
