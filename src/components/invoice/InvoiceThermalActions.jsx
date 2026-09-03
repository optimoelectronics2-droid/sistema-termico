import { useEffect, useId, useMemo, useState } from 'react'
import { AlertTriangle, Bluetooth, Cable, Check, Cpu, Download, FileText, Monitor, Network, PenLine, Plus, Printer, RefreshCw, RotateCcw, Ruler, Save, ScanSearch, Settings2, TestTube2, Trash2, Usb, Wrench, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { useToast } from '../../hooks/useToast'
import {
  addBluetoothPrinter,
  addThermalPrinter,
  clearThermalProfile,
  detectThermalPrinter,
  getThermalProfile,
  listThermalDevices,
  printInvoiceThermal,
  printThermalTest,
  printThermalViaBrowser,
  saveThermalProfile,
} from '../../services/thermalPrinterService'
import {
  buildInvoiceCpcl,
  buildInvoiceEpl,
  buildInvoiceEscpos,
  buildInvoiceEscposModern,
  buildInvoiceTspl,
  buildInvoiceZpl,
  downloadThermalFile,
  THERMAL_CONNECTIONS,
  THERMAL_PROTOCOLS,
  thermalModeFromSettings,
} from '../../lib/invoiceThermal'
import { downloadReceiptPdf } from '../../lib/receiptPdf'
import { detectPrinterKind } from '../../services/printerProfile'
import { getNormalProfile, saveNormalProfile, printInvoiceNormal } from '../../services/normalPrinterService'
import { usePrinterWatcher } from '../../hooks/usePrinterWatcher'
import { lockBodyScroll, unlockBodyScroll } from '../../hooks/useLockBodyScroll'

const INVOICE_BUILDERS = { escpos: buildInvoiceEscpos, zpl: buildInvoiceZpl, epl: buildInvoiceEpl, tspl: buildInvoiceTspl, cpcl: buildInvoiceCpcl }
const PAPER_WIDTHS = [
  { id: '58', label: '58 mm', mm: 58 },
  { id: '80', label: '80 mm', mm: 80 },
  { id: '112', label: '112 mm', mm: 112 },
  { id: 'custom', label: 'Personalizado', mm: 80 },
]
const CUT_MODES = [
  { id: 'none', label: 'Sin corte' },
  { id: 'partial', label: 'Parcial' },
  { id: 'full', label: 'Completo' },
]
const FONT_SCALES = [
  { id: 0, label: 'Normal' },
  { id: 1, label: 'Doble alto' },
  { id: 2, label: 'Doble ancho' },
  { id: 3, label: 'Doble A x A' },
]
const COLUMN_MODES = [
  { id: '2', label: '2 columnas', sub: 'Compacto' },
  { id: '3', label: '3 columnas', sub: 'Detallado' },
]
const NORMAL_PAPER_SIZES = [
  { id: 'Letter', label: 'Carta (Letter)' },
  { id: 'A4', label: 'A4' },
]
const NORMAL_ORIENTATIONS = [
  { id: 'portrait', label: 'Vertical' },
  { id: 'landscape', label: 'Horizontal' },
]

function normalizePrinterKey(name = '') {
  return String(name || '').toLowerCase().trim().replace(/\s+usb$/i, '').replace(/\s*\(usb\)\s*$/i, '').replace(/\s*-\s*usb\s*$/i, '').replace(/\s+/g, ' ').trim()
}
function portScore(port = '') {
  const p = String(port || '').toLowerCase()
  if (p.includes('usb')) return 3
  if (p.includes('9100')) return 3
  if (p.startsWith('com')) return 2
  if (p.includes('spool') && p.endsWith('.prn')) return 1
  if (p.includes('wsd')) return 0
  if (p.includes('portprompt') || p.includes('nul:') || p.includes('shrfax') || p.includes('ad_port')) return -1
  if (!p) return -2
  return 0
}
function dedupPrinters(list = []) {
  const map = new Map()
  for (const p of list) {
    const rawName = p.printerName || p.productName || p.displayName || p.name || ''
    const key = normalizePrinterKey(rawName)
    if (!key) continue
    const existing = map.get(key)
    if (!existing) map.set(key, p)
    else {
      const sNew = portScore(p.portName || p.port || '')
      const sOld = portScore(existing.portName || existing.port || '')
      if (sNew > sOld) map.set(key, p)
    }
  }
  return Array.from(map.values())
}

function viaLabel(via) {
  return { usb: 'USB', bluetooth: 'Bluetooth', serial: 'Puerto serial', network: 'Red/LAN', download: 'Descarga', file: 'Archivo', config: 'Configuracion', agent: 'Agente', spooler: 'Spooler', dialog: 'Diálogo sistema' }[via] || via
}

function protocolLabel(id) {
  return THERMAL_PROTOCOLS.find((item) => item.id === id)?.label || String(id || '').toUpperCase()
}

function Segmented({ options, value, onChange, columns = 5 }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button key={option.id} type="button" onClick={() => onChange(option.id)} className="rounded-lg border px-1.5 py-1.5 text-center transition-all" style={{ borderColor: value === option.id ? 'var(--blue)' : 'var(--line-subtle)', background: value === option.id ? 'var(--bg-row-hover)' : 'var(--bg-input)' }}>
          <span className="block text-xs font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{option.label}</span>
          {option.sub ? <span className="block text-[10px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>{option.sub}</span> : null}
        </button>
      ))}
    </div>
  )
}

