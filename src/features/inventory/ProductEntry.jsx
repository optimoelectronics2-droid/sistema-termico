import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../hooks/useToast'
import { useERPStore } from '../../store/useERPStore'
import { todayIso } from '../../lib/dateTime'
import { nextEntryNumber } from '../../lib/entryNumber'
import { EntryForm } from './EntryForm'
import { EntryHistory } from './EntryHistory'
import { EntryDetailModal } from './EntryDetailModal'
import { EntryReports } from './EntryReports'
import { EntryLabelPrinter } from './EntryLabelPrinter'

export function ProductEntry() {
  const toast = useToast()
  const entries = useERPStore((state) => state.productEntries)
  const receiveProducts = useERPStore((state) => state.receiveProducts)
  const updateProductEntry = useERPStore((state) => state.updateProductEntry)
  const deleteProductEntry = useERPStore((state) => state.deleteProductEntry)

  const [editingId, setEditingId] = useState('')
  const [detail, setDetail] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [labelEntry, setLabelEntry] = useState(null)
  const [showReport, setShowReport] = useState(false)

  const editingEntry = useMemo(() => entries.find((entry) => entry.id === editingId) || null, [entries, editingId])
  const nextNumber = useMemo(() => editingEntry ? editingEntry.number : nextEntryNumber(entries, todayIso()), [entries, editingEntry])

  function handleSubmit(payload) {
    try {
      if (editingId) {
        updateProductEntry(editingId, payload)
        toast.success('Entrada actualizada y stock recalculado correctamente.')
      } else {
        receiveProducts(payload)
        toast.success('Entrada registrada correctamente.')
      }
      setEditingId('')
    } catch (error) {
      toast.error(error.message)
    }
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId('')
  }

  function confirmDeleteEntry() {
    try {
      deleteProductEntry(deleteTarget.id, 'Eliminacion confirmada desde entradas')
      toast.success('Entrada eliminada y stock revertido.')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <div className="space-y-10">
      <EntryForm key={editingId || 'nuevo'} editingEntry={editingEntry} nextNumber={nextNumber} onSubmit={handleSubmit} onCancelEdit={cancelEdit} />

      <EntryHistory
        entries={entries}
        showReport={showReport}
        onToggleReport={() => setShowReport((open) => !open)}
        onView={setDetail}
        onLabels={setLabelEntry}
        onEdit={startEdit}
        onDelete={setDeleteTarget}
      />

      {showReport ? <section className="section-divider" /> : null}
      {showReport ? <EntryReports /> : null}

      <EntryDetailModal entry={detail} onClose={() => setDetail(null)} />

      <Modal open={Boolean(labelEntry)} onClose={() => setLabelEntry(null)} title={`Etiquetas de entrada · ${labelEntry?.supplierName || ''}`} size="xl">
        {labelEntry ? <EntryLabelPrinter entry={labelEntry} onClose={() => setLabelEntry(null)} /> : null}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Eliminar entrada ${deleteTarget?.number ? `· ${deleteTarget.number}` : ''}`}
        size="md"
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button variant="danger" icon={Trash2} onClick={confirmDeleteEntry}>Eliminar y revertir stock</Button></div>}
      >
        <p className="text-sm text-white/70">Esta accion reversa el stock recibido en la entrada seleccionada y deja registro de auditoria. No se puede completar si algun serial ya fue vendido.</p>
      </Modal>
    </div>
  )
}
