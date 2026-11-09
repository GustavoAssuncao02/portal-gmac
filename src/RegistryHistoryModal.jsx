import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { documentLabel } from './RegistryList.jsx'
import './payables.css'

// Cadastros: the "i" next to the trash can opens who created, changed or deleted the registration and when, with each
// field before and after (server/registryHistory.js). Same look as the history of Contas a Pagar.
const typeLabels = { created: 'Cadastro criado', edited: 'Cadastro alterado', deleted: 'Cadastro excluído' }
const fieldLabels = { name: 'Nome', email: 'E-mail', document: 'CPF/CNPJ', documentType: 'Tipo de documento', notes: 'Observação', cpf: 'CPF', birthDate: 'Nascimento', agency: 'Agência', account: 'Conta', client: 'Cliente', phone: 'Telefone' }
const nameLabels = { clients: 'Nome / razão social', suppliers: 'Nome / razão social', banks: 'Banco', sectors: 'Nome do setor', pauseReasons: 'Razão da pausa' }
const phoneLabel = (digits) => digits.length === 11 ? digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
function valueLabel(field, value) {
  if (!value) return '—'
  if (field === 'birthDate') return value.split('-').reverse().join('/')
  if (field === 'documentType') return value.toUpperCase()
  if (field === 'document' || field === 'cpf') return documentLabel(value)
  if (field === 'phone') return phoneLabel(value)
  return value
}
const when = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

export function RegistryInfoButton({ name, onClick }) {
  return <button className="payable-icon" type="button" title="Histórico de alterações" aria-label={`Ver histórico de alterações de ${name}`} onClick={onClick}><Info size={16} /></button>
}

export default function RegistryHistoryModal({ registry, record, onClose }) {
  const [items, setItems] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    payableRequest(`/registry-history/${registry}/${encodeURIComponent(record.id)}`).then((result) => { if (active) setItems(result.items) }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [registry, record.id])
  const label = (field) => field === 'name' ? nameLabels[registry] || fieldLabels.name : fieldLabels[field] || field
  const line = (event, change) => change.field === 'password' ? 'Senha alterada'
    : event.type === 'created' ? `${label(change.field)}: ${valueLabel(change.field, change.after)}`
      : `${label(change.field)}: ${valueLabel(change.field, change.before)} → ${valueLabel(change.field, change.after)}`
  const created = items?.some((event) => event.type === 'created')
  return <PayableModal title={`Histórico · ${record.name}`} wide onClose={onClose} footer={<button className="admin-tool-button admin-tool-button--primary" type="button" onClick={onClose}>Fechar</button>}>
    {error ? <p className="admin-tool-error" role="alert">{error}</p> : !items ? <p>Carregando histórico...</p> : <>
      <ol className="payable-history">{items.map((event) => <li key={event.id}>
        <div><strong>{typeLabels[event.type] || event.type}</strong></div>
        <small>{when(event.at)} · {event.userName}</small>
        {event.changes.filter((change) => change.field === 'password' || change.before || change.after).map((change) => <p key={change.field}>{line(event, change)}</p>)}
        {event.note && <p className="registry-history-note">{event.note}</p>}
      </li>)}{!items.length && <li>Nenhuma alteração registrada.</li>}</ol>
      {!created && <p className="payable-hint registry-history-before">{record.createdAt ? `Cadastrado em ${new Date(record.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })}, antes do histórico de alterações: quem cadastrou e as alterações anteriores não foram registradas.` : 'As alterações feitas antes do histórico de alterações não foram registradas.'}</p>}
    </>}
  </PayableModal>
}
