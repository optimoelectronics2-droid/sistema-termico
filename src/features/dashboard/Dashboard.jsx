import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Banknote, BarChart3, Boxes, CircleDollarSign, FileMinus2, FileText, HandCoins, PackageX, Percent, ReceiptText, Search, Users, Wallet, Zap, TrendingUp, Clock, ShieldAlert, Download } from 'lucide-react'
import { MetricCard } from '../../components/ui/MetricCard'
import { buildExecutiveDashboardModel } from '../../lib/executiveDashboardEngine'
import { currency } from '../../lib/formatters'
import { useERPStore } from '../../store/useERPStore'

const levelConfig = {
  1: { color: 'red', label: 'Criticos', icon: ShieldAlert, desc: 'Indicadores que requieren atencion inmediata' },
  2: { color: 'blue', label: 'Operacion', icon: TrendingUp, desc: 'Ventas, cobros, abonos y actividad del dia' },
  3: { color: 'amber', label: 'Alertas', icon: AlertTriangle, desc: 'Creditos, vencimientos, stock y seguimiento' },
  4: { color: 'violet', label: 'Analisis', icon: BarChart3, desc: 'Ganancias, impuestos y rendimiento mensual' },
  5: { color: 'cyan', label: 'Detalle', icon: Zap, desc: 'Todas las metricas del negocio en un vistazo' },
}

export function Dashboard() {
  const navigate = useNavigate()
  const [level, setLevel] = useState(1)
  const invoices = useERPStore((state) => state.invoices)
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const receivables = useERPStore((state) => state.receivables)
  const payments = useERPStore((state) => state.payments)
  const expenses = useERPStore((state) => state.expenses)
  const creditNotes = useERPStore((state) => state.creditNotes)
  const cashRegister = useERPStore((state) => state.cashRegister)
  const reportStats = useERPStore((state) => state.reportStats)
  const inventoryReports = useERPStore((state) => state.inventoryReports)
  const company = useERPStore((state) => state.company)

  const model = useMemo(() => buildExecutiveDashboardModel({
    invoices, products, customers, receivables, payments, expenses, creditNotes, cashRegister, reportStats, inventoryReports,
  }), [cashRegister, creditNotes, customers, expenses, inventoryReports, invoices, payments, products, receivables, reportStats])

  const downloadReport = useCallback(async () => {
    try {
      const { downloadProfessionalReportPdf } = await import('../../services/professionalReportPdf')
      await downloadProfessionalReportPdf({ company: company || { name: 'Mi Empresa' }, reportStats, generatedAt: new Date(), user: 'Usuario' })
    } catch (err) {
      console.error('Error generating report PDF:', err)
    }
  }, [company, reportStats])

  const overdueCount = model.openReceivables.filter((i) => i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).length
  const lowStockCritical = model.lowStock.length
  const morososCount = new Set(model.openReceivables.filter((i) => i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).map((i) => i.customerId)).size

  const activeLevel = levelConfig[level]
  const execIndicators = reportStats?.executiveSummary?.indicators || []

  const topIndicators = execIndicators.filter((i) => ['totalSales', 'totalProfit', 'averageTicket', 'pendingCredits'].includes(i.id))
  const getColor = (color) => color || 'blue'

  return (
    <div className="space-y-6">
      <div className="pointer-events-none fixed inset-0 transition-all duration-700" style={{ background: `radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--${activeLevel.color}) 12%, transparent), transparent)` }} />

      <section className="module-header relative">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full opacity-20 blur-3xl" style={{ background: `color-mix(in srgb, var(--${activeLevel.color}) 15%, transparent)` }} />
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: `var(--${activeLevel.color})` }} />
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: `var(--${activeLevel.color})` }}>Centro empresarial</p>
            </div>
            <h2 className="font-display text-3xl font-black tracking-tight">Centro de mando ejecutivo</h2>
            <p className="mt-1 max-w-3xl text-sm" style={{ color: 'var(--text-secondary)' }}>Navegacion por niveles — {activeLevel.desc.toLowerCase()}.</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={downloadReport} className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition hover:bg-white/5" style={{ borderColor: 'var(--line)', color: 'var(--text-secondary)' }}>
              <Download size={16} />
              Reporte PDF profesional
            </button>
            <span className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: 'var(--line)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,.035)' }}>
              <activeLevel.icon size={16} style={{ color: `var(--${activeLevel.color})` }} />
              Nivel {level}
            </span>
          </div>
        </div>
        {topIndicators.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {topIndicators.map((ind) => (
              <div key={ind.id} className="rounded-lg border p-3 transition hover:bg-white/[0.02]" style={{ borderColor: `color-mix(in srgb, var(--${getColor(ind.color)}) 25%, transparent)` }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: `var(--${getColor(ind.color)})` }}>{ind.label}</p>
                <p className="mt-1 text-lg font-black">{ind.formatted || String(ind.value)}</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>{ind.interpretation?.slice(0, 80)}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 hidden gap-2 sm:flex">
          {Object.entries(levelConfig).map(([id, tab]) => {
            const isActive = Number(id) === level
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLevel(Number(id))}
                className={`relative flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all duration-200 ${isActive ? 'text-white shadow-lg' : 'border-white/10 text-white/40 hover:text-white/70 bg-white/[0.03]'}`}
                style={isActive ? { borderColor: `color-mix(in srgb, var(--${tab.color}) 40%, transparent)`, background: `color-mix(in srgb, var(--${tab.color}) 12%, transparent)`, boxShadow: `0 4px 16px color-mix(in srgb, var(--${tab.color}) 20%, transparent)` } : {}}
              >
                <tab.icon size={14} />
                {tab.label}
                {isActive && <div className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full" style={{ background: `var(--${tab.color})` }} />}
              </button>
            )
          })}
        </div>
      </section>

      {level === 1 && <CriticalLevel model={model} navigate={navigate} overdueCount={overdueCount} lowStockCritical={lowStockCritical} morososCount={morososCount} />}
      {level === 2 && <OperationsLevel model={model} navigate={navigate} />}
      {level === 3 && <AlertsLevel model={model} navigate={navigate} overdueCount={overdueCount} lowStockCritical={lowStockCritical} morososCount={morososCount} />}
      {level === 4 && <AnalysisLevel model={model} customers={customers} navigate={navigate} />}
      {level === 5 && <DetailLevel model={model} customers={customers} navigate={navigate} />}
    </div>
  )
}

