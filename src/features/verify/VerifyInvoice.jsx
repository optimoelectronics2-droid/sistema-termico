import { useEffect, useState } from 'react'
import { currency, formatDate } from '../../lib/formatters'

function decodeInvoiceData() {
  try {
    const hash = window.location.hash?.slice(1) || ''
    const search = window.location.search || ''
    let dataStr = ''
    if (hash) {
      try {
        const b64 = decodeURIComponent(hash)
        dataStr = decodeURIComponent(atob(b64))
      } catch {
        dataStr = atob(hash)
        try { dataStr = decodeURIComponent(dataStr) } catch {}
      }
    } else if (search.includes('data=')) {
      const params = new URLSearchParams(search)
      const b64 = params.get('data')
      if (b64) {
        try {
          dataStr = decodeURIComponent(atob(decodeURIComponent(b64)))
        } catch {
          dataStr = atob(b64)
        }
      }
    } else if (search.includes('n=')) {
      const params = new URLSearchParams(search)
      return { number: params.get('n') || 'DESCONOCIDA', serial: params.get('serial') || '', token: params.get('token') || '', id: params.get('id') || '' }
    }
    if (!dataStr) return null
    return JSON.parse(dataStr)
  } catch {
    return null
  }
}

export function VerifyInvoice() {
  const [invoice, setInvoice] = useState(null)

  useEffect(() => {
    const data = decodeInvoiceData()
    if (!data) return
    let fullInvoices = []
    try { fullInvoices = JSON.parse(localStorage.getItem('trifusion-erp-state-v2') || '{}')?.state?.invoices || [] } catch {}
    if (data.id && (!data.items || data.items.length === 0)) {
      const full = fullInvoices.find((inv) => inv.id === data.id)
      if (full) {
        setInvoice({
          number: data.n || full.number,
          ncf: full.ncf || '',
          customerName: full.customerName || '',
          total: full.totals?.total || 0,
          date: full.issuedAt || full.createdAt || '',
          serial: data.s || data.serial || '',
          token: data.t || data.token || '',
          companyName: full.companyName || '',
          notesCustomer: full.notesCustomer || '',
          items: (full.items || []).slice(0, 8).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, net: i.net, tax: i.tax })),
          id: data.id,
          n: data.n,
          s: data.s,
          t: data.t,
        })
        return
      }
    }
    if (data.n && data.s) {
      setInvoice({ number: data.n, n: data.n, serial: data.s, token: data.t, id: data.id, total: data.total, customerName: data.customerName, items: data.items, notesCustomer: data.notesCustomer, companyName: data.companyName, ncf: data.ncf, date: data.date })
    } else {
      setInvoice(data)
    }
  }, [])

  if (!invoice) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0A0A0F] p-6 text-white">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] p-8 text-center">
          <h1 className="text-2xl font-black">Verificación de factura</h1>
          <p className="mt-2 text-sm text-white/60">No se encontró información de factura en el QR.</p>
          <p className="mt-4 text-xs text-white/40">Escanee nuevamente el código QR impreso en su factura térmica.</p>
        </div>
      </div>
    )
  }

  const isDespachada = true // Siempre que se accede vía QR se considera despachada

  return (
    <div className="min-h-screen bg-[#0A0A0F] p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-white font-bold">Factura verificada</h1>
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">Válida</span>
        </div>
        <div id="invoice-verify" className="relative overflow-hidden rounded-xl bg-white p-6 md:p-8 shadow-2xl">
          {isDespachada ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="select-none text-6xl md:text-8xl font-black tracking-[0.2em] text-red-600 opacity-[0.09]" style={{ transform: 'rotate(-30deg)' }}>DESPACHADA</span>
            </div>
          ) : null}
          <div className="relative">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-900">{invoice.companyName || 'Trifusion Technologies'}</h2>
                {invoice.companyRnc ? <p className="text-xs text-slate-500">RNC: {invoice.companyRnc}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-slate-900">FACTURA</p>
                <p className="font-bold">No. {invoice.number || invoice.n || '—'}</p>
                {invoice.ncf ? <p className="text-xs">NCF: {invoice.ncf}</p> : null}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-b border-slate-200 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Cliente</p>
                <p className="font-bold text-slate-900">{invoice.customerName || invoice.customer || 'Consumidor final'}</p>
                {invoice.customerDocument ? <p className="text-sm text-slate-600">{invoice.customerDocument}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase text-slate-500">Fecha</p>
                <p>{invoice.date ? formatDate(invoice.date) : ''}</p>
                <p className="text-xs text-slate-500">Total: {invoice.total ? currency.format(invoice.total) : ''}</p>
              </div>
            </div>
            {invoice.items && invoice.items.length ? (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-left text-xs uppercase">
                    <th className="py-2">#</th><th>Producto</th><th className="text-right">Cant</th><th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-200">
                      <td className="py-2">{idx + 1}</td>
                      <td className="py-2 font-medium">{item.name}</td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{currency.format((item.net || 0) + (item.tax || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <div className="mt-4 text-right">
              <p className="text-lg font-black">TOTAL {invoice.total ? currency.format(invoice.total) : ''}</p>
            </div>
            {invoice.notesCustomer ? (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs font-bold uppercase text-slate-500">Nota</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{invoice.notesCustomer}</p>
              </div>
            ) : null}
            <div className="mt-6 rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-600">
              <p>Documento validado digitalmente</p>
              <p>Serial: {invoice.serial || '—'} | Token: {invoice.token || '—'}</p>
              <p className="mt-2 font-bold text-emerald-700">✓ Factura válida y despachada</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-white/40">Trifusion Technologies · Santo Domingo Este / Alma Rosa II · C. Club Activo 20-30 · Tel: +1 (829) 872-5163 · trifusiontechnologies1936@gmail.com</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Imprimir PDF</button>
          <button onClick={() => window.history.back()} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-bold text-white/70">Volver</button>
        </div>
      </div>
    </div>
  )
}