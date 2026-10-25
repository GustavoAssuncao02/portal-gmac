import { useEffect, useState } from 'react'
import { Save, Eye, EyeOff, Sun, Moon, MoonStar, Type, Volume2, Pencil } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { payableRequest } from './payablesApi.js'
import { useAccountAppearance } from './accountTheme.js'
import { playNotificationSound } from './notificationSounds.js'
import { notificationDefaults, notificationOptions, notificationSoundDefault, notificationSounds } from '../server/notificationRules.js'
import ReleaseNotesModal from './ReleaseNotesModal.jsx'
import { PayableModal } from './PayableModal.jsx'
import OperatorAccessSettings from './OperatorAccessSettings.jsx'
import { currentVersion } from './releaseNotes.js'

const cpfMask = (value) => String(value || '').replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')

export default function AccountSettings({ user, onUpdateUser, ...props }) {
  const appearance = useAccountAppearance()
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reminderDays, setReminderDays] = useState('3')
  const [receivableDays, setReceivableDays] = useState('3')
  const [notificationPreferences, setNotificationPreferences] = useState(notificationDefaults)
  const [sound, setSound] = useState(notificationSoundDefault)
  const [notificationLoading, setNotificationLoading] = useState(true)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  useEffect(() => {
    let active = true
    setNotificationLoading(true)
    payableRequest('/account/notifications').then((data) => { if (active) { setReminderDays(String(data.settings.payableReminderDays)); setReceivableDays(String(data.settings.receivableReminderDays ?? 3)); setSound(data.settings.sound ?? notificationSoundDefault); setNotificationPreferences(Object.fromEntries(notificationOptions.map(([key]) => [key, data.settings[key] ?? true]))) } })
      .catch((caught) => { if (active) setNotificationError(caught.message) })
      .finally(() => { if (active) setNotificationLoading(false) })
    return () => { active = false }
  }, [user?.id])
  async function saveNotifications(event) {
    event.preventDefault()
    setNotificationBusy(true); setNotificationError(''); setNotificationMessage('')
    try {
      const data = await payableRequest('/account/notifications', 'PATCH', { payableReminderDays: reminderDays === 'never' ? 'never' : Number(reminderDays), receivableReminderDays: receivableDays === 'never' ? 'never' : Number(receivableDays), sound, ...notificationPreferences })
      setReminderDays(String(data.settings.payableReminderDays))
      setReceivableDays(String(data.settings.receivableReminderDays ?? 3))
      setSound(data.settings.sound ?? notificationSoundDefault)
      setNotificationPreferences(Object.fromEntries(notificationOptions.map(([key]) => [key, data.settings[key] ?? true])))
      setNotificationMessage('Preferência de notificações salva.')
      window.dispatchEvent(new Event('gmac-notification-settings-changed'))
    } catch (caught) { setNotificationError(caught.message) }
    finally { setNotificationBusy(false) }
  }
  // The account form opens in a dialog, always from the saved name and with the password fields empty.
  function openAccount() {
    setName(user?.name || ''); setCurrentPassword(''); setPassword(''); setConfirmation(''); setShow(false); setError(''); setMessage('')
    setAccountOpen(true)
  }
  async function save(event) {
    event.preventDefault(); setMessage(''); setError('')
    if (password !== confirmation) return setError('As senhas n\u00e3o coincidem.')
    setBusy(true)
    try {
      const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` }, body: JSON.stringify({ name, currentPassword, password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'N\u00e3o foi poss\u00edvel atualizar a conta.')
      sessionStorage.setItem('gmac-admin-token', data.token)
      onUpdateUser(data.user)
      setCurrentPassword(''); setPassword(''); setConfirmation(''); setMessage('Conta atualizada com sucesso.'); setAccountOpen(false)
    } catch (caught) { setError(caught.message) }
    finally { setBusy(false) }
  }
  return <AdminWorkspace title="Configurações da conta" {...props}>
    <div className="account-settings-layout">
    <section className="account-appearance-settings" aria-labelledby="account-appearance-title">
      <h2 id="account-appearance-title">Aparência</h2>
      <div className="account-theme-options" role="radiogroup" aria-label="Tema da conta">{[['light', 'Modo claro', Sun], ['dark', 'Modo escuro', Moon], ['black', 'Escuro intenso', MoonStar]].map(([value, label, Symbol]) => <label key={value} className={`account-theme-option${appearance?.theme === value ? ' selected' : ''}`}><input type="radio" name="account-theme" value={value} checked={(appearance?.theme || 'light') === value} disabled={appearance?.busy || appearance?.loading} onChange={() => appearance?.changeTheme(value)} /><Symbol size={20} /><span>{label}</span></label>)}</div>
      <label className="account-font-family-field">Fonte<select aria-label="Fonte" value={appearance?.fontFamily || 'default'} disabled={appearance?.busy || appearance?.loading} onChange={(event) => appearance?.changeFontFamily(event.target.value)}>
        <option value="default">Arial (padrão)</option><option value="system">Segoe UI</option><option value="verdana">Verdana</option><option value="tahoma">Tahoma</option>
        <option value="inter">Inter</option><option value="roboto">Roboto</option><option value="open-sans">Open Sans</option><option value="montserrat">Montserrat</option><option value="source-sans-3">Source Sans 3</option>
      </select></label>
      <h3 id="account-font-size-title">Tamanho da fonte</h3>
      <div className="account-theme-options account-font-options" role="radiogroup" aria-labelledby="account-font-size-title">
        {[['small', 'Pequena', 16], ['default', 'Padrão', 20], ['large', 'Grande', 24]].map(([value, label, size]) => <label key={value} className={`account-theme-option${(appearance?.fontSize || 'default') === value ? ' selected' : ''}`}>
          <input type="radio" name="account-font-size" value={value} checked={(appearance?.fontSize || 'default') === value} disabled={appearance?.busy || appearance?.loading} onChange={() => appearance?.changeFontSize(value)} />
          <span className="account-font-icon" aria-hidden="true"><Type size={size} /></span><span>{label}</span>
        </label>)}
      </div>
      {appearance?.busy && <p role="status">Salvando aparência...</p>}{appearance?.error && <div><p className="admin-tool-error" role="alert">{appearance.error}</p><button className="admin-tool-button" type="button" onClick={appearance.retry}>Tentar novamente</button></div>}{appearance?.message && <p className="admin-tool-success" role="status">{appearance.message}</p>}
    </section><div className="account-access-column">
    <section className="account-summary-card" aria-labelledby="account-data-title">
      <header><h2 id="account-data-title">Dados da conta</h2><button className="admin-tool-button" type="button" onClick={openAccount}><Pencil size={16} />Editar dados e senha</button></header>
      <dl className="account-summary"><div><dt>Nome</dt><dd>{user?.name}</dd></div><div><dt>CPF</dt><dd>{cpfMask(user?.cpf)}</dd></div></dl>
      {message && <p className="admin-tool-success" role="status">{message}</p>}
    </section>
    {user?.role !== 'staff' && <OperatorAccessSettings />}</div>
    {accountOpen && <PayableModal title="Dados da conta" className="account-settings-modal" busy={busy} onClose={() => setAccountOpen(false)} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={() => setAccountOpen(false)}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form="account-settings-form" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar alterações'}</button></>}>
    <form id="account-settings-form" className="account-settings-form" onSubmit={save}>
    <fieldset disabled={busy}><div className="account-settings-fields"><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="name" /></label><label>CPF<input value={user?.cpf || ''} readOnly /></label></div>
    <h3>Segurança</h3><p className="payable-muted">A senha atual confirma qualquer alteração. Deixe a nova senha em branco para manter a de hoje.</p><div className="account-settings-fields"><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label><label>Nova senha<span className="account-password-input"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={72} autoComplete="new-password" /><button type="button" title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label><label>Confirmar nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required={Boolean(password)} minLength={password ? 6 : undefined} maxLength={72} autoComplete="new-password" /></label></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}</fieldset>
  </form></PayableModal>}<form className="account-settings-form account-notification-settings" onSubmit={saveNotifications}>
    <fieldset disabled={notificationLoading || notificationBusy}><h2>Notificações</h2><div className="account-settings-fields"><label>Contas a pagar a vencer<select aria-label="Contas a pagar a vencer" value={reminderDays} onChange={(event) => { setReminderDays(event.target.value); setNotificationMessage('') }}><option value="3">3 dias antes do vencimento</option><option value="5">5 dias antes do vencimento</option><option value="7">7 dias antes do vencimento</option><option value="never">Nunca</option></select></label><label>Contas a receber a vencer<select aria-label="Contas a receber a vencer" value={receivableDays} onChange={(event) => { setReceivableDays(event.target.value); setNotificationMessage('') }}><option value="3">3 dias antes e quando vencer</option><option value="5">5 dias antes e quando vencer</option><option value="7">7 dias antes e quando vencer</option><option value="never">Nunca</option></select></label>
        <label>Som das notificações<span className="account-sound-field"><select aria-label="Som das notificações" value={sound} onChange={(event) => { setSound(event.target.value); setNotificationMessage(''); playNotificationSound(event.target.value) }}><option value="off">Sem som</option>{notificationSounds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="admin-tool-button" type="button" title="Ouvir o som escolhido" disabled={sound === 'off'} onClick={() => playNotificationSound(sound)}><Volume2 size={16} aria-hidden="true" />Ouvir</button></span></label></div>
      <div className="account-notification-options">{notificationOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={notificationPreferences[key]} onChange={(event) => { setNotificationPreferences((current) => ({ ...current, [key]: event.target.checked })); setNotificationMessage('') }} /><span>{label}</span></label>)}</div>
      {notificationError && <p className="admin-tool-error" role="alert">{notificationError}</p>}{notificationMessage && <p className="admin-tool-success" role="status">{notificationMessage}</p>}<button className="admin-tool-button admin-tool-button--primary" type="submit"><Save size={16} />{notificationBusy ? 'Salvando...' : 'Salvar notificações'}</button>
    </fieldset>
  </form></div>
  <footer className="account-release-footer"><button className="account-release-link" type="button" onClick={() => setReleaseNotesOpen(true)}>Notas de atualização</button><span>Versão {currentVersion}</span></footer>
  {releaseNotesOpen && <ReleaseNotesModal onClose={() => setReleaseNotesOpen(false)} />}</AdminWorkspace>
}