function LevelHeader({ label, description, color, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 group">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--${color}) 25%, transparent), transparent)`, boxShadow: `0 4px 12px color-mix(in srgb, var(--${color}) 15%, transparent)` }}>
        {Icon && <Icon size={16} style={{ color: `var(--${color})` }} />}
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: `var(--${color})` }}>{label}</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      </div>
    </div>
  )
}

function CriticalLevel({ model, navigate, overdueCount, lowStockCritical, morososCount }) {
  const totals = model.totals || {}
  return (
    <div className="section-card space-y-5">
      <LevelHeader label="Nivel 1 — Criticos" description="Indicadores que requieren atencion inmediata" color="red" icon={ShieldAlert} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={CircleDollarSign} accent="red" label="Ventas vencidas" value={currency.format(totals.overdueBalance || 0)} detail={`${overdueCount} facturas vencidas`} onOpen={() => navigate('/dashboard/facturas-vencidas')} openLabel="Ver vencidas" />
        <MetricCard icon={AlertTriangle} accent="red" label="Stock critico" value={lowStockCritical} detail={`${totals.productsSoldToday || 0} productos vendidos hoy`} onOpen={() => navigate('/dashboard/stock-critico')} openLabel="Ver inventario" />
        <MetricCard icon={Users} accent="red" label="Clientes morosos" value={morososCount} detail={`${overdueCount} facturas en mora`} onOpen={() => navigate('/dashboard/clientes-morosos')} openLabel="Ver morosos" />
        <MetricCard icon={Banknote} accent="amber" label="Ganancia mes" value={currency.format(totals.monthProfit || 0)} detail={`Margen: ${totals.monthSales ? ((totals.monthProfit / totals.monthSales) * 100).toFixed(1) : '0.0'}%`} onOpen={() => navigate('/dashboard/ganancia-mes')} openLabel="Ver ganancia" />
      </div>
    </div>
  )
}

