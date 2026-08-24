import QRCode from 'qrcode'
import { FileDown, Mail, MessageCircle, Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { currency, formatDate } from '../../lib/formatters'
import { ncfTypes } from '../../lib/taxEngine'
import { Button } from '../ui/Button'
import { buildCleanInvoicePdf, downloadCleanInvoicePdf, printCleanInvoicePdf } from './invoicePdf'
import { InvoiceThermalActions } from './InvoiceThermalActions'

const WARRANTY_POLICY = `NOTA DE LA GARANTÍA

El daño del producto debe ser por un defecto de fabricación, falla técnica o irregularidad. No aplica garantía por daños ocasionados por el cliente, técnico, catástrofes naturales o problemas con voltajes (Equipos quemados).

ES OBLIGATORIO MOSTRAR LA FACTURA DE COMPRA Y LA CAJA PARA EXIGIR GARANTÍA.

El producto pierde la garantía si ha sido abierto o intentando ser reparado por el cliente.

La garantía va a variar dependiendo el producto, algunos productos no aplican garantía.

DEVOLUCIONES:

No hacemos devolución de dinero. El costo del equipo que se quiera devolver debe consumirse en cualquier equipo de nuestro inventario o se procederá a realizar una nota de crédito para consumo posterior.

Es indispensable presentar el comprobante de compra (Factura física o electrónica).

Es indispensable contar con el producto completo, tal y como fue entregado, es decir con todos sus elementos tales como: etiquetas, accesorios, empaques, manuales originales en buen estado y sin señal de uso.`
const publicAsset = (path) => `${import.meta.env.BASE_URL}${path}`

export function InvoicePreview({ invoice, company, customer, format = 'letter', showActions = true, title = 'FACTURA', autoPrint = false, onAutoPrintDone, autoDownload = false, onAutoDownloadDone }) {
  const [qr, setQr] = useState('')
  const autoPrintRef = useRef('')
  const autoDownloadRef = useRef('')
  const verification = useMemo(() => buildVerificationData(invoice, company), [company, invoice])
  useEffect(() => {
    if (!invoice) return
    let active = true
    QRCode.toDataURL(buildQrPayload(invoice, verification), {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 531,
      color: {
        dark: '#071A3F',
        light: '#FFFFFF',
      },
    }).then((value) => {
      if (active) setQr(value)
    })
    return () => {
      active = false
    }
  }, [invoice, verification])
  useEffect(() => {
    if (!autoPrint || !invoice) return
    if (isEmitted(invoice) && !qr) return
    if (autoPrintRef.current === invoice.id) return
    autoPrintRef.current = invoice.id
    const timer = window.setTimeout(() => {
      printCleanInvoicePdf(invoice, company, customer).finally(() => onAutoPrintDone?.())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [autoPrint, company, customer, invoice, onAutoPrintDone, qr])
  useEffect(() => {
    if (!autoDownload || !invoice) return
    if (isEmitted(invoice) && !qr) return
    if (autoDownloadRef.current === invoice.id) return
    autoDownloadRef.current = invoice.id
    const timer = window.setTimeout(() => {
      downloadCleanInvoicePdf(invoice, company, customer).finally(() => onAutoDownloadDone?.())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [autoDownload, company, customer, invoice, onAutoDownloadDone, qr])
  if (!invoice) return null
  if (format === 'ticket') return <TicketInvoice invoice={invoice} company={company} customer={customer} qr={qr} title={title} showActions={showActions} />
  return <LetterInvoice invoice={invoice} company={company} customer={customer} qr={qr} compact={format === 'half'} title={title} showActions={showActions} />
}

function LetterInvoice({ invoice, company, customer, qr, compact, title, showActions }) {
  const invoiceNumber = displayInvoiceNumber(invoice)
  const fiscalLabel = fiscalDocumentLabel(invoice)
  const fiscal = isFiscalInvoice(invoice)
  const customerDocument = fiscal && customer?.rnc ? `RNC: ${customer.rnc}` : fiscal && customer?.cedula ? `Cédula: ${customer.cedula}` : ''
  const emitted = isEmitted(invoice)

  return (
    <div className="space-y-3">
      {showActions ? <Actions invoice={invoice} customer={customer} company={company} /> : null}
      <div id="invoice-preview" className={`invoice-paper relative mx-auto overflow-hidden rounded-sm p-8 text-[12.5px] leading-relaxed ${compact ? 'max-w-[720px]' : 'max-w-[816px]'}`}>
        <Header company={company} title={title} fiscal={fiscal} />
        <section className="mt-5 grid grid-cols-2 gap-5 border-y border-slate-300 py-4">
          <div>
            <p className="text-2xl font-extrabold tracking-tight text-slate-950">{title}</p>
            <p>No. {invoiceNumber}</p>
            <p>Fecha: {formatDate(invoice.issuedAt || invoice.createdAt || invoice.issueDate)}</p>
          </div>
          <div className="text-right">
            {invoice.ncf ? <p><b>NCF:</b> {invoice.ncf}</p> : null}
            {fiscalLabel ? <p><b>Comprobante:</b> {fiscalLabel}</p> : null}
            <p><b>Estado:</b> {statusLabel(invoice.status)}</p>
          </div>
        </section>
        <section className="grid grid-cols-2 gap-5 border-b border-slate-300 py-4">
          <div>
            <p className="text-xs font-extrabold uppercase text-slate-500">Cliente</p>
            <p className="mt-1 text-lg font-extrabold text-slate-950">{customer?.name || invoice.customerName || 'Consumidor final'}</p>
            {customerDocument ? <p>{customerDocument}</p> : null}
            {customer?.address || customer?.fullAddress ? <p>{customer.address || customer.fullAddress}</p> : null}
            {customer?.phone || customer?.whatsapp ? <p>{customer.phone || customer.whatsapp}</p> : null}
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase text-slate-500">Resumen administrativo</p>
            <p><b>Vendedor:</b> {invoice.seller || 'Administrador'}</p>
            <p><b>Pago:</b> {paymentLabel(invoice)}</p>
            {balanceDue(invoice) > 0 ? <p><b>Vence:</b> {invoice.dueDate || 'N/A'}</p> : null}
          </div>
        </section>
        <table className="mt-5 w-full border-collapse">
          <thead>
            <tr className="border-y border-slate-950 text-left text-[11px] uppercase">
              <th className="py-2">#</th><th className="py-2">Descripción</th><th className="py-2 text-right">Cant</th><th className="py-2 text-right">Precio</th><th className="py-2 text-right">Desc.</th>{fiscal ? <th className="py-2 text-right">ITBIS</th> : null}<th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((item, index) => (
              <tr key={`${item.id || item.productId}-${index}`} className="border-b border-slate-200 align-top">
                <td className="py-2">{index + 1}</td>
                <td className="py-2">
                  <p className="font-bold text-slate-950">{item.name}</p>
                  {item.sku || item.model ? <p className="text-xs text-slate-500">{[item.sku, item.model].filter(Boolean).join(' · ')}</p> : null}
                  {(item.serials || (item.serial ? [item.serial] : [])).map((serial) => <p key={serial} className="text-xs text-slate-500">Serial: {serial}</p>)}
                  {fiscal && !item.taxable ? <p className="text-xs text-slate-500">Exento de ITBIS</p> : null}
                </td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{currency.format(item.price || 0)}</td>
                <td className="py-2 text-right">{Number(item.discount || 0) ? `${Number(item.discount || 0)}%` : '-'}</td>
                {fiscal ? <td className="py-2 text-right">{currency.format(item.tax || 0)}</td> : null}
                <td className="py-2 text-right font-bold">{currency.format((item.net || 0) + (item.tax || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="mt-5 grid grid-cols-[1fr_300px] gap-8">
          <div className="text-slate-600">
            {invoice.notesCustomer || company?.invoiceTerms ? <p>{invoice.notesCustomer || company.invoiceTerms}</p> : null}
          </div>
          <div className="space-y-1">
            {fiscal ? <TotalLine label="Subtotal gravado" value={invoice.totals?.taxableSubtotal} /> : null}
            {fiscal ? <TotalLine label="Subtotal exento" value={invoice.totals?.exemptSubtotal} /> : null}
            {fiscal ? <TotalLine label="ITBIS 18%" value={invoice.totals?.itbis} /> : null}
            <TotalLine label="Pagado" value={paidAmount(invoice)} />
            <TotalLine label="Pendiente" value={balanceDue(invoice)} />
            <TotalLine label="TOTAL" value={invoice.totals?.total} strong />
          </div>
        </section>
        <footer className="mt-8 grid grid-cols-[1fr_105mm] items-end gap-6 border-t border-slate-300 pt-4">
          <div className="whitespace-pre-line text-[9.5px] leading-snug text-slate-700">{WARRANTY_POLICY}</div>
          <div className="text-center text-xs">
            {emitted ? (
              <div className="invoice-validation-set mx-auto mb-2">
                <ValidationQr qr={qr} />
                <ValidationSeal />
              </div>
            ) : null}
            <div className="border-t border-slate-950 pt-2">Firma autorizada</div>
          </div>
        </footer>
      </div>
    </div>
  )
}

function TicketInvoice({ invoice, company, customer, qr, title, showActions }) {
  const invoiceNumber = displayInvoiceNumber(invoice)
  const fiscal = isFiscalInvoice(invoice)
  return (
    <div className="space-y-3">
      {showActions ? <Actions invoice={invoice} customer={customer} company={company} /> : null}
      <div id="invoice-preview" className="invoice-paper relative mx-auto w-[302px] overflow-hidden rounded-sm p-3 text-center font-mono text-[11px]">
        <p className="text-lg font-black">{company?.name || 'Empresa'}</p>
        {fiscal && company?.rnc ? <p>RNC: {company.rnc}</p> : null}
        {company?.address ? <p>{company.address}</p> : null}
        {company?.phone ? <p>Tel: {company.phone}</p> : null}
        <p>- - - - - - - - - - - - - - -</p>
        <p className="text-base font-black">{title}</p>
        <p className="font-bold">{invoiceNumber}</p>
        {fiscal && invoice.ncf ? <p>NCF: {invoice.ncf}</p> : null}
        <p>{formatDate(invoice.issuedAt || invoice.createdAt)}</p>
        <p>Cliente: {customer?.name || invoice.customerName || 'Final'}</p>
        <p>- - - - - - - - - - - - - - -</p>
        {(invoice.items || []).map((item, index) => (
          <div key={`${item.productId}-${index}`} className="py-1 text-left">
            <p>{index + 1}. {item.name}</p>
            <p className="text-right">{item.quantity} x {currency.format(item.price)} = {currency.format((item.net || 0) + (item.tax || 0))}</p>
          </div>
        ))}
        <p>- - - - - - - - - - - - - - -</p>
        {fiscal ? <p>SUBTOTAL {currency.format(invoice.totals?.subtotal || 0)}</p> : null}
        {fiscal ? <p>ITBIS {currency.format(invoice.totals?.itbis || 0)}</p> : null}
        <p className="mt-1 text-xl font-black">TOTAL {currency.format(invoice.totals?.total || 0)}</p>
        {qr ? <img src={qr} alt="QR de validación" className="mx-auto mt-2 h-20 w-20" /> : null}
        <p className="mt-1 text-[9px]">Escanee el QR para validar</p>
        <p className="mt-2">{company?.name || 'Empresa'}</p>
      </div>
    </div>
  )
}

function Header({ company, title, fiscal }) {
  const logoUrl = company?.logoUrl || publicAsset('trifusion-logo.png')
  return (
    <header className="flex items-start gap-4">
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded border border-slate-200 bg-black"><img src={logoUrl} crossOrigin="anonymous" alt="Logo Trifusion Technologies" className="h-full w-full object-contain" /></div>
      <div>
        <p className="text-2xl font-black tracking-tight text-slate-950">{company?.name || 'Empresa'}</p>
        {fiscal && company?.rnc ? <p>RNC: {company.rnc}</p> : null}
        {company?.address ? <p>{company.address}</p> : null}
        {company?.phone || company?.whatsapp ? <p>{[company?.phone && `Tel: ${company.phone}`, company?.whatsapp && `WA: ${company.whatsapp}`].filter(Boolean).join(' | ')}</p> : null}
        {company?.email ? <p>{company.email}</p> : null}
      </div>
      <p className="ml-auto text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
    </header>
  )
}

function ValidationQr({ qr }) {
  return (
    <div className="invoice-qr-card" aria-label="Codigo QR de validacion de factura">
      {qr ? <img src={qr} width="531" height="531" alt="QR de validacion de factura" className="invoice-validation-qr" /> : null}
      <span className="text-[7px] font-black uppercase text-[#071a3f]">Validar QR</span>
    </div>
  )
}

function ValidationSeal() {
  return (
    <div className="invoice-validation" aria-label="Sello de validacion digital">
      <img src={publicAsset('sello-real.png')} crossOrigin="anonymous" width="531" height="531" alt="Sello de validacion" className="invoice-legal-stamp" />
    </div>
  )
}

function TotalLine({ label, value, strong }) {
  if (!Number(value || 0) && !strong && !['Pagado', 'Pendiente'].includes(label)) return null
  return <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-950 pt-2 text-lg font-black text-slate-950' : 'text-slate-700'}`}><span>{label}</span><span>{currency.format(value || 0)}</span></div>
}

async function sharePdfViaWhatsApp(invoice, customer, company) {
  const pdf = await buildCleanInvoicePdf()
  if (!pdf) return
  const phone = sanitizePhone(customer?.whatsapp || customer?.phone || company?.whatsapp || company?.phone)
  const companyName = company?.name || company?.legalName || 'Empresa'
  const title = `factura-${displayInvoiceNumber(invoice)}`
  const text = `${companyName}\nFactura ${displayInvoiceNumber(invoice)}\nTotal: ${currency.format(invoice.totals?.total || 0)}`
  const blob = pdf.output('blob')
  const file = new File([blob], `${title}.pdf`, { type: 'application/pdf' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text }); return } catch { /* fall through to download */ }
  }
  downloadBlob(blob, `${title}.pdf`)
  if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text + `\n\nPDF descargado: ${title}.pdf`)}`)
}

async function sharePdfViaEmail(invoice, customer, company) {
  const pdf = await buildCleanInvoicePdf()
  if (!pdf) return
  const companyName = company?.name || company?.legalName || 'Empresa'
  const title = `factura-${displayInvoiceNumber(invoice)}`
  const subject = `Factura ${displayInvoiceNumber(invoice)} - ${companyName}`
  const text = `${companyName}\nFactura ${displayInvoiceNumber(invoice)}\nTotal: ${currency.format(invoice.totals?.total || 0)}`
  const blob = pdf.output('blob')
  const file = new File([blob], `${title}.pdf`, { type: 'application/pdf' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: subject, text }); return } catch { /* fall through to download */ }
  }
  downloadBlob(blob, `${title}.pdf`)
  window.location.href = `mailto:${customer?.email || company?.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text + `\n\nPDF adjunto: ${title}.pdf (descargar del enlace)`)}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function Actions({ invoice, customer, company }) {
  const verification = buildVerificationData(invoice, company)
  return (
    <div className="no-print flex flex-wrap justify-end gap-2">
      <Button variant="primary" icon={FileDown} onClick={() => downloadCleanInvoicePdf(invoice, company, customer)}>PDF limpio</Button>
      <Button variant="ghost" icon={Printer} onClick={() => printCleanInvoicePdf(invoice, company, customer)}>Imprimir</Button>
      <Button variant="ghost" icon={MessageCircle} onClick={() => sharePdfViaWhatsApp(invoice, customer, company)}>WhatsApp</Button>
      <Button variant="ghost" icon={Mail} onClick={() => sharePdfViaEmail(invoice, customer, company)}>Correo</Button>
      <InvoiceThermalActions invoice={invoice} company={company} customer={customer} qrText={buildQrPayload(invoice, verification)} />
    </div>
  )
}

function displayInvoiceNumber(invoice) {
  const number = String(invoice?.number || '')
  if (!number || number === 'SIN NCF') return 'BORRADOR'
  if (number.startsWith('SIN-NCF-')) return number.replace('SIN-NCF-', 'FAC-')
  return number
}

function fiscalDocumentLabel(invoice) {
  if (!invoice?.ncf || invoice?.ncfType === 'NO_FISCAL') return ''
  return ncfTypes[invoice.ncfType] || invoice.ncfType || ''
}

function isFiscalInvoice(invoice) {
  return Boolean(invoice?.ncf && invoice?.ncfType !== 'NO_FISCAL')
}

function statusLabel(status) {
  const map = { paid: 'PAGADA', partial: 'PARCIALMENTE PAGADA', credit: 'PENDIENTE / FIADA', draft: 'BORRADOR', preview: 'VISTA PREVIA', voided: 'ANULADA' }
  return map[status] || String(status || 'EMITIDA').toUpperCase()
}

function paidAmount(invoice) {
  if (invoice?.paidAmount !== undefined) return Number(invoice.paidAmount || 0)
  return (invoice?.payments || []).filter((payment) => payment.method !== 'Credito').reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
}

function balanceDue(invoice) {
  if (invoice?.balanceDue !== undefined) return Number(invoice.balanceDue || 0)
  return Math.max(Number(invoice?.totals?.total || 0) - paidAmount(invoice), 0)
}

function paymentLabel(invoice) {
  const methods = (invoice?.payments || []).filter((payment) => payment.method !== 'Credito').map((payment) => payment.method)
  if (balanceDue(invoice) > 0 && paidAmount(invoice) > 0) return `${methods.join(', ') || 'Abono'} + Credito`
  if (balanceDue(invoice) > 0) return 'Fiado / Credito'
  return methods.join(', ') || invoice?.paymentMethod || 'N/A'
}

function buildVerificationData(invoice, company) {
  return {
    serial: invoice?.authenticationSerial || buildPreviewSerial(invoice),
    token: invoice?.verificationToken || buildVerificationToken(invoice, company),
  }
}

function buildQrPayload(invoice, verification) {
  const dateStr = (() => { try { const d = invoice?.issuedAt || invoice?.createdAt || invoice?.issueDate; return d ? new Date(d).toLocaleDateString('es-DO') : '' } catch { return '' } })()
  const lines = [
    `DESPACHADA`,
    `FACTURA: ${displayInvoiceNumber(invoice)}`,
    `CLIENTE: ${invoice?.customerName || 'Consumidor final'}`,
    `FECHA EMISION: ${dateStr}`,
  ]
  return lines.join('\n')
}

function buildVerificationToken(invoice, company) {
  const raw = `${company?.name || 'TRIFUSION'}|${displayInvoiceNumber(invoice)}|${invoice?.issuedAt || invoice?.createdAt || ''}|${invoice?.totals?.total || 0}`
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0
  const value = Math.abs(hash).toString(36).toUpperCase().padStart(8, '0')
  return `AUTH-${value.slice(0, 4)}-${value.slice(4, 8)}`
}

function buildPreviewSerial(invoice) {
  const raw = `${displayInvoiceNumber(invoice)}|${invoice?.createdAt || invoice?.issueDate || ''}|${invoice?.totals?.total || 0}`
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0
  return `TFT-${new Date().getFullYear()}-${Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`
}

function isEmitted(invoice) {
  return invoice?.status && !['draft', 'preview'].includes(invoice.status)
}

function sanitizePhone(phone = '') {
  return String(phone).replace(/[^\d]/g, '')
}
