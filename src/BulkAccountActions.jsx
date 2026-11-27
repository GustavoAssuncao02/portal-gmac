import { useEffect, useId, useState } from 'react'
import { Trash2, Undo2, Tags } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import ClassificationSelect from './ClassificationSelect.jsx'
import { money, payableRequest } from './payablesApi.js'

// Ações em massa of Contas a Pagar and Contas a Receber (server/bulkAccounts.js): the server previews what will happen and
// which accounts cannot take the action and why; the user confirms with a checkbox and the confirmation carries the token
// of that preview. When anything changed in between, nothing is saved and the modal shows the new preview.
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
const texts = {
  delete: { title: 'Excluir lançamentos', lead: (n) => `Você vai excluir ${plural(n, 'lançamento', 'lançamentos')}.`, blocked: (n) => `${plural(n, 'lançamento não pode ser excluído', 'lançamentos não podem ser excluídos')}:`, confirm: (n) => `Confirmo a exclusão de ${plural(n, 'lançamento', 'lançamentos')}. Os dados ficam guardados no histórico.`, button: (n) => `Excluir ${plural(n, 'lançamento', 'lançamentos')}` },
  reverse: { title: 'Desfazer baixa', lead: (n) => `Você vai desfazer a baixa de ${plural(n, 'conta', 'contas')}. O valor volta a ficar em aberto.`, blocked: (n) => `${plural(n, 'conta não pode', 'contas não podem')} ter a baixa desfeita:`, confirm: (n) => `Confirmo desfazer a baixa de ${plural(n, 'conta', 'contas')}.`, button: (n) => `Desfazer ${plural(n, 'baixa', 'baixas')}` },
  classify: { title: 'Alterar classificação', lead: (n) => `Você vai alterar a classificação de ${plural(n, 'conta', 'contas')}.`, blocked: (n) => `${plural(n, 'conta não pode ser alterada', 'contas não podem ser alteradas')}:`, confirm: (n) => `Confirmo a alteração da classificação de ${plural(n, 'conta', 'contas')}.`, button: (n) => `Alterar ${plural(n, 'conta', 'contas')}` },
}

// Buttons of the bar of selected accounts.
export function BulkActionButtons({ disabled, onChoose }) {
  return <>
    <button className="admin-tool-button" disabled={disabled} onClick={() => onChoose('delete')}><Trash2 size={15} />Excluir</button>
    <button className="admin-tool-button" disabled={disabled} onClick={() => onChoose('reverse')}><Undo2 size={15} />Desfazer baixa</button>
    <button className="admin-tool-button" disabled={disabled} onClick={() => onChoose('classify')}><Tags size={15} />Alterar classificação</button>
  </>
}

export default function BulkActionModal({ type, action, ids, classifications = [], onClose, onDone }) {
  const formId = useId(), text = texts[action]
  const [classificationId, setClassificationId] = useState('')
  const [preview, setPreview] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false)
  const route = type === 'payable' ? '/payables/bulk' : '/receivables/bulk'
  const target = action === 'classify' ? { classificationId } : {}
  useEffect(() => {
    let active = true
    setPreview(null); setConfirmed(false); setNotice('')
    if (action === 'classify' && !classificationId) return undefined
    setLoading(true); setError('')
    payableRequest(route, 'POST', { action, ids, preview: true, ...target }).then((result) => { if (active) setPreview(result.preview) }).catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [classificationId])
  const count = preview?.count || 0
  const ready = Boolean(preview) && count > 0 && confirmed && !busy && (action !== 'reverse' || reason.trim().length >= 10)
  const amounts = !preview ? [] : type === 'payable' ? [[action === 'reverse' ? 'Valor que volta a ficar em aberto' : 'Valor total', preview.amounts.totalCents]] : [['Valor bruto total', preview.amounts.grossCents], ['ISS total', preview.amounts.issCents], ['Valor líquido total', preview.amounts.netCents]]
  async function submit(event) {
    event.preventDefault()
    if (!ready) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await payableRequest(route, 'POST', { action, ids, token: preview.token, ...target, ...(action === 'reverse' ? { reason } : {}) })
      await onDone(result.count)
    } catch (caught) {
      // Someone changed the accounts after the preview: nothing was saved; the new preview asks for a new confirmation.
      if (caught.data?.code === 'BULK_CHANGED') { setPreview(caught.data.preview); setConfirmed(false); setNotice(caught.message) } else setError(caught.message)
      setBusy(false)
    }
  }
  return <PayableModal title={text.title} busy={busy} onClose={onClose} className="bulk-action-modal" footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" form={formId} className={`admin-tool-button admin-tool-button--primary${action === 'delete' ? ' admin-tool-button--danger' : ''}`} disabled={!ready}>{busy ? 'Salvando...' : text.button(count)}</button></>}>
    <form id={formId} className="bulk-action" onSubmit={submit}>
      {action === 'classify' && <label>Nova classificação<ClassificationSelect classifications={classifications} use={type} value={classificationId} onChange={setClassificationId} label="Nova classificação" disabled={busy} /></label>}
      {loading && <p role="status">Preparando a prévia...</p>}
      {preview && <>
        <p className="bulk-action-lead">{count ? text.lead(count) : 'Nenhuma das contas selecionadas pode receber esta ação.'}</p>
        {count > 0 && <dl className="bulk-action-amounts">{amounts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>}
        {count > 0 && preview.facts.length > 0 && <ul className="bulk-action-facts">{preview.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>}
        {preview.blocked.length > 0 && <section className="bulk-action-blocked" aria-label="Contas que ficam como estão"><h3>⚠ {text.blocked(preview.blocked.length)}</h3><ul>{preview.blocked.map((item) => <li key={item.id}><strong>{item.id}</strong> · {item.name} · {money(item.valueCents)} · {item.reason}</li>)}</ul></section>}
        {action === 'reverse' && count > 0 && <label>Motivo<textarea required minLength={10} maxLength={1000} rows={3} value={reason} disabled={busy} onChange={(change) => setReason(change.target.value)} placeholder="Pelo menos 10 caracteres; vale para todas as contas" /></label>}
        {count > 0 && <label className="bulk-action-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(change) => setConfirmed(change.target.checked)} />{text.confirm(count)}</label>}
      </>}
      {notice && <p className="bulk-action-notice" role="status">{notice}</p>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </form>
  </PayableModal>
}
