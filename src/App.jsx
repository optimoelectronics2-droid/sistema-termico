import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { Route, Routes } from 'react-router-dom'
import { auth } from './lib/firebase'
import { AppShell } from './components/layout/AppShell'
import { ToastViewport } from './components/ui/Toast'
import { AuthPage } from './features/auth/AuthPage'
import { VerifyInvoice } from './features/verify/VerifyInvoice'
import { useERPStore } from './store/useERPStore'
import { startErpRealtimeSync } from './services/realtimeSync'

const Dashboard = lazy(() => import('./features/dashboard/Dashboard').then((module) => ({ default: module.Dashboard })))
const DashboardKpiPage = lazy(() => import('./features/dashboard/DashboardKpiPage').then((module) => ({ default: module.DashboardKpiPage })))
const InvoiceCreate = lazy(() => import('./features/invoicing/invoice-create/InvoiceCreate').then((module) => ({ default: module.InvoiceCreate })))
const InvoiceHistoryPage = lazy(() => import('./features/invoicing/invoice-history/InvoiceHistoryPage').then((module) => ({ default: module.InvoiceHistoryPage })))
const InvoiceDetails = lazy(() => import('./features/invoicing/invoice-details/InvoiceDetails').then((module) => ({ default: module.InvoiceDetails })))
const InvoiceEdit = lazy(() => import('./features/invoicing/invoice-edit/InvoiceEdit').then((module) => ({ default: module.InvoiceEdit })))
const InvoicePrint = lazy(() => import('./features/invoicing/invoice-print/InvoicePrint').then((module) => ({ default: module.InvoicePrint })))
const POS = lazy(() => import('./features/pos/POS').then((module) => ({ default: module.POS })))
const Inventory = lazy(() => import('./features/inventory/Inventory').then((module) => ({ default: module.Inventory })))
const InventoryCenter = lazy(() => import('./features/inventory/Inventory').then((module) => ({ default: module.InventoryCenter })))
const ProductEntry = lazy(() => import('./features/inventory/ProductEntry').then((module) => ({ default: module.ProductEntry })))
const EntryReportsPage = lazy(() => import('./features/inventory/EntryReportsPage').then((module) => ({ default: module.EntryReportsPage })))
const CRM = lazy(() => import('./features/crm/CRM').then((module) => ({ default: module.CRM })))
const CashDesk = lazy(() => import('./features/cash/CashDesk').then((module) => ({ default: module.CashDesk })))
const AccountingJournal = lazy(() => import('./features/accounting/AccountingJournal').then((module) => ({ default: module.AccountingJournal })))
const ServiceDesk = lazy(() => import('./features/service/ServiceDesk').then((module) => ({ default: module.ServiceDesk })))
const Fiscal = lazy(() => import('./features/fiscal/Fiscal').then((module) => ({ default: module.Fiscal })))
const Reports = lazy(() => import('./features/reports/Reports').then((module) => ({ default: module.Reports })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const QuoteList = lazy(() => import('./features/quotes/QuoteList').then((module) => ({ default: module.QuoteList })))
const QuoteCreate = lazy(() => import('./features/quotes/quote-create/QuoteCreate').then((module) => ({ default: module.QuoteCreate })))
const QuoteEdit = lazy(() => import('./features/quotes/quote-edit/QuoteEdit').then((module) => ({ default: module.QuoteEdit })))
const Receivables = lazy(() => import('./features/receivables/Receivables').then((module) => ({ default: module.Receivables })))
const FinancialMovements = lazy(() => import('./features/receivables/FinancialMovements').then((module) => ({ default: module.FinancialMovements })))
const Payables = lazy(() => import('./features/payables/Payables').then((module) => ({ default: module.Payables })))
const DeliveryNotes = lazy(() => import('./features/delivery/DeliveryNotes').then((module) => ({ default: module.DeliveryNotes })))

export default function App() {
  const setCommandOpen = useERPStore((state) => state.setCommandOpen)
  const bootstrapTenantForUser = useERPStore((state) => state.bootstrapTenantForUser)
  const syncStatus = useERPStore((state) => state.syncStatus)
  const syncError = useERPStore((state) => state.syncError)
  const [authState, setAuthState] = useState({ loading: true, user: null })
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setAuthState({ loading: false, user }))
    return () => unsub()
  }, [])
  const isVerifyRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/verify')
  useEffect(() => {
    if (isVerifyRoute) return undefined
    if (authState.loading) return undefined
    if (authState.user) bootstrapTenantForUser(authState.user)
    return startErpRealtimeSync(authState.user)
  }, [authState.loading, authState.user, bootstrapTenantForUser, isVerifyRoute])
  useEffect(() => {
    if (isVerifyRoute) return undefined
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandOpen, isVerifyRoute])
  if (isVerifyRoute) {
    return (
      <>
        <VerifyInvoice />
        <ToastViewport />
      </>
    )
  }

  if (authState.loading) return <div className="grid min-h-screen place-items-center bg-[#0A0A0F] text-white">Cargando sesion...</div>
  if (!authState.user) return <><AuthPage /><ToastViewport /></>

  return (
    <>
      {syncStatus === 'connecting' || syncStatus === 'uploading' ? <div className="fixed right-4 top-4 z-50 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs font-bold text-white/70">Sincronizando datos...</div> : null}
      {syncStatus === 'error' ? <div className="fixed right-4 top-4 z-50 max-w-md rounded-lg border border-red-400/30 bg-red-950/90 px-3 py-2 text-xs font-bold text-red-100 shadow-2xl">Error de sincronizacion: {syncError}</div> : null}
      <Suspense fallback={<div className="grid min-h-[55vh] place-items-center"><div className="premium-loader"><span />Cargando modulo...</div></div>}>
        <Routes>
          <Route element={<AppShell />}>
          <Route index element={<POS />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/:moduleId" element={<DashboardKpiPage />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/facturacion" element={<InvoiceHistoryPage />} />
          <Route path="/facturacion/historial" element={<InvoiceHistoryPage />} />
          <Route path="/facturacion/nueva" element={<InvoiceCreate />} />
          <Route path="/facturacion/:invoiceId" element={<InvoiceDetails />} />
          <Route path="/facturacion/:invoiceId/editar" element={<InvoiceEdit />} />
          <Route path="/facturacion/:invoiceId/imprimir" element={<InvoicePrint />} />
          <Route path="/cotizaciones" element={<QuoteList />} />
          <Route path="/cotizaciones/nueva" element={<QuoteCreate />} />
          <Route path="/cotizaciones/:quoteId/editar" element={<QuoteEdit />} />
          <Route path="/conduces" element={<DeliveryNotes />} />
          <Route path="/inventario" element={<Inventory />} />
          <Route path="/inventario/centro" element={<InventoryCenter />} />
          <Route path="/inventario/entradas" element={<ProductEntry />} />
          <Route path="/inventario/reportes-entradas" element={<EntryReportsPage />} />
          <Route path="/clientes" element={<CRM />} />
          <Route path="/cxc" element={<Receivables />} />
          <Route path="/movimientos-financieros" element={<FinancialMovements />} />
          <Route path="/cxp" element={<Payables />} />
          <Route path="/caja" element={<CashDesk />} />
          <Route path="/movimientos-manuales" element={<CashDesk manualOnly />} />
          <Route path="/contabilidad" element={<AccountingJournal />} />
          <Route path="/servicio" element={<ServiceDesk />} />
          <Route path="/fiscal" element={<Fiscal />} />
          <Route path="/reportes" element={<Reports />} />
          <Route path="/configuracion" element={<SettingsPage />} />
        </Route>
        </Routes>
      </Suspense>
      <ToastViewport />
    </>
  )
}
