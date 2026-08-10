import { useNavigate, useParams } from 'react-router-dom'
import { InvoiceForm } from '../InvoiceForm'
import { useERPStore } from '../../../store/useERPStore'

export function InvoiceEdit() {
  const { invoiceId } = useParams()
  const navigate = useNavigate()
  const invoice = useERPStore((state) => state.invoices.find((item) => item.id === invoiceId))

  if (!invoice) {
    return <section className="panel rounded-lg p-5 text-white/60">No encontramos esta factura para editar.</section>
  }

  return <InvoiceForm initialInvoice={invoice} onDone={(saved) => navigate(`/facturacion/${saved.id}`)} />
}
