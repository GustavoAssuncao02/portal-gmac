import { useEffect, useId, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import PauseReasonsChart from './PauseReasonsChart.jsx'

// A registration made only of names (Setores, Razões de pausas): list, add, rename and delete in a modal, like Classificações.
// `countLabel`/`count` show how many records use each item, when the screen has that information; `fields` adds text
// fields after the name ([key, label, maxLength]), shown as columns too.
export default function SimpleRegistryScreen({ title, singular, article = 'o', endpoint, nameLabel, countLabel, count, fields = [], chart = false, Sidebar, WorkspaceTabs, navigationProps }) {
  const [items, setItems] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null), [removing, setRemoving] = useState(null), [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    payableRequest(endpoint).then((result) => { if (active) { setItems(result.items); setError('') } }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [endpoint, version])
  const refresh = () => setVersion((value) => value + 1)
  const New = article === 'a' ? 'Nova' : 'Novo'
  return <AdminWorkspace Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={navigationProps} title={title}>
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => setEditing({})}><Plus size={17} />{New} {singular}</button></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    <div className="payable-table-scroll"><table className="payable-table payable-registry-table simple-registry-table"><thead><tr><th>{nameLabel}</th>{fields.map(([key, label]) => <th key={key}>{label}</th>)}{countLabel && <th className="simple-registry-count">{countLabel}</th>}<th>Ações</th></tr></thead><tbody>
      {(items || []).map((item) => <tr key={item.id}><td>{item.name}</td>{fields.map(([key, label]) => <td key={key} data-label={label}>{item[key] || '—'}</td>)}{countLabel && <td className="simple-registry-count" data-label={countLabel}>{count(item)}</td>}<td><div className="payable-registry-actions">
        <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></button>
        <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${item.name}`} onClick={() => setRemoving(item)}><Trash2 size={16} /></button>
      </div></td></tr>)}
      {items && !items.length && <tr><td colSpan={fields.length + (countLabel ? 3 : 2)} className="payable-empty">Nenhum cadastro.</td></tr>}
      {!items && !error && <tr><td colSpan={fields.length + (countLabel ? 3 : 2)} className="payable-empty">Carregando...</td></tr>}
    </tbody></table></div>
    {chart && <PauseReasonsChart reasons={items || []} version={version} />}
    {editing && <NameForm title={`${editing.id ? 'Editar' : New} ${singular}`} label={nameLabel} fields={fields} source={editing} onClose={() => setEditing(null)} onSave={async (values) => { await payableRequest(editing.id ? `${endpoint}/${editing.id}` : endpoint, editing.id ? 'PUT' : 'POST', values); setEditing(null); refresh() }} />}
    {removing && <RemoveConfirm title={`Excluir ${singular}`} name={removing.name} onClose={() => setRemoving(null)} onConfirm={async () => { await payableRequest(`${endpoint}/${removing.id}`, 'DELETE'); setRemoving(null); refresh() }} />}
  </AdminWorkspace>
}

function NameForm({ title, label, fields, source, onClose, onSave }) {
  const id = useId(), [values, setValues] = useState(() => ({ name: source.name || '', ...Object.fromEntries(fields.map(([key]) => [key, source[key] || ''])) })), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <PayableModal title={title} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}>Salvar</button></>}>
    <form id={id} className="payable-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onSave(values) } catch (caught) { setError(caught.message) } finally { setBusy(false) } }}><fieldset disabled={busy}>
      <label>{label}<input required maxLength={120} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} autoFocus /></label>
      {fields.map(([key, fieldLabel, maxLength]) => <label key={key}>{fieldLabel}<input maxLength={maxLength} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function RemoveConfirm({ title, name, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <PayableModal title={title} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm() } catch (caught) { setError(caught.message) } finally { setBusy(false) } }}>Excluir</button></>}>
    <p>Excluir <strong>{name}</strong>?</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
