import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function Autocomplete({
  value,
  items,
  getLabel = (item) => item.name,
  getMeta,
  getSearchText,
  onSelect,
  placeholder = 'Buscar...',
  emptyText = 'Sin resultados',
  startText = 'Escriba para buscar',
  minQueryLength = 0,
  disabled = false,
  name = 'autocomplete-search',
  id = name,
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [menuRect, setMenuRect] = useState(null)
  const inputRef = useRef(null)
  const blurTimerRef = useRef(null)
  const deferredQuery = useDeferredValue(query)
  const selectedLabel = value ? getLabel(value) : ''
  const filtered = useMemo(() => {
    const term = normalize(deferredQuery)
    if (term.length < minQueryLength) return []
    if (!term) return []
    return items.map((item) => {
      const searchText = getSearchText ? getSearchText(item) : `${getLabel(item)} ${getMeta?.(item) || ''}`
      return { item, score: scoreText(searchText, term) }
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 12).map((entry) => entry.item)
  }, [deferredQuery, getLabel, getMeta, getSearchText, items, minQueryLength])

  useLayoutEffect(() => {
    if (!focused || !inputRef.current) return undefined
    const updatePosition = () => {
      const rect = inputRef.current.getBoundingClientRect()
      const menuHeight = Math.min(288, window.innerHeight - 16)
      const openUp = rect.bottom + 320 > window.innerHeight && rect.top > 320
      const left = Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - rect.width - 8, 8))
      setMenuRect({
        top: openUp ? Math.max(rect.top - 8 - menuHeight, 8) : rect.bottom + 8,
        left,
        width: rect.width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [focused])

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current)
    }
  }, [])

  function closeMenu() {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    setFocused(false)
    setQuery('')
  }

  return (
    <div className="relative">
      <input
        id={id}
        ref={inputRef}
        name={name}
        disabled={disabled}
        value={focused ? query : selectedLabel}
        onFocus={() => {
          if (blurTimerRef.current) {
            window.clearTimeout(blurTimerRef.current)
            blurTimerRef.current = null
          }
          setFocused(true)
          setQuery('')
        }}
        onBlur={() => {
          if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current)
          blurTimerRef.current = window.setTimeout(closeMenu, 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeMenu()
            event.currentTarget.blur()
          }
        }}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400/60 disabled:opacity-50"
       autoComplete="off" />
      {focused ? createPortal(
        <div className="fixed z-[35] max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#111118] p-1 shadow-2xl shadow-black/60" style={{ ...menuRect, maxWidth: 'min(92vw, 480px)' }}>
          {deferredQuery.trim().length < minQueryLength ? (
            <p className="px-3 py-2 text-sm text-white/45">{startText}</p>
          ) : filtered.length ? (
            filtered.map((item, index) => (
              <button
                key={item.id ? `${item.id}-${index}` : `${getLabel(item)}-${index}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(item)
                  closeMenu()
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]"
              >
                <p className="font-bold text-white">{getLabel(item)}</p>
                {getMeta ? <p className="text-xs text-white/45">{getMeta(item)}</p> : null}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-white/45">{emptyText}</p>
          )}
        </div>,
        document.body
      ) : null}
    </div>
  )
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function scoreText(value, query) {
  const text = normalize(value)
  if (!text) return 0
  if (text === query) return 100
  if (text.startsWith(query)) return 70
  if (text.includes(query)) return 45
  if (query.split(/\s+/).every((part) => text.includes(part))) return 25
  return 0
}
