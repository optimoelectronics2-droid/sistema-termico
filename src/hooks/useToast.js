import { create } from 'zustand'
import { randomUuid } from '../lib/id'

const toastTimers = new Map()

export const useToast = create((set) => ({
  toasts: [],
  push(toast) {
    const id = randomUuid()
    const defaultDuration = toast.type === 'error' ? 7000 : toast.type === 'warning' ? 5000 : 3000
    const payload = { id, type: 'success', duration: defaultDuration, ...toast }
    // Respect explicit duration, but fallback to type-based default
    if (toast.duration === undefined) payload.duration = defaultDuration
    set((state) => ({ toasts: [...state.toasts, payload] }))
    if (payload.duration > 0) {
      const t = window.setTimeout(() => {
        toastTimers.delete(id)
        set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
      }, payload.duration)
      toastTimers.set(id, t)
    }
    return id
  },
  success(message) {
    return useToast.getState().push({ type: 'success', message, duration: 3000 })
  },
  warning(message) {
    return useToast.getState().push({ type: 'warning', message, duration: 5000 })
  },
  error(message) {
    return useToast.getState().push({ type: 'error', message, duration: 7000 })
  },
  remove(id) {
    const t = toastTimers.get(id)
    if (t) {
      window.clearTimeout(t)
      toastTimers.delete(id)
    }
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
  },
}))
