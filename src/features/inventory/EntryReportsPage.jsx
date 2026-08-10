import { BarChart3 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { EntryReports } from './EntryReports'

export function EntryReportsPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Reporte avanzado de entradas</h2>
          <p className="mt-1 text-sm text-white/55">Cantidades, costos, proveedores y exportacion detallada filtrada por fecha.</p>
        </div>
        <Button variant="ghost" icon={BarChart3} onClick={() => navigate('/inventario/entradas')}>Ir a entradas</Button>
      </div>
      <EntryReports />
    </div>
  )
}