function Switch({ label, sub, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all hover:opacity-90" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
      <span className="flex flex-col items-start">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {sub ? <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{sub}</span> : null}
      </span>
      <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ background: checked ? 'var(--blue)' : 'rgba(255,255,255,.16)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: checked ? 18 : 2 }} />
      </span>
    </button>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-surface)' }}>
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
        <Icon size={13} /> {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function InvoiceThermalActions({ invoice, company, customer, qrText = '' }) {
  const toast = useToast()
  const reactId = useId()
  const base = reactId.replace(/:/g, '-')
  const ids = {
    mode: `thermal-mode-${base}`,
    width: `thermal-width-${base}`,
    customWidth: `thermal-custom-width-${base}`,
    fontScale: `thermal-font-scale-${base}`,
    lineSpacing: `thermal-line-spacing-${base}`,
    networkHost: `thermal-network-host-${base}`,
    networkPort: `thermal-network-port-${base}`,
    baudRate: `thermal-baud-rate-${base}`,
    drawer: `thermal-drawer-${base}`,
    normalPrinter: `normal-printer-${base}`,
    normalPaper: `normal-paper-${base}`,
    normalOrientation: `normal-orientation-${base}`,
    normalCopies: `normal-copies-${base}`,
    manualThermalPrinter: `manual-thermal-printer-${base}`,
    manualNormalPrinter: `manual-normal-printer-${base}`,
    printMode: `print-mode-${base}`,
  }

  const [profile, setProfile] = useState(() => ({ ...getThermalProfile() }))
  const [normalProfile, setNormalProfile] = useState(() => ({ ...getNormalProfile() }))
  const [deviceInfo, setDeviceInfo] = useState(() => {
    const saved = getThermalProfile()
    return saved?.productName ? `${saved.productName} · ${String(saved.protocol || '').toUpperCase()}` : ''
  })
  const [manual, setManual] = useState(() => Boolean(getThermalProfile()?.manualProtocol))
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [devices, setDevices] = useState([])

  // Sin auto-conexion al agente: impresion profesional por dialogo del sistema.
  // El WebSocket solo se abre por gesto explicito del usuario (Conectar).
  const watcher = usePrinterWatcher({ autoConnectAgent: false })
  const agentConnected = watcher.agentConnected
  const allPrinters = watcher.printers

  // Honest capability detection
  const caps = useMemo(() => ({
    usb: typeof navigator !== 'undefined' && !!navigator.usb,
    serial: typeof navigator !== 'undefined' && !!navigator.serial,
    bluetooth: typeof navigator !== 'undefined' && !!navigator.bluetooth,
    agent: agentConnected,
  }), [agentConnected])

  // Effective printer kind: based on selected printer (profile) + watcher list
  const effectiveKind = useMemo(() => {
    // If user has selected a device that matches a watcher entry, use that entry's kind
    const selectedRaw = allPrinters.find((p) =>
      (profile.vendorId && Number(p.vendorId) === Number(profile.vendorId) && String(p.displayName || p.name) === String(profile.productName)) ||
      (profile.vendorId && Number(p.vendorId) === Number(profile.vendorId)) ||
      (profile.printerName && String(p.printerName || p.name) === String(profile.printerName)) ||
      (normalProfile.printerName && String(p.printerName || p.name) === String(normalProfile.printerName))
    )
    if (selectedRaw) {
      const k = selectedRaw._kind || detectPrinterKind(selectedRaw)
      return k
    }
    // Fallback: detect from profile alone
    const fromThermal = detectPrinterKind({ name: profile.productName, vendorId: profile.vendorId, protocol: profile.protocol })
    // If there is a normal printer selected in normalProfile and no thermal selected, treat as normal
    if (normalProfile.printerName) {
      const normalMatch = allPrinters.find((p) => String(p.printerName || p.name) === String(normalProfile.printerName))
      if (normalMatch) return normalMatch._kind || detectPrinterKind(normalMatch)
      // If custom name not in list but agentConnected, respect that user wants normal path if thermal not strongly matched
      if (fromThermal === 'normal' || !profile.productName) return 'normal'
    }
    // If we have real printers list and all are normal, show normal UI
    if (allPrinters.length && allPrinters.every((p) => (p._kind || detectPrinterKind(p)) === 'normal')) return 'normal'
    return fromThermal
  }, [allPrinters, profile.productName, profile.vendorId, profile.protocol, profile.printerName, normalProfile.printerName])

  const isThermal = effectiveKind === 'thermal'
  const isNormal = effectiveKind === 'normal'

  const dedupedDevices = useMemo(() => dedupPrinters(devices), [devices])
  const dedupedAll = useMemo(() => dedupPrinters(allPrinters), [allPrinters])
  const filteredDevices = useMemo(() => {
    if (!dedupedDevices.length) return []
    if (profile.printMode === 'manual') return dedupedDevices
    const filtered = dedupedDevices.filter((d) => (d._kind || detectPrinterKind(d._raw || d)) === effectiveKind)
    return filtered.length ? filtered : dedupedDevices
  }, [dedupedDevices, effectiveKind, profile.printMode])
  const thermalCount = useMemo(() => dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'thermal').length, [dedupedAll])
  const normalCount = useMemo(() => dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'normal').length, [dedupedAll])

  useEffect(() => {
    if (!showModal) return
    let active = true
    listThermalDevices().then((list) => { if (active) setDevices(list) })
    // También sincronizar con watcher
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (watcher.printers.length) setDevices(watcher.printers.map((p) => ({
      vendorId: Number(p.vendorId || 0) || 0,
      productName: p.displayName || p.name || p.printerName || 'Impresora',
      protocol: p.protocol || detectPrinterKind(p) === 'thermal' ? 'escpos' : 'normal',
      _kind: p._kind || detectPrinterKind(p),
      _raw: p,
      printerName: p.printerName || p.name,
    })))
    return () => { active = false }
  }, [showModal, watcher.printers])

  useEffect(() => {
    if (!showModal) return
    const handler = (event) => { if (event.key === 'Escape') setShowModal(false) }
    lockBodyScroll()
    window.addEventListener('keydown', handler)
    return () => {
      unlockBodyScroll()
      window.removeEventListener('keydown', handler)
    }
  }, [showModal])

  // Mantener devices sincronizados en tiempo real sin abrir modal (para barra inferior)
  useEffect(() => {
    if (showModal) return
    // Actualizar deviceInfo si el agente reporta cambio y hay printer seleccionada
    if (agentConnected && allPrinters.length && profile.vendorId) {
      const match = allPrinters.find((p) => Number(p.vendorId) === Number(profile.vendorId))
      if (match && !deviceInfo) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDeviceInfo(`${match.displayName || match.name} · ${String(match.protocol || '').toUpperCase() || 'AGENTE'}`)
      }
    }
  }, [agentConnected, allPrinters, profile.vendorId, deviceInfo, showModal])

  function updateProfile(next) {
    setProfile((current) => {
      const merged = { ...current, ...next }
      saveThermalProfile(merged)
      return merged
    })
  }

  function updateNormal(next) {
    setNormalProfile((current) => {
      const merged = { ...current, ...next }
      saveNormalProfile(merged)
      return merged
    })
  }

  const activeProtocol = THERMAL_PROTOCOLS.find((item) => item.id === profile.protocol) || THERMAL_PROTOCOLS[0]
  const activeConnection = THERMAL_CONNECTIONS.find((item) => item.id === profile.connection) || THERMAL_CONNECTIONS[0]
  const paperWidthId = PAPER_WIDTHS.some((item) => item.id === profile.paperWidth) ? profile.paperWidth : 'custom'

  function currentOptions(extra = {}) {
    return {
      protocol: profile.protocol,
      connection: profile.connection,
      paperWidth: profile.paperWidth,
      customWidthMm: profile.customWidthMm,
      baudRate: profile.baudRate,
      networkHost: profile.networkHost,
      networkPort: profile.networkPort,
      printerName: profile.printerName || '',
      printMode: profile.printMode || 'auto',
      drawer: profile.drawer,
      drawerPulse: profile.drawerPulse,
      cut: profile.cut,
      logo: profile.logo,
      qrEnabled: profile.qrEnabled,
      barcode: profile.barcode,
      bold: profile.bold,
      fontScale: profile.fontScale,
      lineSpacing: profile.lineSpacing,
      columns: profile.columns,
      accentedText: profile.accentedText === true,
      ticketStyle: profile.ticketStyle || 'classic',
      manualProtocol: manual,
      ...extra,
    }
  }

  function refreshDevices() {
    listThermalDevices().then(setDevices)
  }

  async function handleDetect() {
    setBusy(true)
    try {
      const detected = await detectThermalPrinter()
      if (!detected) {
        toast.info('Se cancelo la seleccion de la impresora.')
        return
      }
      setProfile({ ...getThermalProfile() })
      setManual(false)
      setDeviceInfo(`${detected.productName} · ${String(detected.protocol || '').toUpperCase()}`)
      refreshDevices()
      toast.success(`Impresora agregada: ${detected.productName}. Protocolo ${String(detected.protocol || '').toUpperCase()} aplicado.`)
    } catch (error) {
      const msg = String(error.message || '')
      if (/driver de Windows|agente local|WinUSB/i.test(msg)) {
        toast.error(msg)
      } else {
        toast.error(error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleAddUsb() {
    setBusy(true)
    try {
      const added = await addThermalPrinter()
      if (!added) {
        toast.info('Se cancelo la seleccion de la impresora.')
        return
      }
      setProfile({ ...getThermalProfile() })
      setManual(false)
      setDeviceInfo(`${added.productName} · ${String(added.protocol || '').toUpperCase()}`)
      refreshDevices()
      toast.success(`Impresora agregada: ${added.productName}. De aqui en adelante imprime al instante sin dialogo.`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddBluetooth() {
    setBusy(true)
    try {
      const added = await addBluetoothPrinter()
      if (!added) {
        toast.info('Se cancelo la seleccion de la impresora Bluetooth.')
        return
      }
      setProfile({ ...getThermalProfile() })
      setManual(false)
      setDeviceInfo(`${added.productName} · BLUETOOTH`)
      toast.success(`Impresora Bluetooth agregada: ${added.productName}. Nota: si es Bluetooth clásico (SPP), emparéjela primero en el sistema operativo.`)
    } catch (error) {
      const msg = String(error.message || '')
      if (/Clásico|Bluetooth/i.test(msg)) {
        toast.error(msg)
      } else {
        toast.error(error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  function handleSelectDevice(device) {
    const kind = device._kind || detectPrinterKind(device._raw || device)
    if (kind === 'normal') {
      const printerName = device.printerName || device.productName
      updateNormal({ printerName })
      toast.success(`${device.productName} seleccionada (normal). Se imprimirá por el diálogo del sistema.`)
      return
    }
    updateProfile({ vendorId: device.vendorId, productName: device.productName, printerName: device.printerName || device.productName, protocol: device.protocol, connection: 'usb', manualProtocol: false })
    setManual(false)
    setDeviceInfo(`${device.productName} · ${String(device.protocol || '').toUpperCase()}`)
    toast.success(`${device.productName} seleccionada. Impresión ${device._kind === 'thermal' ? 'térmica' : 'normal'} lista.`)
  }

  async function handlePrint() {
    setBusy(true)
    try {
      // ── Ruta automática según tipo detectado ──
      if (isNormal) {
        const printerName = normalProfile.printerName || devices.find((d) => (d._kind || detectPrinterKind(d)) === 'normal')?.printerName || ''
        if (!printerName && !agentConnected) {
          toast.error('No hay impresora normal seleccionada. Se abrirá el diálogo del sistema para elegir impresora.')
          setShowModal(true)
          return
        }
        const result = await printInvoiceNormal({
          invoice, company, customer,
          printerName,
          paperSize: normalProfile.paperSize || 'Letter',
          orientation: normalProfile.orientation || 'portrait',
          copies: normalProfile.copies || 1,
        })
        if (result.ok) {
          toast.success(`Factura enviada a ${result.device} (directa).`)
        } else if (result.via === 'dialog' || result.fallbackToDialog) {
          toast.info(result.error || 'Se abrirá el diálogo de impresión de tu sistema para elegir impresora.')
        } else if (result.via === 'config') {
          toast.error(result.error || 'Falta configuración de impresora normal.')
          setShowModal(true)
        } else {
          toast.error(result.error || 'No se pudo imprimir la factura.')
          if (result.via === 'config') setShowModal(true)
        }
        return
      }

      // Térmica — impresión profesional: nunca descarga si es "Imprimir", siempre intenta diálogo/agente
      const result = await printInvoiceThermal({ invoice, company, customer, qrText, profileOverride: currentOptions() })
      if (result.ok) {
        if (result.protocol && result.protocol !== profile.protocol) {
          setProfile({ ...getThermalProfile() })
          toast.success(`Factura enviada a ${result.device} (${viaLabel(result.via)}). Protocolo ${String(result.protocol).toUpperCase()} aplicado por deteccion.`)
        } else {
          toast.success(`Factura enviada a ${result.device} (${viaLabel(result.via)}).`)
        }
      } else if (result.via === 'dialog') {
        toast.info(result.error || 'Se abrirá el diálogo del sistema: elija Trifusion POS-80 y confirme.')
        try { await printThermalViaBrowser({ invoice, company, customer, qrText }) } catch { /* El diálogo puede cancelarse sin interrumpir el flujo. */ }
      } else if (result.via === 'download') {
        toast.info(result.error || 'Se descargo el archivo termico.')
      } else if (result.via === 'agent' && result.error) {
        toast.error(result.error)
        if (String(result.error).includes('agente') || String(result.error).includes('driver')) setShowModal(true)
      } else if (result.via === 'config') {
        toast.error(result.error || 'No se pudo imprimir la factura.')
        setShowModal(true)
      } else {
        toast.error(result.error || 'No se pudo imprimir la factura.')
        if (result.via === 'config') setShowModal(true)
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setBusy(true)
    try {
      if (isNormal) {
        const printerName = normalProfile.printerName || devices.find((d) => (d._kind || detectPrinterKind(d)) === 'normal')?.printerName || ''
        if (!printerName) {
          toast.error('Seleccione primero la impresora normal en Configuración.')
          setShowModal(true)
          return
        }
        const res = await printInvoiceNormal({
          invoice: { number: 'PRUEBA-001', totals: { total: 0 }, items: [{ name: 'Prueba normal', quantity: 1, price: 0, net: 0, tax: 0 }] },
          company: company || { name: 'Prueba' },
          customer: customer || { name: 'Cliente Prueba' },
          printerName,
          paperSize: normalProfile.paperSize || 'Letter',
          orientation: normalProfile.orientation || 'portrait',
          copies: 1,
        })
        if (res.ok) toast.success(`Prueba enviada a ${res.device} sin diálogo.`)
        else toast.error(res.error || 'No se pudo enviar prueba normal.')
        return
      }
      const result = await printThermalTest({ profileOverride: currentOptions() })
      if (result.ok) {
        toast.success(`Prueba enviada a ${result.device} (${viaLabel(result.via)}). Verifique el ticket impreso.`)
      } else if (result.via === 'config' || result.via === 'agent') {
        toast.error(result.error || 'Falta configuracion de la impresora.')
        setShowModal(true)
      } else {
        toast.info(result.error || 'Se descargo la prueba termica.')
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    const paperWidth = profile.paperWidth === 'custom' ? String(profile.customWidthMm || 80) : profile.paperWidth
    await downloadReceiptPdf(invoice, company, customer, qrText, paperWidth)
    toast.success(`Recibo PDF (${paperWidth}mm) descargado — formato moderno listo para reimprimir.`)
  }

  function handleDownloadRaw() {
    const payload = { invoice, company, customer, qrText, paperWidth: profile.paperWidth === 'custom' ? String(profile.customWidthMm || 80) : profile.paperWidth, accentedText: profile.accentedText === true, ticketStyle: profile.ticketStyle || 'classic' }
    const isModern = (profile.ticketStyle || 'classic') === 'modern' && (profile.protocol || 'escpos') === 'escpos'
    const builder = isModern ? buildInvoiceEscposModern : (INVOICE_BUILDERS[profile.protocol] || buildInvoiceEscpos)
    downloadThermalFile(invoice, builder(payload), profile.protocol || 'escpos')
    toast.success(`Archivo crudo ${String(profile.protocol || 'escpos').toUpperCase()} descargado para ${activeProtocol.label}.`)
  }

  function handleResetAuto() {
    clearThermalProfile()
    const fallback = thermalModeFromSettings(company?.labelPrintMode)
    setProfile({ ...getThermalProfile(), protocol: fallback })
    setManual(false)
    setDeviceInfo('')
    toast.success('Configuracion manual descartada; se usara deteccion automatica por USB.')
  }

  function handleForget() {
    clearThermalProfile()
    setProfile({ ...getThermalProfile() })
    setManual(false)
    setDeviceInfo('')
    toast.success('Perfil de impresora olvidado.')
  }

  async function handleBrowserTicket() {
    setBusy(true)
    try {
      const res = await printThermalViaBrowser({ invoice, company, customer, qrText })
      if (res.via === 'config') toast.error(res.error)
      else toast.info(res.error || 'Se abrirá el diálogo del sistema: seleccione Trifusion POS-80 y confirme.')
    } catch (error) {
      toast.error(String(error.message || error))
    } finally { setBusy(false) }
  }

  // Impresion profesional: por dialogo del sistema. Sin banners de descarga.
  // Si el agente local esta conectado se indica; si no, se imprime igual por dialogo.
  const agentBanner = agentConnected ? (
    <span className="inline-flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium" style={{ borderColor: 'rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'rgb(167,243,208)' }}>
      <Check size={12} /> Impresora lista — impresión silenciosa disponible.
    </span>
  ) : null

  return (
    <div className="no-print mt-3 flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)' }}>
      <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}><Cpu size={13} /> Impresión {isNormal ? 'normal' : 'térmica'}</span>

      <div className="flex items-center gap-1 rounded-lg border px-1.5 py-1" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
        <span className="text-[10px] font-bold mr-1" style={{ color: 'var(--text-tertiary)' }}>Modo:</span>
        <button type="button" onClick={() => updateProfile({ printMode: 'auto' })} className={`rounded px-2 py-1 text-[11px] font-bold ${ (profile.printMode || 'auto') === 'auto' ? 'bg-white/15 text-white' : 'text-white/60'}`}>Automático</button>
        <button type="button" onClick={() => updateProfile({ printMode: 'manual' })} className={`rounded px-2 py-1 text-[11px] font-bold ${ profile.printMode === 'manual' ? 'bg-white/15 text-white' : 'text-white/60'}`}>Manual</button>
      </div>

      {/* Selector rápido: si hay ambas clases, permitir ver que se adapta */}
      {isThermal ? (
        <>
          <select id={ids.mode} name="thermal-protocol" value={profile.protocol || 'escpos'} onChange={(event) => updateProfile({ protocol: event.target.value, manualProtocol: true })} className="input-dark max-w-64 py-1.5 text-xs" aria-label="thermal-protocol" autoComplete="off">
            {THERMAL_PROTOCOLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select id={ids.width} name="thermal-width" value={paperWidthId} onChange={(event) => updateProfile({ paperWidth: event.target.value })} className="input-dark max-w-32 py-1.5 text-xs" aria-label="thermal-width" autoComplete="off">
            <option value="58">58 mm</option>
            <option value="80">80 mm</option>
            <option value="112">112 mm</option>
            <option value="custom">Personalizado</option>
          </select>
        </>
      ) : (
        <>
          <select id={ids.normalPrinter} name="normal-printer" value={normalProfile.printerName || ''} onChange={(event) => updateNormal({ printerName: event.target.value })} className="input-dark max-w-64 py-1.5 text-xs" aria-label="normal-printer" autoComplete="off">
            <option value="">Seleccione impresora del sistema</option>
            {(dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'normal').length ? dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'normal') : [{ name: normalProfile.printerName || 'Sin impresoras detectadas' }]).map((p) => {
              const label = p.displayName || p.name || p.printerName || 'Impresora'
              return <option key={label} value={p.printerName || label}>{label}</option>
            })}
          </select>
          <select id={ids.normalPaper} name="normal-paper-size" value={normalProfile.paperSize || 'Letter'} onChange={(event) => updateNormal({ paperSize: event.target.value })} className="input-dark max-w-32 py-1.5 text-xs" aria-label="normal-paper-size" autoComplete="off">
            {NORMAL_PAPER_SIZES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </>
      )}

      {(profile.printMode === 'manual') && (
        <div className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
          <span className="text-xs font-bold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Manual:</span>
          <input id={ids.manualThermalPrinter} value={profile.printerName || normalProfile.printerName || ''} onChange={(e) => {
            const v = e.target.value
            updateProfile({ printerName: v })
            updateNormal({ printerName: v })
          }} placeholder="Ej: Trifusion POS-80" className="flex-1 bg-transparent text-xs outline-none placeholder:text-white/30" aria-label="manual-printer-name" autoComplete="off" />
          <span className="text-[10px] hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>Escriba el nombre exacto como aparece en Windows (Panel de impresoras).</span>
        </div>
      )}

      <Button variant="ghost" icon={ScanSearch} onClick={handleDetect} disabled={busy}>Detectar impresora</Button>
      <Button variant="ghost" icon={Settings2} onClick={() => setShowModal(true)} disabled={busy}>Configuración</Button>
      <Button variant="primary" icon={Printer} onClick={handlePrint} disabled={busy}>Imprimir {profile.printMode === 'manual' ? 'manual' : 'auto'}</Button>
      <Button variant="ghost" icon={Printer} onClick={handleBrowserTicket} disabled={busy} title="Imprime ticket 80mm directo desde navegador (muestra diálogo para elegir Trifusion POS-80)">Ticket navegador</Button>
      <Button variant="ghost" icon={TestTube2} onClick={handleTest} disabled={busy}>Prueba</Button>
      <Button variant="ghost" icon={Download} onClick={handleDownload} disabled={busy}>Descargar PDF</Button>

      <span className="w-full text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {isThermal ? (
          manual
            ? `Configuración manual: ${activeProtocol.label} · ${activeConnection.label}${activeConnection.id === 'serial' ? ` · ${profile.baudRate || 9600} baudios` : ''} · ${paperWidthId === 'custom' ? `${profile.customWidthMm || 80} mm` : paperWidthId} mm`
            : activeProtocol.desc
        ) : (
          `Impresora normal: ${normalProfile.paperSize || 'Letter'} · ${normalProfile.orientation === 'landscape' ? 'Horizontal' : 'Vertical'} · ${normalProfile.copies || 1} copia(s)${normalProfile.printerName ? ` · ${normalProfile.printerName}` : ''}`
        )}
        {deviceInfo && isThermal ? ` · Conectada: ${deviceInfo}` : ''}
        {company?.labelPrintMode && !manual && isThermal ? ` · Config. sistema: ${company.labelPrintMode}` : ''}
        {isNormal && !agentConnected ? ' · Se abrirá el diálogo del sistema para elegir impresora.' : ''}
      </span>

      {/* Estado de impresion */}
      <div className="w-full">
        {agentBanner}
        {!caps.usb && !caps.agent ? (
          <p className="mt-1 text-[11px] flex items-center gap-1.5" style={{ color: 'rgb(252,165,165)' }}><AlertTriangle size={12} /> WebUSB no disponible en este navegador (Safari/Firefox). Use Chrome/Edge de escritorio.</p>
        ) : null}
        {!caps.serial && profile.connection === 'serial' && !caps.agent ? (
          <p className="mt-1 text-[11px] flex items-center gap-1.5" style={{ color: 'rgb(252,165,165)' }}><AlertTriangle size={12} /> WebSerial no disponible. Use Chrome/Edge de escritorio para COM/Serial.</p>
        ) : null}
        {!caps.bluetooth && profile.connection === 'bluetooth' && !caps.agent ? (
          <p className="mt-1 text-[11px]" style={{ color: 'rgb(252,165,165)' }}>Bluetooth Web solo soporta BLE. Para térmicas Bluetooth clásicas (SPP), empareje la impresora en el sistema operativo.</p>
        ) : null}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Configuración de impresión" onClick={() => setShowModal(false)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }}>
              <div>
                <h2 className="font-display text-lg font-bold text-white">{isNormal ? 'Configuración de impresión normal' : 'Configuración de impresión térmica'}</h2>
                <p className="mt-0.5 text-xs text-white/50">{isNormal ? 'Impresoras láser/inyección Carta/A4 por diálogo del sistema.' : 'Compatibilidad universal con cualquier impresora térmica del mercado.'}</p>
              </div>
              <Button variant="ghost" icon={X} onClick={() => setShowModal(false)} aria-label="Cerrar configuración" />
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {/* Estado impresion */}
              {agentConnected ? (
              <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'rgb(167,243,208)' }}>
                <p className="font-bold flex items-center gap-2"><Check size={13} /> Impresora lista</p>
                <p className="mt-1 text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,.7)' }}>
                  Impresión silenciosa disponible.
                </p>
              </div>
              ) : null}

              <Section icon={Printer} title={isNormal ? `Impresoras del sistema — ${normalCount} normales` : `Impresora conectada — ${thermalCount} térmicas`}>
                <div className="space-y-1.5">
                  {filteredDevices.length === 0 && (
                    <div className="rounded-lg border border-dashed px-3 py-4 text-center" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{agentConnected ? (isNormal ? 'No hay impresoras normales detectadas' : 'No hay térmicas detectadas') : 'Ninguna impresora agregada aún'}</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{agentConnected ? `Detectadas ${dedupedDevices.length} reales (filtradas a ${filteredDevices.length} ${isNormal ? 'normales' : 'térmicas'}). Use modo Manual si su modelo no aparece.` : 'Use "Agregar impresora por USB" con la impresora enchufada. También puede escribir el nombre manual abajo.'}</p>
                      {!agentConnected ? <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Para impresoras ya instaladas en Windows/macOS, use el campo Manual o imprima por el diálogo del sistema.</p> : null}
                    </div>
                  )}
                  {filteredDevices.map((device) => {
                    const kind = device._kind || detectPrinterKind(device._raw || device)
                    const isSelectedThermal = Number(profile.vendorId) === device.vendorId
                    const isSelectedNormal = normalProfile.printerName && device.printerName === normalProfile.printerName
                    const isSelected = kind === 'normal' ? isSelectedNormal : isSelectedThermal
                    return (
                      <button key={`${device.vendorId}-${device.productName}-${device.printerName || ''}`} type="button" onClick={() => handleSelectDevice(device)} className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all hover:opacity-90" style={{ borderColor: isSelected ? 'var(--blue)' : 'var(--line-subtle)', background: isSelected ? 'var(--bg-row-hover)' : 'var(--bg-input)' }}>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="inline-flex items-center gap-1.5 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {kind === 'normal' ? <Monitor size={13} /> : <Usb size={13} />} {device.productName}
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: kind === 'thermal' ? 'rgba(59,130,246,.15)' : 'rgba(16,185,129,.15)', color: kind === 'thermal' ? 'rgb(147,197,253)' : 'rgb(167,243,208)' }}>{kind === 'thermal' ? 'TÉRMICA' : 'NORMAL'}</span>
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{kind === 'normal' ? (device.printerName || 'Spooler') : `${protocolLabel(device.protocol)} · VID 0x${Number(device.vendorId || 0).toString(16).toUpperCase().padStart(4, '0')}`}</span>
                        </span>
                        {isSelected ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(16,185,129,.16)', color: 'var(--green-bright)' }}><Check size={11} /> Seleccionada</span>
                        ) : (
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--text-secondary)' }}>Usar</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={Plus} onClick={handleAddUsb} disabled={busy}>Agregar impresora por USB</Button>
                  <Button variant="ghost" icon={Bluetooth} onClick={handleAddBluetooth} disabled={busy}>Agregar por Bluetooth</Button>
                  <Button variant="ghost" icon={RefreshCw} onClick={refreshDevices} disabled={busy}>Buscar impresoras</Button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {agentConnected ? 'Detección en tiempo real activa: al conectar/desconectar una impresora, la lista se actualiza sola.' : 'Chrome mostrará primero solo impresoras; si su modelo no aparece, se ofrece la lista completa automáticamente.'}
                </p>
                <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                  <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><Wrench size={11} /> Manual — nombre exacto en Windows</span>
                  <input id={ids.manualThermalPrinter} value={profile.printerName || normalProfile.printerName || ''} onChange={(e) => { const v = e.target.value; updateProfile({ printerName: v, printMode: 'manual' }); updateNormal({ printerName: v }) }} placeholder="Ej: Trifusion POS-80" className="input-dark py-1.5 text-xs" aria-label="manual-printer-name" autoComplete="off" />
                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Útil para virtuales que no aparecen (ej. Trifusion POS-80, POS80, 80mm Thermal Printer, EPSON TM-T20). Al imprimir se abrirá el diálogo del sistema con ese nombre.</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" icon={Printer} onClick={handleBrowserTicket} disabled={busy}>Ticket navegador (elige POS-80)</Button>
                </div>
              </Section>

              {/* ── Térmica: mostrar solo si kind es térmica ── */}
              {isThermal && (
                <>
                  <Section icon={Cpu} title="Tipo de impresión">
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Protocolo del lenguaje de la impresora</p>
                      <Segmented options={THERMAL_PROTOCOLS} value={profile.protocol || 'escpos'} onChange={(id) => updateProfile({ protocol: id, manualProtocol: true })} columns={5} />
                      {!caps.usb ? <p className="text-[11px]" style={{ color: 'rgb(252,165,165)' }}>WebUSB no disponible en este navegador. Use Chrome/Edge de escritorio.</p> : null}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Método de conexión</p>
                      <Segmented options={THERMAL_CONNECTIONS} value={profile.connection || 'auto'} onChange={(id) => updateProfile({ connection: id })} columns={2} />
                      {profile.connection === 'bluetooth' && !caps.bluetooth ? <p className="text-[11px]" style={{ color: 'rgb(252,165,165)' }}>Web Bluetooth (BLE) no disponible aquí. Para Bluetooth clásico, empareje la impresora en el sistema operativo.</p> : null}
                    </div>
                  </Section>

                  <Section icon={Ruler} title="Ancho de papel">
                    <div className="grid grid-cols-4 gap-1.5">
                      {PAPER_WIDTHS.map((width) => (
                        <button key={width.id} type="button" onClick={() => updateProfile({ paperWidth: width.id })} className="rounded-lg border px-1.5 py-2 text-center transition-all" style={{ borderColor: paperWidthId === width.id ? 'var(--blue)' : 'var(--line-subtle)', background: paperWidthId === width.id ? 'var(--bg-row-hover)' : 'var(--bg-input)' }}>
                          <div className="mx-auto mb-1.5 flex h-7 items-end justify-center">
                            <div className="rounded-sm" style={{ width: `${Math.max(18, Math.min(100, (width.mm || 80) / 1.2))}%`, height: 16, background: paperWidthId === width.id ? 'var(--blue)' : 'rgba(255,255,255,.28)' }} />
                          </div>
                          <span className="block text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{width.label}</span>
                        </button>
                      ))}
                    </div>
                    {paperWidthId === 'custom' && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Ancho personalizado (mm)</span>
                        <input id={ids.customWidth} name="thermal-custom-width" type="number" min="40" max="150" value={profile.customWidthMm || 80} onChange={(event) => updateProfile({ customWidthMm: Number(event.target.value) || 80 })} className="input-dark max-w-24 py-1 text-xs" aria-label="ancho-personalizado" autoComplete="off" />
                      </div>
                    )}
                  </Section>

                  <Section icon={Wrench} title="Hardware">
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Corte automático al finalizar</p>
                      <Segmented options={CUT_MODES} value={profile.cut || 'full'} onChange={(id) => updateProfile({ cut: id })} columns={3} />
                    </div>
                    <Switch label="Apertura de gaveta (cajón de dinero)" sub="Impulso al finalizar el ticket" checked={profile.drawer !== false} onChange={(drawer) => updateProfile({ drawer })} />
                    {profile.drawer !== false && (
                      <Segmented options={[{ id: 60, label: '60 ms' }, { id: 100, label: '100 ms' }, { id: 240, label: '240 ms' }]} value={Number(profile.drawerPulse) || 60} onChange={(id) => updateProfile({ drawerPulse: Number(id) })} columns={3} />
                    )}
                  </Section>

                  <Section icon={PenLine} title="Diseño del ticket">
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Estilo de ticket</p>
                      <Segmented options={[{ id: 'classic', label: 'Clásico' }, { id: 'modern', label: 'Moderno' }]} value={profile.ticketStyle || 'classic'} onChange={(id) => updateProfile({ ticketStyle: id })} columns={2} />
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>La plantilla moderna usa video invertido y subrayado; pruebe con 'Probar impresión' antes de usarla en facturas reales.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Switch label="Logo / nombre de empresa" sub="Cabecera en grande" checked={profile.logo !== false} onChange={(logo) => updateProfile({ logo })} />
                      <Switch label="Código QR" sub="Validación de la factura" checked={profile.qrEnabled !== false} onChange={(qrEnabled) => updateProfile({ qrEnabled })} />
                      <Switch label="Código de barras" sub="Del número de factura" checked={profile.barcode !== false} onChange={(barcode) => updateProfile({ barcode })} />
                      <Switch label="Texto en negrita" sub="Títulos y totales enfatizados" checked={profile.bold !== false} onChange={(bold) => updateProfile({ bold })} />
                    </div>
                    <Switch label="Texto acentuado (á, é, ñ) — experimental" sub="Requiere que su impresora soporte la página de códigos CP858; pruebe con 'Probar impresión'." checked={profile.accentedText === true} onChange={(accentedText) => updateProfile({ accentedText })} />
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Tamaño de fuente (títulos y total)</span>
                      <select id={ids.fontScale} name="thermal-font-scale" value={Number(profile.fontScale) || 0} onChange={(event) => updateProfile({ fontScale: Number(event.target.value) })} className="input-dark max-w-36 py-1 text-xs" aria-label="tamano-fuente" autoComplete="off">
                        {FONT_SCALES.map((scale) => <option key={scale.id} value={scale.id}>{scale.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Interlineado: <span className="font-bold" style={{ color: 'var(--blue-bright)' }}>{profile.lineSpacing || 30} / 60</span></span>
                      <input id={ids.lineSpacing} name="thermal-line-spacing" type="range" min="20" max="60" value={profile.lineSpacing || 30} onChange={(event) => updateProfile({ lineSpacing: Number(event.target.value) })} className="w-36 accent-blue-500" aria-label="interlineado" autoComplete="off" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Columnas de la tabla de artículos</p>
                      <Segmented options={COLUMN_MODES} value={profile.columns || '2'} onChange={(id) => updateProfile({ columns: id })} columns={2} />
                    </div>
                  </Section>

                  {profile.connection === 'network' && (
                    <Section icon={Network} title="Red / LAN">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Dirección IP de la impresora</span>
                        <input id={ids.networkHost} name="thermal-network-host" type="text" placeholder="192.168.1.50" value={profile.networkHost || ''} onChange={(event) => updateProfile({ networkHost: event.target.value.trim() })} className="input-dark max-w-40 py-1 text-xs" aria-label="ip-impresora" autoComplete="off" />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Puerto</span>
                        <input id={ids.networkPort} name="thermal-network-port" type="number" min="1" max="65535" value={profile.networkPort || 8001} onChange={(event) => updateProfile({ networkPort: Number(event.target.value) || 8001 })} className="input-dark max-w-24 py-1 text-xs" aria-label="puerto" autoComplete="off" />
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {agentConnected ? 'Se usará socket TCP directo a puerto 9100 (genérica).' : 'Impresión por red vía WebPRNT (Star) por HTTP o diálogo del sistema.'}
                      </p>
                    </Section>
                  )}

                  {profile.connection === 'serial' && (
                    <Section icon={Cable} title="Puerto serial / COM">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Velocidad (baud rate)</span>
                        <select id={ids.baudRate} name="thermal-baud-rate" value={profile.baudRate || 9600} onChange={(event) => updateProfile({ baudRate: Number(event.target.value) })} className="input-dark max-w-32 py-1 text-xs" aria-label="baud-rate" autoComplete="off">
                          {[9600, 19200, 38400, 57600, 115200].map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                        </select>
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{agentConnected ? 'Soporta COM real y Bluetooth clásico vía puerto COM virtual.' : 'Chrome pedirá seleccionar el puerto COM (WebSerial).'}</p>
                    </Section>
                  )}
                </>
              )}

              {/* ── Normal: mostrar solo si kind es normal ── */}
              {isNormal && (
                <>
                  <Section icon={FileText} title="Papel y copias">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Impresora del sistema</span>
                      <select id={ids.normalPrinter} name="normal-printer" value={normalProfile.printerName || ''} onChange={(e) => updateNormal({ printerName: e.target.value })} className="input-dark max-w-52 py-1 text-xs" aria-label="impresora-normal" autoComplete="off">
                        <option value="">Seleccione impresora</option>
                        {dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'normal').map((p) => (
                          <option key={p.printerName || p.name} value={p.printerName || p.name}>{p.displayName || p.name}</option>
                        ))}
                        {dedupedAll.filter((p) => (p._kind || detectPrinterKind(p)) === 'normal').length === 0 && normalProfile.printerName ? <option value={normalProfile.printerName}>{normalProfile.printerName}</option> : null}
                      </select>
                    </div>
                    {!agentConnected ? <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'rgb(252,211,77)' }}><AlertTriangle size={11} /> Se abrirá el diálogo del sistema para elegir impresora y confirmar.</p> : null}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Tamaño de papel</span>
                        <select id={ids.normalPaper} name="normal-paper" value={normalProfile.paperSize || 'Letter'} onChange={(e) => updateNormal({ paperSize: e.target.value })} className="input-dark py-1 text-xs" aria-label="papel-normal" autoComplete="off">
                          {NORMAL_PAPER_SIZES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Orientación</span>
                        <select id={ids.normalOrientation} name="normal-orientation" value={normalProfile.orientation || 'portrait'} onChange={(e) => updateNormal({ orientation: e.target.value })} className="input-dark py-1 text-xs" aria-label="orientacion-normal" autoComplete="off">
                          {NORMAL_ORIENTATIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Número de copias</span>
                      <input id={ids.normalCopies} name="normal-copies" type="number" min="1" max="99" value={normalProfile.copies || 1} onChange={(e) => updateNormal({ copies: Math.max(1, Number(e.target.value) || 1) })} className="input-dark max-w-24 py-1 text-xs" aria-label="copias" autoComplete="off" />
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>El PDF se imprime por el diálogo del sistema: elija su impresora y confirme.</p>
                  </Section>

                  <Section icon={Monitor} title="Nota sobre impresión">
                    <p className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>
                      La impresión se realiza por el diálogo del sistema: elija su impresora y confirme. Es el flujo estándar de los sistemas de facturación profesionales.
                    </p>
                  </Section>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }}>
              <Button variant="ghost" icon={RotateCcw} onClick={handleResetAuto}>Volver a automático</Button>
              <Button variant="ghost" icon={Trash2} onClick={handleForget}>Olvidar impresora</Button>
              {isThermal ? <Button variant="ghost" icon={Download} onClick={handleDownloadRaw} disabled={busy}>Descargar crudo</Button> : null}
              <Button variant="ghost" icon={TestTube2} onClick={handleTest} disabled={busy}>Probar impresión</Button>
              <Button variant="primary" icon={Save} onClick={() => { setShowModal(false); toast.success(isNormal ? 'Configuración normal guardada.' : 'Configuración térmica guardada y recordada.') }}>Guardar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Mantener alias si alguna pantalla importa InvoicePrintActions
export const InvoicePrintActions = InvoiceThermalActions
export default InvoiceThermalActions
