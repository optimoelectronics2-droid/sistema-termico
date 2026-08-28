import { useEffect } from 'react'

let lockCount = 0
let originalOverflow = ''

export function useLockBodyScroll(active) {
  useEffect(() => {
    if (!active) return undefined
    lockBodyScroll()
    return unlockBodyScroll
  }, [active])
}

export function lockBodyScroll() {
  if (lockCount === 0) originalOverflow = document.body.style.overflow
  lockCount += 1
  document.body.style.overflow = 'hidden'
}

export function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) document.body.style.overflow = originalOverflow
}
