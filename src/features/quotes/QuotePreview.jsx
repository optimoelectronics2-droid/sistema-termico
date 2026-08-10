import { currency, formatDate } from '../../lib/formatters'

export function QuotePreview({ quote, company, customer }) {
  if (!quote) return null
  const c = customer || {}
  const comp = company || {}
  const total = quote.totals || {}

  return (
    <div id="quote-preview" className="bg-white p-8 text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <div className="mb-6 flex items-start justify-between border-b border-gray-300 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{comp.legalName || comp.name || 'Empresa'}</h1>
          <p className="mt-1 text-sm text-gray-600">{comp.address || ''}</p>
          <p className="text-sm text-gray-600">{comp.rnc ? `RNC: ${comp.rnc}` : ''}{comp.phone ? ` · Tel: ${comp.phone}` : ''}</p>
          {comp.email ? <p className="text-sm text-gray-600">{comp.email}</p> : null}
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold text-blue-700">COTIZACION</h2>
          <p className="mt-1 text-sm font-bold text-gray-800">{quote.number || ''}</p>
        </div>
      </div>

      <div className="mb-6 flex justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-gray-500">Cliente</p>
          <p className="mt-1 font-bold text-gray-900">{quote.customerName || c.name || 'Cliente'}</p>
          {c.rnc ? <p className="text-sm text-gray-600">RNC: {c.rnc}</p> : null}
          {c.cedula ? <p className="text-sm text-gray-600">Cedula: {c.cedula}</p> : null}
          {c.phone ? <p className="text-sm text-gray-600">Tel: {c.phone}</p> : null}
          {c.email ? <p className="text-sm text-gray-600">{c.email}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase text-gray-500">Fecha</p>
          <p className="text-sm text-gray-800">{formatDate(quote.date || quote.createdAt)}</p>
          <p className="mt-2 text-xs font-bold uppercase text-gray-500">Valida hasta</p>
          <p className="text-sm text-gray-800">{formatDate(quote.validUntil)}</p>
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gray-300 bg-gray-100">
            <th className="px-3 py-2 text-left font-bold text-gray-700">#</th>
            <th className="px-3 py-2 text-left font-bold text-gray-700">Producto</th>
            <th className="px-3 py-2 text-right font-bold text-gray-700">Cant.</th>
            <th className="px-3 py-2 text-right font-bold text-gray-700">Precio</th>
            <th className="px-3 py-2 text-right font-bold text-gray-700">Desc.%</th>
            <th className="px-3 py-2 text-right font-bold text-gray-700">ITBIS</th>
            <th className="px-3 py-2 text-right font-bold text-gray-700">Total</th>
          </tr>
        </thead>
        <tbody>
          {(quote.items || []).map((line, index) => {
            const itemTotal = (Number(line.price || 0) * Number(line.quantity || 0)) * (1 - Number(line.discount || 0) / 100)
            const itemTax = line.taxable ? itemTotal * 0.18 : 0
            return (
              <tr key={line.id || index} className="border-b border-gray-200">
                <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-900">{line.name || 'Producto'}</p>
                  {line.description ? <p className="text-xs text-gray-500">{line.description}</p> : null}
                  {line.sku ? <p className="text-xs text-gray-400">SKU: {line.sku}</p> : null}
                </td>
                <td className="px-3 py-2 text-right text-gray-800">{Number(line.quantity || 0)}</td>
                <td className="px-3 py-2 text-right text-gray-800">{currency.format(Number(line.price || 0))}</td>
                <td className="px-3 py-2 text-right text-gray-800">{Number(line.discount || 0) > 0 ? `${line.discount}%` : '-'}</td>
                <td className="px-3 py-2 text-right text-gray-800">{line.taxable ? '18%' : 'Exento'}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">{currency.format(itemTotal + itemTax)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <div className="w-64 space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal:</span>
            <span>{currency.format(total.subtotal || 0)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>ITBIS (18%):</span>
            <span>{currency.format(total.itbis || 0)}</span>
          </div>
          {total.discount > 0 ? (
            <div className="flex justify-between text-sm text-gray-600">
              <span>Descuento:</span>
              <span>-{currency.format(total.discount || 0)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-gray-300 pt-1 text-base font-bold text-gray-900">
            <span>Total:</span>
            <span>{currency.format(total.total || 0)}</span>
          </div>
        </div>
      </div>

      {quote.commercialTerms ? (
        <div className="mt-6 border-t border-gray-300 pt-4 text-xs text-gray-500">
          <p className="font-bold uppercase text-gray-600">Condiciones comerciales</p>
          <p className="mt-1 whitespace-pre-wrap">{quote.commercialTerms}</p>
        </div>
      ) : null}

      {quote.notes ? (
        <div className="mt-3 text-xs text-gray-500">
          <p className="font-bold uppercase text-gray-600">Notas</p>
          <p className="mt-1 whitespace-pre-wrap">{quote.notes}</p>
        </div>
      ) : null}

      <div className="mt-8 border-t border-gray-300 pt-3 text-center text-xs text-gray-400">
        <p>Documento generado por Trifusion ERP Fiscal</p>
        <p className="mt-1">Esta cotizacion no constituye documento fiscal.</p>
      </div>
    </div>
  )
}
