import { useEffect, useState } from 'react'
import { Bluetooth, Cable, Check, Cpu, Download, Network, PenLine, Plus, Printer, RefreshCw, RotateCcw, Ruler, Save, ScanSearch, Settings2, TestTube2, Trash2, Usb, Wrench, X } from 'lucide-react'
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

function viaLabel(via) {
  return { usb: 'USB', bluetooth: 'Bluetooth', serial: 'Puerto serial', network: 'Red/LAN', download: 'Descarga', file: 'Archivo', config: 'Configuracion' }[via] || via
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
  const [profile, setProfile] = useState(() => ({ ...getThermalProfile() }))
  const [deviceInfo, setDeviceInfo] = useState(() => {
    const saved = getThermalProfile()
    return saved?.productName ? `${saved.productName} · ${String(saved.protocol || '').toUpperCase()}` : ''
  })
  const [manual, setManual] = useState(() => Boolean(getThermalProfile()?.manualProtocol))
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [devices, setDevices] = useState([])

  useEffect(() => {
    if (!showModal) return
    let active = true
    listThermalDevices().then((list) => { if (active) setDevices(list) })
    return () => { active = false }
  }, [showModal])

  useEffect(() => {
    if (!showModal) return
    const handler = (event) => { if (event.key === 'Escape') setShowModal(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handler)
    }
  }, [showModal])

  function updateProfile(next) {
    setProfile((current) => {
      const merged = { ...current, ...next }
      saveThermalProfile(merged)
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
      toast.error(error.message)
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
      toast.success(`Impresora Bluetooth agregada: ${added.productName}.`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  function handleSelectDevice(device) {
    updateProfile({ vendorId: device.vendorId, productName: device.productName, protocol: device.protocol, connection: 'usb', manualProtocol: false })
    setManual(false)
    setDeviceInfo(`${device.productName} · ${String(device.protocol || '').toUpperCase()}`)
    toast.success(`${device.productName} seleccionada. Impresion instantanea sin dialogo.`)
  }

  async function handlePrint() {
    setBusy(true)
    try {
      const result = await printInvoiceThermal({ invoice, company, customer, qrText, profileOverride: currentOptions() })
      if (result.ok) {
        if (result.protocol && result.protocol !== profile.protocol) {
          setProfile({ ...getThermalProfile() })
          toast.success(`Factura enviada a ${result.device} (${viaLabel(result.via)}). Protocolo ${String(result.protocol).toUpperCase()} aplicado por deteccion.`)
        } else {
          toast.success(`Factura enviada a ${result.device} (${viaLabel(result.via)}).`)
        }
      } else if (result.via === 'download') {
        toast.info(result.error || 'Se descargo el archivo termico.')
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
      const result = await printThermalTest({ profileOverride: currentOptions() })
      if (result.ok) {
        toast.success(`Prueba enviada a ${result.device} (${viaLabel(result.via)}). Verifique el ticket impreso.`)
      } else if (result.via === 'config') {
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

  return (
    <div className="no-print mt-3 flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)' }}>
      <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}><Cpu size={13} /> Impresion termica</span>
      <select id="invoice-thermal-mode" name="invoice-thermal-mode" value={profile.protocol || 'escpos'} onChange={(event) => updateProfile({ protocol: event.target.value, manualProtocol: true })} className="input-dark max-w-64 py-1.5 text-xs" aria-label="invoice-thermal-mode" autoComplete="off">
        {THERMAL_PROTOCOLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <select id="invoice-thermal-width" name="invoice-thermal-width" value={paperWidthId} onChange={(event) => updateProfile({ paperWidth: event.target.value })} className="input-dark max-w-32 py-1.5 text-xs" aria-label="invoice-thermal-width" autoComplete="off">
        <option value="58">58 mm</option>
        <option value="80">80 mm</option>
        <option value="112">112 mm</option>
        <option value="custom">Personalizado</option>
      </select>
      <Button variant="ghost" icon={ScanSearch} onClick={handleDetect} disabled={busy}>Detectar impresora</Button>
      <Button variant="ghost" icon={Settings2} onClick={() => setShowModal(true)} disabled={busy}>Configuracion</Button>
      <Button variant="primary" icon={Printer} onClick={handlePrint} disabled={busy}>Imprimir ahora</Button>
      <Button variant="ghost" icon={TestTube2} onClick={handleTest} disabled={busy}>Prueba</Button>
      <Button variant="ghost" icon={Download} onClick={handleDownload} disabled={busy}>Descargar PDF</Button>
      <span className="w-full text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {manual
          ? `Configuracion manual: ${activeProtocol.label} · ${activeConnection.label}${activeConnection.id === 'serial' ? ` · ${profile.baudRate || 9600} baudios` : ''} · ${paperWidthId === 'custom' ? `${profile.customWidthMm || 80} mm` : paperWidthId} mm`
          : activeProtocol.desc}
        {deviceInfo ? ` · Conectada: ${deviceInfo}` : ''}
        {company?.labelPrintMode && !manual ? ` · Configuracion del sistema: ${company.labelPrintMode}` : ''}
      </span>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Configuracion de impresion termica" onClick={() => setShowModal(false)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--bg-elevated)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }}>
              <div>
                <h2 className="font-display text-lg font-bold text-white">Configuracion de impresion termica</h2>
                <p className="mt-0.5 text-xs text-white/50">Compatibilidad universal con cualquier impresora termica del mercado.</p>
              </div>
              <Button variant="ghost" icon={X} onClick={() => setShowModal(false)} aria-label="Cerrar configuracion" />
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              <Section icon={Printer} title="Impresora conectada">
                <div className="space-y-1.5">
                  {devices.length === 0 && (
                    <div className="rounded-lg border border-dashed px-3 py-4 text-center" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ninguna impresora agregada aun</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Use "Agregar impresora por USB" con la impresora enchufada.</p>
                    </div>
                  )}
                  {devices.map((device) => {
                    const isSelected = Number(profile.vendorId) === device.vendorId
                    return (
                      <button key={`${device.vendorId}-${device.productName}`} type="button" onClick={() => handleSelectDevice(device)} className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all hover:opacity-90" style={{ borderColor: isSelected ? 'var(--blue)' : 'var(--line-subtle)', background: isSelected ? 'var(--bg-row-hover)' : 'var(--bg-input)' }}>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{device.productName}</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{protocolLabel(device.protocol)} · VID 0x{device.vendorId.toString(16).toUpperCase().padStart(4, '0')}</span>
                        </span>
                        {isSelected ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(16,185,129,.16)', color: 'var(--green-bright)' }}><Check size={11} /> Instantanea</span>
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
                  Chrome mostrara primero solo impresoras; si su modelo no aparece, se ofrece la lista completa automaticamente. Una vez agregada, cada impresion es instantanea: sin dialogo, sin permisos repetidos.
                </p>
              </Section>

              <Section icon={Cpu} title="Tipo de impresion">
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Protocolo del lenguaje de la impresora</p>
                  <Segmented options={THERMAL_PROTOCOLS} value={profile.protocol || 'escpos'} onChange={(id) => updateProfile({ protocol: id, manualProtocol: true })} columns={5} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Metodo de conexion</p>
                  <Segmented options={THERMAL_CONNECTIONS} value={profile.connection || 'auto'} onChange={(id) => updateProfile({ connection: id })} columns={2} />
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
                    <input id="thermal-custom-width" name="thermal-custom-width" type="number" min="40" max="150" value={profile.customWidthMm || 80} onChange={(event) => updateProfile({ customWidthMm: Number(event.target.value) || 80 })} className="input-dark max-w-24 py-1 text-xs" aria-label="ancho-personalizado" autoComplete="off" />
                  </div>
                )}
              </Section>

              <Section icon={Wrench} title="Hardware">
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Corte automatico al finalizar</p>
                  <Segmented options={CUT_MODES} value={profile.cut || 'full'} onChange={(id) => updateProfile({ cut: id })} columns={3} />
                </div>
                <Switch label="Apertura de gaveta (cajon de dinero)" sub="Impulso al finalizar el ticket" checked={profile.drawer !== false} onChange={(drawer) => updateProfile({ drawer })} />
                {profile.drawer !== false && (
                  <Segmented options={[{ id: 60, label: '60 ms' }, { id: 100, label: '100 ms' }, { id: 240, label: '240 ms' }]} value={Number(profile.drawerPulse) || 60} onChange={(id) => updateProfile({ drawerPulse: Number(id) })} columns={3} />
                )}
              </Section>

              <Section icon={PenLine} title="Diseno del ticket">
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Estilo de ticket</p>
                  <Segmented options={[{ id: 'classic', label: 'Clásico' }, { id: 'modern', label: 'Moderno' }]} value={profile.ticketStyle || 'classic'} onChange={(id) => updateProfile({ ticketStyle: id })} columns={2} />
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>La plantilla moderna usa video invertido y subrayado; pruebe con 'Probar impresion' antes de usarla en facturas reales, ya que no todas las impresoras termicas soportan estos efectos de forma identica.</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Switch label="Logo / nombre de empresa" sub="Cabecera en grande" checked={profile.logo !== false} onChange={(logo) => updateProfile({ logo })} />
                  <Switch label="Codigo QR" sub="Validacion de la factura" checked={profile.qrEnabled !== false} onChange={(qrEnabled) => updateProfile({ qrEnabled })} />
                  <Switch label="Codigo de barras" sub="Del numero de factura" checked={profile.barcode !== false} onChange={(barcode) => updateProfile({ barcode })} />
                  <Switch label="Texto en negrita" sub="Titulos y totales enfatizados" checked={profile.bold !== false} onChange={(bold) => updateProfile({ bold })} />
                </div>
                <Switch label="Texto acentuado (á, é, ñ) — experimental" sub="Requiere que su impresora soporte la pagina de codigos CP858 (Multilingue Latino I); pruebe con 'Probar impresion' antes de usarlo en facturas reales." checked={profile.accentedText === true} onChange={(accentedText) => updateProfile({ accentedText })} />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Tamano de fuente (titulos y total)</span>
                  <select id="thermal-font-scale" name="thermal-font-scale" value={Number(profile.fontScale) || 0} onChange={(event) => updateProfile({ fontScale: Number(event.target.value) })} className="input-dark max-w-36 py-1 text-xs" aria-label="tamano-fuente" autoComplete="off">
                    {FONT_SCALES.map((scale) => <option key={scale.id} value={scale.id}>{scale.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Interlineado: <span className="font-bold" style={{ color: 'var(--blue-bright)' }}>{profile.lineSpacing || 30} / 60</span></span>
                  <input id="thermal-line-spacing" name="thermal-line-spacing" type="range" min="20" max="60" value={profile.lineSpacing || 30} onChange={(event) => updateProfile({ lineSpacing: Number(event.target.value) })} className="w-36 accent-blue-500" aria-label="interlineado" autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Columnas de la tabla de articulos</p>
                  <Segmented options={COLUMN_MODES} value={profile.columns || '2'} onChange={(id) => updateProfile({ columns: id })} columns={2} />
                </div>
              </Section>

              {profile.connection === 'network' && (
                <Section icon={Network} title="Red / LAN">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Direccion IP de la impresora</span>
                    <input id="thermal-network-host" name="thermal-network-host" type="text" placeholder="192.168.1.50" value={profile.networkHost || ''} onChange={(event) => updateProfile({ networkHost: event.target.value.trim() })} className="input-dark max-w-40 py-1 text-xs" aria-label="ip-impresora" autoComplete="off" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Puerto WebPRNT</span>
                    <input id="thermal-network-port" name="thermal-network-port" type="number" min="1" max="65535" value={profile.networkPort || 8001} onChange={(event) => updateProfile({ networkPort: Number(event.target.value) || 8001 })} className="input-dark max-w-24 py-1 text-xs" aria-label="puerto-webprnt" autoComplete="off" />
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Usa la API WebPRNT (Star) u otra impresora de red compatible con envio HTTP de datos crudos. La impresora debe estar en la misma red.</p>
                </Section>
              )}

              {profile.connection === 'serial' && (
                <Section icon={Cable} title="Puerto serial / COM">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-subtle)', background: 'var(--bg-input)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Velocidad (baud rate)</span>
                    <select id="thermal-baud-rate" name="thermal-baud-rate" value={profile.baudRate || 9600} onChange={(event) => updateProfile({ baudRate: Number(event.target.value) })} className="input-dark max-w-32 py-1 text-xs" aria-label="baud-rate" autoComplete="off">
                      {[9600, 19200, 38400, 57600, 115200].map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Chrome le pedira seleccionar el puerto COM de la impresora al imprimir (WebSerial).</p>
                </Section>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }}>
              <Button variant="ghost" icon={RotateCcw} onClick={handleResetAuto}>Volver a automatico</Button>
              <Button variant="ghost" icon={Trash2} onClick={handleForget}>Olvidar impresora</Button>
              <Button variant="ghost" icon={Download} onClick={handleDownloadRaw} disabled={busy}>Descargar crudo</Button>
              <Button variant="ghost" icon={TestTube2} onClick={handleTest} disabled={busy}>Probar impresion</Button>
              <Button variant="primary" icon={Save} onClick={() => { setShowModal(false); toast.success('Configuracion termica guardada y recordada.') }}>Guardar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
