import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({ open, title, description, children, onClose, size = 'lg', footer }) {
  const wrapperRef = useRef(null)
  const previousFocus = useRef(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      previousFocus.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const focusable = wrapper.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()
    const handler = (event) => {
      if (event.key !== 'Tab') return
      if (event.shiftKey) {
        if (document.activeElement === first) { event.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    wrapper.addEventListener('keydown', handler)
    return () => wrapper.removeEventListener('keydown', handler)
  }, [open])

  if (!open) return null

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    full: 'max-w-[min(1680px,calc(100vw-16px))]',
  }

  return (
    <div ref={wrapperRef} className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/75 p-2 pt-3 backdrop-blur-sm sm:p-3 md:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[calc(100vh-24px)] w-[calc(100vw-16px)] overflow-hidden ${sizes[size]} md:w-[calc(100vw-32px)]`} style={{background: 'var(--bg-elevated)', border: '1px solid var(--line)'}}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-4 py-3" style={{borderColor: 'var(--line)', background: 'var(--bg-surface)'}}>
          <div>
            <h2 className="font-display text-xl font-bold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-white/50">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" className="px-3" onClick={onClose} aria-label="Cerrar modal" icon={X} />
        </div>
        <div className="max-h-[calc(100vh-112px)] overflow-y-auto p-3 sm:p-4">{children}</div>
        {footer ? <div className="sticky bottom-0 border-t px-4 py-3" style={{borderColor: 'var(--line)', background: 'var(--bg-surface)'}}>{footer}</div> : null}
      </div>
    </div>
  )
}
