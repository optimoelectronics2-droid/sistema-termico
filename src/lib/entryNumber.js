export const ENTRY_NUMBER_PATTERN = /^ENT-(\d{4})-(\d+)$/

export function entryNumberYear(number) {
  const match = ENTRY_NUMBER_PATTERN.exec(String(number || ''))
  return match ? match[1] : ''
}

export function entryNumberSeq(number) {
  const match = ENTRY_NUMBER_PATTERN.exec(String(number || ''))
  return match ? Number(match[2]) : 0
}

export function nextEntryNumber(entries, dateText = '', counterNext = 0) {
  const year = String(dateText || '').slice(0, 4) || String(new Date().getFullYear())
  const maxNumber = (entries || [])
    .filter((entry) => entryNumberYear(entry.number) === year)
    .reduce((max, entry) => Math.max(max, entryNumberSeq(entry.number)), 0)
  const next = Math.max(maxNumber + 1, Number(counterNext) || 1)
  return `ENT-${year}-${String(next).padStart(4, '0')}`
}
