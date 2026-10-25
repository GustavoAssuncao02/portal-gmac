import { useId, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { declineReasons, osValueOf } from '../server/proposalMath.js'
import { formatQuantity } from '../server/materialUnits.js'

// The customer said no to the proposal sent. The offer is closed as declined and the option counts in its acceptance rate.
export default function DeclineProposalModal({ offer, onConfirm, onClose }) {
  const formId = useId(), [reason, setReason] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await onConfirm({ reason: reason || null, note }); onClose() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Tem certeza que deseja recusar a oferta?" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="submit" form={formId} disabled={busy}>Sim, recusar</button></>}>
    <form id={formId} className="payable-form" onSubmit={submit}><fieldset disabled={busy}>
      <p><strong>{offer.code} · {offer.service} · Proposta {offer.proposal?.key}</strong></p>
      <p>O cliente recusou esta proposta. A oferta vai para "Recusadas" e não poderá gerar uma OS enquanto estiver recusada. A recusa entra na taxa de aceite da opção {offer.proposal?.key}. Se for um engano, dá para desfazer depois.</p>
      <label>Motivo (opcional)<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Não informado</option>{declineReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Observação (opcional)<textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

// Confirmation to undo a decline registered by mistake: the offer goes back to "Proposta gerada".
export function UndoDeclineModal({ offer, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Tem certeza que deseja desfazer a recusa?" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={confirm}>Sim, desfazer</button></>}>
    <p><strong>{offer.code} · {offer.service} · Proposta {offer.proposalDecline?.key || offer.proposal?.key}</strong></p>
    <p>A oferta volta para "Proposta gerada" e poderá ser aceita ou recusada de novo. A recusa deixa de contar na taxa de aceite{offer.proposalDecline?.reason ? ` (motivo registrado: ${offer.proposalDecline.reason})` : ''}.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Accepting creates the OS right away and takes its material out of the stock, so it is confirmed first.
export function AcceptOfferModal({ offer, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const materials = (offer.resources?.materials || []).filter((material) => Number(material.quantity) > 0)
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Tem certeza que deseja aceitar a oferta?" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={confirm}>{busy ? 'Aceitando...' : 'Sim, aceitar e gerar a OS'}</button></>}>
    <p><strong>{offer.code} · {offer.service}</strong></p>
    <dl className="offer-decision-facts"><div><dt>Opção</dt><dd>Proposta {offer.proposal?.key}</dd></div><div><dt>Valor da OS</dt><dd>{brl(osValueOf(offer.proposal))}</dd></div><div><dt>Quantidade</dt><dd>{offer.quantity} un</dd></div></dl>
    <p>A OS será gerada agora e aparecerá para os operadores.{materials.length ? ' O material disponível sai do estoque neste momento:' : ''}</p>
    {materials.length > 0 && <ul className="offer-decision-list">{materials.map((material) => <li key={material.id}>{material.name}{material.detail ? ` (${material.detail})` : ''}: {formatQuantity(material.quantity, material.unit)}</li>)}</ul>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

// Undoes an acceptance made by mistake, while nothing happened in the OS: the material goes back to the stock.
export function UndoAcceptModal({ offer, orderCode, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title="Tem certeza que deseja desfazer o aceite?" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="button" disabled={busy} onClick={confirm}>{busy ? 'Desfazendo...' : 'Sim, desfazer o aceite'}</button></>}>
    <p><strong>{offer?.code ? `${offer.code} · ` : ''}{orderCode}</strong></p>
    <ul className="offer-decision-list">
      <li>O material que saiu do estoque para a {orderCode} volta para o estoque.</li>
      <li>Os pedidos de compra abertos por essa OS deixam de valer.</li>
      <li>A oferta volta para "Proposta gerada" e pode ser aceita de novo ou recusada.</li>
      <li>A OS não é apagada: fica registrada como cancelada, e o número {orderCode} não será usado de novo.</li>
    </ul>
    <p className="payable-muted">Só é possível enquanto nada aconteceu na OS: nenhum trabalho iniciado, nenhuma peça registrada, nenhum material de compra recebido e nenhuma conta a pagar ou a receber ligada a ela.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
