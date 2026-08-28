let lockCount = 0
let originalOverflow = ''

export function useLockBodyScroll(active) {
  // This is a hook-like utility, but we implement as plain functions for useEffect
  // Use directly in useEffect: if (active) lock, else unlock via cleanup
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
