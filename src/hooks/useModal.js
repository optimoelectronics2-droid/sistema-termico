import { useState } from 'react'

export function useModal(initial = false) {
  const [open, setOpen] = useState(initial)
  return {
    open,
    openModal: () => setOpen(true),
    closeModal: () => setOpen(false),
    setOpen,
  }
}
