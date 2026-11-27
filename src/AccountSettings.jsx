import { Fragment, useEffect, useRef, useState } from 'react'
import { Save, Eye, EyeOff, Sun, Moon, MoonStar, Type, Volume2, Pencil, UserRound, Palette, Bell, NotebookPen, TabletSmartphone, Mail, Banknote, Factory, Tag, LifeBuoy, PenLine, KeyRound } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { payableRequest } from './payablesApi.js'
import { useAccountAppearance } from './accountTheme.js'
import { playNotificationSound } from './notificationSounds.js'
import { notificationOptions, notificationSounds, emailNotificationsLabel } from '../server/notificationRules.js'
import { dueNoticeDays } from '../server/noteRules.js'
import { PROPOSAL_NOTICE_DAYS_MAX } from '../server/proposalDeadlineRules.js'
import ReleaseNotesModal from './ReleaseNotesModal.jsx'
import { PayableModal } from './PayableModal.jsx'
import OperatorAccessSettings from './OperatorAccessSettings.jsx'
import { currentVersion } from './releaseNotes.js'
import { upper } from './displayCase.js'
import './accountSettings.css'

// Configurações da conta (2026-11-24): one section at a time, chosen in the menu on the left (on top in narrow
// screens). Every change is saved at once, with a short "Salvo" (the account data and the operator access still open in
// a dialog, because they ask for a password or a reason).
const cpfMask = (value) => String(value || '').replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const sectionKey = 'gmac-settings-section'

// The notices of the bell, by subject. A new option of notificationRules.js without a group shows in "Outros avisos".
const groups = [
  ['production', 'Produção e estoque', Factory, ['materialRequests', 'serviceCompleted', 'serviceAdded', 'lowStock']],
  ['commercial', 'Comercial', Tag, ['proposalSaved', 'siteOffers', 'openOffers']],
  ['support', 'Suporte', LifeBuoy, ['supportTickets']],
]
const emailed = new Set(['supportTickets'])

export function Switch({ checked, label, disabled = false, onChange }) {
  return <button className="account-switch" type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
}
function Row({ title, help, children, tag, child = false, off = false }) {
  return <div className={`account-setting-row${child ? ' account-setting-row--child' : ''}${off ? ' account-setting-row--off' : ''}`}>
    <div className="account-setting-text"><strong>{title}{tag && <span className="account-setting-tag"><Mail size={11} aria-hidden="true" />{tag}</span>}</strong>{help && <small>{help}</small>}</div>
    <div className="account-setting-control">{children}</div>
  </div>
}
function Card({ icon: Icon, title, description, children, actions }) {
  return <section className="account-card" aria-label={title}>
    <header><h3>{Icon && <Icon size={17} aria-hidden="true" />}{title}</h3>{actions}</header>
    {description && <p className="account-card-description">{description}</p>}
    {children}
  </section>
}
function Saved({ state }) {
  if (state.error) return <p className="admin-tool-error account-saved-error" role="alert">{state.error}</p>
  return <p className="account-saved" role="status">{state.busy ? 'Salvando...' : state.message}</p>
}

// The preferences of notifications (and of Anotações e Tarefas), saved one by one as they change.
function useNotificationSettings(userId) {
  const [settings, setSettings] = useState(null)
  const [state, setState] = useState({ busy: false, message: '', error: '' })
  const latest = useRef(null), sequence = useRef(0)
  latest.current = settings
  useEffect(() => {
    let active = true
    payableRequest('/account/notifications').then((data) => { if (active) setSettings(data.settings) }).catch((caught) => { if (active) setState({ busy: false, message: '', error: caught.message }) })
    return () => { active = false }
  }, [userId])
  // Only the answer of the last change replaces the screen, so two quick clicks never flicker back.
  async function save(changes) {
    const previous = latest.current, mine = ++sequence.current
    setSettings({ ...previous, ...changes }); setState({ busy: true, message: '', error: '' })
    try {
      const data = await payableRequest('/account/notifications', 'PATCH', changes)
      if (mine === sequence.current) { setSettings(data.settings); setState({ busy: false, message: 'Preferência salva.', error: '' }) }
      window.dispatchEvent(new Event('gmac-notification-settings-changed'))
    } catch (caught) {
      setSettings((current) => ({ ...current, ...Object.fromEntries(Object.keys(changes).map((key) => [key, previous[key]])) }))
      setState({ busy: false, message: '', error: caught.message })
    }
  }
  return { settings, state, save }
}

