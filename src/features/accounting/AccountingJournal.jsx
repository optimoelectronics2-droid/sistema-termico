import { useMemo, useState } from 'react'
import { BookOpenCheck, Download, FileSpreadsheet, Printer, Scale, Search } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { DataTable } from '../../components/ui/DataTable'
import { buildAccountingJournal } from '../../lib/accountingEngine'
import { downloadCsvWorkbook } from '../../lib/csvExport'
import { todayIso } from '../../lib/dateTime'
import { currency, formatDate } from '../../lib/formatters'
import { isActiveCreditNote, isActiveExpense, isActiveInventoryMovement, isActiveProduct, isActiveReceivable, isReportableInvoice, sanitizeCashRegister } from '../../lib/realDataGuards'
import { useERPStore } from '../../store/useERPStore'

export function AccountingJournal() {
  const company = useERPStore((state) => state.company)
  const invoices = useERPStore((state) => state.invoices)
  const creditNotes = useERPStore((state) => state.creditNotes)
  const payments = useERPStore((state) => state.payments)
  const expenses = useERPStore((state) => state.expenses)
  const purchases = useERPStore((state) => state.purchases)
  const products = useERPStore((state) => state.products)
  const receivables = useERPStore((state) => state.receivables)
  const inventoryMovements = useERPStore((state) => state.inventoryMovements)
  const inventoryReports = useERPStore((state) => state.inventoryReports)
  const cashRegister = useERPStore((state) => state.cashRegister)
  const [tab, setTab] = useState('journal')
  const [query, setQuery] = useState('')
  const [range, setRange] = useState(() => {
    const today = todayIso()
    return { dateFrom: today, dateTo: today, timeFrom: '00:00', timeTo: '23:59' }
  })
  const journal = useMemo(() => buildAccountingJournal({ invoices, creditNotes, payments, expenses, receivables, cashRegister, company }), [cashRegister, company, creditNotes, expenses, invoices, payments, receivables])
  const filteredLines = useMemo(() => {
    const term = query.trim().toLowerCase()
    return journal.lines.filter((line) => inRange(line.date, range) && (!term || [
      line.number,
      line.description,
      line.reference,
      line.accountCode,
      line.accountName,
      line.user,
      line.branch,
      line.movementType,
    ].some((value) => String(value || '').toLowerCase().includes(term))))
  }, [journal.lines, query, range])
  const filteredLedger = useMemo(() => buildLedgerFromLines(filteredLines), [filteredLines])
  const filteredEntries = useMemo(() => journal.entries.filter((entry) => inRange(entry.date, range) && filteredLines.some((line) => line.entryId === entry.id)), [filteredLines, journal.entries, range])
  const accountAnalysis = useMemo(() => buildAccountAnalysis(filteredLedger), [filteredLedger])
  const reportPages = useMemo(() => buildAccountingReportPages({
    range,
    invoices,
    creditNotes,
    expenses,
    purchases,
    products,
    receivables,
    inventoryMovements,
    inventoryReports,
    cashRegister,
  }), [cashRegister, creditNotes, expenses, inventoryMovements, inventoryReports, invoices, products, purchases, range, receivables])
  const debitTotal = sumLines(filteredLines, 'debit')
  const creditTotal = sumLines(filteredLines, 'credit')
  const difference = debitTotal - creditTotal

  function exportExcel() {
    const entrySheets = filteredEntries.map((entry, index) => {
      const entryLines = filteredLines.filter((line) => line.entryId === entry.id)
      const rows = [
        { campo: 'Asiento', valor: entry.number },
        { campo: 'Fecha', valor: entry.date },
        { campo: 'Tipo', valor: entry.type },
        { campo: 'Origen', valor: entry.source || '' },
        { campo: 'Documento', valor: entry.documentNumber || entry.reference || '' },
        { campo: 'Cliente', valor: entry.customerName || '' },
        { campo: 'Referencia', valor: entry.reference || '' },
        { campo: 'Usuario', valor: entry.user || '' },
        { campo: 'Sucursal', valor: entry.branch || '' },
        { campo: 'Explicacion', valor: entry.explanation || '' },
        { campo: 'Total debito', valor: entry.debit || 0 },
        { campo: 'Total credito', valor: entry.credit || 0 },
        { campo: 'Diferencia', valor: entry.difference || 0 },
        {},
        { campo: 'Linea', valor: 'Cuenta', detalle: 'Nombre', debito: 'Debito', credito: 'Credito', lectura: 'Detalle' },
        ...entryLines.map((line) => ({
          campo: line.entryLine,
          valor: line.accountCode,
          detalle: line.accountName,
          debito: line.debit || 0,
          credito: line.credit || 0,
          lectura: `${line.description || ''} | ${line.accountType || ''} | Naturaleza ${line.normalBalance || ''}`,
        })),
      ]
      return { name: `${String(index + 1).padStart(3, '0')} ${entry.number}`, rows }
    })
    downloadCsvWorkbook(`libro-contable-${range.dateFrom}-${range.dateTo}.csv`, [
      { name: 'Catalogo cuentas', rows: journal.accounts },
      { name: 'Asientos explicados', rows: filteredEntries.map(entryToExcelRow) },
      { name: 'Libro diario', rows: filteredLines.map(lineToExcelRow) },
      { name: 'Mayor general', rows: filteredLedger.map(ledgerToExcelRow) },
      { name: 'Analisis cuentas', rows: accountAnalysis.map(accountAnalysisToExcelRow) },
      ...reportPages.map((page) => ({ name: page.title, rows: page.rows })),
      ...entrySheets,
    ])
  }

  async function exportPdf() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(company?.name || 'Libro contable diario', 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`RNC: ${company?.rnc || 'N/A'} | Desde ${range.dateFrom} hasta ${range.dateTo} | Generado: ${formatDate(journal.generatedAt)}`, 12, 21)
    doc.text(`Asientos: ${filteredEntries.length} | Lineas: ${filteredLines.length} | Estado: ${Math.abs(difference) < 0.01 ? 'Cuadrado' : 'Con diferencia'}`, 12, 27)
    autoTable(doc, {
      startY: 36,
      head: [['Fecha', 'Asiento', 'Tipo', 'Documento', 'Cliente', 'Debito', 'Credito', 'Estado']],
      body: filteredEntries.map((entry) => [formatDate(entry.date), entry.number, entry.type, entry.documentNumber || entry.reference || '-', entry.customerName || '-', currency.format(entry.debit || 0), currency.format(entry.credit || 0), entry.balanced ? 'Cuadrado' : 'Revisar']),
      styles: { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      columnStyles: { 4: { cellWidth: 38 }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Desde', 'Hasta', 'Total debitos', 'Total creditos', 'Diferencia']],
      body: [[range.dateFrom, range.dateTo, currency.format(debitTotal), currency.format(creditTotal), currency.format(difference)]],
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
    })
    filteredEntries.forEach((entry, index) => {
      doc.addPage()
      drawEntryPdfPage(doc, autoTable, {
        entry,
        lines: filteredLines.filter((line) => line.entryId === entry.id),
        company,
        range,
        pageLabel: `Registro ${index + 1} de ${filteredEntries.length}`,
      })
    })
    reportPages.forEach((page) => {
      doc.addPage()
      drawReportPdfPage(doc, autoTable, page, company, range)
    })
    if (accountAnalysis.length) drawAccountAnalysisPdfPage(doc, autoTable, accountAnalysis)
    addPdfFooters(doc, company, range)
    doc.save(`libro-contable-${range.dateFrom}-${range.dateTo}.pdf`)
  }

  return (
    <div className="space-y-5">
      <div className="module-header">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="module-header-eyebrow"><BookOpenCheck size={17} /> Contabilidad avanzada</p>
            <h2 className="module-header-title">Libro contable profesional</h2>
            <p className="module-header-desc">Libro diario, asientos explicados, mayor general y analisis por cuenta con origen documental y balance de comprobacion.</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
            <Button variant="ghost" icon={FileSpreadsheet} onClick={exportExcel}>Excel</Button>
            <Button variant="primary" icon={Download} onClick={exportPdf}>PDF por hojas</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <TotalCard label="Asientos" value={filteredEntries.length} raw />
          <TotalCard label="Lineas filtradas" value={filteredLines.length} raw />
          <TotalCard label="Debitos" value={currency.format(debitTotal)} />
          <TotalCard label="Creditos" value={currency.format(creditTotal)} />
          <TotalCard label="Balance" value={Math.abs(difference) < 0.01 ? 'Cuadrado' : currency.format(difference)} raw />
        </div>
      </div>

      <section>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex">
            {[
              ['journal', 'Libro diario'],
              ['entries', 'Asientos'],
              ['reports', 'Reportes'],
              ['ledger', 'Mayor general'],
              ['analysis', 'Analisis'],
              ['accounts', 'Catalogo'],
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`quick-filter-btn${tab === id ? ' active' : ''}`}>{label}</button>
            ))}
          </div>
          <div className="grid w-full gap-2 lg:max-w-5xl lg:grid-cols-[140px_120px_140px_120px_1fr]">
            <input id="journal-date-from" type="date" value={range.dateFrom} onChange={(event) => setRange((state) => ({ ...state, dateFrom: event.target.value }))} className="input-dark" aria-label="journal-date-from" />
            <input id="journal-time-from" type="time" value={range.timeFrom} onChange={(event) => setRange((state) => ({ ...state, timeFrom: event.target.value }))} className="input-dark" aria-label="journal-time-from" />
            <input id="journal-date-to" type="date" value={range.dateTo} onChange={(event) => setRange((state) => ({ ...state, dateTo: event.target.value }))} className="input-dark" aria-label="journal-date-to" />
            <input id="journal-time-to" type="time" value={range.timeTo} onChange={(event) => setRange((state) => ({ ...state, timeTo: event.target.value }))} className="input-dark" aria-label="journal-time-to" />
            <label className="module-search-bar">
              <Search size={15} className="text-white/35" />
              <input id="journal-query" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm font-bold outline-none placeholder:text-white/35" placeholder="Buscar asiento, cuenta, cliente, usuario, referencia..." />
            </label>
          </div>
        </div>
      </section>

      <section className="printable-report">
        {tab === 'journal' ? (
          <Panel title="Libro diario detallado">
            <DataTable data={filteredLines} columns={journalColumns} initialPageSize={25} emptyText="Aun no hay movimientos contables derivados." />
          </Panel>
        ) : null}
        {tab === 'entries' ? (
          <Panel title="Asientos contables explicados">
            <div className="grid gap-3">
              {filteredEntries.length ? filteredEntries.map((entry) => <EntryCard key={entry.id} entry={entry} lines={filteredLines.filter((line) => line.entryId === entry.id)} />) : <p className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-white/45">No hay asientos para este rango.</p>}
            </div>
          </Panel>
        ) : null}
        {tab === 'reports' ? (
          <Panel title="Reportes contables separados">
            <ReportPages pages={reportPages} />
          </Panel>
        ) : null}
        {tab === 'ledger' ? (
          <Panel title="Mayor general">
            <DataTable data={filteredLedger} columns={ledgerColumns} initialPageSize={25} emptyText="Aun no hay cuentas con movimientos." />
          </Panel>
        ) : null}
        {tab === 'analysis' ? (
          <Panel title="Balance de comprobacion y analisis">
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <InsightCard label="Estado contable" value={Math.abs(difference) < 0.01 ? 'Cuadrado' : 'Revisar diferencia'} detail={`Diferencia: ${currency.format(difference)}`} />
              <InsightCard label="Cuenta mas movida" value={accountAnalysis[0]?.accountName || 'N/A'} detail={`${accountAnalysis[0]?.movements || 0} movimiento(s)`} />
              <InsightCard label="Cuentas activas" value={accountAnalysis.length} detail="Con movimientos en el rango" />
            </div>
            <DataTable data={accountAnalysis} columns={analysisColumns} initialPageSize={25} emptyText="No hay cuentas con movimientos." />
          </Panel>
        ) : null}
        {tab === 'accounts' ? (
          <Panel title="Catalogo de cuentas base">
            <DataTable data={journal.accounts} columns={accountColumns} initialPageSize={25} emptyText="No hay cuentas configuradas." />
          </Panel>
        ) : null}
      </section>
    </div>
  )
}

