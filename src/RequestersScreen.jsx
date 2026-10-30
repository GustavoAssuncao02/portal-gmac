import { useEffect, useId, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { RegistryToolbar, SortHeader, documentLabel, useRegistryList } from './RegistryList.jsx'
import { normalizeSearch } from './offerResources.js'
import { documentDigits, documentKind, maskClientDocument } from '../server/clientDocument.js'

// Cadastros > Solicitantes: who asks for the service on behalf of a client. Each requester belongs to one client (a client
// has many); name and client are required, CPF, e-mail and phone are optional. Same pattern as Clientes: the list on
// screen, adding and editing in a modal. Cadastros > Compradores (the client's buyers) is the same screen.
export const contactKinds = {
  requesters: { endpoint: '/requesters', title: 'Solicitantes', singular: 'solicitante', plural: 'solicitantes', Singular: 'Solicitante' },
  buyers: { endpoint: '/buyers', title: 'Compradores', singular: 'comprador', plural: 'compradores', Singular: 'Comprador' },
}
const cpfMask = (value) => String(value || '').replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const phoneLabel =(value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits && `(${digits}`
  return `(${digits.slice(0, 2)}) ${digits.length === 11 ? `${digits.slice(2, 7)}-${digits.slice(7)}` : digits.length > 6 ? `${digits.slice(2, 6)}-${digits.slice(6)}` : digits.slice(2)}`
}
const emptyForm = { name: '', clientId: '', clientName: '', cpf: '', email: '', phone: '' }

export default function RequestersScreen({ Sidebar, WorkspaceTabs, navigationProps, kind = contactKinds.requesters }) {
  const [items, setItems] = useState(null), [clients, setClients] = useState([]), [message, setMessage] = useState(''), [editing, setEditing] = useState(null), [removing, setRemoving] = useState(null)
  const load = () => payableRequest(kind.endpoint).then((result) => setItems(result.items))
  useEffect(() => {
    load().catch((caught) => setMessage(caught.message))
    payableRequest('/clients').then((result) => setClients(result.items || [])).catch(() => setClients([]))
  }, [])
  const columns = [
    { key: 'name', label: 'Nome', value: (row) => row.name, search: true },
    { key: 'client', label: 'Cliente', value: (row) => row.clientName, search: true },
    { key: 'cpf', label: 'CPF', value: (row) => row.cpf || '', search: true },
    { key: 'email', label: 'E-mail', value: (row) => row.email || '', search: true },
    { key: 'phone', label: 'Telefone', value: (row) => row.phone || '', search: true },
  ]
  const rows = items || []
  const list = useRegistryList(rows, columns, 'name')
  async function save(values) {
    await payableRequest(editing.id ? `${kind.endpoint}/${editing.id}` : kind.endpoint, editing.id ? 'PUT' : 'POST', values)
    await load()
    setMessage(`${kind.Singular} ${editing.id ? 'atualizado' : 'cadastrado'} com sucesso.`)
    setEditing(null)
  }
  async function remove() {
    await payableRequest(`${kind.endpoint}/${removing.id}`, 'DELETE')
    await load()
    setMessage(`${kind.Singular} excluído com sucesso.`)
    setRemoving(null)
  }
  return <AdminWorkspace Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={navigationProps} title={kind.title}>
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => { setMessage(''); setEditing({}) }}><Plus size={17} />Novo {kind.singular}</button></div>
    {message && <p className={`registration-message ${message.includes('sucesso') ? 'registration-message--success' : 'registration-message--error'}`} role="status">{message}</p>}
    <RegistryToolbar list={list} total={rows.length} singular={kind.singular} plural={kind.plural} placeholder="Nome, cliente, CPF, e-mail ou telefone" />
    <div className="payable-table-scroll"><table className="payable-table payable-registry-table registration-table registry-table registry-table--requester"><thead><tr>{columns.map((column) => <SortHeader key={column.key} column={column} list={list} className={`registry-col-${column.key}`} />)}<th className="registry-col-actions">Ações</th></tr></thead><tbody>
      {list.rows.map((row) => <tr key={row.id}>
        <td className="registry-name"><strong>{row.name}</strong></td>
        <td data-label="Cliente" className="registry-client">{row.clientName || <span className="registry-empty">Cliente excluído</span>}</td>
        <td data-label="CPF" className="registry-document">{row.cpf ? documentLabel(row.cpf) : <span className="registry-empty">—</span>}</td>
        <td data-label="E-mail">{row.email || <span className="registry-empty">—</span>}</td>
        <td data-label="Telefone">{row.phone ? phoneLabel(row.phone) : <span className="registry-empty">—</span>}</td>
        <td className="registry-actions"><div className="payable-registry-actions">
          <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${row.name}`} onClick={() => { setMessage(''); setEditing(row) }}><Pencil size={16} /></button>
          <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${row.name}`} onClick={() => { setMessage(''); setRemoving(row) }}><Trash2 size={16} /></button>
        </div></td>
      </tr>)}
      {items && !list.rows.length && <tr><td colSpan={columns.length + 1} className="payable-empty">{rows.length ? 'Nenhum cadastro encontrado para a busca.' : `Nenhum ${kind.singular} cadastrado.`}</td></tr>}
      {!items && !message && <tr><td colSpan={columns.length + 1} className="payable-empty">Carregando...</td></tr>}
    </tbody></table></div>
    {editing && <RequesterForm kind={kind} source={editing} clients={clients} onClose={() => setEditing(null)} onSave={save} />}
    {removing && <RemoveRequester kind={kind} requester={removing} onClose={() => setRemoving(null)} onConfirm={remove} />}
  </AdminWorkspace>
}