function OperationsLevel({ model, navigate }) {
  const totals = model.totals || {}
  return (
    <div className="section-card space-y-5">
      <LevelHeader label="Nivel 2 — Actividad operativa" description="Ventas, cobros, abonos y facturacion del dia" color="blue" icon={TrendingUp} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={CircleDollarSign} accent="green" label="Ventas contado hoy" value={currency.format(totals.todayCashSales || 0)} detail={`${totals.invoicesToday || 0} facturas`} miniStats={[{ label: 'Total hoy', value: currency.format(totals.todaySales || 0) }, { label: 'Productos', value: totals.productsSoldToday || 0 }, { label: 'ITBIS', value: currency.format(totals.todayTax || 0) }]} onOpen={() => navigate('/dashboard/ventas-hoy')} openLabel="Ver ventas" />
        <MetricCard icon={BarChart3} accent="blue" label="Ventas mes" value={currency.format(totals.monthSales || 0)} detail={`${model.monthInvoices?.length || 0} docs`} miniStats={[{ label: 'Ganancia', value: currency.format(totals.monthProfit || 0) }, { label: 'Contado', value: currency.format(totals.monthCashSales || 0) }, { label: 'Credito', value: currency.format(totals.monthCreditSales || 0) }]} onOpen={() => navigate('/dashboard/ventas-mes')} openLabel="Ver ventas mes" />
        <MetricCard icon={HandCoins} accent="amber" label="Abonos hoy" value={currency.format(totals.abonosToday || 0)} detail={`${totals.abonosMonth || 0} este mes`} miniStats={[{ label: 'Semana', value: currency.format(totals.abonosWeek || 0) }, { label: 'Mes', value: currency.format(totals.abonosMonth || 0) }]} onOpen={() => navigate('/dashboard/abonos-hoy')} openLabel="Ver abonos" />
        <MetricCard icon={Wallet} accent="green" label="Cobros hoy" value={currency.format(totals.cashToday || 0)} detail={model.cashSummary?.status === 'open' ? 'Caja abierta' : 'Caja cerrada'} miniStats={[{ label: 'Semana', value: currency.format(totals.cashWeek || 0) }, { label: 'Mes', value: currency.format(totals.cashMonth || 0) }, { label: 'Movs.', value: model.cashSummary?.movements || 0 }]} onOpen={() => navigate('/dashboard/cobros-hoy')} openLabel="Ver cobros" />
      </div>
    </div>
  )
}

function AlertsLevel({ model, navigate, overdueCount, lowStockCritical, morososCount }) {
  const totals = model.totals || {}
  const openRecs = model.openReceivables || []
  return (
    <div className="section-card space-y-5">
      <LevelHeader label="Nivel 3 — Alertas y seguimiento" description="Creditos, vencimientos, stock bajo y cuentas por cobrar" color="amber" icon={AlertTriangle} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Wallet} accent="violet" label="Cuentas por cobrar" value={currency.format(totals.receivablesBalance || 0)} detail={`${openRecs.length} balance(s) abiertos`} miniStats={[{ label: 'Abiertas', value: openRecs.length }, { label: 'Vencidas', value: overdueCount }, { label: 'Clientes', value: new Set(openRecs.map((i) => i.customerId)).size }]} onOpen={() => navigate('/dashboard/cuentas-por-cobrar')} openLabel="Ver CxC" />
        <MetricCard icon={HandCoins} accent="amber" label="Creditos emitidos mes" value={currency.format(totals.monthCreditSales || 0)} detail={`${openRecs.length} cuentas abiertas`} miniStats={[{ label: 'Abonos mes', value: currency.format(totals.abonosMonth || 0) }, { label: 'CxC balance', value: currency.format(totals.receivablesBalance || 0) }, { label: 'Fiadas', value: openRecs.filter((i) => i.creditType === 'fiado').length }]} onOpen={() => navigate('/dashboard/ventas-credito')} openLabel="Ver creditos" />
        <MetricCard icon={PackageX} accent="red" label="Productos agotados" value={model.lowStock.filter((item) => Number(item.stock || 0) <= 0).length} detail={`${lowStockCritical} producto(s) bajo minimo`} miniStats={[{ label: 'Bajo minimo', value: model.lowStock.filter((item) => Number(item.stock || 0) > 0).length }, { label: 'Criticos', value: lowStockCritical }, { label: 'Vendidos hoy', value: totals.productsSoldToday || 0 }]} onOpen={() => navigate('/dashboard/productos-agotados')} openLabel="Ver stock" />
        <MetricCard icon={AlertTriangle} accent="red" label="Vencidas del mes" value={overdueCount} detail={`${morososCount} cliente(s) morosos`} miniStats={[{ label: 'Balance vencido', value: currency.format(openRecs.filter((i) => i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).reduce((s, i) => s + Number(i.balance || 0), 0)) }, { label: 'Morosos', value: morososCount }]} onOpen={() => navigate('/dashboard/facturas-vencidas')} openLabel="Ver vencidas" />
      </div>
    </div>
  )
}

