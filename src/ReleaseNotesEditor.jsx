import { useEffect, useId, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { dateLabel, payableRequest } from './payablesApi.js'
import './payables.css'

export default function ReleaseNotesEditor({ onClose }) {
  const id = useId()
  const [items, setItems] = useState(null)
  const [version, setVersion] = useState('')
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    payableRequest('/release-notes').then(({ items }) => {
      if (!active) return
      if (!items?.length) throw new Error('Não foi possível carregar as notas de atualização.')
      setItems(items)
      setVersion(items[0].version)
    }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [])

  const selected = items?.find((item) => item.version === version)
  const original = selected?.notes.join('\n') ?? ''
  const text = drafts[version] ?? original
  const canSave = selected && text.trim() && text !== original && !saving

  async function save(event) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const { item } = await payableRequest(`/developer/release-notes/${encodeURIComponent(version)}`, 'PUT', { notes: text, previousNotes: selected.notes })
      setItems((current) => current.map((release) => release.version === item.version ? item : release))
      setDrafts((current) => ({ ...current, [item.version]: undefined }))
      setMessage(`Nota da versão ${item.version} salva.`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return <PayableModal title="Editar notas de atualização" busy={saving} onClose={onClose} footer={<>
    <button type="button" className="admin-tool-button" disabled={saving} onClick={onClose}>Fechar</button>
    <button type="submit" form={id} className="admin-tool-button admin-tool-button--primary" disabled={!canSave}>{saving ? 'Salvando...' : 'Salvar nota'}</button>
  </>}>
    {!items && !error && <p role="status">Carregando notas de atualização...</p>}
    {selected && <form id={id} className="payable-form" onSubmit={save}>
      <fieldset disabled={saving}>
        <label>Versão<select value={version} onChange={(event) => { setVersion(event.target.value); setMessage(''); setError('') }}>
          {items.map((item, index) => <option key={item.version} value={item.version}>{item.version}{index === 0 ? ' (atual)' : ''} · {dateLabel(item.date)}</option>)}
        </select></label>
        <label>Texto da nota<textarea rows={10} required maxLength={20000} value={text} aria-describedby={`${id}-hint`} onChange={(event) => { const value = event.target.value; setDrafts((current) => ({ ...current, [version]: value })); setMessage('') }} /></label>
      </fieldset>
      <p id={`${id}-hint`}>Escreva um item por linha.</p>
    </form>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </PayableModal>
}
