export const ENTRY_NUMBER_PATTERN = /^ENT-\d{4}-(\d+)$/

export function entryNumberYear(number) {
  const match = ENTRY_NUMBER_PATTERN.exec(String(number || ''))
  return match ? match[1] : ''
}

export function entryNumberSeq(number) {
  const match = ENTRY_NUMBER_PATTERN.exec(String(number || ''))
  return match ? Number(match[1]) : 0
}

export function nextEntryNumber(entries, dateText = '') {
  const year = String(dateText || '').slice(0, 4) || String(new Date().getFullYear())
  const maxNumber = (entries || []).reduce((max, entry) => Math.max(max, entryNumberSeq(entry.number)), 0)
  return `ENT-${year}-${String(maxNumber + 1).padStart(4, '0')}`
}
