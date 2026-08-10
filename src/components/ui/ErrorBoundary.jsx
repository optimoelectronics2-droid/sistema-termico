import { Component } from 'react'
import { Button } from './Button'

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.lastError = { error, info }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="grid min-h-screen place-items-center bg-[#0A0A0F] p-4 text-white">
        <section className="panel max-w-xl rounded-lg p-6">
          <p className="text-xs font-extrabold uppercase text-red-200/80">Error de interfaz</p>
          <h1 className="mt-2 font-display text-3xl font-bold">No pudimos cargar esta vista</h1>
          <p className="mt-3 text-sm text-white/55">
            La aplicacion sigue disponible. Recarga la pantalla para volver a intentarlo.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/55">
            {this.state.error?.message || 'Error desconocido'}
          </pre>
          <Button className="mt-5" onClick={() => this.setState({ error: null })}>
            Reintentar vista
          </Button>
        </section>
      </main>
    )
  }
}
