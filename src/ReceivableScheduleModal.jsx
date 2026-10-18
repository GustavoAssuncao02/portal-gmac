import { useEffect, useId, useState } from 'react'
import { CalendarClock, Check, CircleCheck } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, decimal, dateLabel, payableRequest } from './payablesApi.js'
import MoneyInput from './MoneyInput.jsx'
import { InstallmentFields, withInstallments, installmentPayload } from './ReceivableInstallments.jsx'
import { todayBahia, cents, settlementMethods } from '../server/payableRules.js'
import './payables.css'

// A quiet line under the amount field: more than the value of the OS is interest, less is discount.
const differenceNote = (orderCents, difference) => difference ? <small className="payable-hint receivable-difference">{difference > 0 ? 'Juros' : 'Desconto'} de <strong>{money(Math.abs(difference))}</strong> sobre o valor da OS ({money(orderCents)}).</small> : null

// Shown when an admin confirms a finished OS. The amount is either still to be received (scheduled in Contas a
// Receber, single or in installments) or already received (posted to Tesouraria, settled); then the service is archived.
export default function ReceivableScheduleModal({ orderCode, onClose, onAcknowledge }) {
  const formId = useId(), today = todayBahia()
  const [info, setInfo] = useState(null), [mode, setMode] = useState(null), [draft, setDraft] = useState({ value: '', dueDate: '', description: '', kind: 'single', count: 2, installments: [], date: today, method: 'pix' }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then((result) => { if (!active) return; setInfo(result); setDraft((current) => ({ ...current, value: decimal(result.order.valueCents), description: `${result.order.code} · ${result.order.service || 'Serviço'}` })) }).catch((caught) => { if (active) setLoadError(caught.message) })
    return () => { active = false }
  }, [orderCode])
  const change = (key, value) => { const next = { ...draft, [key]: value }; setDraft(['value', 'dueDate', 'kind'].includes(key) ? withInstallments(next) : next) }
  const received = mode === 'received', installment = !received && draft.kind === 'installment'
  // What was received can differ from the value of the OS: the difference is interest (more) or discount (less).
  const receivedCents = (() => { try { return cents(draft.value || '0') } catch { return 0 } })(), difference = info ? receivedCents - info.order.valueCents : 0
  useEffect(() => { setError('') }, [draft, mode])
  async function finish(post) {
    setBusy(true); setError('')
    let created = false
    try {
      if (post && !info.item) {
        if (received && draft.date > today) throw new Error('O recebimento não pode ter data futura.')
        if (installment && draft.installments.reduce((sum, row) => sum + cents(row.value || '0'), 0) !== cents(draft.value)) throw new Error('A soma das parcelas deve ser exatamente igual ao valor total.')
        await payableRequest('/receivables', 'POST', received ? { orderCode, treasury: true, value: decimal(info.order.valueCents), received: draft.value, date: draft.date, method: draft.method, description: draft.description } : { orderCode, ...draft, ...installmentPayload(draft) }); created = true
      }
      await onAcknowledge(orderCode)
      onClose()
    } catch (caught) {
      setError(created ? `${caught.message} O lançamento financeiro foi criado e mantido; clique em Concluir serviço para tentar novamente.` : caught.message)
      payableRequest(`/receivables/order/${encodeURIComponent(orderCode)}`).then(setInfo).catch(() => {})
    } finally { setBusy(false) }
  }
  const existing = info?.items?.length ? info.items : info?.item ? [info.item] : []
  const scheduled = !existing.length ? null : existing.length > 1 ? <>Recebimento já programado em <strong>{existing.length} parcelas</strong> ({existing[0].id} a {existing.at(-1).id}) · {money(existing[0].originalTotalCents || existing.reduce((sum, row) => sum + row.valueCents, 0))} · de {dateLabel(existing[0].dueDate)} a {dateLabel(existing.at(-1).dueDate)}.</>
    : existing[0].receipt ? <>Recebimento já registrado: <strong>{existing[0].id}</strong> · {money(existing[0].receipt.finalCents)} · recebido em {dateLabel(existing[0].receipt.date)}.</>
      : <>Recebimento já programado: <strong>{existing[0].id}</strong> · {money(existing[0].valueCents)} · previsto para {dateLabel(existing[0].dueDate)}.</>
  return <PayableModal title="Recebimento do serviço" wide={installment} busy={busy} onClose={onClose} footer={(info || loadError) && <>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button>
    {scheduled || !info ? <button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => finish(false)}><Check size={16} />{scheduled ? 'Concluir serviço' : 'Concluir sem lançar'}</button> : <>
      <button type="button" className="admin-tool-button" disabled={busy} onClick={() => finish(false)}>Concluir sem lançar</button>
      {mode && <button type="submit" form={formId} className="admin-tool-button admin-tool-button--primary" disabled={busy}>{received ? <CircleCheck size={16} /> : <CalendarClock size={16} />}{busy ? 'Salvando...' : received ? 'Registrar e concluir' : 'Programar e concluir'}</button>}
    </>}
  </>}>
    {loadError && !info && <p className="bank-warning bank-warning--warning">Não foi possível carregar os dados financeiros desta OS ({loadError}). O serviço ainda pode ser concluído sem lançar o recebimento.</p>}
    {!info ? !loadError && <p>Carregando OS...</p> : <>
      <dl className="payable-facts receivable-order-facts">{[['OS', info.order.code], ['Cliente', info.order.company || '—'], ['Serviço', info.order.service || '—'], ['Valor da OS', info.order.discount ? `${money(info.order.valueCents)} (${money(info.order.serviceCents)} com ${String(info.order.discount).replace('.', ',')}% de desconto)` : money(info.order.valueCents)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {scheduled ? <p className="receivable-origin">{scheduled}</p> : <>
        <p className="finance-choice-question" id={`${formId}-question`}>O cliente já pagou este serviço?</p>
        <div className="finance-choice finance-choice--pair" role="group" aria-labelledby={`${formId}-question`}>
          <button type="button" aria-pressed={mode === 'schedule'} disabled={busy} onClick={() => setMode('schedule')}><CalendarClock size={20} aria-hidden="true" /><span><strong>Ainda vai receber</strong><small>Programa o recebimento em Contas a Receber, à vista ou parcelado.</small></span></button>
          <button type="button" aria-pressed={received} disabled={busy} onClick={() => setMode('received')}><CircleCheck size={20} aria-hidden="true" /><span><strong>Já recebido</strong><small>Registra a entrada na Tesouraria, já baixada.</small></span></button>
        </div>
        {mode && <form id={formId} className="payable-form receivable-schedule-form" onSubmit={(event) => { event.preventDefault(); finish(true) }}><fieldset disabled={busy}>
          {received ? <>
            <label>Valor recebido<MoneyInput aria-label="Valor recebido" required positive value={draft.value} onChange={(value) => change('value', value)} />{differenceNote(info.order.valueCents, difference) || <small className="payable-hint">Se for diferente de {money(info.order.valueCents)}, a diferença é registrada como juros ou desconto.</small>}</label>
            <label>Data do recebimento<input type="date" aria-label="Data do recebimento" required max={today} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
            <label>Forma de recebimento<select aria-label="Forma de recebimento" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{Object.entries(settlementMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </> : <>
            <fieldset className="payable-type"><legend>Tipo do recebimento</legend>{[['single', 'Parcela única'], ['installment', 'Recebimento parcelado']].map(([key, label]) => <label className="payable-radio" key={key}><input name={`${formId}-kind`} type="radio" checked={draft.kind === key} onChange={() => change('kind', key)} />{label}</label>)}</fieldset>
            <label>{installment ? 'Valor total a receber' : 'Valor a receber'}<MoneyInput aria-label={installment ? 'Valor total a receber' : 'Valor a receber'} required positive value={draft.value} onChange={(value) => change('value', value)} />{differenceNote(info.order.valueCents, difference)}</label>
            <label>{installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'}<input type="date" aria-label={installment ? 'Data da 1ª parcela' : 'Data prevista de recebimento'} required min={today} value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label>
            {installment && <InstallmentFields draft={draft} setDraft={setDraft} minDate={today} />}
          </>}
          <label>Descrição<input maxLength={5000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        </fieldset></form>}
      </>}
    </>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
