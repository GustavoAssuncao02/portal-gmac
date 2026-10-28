import { useEffect, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'

const when = (at) => at ? new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }) : '—'
const cpfLabel = (cpf) => String(cpf || '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
const kindLabel = { email: 'Esqueci minha senha', admin: 'Cadastro', self: 'Configurações' }

// Who changed which password and when: the resets by e-mail code (also the requests that did not finish), the passwords
// set by an administrator and the ones changed by the user.
export default function PasswordHistoryModal({ onClose }) {
  const [items, setItems] = useState(null), [error, setError] = useState('')
  useEffect(() => { payableRequest('/password-resets').then((result) => setItems(result.items)).catch((caught) => setError(caught.message)) }, [])
  return <PayableModal title="Histórico de senhas" wide onClose={onClose}>
    <p className="payable-muted">Redefinições pelo "Esqueci minha senha" (inclusive os pedidos que não terminaram), senhas trocadas por um administrador no cadastro e pelo próprio usuário em Configurações. Horário da Bahia.</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!items ? !error && <p>Carregando...</p> : !items.length ? <p>Nenhuma alteração de senha registrada.</p> : <div className="payable-table-scroll"><table className="payable-table"><thead><tr><th>Pedido em</th><th>Conta</th><th>CPF</th><th>E-mail</th><th>Origem</th><th>Situação</th><th>Senha alterada em</th><th>IP</th></tr></thead><tbody>
      {items.map((row) => <tr key={row.id}><td data-label="Pedido em">{when(row.at)}</td><td data-label="Conta">{row.name || '—'}</td><td data-label="CPF">{cpfLabel(row.cpf)}</td><td data-label="E-mail">{row.email || '—'}</td><td data-label="Origem">{kindLabel[row.kind] || row.kind}</td><td data-label="Situação">{row.done ? <strong>{row.status}</strong> : row.status}</td><td data-label="Senha alterada em">{row.done ? when(row.completedAt) : '—'}</td><td data-label="IP">{row.ip || '—'}</td></tr>)}
    </tbody></table></div>}
  </PayableModal>
}
