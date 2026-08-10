import { motion } from 'framer-motion'

export function MetricCard({ label, value, detail, miniStats = [], icon: Icon, accent = 'blue', actionLabel = '', onAction, onOpen, openLabel = 'Abrir modulo' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`group relative overflow-hidden rounded-xl p-4 transition-all duration-300 ${onOpen ? 'cursor-pointer' : ''}`}
      style={{ background: 'var(--bg-surface)', border: `1px solid color-mix(in srgb, var(--${accent}) 40%, var(--line))`, boxShadow: '0 10px 30px rgba(0,0,0,.18)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
          <p className="mt-1.5 truncate text-2xl font-black tracking-tight" style={{ color: `color-mix(in srgb, var(--${accent}-bright) 60%, white)` }}>{value}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{detail}</p>
          {miniStats.length ? (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {miniStats.slice(0, 4).map((stat) => (
                <div key={stat.label} className="pt-1.5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <p className="truncate text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{stat.label}</p>
                  <p className="truncate text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{stat.value}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpen ? (
              <span className="rounded-md border px-2.5 py-1.5 text-[11px] font-bold tracking-wide transition-all duration-200 group-hover:scale-105" style={{ borderColor: `color-mix(in srgb, var(--${accent}) 22%, var(--line))`, color: `color-mix(in srgb, var(--${accent}) 80%, white)`, background: `color-mix(in srgb, var(--${accent}) 8%, transparent)` }}>
                {openLabel}
              </span>
            ) : null}
            {actionLabel && onAction ? <button type="button" onClick={(event) => { event.stopPropagation(); onAction() }} className="rounded-md border border-white/10 bg-white/[0.045] px-2.5 py-1.5 text-[11px] font-bold text-white/70 transition hover:bg-white/[0.09] hover:text-white">{actionLabel}</button> : null}
          </div>
        </div>
        <div className="relative shrink-0 rounded-xl p-2.5 transition-all duration-300 group-hover:scale-110" style={{ background: `color-mix(in srgb, var(--${accent}) 18%, var(--bg-elevated))`, boxShadow: `0 0 16px color-mix(in srgb, var(--${accent}) 22%, transparent)` }}>
          <Icon size={20} style={{ color: `var(--${accent}-bright)` }} />
        </div>
      </div>
    </motion.div>
  )
}
