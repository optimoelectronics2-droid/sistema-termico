import { useCallback, useState } from 'react'

const titles = {
  'ventas-hoy': 'Ventas de hoy',
  'ventas-semana': 'Ventas semana',
  'ventas-mes': 'Ventas del mes',
  'cobros-hoy': 'Cobros hoy',
  'cobros-semana': 'Cobros semana',
  'cobros-mes': 'Cobros mes',
  'ganancia-mes': 'Ganancia mes',
  'facturas-pendientes': 'Facturas pendientes',
  'facturas-vencidas': 'Facturas vencidas',
  'clientes-deuda': 'Clientes con deuda',
  'productos-agotados': 'Productos agotados',
  'productos-bajo-minimo': 'Productos bajo minimo',
  'stock-critico': 'Stock critico',
  'clientes-nuevos': 'Clientes nuevos',
  'cuentas-por-cobrar': 'Cuentas por cobrar',
  'impuestos-mes': 'Impuestos mes',
  'caja-actual': 'Caja actual',
  'facturas-credito': 'Facturas credito activas',
  'facturas-fiadas': 'Facturas fiadas',
  'facturas-parciales': 'Facturas parciales',
  'clientes-morosos': 'Clientes morosos',
}

export function useDrillDown(initialModuleId) {
  const [stack, setStack] = useState(() => [{
    type: 'module',
    moduleId: initialModuleId,
    title: titles[initialModuleId] || 'Modulo',
    params: {},
  }])

  const currentView = stack[stack.length - 1]

  const pushView = useCallback((view) => {
    setStack((prev) => [...prev, view])
  }, [])

  const popView = useCallback(() => {
    setStack((prev) => prev.length > 1 ? prev.slice(0, -1) : prev)
  }, [])

  const replaceView = useCallback((view) => {
    setStack((prev) => prev.length > 1 ? [...prev.slice(0, -1), view] : [view])
  }, [])

  const goBackTo = useCallback((viewType) => {
    setStack((prev) => {
      const idx = [...prev].reverse().findIndex((v) => v.type === viewType)
      if (idx <= 0) return prev.length > 1 ? [prev[0]] : prev
      return prev.slice(0, prev.length - idx)
    })
  }, [])

  const breadcrumbs = stack.map((v, i) => ({
    label: v.title || v.moduleId || v.type,
    isLast: i === stack.length - 1,
    onClick: () => setStack((prev) => prev.slice(0, i + 1)),
  }))

  return {
    currentView,
    stack,
    breadcrumbs,
    pushView,
    popView,
    replaceView,
    goBackTo,
    canGoBack: stack.length > 1,
  }
}
