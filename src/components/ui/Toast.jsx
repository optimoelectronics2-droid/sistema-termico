import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'
import { useToast } from '../../hooks/useToast'

const styles = {
  success: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
  warning: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  error: 'border-red-400/30 bg-red-500/15 text-red-100',
}

const icons = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

export function ToastViewport() {
  const toasts = useToast((state) => state.toasts)
  const remove = useToast((state) => state.remove)
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(420px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = icons[toast.type] || CheckCircle2
        return (
          <div key={toast.id} className={`rounded-lg border p-3 shadow-2xl backdrop-blur-xl ${styles[toast.type]}`}>
            <div className="flex items-start gap-3">
              <Icon size={19} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                {toast.title ? <p className="font-bold">{toast.title}</p> : null}
                <p className="text-sm leading-5">{toast.message}</p>
              </div>
              <button type="button" onClick={() => remove(toast.id)} className="rounded p-1 opacity-70 hover:bg-white/10 hover:opacity-100" aria-label="Cerrar notificacion">
                <X size={15} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
