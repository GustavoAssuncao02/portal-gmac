import { useEffect, useId, useState } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, decimal, dateLabel, payableRequest } from './payablesApi.js'
import './payables.css'

// Shown when an admin confirms a finished OS: it schedules the receivable, then archives the service.
export default function ReceivableScheduleModal({ orderCode, onClose, onAcknowledge }) {
  const formId = useId()
  const [info, setInfo] = useState(null), [draft, setDraft] = useState({ value: '', dueDate: '', description: '' }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then((result) => { if (!active) return; setInfo(result); setDraft({ value: decimal(result.order.valueCents), dueDate: '', description: `${result.order.code} · ${result.order.service || 'Serviço'}` }) }).catch((caught) => { if (active) setLoadError(caught.message) })
    return () => { active = false }
  }, [orderCode])
  async function finish(schedule) {
    setBusy(true); setError('')
    let created = false
    try {
      if (schedule && !info.item) { await payableRequest('/receivables', 'POST', { orderCode, ...draft }); created = true }
      await onAcknowledge(orderCode)
      onClose()
    } catch (caught) {
      setError(created ? `${caught.message} A conta a receber foi criada e mantida; clique em Concluir serviço para tentar novamente.` : caught.message)
      payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then(setInfo).catch(() => {})
    } finally { setBusy(false) }
  }
  const existing = info?.item
  return <PayableModal title="Programar recebimento" busy={busy} onClose={onClose} footer={(info || loadError) && <>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button>
    {existing || !info ? <button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => finish(false)}><Check size={16} />{existing ? 'Concluir serviço' : 'Concluir sem programar'}</button> : <>
      <button type="button" className="admin-tool-button" disabled={busy} onClick={() => finish(false)}>Concluir sem programar</button>
      <button type="submit" form={formId} className="admin-tool-button admin-tool-button--primary" disabled={busy}><CalendarClock size={16} />{busy ? 'Salvando...' : 'Programar e concluir'}</button>
    </>}
  </>}>
    {loadError && !info && <p className="bank-warning bank-warning--warning">Não foi possível carregar os dados financeiros desta OS ({loadError}). O serviço ainda pode ser concluído sem programar o recebimento.</p>}
    {!info ? !loadError && <p>Carregando OS...</p> : <>
      <dl className="payable-facts receivable-order-facts">{[['OS', info.order.code], ['Cliente', info.order.company || '—'], ['Serviço', info.order.service || '—'], ['Valor da OS', info.order.discount ? `${money(info.order.valueCents)} (${money(info.order.serviceCents)} com ${String(info.order.discount).replace('.', ',')}% de desconto)` : money(info.order.valueCents)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {existing ? <p className="receivable-origin">Recebimento já programado: <strong>{existing.id}</strong> · {money(existing.valueCents)} · previsto para {dateLabel(existing.dueDate)}.</p> : <form id={formId} className="payable-form" onSubmit={(event) => { event.preventDefault(); finish(true) }}><fieldset disabled={busy}>
        <label>Valor a receber<input type="number" step="0.01" min="0.01" required value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
        <label>Data prevista de recebimento<input type="date" required value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label>Descrição<input maxLength={5000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      </fieldset></form>}
    </>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
