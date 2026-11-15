import { useEffect, useId, useRef, useState } from 'react'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import './emailTemplates.css'

// Cadastros › Modelos de e-mail (server/emailTemplates.js): the texts of the e-mails sent with a proposal. "Proposta
// comercial" and "Medição de etiqueta" come with the portal (edited, never deleted: "Restaurar" takes the original text
// back); anyone of the portal creates others. On the e-mail screen the template is picked and the {campos} are filled.
const list = (value) => (Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/)).map((item) => item.trim()).filter(Boolean)

function TemplateForm({ source, fields, onClose, onSaved }) {
  const id = useId(), focused = useRef('message'), inputs = { subject: useRef(null), message: useRef(null) }
  const [values, setValues] = useState({ name: source.name || '', subject: source.subject || '', message: source.message || '', to: (source.to || []).join(', '), cc: (source.cc || []).join(', ') })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  // A field goes where the cursor was, in the subject or in the text.
  function insert(key) {
    const target = focused.current, element = inputs[target].current, token = `{${key}}`
    const start = element?.selectionStart ?? values[target].length, end = element?.selectionEnd ?? start
    set(target, `${values[target].slice(0, start)}${token}${values[target].slice(end)}`)
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length) })
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const body = { ...values, to: list(values.to), cc: list(values.cc) }
      await payableRequest(source.id ? `/email-templates/${encodeURIComponent(source.id)}` : '/email-templates', source.id ? 'PUT' : 'POST', body)
      await onSaved()
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={source.id ? `Editar modelo · ${source.name}` : 'Novo modelo de e-mail'} wide busy={busy} onClose={onClose} className="email-template-modal" footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}>{busy ? 'Salvando...' : 'Salvar modelo'}</button></>}>
    <form id={id} className="payable-form email-template-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Nome do modelo<input required maxLength={80} value={values.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Medição Belgo FAI" /></label>
      <label>Assunto<input ref={inputs.subject} required maxLength={250} value={values.subject} onFocus={() => { focused.current = 'subject' }} onChange={(event) => set('subject', event.target.value)} /></label>
      <div className="email-template-recipients">
        <label>Para (opcional)<input value={values.to} onChange={(event) => set('to', event.target.value)} placeholder="nome@empresa.com.br, outro@empresa.com.br" /><small className="payable-hint">Entram junto com o e-mail do cliente e do comprador.</small></label>
        <label>Cc (opcional)<input value={values.cc} onChange={(event) => set('cc', event.target.value)} placeholder="nome@empresa.com.br" /></label>
      </div>
      <label>Texto do e-mail<textarea ref={inputs.message} required rows={11} maxLength={20000} value={values.message} onFocus={() => { focused.current = 'message' }} onChange={(event) => set('message', event.target.value)} /></label>
      <div className="email-template-fields"><strong>Campos preenchidos com os dados da oferta</strong><small className="payable-hint">Clique para incluir no assunto ou no texto, onde está o cursor. A assinatura entra sozinha no fim do e-mail.</small>
        <ul>{fields.map(([key, label]) => <li key={key}><button type="button" className="email-template-field" title={label} onClick={() => insert(key)}>{`{${key}}`}</button><span>{label}</span></li>)}</ul>
      </div>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function RemoveTemplate({ template, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const restore = template.builtin
  async function confirm() {
    setBusy(true); setError('')
    try { await payableRequest(`/email-templates/${encodeURIComponent(template.id)}`, 'DELETE'); await onDone() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={restore ? 'Restaurar o texto original' : 'Excluir modelo de e-mail'} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className={`admin-tool-button admin-tool-button--primary${restore ? '' : ' admin-tool-button--danger'}`} type="button" disabled={busy} onClick={confirm}>{restore ? 'Restaurar' : 'Excluir'}</button></>}>
    <p>{restore ? <>O modelo <strong>{template.name}</strong> volta ao texto que veio com o portal.</> : <>Excluir o modelo <strong>{template.name}</strong>? Os e-mails já enviados com ele não mudam.</>}</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

export default function EmailTemplatesScreen({ Sidebar, WorkspaceTabs, navigationProps }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null), [removing, setRemoving] = useState(null), [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    payableRequest('/email-templates').then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [version])
  const refresh = () => setVersion((value) => value + 1)
  return <AdminWorkspace Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={navigationProps} title="Modelos de e-mail">
    <p className="email-templates-intro">Textos dos e-mails enviados com a proposta. Na tela de envio, o modelo vem escolhido pelo tipo da oferta (<strong>Medição de etiqueta</strong> para as etiquetas) e pode ser trocado.</p>
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => setEditing({})}><Plus size={17} />Novo modelo</button></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    <div className="payable-table-scroll"><table className="payable-table email-templates-table"><thead><tr><th>Modelo</th><th>Assunto</th><th>Destinatários fixos</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
      {(data?.items || []).map((item) => <tr key={item.id}>
        <td><strong>{item.name}</strong>{item.builtin && <span className="email-template-badge">Padrão do portal</span>}</td>
        <td data-label="Assunto">{item.subject}</td>
        <td data-label="Destinatários fixos">{[...(item.to || []), ...(item.cc || []).map((address) => `Cc: ${address}`)].join(', ') || '—'}</td>
        <td><div className="payable-registry-actions">
          <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></button>
          {item.builtin ? <button className="payable-icon" type="button" title="Restaurar o texto original" aria-label={`Restaurar ${item.name}`} disabled={!item.updatedAt} onClick={() => setRemoving(item)}><RotateCcw size={16} /></button>
            : <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${item.name}`} onClick={() => setRemoving(item)}><Trash2 size={16} /></button>}
        </div></td>
      </tr>)}
      {!data && !error && <tr><td colSpan={4} className="payable-empty">Carregando...</td></tr>}
    </tbody></table></div>
    {editing && data && <TemplateForm source={editing} fields={data.fields} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); refresh() }} />}
    {removing && <RemoveTemplate template={removing} onClose={() => setRemoving(null)} onDone={async () => { setRemoving(null); refresh() }} />}
  </AdminWorkspace>
}
