import { create } from 'zustand'

export const useToast = create((set) => ({
  toasts: [],
  push(toast) {
    const id = crypto.randomUUID()
    const payload = { id, type: 'success', duration: 3000, ...toast }
    set((state) => ({ toasts: [...state.toasts, payload] }))
    if (payload.duration > 0) {
      window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), payload.duration)
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
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
  },
}))

