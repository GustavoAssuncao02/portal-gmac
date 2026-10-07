import { useEffect, useState } from 'react'
import { Save, Eye, EyeOff, Sun, Moon, Type } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { payableRequest } from './payablesApi.js'
import { useAccountAppearance } from './accountTheme.js'
import { notificationDefaults, notificationOptions } from '../server/notificationRules.js'

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
  const [notificationPreferences, setNotificationPreferences] = useState(notificationDefaults)
  const [notificationLoading, setNotificationLoading] = useState(true)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  useEffect(() => {
    let active = true
    setNotificationLoading(true)
    payableRequest('/account/notifications').then((data) => { if (active) { setReminderDays(String(data.settings.payableReminderDays)); setNotificationPreferences(Object.fromEntries(notificationOptions.map(([key]) => [key, data.settings[key] ?? true]))) } })
      .catch((caught) => { if (active) setNotificationError(caught.message) })
      .finally(() => { if (active) setNotificationLoading(false) })
    return () => { active = false }
  }, [user?.id])
  async function saveNotifications(event) {
    event.preventDefault()
    setNotificationBusy(true); setNotificationError(''); setNotificationMessage('')
    try {
      const data = await payableRequest('/account/notifications', 'PATCH', { payableReminderDays: reminderDays === 'never' ? 'never' : Number(reminderDays), ...notificationPreferences })
      setReminderDays(String(data.settings.payableReminderDays))
      setNotificationPreferences(Object.fromEntries(notificationOptions.map(([key]) => [key, data.settings[key] ?? true])))
      setNotificationMessage('Preferência de notificações salva.')
      window.dispatchEvent(new Event('gmac-notification-settings-changed'))
    } catch (caught) { setNotificationError(caught.message) }
    finally { setNotificationBusy(false) }
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
      setCurrentPassword(''); setPassword(''); setConfirmation(''); setMessage('Conta atualizada com sucesso.')
    } catch (caught) { setError(caught.message) }
    finally { setBusy(false) }
  }
  return <AdminWorkspace title="Configurações da conta" {...props}>
    <div className="account-settings-layout">
    <section className="account-appearance-settings" aria-labelledby="account-appearance-title">
      <h2 id="account-appearance-title">Aparência</h2>
      <div className="account-theme-options" role="radiogroup" aria-label="Tema da conta">{[['light', 'Modo claro', Sun], ['dark', 'Modo escuro', Moon]].map(([value, label, Symbol]) => <label key={value} className={`account-theme-option${appearance?.theme === value ? ' selected' : ''}`}><input type="radio" name="account-theme" value={value} checked={(appearance?.theme || 'light') === value} disabled={appearance?.busy || appearance?.loading} onChange={() => appearance?.changeTheme(value)} /><Symbol size={20} /><span>{label}</span></label>)}</div>
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
    </section><form className="account-settings-form" onSubmit={save}>
    <fieldset disabled={busy}><h2>Dados da conta</h2><div className="account-settings-fields"><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="name" /></label><label>CPF<input value={user?.cpf || ''} readOnly /></label></div>
    <h2>Segurança</h2><div className="account-settings-fields"><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label><label>Nova senha<span className="account-password-input"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={72} autoComplete="new-password" /><button type="button" title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label><label>Confirmar nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required={Boolean(password)} minLength={password ? 6 : undefined} maxLength={72} autoComplete="new-password" /></label></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}{message && <p className="admin-tool-success" role="status">{message}</p>}<button className="admin-tool-button admin-tool-button--primary" type="submit"><Save size={16} />{busy ? 'Salvando...' : 'Salvar alterações'}</button></fieldset>
  </form><form className="account-settings-form account-notification-settings" onSubmit={saveNotifications}>
    <fieldset disabled={notificationLoading || notificationBusy}><h2>Notificações</h2><div className="account-settings-fields"><label>Contas a pagar a vencer<select aria-label="Contas a pagar a vencer" value={reminderDays} onChange={(event) => { setReminderDays(event.target.value); setNotificationMessage('') }}><option value="3">3 dias antes do vencimento</option><option value="5">5 dias antes do vencimento</option><option value="7">7 dias antes do vencimento</option><option value="never">Nunca</option></select></label></div>
      <div className="account-notification-options">{notificationOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={notificationPreferences[key]} onChange={(event) => { setNotificationPreferences((current) => ({ ...current, [key]: event.target.checked })); setNotificationMessage('') }} /><span>{label}</span></label>)}</div>
      {notificationError && <p className="admin-tool-error" role="alert">{notificationError}</p>}{notificationMessage && <p className="admin-tool-success" role="status">{notificationMessage}</p>}<button className="admin-tool-button admin-tool-button--primary" type="submit"><Save size={16} />{notificationBusy ? 'Salvando...' : 'Salvar notificações'}</button>
    </fieldset>
  </form></div></AdminWorkspace>
}
