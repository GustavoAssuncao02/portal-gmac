import { useId, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { declineReasons, osValueOf } from '../server/proposalMath.js'
import { formatQuantity } from '../server/materialUnits.js'
import { labelQuoteOffer } from '../server/labelQuoteRules.js'
import { upper } from './displayCase.js'
import { quantityLabel } from '../server/quantityUnits.js'
import { retroactiveOrderDay } from '../server/retroactiveEntry.js'
import { uploadPurchaseOrders } from './purchaseOrders.js'

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
      <p><strong>{offer.code} · {upper(offer.service)} · Proposta {offer.proposal?.key}</strong></p>
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
    <p><strong>{offer.code} · {upper(offer.service)} · Proposta {offer.proposalDecline?.key || offer.proposal?.key}</strong></p>
    <p>A oferta volta para "Proposta gerada" e poderá ser aceita ou recusada de novo. A recusa deixa de contar na taxa de aceite{offer.proposalDecline?.reason ? ` (motivo registrado: ${offer.proposalDecline.reason})` : ''}.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

// TCK-0006: undoes a "Recusar" clicked by mistake (an offer refused before any proposal): it goes back to "Em análise".
export function UndoRejectModal({ offer, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function confirm() {
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const back = offer.origin === 'Site' && !offer.creationFinishedAt ? 'Criando oferta' : 'Em análise'
  return <PayableModal title={`Desfazer a recusa da ${offer.code}?`} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={confirm}>{busy ? 'Desfazendo...' : 'Sim, desfazer'}</button></>}>
    <p><strong>{offer.code} · {upper(offer.service)}</strong></p>
    <p>A oferta sai de "Recusadas" e volta para "{back}", com tudo o que já tinha: anexos, materiais, mão de obra e a proposta salva. A recusa desfeita fica registrada na oferta.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Accepting creates the OS right away and takes its material out of the stock, so it is confirmed first. It also asks
// for the client's documents: Nº do pedido de compra, Nota de entrada and their files (more than one, kept in "Anexos
// administrativos"). "Sim, aceitar e gerar a OS" needs both numbers; "Gerar OS com informações pendentes" keeps whatever
// was filled in and leaves the rest for Ver OS, where Serviços em andamento keeps pointing it out. The date of the OS is
// not asked: a retroactive offer opens its OS on its "Data da solicitação", the others on the day of the acceptance.
// onConfirm({ purchaseOrderNumber, entryInvoiceNumber }) accepts and returns the OS; onAccepted(order) refreshes and opens it.
export function AcceptOfferModal({ offer, onConfirm, onAccepted, onClose }) {
  const formId = useId(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [purchaseOrder, setPurchaseOrder] = useState(''), [entryInvoice, setEntryInvoice] = useState(''), [files, setFiles] = useState([]), [opened, setOpened] = useState(null)
  const materials = (offer.resources?.materials || []).filter((material) => Number(material.quantity) > 0)
  const retroDay = retroactiveOrderDay(offer)
  async function accept() {
    setBusy(true); setError('')
    try {
      const order = await onConfirm({ purchaseOrderNumber: purchaseOrder.trim(), entryInvoiceNumber: entryInvoice.trim() })
      if (files.length) {
        try { await uploadPurchaseOrders(order.code, files) } catch (caught) {
          // The OS exists: the files can be attached again in Ver OS.
          setOpened(order); setError(`A OS ${order.code} foi gerada, mas os anexos não foram enviados (${caught.message}). Anexe de novo em Ver OS › Anexos administrativos.`); return
        }
      }
      await onAccepted?.(order)
      onClose()
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const submit = (event) => { event.preventDefault(); accept() }
  const finish = async () => { await onAccepted?.(opened); onClose() }
  // An etiqueta opens its OS without proposal: the quote comes at the end, with what was really used.
  const label = labelQuoteOffer(offer)
  const pendingLabel = label ? 'Abrir OS com informações pendentes' : 'Gerar OS com informações pendentes'
  const footer = opened ? <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={finish}>Fechar</button>
    : <><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button" type="button" disabled={busy} title="Gera a OS com o que foi preenchido. O que faltar pode ser informado depois em Ver OS." onClick={accept}>{pendingLabel}</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy}>{busy ? (label ? 'Abrindo...' : 'Aceitando...') : label ? 'Sim, abrir a OS' : 'Sim, aceitar e gerar a OS'}</button></>
  return <PayableModal title={label ? 'Abrir a OS da etiqueta?' : 'Tem certeza que deseja aceitar a oferta?'} busy={busy} onClose={opened ? finish : onClose} footer={footer}>
    <p><strong>{offer.code} · {upper(offer.service)}</strong></p>
    {label ? <dl className="offer-decision-facts"><div><dt>Etiqueta</dt><dd>{offer.labelNumber}</dd></div><div><dt>Valor da OS</dt><dd>Orçamento pendente</dd></div><div><dt>Quantidade</dt><dd>{quantityLabel(offer.quantity, offer.quantityUnit, { short: true })}</dd></div></dl>
      : <dl className="offer-decision-facts"><div><dt>Opção</dt><dd>Proposta {offer.proposal?.key}</dd></div><div><dt>Valor da OS</dt><dd>{brl(osValueOf(offer.proposal))}</dd></div><div><dt>Quantidade</dt><dd>{quantityLabel(offer.quantity, offer.quantityUnit, { short: true })}</dd></div></dl>}
    <form id={formId} className="payable-form offer-accept-po" onSubmit={submit}><fieldset disabled={busy || Boolean(opened)}>
      <div className="offer-accept-po-row">
        <label>Nº do pedido de compra<input value={purchaseOrder} maxLength={80} onChange={(event) => setPurchaseOrder(event.target.value)} placeholder="Número enviado pelo cliente" required /></label>
        <label>Nota de entrada<input value={entryInvoice} maxLength={80} onChange={(event) => setEntryInvoice(event.target.value)} placeholder="Número da nota de entrada" required /></label>
      </div>
      <label>Anexos (opcional)<input type="file" multiple aria-label="Anexos do pedido de compra e da nota de entrada" onChange={(event) => setFiles([...event.target.files])} /></label>
      <p className="offer-accept-po-note">Os anexos vão para os Anexos administrativos da OS. Sem algum destes dados agora? Use “{pendingLabel}”: o que faltar pode ser informado depois em Ver OS.</p>
    </fieldset></form>
    {retroDay && <p className="offer-accept-date-note">Lançamento retroativo: a OS fica com a data da solicitação, {retroDay.split('-').reverse().join('/')}.</p>}
    {label && <p>A OS da etiqueta abre sem proposta, com a estimativa de material e horas. Quando os operadores concluírem todas as peças, o orçamento é gerado com as horas trabalhadas e o material realmente usado, no botão <strong>Aguardando NF-e</strong>.</p>}
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