function Panel({ title, children }) {
  return <section><h3 className="mb-4 font-display text-xl font-bold">{title}</h3>{children}</section>
}

function TotalCard({ label, value }) {
  return <div className="summary-chip"><span className="summary-chip-label">{label}</span><span className="summary-chip-value">{value}</span></div>
}

function InsightCard({ label, value, detail }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4"><p className="text-xs font-extrabold uppercase text-white/40">{label}</p><p className="mt-1 font-display text-xl font-bold">{value}</p><p className="mt-1 text-xs font-bold text-white/45">{detail}</p></div>
}

function EntryCard({ entry, lines }) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#101119]/75 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase text-blue-200/80"><Scale size={14} /> {entry.number} · {entry.type}</p>
          <h4 className="mt-1 font-display text-lg font-bold text-white">{entry.description}</h4>
          <p className="mt-1 text-sm text-white/50">{entry.explanation}</p>
          <p className="mt-2 text-xs text-white/40">Fecha: {formatDate(entry.date)} · Referencia: {entry.reference || '-'} · Usuario: {entry.user || '-'}</p>
        </div>
        <div className="grid min-w-64 gap-2 text-sm">
          <div className="flex justify-between gap-3 rounded-md bg-white/[0.035] px-3 py-2"><span className="text-white/45">Debito</span><b>{currency.format(entry.debit || 0)}</b></div>
          <div className="flex justify-between gap-3 rounded-md bg-white/[0.035] px-3 py-2"><span className="text-white/45">Credito</span><b>{currency.format(entry.credit || 0)}</b></div>
          <div className={`flex justify-between gap-3 rounded-md px-3 py-2 font-bold ${entry.balanced ? 'bg-emerald-500/12 text-emerald-100' : 'bg-red-500/12 text-red-100'}`}><span>{entry.balanced ? 'Cuadrado' : 'Diferencia'}</span><span>{currency.format(entry.difference || 0)}</span></div>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase text-white/45"><tr><th className="px-3 py-2">Cuenta</th><th className="px-3 py-2">Detalle</th><th className="px-3 py-2 text-right">Debito</th><th className="px-3 py-2 text-right">Credito</th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2 font-bold text-white/80">{line.accountCode} {line.accountName}<p className="text-xs font-normal text-white/35">{line.accountType} · Naturaleza {line.normalBalance}</p></td>
                <td className="px-3 py-2 text-white/60">{line.description}<p className="text-xs text-white/35">{line.documentNumber || line.reference}</p></td>
                <td className="px-3 py-2 text-right text-white/80">{line.debit ? currency.format(line.debit) : '-'}</td>
                <td className="px-3 py-2 text-right text-white/80">{line.credit ? currency.format(line.credit) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function ReportPages({ pages }) {
  return (
    <div className="grid gap-4">
      {pages.map((page) => (
        <section key={page.id} className="rounded-lg border border-white/10 bg-[#101119]/75 p-4">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase text-blue-200/80">{page.group}</p>
              <h4 className="font-display text-xl font-bold">{page.title}</h4>
              <p className="text-sm text-white/45">{page.description}</p>
            </div>
            <div className="grid min-w-52 gap-2">
              {page.metrics.slice(0, 3).map((metric) => <div key={metric.label} className="rounded-md bg-white/[0.04] px-3 py-2"><p className="text-xs font-bold uppercase text-white/35">{metric.label}</p><p className="font-display text-lg font-bold">{metric.value}</p></div>)}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {page.metrics.slice(3).map((metric) => <InsightCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail || ''} />)}
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase text-white/45"><tr>{page.columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/10">
                {page.rows.length ? page.rows.slice(0, 18).map((row, index) => <tr key={`${page.id}-${index}`}>{page.columns.map((column) => <td key={column} className="px-3 py-2 text-white/70">{row[column] ?? '-'}</td>)}</tr>) : <tr><td colSpan={page.columns.length} className="px-3 py-6 text-center text-white/40">Sin datos para este rango.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function drawReportPdfPage(doc, autoTable, page, company, range) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42)
  doc.text(company?.name || 'Libro contable', 12, 16)
  doc.setFontSize(12)
  doc.text(page.title, 12, 26)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`${page.description} | ${range.dateFrom} ${range.timeFrom} - ${range.dateTo} ${range.timeTo}`, 12, 33)
  autoTable(doc, {
    startY: 41,
    head: [['Indicador', 'Valor', 'Detalle']],
    body: page.metrics.map((metric) => [metric.label, metric.value, metric.detail || '']),
    styles: { fontSize: 8, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
  })
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [page.columns],
    body: page.rows.map((row) => page.columns.map((column) => row[column] ?? '')),
    styles: { fontSize: 7, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  })
}

function drawEntryPdfPage(doc, autoTable, { entry, lines, company, range, pageLabel }) {
  const width = doc.internal.pageSize.getWidth()
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, width, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(company?.name || 'Libro contable', 12, 9)
  doc.setFontSize(10)
  doc.text(pageLabel, width - 12, 9, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Periodo ${range.dateFrom} - ${range.dateTo}`, 12, 16)
  doc.text(`Generado: ${formatDate(new Date().toISOString())}`, width - 12, 16, { align: 'right' })

  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(`Asiento ${entry.number}`, 12, 34)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`${entry.type || 'Movimiento'} | ${formatDate(entry.date)} | ${entry.balanced ? 'Cuadrado' : 'Con diferencia'}`, 12, 41)

  autoTable(doc, {
    startY: 48,
    theme: 'grid',
    head: [['Campo', 'Detalle']],
    body: [
      ['Origen', entry.source || entry.type || '-'],
      ['Documento', entry.documentNumber || entry.reference || '-'],
      ['Cliente / tercero', entry.customerName || '-'],
      ['Referencia', entry.reference || '-'],
      ['Usuario', entry.user || '-'],
      ['Sucursal', entry.branch || '-'],
      ['Metodo de pago', entry.paymentMethod || '-'],
      ['Descripcion', entry.description || '-'],
      ['Explicacion contable', entry.explanation || '-'],
    ],
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' }, 1: { cellWidth: 142 } },
  })

  const detailY = doc.lastAutoTable.finalY + 7
  autoTable(doc, {
    startY: detailY,
    theme: 'grid',
    head: [['Linea', 'Cuenta', 'Tipo', 'Naturaleza', 'Detalle real', 'Debito', 'Credito']],
    body: lines.map((line) => [
      line.entryLine,
      `${line.accountCode} ${line.accountName}`,
      line.accountType || '-',
      line.normalBalance || '-',
      [
        line.description,
        line.documentNumber ? `Documento: ${line.documentNumber}` : '',
        line.customerName ? `Cliente: ${line.customerName}` : '',
        line.paymentMethod ? `Pago: ${line.paymentMethod}` : '',
        line.accountDescription ? `Uso cuenta: ${line.accountDescription}` : '',
      ].filter(Boolean).join('\n'),
      line.debit ? currency.format(line.debit) : '-',
      line.credit ? currency.format(line.credit) : '-',
    ]),
    styles: { fontSize: 7.2, cellPadding: 1.7, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 11, halign: 'center' },
      1: { cellWidth: 38 },
      2: { cellWidth: 22 },
      3: { cellWidth: 22 },
      4: { cellWidth: 57 },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
    },
  })

  const summaryY = Math.min((doc.lastAutoTable?.finalY || 210) + 8, 236)
  autoTable(doc, {
    startY: summaryY,
    theme: 'grid',
    head: [['Total debito', 'Total credito', 'Diferencia', 'Resultado']],
    body: [[
      currency.format(entry.debit || 0),
      currency.format(entry.credit || 0),
      currency.format(entry.difference || 0),
      entry.balanced ? 'Asiento cuadrado' : 'Revisar diferencia',
    ]],
    styles: { fontSize: 8, halign: 'center' },
    headStyles: { fillColor: entry.balanced ? [16, 185, 129] : [239, 68, 68], textColor: 255 },
  })
}

function drawAccountAnalysisPdfPage(doc, autoTable, accountAnalysis) {
  doc.addPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42)
  doc.text('Analisis por cuenta contable', 12, 16)
  autoTable(doc, {
    startY: 24,
    head: [['Cuenta', 'Tipo', 'Naturaleza', 'Mov.', 'Debitos', 'Creditos', 'Balance', 'Lectura']],
    body: accountAnalysis.map((row) => [`${row.accountCode} ${row.accountName}`, row.accountType, row.normalBalance, row.movements, currency.format(row.debit), currency.format(row.credit), currency.format(row.balance), row.interpretation]),
    styles: { fontSize: 7, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    columnStyles: { 0: { cellWidth: 38 }, 7: { cellWidth: 52 } },
  })
}

function addPdfFooters(doc, company, range) {
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(`${company?.name || 'Libro contable'} | ${range.dateFrom} - ${range.dateTo}`, 12, 272)
    doc.text(`Pagina ${page} de ${totalPages}`, 204, 272, { align: 'right' })
  }
}

function entryToExcelRow(entry) {
  return { fecha: entry.date, asiento: entry.number, tipo: entry.type, origen: entry.source, documento: entry.documentNumber, cliente: entry.customerName, descripcion: entry.description, explicacion: entry.explanation, referencia: entry.reference, debito: entry.debit, credito: entry.credit, diferencia: entry.difference, cuadrado: entry.balanced, usuario: entry.user, sucursal: entry.branch }
}

function lineToExcelRow(line) {
  return { fecha: line.date, asiento: line.number, linea: line.entryLine, origen: line.source, documento: line.documentNumber, cliente: line.customerName, cuenta: line.accountCode, nombreCuenta: line.accountName, tipoCuenta: line.accountType, naturaleza: line.normalBalance, descripcion: line.description, referencia: line.reference, metodoPago: line.paymentMethod, debito: line.debit, credito: line.credit, lado: line.side, usuario: line.user, sucursal: line.branch, tipo: line.movementType }
}

function ledgerToExcelRow(row) {
  return { cuenta: row.accountCode, nombreCuenta: row.accountName, debito: row.debit, credito: row.credit, balance: row.balance, movimientos: row.lines?.length || 0 }
}

function accountAnalysisToExcelRow(row) {
  return { cuenta: row.accountCode, nombreCuenta: row.accountName, tipo: row.accountType, naturaleza: row.normalBalance, movimientos: row.movements, debito: row.debit, credito: row.credit, balance: row.balance, lectura: row.interpretation }
}

function inRange(value, range) {
  const date = parseDate(value)
  if (range.dateFrom && date < new Date(`${range.dateFrom}T${range.timeFrom || '00:00'}:00`)) return false
  if (range.dateTo && date > new Date(`${range.dateTo}T${range.timeTo || '23:59'}:59`)) return false
  return true
}

function buildLedgerFromLines(lines) {
  const grouped = new Map()
  lines
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((line) => {
      const current = grouped.get(line.accountCode) || { accountCode: line.accountCode, accountName: line.accountName, debit: 0, credit: 0, balance: 0, lines: [] }
      current.debit += Number(line.debit || 0)
      current.credit += Number(line.credit || 0)
      current.balance = current.debit - current.credit
      current.lines.push({ ...line, balance: current.balance })
      grouped.set(line.accountCode, current)
    })
  return [...grouped.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
}

function buildAccountAnalysis(ledger) {
  return ledger.map((row) => {
    const firstLine = row.lines?.[0] || {}
    const balance = Number(row.balance || 0)
    const normalSide = firstLine.normalBalance === 'Credito' ? -balance : balance
    return {
      ...row,
      accountType: firstLine.accountType || '',
      normalBalance: firstLine.normalBalance || '',
      accountDescription: firstLine.accountDescription || '',
      movements: row.lines?.length || 0,
      interpretation: normalSide >= 0
        ? `Saldo normal para ${firstLine.accountType || 'la cuenta'} en el periodo.`
        : `Saldo contrario a su naturaleza; revisar reversas, notas o reclasificaciones.`,
    }
  }).sort((a, b) => (b.movements - a.movements) || a.accountCode.localeCompare(b.accountCode))
}

function buildAccountingReportPages(context) {
  const { range, invoices = [], creditNotes = [], expenses = [], purchases = [], products = [], receivables = [], inventoryMovements = [], inventoryReports = {}, cashRegister = {} } = context
  const companyId = cashRegister.companyId || ''
  const validInvoices = invoices.filter((invoice) => isReportableInvoice(invoice, companyId))
  const validCreditNotes = creditNotes.filter((note) => isActiveCreditNote(note, companyId))
  const validExpenses = expenses.filter((expense) => isActiveExpense(expense, companyId))
  const validProducts = products.filter((product) => isActiveProduct(product, companyId))
  const cleanCashRegister = sanitizeCashRegister(cashRegister, companyId)
  const selectedInvoices = validInvoices.filter((invoice) => inRange(invoice.issuedAt || invoice.createdAt || invoice.issueDate || invoice.updatedAt, range))
  const selectedExpenses = validExpenses.filter((expense) => inRange(expense.date || expense.createdAt || expense.updatedAt, range))
  const selectedCredits = validCreditNotes.filter((note) => inRange(note.createdAt || note.updatedAt, range))
  const selectedMovements = inventoryMovements.filter((movement) => isActiveInventoryMovement(movement, validProducts, validInvoices, companyId) && inRange(movement.createdAt || movement.date, range))
  const openReceivables = receivables.filter((item) => isActiveReceivable(item, validInvoices, companyId))
  const payables = [...validExpenses, ...purchases].filter((item) => ['pending', 'pendiente', 'open', 'credito', 'crédito'].includes(String(item.status || item.paymentStatus || '').toLowerCase()))
  const inventoryValue = validProducts.reduce((sum, product) => sum + Number(product.stock || 0) * Number(product.cost || 0), 0)
  const receivablesValue = openReceivables.reduce((sum, item) => sum + Number(item.balance || 0), 0)
  const payablesValue = payables.reduce((sum, item) => sum + Number(item.balance || item.amount || item.total || 0), 0)
  const selectedSales = sum(selectedInvoices, (invoice) => invoice.totals?.total)
  const selectedCost = sum(selectedInvoices, (invoice) => invoice.totals?.cost)
  const selectedExpenseTotal = sum(selectedExpenses, (expense) => expense.amount || expense.total)
  const selectedCreditTotal = sum(selectedCredits, (note) => note.totals?.total)
  const paymentRows = groupPayments(selectedInvoices, selectedCredits)
  const periodRows = ['day', 'week', 'month', 'year'].map((period) => periodSummary(period, validInvoices, validExpenses))
  const lowStock = (inventoryReports.lowStock?.length || inventoryReports.outOfStock?.length ? [...(inventoryReports.lowStock || []), ...(inventoryReports.outOfStock || [])] : validProducts.filter((product) => Number(product.stock || 0) <= Number(product.stockMin || 0))).slice(0, 60)
  const topProducts = buildTopProductRows(validInvoices)
  const slowProducts = validProducts.filter((product) => !topProducts.some((item) => item.id === product.id)).slice(0, 50)

  return [
    page('balance', 'Balance general actual', 'Balance', 'Activos, pasivos y patrimonio segun registros activos.', [
      metric('Activos', money(Number(cleanCashRegister.expected || 0) + receivablesValue + inventoryValue), 'Caja + CxC + inventario'),
      metric('Pasivos', money(payablesValue), 'Cuentas por pagar registradas'),
      metric('Patrimonio registrado', money(Number(cleanCashRegister.expected || 0) + receivablesValue + inventoryValue - payablesValue)),
    ], ['Cuenta', 'Tipo', 'Valor'], [
      { Cuenta: 'Caja actual', Tipo: 'Activo', Valor: money(cleanCashRegister.expected || 0) },
      { Cuenta: 'Cuentas por cobrar', Tipo: 'Activo', Valor: money(receivablesValue) },
      { Cuenta: 'Inventario al costo', Tipo: 'Activo', Valor: money(inventoryValue) },
      { Cuenta: 'Cuentas por pagar', Tipo: 'Pasivo', Valor: money(payablesValue) },
    ]),
    page('income-periods', 'Ingresos por día, semana, mes y año', 'Ingresos', 'Ventas válidas separadas por periodo.', [
      ...periodRows.map((row) => metric(row.Periodo, row.Ingresos)),
    ], ['Periodo', 'Ingresos', 'Facturas', 'Ganancia'], periodRows),
    page('expense-periods', 'Gastos por día, semana, mes y año', 'Gastos', 'Gastos operativos separados por periodo.', [
      ...periodRows.map((row) => metric(row.Periodo, row.Gastos)),
    ], ['Periodo', 'Gastos', 'Ingresos', 'Ganancia'], periodRows),
    page('profit-loss', 'Pérdidas y ganancias', 'Resultados', 'Resultado neto del rango seleccionado.', [
      metric('Ingresos', money(selectedSales)),
      metric('Costos', money(selectedCost)),
      metric('Gastos', money(selectedExpenseTotal)),
      metric('Notas crédito', money(selectedCreditTotal)),
      metric('Ganancia neta', money(selectedSales - selectedCost - selectedExpenseTotal - selectedCreditTotal)),
    ], ['Concepto', 'Valor'], [
      { Concepto: 'Ventas brutas', Valor: money(selectedSales) },
      { Concepto: 'Costo de ventas', Valor: money(selectedCost) },
      { Concepto: 'Gastos operativos', Valor: money(selectedExpenseTotal) },
      { Concepto: 'Notas de crédito', Valor: money(selectedCreditTotal) },
      { Concepto: 'Ganancia neta', Valor: money(selectedSales - selectedCost - selectedExpenseTotal - selectedCreditTotal) },
    ]),
    page('receivables', 'Cuentas por cobrar', 'CxC', 'Balances abiertos de clientes.', [
      metric('Cuentas abiertas', openReceivables.length),
      metric('Balance total', money(receivablesValue)),
    ], ['Cliente', 'Factura', 'Balance', 'Vence', 'Estado'], openReceivables.map((item) => ({ Cliente: item.customerName, Factura: item.invoiceNumber || item.invoiceId, Balance: money(item.balance), Vence: item.dueDate || '', Estado: item.status || '' }))),
    page('payables', 'Cuentas por pagar', 'CxP', 'Compromisos pendientes con proveedores o gastos.', [
      metric('Pendientes', payables.length),
      metric('Balance total', money(payablesValue)),
    ], ['Proveedor', 'Referencia', 'Balance', 'Estado'], payables.map((item) => ({ Proveedor: item.supplierName || item.vendor || item.concept || 'Pendiente', Referencia: item.reference || item.id, Balance: money(item.balance || item.amount || item.total), Estado: item.status || item.paymentStatus || '' }))),
    page('low-stock', 'Inventario bajo', 'Inventario', 'Productos por debajo o cerca del mínimo.', [
      metric('Productos críticos', lowStock.length),
      metric('Valor al costo', money(lowStock.reduce((total, product) => total + Number(product.stock || 0) * Number(product.cost || 0), 0))),
    ], ['Producto', 'SKU', 'Stock', 'Mínimo', 'Costo', 'Valor'], lowStock.map((product) => ({ Producto: product.name, SKU: product.sku, Stock: product.stock, Mínimo: product.stockMin, Costo: money(product.cost), Valor: money(Number(product.stock || 0) * Number(product.cost || 0)) }))),
    page('last-invoices', 'Últimas facturas', 'Facturación', 'Documentos recientes emitidos.', [
      metric('Facturas del rango', selectedInvoices.length),
      metric('Total', money(selectedSales)),
    ], ['Fecha', 'Factura', 'Cliente', 'Pago', 'Total'], selectedInvoices.slice(0, 80).map((invoice) => ({ Fecha: formatDate(invoice.issuedAt || invoice.createdAt), Factura: invoice.number || invoice.ncf, Cliente: invoice.customerName, Pago: paymentLabel(invoice), Total: money(invoice.totals?.total) }))),
    page('cash-flow', 'Flujo de caja', 'Caja', 'Entradas, salidas y neto del periodo.', [
      metric('Entradas', money(selectedSales)),
      metric('Salidas', money(selectedExpenseTotal + selectedCreditTotal)),
      metric('Flujo neto', money(selectedSales - selectedExpenseTotal - selectedCreditTotal)),
    ], ['Tipo', 'Concepto', 'Entrada', 'Salida'], [
      { Tipo: 'Entrada', Concepto: 'Ventas', Entrada: money(selectedSales), Salida: money(0) },
      { Tipo: 'Salida', Concepto: 'Gastos', Entrada: money(0), Salida: money(selectedExpenseTotal) },
      { Tipo: 'Salida', Concepto: 'Notas de crédito', Entrada: money(0), Salida: money(selectedCreditTotal) },
    ]),
    page('payment-methods', 'Ventas por método de pago', 'Caja', 'Distribución de cobros por método.', [
      ...paymentRows.slice(0, 4).map((row) => metric(row.Método, row.Neto, `${row.Operaciones} operaciones`)),
    ], ['Método', 'Operaciones', 'Ventas', 'Devoluciones', 'Neto'], paymentRows),
    page('inventory-kardex', 'Kardex, movimientos e historial', 'Inventario', 'Entradas, salidas, ajustes, transferencias y mínimo.', [
      metric('Movimientos', selectedMovements.length),
      metric('Entradas', selectedMovements.filter((movement) => Number(movement.signedQuantity || 0) > 0).length),
      metric('Salidas', selectedMovements.filter((movement) => Number(movement.signedQuantity || 0) < 0).length),
    ], ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Antes', 'Después', 'Documento'], selectedMovements.map((movement) => ({ Fecha: formatDate(movement.createdAt || movement.date), Tipo: movement.type, Producto: movement.productName, Cantidad: movement.signedQuantity ?? movement.quantity, Antes: movement.quantityBefore, Después: movement.quantityAfter, Documento: movement.documentNumber || movement.reference }))),
    page('inventory-valuation', 'Costo promedio y productos', 'Inventario', 'Valor al costo, productos mas vendidos y productos sin movimiento reciente.', [
      metric('Valor inventario', money(inventoryValue)),
      metric('Productos activos', validProducts.length),
    ], ['Producto', 'SKU', 'Stock', 'Costo promedio', 'Valor inventario', 'Estado'], [
      ...topProducts.slice(0, 25).map((item) => ({ Producto: item.name, SKU: item.sku, Stock: item.quantity, 'Costo promedio': money(item.averageCost), 'Valor inventario': money(item.cost), Estado: 'Más vendido' })),
      ...slowProducts.slice(0, 25).map((item) => ({ Producto: item.name, SKU: item.sku, Stock: item.stock, 'Costo promedio': money(item.cost), 'Valor inventario': money(Number(item.stock || 0) * Number(item.cost || 0)), Estado: 'Lento' })),
    ]),
  ]
}

function sumLines(lines, key) {
  return lines.reduce((sum, line) => sum + Number(line[key] || 0), 0)
}

function page(id, title, group, description, metrics, columns, rows) {
  return { id, title, group, description, metrics, columns, rows }
}

function metric(label, value, detail = '') {
  return { label, value: String(value), detail }
}

function periodSummary(period, invoices, expenses) {
  const now = new Date()
  const bounds = periodBounds(period, now)
  const periodInvoices = invoices.filter((invoice) => inDateRange(invoice.issuedAt || invoice.createdAt || invoice.issueDate || invoice.updatedAt, bounds.start, bounds.end))
  const periodExpenses = expenses.filter((expense) => inDateRange(expense.date || expense.createdAt || expense.updatedAt, bounds.start, bounds.end))
  const ingresos = sum(periodInvoices, (invoice) => invoice.totals?.total)
  const costos = sum(periodInvoices, (invoice) => invoice.totals?.cost)
  const gastos = sum(periodExpenses, (expense) => expense.amount || expense.total)
  return { Periodo: bounds.label, Ingresos: money(ingresos), Gastos: money(gastos), Facturas: periodInvoices.length, Ganancia: money(ingresos - costos - gastos) }
}

function periodBounds(period, now) {
  const start = new Date(now)
  const end = new Date(now)
  if (period === 'day') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    return { label: 'Día', start, end }
  }
  if (period === 'week') {
    start.setDate(now.getDate() - ((now.getDay() || 7) - 1))
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    return { label: 'Semana', start, end }
  }
  if (period === 'year') {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(11, 31)
    end.setHours(23, 59, 59, 999)
    return { label: 'Año', start, end }
  }
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  end.setMonth(now.getMonth() + 1, 0)
  end.setHours(23, 59, 59, 999)
  return { label: 'Mes', start, end }
}

function groupPayments(invoices, creditNotes) {
  const rows = new Map()
  invoices.forEach((invoice) => {
    const payments = invoice.payments?.length ? invoice.payments : [{ method: invoice.paymentMethod || 'No especificado', amount: invoice.totals?.total || 0 }]
    payments.forEach((payment) => {
      const key = payment.method || 'No especificado'
      const current = rows.get(key) || { Método: key, Operaciones: 0, Ventas: 0, Devoluciones: 0, Neto: 0 }
      current.Operaciones += 1
      current.Ventas += Number(payment.amount || 0)
      rows.set(key, current)
    })
  })
  creditNotes.forEach((note) => {
    const payments = note.payments?.length ? note.payments : [{ method: 'Nota crédito', amount: note.totals?.total || 0 }]
    payments.forEach((payment) => {
      const key = payment.method || 'Nota crédito'
      const current = rows.get(key) || { Método: key, Operaciones: 0, Ventas: 0, Devoluciones: 0, Neto: 0 }
      current.Devoluciones += Number(payment.amount || 0)
      rows.set(key, current)
    })
  })
  return [...rows.values()].map((row) => ({ ...row, Neto: money(row.Ventas - row.Devoluciones), Ventas: money(row.Ventas), Devoluciones: money(row.Devoluciones) }))
}

function buildTopProductRows(invoices) {
  const rows = new Map()
  invoices.forEach((invoice) => (invoice.items || []).forEach((item) => {
    const key = item.productId || item.sku || item.name
    const current = rows.get(key) || { id: key, name: item.name || '', sku: item.sku || '', quantity: 0, cost: 0, revenue: 0 }
    const quantity = Number(item.quantity || 0)
    current.quantity += quantity
    current.cost += Number(item.cost || 0) * quantity
    current.revenue += Number(item.net || 0) + Number(item.tax || 0)
    current.averageCost = current.quantity ? current.cost / current.quantity : 0
    rows.set(key, current)
  }))
  return [...rows.values()].sort((a, b) => b.quantity - a.quantity)
}

function paymentLabel(invoice) {
  return (invoice.payments || []).map((payment) => payment.method).join(', ') || invoice.paymentMethod || 'N/A'
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + Number(getter(row) || 0), 0)
}

function money(value) {
  return currency.format(Number(value || 0))
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function inDateRange(value, start, end) {
  const time = parseDate(value).getTime()
  return time >= start.getTime() && time <= end.getTime()
}

const journalColumns = [
  { header: 'Fecha', cell: ({ row }) => formatDate(row.original.date) },
  { header: 'Asiento', accessorKey: 'number' },
  { header: 'Origen', cell: ({ row }) => <span>{row.original.source || row.original.movementType}<p className="text-xs text-white/35">{row.original.documentNumber || row.original.reference}</p></span> },
  { header: 'Cuenta', cell: ({ row }) => <span className="font-bold">{row.original.accountCode} {row.original.accountName}<p className="text-xs font-normal text-white/35">{row.original.accountType} · {row.original.normalBalance}</p></span> },
  { header: 'Descripcion', cell: ({ row }) => <span>{row.original.description}<p className="text-xs text-white/35">{row.original.customerName || row.original.paymentMethod || '-'}</p></span> },
  { header: 'Debito', cell: ({ row }) => currency.format(row.original.debit || 0) },
  { header: 'Credito', cell: ({ row }) => currency.format(row.original.credit || 0) },
  { header: 'Usuario', accessorKey: 'user' },
]

const ledgerColumns = [
  { header: 'Cuenta', cell: ({ row }) => <span className="font-bold">{row.original.accountCode} {row.original.accountName}</span> },
  { header: 'Debito', cell: ({ row }) => currency.format(row.original.debit || 0) },
  { header: 'Credito', cell: ({ row }) => currency.format(row.original.credit || 0) },
  { header: 'Balance', cell: ({ row }) => currency.format(row.original.balance || 0) },
  { header: 'Movimientos', cell: ({ row }) => row.original.lines?.length || 0 },
]

const analysisColumns = [
  { header: 'Cuenta', cell: ({ row }) => <span className="font-bold">{row.original.accountCode} {row.original.accountName}<p className="text-xs font-normal text-white/35">{row.original.accountDescription}</p></span> },
  { header: 'Tipo', accessorKey: 'accountType' },
  { header: 'Naturaleza', accessorKey: 'normalBalance' },
  { header: 'Mov.', accessorKey: 'movements' },
  { header: 'Debito', cell: ({ row }) => currency.format(row.original.debit || 0) },
  { header: 'Credito', cell: ({ row }) => currency.format(row.original.credit || 0) },
  { header: 'Balance', cell: ({ row }) => currency.format(row.original.balance || 0) },
  { header: 'Lectura', accessorKey: 'interpretation' },
]

const accountColumns = [
  { header: 'Codigo', accessorKey: 'code' },
  { header: 'Cuenta', accessorKey: 'name' },
  { header: 'Tipo', accessorKey: 'type' },
  { header: 'Naturaleza', accessorKey: 'normalBalance' },
  { header: 'Uso', accessorKey: 'description' },
]