// The role under the name in the signature of the e-mails sent from the portal (server/emailSignature.js). Optional: left
// blank, the signature has only the name. Saved when the field is left (or with Enter).
function EmailSignatureRole() {
  const [jobTitle, setJobTitle] = useState(''), [saved, setSaved] = useState(''), [busy, setBusy] = useState(true), [message, setMessage] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    payableRequest('/account/email-signature').then((data) => { if (active) { setJobTitle(data.jobTitle); setSaved(data.jobTitle) } }).catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])
  async function save() {
    if (busy || jobTitle.trim() === saved) return
    setBusy(true); setError(''); setMessage('')
    try { const data = await payableRequest('/account/email-signature', 'PATCH', { jobTitle }); setJobTitle(data.jobTitle); setSaved(data.jobTitle); setMessage(data.jobTitle ? 'Cargo salvo na assinatura.' : 'A assinatura fica só com o seu nome.') }
    catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <Row title="Cargo" help="Aparece abaixo do seu nome nos e-mails enviados pelo portal. Em branco, não aparece.">
    <div className="account-job-title-field"><input aria-label="Cargo na assinatura de e-mail" maxLength={80} value={jobTitle} placeholder="Ex.: Assistente Comercial" disabled={busy && !saved && !jobTitle} onChange={(event) => { setJobTitle(event.target.value); setMessage('') }} onBlur={save} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
      {(message || error || busy) && <span className={error ? 'account-saved-error-text' : 'account-saved'} role={error ? 'alert' : 'status'}>{error || (busy && saved !== jobTitle.trim() ? 'Salvando...' : message)}</span>}</div>
  </Row>
}

function AccountSection({ user, onEdit, passwordChangedAt, message }) {
  return <>
    <header className="account-section-heading"><h2>Minha conta</h2><p>Seus dados de acesso e como seu nome aparece nos e-mails enviados pelo portal.</p></header>
    <Card icon={UserRound} title="Dados de acesso" actions={<button className="admin-tool-button" type="button" onClick={onEdit}><Pencil size={16} aria-hidden="true" />Editar dados e senha</button>}>
      <dl className="account-summary account-card-body"><div><dt>Nome</dt><dd>{upper(user?.name)}</dd></div><div><dt>CPF</dt><dd>{cpfMask(user?.cpf)}</dd></div><div><dt>E-mail</dt><dd>{user?.email || 'Sem e-mail cadastrado'}</dd></div><div><dt>Senha</dt><dd>{passwordChangedAt === undefined ? 'Carregando...' : passwordChangedAt ? `Alterada em ${moment(passwordChangedAt)}` : 'Nenhuma alteração registrada'}</dd></div></dl>
      {message && <p className="admin-tool-success account-card-body" role="status">{message}</p>}
    </Card>
    <Card icon={PenLine} title="Assinatura de e-mail"><EmailSignatureRole /></Card>
  </>
}

