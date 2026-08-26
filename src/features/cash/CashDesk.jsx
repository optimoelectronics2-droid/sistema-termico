import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, History, Lock, Plus, Printer, Trash2, Unlock, AlertTriangle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { buildCashCutReport } from '../../lib/cashDeskEngine'
import { downloadCsv } from '../../lib/csvExport'
import { todayIso } from '../../lib/dateTime'
import { currency, formatDate } from '../../lib/formatters'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'

const movementCategories = ['Gastos', 'Compras', 'Transporte', 'Mensajeria', 'Delivery', 'Servicios', 'Luz', 'Internet', 'Telefono', 'Alquiler', 'Nomina', 'Combustible', 'Mantenimiento', 'Retiros', 'Ingresos extraordinarios', 'Ajustes', 'Impuestos', 'Bancos', 'Otros']
const paymentMethods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Deposito', 'Cheque', 'Pago movil', 'Zelle', 'PayPal', 'Credito', 'Otro']

export function CashDesk({ manualOnly = false }) {
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const company = useERPStore((state) => state.company)
  const branches = useERPStore((state) => state.branches)
  const invoices = useERPStore((state) => state.invoices)
  const creditNotes = useERPStore((state) => state.creditNotes)
  const expenses = useERPStore((state) => state.expenses)
  const receivables = useERPStore((state) => state.receivables)
  const payments = useERPStore((state) => state.payments)
  const cash = useERPStore((state) => state.cashRegister)
  const currentUser = useERPStore((state) => state.currentUser)
  const openCashRegister = useERPStore((state) => state.openCashRegister)
  const closeCashRegister = useERPStore((state) => state.closeCashRegister)
  const registerCashMovement = useERPStore((state) => state.registerCashMovement)
  const deleteCashMovement = useERPStore((state) => state.deleteCashMovement)

  const standaloneManual = manualOnly || location.pathname === '/movimientos-manuales'
  const dayKeyOf = (value) => String(value || '').slice(0, 10)

  const [cutDate, setCutDate] = useState(todayIso())
  const [counted, setCounted] = useState(cash.counted || 0)
  const [cutSection, setCutSection] = useState('methods')
  const [openModal, setOpenModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [historyModal, setHistoryModal] = useState(false)
  const [openForm, setOpenForm] = useState(() => ({
    amount: cash.counted || 0,
    branchId: branches[0]?.id || '',
    branchName: branches[0]?.name || '',
    cashName: cash.name || 'Caja principal',
    cashier: currentUser?.name || 'Usuario',
  }))
  const [historyRange, setHistoryRange] = useState(() => {
    const now = new Date()
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: todayIso() }
  })

  const dailyReport = useMemo(() => buildCashCutReport({
    cashRegister: { ...cash, movements: (cash.movements || []).filter((movement) => dayKeyOf(movement.createdAt || movement.date) === cutDate) },
    invoices: invoices.filter((invoice) => dayKeyOf(invoice.issuedAt || invoice.createdAt || invoice.issueDate) === cutDate),
    creditNotes: creditNotes.filter((note) => dayKeyOf(note.createdAt || note.updatedAt) === cutDate),
    expenses: expenses.filter((expense) => dayKeyOf(expense.date || expense.createdAt || expense.updatedAt) === cutDate),
    receivables,
    payments,
    company,
    branches,
  }), [branches, cash, company, creditNotes, cutDate, expenses, invoices, payments, receivables])

  const [movement, setMovement] = useState(defaultManualMovement())
  const [manualFrom, setManualFrom] = useState(todayIso())
  const [manualTo, setManualTo] = useState(todayIso())
  const [manualMethod, setManualMethod] = useState('all')
  const [manualCategory, setManualCategory] = useState('all')
  const [activeBreakdown, setActiveBreakdown] = useState('category')
  const [detailMovement, setDetailMovement] = useState(null)

  const manualMovements = useMemo(() => (cash.movements || [])
    .filter((item) => isManualMovement(item))
    .filter((item) => {
      const day = dayKeyOf(item.movementDate || item.createdAt)
      if (manualFrom && day < manualFrom) return false
      if (manualTo && day > manualTo) return false
      if (manualMethod !== 'all' && item.method !== manualMethod) return false
      if (manualCategory !== 'all' && item.category !== manualCategory) return false
      return true
    })
    .sort((left, right) => String(right.movementDate || right.createdAt).localeCompare(String(left.movementDate || left.createdAt))), [cash.movements, manualCategory, manualFrom, manualMethod, manualTo])

  const manualSummary = useMemo(() => summarizeManualMovements(manualMovements), [manualMovements])

  const historyMovements = useMemo(() => (cash.movements || [])
    .filter((item) => {
      const day = dayKeyOf(item.createdAt || item.movementDate || item.date)
      if (historyRange.from && day < historyRange.from) return false
      if (historyRange.to && day > historyRange.to) return false
      return true
    })
    .sort((left, right) => String(right.createdAt || right.movementDate).localeCompare(String(left.createdAt || left.movementDate))), [cash.movements, historyRange])

  const creditNet = (dailyReport.byMethod || []).find((item) => item.method === 'Credito')?.net || 0

  function shiftDay(delta) {
    const date = new Date(`${cutDate}T12:00:00`)
    date.setDate(date.getDate() + delta)
    setCutDate(dayKeyOf(date.toISOString()))
  }

  function setOpenField(key, value) {
    setOpenForm((state) => ({ ...state, [key]: value }))
  }

  function selectBranch(branchId) {
    const branch = branches.find((item) => item.id === branchId)
    setOpenForm((state) => ({ ...state, branchId, branchName: branch?.name || '' }))
  }

  function setMovementField(key, value) {
    setMovement((state) => ({ ...state, [key]: value }))
  }

  function submitMovement(event) {
    event.preventDefault()
    try {
      registerCashMovement(movement)
      setMovement(defaultManualMovement())
      toast.success('Movimiento registrado y caja recalculada.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function handleOpen() {
    try {
      openCashRegister(openForm)
      toast.success('Caja abierta correctamente.')
      setOpenModal(false)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function handleClose() {
    try {
      closeCashRegister(counted)
      toast.success('Caja cerrada correctamente.')
      setCloseModal(false)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function removeMovement(row) {
    if (row.type === 'opening') {
      toast.error('La apertura de caja no se elimina; cierre y abra una caja nueva si necesita corregirla.')
      return
    }
    if (!isManualMovement(row)) {
      toast.error('Este movimiento pertenece a un documento del sistema. Corrija el documento original para recalcular caja.')
      return
    }
    if (!window.confirm(`Eliminar el movimiento "${row.concept || row.type}"?`)) return
    try {
      deleteCashMovement(row.id, 'Eliminacion confirmada desde caja')
      toast.success('Movimiento eliminado y caja recalculada.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function exportCutPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text(dailyReport.companyName || 'Cierre de caja', 14, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`RNC: ${dailyReport.rnc || 'N/A'} | Sucursal: ${dailyReport.branchName} | Caja: ${dailyReport.cashName} | Cajero: ${dailyReport.cashier}`, 14, 21)
    doc.text(`Corte del dia: ${formatDate(cutDate)} | Apertura: ${formatDate(dailyReport.openedAt)} | Cierre: ${dailyReport.closedAt ? formatDate(dailyReport.closedAt) : 'En curso'}`, 14, 27)
    autoTable(doc, {
      startY: 34,
      head: [['Concepto', 'Monto']],
      body: [
        ['Fondo inicial', currency.format(dailyReport.openingAmount)],
        ['Ventas totales', currency.format(dailyReport.grossSales)],
        ['Devoluciones / notas credito', currency.format(dailyReport.returns)],
        ['Descuentos', currency.format(dailyReport.discounts)],
        ['ITBIS', currency.format(dailyReport.tax)],
        ['Gastos', currency.format(dailyReport.expenses)],
        ['Balance calculado de caja', currency.format(dailyReport.expected)],
        ['Efectivo contado', currency.format(dailyReport.counted)],
        ['Diferencia', currency.format(dailyReport.difference)],
      ],
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Metodo', 'Ventas', 'Devoluciones', 'Neto']],
      body: dailyReport.byMethod.map((item) => [item.method, currency.format(item.sales), currency.format(item.refunds), currency.format(item.net)]),
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
    })
    doc.save(`cierre-caja-${cutDate}.pdf`)
  }

  function exportManualCsv() {
    downloadCsv(`movimientos-manuales-${manualFrom}-a-${manualTo}.csv`, manualMovements.map((item) => ({
      Fecha: formatDate(item.movementDate || item.createdAt),
      Tipo: movementTypeLabel(item.type),
      Categoria: item.category || '',
      Metodo: item.method || '',
      Destino: item.destination || '',
      Mensajero: item.messenger || '',
      Concepto: item.concept || item.note || '',
      Referencia: item.reference || '',
      Canal: item.channel || '',
      Notas: item.notes || '',
      Monto: signedManualAmount(item),
    })))
  }

  async function exportManualPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    const companyName = dailyReport.companyName || company?.name || 'Trifusion Technologies'
    doc.setProperties({ title: `Movimientos manuales ${manualFrom} a ${manualTo}` })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('Reporte de movimientos manuales', 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`${companyName} | RNC: ${dailyReport.rnc || company?.rnc || 'N/A'} | Rango: ${manualFrom || 'Inicio'} a ${manualTo || 'Hoy'} | Generado: ${formatDate(new Date())}`, 12, 21)
    doc.text(`Sucursal: ${dailyReport.branchName || 'Principal'} | Caja: ${dailyReport.cashName || cash.name || 'Caja principal'} | Cajero: ${dailyReport.cashier || currentUser?.name || 'Usuario'}`, 12, 27)

    autoTable(doc, {
      startY: 34,
      head: [['Indicador', 'Valor', 'Indicador', 'Valor']],
      body: [
        ['Ingresos manuales', currency.format(manualSummary.income), 'Salidas manuales', currency.format(manualSummary.outflow)],
        ['Balance manual', currency.format(manualSummary.net), 'Movimientos', manualSummary.count],
        ['Promedio ingresos', currency.format(manualSummary.avgIncome), 'Promedio salidas', currency.format(manualSummary.avgOutflow)],
        ['Mayor ingreso', currency.format(manualSummary.maxIncome), 'Mayor salida', currency.format(manualSummary.maxOutflow)],
      ],
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
    })

    const breakdownRows = [
      ...manualSummary.byType.map((item) => ['Tipo', item.label, item.count, currency.format(item.income), currency.format(item.outflow), currency.format(item.net)]),
      ...manualSummary.byCategory.map((item) => ['Categoria', item.label, item.count, currency.format(item.income), currency.format(item.outflow), currency.format(item.net)]),
      ...manualSummary.byMethod.map((item) => ['Metodo', item.label, item.count, currency.format(item.income), currency.format(item.outflow), currency.format(item.net)]),
    ]
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Grupo', 'Detalle', 'Cantidad', 'Ingresos', 'Salidas', 'Balance']],
      body: breakdownRows.length ? breakdownRows : [['Sin movimientos', 'No hay datos en este rango', 0, currency.format(0), currency.format(0), currency.format(0)]],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Fecha', 'Tipo', 'Categoria', 'Metodo', 'Destino', 'Mensajero', 'Concepto', 'Referencia', 'Monto']],
      body: manualMovements.map((item) => [
        formatDate(item.movementDate || item.createdAt),
        movementTypeLabel(item.type),
        item.category || '',
        item.method || '',
        item.destination || '',
        item.messenger || '',
        item.concept || item.note || '',
        item.reference || '',
        currency.format(signedManualAmount(item)),
      ]),
      styles: { fontSize: 7.4, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      columnStyles: { 6: { cellWidth: 58 }, 7: { cellWidth: 34 }, 8: { halign: 'right' } },
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.setFontSize(7)
        doc.setTextColor(120)
        doc.text(`Movimientos manuales | ${companyName}`, 12, pageHeight - 8)
      },
    })
    doc.save(`movimientos-manuales-${manualFrom}-a-${manualTo}.pdf`)
  }

  const breakdownRows = activeBreakdown === 'category' ? manualSummary.byCategory : activeBreakdown === 'method' ? manualSummary.byMethod : manualSummary.byType

  return (
    <div className="space-y-5">
      <section>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-bold uppercase" style={{ color: 'rgb(191,219,254)' }}>{standaloneManual ? 'Operaciones' : 'Caja profesional'}</p>
            <h2 className="font-display text-3xl font-bold">{standaloneManual ? 'Movimientos manuales independientes' : 'Caja y arqueo diario'}</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{standaloneManual ? 'Entradas y salidas operativas, desglosadas por dia con filtros reales.' : 'Todo el corte por dia: abre, registra, cuenta y cierra con historial completo.'}</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            {standaloneManual ? (
              <Button variant="ghost" onClick={() => navigate('/caja')}>Volver a caja</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate('/movimientos-manuales')}>Registro manual</Button>
                <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir corte</Button>
                <Button variant="primary" icon={Download} onClick={exportCutPdf}>PDF corte</Button>
              </>
            )}
          </div>
        </div>
      </section>

      {!standaloneManual ? (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#243244] bg-[#111827] p-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => shiftDay(-1)} className="rounded-lg border border-[#243244] bg-white/[0.04] p-2 text-white/60 transition hover:bg-white/[0.1] hover:text-white" aria-label="Dia anterior"><ChevronLeft size={16} /></button>
              <input id="cut-date" name="cutDate" type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} className="input-dark" aria-label="Dia del corte" autoComplete="off" />
              <button type="button" onClick={() => shiftDay(1)} className="rounded-lg border border-[#243244] bg-white/[0.04] p-2 text-white/60 transition hover:bg-white/[0.1] hover:text-white" aria-label="Dia siguiente"><ChevronRight size={16} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setCutDate(todayIso())} className="rounded-full px-3 py-1.5 text-xs font-bold transition hover:bg-white/[0.08] hover:text-white" style={{ background: cutDate === todayIso() ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.05)', color: cutDate === todayIso() ? 'rgb(191,219,254)' : 'rgba(255,255,255,.6)' }}>Hoy</button>
              <button type="button" onClick={() => { const date = new Date(); date.setDate(date.getDate() - 1); setCutDate(dayKeyOf(date.toISOString())) }} className="rounded-full px-3 py-1.5 text-xs font-bold transition hover:bg-white/[0.08] hover:text-white" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.6)' }}>Ayer</button>
              <span className="rounded-full border border-[#243244] px-3 py-1.5 text-xs font-bold text-white/55">Corte del dia: {formatDate(cutDate)}</span>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_2.2fr]">
            <div className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
              <h3 className="font-display text-lg font-bold">Gestion de caja</h3>
              <div className="mt-4 rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.035)' }}>
                <p className="text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>Estado</p>
                <p className="mt-2 text-3xl font-extrabold" style={{ color: cash.status === 'open' ? 'var(--color-income)' : 'var(--color-alert)' }}>{cash.status === 'open' ? 'Abierta' : 'Cerrada'}</p>
                <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,.5)' }}>Apertura: {formatDate(cash.openedAt)}</p>
              </div>
              <div className="mt-4 grid gap-2">
                <Button icon={Unlock} variant="success" onClick={() => setOpenModal(true)}>Abrir caja</Button>
                <Button icon={Lock} variant="danger" onClick={() => setCloseModal(true)} disabled={cash.status !== 'open'}>Cerrar caja</Button>
                <Button variant="ghost" icon={History} onClick={() => setHistoryModal(true)}>Historial de movimientos</Button>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">Corte del dia</h3>
                <span className="text-xs font-bold text-white/40">{dailyReport.invoicesCount} factura(s) · {dailyReport.transactionsCount} operacion(es)</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Total label="Ventas totales" value={dailyReport.grossSales} />
                <Total label="Esperado efectivo" value={dailyReport.expectedCash} />
                <Total label="Efectivo contado" value={dailyReport.counted} />
                <Total label="Diferencia efectivo" value={dailyReport.difference} danger={Math.abs(dailyReport.difference) > 0.01} />
                <Total label="Esperado tarjetas" value={dailyReport.expectedCard} />
                <Total label="Esperado transferencias" value={dailyReport.expectedTransfer} />
                <Total label="Credito" value={creditNet} />
                <Total label="Notas credito" value={dailyReport.returns} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setCutSection('methods')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${cutSection === 'methods' ? 'bg-blue-500 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}>Corte por metodo</button>
              <button type="button" onClick={() => setCutSection('movements')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${cutSection === 'movements' ? 'bg-blue-500 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}>Movimientos del dia ({dailyReport.movements.length})</button>
            </div>
            {cutSection === 'methods' ? (
              <DataTable data={dailyReport.byMethod} columns={methodColumns} initialPageSize={8} emptyText="Sin pagos en este dia." />
            ) : (
              <DataTable data={dailyReport.movements} columns={movementColumns(removeMovement)} initialPageSize={10} emptyText="Sin movimientos de caja en este dia." searchPlaceholder="Buscar concepto, metodo, categoria..." />
            )}
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-display text-lg font-bold">Movimiento manual</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Registra pagos, gastos, servicios, mensajeria, entradas y salidas operativas desde cero.</p>
          </div>
          <span className="rounded-full border px-3 py-2 text-xs font-black uppercase" style={{ borderColor: 'rgba(16,185,129,.28)', background: 'rgba(16,185,129,.09)', color: 'rgb(167,243,208)' }}>Modulo separado</span>
        </div>
        <form onSubmit={submitMovement} className="manual-entry-form mt-4">
          <label><span className="label-dark">Tipo</span><select id="cash-movement-type" name="cash-movement-type" value={movement.type} onChange={(event) => setMovementField('type', event.target.value)} className="input-dark"><option value="income">Ingreso</option><option value="expense">Salida / gasto</option><option value="withdrawal">Retiro</option></select></label>
          <label><span className="label-dark">Categoria</span><select id="cash-movement-category" name="cash-movement-category" value={movement.category} onChange={(event) => setMovementField('category', event.target.value)} className="input-dark">{movementCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label><span className="label-dark">Metodo de pago</span><select id="cash-movement-method" name="cash-movement-method" value={movement.method} onChange={(event) => setMovementField('method', event.target.value)} className="input-dark">{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label><span className="label-dark">Fecha del movimiento</span><input id="cash-movement-date" name="cash-movement-date" type="date" value={movement.movementDate} onChange={(event) => setMovementField('movementDate', event.target.value)} className="input-dark" /></label>
          <label><span className="label-dark">Monto</span><input id="cash-movement-amount" name="cash-movement-amount" type="number" value={movement.amount} onChange={(event) => setMovementField('amount', event.target.value)} className="input-dark" /></label>
          <label className="manual-entry-wide"><span className="label-dark">Concepto</span><input id="cash-movement-concept" name="cash-movement-concept" value={movement.concept} onChange={(event) => setMovementField('concept', event.target.value)} className="input-dark" placeholder="Ej. Pago de internet, envio a cliente, compra operativa..." /></label>
          <label><span className="label-dark">Destino / hacia donde fue</span><input id="cash-movement-destination" name="cash-movement-destination" value={movement.destination} onChange={(event) => setMovementField('destination', event.target.value)} className="input-dark" placeholder="Proveedor, cliente, sucursal..." /></label>
          <label><span className="label-dark">Mensajero / responsable</span><input id="cash-movement-messenger" name="cash-movement-messenger" value={movement.messenger} onChange={(event) => setMovementField('messenger', event.target.value)} className="input-dark" placeholder="Nombre o ruta" /></label>
          <label><span className="label-dark">Referencia</span><input id="cash-movement-reference" name="cash-movement-reference" value={movement.reference} onChange={(event) => setMovementField('reference', event.target.value)} className="input-dark" placeholder="Recibo, transferencia, comprobante" /></label>
          <label><span className="label-dark">Canal</span><input id="cash-movement-channel" name="cash-movement-channel" value={movement.channel} onChange={(event) => setMovementField('channel', event.target.value)} className="input-dark" placeholder="Caja, banco, mensajeria..." /></label>
          <label className="manual-entry-notes"><span className="label-dark">Notas</span><textarea id="cash-movement-notes" name="cash-movement-notes" value={movement.notes} onChange={(event) => setMovementField('notes', event.target.value)} className="input-dark min-h-20 resize-y" placeholder="Detalle del pago, quien autorizo, ruta, observaciones..." /></label>
          <Button icon={Plus} variant="primary" className="self-end" type="submit">Registrar movimiento</Button>
        </form>
      </section>

      <section className="rounded-2xl border border-[#243244] bg-[#111827] p-5">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="font-display text-lg font-bold">Reporte de movimientos manuales</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Diario por defecto; amplie el rango solo cuando lo necesite.</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="primary" icon={Download} onClick={exportManualPdf}>PDF avanzado</Button>
            <Button variant="ghost" icon={FileSpreadsheet} onClick={exportManualCsv}>Excel</Button>
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label><span className="label-dark">Desde</span><input id="manual-from" name="manualFrom" type="date" value={manualFrom} onChange={(event) => setManualFrom(event.target.value)} className="input-dark" aria-label="manual-from" autoComplete="off" /></label>
          <label><span className="label-dark">Hasta</span><input id="manual-to" name="manualTo" type="date" value={manualTo} onChange={(event) => setManualTo(event.target.value)} className="input-dark" aria-label="manual-to" autoComplete="off" /></label>
          <label><span className="label-dark">Metodo</span><select id="manual-method" name="manualMethod" value={manualMethod} onChange={(event) => setManualMethod(event.target.value)} className="input-dark" aria-label="manual-method" autoComplete="off"><option value="all">Todos</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label><span className="label-dark">Categoria</span><select id="manual-category" name="manualCategory" value={manualCategory} onChange={(event) => setManualCategory(event.target.value)} className="input-dark" aria-label="manual-category" autoComplete="off"><option value="all">Todas</option>{movementCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
        </div>

        <div className="movement-kpi-strip mb-4">
          <div className="movement-kpi report-nav-green"><span>Ingresos manuales</span><strong>{currency.format(manualSummary.income)}</strong></div>
          <div className="movement-kpi report-nav-red"><span>Salidas manuales</span><strong>{currency.format(manualSummary.outflow)}</strong></div>
          <div className={`movement-kpi ${manualSummary.net < 0 ? 'report-nav-red' : 'report-nav-blue'}`}><span>Balance manual</span><strong>{currency.format(manualSummary.net)}</strong></div>
          <div className="movement-kpi report-nav-violet"><span>Movimientos</span><strong>{manualSummary.count}</strong></div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setActiveBreakdown('category')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeBreakdown === 'category' ? 'bg-blue-500 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}>Desglose por categoria</button>
          <button type="button" onClick={() => setActiveBreakdown('method')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeBreakdown === 'method' ? 'bg-blue-500 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}>Desglose por metodo</button>
          <button type="button" onClick={() => setActiveBreakdown('type')} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeBreakdown === 'type' ? 'bg-blue-500 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white'}`}>Desglose por tipo</button>
        </div>
        <DataTable data={breakdownRows} columns={breakdownColumns} initialPageSize={8} emptyText="Sin datos en el rango seleccionado." />

        <div className="section-divider my-4" />

        <DataTable data={manualMovements} columns={manualMovementColumns(removeMovement, setDetailMovement)} initialPageSize={15} emptyText="Sin movimientos manuales para este rango." searchPlaceholder="Buscar categoria, concepto, destino, mensajero, referencia o metodo..." />
      </section>

      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Abrir caja" size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Button><Button variant="success" icon={Unlock} onClick={handleOpen}>Abrir caja</Button></div>}>
        <div className="grid gap-3">
          <label><span className="label-dark">Sucursal</span><select id="cash-branch" name="cash-branch" value={openForm.branchId} onChange={(event) => selectBranch(event.target.value)} className="input-dark"><option value="">Sucursal principal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label><span className="label-dark">Caja</span><input id="cash-name" name="cash-name" value={openForm.cashName} onChange={(event) => setOpenField('cashName', event.target.value)} className="input-dark" /></label>
          <label><span className="label-dark">Cajero</span><input id="cash-cashier" name="cash-cashier" value={openForm.cashier} onChange={(event) => setOpenField('cashier', event.target.value)} className="input-dark" /></label>
          <label><span className="label-dark">Monto inicial</span><input id="cash-opening-amount" name="cash-opening-amount" type="number" value={openForm.amount} onChange={(event) => setOpenField('amount', event.target.value)} className="input-dark" /></label>
        </div>
      </Modal>

      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Confirmar cierre de caja" description="Revise el efectivo contado antes de cerrar. El cierre es irreversible hasta una nueva apertura." size="md" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCloseModal(false)}>Cancelar</Button><Button variant="danger" icon={Lock} onClick={handleClose}>Confirmar cierre</Button></div>}>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg p-4" style={{ background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.25)' }}>
            <AlertTriangle size={24} style={{ color: 'var(--color-pending)' }} />
            <div>
              <p className="font-bold" style={{ color: 'rgb(252,211,77)' }}>Diferencia detectada: {currency.format(dailyReport.difference)}</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,.6)' }}>Balance calculado: {currency.format(dailyReport.expected)} vs contado: {currency.format(dailyReport.counted)}</p>
            </div>
          </div>
          <label><span className="label-dark">Efectivo contado al cierre</span><input id="cash-counted" name="cash-counted" type="number" value={counted} onChange={(event) => setCounted(event.target.value)} className="input-dark" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,.035)' }}>
              <p className="text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>Total ventas del dia</p>
              <p className="font-display text-xl font-bold">{currency.format(dailyReport.grossSales)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,.035)' }}>
              <p className="text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>Gastos del dia</p>
              <p className="font-display text-xl font-bold">{currency.format(dailyReport.expenses)}</p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={historyModal} onClose={() => setHistoryModal(false)} title="Historial de movimientos de caja" size="xl">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label><span className="label-dark">Desde</span><input id="history-from" name="historyFrom" type="date" value={historyRange.from} onChange={(event) => setHistoryRange((state) => ({ ...state, from: event.target.value }))} className="input-dark" autoComplete="off" /></label>
            <label><span className="label-dark">Hasta</span><input id="history-to" name="historyTo" type="date" value={historyRange.to} onChange={(event) => setHistoryRange((state) => ({ ...state, to: event.target.value }))} className="input-dark" autoComplete="off" /></label>
          </div>
          <DataTable data={historyMovements} columns={movementColumns(removeMovement)} initialPageSize={10} emptyText="Sin movimientos en el rango." searchPlaceholder="Buscar concepto, metodo, categoria..." />
        </div>
      </Modal>

      <Modal open={Boolean(detailMovement)} onClose={() => setDetailMovement(null)} title="Detalle del movimiento" size="md">
        {detailMovement ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fecha" value={formatDate(detailMovement.movementDate || detailMovement.createdAt)} />
            <Field label="Tipo" value={movementTypeLabel(detailMovement.type)} />
            <Field label="Categoria" value={detailMovement.category || '-'} />
            <Field label="Metodo" value={detailMovement.method || '-'} />
            <Field label="Monto" value={currency.format(signedManualAmount(detailMovement))} strong />
            <Field label="Concepto" value={detailMovement.concept || '-'} wide />
            <Field label="Destino" value={detailMovement.destination || '-'} />
            <Field label="Mensajero" value={detailMovement.messenger || '-'} />
            <Field label="Referencia" value={detailMovement.reference || '-'} />
            <Field label="Canal" value={detailMovement.channel || '-'} />
            <Field label="Notas" value={detailMovement.notes || '-'} wide />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function defaultManualMovement() {
  return {
    type: 'expense',
    category: 'Gastos',
    amount: '',
    method: 'Efectivo',
    concept: '',
    reference: '',
    destination: '',
    messenger: '',
    movementDate: todayIso(),
    channel: 'Caja',
    notes: '',
  }
}

function Total({ label, value, danger }) {
  return <div className="rounded-lg p-4" style={{ border: '1px solid var(--line)', background: 'rgba(255,255,255,.04)' }}><p className="text-xs font-extrabold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>{label}</p><p className={`mt-1 font-display text-2xl font-bold ${danger ? 'text-red-300' : ''}`}>{currency.format(value || 0)}</p></div>
}

function Field({ label, value, wide = false, strong = false }) {
  return (
    <div className={`rounded-lg p-3 ${wide ? 'sm:col-span-2' : ''}`} style={{ background: 'rgba(255,255,255,.035)' }}>
      <p className="text-xs font-bold uppercase" style={{ color: 'rgba(255,255,255,.4)' }}>{label}</p>
      <p className={`mt-1 text-sm ${strong ? 'font-display text-xl font-bold text-white' : 'text-white/70'}`}>{value}</p>
    </div>
  )
}

const methodColumns = [
  { header: 'Metodo', accessorKey: 'method' },
  { header: 'Ventas', cell: ({ row }) => currency.format(row.original.sales || 0) },
  { header: 'Devoluciones', cell: ({ row }) => currency.format(row.original.refunds || 0) },
  { header: 'Neto', cell: ({ row }) => currency.format(row.original.net || 0) },
]

const movementColumns = (removeMovement) => [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.createdAt || row.original.movementDate) },
  { header: 'Tipo', cell: ({ row }) => movementTypeLabel(row.original.type) },
  { header: 'Categoria', accessorKey: 'category' },
  { header: 'Metodo', accessorKey: 'method' },
  { header: 'Concepto', cell: ({ row }) => row.original.concept || row.original.note || '' },
  { header: 'Monto', cell: ({ row }) => currency.format(signedManualAmount(row.original)) },
  { header: 'Acciones', cell: ({ row }) => isManualMovement(row.original) ? <button type="button" onClick={() => removeMovement(row.original)} className="rounded-md border p-2 transition" style={{ borderColor: 'rgba(239,68,68,.2)', background: 'rgba(239,68,68,.1)', color: 'rgb(254,202,202)' }} aria-label="Eliminar movimiento"><Trash2 size={15} /></button> : <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,.35)' }}>Sistema</span> },
]

const manualMovementColumns = (removeMovement, openDetail) => [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.movementDate || row.original.createdAt) },
  { header: 'Tipo', cell: ({ row }) => movementTypeLabel(row.original.type) },
  { header: 'Categoria', accessorKey: 'category' },
  { header: 'Metodo', accessorKey: 'method' },
  { header: 'Destino', accessorKey: 'destination' },
  { header: 'Mensajero', accessorKey: 'messenger' },
  { header: 'Concepto', cell: ({ row }) => row.original.concept || row.original.note || '' },
  { header: 'Referencia', accessorKey: 'reference' },
  { header: 'Monto', cell: ({ row }) => currency.format(signedManualAmount(row.original)) },
  { header: 'Acciones', cell: ({ row }) => (
    <div className="flex gap-1">
      <button type="button" onClick={() => openDetail(row.original)} className="rounded-md border p-2 transition" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.035)', color: 'rgba(255,255,255,.65)' }} aria-label="Ver detalle"><Eye size={15} /></button>
      <button type="button" onClick={() => removeMovement(row.original)} className="rounded-md border p-2 transition" style={{ borderColor: 'rgba(239,68,68,.2)', background: 'rgba(239,68,68,.1)', color: 'rgb(254,202,202)' }} aria-label="Eliminar movimiento"><Trash2 size={15} /></button>
    </div>
  ) },
]

const breakdownColumns = [
  { header: 'Detalle', accessorKey: 'label' },
  { header: 'Cantidad', accessorKey: 'count' },
  { header: 'Ingresos', cell: ({ row }) => currency.format(row.original.income || 0) },
  { header: 'Salidas', cell: ({ row }) => currency.format(row.original.outflow || 0) },
  { header: 'Balance', cell: ({ row }) => currency.format(row.original.net || 0) },
]

function isManualMovement(movement) {
  return movement?.source === 'manual' || movementCategories.includes(movement?.category)
}

function signedManualAmount(movement) {
  const amount = Number(movement?.amount || 0)
  const type = String(movement?.type || '').toLowerCase()
  return ['expense', 'withdrawal', 'retiro'].includes(type) ? -amount : amount
}

function summarizeManualMovements(movements) {
  const typeMap = new Map()
  const categoryMap = new Map()
  const methodMap = new Map()
  const summary = movements.reduce((current, movement) => {
    const signed = signedManualAmount(movement)
    const positive = Math.max(0, signed)
    const negative = Math.max(0, Math.abs(Math.min(0, signed)))
    if (signed >= 0) {
      current.income += signed
      current.incomeCount += 1
      current.maxIncome = Math.max(current.maxIncome, signed)
    } else {
      current.outflow += Math.abs(signed)
      current.outflowCount += 1
      current.maxOutflow = Math.max(current.maxOutflow, Math.abs(signed))
    }
    current.net += signed
    current.count += 1
    addManualBreakdown(typeMap, movementTypeLabel(movement.type), positive, negative, signed)
    addManualBreakdown(categoryMap, movement.category || 'Sin categoria', positive, negative, signed)
    addManualBreakdown(methodMap, movement.method || 'Sin metodo', positive, negative, signed)
    return current
  }, { income: 0, outflow: 0, net: 0, count: 0, incomeCount: 0, outflowCount: 0, avgIncome: 0, avgOutflow: 0, maxIncome: 0, maxOutflow: 0, byType: [], byCategory: [], byMethod: [] })

  summary.avgIncome = summary.incomeCount ? summary.income / summary.incomeCount : 0
  summary.avgOutflow = summary.outflowCount ? summary.outflow / summary.outflowCount : 0
  summary.byType = manualBreakdownRows(typeMap)
  summary.byCategory = manualBreakdownRows(categoryMap)
  summary.byMethod = manualBreakdownRows(methodMap)
  return summary
}

function addManualBreakdown(map, label, income, outflow, net) {
  const key = label || 'Sin definir'
  const item = map.get(key) || { label: key, count: 0, income: 0, outflow: 0, net: 0 }
  item.count += 1
  item.income += income
  item.outflow += outflow
  item.net += net
  map.set(key, item)
}

function manualBreakdownRows(map) {
  return Array.from(map.values()).sort((left, right) => Math.abs(right.net) - Math.abs(left.net))
}

function movementTypeLabel(type) {
  const value = String(type || '').toLowerCase()
  if (value === 'income') return 'Ingreso'
  if (value === 'expense') return 'Gasto'
  if (value === 'withdrawal' || value === 'retiro') return 'Retiro'
  if (value === 'payable_payment') return 'Pago CxP'
  return type || 'Movimiento'
}

