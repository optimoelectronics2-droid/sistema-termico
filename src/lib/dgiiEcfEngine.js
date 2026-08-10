import { ecfTypes } from './tenantEngine'

const now = () => new Date().toISOString()

export const ecfStatuses = {
  DRAFT: 'draft',
  READY_TO_SIGN: 'ready_to_sign',
  SIGNED: 'signed',
  SENT: 'sent',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CONTINGENCY: 'contingency',
}

export function buildDgiiEcfXml({ invoice, company, customer }) {
  if (!invoice) throw new Error('La factura es obligatoria para generar e-CF.')
  if (!company?.rnc) throw new Error('Configure el RNC de la empresa antes de generar e-CF.')
  const type = invoice.ncfType || 'E32'
  if (!ecfTypes[type]) throw new Error(`Tipo e-CF no soportado: ${type}`)
  const lines = (invoice.items || []).map((item, index) => `
    <Detalle>
      <NumeroLinea>${index + 1}</NumeroLinea>
      <NombreItem>${xml(item.name)}</NombreItem>
      <CantidadItem>${number(item.quantity)}</CantidadItem>
      <PrecioUnitarioItem>${money(item.price)}</PrecioUnitarioItem>
      <MontoItem>${money((item.net || 0) + (item.tax || 0))}</MontoItem>
    </Detalle>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>${xml(type)}</TipoeCF>
      <eNCF>${xml(invoice.ncf || invoice.number || '')}</eNCF>
      <FechaEmision>${xml(dateOnly(invoice.issuedAt || invoice.issueDate || now()))}</FechaEmision>
    </IdDoc>
    <Emisor>
      <RNCEmisor>${digits(company.rnc)}</RNCEmisor>
      <RazonSocialEmisor>${xml(company.legalName || company.name || '')}</RazonSocialEmisor>
      <DireccionEmisor>${xml(company.address || '')}</DireccionEmisor>
    </Emisor>
    <Comprador>
      <RNCComprador>${digits(customer?.rnc || customer?.cedula || '')}</RNCComprador>
      <RazonSocialComprador>${xml(customer?.name || invoice.customerName || 'Consumidor final')}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoGravadoTotal>${money(invoice.totals?.taxableSubtotal)}</MontoGravadoTotal>
      <MontoExento>${money(invoice.totals?.exemptSubtotal)}</MontoExento>
      <ITBIS18>${money(invoice.totals?.itbis)}</ITBIS18>
      <MontoTotal>${money(invoice.totals?.total)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>${lines}
  </DetallesItems>
</ECF>`
}

export function createEcfSubmission({ invoice, company, customer }) {
  const xml = buildDgiiEcfXml({ invoice, company, customer })
  return {
    id: `ecf-${crypto.randomUUID()}`,
    invoiceId: invoice.id,
    companyId: company.id,
    type: invoice.ncfType,
    status: ecfStatuses.READY_TO_SIGN,
    xml,
    signedXml: '',
    trackId: '',
    attempts: 0,
    errors: [],
    history: [{ status: ecfStatuses.READY_TO_SIGN, at: now(), note: 'XML generado y pendiente de firma.' }],
    createdAt: now(),
    updatedAt: now(),
  }
}

function xml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function digits(value = '') {
  return String(value).replace(/[^\d]/g, '')
}

function number(value = 0) {
  return Number(value || 0).toFixed(2)
}

function money(value = 0) {
  return Number(value || 0).toFixed(2)
}

function dateOnly(value) {
  return String(value).slice(0, 10)
}