function AppearanceSection({ appearance }) {
  const disabled = appearance?.busy || appearance?.loading
  return <>
    <header className="account-section-heading"><h2>Aparência</h2><p>Vale só para a sua conta, em qualquer computador em que você entrar.</p></header>
    <Card icon={Palette} title="Tema">
      <div className="account-theme-options account-card-body" role="radiogroup" aria-label="Tema da conta">{[['light', 'Modo claro', Sun], ['dark', 'Modo escuro', Moon], ['black', 'Escuro intenso', MoonStar]].map(([value, label, Symbol]) => <label key={value} className={`account-theme-option${appearance?.theme === value ? ' selected' : ''}`}><input type="radio" name="account-theme" value={value} checked={(appearance?.theme || 'light') === value} disabled={disabled} onChange={() => appearance?.changeTheme(value)} /><Symbol size={20} /><span>{label}</span></label>)}</div>
    </Card>
    <Card icon={Type} title="Texto">
      <Row title="Fonte"><select aria-label="Fonte" value={appearance?.fontFamily || 'default'} disabled={disabled} onChange={(event) => appearance?.changeFontFamily(event.target.value)}>
        <option value="default">Arial (padrão)</option><option value="system">Segoe UI</option><option value="verdana">Verdana</option><option value="tahoma">Tahoma</option>
        <option value="inter">Inter</option><option value="roboto">Roboto</option><option value="open-sans">Open Sans</option><option value="montserrat">Montserrat</option><option value="source-sans-3">Source Sans 3</option>
      </select></Row>
      <div className="account-setting-row account-setting-row--stack"><div className="account-setting-text"><strong id="account-font-size-title">Tamanho da fonte</strong></div>
        <div className="account-theme-options account-font-options" role="radiogroup" aria-labelledby="account-font-size-title">
          {[['small', 'Pequena', 16], ['default', 'Padrão', 20], ['large', 'Grande', 24]].map(([value, label, size]) => <label key={value} className={`account-theme-option${(appearance?.fontSize || 'default') === value ? ' selected' : ''}`}>
            <input type="radio" name="account-font-size" value={value} checked={(appearance?.fontSize || 'default') === value} disabled={disabled} onChange={() => appearance?.changeFontSize(value)} />
            <span className="account-font-icon" aria-hidden="true"><Type size={size} /></span><span>{label}</span>
          </label>)}
        </div></div>
    </Card>
    {appearance?.busy && <p className="account-saved" role="status">Salvando aparência...</p>}{appearance?.error && <div><p className="admin-tool-error" role="alert">{appearance.error}</p><button className="admin-tool-button" type="button" onClick={appearance.retry}>Tentar novamente</button></div>}{appearance?.message && <p className="account-saved" role="status">{appearance.message}</p>}
  </>
}

// Prazo para enviar a proposta (TCK-0012), in Comercial: the 1st and 2nd notice (days before, 1 to 30) and the one on the
// day it falls due, each with its switch (on the right, in line with the other switches). The same number of days in both
// arrives once.
const proposalNoticeDayOptions = Array.from({ length: PROPOSAL_NOTICE_DAYS_MAX }, (_, index) => index + 1)
function ProposalNoticeRows({ settings, save }) {
  const days = (key, label, disabled) => <select aria-label={label} value={settings[key]} disabled={disabled} onChange={(event) => save({ [key]: Number(event.target.value) })}>{proposalNoticeDayOptions.map((day) => <option key={day} value={day}>{day} {day === 1 ? 'dia antes' : 'dias antes'}</option>)}</select>
  const same = settings.proposalDeadlineFirst && settings.proposalDeadlineSecond && settings.proposalDeadlineFirstDays === settings.proposalDeadlineSecondDays
  return <>
    <Row title="Prazo para enviar a proposta" help="Avisos às 07:30 das ofertas com prazo para enviar a proposta. Param quando a proposta é gerada." />
    <Row child off={!settings.proposalDeadlineFirst} title="1º aviso"><span className="account-response-control">{days('proposalDeadlineFirstDays', '1º aviso: dias antes do prazo', !settings.proposalDeadlineFirst)}<Switch checked={settings.proposalDeadlineFirst} label="1º aviso do prazo da proposta" onChange={(value) => save({ proposalDeadlineFirst: value })} /></span></Row>
    <Row child off={!settings.proposalDeadlineSecond} title="2º aviso" help={same ? 'Mesmo número de dias do 1º aviso: chega um aviso só.' : undefined}><span className="account-response-control">{days('proposalDeadlineSecondDays', '2º aviso: dias antes do prazo', !settings.proposalDeadlineSecond)}<Switch checked={settings.proposalDeadlineSecond} label="2º aviso do prazo da proposta" onChange={(value) => save({ proposalDeadlineSecond: value })} /></span></Row>
    <Row child off={!settings.proposalDeadlineDueDay} title="Avisar no dia do vencimento"><Switch checked={settings.proposalDeadlineDueDay} label="Avisar no dia do vencimento" onChange={(value) => save({ proposalDeadlineDueDay: value })} /></Row>
  </>
}

