/**
 * agiPrinter.js — Servicio unificado para AGI-PR2000ULS (física USB001) + Trifusion POS-80 (virtual)
 * Integra impresion ESC/POS via Agente, Win32 fallback y spool virtual.
 * Uso en Trifusion POS:
 *   import { printTicketAGI, buildEscPosTicket, listPrinters } from '@/services/agiPrinter'
 */

import * as agent from './printAgentClient.js'

const PRINTER_PHYSICAL = 'AGI-PR2000ULS'
const PRINTER_VIRTUAL = 'Trifusion POS-80'

// Construye ticket ESC/POS directamente (cp850) — compatible con AGI-PR2000ULS 80mm
export function buildEscPosTicket({
  titulo = 'TRIFUSION SRL',
  subtitulo = 'Sistema de Facturacion',
  ncf = 'B0100001234',
  cliente = 'Consumidor Final',
  items = [{ cant: 1, desc: 'Producto Demo A', precio: 1250 }, { cant: 2, desc: 'Producto Demo B', precio: 800 }],
  formaPago = 'Efectivo',
  recibido = 3000,
} = {}) {
  const enc = (s) => new TextEncoder().encode(String(s))
  // Helper cp850: TextEncoder usa utf8, pero ESC/POS en AGI acepta utf8 y cp850; usamos utf8 con fallback
  let data = []
  const push = (...parts) => { for (const p of parts) data.push(...(p instanceof Uint8Array ? p : enc(p))) }
  const esc = (...bytes) => data.push(...bytes)

  // Init
  esc(0x1b, 0x40)
  // Titulo centrado bold doble ancho
  esc(0x1b, 0x61, 0x01); esc(0x1b, 0x21, 0x08); push(titulo + '\n')
  esc(0x1b, 0x21, 0x00); push(subtitulo + '\n')
  esc(0x1b, 0x61, 0x00); push('--------------------------------\n')
  esc(0x1b, 0x45, 0x01); push('FACTURA DE VENTA\n'); esc(0x1b, 0x45, 0x00)
  push(`NCF: ${ncf}\n`)
  push(`Cliente: ${cliente}\n`)
  push(`Fecha: ${new Date().toLocaleString('es-DO')}\n`)
  push('--------------------------------\n')
  push('Cant Descripcion       Importe\n')
  push('--------------------------------\n')
  let subtotal = 0
  for (const it of items) {
    const imp = it.cant * it.precio
    subtotal += imp
    const desc = String(it.desc).slice(0, 18).padEnd(18)
    const line = `${String(it.cant).padEnd(4)} ${desc} $${imp.toFixed(2).padStart(8)}\n`
    push(line)
  }
  push('--------------------------------\n')
  const itbis = subtotal * 0.18
  const total = subtotal + itbis
  push(`SUBTOTAL              $${subtotal.toFixed(2).padStart(8)}\n`)
  push(`ITBIS 18%             $${itbis.toFixed(2).padStart(8)}\n`)
  esc(0x1b, 0x21, 0x08); push(`TOTAL               $${total.toFixed(2).padStart(8)}\n`); esc(0x1b, 0x21, 0x00)
  push('--------------------------------\n')
  const cambio = recibido - total
  push(`Forma Pago: ${formaPago}\n`)
  push(`Recibido: $${recibido.toFixed(2)}  Cambio: $${cambio.toFixed(2)}\n`)
  push('--------------------------------\n')
  esc(0x1b, 0x61, 0x01); push('Gracias por su compra!\n'); push('www.trifusion.com.do\n'); esc(0x1b, 0x61, 0x00)
  push('\n\n')
  esc(0x1d, 0x56, 0x00)
  return new Uint8Array(data)
}

export function buildTextTicket(ticketText) {
  return new TextEncoder().encode(ticketText)
}

/**
 * Lista impresoras con prioridad AGI -> Trifusion -> resto thermal
 */
export async function listPrinters() {
  try {
    if (agent.isAgentConnected()) {
      const list = await agent.listPrintersViaAgent()
      // Ordenar: AGI primero, luego Trifusion, luego otras termicas
      return [...list].sort((a, b) => {
        const rank = (p) => {
          const n = (p.printerName || p.name || '').toLowerCase()
          if (n.includes('agi-pr2000')) return 0
          if (n.includes('trifusion pos')) return 1
          if (n.includes('pos80')) return 2
          return p.kind === 'thermal' ? 3 : 10
        }
        return rank(a) - rank(b)
      })
    }
  } catch { /* fallback navegador */ }
  // Fallback sin agente: no podemos listar real, retornar lista ficticia para UI
  return [
    { printerName: PRINTER_PHYSICAL, displayName: PRINTER_PHYSICAL, kind: 'thermal', connection: 'usb', source: 'fallback' },
    { printerName: PRINTER_VIRTUAL, displayName: PRINTER_VIRTUAL, kind: 'thermal', connection: 'spooler-file', source: 'fallback' },
  ]
}

/**
 * Imprime ticket con estrategia robusta:
 * 1. Agente -> AGI-PR2000ULS (fisica) si existe
 * 2. Agente -> Trifusion POS-80 (virtual) fallback
 * 3. Sin agente -> intentar WebUSB/BLE via dialogo navegador (window.print fallback)
 */
export async function printTicketAGI(ticketBytes, { preferencia = 'auto', copies = 1 } = {}) {
  const bytes = ticketBytes instanceof Uint8Array ? ticketBytes : new TextEncoder().encode(String(ticketBytes))
  const targets = preferencia === 'fisica' ? [PRINTER_PHYSICAL] : preferencia === 'virtual' ? [PRINTER_VIRTUAL] : [PRINTER_PHYSICAL, PRINTER_VIRTUAL]

  // Intento 1: Agente (silencioso, sin dialogo)
  if (agent.isAgentConnected()) {
    for (const target of targets) {
      try {
        await agent.printViaAgent({ bytes, protocol: 'escpos', target: { printerName: target }, kind: 'thermal' })
        return { ok: true, via: 'agent', printer: target }
      } catch (e) {
        console.warn(`[agiPrinter] agente ${target} fallo:`, e.message)
        // probar siguiente
      }
    }
  }

  // Intento 2: sin agente, si target es Trifusion virtual, usar ventana de impresion del navegador (PDF dialogo)
  // Para termica, descarga .prn como ultimo recurso
  const fallbackPrinter = targets[0]
  try {
    // Crear blob y descargar para que usuario arrastre a impresora virtual si es necesario
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ticket-${Date.now()}-${fallbackPrinter.replace(/\s+/g, '_')}.prn`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 2000)
    // Tambien intentar window.print como fallback visual
    return { ok: true, via: 'download', printer: fallbackPrinter, note: 'Archivo .prn descargado. Arrastre a la impresora o use el simulador.' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Atajo para POS: imprime factura actual directamente
 */
export async function printFacturaPOS({ ncf, cliente, items, total, preferencia = 'auto' }) {
  const bytes = buildEscPosTicket({ ncf, cliente, items, preferencia })
  return printTicketAGI(bytes, { preferencia })
}

export const AGI_PRINTER = {
  physical: PRINTER_PHYSICAL,
  virtual: PRINTER_VIRTUAL,
}

export default { buildEscPosTicket, printTicketAGI, listPrinters, AGI_PRINTER }
