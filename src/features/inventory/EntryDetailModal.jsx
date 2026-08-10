import { Modal } from '../../components/ui/Modal'
import { currency, formatDate } from '../../lib/formatters'
import { TypeBadge } from './entryTypes'

function InfoCard({ label, children }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--line-subtle)', background: 'rgba(255,255,255,.03)' }}>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="mt-1 font-bold">{children}</p>
    </div>
  )
}

export function EntryDetailModal({ entry, onClose }) {
  return (
    <Modal open={Boolean(entry)} onClose={onClose} title={`Detalle de entrada · ${entry?.supplierName || 'Sin proveedor'}`} size="lg">
      {entry ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Folio">{entry.number || '—'}</InfoCard>
            <InfoCard label="Fecha">{formatDate(entry.date)}</InfoCard>
            <InfoCard label="Tipo"><TypeBadge type={entry.type} /></InfoCard>
            <InfoCard label="Proveedor">{entry.supplierName || 'Sin proveedor'}</InfoCard>
            <InfoCard label="Factura">{entry.supplierInvoice || '—'}</InfoCard>
            <InfoCard label="Referencia">{entry.reference || '—'}</InfoCard>
          </div>
          <div className="premium-scroll overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line-subtle)' }}>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,.03)' }}>
                  <th className="px-4 py-3 font-bold">Producto</th>
                  <th className="px-4 py-3 font-bold">Cantidad</th>
                  <th className="px-4 py-3 font-bold">Costo</th>
                  <th className="px-4 py-3 font-bold">Subtotal</th>
                  <th className="px-4 py-3 font-bold">Seriales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(entry.items || []).map((item) => (
                  <tr key={`${item.productId}-${item.subtotal}-${(item.serials || []).join()}`}>
                    <td className="px-4 py-3 font-bold">{item.productName || 'Producto eliminado'}</td>
                    <td className="px-4 py-3">{item.quantity}</td>
                    <td className="px-4 py-3">{currency.format(item.cost)}</td>
                    <td className="px-4 py-3 font-bold">{currency.format(item.subtotal)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{item.serials?.length ? item.serials.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>Total de la entrada</span>
            <span className="font-display text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{currency.format(entry.total)}</span>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
