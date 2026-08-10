export function downloadCsv(filename, rows = []) {
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = normalizeCsvFilename(filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function downloadCsvWorkbook(filename, sheets = []) {
  const sections = sheets
    .filter((sheet) => sheet?.rows?.length)
    .map((sheet) => [`# ${sheet.name || 'Hoja'}`, rowsToCsv(sheet.rows)].join('\n'))
  downloadText(filename, sections.join('\n\n'), 'text/csv;charset=utf-8')
}

function rowsToCsv(rows = []) {
  const columns = [...rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key))
    return set
  }, new Set())]
  if (!columns.length) return ''
  return [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(row?.[column])).join(',')),
  ].join('\n')
}

function downloadText(filename, content, type) {
  const blob = new Blob([content || ''], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = normalizeCsvFilename(filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function normalizeCsvFilename(filename) {
  return String(filename || 'export.csv').replace(/\.xlsx$/i, '.csv').replace(/\.csv$/i, '') + '.csv'
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
