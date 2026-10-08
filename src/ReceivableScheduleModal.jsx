import { useEffect, useId, useState } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, decimal, dateLabel, payableRequest } from './payablesApi.js'
import MoneyInput from './MoneyInput.jsx'
import { InstallmentFields, withInstallments, installmentPayload } from './ReceivableInstallments.jsx'
import { todayBahia, cents } from '../server/payableRules.js'
import './payables.css'

// Shown when an admin confirms a finished OS: it schedules the receivable (single or in installments), then archives the service.
export default function ReceivableScheduleModal({ orderCode, onClose, onAcknowledge }) {
  const formId = useId(), today = todayBahia()
  const [info, setInfo] = useState(null), [draft, setDraft] = useState({ value: '', dueDate: '', description: '', kind: 'single', count: 2, installments: [] }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then((result) => { if (!active) return; setInfo(result); setDraft((current) => ({ ...current, value: decimal(result.order.valueCents), description: `${result.order.code} · ${result.order.service || 'Serviço'}` })) }).catch((caught) => { if (active) setLoadError(caught.message) })
    return () => { active = false }
  }, [orderCode])
  const change = (key, value) => { const next = { ...draft, [key]: value }; setDraft(['value', 'dueDate', 'kind'].includes(key) ? withInstallments(next) : next) }
  const installment = draft.kind === 'installment'
  useEffect(() => { setError('') }, [draft])
  async function finish(schedule) {
    setBusy(true); setError('')
    let created = false
    try {
      if (schedule && !info.item) {
        if (installment && draft.installments.reduce((sum, row) => sum + cents(row.value || '0'), 0) !== cents(draft.value)) throw new Error('A soma das parcelas deve ser exatamente igual ao valor total.')
        await payableRequest('/receivables', 'POST', { orderCode, ...draft, ...installmentPayload(draft) }); created = true
      }
      await onAcknowledge(orderCode)
      onClose()
    } catch (caught) {
      setError(created ? `${caught.message} A conta a receber foi criada e mantida; clique em Concluir serviço para tentar novamente.` : caught.message)
      payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then(setInfo).catch(() => {})
    } finally { setBusy(false) }
  }
  const existing = info?.items?.length ? info.items : info?.item ? [info.item] : []
  const scheduled = existing.length ? existing.length > 1 ? <>Recebimento já programado em <strong>{existing.length} parcelas</strong> ({existing[0].id} a {existing.at(-1).id}) · {money(existing[0].originalTotalCents || existing.reduce((sum, row) => sum + row.valueCents, 0))} · de {dateLabel(existing[0].dueDate)} a {dateLabel(existing.at(-1).dueDate)}.</> : <>Recebimento já programado: <strong>{existing[0].id}</strong> · {money(existing[0].valueCents)} · previsto para {dateLabel(existing[0].dueDate)}.</> : null
  return <PayableModal title="Programar recebimento" wide={installment} busy={busy} onClose={onClose} footer={(info || loadError) && <>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button>
    {scheduled || !info ? <button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => finish(false)}><Check size={16} />{scheduled ? 'Concluir serviço' : 'Concluir sem programar'}</button> : <>
      <button type="button" className="admin-tool-button" disabled={busy} onClick={() => finish(false)}>Concluir sem programar</button>
      <button type="submit" form={formId} className="admin-tool-button admin-tool-button--primary" disabled={busy}><CalendarClock size={16} />{busy ? 'Salvando...' : 'Programar e concluir'}</button>
    </>}
  </>}>
    {loadError && !info && <p className="bank-warning bank-warning--warning">Não foi possível carregar os dados financeiros desta OS ({loadError}). O serviço ainda pode ser concluído sem programar o recebimento.</p>}
    {!info ? !loadError && <p>Carregando OS...</p> : <>
      <dl className="payable-facts receivable-order-facts">{[['OS', info.order.code], ['Cliente', info.order.company || '—'], ['Serviço', info.order.service || '—'], ['Valor da OS', info.order.discount ? `${money(info.order.valueCents)} (${money(info.order.serviceCents)} com ${String(info.order.discount).replace('.', ',')}% de desconto)` : money(info.order.valueCents)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {scheduled ? <p className="receivable-origin">{scheduled}</p> : <form id={formId} className="payable-form" onSubmit={(event) => { event.preventDefault(); finish(true) }}><fieldset disabled={busy}>
        <fieldset className="payable-type"><legend>Tipo do recebimento</legend>{[['single', 'Parcela única'], ['installment', 'Recebimento parcelado']].map(([key, label]) => <label className="payable-radio" key={key}><input name={`${formId}-kind`} type="radio" checked={draft.kind === key} onChange={() => change('kind', key)} />{label}</label>)}</fieldset>
        <label>{installment ? 'Valor total a receber' : 'Valor a receber'}<MoneyInput aria-label={installment ? 'Valor total a receber' : 'Valor a receber'} required positive value={draft.value} onChange={(value) => change('value', value)} /></label>
        <label>{installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'}<input type="date" aria-label={installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'} required min={today} value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
        {installment && <InstallmentFields draft={draft} setDraft={setDraft} minDate={today} />}
        <label>Descrição<input maxLength={5000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      </fieldset></form>}
    </>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
