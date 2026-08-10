export function DatePicker({ label, value, onChange, required = false, error, id, name }) {
  const fieldId = id || name || `date-${String(label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <label className="block" htmlFor={fieldId}>
      {label ? <span className="mb-1 block text-xs font-bold uppercase text-white/45">{label}{required ? ' *' : ''}</span> : null}
      <input
        id={fieldId}
        name={name || fieldId}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-lg border bg-black/20 px-3 py-2.5 text-sm outline-none transition ${error ? 'border-red-400/70' : 'border-white/10 focus:border-blue-400/60'}`}
      />
      {error ? <span className="mt-1 block text-xs text-red-300">{error}</span> : null}
    </label>
  )
}
