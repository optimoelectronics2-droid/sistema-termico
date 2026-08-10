import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

export function ConfirmDialog({ state, onClose }) {
  return (
    <Modal
      open={state.open}
      title={state.title || 'Confirmar accion'}
      description={state.description}
      onClose={() => onClose(false)}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onClose(false)}>Cancelar</Button>
          <Button type="button" variant={state.danger ? 'danger' : 'success'} onClick={() => onClose(true)}>Confirmar</Button>
        </div>
      }
    >
      <div className="flex gap-3 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-amber-100">
        <AlertTriangle size={20} className="shrink-0" />
        <p className="text-sm">{state.body || 'Esta accion no se puede deshacer automaticamente.'}</p>
      </div>
    </Modal>
  )
}
