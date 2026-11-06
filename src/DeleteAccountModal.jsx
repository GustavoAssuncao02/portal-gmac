import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest, money, dateLabel } from './payablesApi.js'

// The red trash button of a row in the financial lists; it does not open the account.
export function DeleteRowButton({ id, onClick }) {
  return <button type="button" className="payable-icon payable-row-delete" title="Excluir lançamento" aria-label={`Excluir ${id}`} onClick={(event) => { event.stopPropagation(); onClick() }} onKeyDown={(event) => event.stopPropagation()}><Trash2 size={17} /></button>
}

// Asks before deleting an account. An installment plan or a recurring series asks whether only this account goes or
// the others too (paid ones always stay, the server keeps their history).
export default function DeleteAccountModal({ type, id, onClose, onDeleted }) {
  const base = type === 'receivable' ? '/receivables' : '/payables'
  const [info, setInfo] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [scope, setScope] = useState('one')
  useEffect(() => { let active = true; payableRequest(`${base}/${id}`).then((result) => { if (active) setInfo(result) }).catch((caught) => { if (active) setError(caught.message) }); return () => { active = false } }, [base, id])
  const row = info?.item, others = info?.deleteOthers || 0
  const plan = row?.groupId ? 'parcelamento' : row?.seriesId ? 'recorrência' : ''
  const name = row ? row.supplierName || row.customerName || '' : ''
  async function confirm() {
    setBusy(true); setError('')
    try { await payableRequest(`${base}/${id}?scope=${others ? scope : 'one'}`, 'DELETE'); await onDeleted() } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <PayableModal title="Excluir lançamento" busy={busy} onClose={onClose} className="delete-account-modal" footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button>{info?.canDelete && <button type="button" className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" disabled={busy} onClick={confirm}><Trash2 size={16} />{others && scope === 'all' ? `Excluir ${others + 1} lançamentos` : 'Excluir'}</button>}</>}>
    {!row ? !error && <p>Carregando...</p> : <>
      <p className="delete-account-summary"><strong>{row.id}</strong>{name && ` · ${name}`}<br />{row.description && <>{row.description}<br /></>}{money(row.valueCents)} · vencimento {dateLabel(row.dueDate)}{row.groupId && ` · parcela ${row.installmentNumber} de ${row.installmentCount}`}</p>
      {!info.canDelete ? <p className="admin-tool-error" role="alert">Este lançamento não pode ser excluído. {info.deleteBlock || 'Há histórico de baixa, vínculo ou conciliação a preservar.'}</p> : <>
        <p>Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita (os dados ficam guardados no histórico).</p>
        {others > 0 && <fieldset className="delete-account-scope"><legend>Este lançamento faz parte de {plan === 'parcelamento' ? 'um parcelamento' : 'uma recorrência'}. O que deseja excluir?</legend>
          <label><input type="radio" name="delete-scope" checked={scope === 'one'} onChange={() => setScope('one')} />Somente este lançamento</label>
          <label><input type="radio" name="delete-scope" checked={scope === 'all'} onChange={() => setScope('all')} />Este e os demais {others === 1 ? '1 lançamento' : `${others} lançamentos`} {plan === 'parcelamento' ? 'do parcelamento' : 'em aberto da recorrência'}</label>
        </fieldset>}
      </>}
    </>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