function NotificationsSection({ user, preferences, onOpenNotes }) {
  const { settings, state, save } = preferences
  const labels = Object.fromEntries(notificationOptions)
  const grouped = new Set(groups.flatMap(([, , , keys]) => keys))
  const others = notificationOptions.map(([key]) => key).filter((key) => !grouped.has(key))
  const toggle = (key) => <Row key={key} title={labels[key]} tag={emailed.has(key) ? 'E-mail' : null}><Switch checked={Boolean(settings[key])} label={labels[key]} onChange={(value) => save({ [key]: value })} /></Row>
  return <>
    <header className="account-section-heading"><h2>Notificações</h2><p>Os avisos chegam no sininho. Escolha o que quer receber, o som e se também quer por e-mail.</p><Saved state={state} /></header>
    {!settings ? !state.error && <p>Carregando...</p> : <>
      <Card icon={Bell} title="Como receber">
        <Row title="Som das notificações" help="Toca quando chega um aviso novo."><span className="account-sound-field"><select aria-label="Som das notificações" value={settings.sound} onChange={(event) => { playNotificationSound(event.target.value); save({ sound: event.target.value }) }}><option value="off">Sem som</option>{notificationSounds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="admin-tool-button" type="button" title="Ouvir o som escolhido" disabled={settings.sound === 'off'} onClick={() => playNotificationSound(settings.sound)}><Volume2 size={16} aria-hidden="true" />Ouvir</button></span></Row>
        {/* "Notificações do sistema por e-mail": the e-mails the system sends by itself (tickets, Anotações e Tarefas). */}
        <Row title={emailNotificationsLabel} help={!settings.emailNotifications ? 'Os avisos continuam no sininho, mas não chegam por e-mail.' : user?.email ? `Os avisos marcados com “E-mail” também chegam em ${user.email}.` : 'Sua conta não tem e-mail cadastrado: os avisos ficam só no sininho.'}><Switch checked={settings.emailNotifications} label={emailNotificationsLabel} onChange={(value) => save({ emailNotifications: value })} /></Row>
      </Card>
      {/* Administrative employees have no access to Gestão Financeira and get no notice of its accounts. */}
      {user?.role !== 'staff' && <Card icon={Banknote} title="Financeiro">
        <Row title="Contas a pagar a vencer"><select aria-label="Contas a pagar a vencer" value={String(settings.payableReminderDays)} onChange={(event) => save({ payableReminderDays: event.target.value === 'never' ? 'never' : Number(event.target.value) })}><option value="3">3 dias antes do vencimento</option><option value="5">5 dias antes do vencimento</option><option value="7">7 dias antes do vencimento</option><option value="never">Nunca</option></select></Row>
        <Row title="Contas a receber a vencer"><select aria-label="Contas a receber a vencer" value={String(settings.receivableReminderDays ?? 3)} onChange={(event) => save({ receivableReminderDays: event.target.value === 'never' ? 'never' : Number(event.target.value) })}><option value="3">3 dias antes e quando vencer</option><option value="5">5 dias antes e quando vencer</option><option value="7">7 dias antes e quando vencer</option><option value="never">Nunca</option></select></Row>
      </Card>}
      {groups.map(([key, title, icon, keys]) => <Card key={key} icon={icon} title={title}>{keys.filter((option) => labels[option]).map(toggle)}{key === 'commercial' && <ProposalNoticeRows settings={settings} save={save} />}</Card>)}
      {others.length > 0 && <Card icon={Bell} title="Outros avisos">{others.map(toggle)}</Card>}
      <section className="account-card" aria-label="Anotações e Tarefas"><Row title="Anotações e Tarefas" help="Lembretes, convites e prazos das tarefas têm a própria seção."><button className="admin-tool-button" type="button" onClick={onOpenNotes}>Abrir</button></Row></section>
    </>}
  </>
}

function NotesSection({ preferences }) {
  const { settings, state, save } = preferences
  return <>
    <header className="account-section-heading"><h2>Anotações e Tarefas</h2><p>O botão do canto da tela e os avisos das suas tarefas.</p><Saved state={state} /></header>
    {!settings ? !state.error && <p>Carregando...</p> : <>
      <Card icon={NotebookPen} title="Botão no canto da tela">
        <Row title="Mostrar o ícone de Anotações e Tarefas" help="O botão redondo no canto inferior direito de todas as telas. Desligado, o acesso fica só pelo menu."><Switch checked={settings.notesButton} label="Mostrar o ícone de Anotações e Tarefas" onChange={(value) => save({ notesButton: value })} /></Row>
      </Card>
      <Card icon={Bell} title="Avisos">
        <Row title="Notificações de Anotações e Tarefas" tag="E-mail" help="Lembretes das tarefas, convites para compartilhar e alterações feitas por outras pessoas nos itens compartilhados. Lembretes, prazos e convites também chegam por e-mail."><Switch checked={settings.notesNotifications} label="Notificações de Anotações e Tarefas" onChange={(value) => save({ notesNotifications: value })} /></Row>
        <Row child off={!settings.notesNotifications} title="Notificar tarefa próxima do prazo" help="Um aviso às 07:30, alguns dias antes do dia de cada tarefa em aberto, além do lembrete que você escolhe em cada tarefa."><Switch checked={settings.notesDueReminder} disabled={!settings.notesNotifications} label="Notificar tarefa próxima do prazo" onChange={(value) => save({ notesDueReminder: value })} /></Row>
        <Row child off={!settings.notesNotifications || !settings.notesDueReminder} title="Avisar com antecedência de"><select aria-label="Avisar com antecedência de" value={settings.notesDueDays} disabled={!settings.notesNotifications || !settings.notesDueReminder} onChange={(event) => save({ notesDueDays: Number(event.target.value) })}>{dueNoticeDays.map((days) => <option key={days} value={days}>{days} {days === 1 ? 'dia antes' : 'dias antes'}</option>)}</select></Row>
      </Card>
    </>}
  </>
}

export default function AccountSettings({ user, onUpdateUser, ...props }) {
  const appearance = useAccountAppearance()
  const preferences = useNotificationSettings(user?.id)
  const sections = [
    ['account', 'Minha conta', 'Nome, CPF, senha e assinatura', UserRound],
    ['appearance', 'Aparência', 'Tema, fonte e tamanho', Palette],
    ['notifications', 'Notificações', 'O que avisa, som e e-mail', Bell],
    ['notes', 'Anotações e Tarefas', 'Ícone, lembretes e prazos', NotebookPen],
    ...(user?.role !== 'staff' ? [['operator', 'Acesso do operador', 'Login dos tablets da fábrica', TabletSmartphone]] : []),
  ]
  const [section, setSection] = useState(() => { try { const saved = sessionStorage.getItem(sectionKey); return sections.some(([key]) => key === saved) ? saved : 'account' } catch { return 'account' } })
  const choose = (key) => { setSection(key); try { sessionStorage.setItem(sectionKey, key) } catch { /* only a convenience */ } }
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [passwordChangedAt, setPasswordChangedAt] = useState(undefined)
  // The notice of a new version (the bell) opens the notes here, also when this screen is already open.
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(() => sessionStorage.getItem('gmac-release-notes-open') === '1')
  useEffect(() => {
    sessionStorage.removeItem('gmac-release-notes-open')
    const open = () => { sessionStorage.removeItem('gmac-release-notes-open'); setReleaseNotesOpen(true) }
    window.addEventListener('gmac-release-notes-open', open)
    return () => window.removeEventListener('gmac-release-notes-open', open)
  }, [])
  const loadPasswordChange = () => payableRequest('/account/password-changed').then((data) => setPasswordChangedAt(data.at)).catch(() => setPasswordChangedAt(null))
  useEffect(() => { loadPasswordChange() }, [user?.id])
  const [accountOpen, setAccountOpen] = useState(false)
  // The account form opens in a dialog, always from the saved name and with the password fields empty.
  function openAccount() {
    setName(user?.name || ''); setCurrentPassword(''); setPassword(''); setConfirmation(''); setShow(false); setError(''); setMessage('')
    setAccountOpen(true)
  }
  async function save(event) {
    event.preventDefault(); setMessage(''); setError('')
    if (password !== confirmation) return setError('As senhas não coincidem.')
    setBusy(true)
    try {
      const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` }, body: JSON.stringify({ name, currentPassword, password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível atualizar a conta.')
      sessionStorage.setItem('gmac-admin-token', data.token)
      onUpdateUser(data.user)
      if (password) loadPasswordChange()
      setCurrentPassword(''); setPassword(''); setConfirmation(''); setMessage('Conta atualizada com sucesso.'); setAccountOpen(false)
    } catch (caught) { setError(caught.message) }
    finally { setBusy(false) }
  }
  const active = sections.some(([key]) => key === section) ? section : 'account'
  return <AdminWorkspace title="Configurações da conta" {...props}>
    <div className="account-settings-page">
      <nav className="account-settings-menu" aria-label="Seções das configurações">
        {sections.map(([key, label, hint, Icon]) => <Fragment key={key}>{key === 'operator' && <hr />}<button type="button" className={active === key ? 'account-settings-menu--active' : undefined} aria-current={active === key ? 'page' : undefined} onClick={() => choose(key)}><Icon size={18} aria-hidden="true" /><strong>{label}</strong><small>{hint}</small></button></Fragment>)}
      </nav>
      <div className="account-settings-section">
        {active === 'account' && <AccountSection user={user} onEdit={openAccount} passwordChangedAt={passwordChangedAt} message={message} />}
        {active === 'appearance' && <AppearanceSection appearance={appearance} />}
        {active === 'notifications' && <NotificationsSection user={user} preferences={preferences} onOpenNotes={() => choose('notes')} />}
        {active === 'notes' && <NotesSection preferences={preferences} />}
        {active === 'operator' && <>
          <header className="account-section-heading"><h2>Acesso do operador</h2><p>Só administradores veem esta seção.</p></header>
          <OperatorAccessSettings title="Login dos tablets da produção" />
        </>}
      </div>
    </div>
    <footer className="account-release-footer"><button className="account-release-link" type="button" onClick={() => setReleaseNotesOpen(true)}>Notas de atualização</button><span>Versão {currentVersion}</span></footer>
    {accountOpen && <PayableModal title="Dados da conta" className="account-settings-modal" busy={busy} onClose={() => setAccountOpen(false)} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={() => setAccountOpen(false)}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form="account-settings-form" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar alterações'}</button></>}>
      <form id="account-settings-form" className="account-settings-form" onSubmit={save}>
        <fieldset disabled={busy}><div className="account-settings-fields"><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="name" /></label><label>CPF<input value={user?.cpf || ''} readOnly /></label></div>
          <h3><KeyRound size={15} aria-hidden="true" /> Segurança</h3><p className="payable-muted">A senha atual confirma qualquer alteração. Deixe a nova senha em branco para manter a de hoje.</p><div className="account-settings-fields"><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label><label>Nova senha<span className="account-password-input"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={72} autoComplete="new-password" /><button type="button" title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label><label>Confirmar nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required={Boolean(password)} minLength={password ? 6 : undefined} maxLength={72} autoComplete="new-password" /></label></div>
          {error && <p className="admin-tool-error" role="alert">{error}</p>}</fieldset>
      </form></PayableModal>}
    {releaseNotesOpen && <ReleaseNotesModal onClose={() => setReleaseNotesOpen(false)} />}
  </AdminWorkspace>
}
