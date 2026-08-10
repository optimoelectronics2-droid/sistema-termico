import { useParams } from 'react-router-dom'
import { InvoicePreview } from '../../../components/invoice/InvoicePreview'
import { useERPStore } from '../../../store/useERPStore'

export function InvoicePrint() {
  const { invoiceId } = useParams()
  const invoice = useERPStore((state) => state.invoices.find((item) => item.id === invoiceId))
  const customer = useERPStore((state) => state.customers.find((item) => item.id === invoice?.customerId))
  const company = useERPStore((state) => state.company)

  if (!invoice) {
    return <section className="panel rounded-lg p-5 text-white/60">No encontramos esta factura para imprimir.</section>
  }

  return <InvoicePreview invoice={invoice} company={company} customer={customer} autoPrint />
}
