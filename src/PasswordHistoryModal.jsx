import { useEffect, useState } from 'react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { SortableRows, SortHeader } from './RegistryList.jsx'

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
    {!items ? !error && <p>Carregando...</p> : !items.length ? <p>Nenhuma alteração de senha registrada.</p> : <div className="payable-table-scroll"><SortableRows rows={items} columns={[{ key: "Pedido em", label: "Pedido em", value: (row) => row.at, numeric: true }, { key: "Conta", label: "Conta", value: (row) => row.name }, { key: "CPF", label: "CPF", value: (row) => row.cpf }, { key: "E-mail", label: "E-mail", value: (row) => row.email }, { key: "Origem", label: "Origem", value: (row) => kindLabel[row.kind] || row.kind }, { key: "Situação", label: "Situação", value: (row) => row.status }, { key: "Senha alterada em", label: "Senha alterada em", value: (row) => row.done ? row.completedAt : null, numeric: true }, { key: "IP", label: "IP", value: (row) => row.ip }]}>{(sorted) => <table className="payable-table"><thead><tr><SortHeader column={sorted.columns[0]} list={sorted} /><SortHeader column={sorted.columns[1]} list={sorted} /><SortHeader column={sorted.columns[2]} list={sorted} /><SortHeader column={sorted.columns[3]} list={sorted} /><SortHeader column={sorted.columns[4]} list={sorted} /><SortHeader column={sorted.columns[5]} list={sorted} /><SortHeader column={sorted.columns[6]} list={sorted} /><SortHeader column={sorted.columns[7]} list={sorted} /></tr></thead><tbody>
      {sorted.rows.map((row) => <tr key={row.id}><td data-label="Pedido em">{when(row.at)}</td><td data-label="Conta">{row.name || '—'}</td><td data-label="CPF">{cpfLabel(row.cpf)}</td><td data-label="E-mail">{row.email || '—'}</td><td data-label="Origem">{kindLabel[row.kind] || row.kind}</td><td data-label="Situação">{row.done ? <strong>{row.status}</strong> : row.status}</td><td data-label="Senha alterada em">{row.done ? when(row.completedAt) : '—'}</td><td data-label="IP">{row.ip || '—'}</td></tr>)}
    </tbody></table>}</SortableRows></div>}
  </PayableModal>
}
