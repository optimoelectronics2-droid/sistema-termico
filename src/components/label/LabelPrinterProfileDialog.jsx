import { useState } from 'react'
import { DPI_VALUES, createPrinterProfile, createCalibrationLabel } from '../../lib/labelEngine.js'
import { renderDesign, downloadOutput, createLabelPdfAsync } from '../../lib/labelOutput.js'
import { detectProtocolFromVendor, sendToUsbPrinter, sendToSerialPort, getBaudRates } from '../../services/barcodeLabelService.js'

const BRANDS = ['Zebra', 'Brother QL', 'Dymo LabelWriter', 'Epson TM', 'Bixolon', 'Citizen', 'Honeywell', 'SATO', 'Star Micronics', 'TSC', 'Xprinter', 'Rongta', 'HP', 'Canon', 'Generica/Otra']

const OUTPUT_METHODS = [
  { id: 'pdf', label: 'PDF Navegador', desc: 'Compatible con cualquier impresora — sin configuracion adicional' },
  { id: 'zpl', label: 'Archivo ZPL', desc: 'Zebra y compatibles ZPL' },
  { id: 'webusb', label: 'WebUSB directo', desc: 'Conexion USB directa (Chrome/Edge)' },
  { id: 'webserial', label: 'WebSerial (COM)', desc: 'Puerto serial/COM (Chrome/Edge)' },
  { id: 'escpos', label: 'Archivo ESC/POS', desc: 'Epson TM, Bixolon, Star y termicas genericas' },
]

function createDefaultProfile() {
  return createPrinterProfile({ name: 'Perfil por defecto', protocol: 'pdf', dpi: 203 })
}

function loadStoredProfiles(initialProfiles) {
  if (initialProfiles && initialProfiles.length) return initialProfiles
  try {
    const stored = JSON.parse(localStorage.getItem('labelPrinterProfiles') || '[]')
    if (stored.length > 0) return stored
  } catch { /* ignore */ }
  return [createDefaultProfile()]
}

