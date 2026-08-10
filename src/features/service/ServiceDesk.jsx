import { Camera, Wrench } from 'lucide-react'
import { DataTable } from '../../components/ui/DataTable'
import { useERPStore } from '../../store/useERPStore'
import { currency } from '../../lib/formatters'

export function ServiceDesk() {
  const orders = useERPStore((state) => state.serviceOrders)
  return (
    <section className="panel rounded-lg p-5">
      <div className="mb-4">
        <h2 className="font-display text-2xl font-bold">Servicio tecnico</h2>
        <p className="text-sm text-white/45">Recibido, diagnostico, reparacion, listo y entregado con fotos, serial y garantia.</p>
      </div>
      <DataTable data={orders} columns={[
        { header: 'Orden', accessorKey: 'id' },
        { header: 'Cliente', accessorKey: 'customerName' },
        { header: 'Equipo', cell: ({ row }) => <div><p className="font-bold text-white">{row.original.device}</p><p className="text-xs text-white/45">Serial {row.original.serial || row.original.imei}</p></div> },
        { header: 'Estado', cell: ({ row }) => <span className="rounded bg-blue-500/15 px-2 py-1 text-xs font-bold text-blue-200">{row.original.status}</span> },
        { header: 'Monto registrado', cell: ({ row }) => currency.format(row.original.approvedBudget || row.original.budget || row.original.total || row.original.amount || 0) },
      ]} />
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {['Recibido', 'Diagnostico', 'Reparacion', 'Listo', 'Entregado'].map((status) => <div key={status} className="rounded-lg border border-white/10 bg-white/[0.035] p-4"><Wrench size={18} className="text-emerald-300" /><p className="mt-2 font-bold">{status}</p></div>)}
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4"><Camera size={18} className="text-blue-300" /><p className="mt-2 font-bold">Fotos y accesorios</p></div>
      </div>
    </section>
  )
}
