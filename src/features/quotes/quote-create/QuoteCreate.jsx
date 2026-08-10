import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { QuoteForm } from '../QuoteForm'

export function QuoteCreate() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/cotizaciones')} className="inline-flex items-center gap-2 text-sm font-bold text-blue-200 hover:text-white"><ArrowLeft size={16} /> Volver</button>
      </div>
      <QuoteForm onDone={() => navigate('/cotizaciones')} />
    </div>
  )
}
