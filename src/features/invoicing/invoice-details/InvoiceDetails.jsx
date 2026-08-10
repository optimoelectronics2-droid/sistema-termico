import { useNavigate, useParams } from 'react-router-dom'
import { Pencil, Printer } from 'lucide-react'
import { InvoicePreview } from '../../../components/invoice/InvoicePreview'
import { Button } from '../../../components/ui/Button'
import { useERPStore } from '../../../store/useERPStore'

export function InvoiceDetails() {
  const { invoiceId } = useParams()
  const navigate = useNavigate()
  const invoice = useERPStore((state) => state.invoices.find((item) => item.id === invoiceId))
  const customer = useERPStore((state) => state.customers.find((item) => item.id === invoice?.customerId))
  const company = useERPStore((state) => state.company)

  if (!invoice) {
    return <section className="panel rounded-lg p-5 text-white/60">No encontramos esta factura.</section>
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Factura {invoice.ncf || invoice.number}</h2>
          <p className="text-sm text-white/45">Detalle independiente del historial y del formulario de emision.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={Pencil} onClick={() => navigate(`/facturacion/${invoice.id}/editar`)}>Editar</Button>
          <Button variant="ghost" icon={Printer} onClick={() => navigate(`/facturacion/${invoice.id}/imprimir`)}>Imprimir</Button>
        </div>
      </div>
      <InvoicePreview invoice={invoice} company={company} customer={customer} />
    </div>
  )
}
