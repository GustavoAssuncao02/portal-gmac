import { useEffect, useState } from 'react'
import { Eye, EyeOff, Info, KeyRound, Save } from 'lucide-react'
import { payableRequest } from './payablesApi.js'
import { PayableModal } from './PayableModal.jsx'

const userMask = (value) => String(value || '').replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const changeLabel = (row) => [row.changes.includes('username') && `Usuário: ${row.usernameBefore ? userMask(row.usernameBefore) : '—'} → ${userMask(row.usernameAfter)}`, row.changes.includes('password') && 'Senha alterada'].filter(Boolean).join(' · ')

// Shared login of the shop-floor tablets. Settings show a summary; the change opens in a dialog, asks for a reason and is kept.
export default function OperatorAccessSettings() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState(false), [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [reason, setReason] = useState(''), [show, setShow] = useState(false)
  useEffect(() => {
    let active = true
    payableRequest('/operator-account').then((result) => { if (active) { setData(result); setUsername(userMask(result.username)) } }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [])
  function openEditor() {
    setUsername(userMask(data.username)); setPassword(''); setConfirmation(''); setReason(''); setShow(false); setError(''); setMessage('')
    setEditing(true)
  }
  async function save(event) {
    event.preventDefault()
    setError(''); setMessage('')
    if (password && password !== confirmation) return setError('A confirmação da senha do operador não confere.')
    setBusy(true)
    try {
      const result = await payableRequest('/operator-account', 'PUT', { username: username.replace(/\D/g, ''), password, reason })
      setData(result); setUsername(userMask(result.username)); setPassword(''); setConfirmation(''); setReason('')
      setMessage(password ? 'Acesso do operador atualizado. Os tablets conectados precisam entrar de novo com a nova senha.' : 'Usuário do operador atualizado.')
      setEditing(false)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const last = data?.history?.[0]
  return <section className="account-summary-card operator-access-settings" aria-labelledby="operator-access-title">
    <header><h2 id="operator-access-title">Acesso do operador</h2><button className="admin-tool-button" type="button" disabled={!data} onClick={openEditor}><KeyRound size={16} />Alterar acesso do operador</button></header>
    <p className="payable-muted">Login compartilhado dos tablets da produção. Cada operador ainda se identifica pelo seu código de 4 dígitos.</p>
    <dl className="account-summary"><div><dt>Usuário do operador</dt><dd>{data ? userMask(data.username) || '—' : 'Carregando...'}</dd></div>
      <div><dt>Senha</dt><dd className="operator-access-last">{data?.passwordChangedAt ? <span>Alterada em {moment(data.passwordChangedAt)}</span> : <span>{data?.source === 'env' ? 'Definida na instalação do servidor' : data ? 'Ainda não definida' : '—'}</span>}
        <button className="payable-icon operator-access-info" type="button" title="Histórico de alterações" aria-label="Histórico de alterações do acesso do operador" disabled={!data} onClick={() => setHistory(true)}><Info size={16} /></button></dd></div></dl>
    {!editing && error && <p className="admin-tool-error" role="alert">{error}</p>}{message && <p className="admin-tool-success" role="status">{message}</p>}
    {editing && <PayableModal title="Acesso do operador" className="account-settings-modal" busy={busy} onClose={() => setEditing(false)} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form="operator-access-form" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : 'Salvar acesso do operador'}</button></>}>
      <form id="operator-access-form" className="account-settings-form" onSubmit={save}><fieldset disabled={busy}>
        <p className="payable-muted">Ao trocar a senha, os tablets conectados precisam entrar de novo. Toda alteração fica no histórico com a justificativa.</p>
        <div className="account-settings-fields">
          <label>Usuário do operador<input value={username} onChange={(event) => setUsername(userMask(event.target.value))} inputMode="numeric" placeholder="000.000.000-00" required autoComplete="off" /><small className="payable-hint">11 dígitos, digitados no login do operador.</small></label>
          <label>Nova senha do operador<span className="account-password-input"><input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={72} required={data?.source !== 'database'} autoComplete="new-password" placeholder={data?.source === 'database' ? 'Deixe em branco para manter' : ''} /><button type="button" title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-label={show ? 'Ocultar senha do operador' : 'Mostrar senha do operador'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <label>Confirmar senha do operador<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required={Boolean(password)} maxLength={72} autoComplete="new-password" /></label>
        </div>
        <label className="operator-access-reason">Justificativa da alteração<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={1000} rows={3} placeholder="Ex.: troca periódica da senha; ex-funcionário conhecia a senha anterior." /></label>
        {error && <p className="admin-tool-error" role="alert">{error}</p>}
      </fieldset></form>
    </PayableModal>}
    {history && <PayableModal title="Histórico do acesso do operador" onClose={() => setHistory(false)}>
      {data.history.length ? <ol className="payable-history">{data.history.map((row) => <li key={row.id}><div><strong>{changeLabel(row)}</strong></div><small>{moment(row.at)} · {row.userName}</small><p>Justificativa: {row.reason}</p></li>)}</ol> : <p className="payable-muted">Nenhuma alteração registrada ainda.{last ? '' : ' A senha em uso é a definida na instalação do servidor.'}</p>}
    </PayableModal>}
  </section>
}
