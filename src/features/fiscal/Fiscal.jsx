import { AlertTriangle, FileSpreadsheet, ShieldCheck } from 'lucide-react'
import { DataTable } from '../../components/ui/DataTable'
import { Button } from '../../components/ui/Button'
import { useERPStore } from '../../store/useERPStore'
import { buildFiscalBuckets, ncfTypes } from '../../lib/taxEngine'
import { currency } from '../../lib/formatters'

export function Fiscal() {
  const sequences = useERPStore((state) => state.taxSequences)
  const invoices = useERPStore((state) => state.invoices)
  const buckets = buildFiscalBuckets(invoices)
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-3">
        <Tile icon={ShieldCheck} label="ITBIS reportable" value={currency.format(buckets.taxed.itbis + buckets.mixed.itbis)} />
        <Tile icon={FileSpreadsheet} label="607 ventas" value={buckets.taxed.count + buckets.mixed.count} />
        <Tile icon={AlertTriangle} label="Secuencias bajas" value={sequences.filter((s) => s.limit - s.next < 20).length} />
      </section>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold">Modulo fiscal RD</h2>
            <p className="text-sm text-white/45">B01, B02, B14, B15, B16, B04 y e-NCF con alertas y borradores 606/607/608/IT-1.</p>
          </div>
          <Button variant="ghost" icon={FileSpreadsheet}>Exportar DGII</Button>
        </div>
        <DataTable data={sequences} columns={[
          { header: 'Tipo', accessorKey: 'id' },
          { header: 'Nombre', cell: ({ row }) => ncfTypes[row.original.id] || row.original.id },
          { header: 'Siguiente', cell: ({ row }) => `${row.original.prefix}${String(row.original.next).padStart(8, '0')}` },
          { header: 'Restantes', cell: ({ row }) => row.original.limit - row.original.next },
          { header: 'Vence', accessorKey: 'expiresAt' },
          { header: 'Estado', cell: ({ row }) => row.original.enabled ? 'Activo' : 'Inactivo' },
        ]} />
      </section>
    </div>
  )
}

function Tile({ icon: Icon, label, value }) {
  return <div className="panel rounded-lg p-4"><Icon className="text-blue-300" /><p className="mt-3 text-xs font-bold uppercase text-white/40">{label}</p><p className="mt-1 font-display text-2xl font-bold">{value}</p></div>
}