export default function LabelPrinterProfileDialog({ design, profiles: initialProfiles, onSave, onClose }) {
  const [profiles, setProfiles] = useState(() => loadStoredProfiles(initialProfiles))
  const [selectedId, setSelectedId] = useState(profiles[0]?.id)
  const [profile, setProfile] = useState(() => profiles[0] || createDefaultProfile())
  const [deviceInfo, setDeviceInfo] = useState('')
  const [baudRate, setBaudRate] = useState(9600)
  const [printerIp, setPrinterIp] = useState('')
  const [printerPort, setPrinterPort] = useState(9100)
  const [connectionStatus, setConnectionStatus] = useState('')

  const activeProfile = profiles.find(p => p.id === selectedId) || profile

  function updateProfile(patch) {
    const updated = { ...activeProfile, ...patch, calibration: { ...activeProfile.calibration, ...(patch.calibration || {}) } }
    setProfile(updated)
    setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  function addProfile() {
    const p = createPrinterProfile({ name: 'Nueva impresora', protocol: 'pdf', dpi: 203 })
    setProfiles(prev => [...prev, p])
    setSelectedId(p.id); setProfile(p)
  }

  function duplicateProfile() {
    const p = createPrinterProfile({ name: activeProfile.name + ' (copia)', protocol: activeProfile.protocol, dpi: activeProfile.dpi, calibration: { ...activeProfile.calibration }, brand: activeProfile.brand, model: activeProfile.model })
    setProfiles(prev => [...prev, p])
    setSelectedId(p.id); setProfile(p)
  }

  function deleteProfile(id) {
    if (profiles.length <= 1) return
    setProfiles(prev => prev.filter(p => p.id !== id))
    if (selectedId === id) { const next = profiles.find(p => p.id !== id); setSelectedId(next?.id); setProfile(next || createDefaultProfile()) }
  }

  async function handleTestPrint() {
    setConnectionStatus('')
    if (activeProfile.protocol === 'pdf') {
      if (!design) { setConnectionStatus('No hay diseno para imprimir'); return }
      try {
        const calLabel = createCalibrationLabel()
        const doc = await createLabelPdfAsync(calLabel, activeProfile.calibration, 1)
        doc.save('test-calibracion.pdf')
        setConnectionStatus('PDF de calibracion descargado. Imprimirlo en la impresora para verificar.')
      } catch (err) { setConnectionStatus('Error: ' + err.message) }
    } else if (activeProfile.protocol === 'zpl' || activeProfile.protocol === 'escpos') {
      const result = renderDesign(design || createCalibrationLabel(), activeProfile.protocol === 'escpos' ? 'escpos' : 'zpl', { ...activeProfile.calibration, dpi: activeProfile.dpi })
      const ext = activeProfile.protocol === 'escpos' ? 'prn' : 'zpl'
      downloadOutput(result.data, `test-label.${ext}`, result.type)
      setConnectionStatus(`Archivo .${ext} descargado`)
    } else if (activeProfile.protocol === 'webusb') {
      await handleUsbDetect()
    } else if (activeProfile.protocol === 'webserial') {
      await handleSerialDetect()
    }
  }

  async function handleUsbDetect() {
    setConnectionStatus('Detectando impresora USB...')
    try {
      const result = await sendToUsbPrinter('^XA^FO50,50^A0N,30^FDTest^FS^XZ', 'zpl')
      const detected = detectProtocolFromVendor(result.vendorId)
      setDeviceInfo(`Dispositivo: ${result.deviceName} | Vendor: 0x${result.vendorId.toString(16)} | Protocolo detectado: ${detected}`)
      setConnectionStatus('Impresora detectada correctamente')
    } catch (err) {
      setConnectionStatus('Error: ' + err.message)
    }
  }

  async function handleSerialDetect() {
    setConnectionStatus('Detectando puerto serial...')
    try {
      const result = await sendToSerialPort('Test label\n', { baudRate })
      setConnectionStatus(result)
    } catch (err) {
      setConnectionStatus('Error: ' + err.message)
    }
  }

  function handleSave() {
    const stored = JSON.parse(localStorage.getItem('labelPrinterProfiles') || '[]')
    const merged = profiles.map(p => {
      const existing = stored.find(s => s.id === p.id)
      return existing ? { ...existing, ...p } : p
    })
    // Add new profiles not yet stored
    for (const p of profiles) {
      if (!merged.find(m => m.id === p.id)) merged.push(p)
    }
    localStorage.setItem('labelPrinterProfiles', JSON.stringify(merged))
    onSave && onSave(profiles)
    onClose && onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-slate-800 p-5 text-sm text-white/90 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-white">Perfiles de impresora</h2>

        {/* Profile tabs */}
        <div className="mb-4 flex flex-wrap gap-1">
          {profiles.map(p => (
            <button key={p.id} onClick={() => { setSelectedId(p.id); setProfile(p); setDeviceInfo(''); setConnectionStatus('') }}
              className={`rounded px-2 py-1 text-xs ${p.id === selectedId ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
              {p.name}
            </button>
          ))}
          <button onClick={addProfile} className="rounded bg-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/20">+ Nuevo</button>
        </div>

        {/* Seccion 1: Perfil */}
        <div className="space-y-3">
          <label className="block">
            <span className="text-white/50">Nombre del perfil</span>
            <input id="profile-name" value={activeProfile.name} onChange={e => updateProfile({ name: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1.5 text-white" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/50">Marca</span>
              <select id="profile-brand" value={activeProfile.brand} onChange={e => updateProfile({ brand: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1.5 text-white">
                <option value="">Seleccione</option>
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-white/50">Modelo</span>
              <input id="profile-model" value={activeProfile.model} onChange={e => updateProfile({ model: e.target.value })} className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1.5 text-white" />
            </label>
          </div>

          {/* Metodo de salida */}
          <label className="block">
            <span className="text-white/50">Metodo de salida</span>
            <select id="profile-protocol" value={activeProfile.protocol} onChange={e => updateProfile({ protocol: e.target.value })}
              className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1.5 text-white">
              {OUTPUT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-white/40">{OUTPUT_METHODS.find(m => m.id === activeProfile.protocol)?.desc}</p>
          </label>

          <label className="block">
            <span className="text-white/50">DPI</span>
            <select id="profile-dpi" value={activeProfile.dpi} onChange={e => updateProfile({ dpi: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1.5 text-white">
              {DPI_VALUES.map(d => <option key={d} value={d}>{d} DPI{d === 203 ? ' (estandar etiquetas)' : d === 300 ? ' (alta calidad)' : ' (ultra alta)'}</option>)}
            </select>
          </label>
        </div>

        {/* Seccion 2: Calibracion */}
        <fieldset className="mt-4 rounded border border-white/10 p-3">
          <legend className="px-1 text-white/50">Calibracion</legend>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="text-white/50">Offset X (mm)</span>
              <input id="profile-offsetX" type="number" step="0.1" min="-10" max="10" value={activeProfile.calibration?.offsetX ?? 0}
                onChange={e => updateProfile({ calibration: { offsetX: Number(e.target.value) } })}
                className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
            </label>
            <label><span className="text-white/50">Offset Y (mm)</span>
              <input id="profile-offsetY" type="number" step="0.1" min="-10" max="10" value={activeProfile.calibration?.offsetY ?? 0}
                onChange={e => updateProfile({ calibration: { offsetY: Number(e.target.value) } })}
                className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
            </label>
            <label><span className="text-white/50">Escala X</span>
              <input id="profile-scaleX" type="number" step="0.001" min="0.9" max="1.1" value={activeProfile.calibration?.scaleX ?? 1}
                onChange={e => updateProfile({ calibration: { scaleX: Number(e.target.value) } })}
                className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
            </label>
            <label><span className="text-white/50">Escala Y</span>
              <input id="profile-scaleY" type="number" step="0.001" min="0.9" max="1.1" value={activeProfile.calibration?.scaleY ?? 1}
                onChange={e => updateProfile({ calibration: { scaleY: Number(e.target.value) } })}
                className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
            </label>
            <label><span className="text-white/50">Gap entre etiquetas (mm)</span>
              <input id="profile-gap" type="number" step="0.5" min="0" max="10" value={activeProfile.calibration?.labelGap ?? 2}
                onChange={e => updateProfile({ calibration: { labelGap: Number(e.target.value) } })}
                className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
            </label>
          </div>
        </fieldset>

        {/* Seccion 3: Test de conexion */}
        <div className="mt-4 space-y-3 rounded border border-white/10 p-3">
          <span className="text-xs font-bold text-white/50 uppercase">Conexion</span>

          {activeProfile.protocol === 'pdf' && (
            <p className="text-xs text-white/40">Compatible con cualquier impresora — sin configuracion adicional requerida.</p>
          )}

          {activeProfile.protocol === 'zpl' && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-white/50">IP de la impresora</span>
                <input id="profile-ip" type="text" value={printerIp} onChange={e => setPrinterIp(e.target.value)}
                  className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" placeholder="192.168.1.100" />
              </label>
              <label className="block">
                <span className="text-white/50">Puerto</span>
                <input id="profile-port" type="number" value={printerPort} onChange={e => setPrinterPort(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white" />
              </label>
              <p className="text-xs text-white/40">O descargue el archivo .zpl y envielo a la impresora via TCP puerto 9100.</p>
            </div>
          )}

          {activeProfile.protocol === 'webusb' && (
            <div className="space-y-2">
              <button onClick={handleUsbDetect} className="w-full rounded bg-emerald-700 py-2 text-sm font-bold text-white hover:bg-emerald-600">
                Detectar impresora USB
              </button>
              {deviceInfo && <p className="text-xs text-emerald-300">{deviceInfo}</p>}
            </div>
          )}

          {activeProfile.protocol === 'webserial' && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-white/50">Baud rate</span>
                <select id="profile-baud" value={baudRate} onChange={e => setBaudRate(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-white/20 bg-slate-700 px-2 py-1 text-white">
                  {getBaudRates().map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <button onClick={handleSerialDetect} className="w-full rounded bg-emerald-700 py-2 text-sm font-bold text-white hover:bg-emerald-600">
                Detectar puerto serial
              </button>
            </div>
          )}

          <button onClick={handleTestPrint} className="w-full rounded bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-500">
            Imprimir etiqueta de prueba
          </button>
          {connectionStatus && <p className="text-xs text-white/60">{connectionStatus}</p>}
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button onClick={duplicateProfile} className="rounded bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/20">Duplicar</button>
          {profiles.length > 1 && <button onClick={() => deleteProfile(selectedId)} className="rounded bg-red-600 px-3 py-2 text-xs text-white hover:bg-red-500">Eliminar</button>}
        </div>

        <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
          <button onClick={handleSave} className="flex-1 rounded bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-500">Guardar perfiles</button>
          <button onClick={onClose} className="flex-1 rounded bg-white/10 py-2 text-sm text-white hover:bg-white/20">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
