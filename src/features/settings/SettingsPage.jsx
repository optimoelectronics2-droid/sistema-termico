import { useState } from 'react'
import { Building2, Printer, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { defaultFiscalSettings, isImageUrl } from '../../lib/tenantEngine'
import { LABEL_SIZES, DPI_VALUES } from '../../lib/labelEngine'

export function SettingsPage() {
  const toast = useToast()
  const company = useERPStore((state) => state.company)
  const branches = useERPStore((state) => state.branches)
  const suppliers = useERPStore((state) => state.suppliers)
  const categories = useERPStore((state) => state.categories)
  const taxSequences = useERPStore((state) => state.taxSequences)
  const auditLogs = useERPStore((state) => state.auditLogs)
  const updateSettings = useERPStore((state) => state.updateSettings)
  const updateFiscalSettings = useERPStore((state) => state.updateFiscalSettings)
  const updateBrandingSettings = useERPStore((state) => state.updateBrandingSettings)
  const updateCategories = useERPStore((state) => state.updateCategories)
  const updateExchangeRate = useERPStore((state) => state.updateExchangeRate)
  const upsertBranch = useERPStore((state) => state.upsertBranch)
  const upsertSupplier = useERPStore((state) => state.upsertSupplier)
  const updateTaxSequence = useERPStore((state) => state.updateTaxSequence)
  const [companyDraft, setCompanyDraft] = useState(company)
  const [fiscalDraft, setFiscalDraft] = useState({ ...defaultFiscalSettings, ...(company.fiscal || {}) })
  const [branchDraft, setBranchDraft] = useState({ name: '', address: '', city: '', province: '', phone: '', warehouse: '', register: '' })
  const [supplierDraft, setSupplierDraft] = useState({ name: '', rnc: '', phone: '', email: '', active: true })
  const [categoryText, setCategoryText] = useState(categories.join(', '))

  function saveCompany() {
    try {
      if (companyDraft.logoUrl && !isImageUrl(companyDraft.logoUrl)) throw new Error('El logo debe ser una URL valida de imagen.')
      updateSettings(companyDraft)
      updateBrandingSettings({
        primaryColor: companyDraft.branding?.primaryColor,
        accentColor: companyDraft.branding?.accentColor,
        invoiceTerms: companyDraft.invoiceTerms,
      })
      updateExchangeRate(companyDraft.exchangeRate || 58.5)
      toast.success('Configuracion de empresa guardada.')
    } catch (error) {
      toast.error(error.message)
    }
  }
  function saveFiscal() {
    try {
      updateFiscalSettings(fiscalDraft)
      toast.success('Configuracion fiscal guardada. DGII y e-CF siguen siendo opcionales.')
    } catch (error) {
      toast.error(error.message)
    }
  }
  function saveBranch() {
    try {
      if (!branchDraft.name.trim()) throw new Error('El nombre de la tienda/sucursal es obligatorio.')
      upsertBranch(branchDraft)
      setBranchDraft({ name: '', address: '', city: '', province: '', phone: '', warehouse: '', register: '' })
      toast.success('Tienda registrada correctamente.')
    } catch (error) {
      toast.error(error.message)
    }
  }
  function saveSupplier() {
    try {
      if (!supplierDraft.name.trim()) throw new Error('El nombre del proveedor es obligatorio.')
      upsertSupplier(supplierDraft)
      setSupplierDraft({ name: '', rnc: '', phone: '', email: '', active: true })
      toast.success('Proveedor registrado correctamente.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-4 flex items-center gap-3"><Building2 className="text-blue-300" /><div><h2 className="font-display text-2xl font-bold">Mi empresa</h2><p className="text-sm text-white/45">Configuracion de la empresa, datos fiscales y preferencias.</p></div></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-white/60">
          <p className="font-bold text-white">{company.name || 'Empresa sin nombre'}</p>
          <p>{company.rnc || 'Sin RNC'} · {company.email || 'Sin email'}</p>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3"><Building2 className="text-blue-300" /><div><h2 className="font-display text-2xl font-bold">Personalizacion inicial del sistema</h2><p className="text-sm text-white/45">Todo empieza vacio: registra empresa, tienda, secuencias, proveedores y categorias.</p></div></div>
        <div className="grid gap-3 md:grid-cols-4">
          {['name:Nombre empresa', 'legalName:Razon social', 'rnc:RNC', 'address:Direccion', 'city:Ciudad', 'province:Provincia', 'phone:Telefono', 'whatsapp:WhatsApp', 'email:Email', 'logoUrl:Logo URL'].map((item) => {
            const [key, label] = item.split(':')
            return <Input key={key} label={label} value={companyDraft[key]} onChange={(value) => setCompanyDraft((state) => ({ ...state, [key]: value }))} />
          })}
          <Input label="Color primario" value={companyDraft.branding?.primaryColor || '#3b82f6'} onChange={(value) => setCompanyDraft((state) => ({ ...state, branding: { ...(state.branding || {}), primaryColor: value } }))} />
          <Input label="Color acento" value={companyDraft.branding?.accentColor || '#10b981'} onChange={(value) => setCompanyDraft((state) => ({ ...state, branding: { ...(state.branding || {}), accentColor: value } }))} />
          <Input type="number" label="Tasa USD" value={companyDraft.exchangeRate} onChange={(value) => setCompanyDraft((state) => ({ ...state, exchangeRate: Number(value) }))} />
          <Input type="number" label="Descuento max %" value={companyDraft.maxDiscountPercent} onChange={(value) => setCompanyDraft((state) => ({ ...state, maxDiscountPercent: Number(value) }))} />
          <label className="flex items-center gap-2 pt-6 text-sm"><input id="require-open-register" type="checkbox" checked={companyDraft.requireOpenRegister} onChange={(e) => setCompanyDraft((state) => ({ ...state, requireOpenRegister: e.target.checked }))} /> Requerir caja abierta</label>
        </div>
        <div className="mt-4 flex justify-end"><Button icon={Save} onClick={saveCompany}>Guardar empresa</Button></div>
        {companyDraft.logoUrl ? <div className="mt-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30"><img src={companyDraft.logoUrl} alt="Preview logo empresa" className="h-full w-full object-contain" onError={() => toast.error('No se pudo cargar el logo. Revise la URL.')} /></div><p className="text-sm text-white/50">Preview en tiempo real para facturas, POS, dashboard y reportes.</p></div> : null}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3"><ShieldCheck className="text-emerald-300" /><div><h2 className="font-display text-2xl font-bold">Facturacion flexible RD</h2><p className="text-sm text-white/45">La factura normal, NCF y e-CF son modos opcionales por empresa.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Usar comprobantes fiscales" checked={fiscalDraft.ncfEnabled} onChange={(value) => setFiscalDraft((state) => ({ ...state, ncfEnabled: value, fiscalEnabled: value || state.ecfEnabled }))} />
          <Toggle label="Usar e-CF" checked={fiscalDraft.ecfEnabled} onChange={(value) => setFiscalDraft((state) => ({ ...state, ecfEnabled: value, fiscalEnabled: state.ncfEnabled || value }))} />
          <Toggle label="Conectar DGII" checked={fiscalDraft.dgiiEnabled} onChange={(value) => setFiscalDraft((state) => ({ ...state, dgiiEnabled: value }))} />
          <Toggle label="Secuencia automatica" checked={fiscalDraft.autoSequenceEnabled} onChange={(value) => setFiscalDraft((state) => ({ ...state, autoSequenceEnabled: value }))} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Field label="Modo por defecto"><select id="fiscal-default-mode" value={fiscalDraft.defaultMode} onChange={(event) => setFiscalDraft((state) => ({ ...state, defaultMode: event.target.value }))} className="input-dark"><option value="normal">Normal sin NCF</option><option value="ncf">NCF</option><option value="ecf">e-CF DGII</option></select></Field>
          <Field label="Ambiente e-CF"><select id="fiscal-ecf-environment" value={fiscalDraft.ecfEnvironment} onChange={(event) => setFiscalDraft((state) => ({ ...state, ecfEnvironment: event.target.value }))} className="input-dark"><option value="certification">Certificacion</option><option value="production">Produccion</option></select></Field>
          <Input type="number" label="Alerta secuencia baja" value={fiscalDraft.alertBeforeSequenceEnds} onChange={(value) => setFiscalDraft((state) => ({ ...state, alertBeforeSequenceEnds: Number(value) }))} />
          <Input type="number" label="Alerta vencimiento dias" value={fiscalDraft.alertBeforeNcfExpirationDays} onChange={(value) => setFiscalDraft((state) => ({ ...state, alertBeforeNcfExpirationDays: Number(value) }))} />
        </div>
        <Button icon={Save} className="mt-4" onClick={saveFiscal}>Guardar fiscal</Button>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="font-display text-xl font-bold">Registrar tienda / ubicacion</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {['name:Nombre tienda', 'address:Direccion', 'city:Ciudad', 'province:Provincia', 'phone:Telefono', 'warehouse:Almacen', 'register:Caja'].map((item) => { const [key, label] = item.split(':'); return <Input key={key} label={label} value={branchDraft[key]} onChange={(value) => setBranchDraft((state) => ({ ...state, [key]: value }))} /> })}
          </div>
          <Button className="mt-4" onClick={saveBranch}>Guardar tienda</Button>
          <List items={branches.map((branch) => `${branch.name} · ${branch.city || branch.address}`)} />
        </div>
        <div>
          <h3 className="font-display text-xl font-bold">Registrar proveedor</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {['name:Nombre', 'rnc:RNC', 'phone:Telefono', 'email:Email'].map((item) => { const [key, label] = item.split(':'); return <Input key={key} label={label} value={supplierDraft[key]} onChange={(value) => setSupplierDraft((state) => ({ ...state, [key]: value }))} /> })}
          </div>
          <Button className="mt-4" onClick={saveSupplier}>Guardar proveedor</Button>
          <List items={suppliers.map((supplier) => supplier.name)} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="font-display text-xl font-bold">Categorias editables</h3>
          <textarea id="categories" value={categoryText} onChange={(e) => setCategoryText(e.target.value)} className="input-dark mt-4 min-h-24" />
          <p className="mt-2 text-sm text-white/45">Separadas por coma. Se aplican en el proximo producto registrado.</p>
          <Button className="mt-4" onClick={() => { try { updateCategories(categoryText.split(',')); toast.success('Categorias guardadas.') } catch (error) { toast.error(error.message) } }}>Guardar categorias</Button>
        </div>
        <div>
          <h3 className="mb-4 flex items-center gap-2 font-display text-xl font-bold"><ShieldCheck className="text-emerald-300" /> Secuencias fiscales</h3>
          <div className="space-y-2">
            {taxSequences.map((sequence) => (
              <div key={sequence.id} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-2 md:grid-cols-5">
                <p className="font-bold">{sequence.id}</p>
                <input id={`seq-next-${sequence.id}`} type="number" value={sequence.next} onChange={(e) => updateTaxSequence({ type: sequence.id, next: Number(e.target.value) })} className="input-dark" aria-label={`seq-next-${sequence.id}`} />
                <input id={`seq-limit-${sequence.id}`} type="number" value={sequence.limit} onChange={(e) => updateTaxSequence({ type: sequence.id, limit: Number(e.target.value) })} className="input-dark" aria-label={`seq-limit-${sequence.id}`} />
                <input id={`seq-expires-${sequence.id}`} type="date" value={sequence.expiresAt} onChange={(e) => updateTaxSequence({ type: sequence.id, expiresAt: e.target.value })} className="input-dark" aria-label={`seq-expires-${sequence.id}`} />
                <label className="flex items-center gap-2 text-sm"><input id={`seq-enabled-${sequence.id}`} type="checkbox" checked={sequence.enabled} onChange={(e) => updateTaxSequence({ type: sequence.id, enabled: e.target.checked })} /> Activa</label>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3"><Printer className="text-blue-300" /><div><h2 className="font-display text-2xl font-bold">Motor de impresion profesional</h2><p className="text-sm text-white/45">Soporta Zebra, TSC, Honeywell, SATO, Godex, Citizen, Bixolon, Brother, Epson, Xprinter, Rongta y cualquier impresora con protocolo ZPL, EPL, TSPL, CPCL, ESC/POS o PDF vectorial.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Tamaño etiqueta por defecto"><select id="label-size" value={companyDraft.defaultLabelSize || '3x2'} onChange={(e) => setCompanyDraft((s) => ({ ...s, defaultLabelSize: e.target.value }))} className="input-dark">{Object.entries(LABEL_SIZES).filter(([id]) => !['letter','a4','58mm','80mm'].includes(id)).map(([id, dim]) => <option key={id} value={id}>{dim.name}</option>)}</select></Field>
          <Field label="Resolucion DPI"><select id="label-dpi" value={String(companyDraft.labelDpi || 203)} onChange={(e) => setCompanyDraft((s) => ({ ...s, labelDpi: Number(e.target.value) }))} className="input-dark">{DPI_VALUES.map(d => <option key={d} value={String(d)}>{d} DPI</option>)}</select></Field>
          <Field label="Incluir precio"><select id="label-show-price" value={String(companyDraft.labelShowPrice ?? true)} onChange={(e) => setCompanyDraft((s) => ({ ...s, labelShowPrice: e.target.value === 'true' }))} className="input-dark"><option value="true">Si</option><option value="false">No</option></select></Field>
          <Field label="Metodo de impresion"><select id="label-print-mode" value={companyDraft.labelPrintMode || 'browser'} onChange={(e) => setCompanyDraft((s) => ({ ...s, labelPrintMode: e.target.value }))} className="input-dark"><option value="browser">PDF vectorial</option><option value="zpl">ZPL (Zebra, Xprinter, Rongta)</option><option value="epl">EPL (Zebra older)</option><option value="tspl">TSPL (TSC)</option><option value="cpcl">CPCL (Honeywell, Citizen)</option><option value="escpos">ESC/POS (Epson, Bixolon, Star)</option><option value="usb">ZPL WebUSB directo</option><option value="escpos-usb">ESC/POS WebUSB directo</option><option value="png">Imagen PNG</option></select></Field>
        </div>
        <details className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <summary className="cursor-pointer text-sm font-bold text-white/70">Impresoras compatibles y protocolos</summary>
          <div className="mt-3 grid gap-3 text-sm text-white/60 md:grid-cols-2 lg:grid-cols-3">
            <div><p className="font-bold text-white">ZPL</p><p>Zebra, Xprinter, Rongta, 2connet (2C-LP427B, 2C-LP281B/E), Agiler (AGI-PR4000UB, PR3000U)</p></div>
            <div><p className="font-bold text-white">TSPL</p><p>TSC, Printronix Auto ID, SATO (parte)</p></div>
            <div><p className="font-bold text-white">EPL</p><p>Zebra ZPL-II legacy (LP2824+, GK420)</p></div>
            <div><p className="font-bold text-white">CPCL</p><p>Honeywell (Intermec), Citizen, Godex</p></div>
            <div><p className="font-bold text-white">ESC/POS</p><p>Epson TM, Bixolon, Star Micronics, Brother (QW), genericas</p></div>
            <div><p className="font-bold text-white">PDF vectorial</p><p>Cualquier impresora via dialogo nativo del sistema operativo</p></div>
          </div>
        </details>
        <p className="mt-3 text-xs text-white/40">Para impresion USB directa use Chrome/Edge con WebUSB. Para ZPL/EPL/TSPL/CPCL descargue el archivo y envielo con ZebraNet Bridge, BarTender o la herramienta del fabricante. El motor usa milimetros reales con calibracion avanzada (offset, escala, rotacion, compensacion de corte).</p>
      </section>

      <section>
        <h3 className="font-display text-xl font-bold">Auditoria reciente</h3>
        <div className="mt-3 grid gap-2">{auditLogs.slice(0, 8).map((log) => <div key={log.id} className="rounded-lg bg-white/[0.035] p-3 text-sm"><p className="font-bold">{log.action} · {log.module}</p><p className="text-white/45">{log.user} · {log.date}</p></div>)}</div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3"><ShieldCheck className="text-red-300" /><div><h2 className="font-display text-2xl font-bold">Integridad de datos</h2><p className="text-sm text-white/45">Detecta y elimina registros huerfanos: facturas con estados invalidos, cuentas por cobrar sin factura, pagos huérfanos.</p></div></div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={ShieldCheck} onClick={() => {
            const report = useERPStore.getState().verifyDataIntegrity()
            const total = report.invalidStatusInvoices + report.orphanReceivables + report.orphanPayments + report.orphanInventoryMovements + report.orphanFinancialMovements + report.orphanCreditNotes
            if (total === 0) { toast.success('No se encontraron datos huerfanos. Todo en orden.') } else { toast.info(`Se encontraron ${total} registros con problemas.`) }
            if (report.details.length > 0) alert(report.details.join('\n'))
          }}>Verificar integridad</Button>
          <Button variant="danger" icon={Trash2} onClick={() => {
            if (!window.confirm('Eliminar todos los registros huerfanos del sistema? Esta accion no se puede deshacer.')) return
            const result = useERPStore.getState().cleanupOrphanData()
            toast.success(result.message)
            if (result.removed && Object.values(result.removed).some((v) => v > 0)) alert(JSON.stringify(result.removed, null, 2))
          }}>Limpiar datos huerfanos</Button>
          <Button variant="secondary" icon={Sparkles} onClick={() => {
            const result = useERPStore.getState().recalculateFinancialFields()
            toast.success(result.message)
            if (result.fixed && Object.values(result.fixed).some((v) => v > 0)) alert(JSON.stringify(result.fixed, null, 2))
          }}>Recalcular balances</Button>
        </div>
      </section>

    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="label-dark">{label}</span>{children}</label>
}

function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition ${checked ? 'border-emerald-400/45 bg-emerald-500/12 text-emerald-100' : 'border-white/10 bg-white/[0.035] text-white/55'}`}>
      <span className="text-sm font-bold">{label}</span>
      <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? 'bg-emerald-400' : 'bg-white/15'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}

function Input({ label, value, onChange, type = 'text', id }) {
  const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined)
  return <label><span className="label-dark">{label}</span><input id={inputId} type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} className="input-dark" /></label>
}
function List({ items }) {
  return <div className="mt-4 space-y-2">{items.map((item) => <p key={item} className="rounded-lg bg-white/[0.035] p-2 text-sm text-white/60">{item}</p>)}</div>
}