function AnalysisLevel({ model, customers, navigate }) {
  const totals = model.totals || {}
  return (
    <div className="section-card space-y-5">
      <LevelHeader label="Nivel 4 — Analisis y rendimiento" description="Ganancias, impuestos, tendencias y rendimiento mensual" color="violet" icon={BarChart3} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Banknote} accent="amber" label="Ganancia mes" value={currency.format(totals.monthProfit || 0)} detail={`Margen: ${totals.monthSales ? ((totals.monthProfit / totals.monthSales) * 100).toFixed(1) : '0.0'}%`} miniStats={[{ label: 'Ventas', value: currency.format(totals.monthSales || 0) }, { label: 'Docs', value: model.monthInvoices?.length || 0 }]} onOpen={() => navigate('/dashboard/ganancia-mes')} openLabel="Ver ganancia" />
        <MetricCard icon={ReceiptText} accent="blue" label="Impuestos mes" value={currency.format(totals.monthTax || 0)} detail="ITBIS calculado 18%" miniStats={[{ label: 'Ventas', value: currency.format(totals.monthSales || 0) }, { label: 'Docs', value: model.monthInvoices?.length || 0 }, { label: 'Notas credito', value: currency.format(totals.creditNotesTotal || 0) }]} onOpen={() => navigate('/dashboard/impuestos-mes')} openLabel="Ver impuestos" />
        <MetricCard icon={BarChart3} accent="cyan" label="Ventas contado semana" value={currency.format(totals.weekCashSales || 0)} detail={`Credito: ${currency.format(totals.weekCreditSales || 0)}`} miniStats={[{ label: 'Total semana', value: currency.format(totals.weekSales || 0) }, { label: 'Mes contado', value: currency.format(totals.monthCashSales || 0) }, { label: 'Docs hoy', value: totals.invoicesToday || 0 }]} onOpen={() => navigate('/dashboard/ventas-semana')} openLabel="Ver semana" />
        <MetricCard icon={Users} accent="cyan" label="Clientes nuevos" value={totals.newCustomersToday || 0} detail={`${customers?.length || 0} clientes registrados`} miniStats={[{ label: 'Total clientes', value: customers?.length || 0 }, { label: 'CxC', value: (model.openReceivables || []).length }, { label: 'Top cliente', value: model.topCustomers?.[0]?.name || '-' }]} onOpen={() => navigate('/dashboard/clientes-nuevos')} openLabel="Ver clientes" />
      </div>
    </div>
  )
}

