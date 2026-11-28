import { useEffect, useState } from 'react'
import ClientNameInput from './ClientNameInput.jsx'
import RequesterNameInput, { RequesterListInput } from './RequesterNameInput.jsx'
import { offerRequesterNames, requesterSeparator } from '../server/offerRequesters.js'
import PieceNameInput from './PieceNameInput.jsx'
import { contactKinds } from './RequestersScreen.jsx'
import { payableRequest } from './payablesApi.js'
import { documentDigits, maskClientDocument } from '../server/clientDocument.js'
import { QuantityUnitSelect } from './OfferQuantityModal.jsx'
import { quantityUnitOf } from '../server/quantityUnits.js'
import { ProposalDeadlineField } from './ProposalDeadline.jsx'
import { requestDay } from '../server/retroactiveEntry.js'
import { contractModelFor, contractOf, contractTitles } from '../server/contractTables.js'

// Informações do serviço of an offer not yet accepted: corrects the client, requester, buyer, piece, request date, requested
// deadline, quantity and label without creating the offer again (PUT /api/offers/:id). What goes printed on the proposal
// discards a generated one: the screen says so before saving.
const printed = ['cnpj', 'company', 'requester', 'buyer', 'service', 'labelNumber', 'deadline', 'quantity', 'quantityUnit']
const formOf = (offer) => ({ proposalDeadline: offer.proposalDeadline || '', cnpj: maskClientDocument(offer.cnpj || ''), company: offer.company || '', requesters: offerRequesterNames(offer).length ? offerRequesterNames(offer) : [''], buyer: offer.buyer || '', service: offer.service || '', requestedAt: requestDay(offer.requestedAt), deadline: offer.deadline || '', quantity: offer.quantityPending ? '' : String(offer.quantity ?? ''), quantityPending: Boolean(offer.quantityPending), quantityUnit: quantityUnitOf(offer.quantityUnit), labelNumber: offer.labelNumber || '', notes: offer.notes || '' })

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
  // Several requesters go printed joined by ", ", as the server saves them.
  const printedValue = (values, key) => (key === 'requester' ? values.requesters.map((name) => name.trim()).filter(Boolean).join(requesterSeparator) : String(values[key]).trim())
  const changesProposal = Boolean(offer.proposal) && printed.some((key) => (key === 'cnpj' ? documentDigits(form.cnpj) !== documentDigits(original.cnpj) : printedValue(form, key) !== printedValue(original, key)))
  // Nestlé and etiquetas of the Belgo (server/contractTables.js): another sheet (or none) clears the stages and materials
  // chosen for the previous one. Offers from before the sheets keep the normal flow.
  const nextSheet = contractModelFor({ cnpj: form.cnpj, labelNumber: form.labelNumber })
  const sheetChange = offer.contract !== undefined && nextSheet !== contractOf(offer)
  const sheetClears = sheetChange && Boolean(offer.resources?.stages?.length || offer.resources?.materials?.length)
  const resized = !form.quantityPending && offer.resources?.entryMode === 'piece' && Number(form.quantity) > 0 && Number(form.quantity) !== Number(offer.quantity)
  // "Sem quantidade definida" can be chosen (or kept) only while the offer has no proposal yet.
  const canLeavePending = Boolean(offer.quantityPending) || (!offer.proposal && !offer.proposalDraft)
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await payableRequest(`/offers/${offer.id}`, 'PUT', { ...form, quantity: form.quantityPending ? null : Number(form.quantity) })
      await onSaved(result, { resized })
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <div className="modal-backdrop offer-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="offer-manual-modal" role="dialog" aria-modal="true" aria-labelledby="offer-info-edit-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="offer-modal-header"><div><span className="offers-kicker">{offer.code}</span><h2 id="offer-info-edit-title">Editar informações do serviço</h2><p>Corrija os dados da solicitação sem criar a oferta de novo.</p></div><button className="offer-modal-close" type="button" disabled={busy} onClick={onClose} aria-label="Fechar formulário">×</button></div>
      <form onSubmit={save}><fieldset className="offer-info-edit-fields" disabled={busy}><div className="offer-form-grid">
        <label>CNPJ/CPF *<input value={form.cnpj} onChange={(event) => changeDocument(event.target.value)} inputMode="numeric" placeholder="CNPJ ou CPF do cliente" required /></label>
        <label>Empresa *<ClientNameInput label="Empresa *" value={form.company} documentValue={form.cnpj} clients={clients} onChange={(value) => update('company', value)} onSelect={(chosen) => setForm((current) => ({ ...current, company: chosen.name, cnpj: maskClientDocument(chosen.document) }))} required /></label>
        <RequesterListInput values={form.requesters} client={client} requesters={requesters} onChange={(value) => update('requesters', value)} />
        <label>Comprador<RequesterNameInput label="Comprador" kind={contactKinds.buyers} who="quem compra o serviço" value={form.buyer} client={client} requesters={buyers} onChange={(value) => update('buyer', value)} /></label>
        <label>Peça/Serviço *<PieceNameInput label="Peça/Serviço *" value={form.service} onChange={(value) => update('service', value)} pieces={pieces} historyHint={false} required upperCase /></label>
        <label>Data da solicitação *<input type="date" value={form.requestedAt} onChange={(event) => update('requestedAt', event.target.value)} required /></label>
        {/* Optional until the proposal PDF, which asks for it; after the PDF it can be changed but not left empty. */}
        <label>{offer.proposal ? 'Prazo solicitado *' : 'Prazo solicitado'}<input type="date" value={form.deadline} onChange={(event) => update('deadline', event.target.value)} required={Boolean(offer.proposal)} /></label>
        <div className="offer-quantity-cell">
          <div className="offer-quantity-row">
            <label>{form.quantityPending ? 'Quantidade' : 'Quantidade *'}<input type="number" min="1" step="1" value={form.quantityPending ? '' : form.quantity} onChange={(event) => update('quantity', event.target.value)} disabled={form.quantityPending} placeholder={form.quantityPending ? 'A definir' : undefined} required={!form.quantityPending} /></label>
            <label>Medida<QuantityUnitSelect value={form.quantityUnit} onChange={(value) => update('quantityUnit', value)} /></label>
          </div>
          {canLeavePending && <label className="offer-quantity-pending"><input type="checkbox" checked={form.quantityPending} onChange={(event) => update('quantityPending', event.target.checked)} />Sem quantidade definida</label>}
        </div>
        <label>Número da etiqueta<input value={form.labelNumber} onChange={(event) => update('labelNumber', event.target.value)} placeholder="Opcional" /></label>
        {/* Prazo para enviar a proposta (TCK-0012): not printed, it never discards the proposal. */}
        <ProposalDeadlineField value={form.proposalDeadline} requestedDay={form.requestedAt} onChange={(value) => update('proposalDeadline', value)} />
        {/* Observação interna (ofertas do site): não sai no PDF da proposta, então mudá-la não descarta a proposta. */}
        <label className="offer-form-field--full">Observação<textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Interna: não sai na proposta" /></label>
      </div></fieldset>
      {(changesProposal || resized || sheetChange) && <div className="offer-info-edit-notes" role="note">
        {sheetChange && <p><strong>{nextSheet ? `A oferta passa a usar a planilha ${contractTitles[nextSheet]}.` : 'A oferta deixa de usar a planilha do cliente e segue o fluxo normal.'}</strong>{sheetClears ? ' Ao salvar, as etapas e os materiais já escolhidos serão limpos para serem escolhidos de novo.' : ''}</p>}
        {changesProposal && <p><strong>A proposta já gerada será descartada.</strong> Estes dados vão impressos na proposta: ao salvar, a oferta volta para "Em análise" e a proposta é gerada de novo com os dados corrigidos. As opções de preço salvas continuam.</p>}
        {resized && <p>Os materiais e tempos lançados por peça serão recalculados para {Number(form.quantity)} {Number(form.quantity) === 1 ? 'peça' : 'peças'}.</p>}
      </div>}
      {error && <p className="workflow-error" role="alert">{error}</p>}
      <div className="offer-modal-actions"><button className="offer-modal-cancel" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="manual-offer-button" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></div></form>
    </section>
  </div>
}
