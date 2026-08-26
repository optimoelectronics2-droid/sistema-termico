import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  BarChart3,
  BookOpenCheck,
  Building2,
  Boxes,
  Calculator,
  CircleDollarSign,
  Command,
  FilePlus2,
  FileBarChart2,
  FileText,
  Gauge,
  Landmark,
  Menu,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useDeferredValue, useMemo, useState } from 'react'
import { auth } from '../../lib/firebase'
import { buildGlobalSearchResults, clearSearchHistory, readSearchHistory, rememberSearch } from '../../lib/globalSearchEngine'
import { useERPStore } from '../../store/useERPStore'
import { Button } from '../ui/Button'

const navGroups = [
  {
    label: 'Operaciones',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: Gauge },
      { to: '/pos', label: 'POS rapido', icon: ShoppingCart },
      { to: '/facturacion/nueva', label: 'Nueva factura', icon: FilePlus2 },
      { to: '/facturacion', label: 'Facturas', icon: ReceiptText },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: FileText },
      { to: '/conduces', label: 'Conduces', icon: Truck },
      { to: '/movimientos-manuales', label: 'Mov. manuales', icon: Wallet },
    ],
  },
  {
    label: 'Inventario',
    items: [
      { to: '/inventario', label: 'Inventario', icon: Boxes },
      { to: '/inventario/centro', label: 'Centro stock', icon: Gauge },
      { to: '/inventario/entradas', label: 'Entradas', icon: PackagePlus },
      { to: '/inventario/reportes-entradas', label: 'Reporte entradas', icon: FileBarChart2 },
    ],
  },
  {
    label: 'Clientes y finanzas',
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/cxc', label: 'Cuentas por cobrar', icon: Wallet },
      { to: '/movimientos-financieros', label: 'Mov. financieros', icon: ReceiptText },
      { to: '/cxp', label: 'Cuentas por pagar', icon: Landmark },
      { to: '/caja', label: 'Caja y arqueo', icon: Calculator },
      { to: '/contabilidad', label: 'Contabilidad', icon: BookOpenCheck },
    ],
  },
    {
      label: 'Control',
      items: [
        { to: '/servicio', label: 'Servicio tecnico', icon: Wrench },
        { to: '/fiscal', label: 'Fiscal DGII', icon: ShieldCheck },
        { to: '/reportes', label: 'Reportes', icon: BarChart3 },
      ],
    },
  {
    label: 'Sistema',
    items: [{ to: '/configuracion', label: 'Configuracion', icon: Settings }],
  },
]

