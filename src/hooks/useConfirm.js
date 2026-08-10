import { useState } from 'react'

export function useConfirm() {
  const [state, setState] = useState({ open: false })
  function ask(options) {
    return new Promise((resolve) => {
      setState({ open: true, ...options, resolve })
    })
  }
  function close(value) {
    state.resolve?.(value)
    setState({ open: false })
  }
  return { confirmState: state, ask, close }
}

