import { useEffect, useState } from 'react'
import ClientNameInput from './ClientNameInput.jsx'
import RequesterNameInput from './RequesterNameInput.jsx'
import PieceNameInput from './PieceNameInput.jsx'
import { contactKinds } from './RequestersScreen.jsx'
import { payableRequest } from './payablesApi.js'
import { documentDigits, maskClientDocument } from '../server/clientDocument.js'

// Informações do serviço of an offer not yet accepted: corrects the client, requester, buyer, piece, request date, requested
// deadline, quantity and label without creating the offer again (PUT /api/offers/:id). What goes printed on the proposal
// discards a generated one: the screen says so before saving.
const printed = ['cnpj', 'company', 'requester', 'buyer', 'service', 'labelNumber', 'deadline', 'quantity']
const formOf = (offer) => ({ cnpj: maskClientDocument(offer.cnpj || ''), company: offer.company || '', requester: offer.requester || '', buyer: offer.buyer || '', service: offer.service || '', requestedAt: String(offer.requestedAt || '').slice(0, 10), deadline: offer.deadline || '', quantity: String(offer.quantity ?? ''), labelNumber: offer.labelNumber || '', notes: offer.notes || '' })

export default function OfferInfoEditModal({ offer, onClose, onSaved }) {
  const [form, setForm] = useState(() => formOf(offer)), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [clients, setClients] = useState([]), [requesters, setRequesters] = useState([]), [buyers, setBuyers] = useState([]), [pieces, setPieces] = useState([])
  useEffect(() => {
    payableRequest('/clients').then((data) => setClients(data.items || [])).catch(() => {})
    payableRequest('/requesters').then((data) => setRequesters(data.items || [])).catch(() => {})
    payableRequest('/buyers').then((data) => setBuyers(data.items || [])).catch(() => {})
    payableRequest('/pieces').then((data) => setPieces(data.items || [])).catch(() => {})
  }, [])
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  // A document typed by hand also finds the registered client, filling the company while it is empty.
  const changeDocument = (value) => {
    const cnpj = maskClientDocument(value), client = clients.find((item) => documentDigits(item.document) === documentDigits(cnpj))
    setForm((current) => ({ ...current, cnpj, company: !current.company.trim() && client ? client.name : current.company }))
  }
  const client = documentDigits(form.cnpj) ? clients.find((item) => documentDigits(item.document) === documentDigits(form.cnpj)) : null
  const original = formOf(offer)
  const changesProposal = Boolean(offer.proposal) && printed.some((key) => (key === 'cnpj' ? documentDigits(form.cnpj) !== documentDigits(original.cnpj) : String(form[key]).trim() !== String(original[key]).trim()))
  const resized = offer.resources?.entryMode === 'piece' && Number(form.quantity) > 0 && Number(form.quantity) !== Number(offer.quantity)
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await payableRequest(`/offers/${offer.id}`, 'PUT', { ...form, quantity: Number(form.quantity) })
      await onSaved(result, { resized })
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <div className="modal-backdrop offer-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="offer-manual-modal" role="dialog" aria-modal="true" aria-labelledby="offer-info-edit-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="offer-modal-header"><div><span className="offers-kicker">{offer.code}</span><h2 id="offer-info-edit-title">Editar informações do serviço</h2><p>Corrija os dados da solicitação sem criar a oferta de novo.</p></div><button className="offer-modal-close" type="button" disabled={busy} onClick={onClose} aria-label="Fechar formulário">×</button></div>
      <form onSubmit={save}><fieldset className="offer-info-edit-fields" disabled={busy}><div className="offer-form-grid">
        <label>CNPJ/CPF *<input value={form.cnpj} onChange={(event) => changeDocument(event.target.value)} inputMode="numeric" placeholder="CNPJ ou CPF do cliente" required /></label>
        <label>Empresa *<ClientNameInput label="Empresa *" value={form.company} documentValue={form.cnpj} clients={clients} onChange={(value) => update('company', value)} onSelect={(chosen) => setForm((current) => ({ ...current, company: chosen.name, cnpj: maskClientDocument(chosen.document) }))} required /></label>
        <label>Solicitante<RequesterNameInput label="Solicitante" value={form.requester} client={client} requesters={requesters} onChange={(value) => update('requester', value)} /></label>
        <label>Comprador<RequesterNameInput label="Comprador" kind={contactKinds.buyers} who="quem compra o serviço" value={form.buyer} client={client} requesters={buyers} onChange={(value) => update('buyer', value)} /></label>
        <label>Peça/Serviço *<PieceNameInput label="Peça/Serviço *" value={form.service} onChange={(value) => update('service', value)} pieces={pieces} historyHint={false} required /></label>
        <label>Data da solicitação *<input type="date" value={form.requestedAt} onChange={(event) => update('requestedAt', event.target.value)} required /></label>
        <label>Prazo solicitado *<input type="date" value={form.deadline} onChange={(event) => update('deadline', event.target.value)} required /></label>
        <label>Quantidade *<input type="number" min="1" step="1" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} required /></label>
        <label>Número da etiqueta<input value={form.labelNumber} onChange={(event) => update('labelNumber', event.target.value)} placeholder="Opcional" /></label>
        {/* Observação interna (ofertas do site): não sai no PDF da proposta, então mudá-la não descarta a proposta. */}
        <label className="offer-form-field--full">Observação<textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Interna: não sai na proposta" /></label>
      </div></fieldset>
      {(changesProposal || resized) && <div className="offer-info-edit-notes" role="note">
        {changesProposal && <p><strong>A proposta já gerada será descartada.</strong> Estes dados vão impressos na proposta: ao salvar, a oferta volta para "Em análise" e a proposta é gerada de novo com os dados corrigidos. As opções de preço salvas continuam.</p>}
        {resized && <p>Os materiais e tempos lançados por peça serão recalculados para {Number(form.quantity)} {Number(form.quantity) === 1 ? 'peça' : 'peças'}.</p>}
      </div>}
      {error && <p className="workflow-error" role="alert">{error}</p>}
      <div className="offer-modal-actions"><button className="offer-modal-cancel" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="manual-offer-button" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></div></form>
    </section>
  </div>
}