const flatNav = navGroups.flatMap((group) => group.items)
const mobileNav = [
  flatNav.find((item) => item.to === '/pos'),
  flatNav.find((item) => item.to === '/facturacion'),
  flatNav.find((item) => item.to === '/inventario'),
  flatNav.find((item) => item.to === '/caja'),
  flatNav.find((item) => item.to === '/reportes'),
].filter(Boolean)

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const setCommandOpen = useERPStore((state) => state.setCommandOpen)
  const company = useERPStore((state) => state.company)
  const cash = useERPStore((state) => state.cashRegister)

  return (
    <div className="h-screen overflow-hidden" style={{ background: 'transparent' }}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(79,142,247,.18),transparent_32%),radial-gradient(circle_at_86%_8%,rgba(16,217,138,.12),transparent_30%)]" />

      <aside className="erp-sidebar no-print group fixed inset-y-0 left-0 z-40 hidden w-[72px] border-r md:block hover:w-64" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-sidebar)' }}>
        <div className="flex h-full flex-col overflow-y-auto p-3">
          <button onClick={() => navigate('/configuracion')} className="flex min-h-12 shrink-0 items-center gap-3 rounded-lg px-2 text-left hover:bg-white/[0.05]">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg font-display text-xl font-extrabold shadow-lg" style={{ background: 'var(--color-nav)', boxShadow: '0 4px 12px rgba(59,130,246,.25)' }}>
              {company.logoUrl ? <img src={company.logoUrl} alt="" className="h-full w-full object-contain" /> : company.name ? company.name[0] : 'T'}
            </div>
            <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <p className="truncate font-display text-sm font-bold leading-5">{company.name || 'Configurar empresa'}</p>
              <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>Fiscal ERP</p>
            </div>
          </button>

          <div className="mt-4 grid gap-2 group-hover:grid-cols-2">
            <button onClick={() => navigate('/pos')} title="Facturar" className="grid h-11 place-items-center rounded-lg text-sm font-extrabold transition" style={{ border: '1px solid rgba(59,130,246,.25)', background: 'rgba(59,130,246,.15)', color: 'rgb(191, 219, 254)' }}>
              <FilePlus2 className="group-hover:hidden" size={18} />
              <span className="hidden group-hover:inline">Facturar</span>
            </button>
            <button onClick={() => setCommandOpen(true)} title="Buscar" className="grid h-11 place-items-center rounded-lg text-sm font-extrabold transition hover:bg-white/[0.08]" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.045)', color: 'rgba(255,255,255,.7)' }}>
              <Search className="group-hover:hidden" size={18} />
              <span className="hidden group-hover:inline">Buscar</span>
            </button>
          </div>

          <nav className="premium-scroll mt-4 flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="my-2 border-t group-hover:hidden" style={{ borderColor: 'var(--line)' }} />
                <p className="mb-1 hidden px-3 text-[10px] font-extrabold uppercase tracking-widest group-hover:block" style={{ color: 'var(--text-tertiary)' }}>{group.label}</p>
                <div className="grid gap-1">
                  {group.items.map((item) => <NavItem key={item.to} item={item} />)}
                </div>
              </div>
            ))}
          </nav>

          <div className="shrink-0 rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.04)' }}>
            <div className="flex items-center gap-2" style={{ color: 'rgb(167, 243, 208)' }}>
              <CircleDollarSign size={18} />
              <span className="hidden truncate text-sm font-bold group-hover:inline">Caja {cash.status}</span>
            </div>
            <p className="mt-1 hidden truncate text-xs group-hover:block" style={{ color: 'var(--text-secondary)' }}>{company.rnc || 'Sin RNC'} · {company.city || 'Configure ubicacion'}</p>
            <button onClick={() => signOut(auth)} className="mt-3 hidden text-xs font-bold group-hover:block" style={{ color: 'rgb(254, 202, 202)' }}>Cerrar sesion</button>
          </div>
        </div>
      </aside>

      <main className="flex h-screen flex-col overflow-hidden md:pl-[72px]">
        <header className="no-print z-20 h-[var(--header-h)] shrink-0 px-3 backdrop-blur-xl sm:px-4 lg:px-5" style={{ borderBottom: '1px solid var(--line-strong)', background: 'rgba(10,10,18,.92)' }}>
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" icon={Menu} className="px-3 md:hidden" onClick={() => setCommandOpen(true)} aria-label="Abrir busqueda" />
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold sm:text-xl" style={{ color: 'var(--text-primary)' }}>{titleFor(location.pathname)}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>Workspace ERP fiscal, retail e inventario</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <button onClick={() => setCommandOpen(true)} className="flex min-w-[220px] items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-white/[0.07] xl:min-w-[300px]" style={{ borderColor: 'var(--line)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                <Search size={16} />Buscar cliente, factura, IMEI, modulo<span className="ml-auto rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--line)', color: 'var(--text-tertiary)' }}>Ctrl K</span>
              </button>
              <Button variant="success" icon={FileText} onClick={() => navigate('/pos')}>Nueva factura</Button>
            </div>
          </div>
        </header>

        <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="premium-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1900px] p-4 pb-16 sm:p-5 lg:p-6">
            <Outlet />
          </div>
        </motion.div>
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t px-2 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden" style={{ borderColor: 'var(--line)', background: 'rgba(10,10,15,.92)' }}>
        {mobileNav.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-bold ${isActive ? 'text-white' : ''}`} style={({ isActive }) => isActive ? { background: 'var(--color-nav)' } : { color: 'rgba(255,255,255,.5)' }} end={item.to === '/'}><item.icon size={17} /><span className="w-full truncate text-center">{mobileLabel(item.label)}</span></NavLink>)}
      </nav>

      <CommandPalette />
    </div>
  )
}

function NavItem({ item }) {
  const location = useLocation()
  const isActive = location.pathname === item.to || (item.to !== '/pos' && location.pathname.startsWith(item.to))
  return (
    <NavLink to={item.to} title={item.label} className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-bold transition ${isActive ? 'shadow-lg' : 'hover:bg-white/[0.06]'}`} style={isActive ? { background: 'var(--color-nav)', color: 'white', boxShadow: '0 4px 12px rgba(59,130,246,.2)' } : { color: 'rgba(255,255,255,.58)' }} end={item.to === '/pos'}>
      <item.icon className="shrink-0" size={19} />
      <span className="hidden min-w-0 truncate group-hover:inline">{item.label}</span>
    </NavLink>
  )
}

