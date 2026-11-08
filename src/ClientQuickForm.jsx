import { useId, useState } from 'react'
import { Save } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'

// Created over the receivable form (or the invoice import) so what was typed is kept while the client is registered.
// `initial` brings the name and CPF/CNPJ read from an invoice.
export default function ClientQuickForm({ initial = {}, onClose, onCreated }) {
  const formId = useId(), [draft, setDraft] = useState({ name: initial.name || '', document: String(initial.document || '').replace(/\D/g, ''), email: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (![11, 14].includes(draft.document.length)) throw new Error('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).')
      const result = await payableRequest('/clients', 'POST', { ...draft, documentType: draft.document.length === 14 ? 'cnpj' : 'cpf' })
      await onCreated(result.item)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Novo cliente" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}><Save size={16} />Salvar cliente</button></>}>
    <form id={formId} className="payable-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Nome / razão social<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>CPF/CNPJ<input required inputMode="numeric" maxLength={18} value={draft.document} onChange={(event) => setDraft({ ...draft, document: event.target.value.replace(/\D/g, '') })} /></label>
      <label>E-mail<input type="email" maxLength={160} value={draft.email} placeholder="Opcional" onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
