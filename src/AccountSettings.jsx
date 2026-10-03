import { useState } from 'react'
import { Save, Eye, EyeOff } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'

export default function AccountSettings({ user, onUpdateUser, ...props }) {
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
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
  return <AdminWorkspace title="Configurações da conta" {...props}><form className="account-settings-form" onSubmit={save}>
    <fieldset disabled={busy}><h2>Dados da conta</h2><div className="account-settings-fields"><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="name" /></label><label>CPF<input value={user?.cpf || ''} readOnly /></label></div>
    <h2>Segurança</h2><div className="account-settings-fields"><label>Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label><label>Nova senha<span className="account-password-input"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={72} autoComplete="new-password" /><button type="button" title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label><label>Confirmar nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required={Boolean(password)} minLength={password ? 6 : undefined} maxLength={72} autoComplete="new-password" /></label></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}{message && <p className="admin-tool-success" role="status">{message}</p>}<button className="admin-tool-button admin-tool-button--primary" type="submit"><Save size={16} />{busy ? 'Salvando...' : 'Salvar alterações'}</button></fieldset>
  </form></AdminWorkspace>
}