function RequesterForm({ kind, source, clients, onClose, onSave }) {
  const id = useId(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [values, setValues] = useState(() => ({ ...emptyForm, ...source, cpf: cpfMask(source.cpf), phone: phoneLabel(source.phone), email: source.email || '' }))
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }))
  async function submit(event) {
    event.preventDefault()
    if (!values.clientId) { setError('Selecione o cliente na lista. Para um cliente novo, cadastre-o antes em Cadastros › Clientes.'); return }
    setBusy(true); setError('')
    try { await onSave({ name: values.name, clientId: values.clientId, cpf: values.cpf, email: values.email, phone: values.phone }) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={`${source.id ? 'Editar' : 'Novo'} ${kind.singular}`} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}>Salvar</button></>}>
    <form id={id} className="payable-form registration-modal-form" onSubmit={submit}><fieldset disabled={busy}>
      <label>Nome *<input value={values.name} maxLength={160} onChange={(event) => update('name', event.target.value)} required autoFocus /></label>
      <label>Cliente *<ClientPicker clients={clients} text={values.clientName} selectedId={values.clientId} onText={(text) => setValues((current) => ({ ...current, clientName: text, clientId: '' }))} onSelect={(client) => setValues((current) => ({ ...current, clientName: client.name, clientId: String(client.id) }))} /></label>
      <label>CPF<input value={values.cpf} onChange={(event) => update('cpf', cpfMask(event.target.value))} inputMode="numeric" placeholder="Opcional · 000.000.000-00" /></label>
      <label>E-mail<input type="email" value={values.email} maxLength={160} onChange={(event) => update('email', event.target.value)} placeholder="Opcional" /></label>
      <label>Telefone<input type="tel" value={values.phone} onChange={(event) => update('phone', phoneLabel(event.target.value))} inputMode="numeric" placeholder="Opcional · (00) 00000-0000" /></label>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

// Only registered clients can be chosen: typing searches them by name or CPF/CNPJ, and changing the text clears the choice.
function ClientPicker({ clients, text, selectedId, onText, onSelect }) {
  const [open, setOpen] = useState(false), listId = useId(), hintId = useId()
  const query = normalizeSearch(text), digits = documentDigits(text)
  const matches = clients.filter((client) => !query || normalizeSearch(client.name).includes(query) || (digits.length >= 3 && documentDigits(client.document).includes(digits))).slice(0, 8)
  const selected = clients.find((client) => String(client.id) === selectedId)
  const choose = (client) => { onSelect(client); setOpen(false) }
  return <div className="material-autocomplete client-autocomplete">
    <div className="material-autocomplete-input">
      <input value={text} autoComplete="off" role="combobox" aria-label="Cliente" aria-describedby={hintId} aria-expanded={open} aria-controls={listId} required placeholder="Busque pelo nome ou CNPJ/CPF do cliente"
        onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.client-autocomplete')?.contains(event.relatedTarget)) setOpen(false) }}
        onChange={(event) => { onText(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) } if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => document.getElementById(listId)?.querySelector('button')?.focus()) } if (event.key === 'Enter' && open && !selectedId && matches.length === 1) { event.preventDefault(); choose(matches[0]) } }} />
      <span>⌄</span>
    </div>
    {open && <div className="material-suggestions" id={listId} role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      {matches.length > 0 ? matches.map((client) => <button type="button" role="option" aria-selected={selectedId === String(client.id)} key={client.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) } }}>
        <strong>{client.name}</strong><small>{documentKind(client.document)} {maskClientDocument(client.document)}</small></button>)
        : <div className="material-suggestion-empty"><strong>Nenhum cliente encontrado</strong><span>Cadastre o cliente em Cadastros › Clientes.</span></div>}
    </div>}
    <small className="piece-autocomplete-hint" id={hintId}>{selected ? `Vinculado a ${selected.name} · ${documentKind(selected.document)} ${maskClientDocument(selected.document)}` : 'Escolha um cliente cadastrado na lista.'}</small>
  </div>
}

function RemoveRequester({ kind, requester, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <PayableModal title={`Excluir ${kind.singular}`} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm() } catch (caught) { setError(caught.message) } finally { setBusy(false) } }}>Excluir</button></>}>
    <p>Excluir <strong>{requester.name}</strong>{requester.clientName ? <> ({requester.clientName})</> : null}?</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
