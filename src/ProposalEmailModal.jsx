import { useEffect, useId, useRef, useState } from 'react'
import { Eye, FileText, Mail, Paperclip, PenLine, Plus, Send, TriangleAlert, X } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import DownloadLink from './DownloadLink.jsx'
import './proposalEmail.css'

// "Enviar E-mail" of the proposal screen (server/proposalEmails.js). The e-mail comes ready (client and buyer, subject,
// message and signature, the proposal PDF attached) and everything can be changed before sending. A client or buyer
// without e-mail is warned about: the address typed for it goes to "Para" and is registered for it once the e-mail is sent.
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const MAX_BYTES_FALLBACK = 20 * 1024 * 1024
const sizeLabel = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const dateTime = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const normalized = (value) => String(value || '').trim().toLowerCase()
const contactLabels = { client: 'cliente', buyer: 'comprador' }

async function request(url, options = {}) {
  const token = window.sessionStorage.getItem('gmac-admin-token')
  const response = await fetch(url, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.')
  return data
}

// Addresses as chips: Enter, comma, semicolon or leaving the field turns the text into a chip; a wrong address stays typed.
function AddressField({ label, value, onChange, tags = {} }) {
  const [text, setText] = useState(''), [wrong, setWrong] = useState(''), id = useId()
  function commit() {
    const parts = text.split(/[,;\s]+/).map(normalized).filter(Boolean)
    if (!parts.length) return
    const bad = parts.filter((item) => !emailPattern.test(item))
    onChange([...new Set([...value, ...parts.filter((item) => emailPattern.test(item))])])
    setText(bad.join(', '))
    setWrong(bad.length ? `E-mail inválido: ${bad.join(', ')}` : '')
  }
  return <div className="proposal-email-row">
    <label htmlFor={id}>{label}</label>
    <div className={`proposal-email-addresses${wrong ? ' proposal-email-addresses--wrong' : ''}`} onClick={(event) => event.currentTarget.querySelector('input')?.focus()}>
      {value.map((address) => <span className="proposal-email-chip" key={address}>{address}{tags[address] && <small>{tags[address]}</small>}<button type="button" aria-label={`Remover ${address}`} onClick={() => onChange(value.filter((item) => item !== address))}><X size={13} /></button></span>)}
      <input id={id} type="text" inputMode="email" value={text} placeholder={value.length ? '' : 'nome@empresa.com.br'} autoComplete="off"
        onChange={(event) => { setText(event.target.value); setWrong('') }} onBlur={commit}
        onKeyDown={(event) => {
          if (['Enter', ',', ';'].includes(event.key)) { event.preventDefault(); commit() }
          if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }} />
    </div>
    {wrong && <small className="proposal-email-error">{wrong}</small>}
  </div>
}

// A registered client or buyer without e-mail: the typed address joins "Para" and is registered for it after sending.
function MissingContact({ kind, contact, value, onChange }) {
  const valid = emailPattern.test(normalized(value))
  return <div className="proposal-email-missing" role="status">
    <TriangleAlert size={17} aria-hidden="true" />
    <div>
      <strong>O {contactLabels[kind]} {contact.name} não tem e-mail cadastrado.</strong>
      <input type="email" value={value} onChange={(event) => onChange(event.target.value)} placeholder={`E-mail do ${contactLabels[kind]}`} aria-label={`E-mail do ${contactLabels[kind]} ${contact.name}`} />
      <small>{valid ? `Este e-mail será cadastrado para o ${contactLabels[kind]} ${contact.name} e já virá preenchido nos próximos envios.` : value ? 'Confira o e-mail digitado.' : `Digite o e-mail para enviar e cadastrar no ${contactLabels[kind]}.`}</small>
    </div>
  </div>
}

function EmailPreview({ from, to, cc, subject, message, signature, attachments }) {
  return <article className="proposal-email-preview" aria-label="Prévia do e-mail">
    <header>
      <h3>{subject || '(sem assunto)'}</h3>
      <p><span>De</span>{from}</p>
      <p><span>Para</span>{to.join(', ') || '—'}</p>
      {cc.length > 0 && <p><span>Cc</span>{cc.join(', ')}</p>}
    </header>
    <div className="proposal-email-preview-body">{message}</div>
    <div className="proposal-email-preview-signature">{signature}</div>
    {attachments.length > 0 && <ul className="proposal-email-preview-files">{attachments.map((file) => <li key={file.key}><FileText size={15} aria-hidden="true" />{file.name}<small>{sizeLabel(file.size)}</small></li>)}</ul>}
  </article>
}

export default function ProposalEmailModal({ offer, onClose, onSent }) {
  const [loaded, setLoaded] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('edit')
  const [to, setTo] = useState([]), [cc, setCc] = useState([]), [subject, setSubject] = useState(''), [message, setMessage] = useState(''), [signature, setSignature] = useState('')
  const [includeProposal, setIncludeProposal] = useState(true), [files, setFiles] = useState([])
  const [missing, setMissing] = useState({ client: '', buyer: '' })
  const fileInput = useRef(null), formId = useId()

  useEffect(() => {
    request(`/api/offers/${encodeURIComponent(offer.id)}/proposal-email`, { cache: 'no-store' }).then((data) => {
      setLoaded(data)
      setTo(data.draft.to); setCc(data.draft.cc); setSubject(data.draft.subject); setMessage(data.draft.message); setSignature(data.draft.signature)
    }).catch((caught) => setError(caught.message))
  }, [offer.id])

  const contacts = loaded?.contacts || {}
  const lacking = ['client', 'buyer'].filter((kind) => contacts[kind] && !contacts[kind].email)
  // The address typed for a contact without e-mail replaces, in "Para", the one typed before.
  function changeMissing(kind, value) {
    const before = normalized(missing[kind]), after = normalized(value)
    setMissing((current) => ({ ...current, [kind]: value }))
    setTo((current) => {
      const kept = emailPattern.test(before) ? current.filter((item) => item !== before) : current
      return emailPattern.test(after) && !kept.includes(after) ? [...kept, after] : kept
    })
  }
  const tags = Object.fromEntries(lacking.map((kind) => [normalized(missing[kind]), `novo · ${contactLabels[kind]}`]).filter(([address]) => emailPattern.test(address)))
  const attachments = [...(includeProposal && loaded ? [{ key: 'proposal', name: loaded.proposal.name, size: loaded.proposal.size, proposal: true }] : []), ...files.map((file, index) => ({ key: `${index}-${file.name}`, name: file.name, size: file.size, index }))]
  const total = attachments.reduce((sum, file) => sum + file.size, 0), maxBytes = loaded?.maxBytes || MAX_BYTES_FALLBACK

  async function send(event) {
    event.preventDefault()
    setError('')
    if (!to.length) { setTab('edit'); setError('Informe pelo menos um destinatário em Para.'); return }
    if (!attachments.length) { setError('Anexe a proposta ou outro arquivo antes de enviar.'); return }
    if (total > maxBytes) { setError(`Os anexos passam de ${sizeLabel(maxBytes)}, o limite do e-mail.`); return }
    setBusy(true)
    try {
      const body = new FormData()
      const register = Object.fromEntries(lacking.map((kind) => [kind, normalized(missing[kind])]).filter(([, address]) => emailPattern.test(address)))
      body.append('email', JSON.stringify({ to, cc, subject, message, signature, includeProposal, fileNames: files.map((file) => file.name), register }))
      for (const file of files) body.append('files', file, 'anexo')
      const result = await request(`/api/offers/${encodeURIComponent(offer.id)}/proposal-email`, { method: 'POST', body })
      await onSent(result)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }

  const footer = <>
    {loaded && <span className="proposal-email-footer-note">Cópia oculta para {loaded.draft.from}, que fica com o e-mail no Outlook.</span>}
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={busy || !loaded || !loaded.configured}><Send size={16} aria-hidden="true" />{busy ? 'Enviando...' : 'Enviar e-mail'}</button>
  </>
  return <PayableModal title="Enviar proposta por e-mail" wide busy={busy} onClose={onClose} footer={footer} className="proposal-email-modal">
    {!loaded && !error && <p className="payable-muted">Preparando o e-mail...</p>}
    {loaded && !loaded.configured && <p className="proposal-email-missing proposal-email-missing--blocked" role="alert"><TriangleAlert size={17} aria-hidden="true" />O envio de e-mail não está configurado no portal (SMTP). Fale com o TI.</p>}
    {loaded && <form id={formId} onSubmit={send}><fieldset disabled={busy}>
      <div className="proposal-email-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}><PenLine size={15} aria-hidden="true" />Editar</button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}><Eye size={15} aria-hidden="true" />Prévia</button>
      </div>
      {tab === 'preview' ? <EmailPreview from={loaded.draft.from} to={to} cc={cc} subject={subject} message={message} signature={signature} attachments={attachments} /> : <div className="proposal-email-compose">
        {lacking.map((kind) => <MissingContact key={kind} kind={kind} contact={contacts[kind]} value={missing[kind]} onChange={(value) => changeMissing(kind, value)} />)}
        {!contacts.client && <p className="proposal-email-info"><Mail size={15} aria-hidden="true" />{offer.company} não está em Cadastros › Clientes: o e-mail digitado vale só para este envio.</p>}
        <div className="proposal-email-row"><span className="proposal-email-label">De</span><span className="proposal-email-from">{loaded.draft.from}</span></div>
        <AddressField label="Para" value={to} onChange={setTo} tags={tags} />
        <AddressField label="Cc" value={cc} onChange={setCc} />
        <div className="proposal-email-row"><label htmlFor={`${formId}-subject`}>Assunto</label><input id={`${formId}-subject`} value={subject} maxLength={250} onChange={(event) => setSubject(event.target.value)} required /></div>
        <label className="proposal-email-field">Mensagem<textarea value={message} rows={9} maxLength={20000} onChange={(event) => setMessage(event.target.value)} required /></label>
        <label className="proposal-email-field">Assinatura<textarea className="proposal-email-signature" value={signature} rows={7} maxLength={2000} onChange={(event) => setSignature(event.target.value)} /></label>
        <div className="proposal-email-files">
          <div className="proposal-email-files-heading"><strong><Paperclip size={15} aria-hidden="true" />Anexos</strong><small className={total > maxBytes ? 'proposal-email-error' : ''}>{sizeLabel(total || 0)} de {sizeLabel(maxBytes)}</small></div>
          <ul>{attachments.map((file) => <li key={file.key}><FileText size={16} aria-hidden="true" /><span>{file.name}{file.proposal && <em>Proposta</em>}</span><small>{sizeLabel(file.size)}</small>
            <button type="button" className="payable-icon" aria-label={`Remover ${file.name}`} title="Remover anexo" onClick={() => file.proposal ? setIncludeProposal(false) : setFiles((current) => current.filter((_, index) => index !== file.index))}><X size={15} /></button></li>)}
            {!attachments.length && <li className="proposal-email-files-empty">Nenhum anexo.</li>}
          </ul>
          <div className="proposal-email-files-actions">
            <button type="button" className="admin-tool-button" onClick={() => fileInput.current?.click()}><Plus size={15} aria-hidden="true" />Adicionar anexo</button>
            {!includeProposal && <button type="button" className="admin-tool-button" onClick={() => setIncludeProposal(true)}><FileText size={15} aria-hidden="true" />Anexar a proposta de novo</button>}
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => { const chosen = [...(event.target.files || [])]; setFiles((current) => [...current, ...chosen]); event.target.value = '' }} />
          </div>
        </div>
      </div>}
    </fieldset></form>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

// Offer details: the proposal e-mails sent, newest first; each one opens with everything that went, files included.
export function ProposalEmailHistory({ offer }) {
  const [open, setOpen] = useState(null)
  const emails = offer.proposalEmails || []
  // The window stays outside the offer card, whose list and heading styles are not for it.
  return <><div className="offer-detail-text proposal-email-history"><h3>E-mails da proposta</h3>
    {emails.length ? <ul>{emails.map((email) => <li key={email.id}><button type="button" onClick={() => setOpen(email)}><Mail size={15} aria-hidden="true" /><span><strong>{email.subject}</strong><small>{dateTime(email.sentAt)} · por {email.sentByName} · para {email.to.join(', ')}</small></span></button></li>)}</ul> : <p>Nenhum e-mail enviado.</p>}
  </div>
    {open && <PayableModal title="E-mail enviado" wide onClose={() => setOpen(null)} className="proposal-email-modal" footer={<button className="admin-tool-button" type="button" onClick={() => setOpen(null)}>Fechar</button>}>
      <p className="payable-muted">{[`Enviado em ${dateTime(open.sentAt)} por ${open.sentByName}`, ...(open.registered || []).map((item) => `${item.email} cadastrado para o ${contactLabels[item.kind]} ${item.name}`)].join(' · ')}</p>
      <EmailPreview from={open.from} to={open.to} cc={open.cc || []} subject={open.subject} message={open.message} signature={open.signature} attachments={[]} />
      <div className="proposal-email-files"><div className="proposal-email-files-heading"><strong><Paperclip size={15} aria-hidden="true" />Anexos enviados</strong></div>
        <ul>{open.attachments.map((file) => <li key={file.id}><FileText size={16} aria-hidden="true" /><span><DownloadLink url={`/api/offers/${encodeURIComponent(offer.id)}/proposal-emails/${open.id}/files/${file.id}`} name={file.name}>{file.name}</DownloadLink>{file.proposal && <em>Proposta</em>}</span><small>{sizeLabel(file.size)}</small></li>)}</ul>
      </div>
    </PayableModal>}
  </>
}