function DetailLevel({ model, customers, navigate }) {
  const totals = model.totals || {}
  return (
    <div className="section-card space-y-5">
      <LevelHeader label="Nivel 5 — Detalle completo" description="Todas las metricas del negocio en un solo vistazo" color="cyan" icon={Zap} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={CircleDollarSign} accent="blue" label="Resumen ejecutivo" value={currency.format(totals.monthSales || 0)} detail="Contado y credito separados" miniStats={[{ label: 'Contado mes', value: currency.format(totals.monthCashSales || 0) }, { label: 'Credito mes', value: currency.format(totals.monthCreditSales || 0) }, { label: 'CxC pend.', value: currency.format(totals.receivablesBalance || 0) }, { label: 'Ganancia', value: currency.format(totals.monthProfit || 0) }]} onOpen={() => navigate('/dashboard/resumen-ejecutivo')} openLabel="Ver resumen" />
        <MetricCard icon={HandCoins} accent="blue" label="Facturas credito activas" value={(model.openReceivables || []).filter((item) => item.creditType === 'credito').length} detail={currency.format((model.openReceivables || []).filter((item) => item.creditType === 'credito').reduce((s, i) => s + Number(i.balance || 0), 0))} miniStats={[{ label: 'Fiadas', value: (model.openReceivables || []).filter((i) => i.creditType === 'fiado').length }, { label: 'Parciales', value: (model.openReceivables || []).filter((i) => i.status === 'partial').length }, { label: 'Vencidas', value: (model.openReceivables || []).filter((i) => i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).length }]} onOpen={() => navigate('/dashboard/facturas-credito')} openLabel="Ver credito" />
        <MetricCard icon={FileMinus2} accent="cyan" label="Facturas fiadas" value={(model.openReceivables || []).filter((item) => item.creditType === 'fiado').length} detail={currency.format((model.openReceivables || []).filter((item) => item.creditType === 'fiado').reduce((s, i) => s + Number(i.balance || 0), 0))} miniStats={[{ label: 'Vencidas', value: (model.openReceivables || []).filter((i) => i.creditType === 'fiado' && i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).length }, { label: 'Clientes', value: new Set((model.openReceivables || []).filter((i) => i.creditType === 'fiado').map((i) => i.customerId)).size }]} onOpen={() => navigate('/dashboard/facturas-fiadas')} openLabel="Ver fiadas" />
        <MetricCard icon={Percent} accent="amber" label="Facturas parciales" value={(model.openReceivables || []).filter((item) => item.status === 'partial').length} detail={currency.format((model.openReceivables || []).filter((item) => item.status === 'partial').reduce((s, i) => s + Number(i.balance || 0), 0))} miniStats={[{ label: 'Abonado', value: currency.format((model.openReceivables || []).filter((i) => i.status === 'partial').reduce((s, i) => s + Number(i.paid || 0), 0)) }, { label: 'Vencidas', value: (model.openReceivables || []).filter((i) => i.status === 'partial' && i.dueDate && new Date(i.dueDate) < new Date() && i.balance > 0).length }]} onOpen={() => navigate('/dashboard/facturas-parciales')} openLabel="Ver parciales" />
        <MetricCard icon={Wallet} accent="green" label="Caja actual" value={currency.format(model.cashSummary?.expected || 0)} detail={model.cashSummary?.status === 'open' ? 'Caja abierta' : 'Caja cerrada'} miniStats={[{ label: 'Contado', value: currency.format(model.cashSummary?.counted || 0) }, { label: 'Diferencia', value: currency.format(model.cashSummary?.difference || 0) }, { label: 'Movs.', value: model.cashSummary?.movements || 0 }, { label: 'Metodo top', value: model.cashSummary?.byMethod?.[0]?.method || '-' }]} onOpen={() => navigate('/dashboard/caja-actual')} openLabel="Ver caja" />
        <MetricCard icon={Boxes} accent="amber" label="Productos bajo minimo" value={model.lowStock.filter((item) => Number(item.stock || 0) > 0).length} detail={`${model.lowStock.length} producto(s) criticos`} miniStats={[{ label: 'Agotados', value: model.lowStock.filter((item) => Number(item.stock || 0) <= 0).length }, { label: 'Vendidos hoy', value: totals.productsSoldToday || 0 }, { label: 'Top prod.', value: model.topProducts?.[0]?.name || '-' }]} onOpen={() => navigate('/dashboard/productos-bajo-minimo')} openLabel="Ver productos" />
        <MetricCard icon={Wallet} accent="green" label="Cobros mes" value={currency.format(totals.cashMonth || 0)} detail="Caja del mes actual" miniStats={[{ label: 'Hoy', value: currency.format(totals.cashToday || 0) }, { label: 'Semana', value: currency.format(totals.cashWeek || 0) }, { label: 'Actual', value: currency.format(model.cashSummary?.expected || 0) }, { label: 'Movs.', value: model.cashSummary?.movements || 0 }]} onOpen={() => navigate('/dashboard/cobros-mes')} openLabel="Ver cobros" />
        <MetricCard icon={ReceiptText} accent="amber" label="Facturas pendientes" value={(model.openReceivables || []).length} detail={currency.format(totals.receivablesBalance || 0)} miniStats={[{ label: 'Promedio', value: currency.format((model.openReceivables || []).length ? (totals.receivablesBalance || 0) / (model.openReceivables || []).length : 0) }, { label: 'Clientes deuda', value: new Set((model.openReceivables || []).map((item) => item.customerId)).size }, { label: 'Vencidas', value: (model.openReceivables || []).filter((item) => item.dueDate && new Date(item.dueDate) < new Date()).length }]} onOpen={() => navigate('/dashboard/facturas-pendientes')} openLabel="Ver pendientes" />
      </div>
    </div>
  )
}