function CommandPalette() {
  const navigate = useNavigate()
  const open = useERPStore((state) => state.commandOpen)
  const setOpen = useERPStore((state) => state.setCommandOpen)
  const invoices = useERPStore((state) => state.invoices)
  const products = useERPStore((state) => state.products)
  const customers = useERPStore((state) => state.customers)
  const productEntries = useERPStore((state) => state.productEntries)
  const suppliers = useERPStore((state) => state.suppliers)
  const inventoryMovements = useERPStore((state) => state.inventoryMovements)
  const cashRegister = useERPStore((state) => state.cashRegister)
  const quotes = useERPStore((state) => state.quotes)
  const conduces = useERPStore((state) => state.conduces)
  const creditNotes = useERPStore((state) => state.creditNotes)
  const receivables = useERPStore((state) => state.receivables)
  const expenses = useERPStore((state) => state.expenses)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState(readSearchHistory)
  const deferredQuery = useDeferredValue(query)
  const searchState = useMemo(() => ({
    invoices, products, customers, productEntries, suppliers,
    inventoryMovements, cashRegister, quotes, conduces, creditNotes, receivables, expenses,
  }), [cashRegister, conduces, creditNotes, customers, expenses, inventoryMovements, invoices, productEntries, products, quotes, receivables, suppliers])
  const results = useMemo(() => buildGlobalSearchResults(searchState, deferredQuery, { limit: 42 }), [deferredQuery, searchState])
  const showHistory = !query.trim() && history.length > 0

  function go(path, searchText = query) {
    setHistory(rememberSearch(searchText))
    navigate(path)
    setOpen(false)
    setQuery('')
  }
  function resetHistory() { clearSearchHistory(); setHistory([]) }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] grid place-items-start bg-black/60 px-4 pt-20 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()} style={{ border: '1px solid var(--line-strong)', background: 'var(--bg-elevated)', boxShadow: '0 30px 64px rgba(0,0,0,.7)' }}>
        <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--line-strong)', background: 'var(--bg-surface)' }}>
          <Command size={18} style={{ color: 'rgb(147, 197, 253)' }} />
          <input id="appshell-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none" placeholder="Buscar facturas, clientes, productos, caja, compras, inventario..." style={{ color: 'white' }} aria-label="appshell-search"  autoComplete="off" />
          <span className="hidden rounded-md border px-2 py-1 text-[10px] font-extrabold uppercase sm:inline" style={{ borderColor: 'var(--line)', color: 'var(--text-tertiary)' }}>Esc</span>
        </div>
        <div className="premium-scroll max-h-[68vh] overflow-auto p-3">
          {showHistory ? (
            <div className="mb-3 rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.025)' }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-extrabold uppercase" style={{ color: 'var(--text-tertiary)' }}>Historial reciente</p>
                <button type="button" onClick={resetHistory} className="text-xs font-bold hover:text-white" style={{ color: 'var(--text-secondary)' }}>Limpiar</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((item) => <button key={item} type="button" onClick={() => setQuery(item)} className="rounded-lg border px-3 py-2 text-xs font-bold hover:bg-white/[0.08] hover:text-white" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.65)' }}>{item}</button>)}
              </div>
            </div>
          ) : null}
          <div className="grid gap-2">
            {results.map((item) => (
              <button key={item.id} type="button" onClick={() => go(item.path, item.meta || item.title)} className="group flex min-h-16 items-center justify-between gap-4 rounded-xl border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--bg-surface)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border px-2 py-1 text-[10px] font-extrabold uppercase" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.04)', color: 'rgba(191, 219, 254, .8)' }}>{item.kind}</span>
                    <p className="truncate font-bold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                  </div>
                  <p className="mt-1 truncate text-xs" style={{ color: 'rgba(255,255,255,.48)' }}>{item.subtitle}</p>
                </div>
                <p className="hidden max-w-[180px] truncate text-xs font-bold sm:block group-hover:text-blue-100" style={{ color: 'var(--text-tertiary)' }}>{item.meta}</p>
              </button>
            ))}
            {!results.length ? <div className="rounded-xl border border-dashed p-8 text-center text-sm font-bold" style={{ borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.4)' }}>No encontre coincidencias. Prueba con cliente, factura, producto, IMEI, metodo de pago o fecha.</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function titleFor(pathname) {
  if (pathname.startsWith('/facturacion/') && pathname.endsWith('/editar')) return 'Editar factura'
  if (pathname.startsWith('/facturacion/') && pathname.endsWith('/imprimir')) return 'Imprimir factura'
  if (pathname.startsWith('/facturacion/') && pathname !== '/facturacion/nueva' && pathname !== '/facturacion/historial') return 'Detalle de factura'
  if (pathname.startsWith('/dashboard/')) return 'Modulo ejecutivo'
  if (pathname === '/facturacion/historial') return 'Facturas'
  if (pathname === '/cxp') return 'Cuentas por pagar'
  if (pathname === '/') return 'POS rapido'
  return flatNav.find((entry) => entry.to === pathname)?.label || 'Trifusion ERP'
}

function mobileLabel(label) {
  if (label.includes('POS')) return 'POS'
  if (label === 'Dashboard') return 'Inicio'
  if (label === 'Facturas') return 'Facturar'
  return label.split(' ')[0]
}
