import { useEffect, useState } from 'react'
import { User, KeyRound, Lock, Eye, EyeOff } from 'lucide-react'

const post = async (path, body) => {
  const response = await fetch(`/api/auth/password-reset/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir agora. Tente novamente.')
  return data
}

// "Esqueci minha senha": CPF → 6-digit code sent to the e-mail of the registration → new password.
export default function PasswordRecovery({ initialCpf = '', onDone, onCancel }) {
  const [step, setStep] = useState('cpf'), [cpf, setCpf] = useState(initialCpf), [code, setCode] = useState(''), [token, setToken] = useState('')
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false), [wait, setWait] = useState(0)
  useEffect(() => {
    if (!wait) return undefined
    const timer = setTimeout(() => setWait((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])
  const say = (text, isError = false) => { setMessage(text); setError(isError) }

  async function run(action) {
    setBusy(true)
    try { await action() } catch (caught) { say(caught.message, true) } finally { setBusy(false) }
  }
  const requestCode = () => run(async () => {
    const data = await post('request', { cpf })
    setCode(''); setStep('code'); setWait(60)
    say(`${data.message} O código vale por ${data.expiresInMinutes} minutos. Confira também a caixa de spam.`)
  })
  function submit(event) {
    event.preventDefault()
    if (step === 'cpf') {
      if (!/^\d{11}$/.test(cpf)) return say('Informe os 11 dígitos do CPF, sem pontos ou traços.', true)
      return requestCode()
    }
    if (step === 'code') {
      if (!/^\d{6}$/.test(code)) return say('Informe os 6 dígitos do código.', true)
      return run(async () => { const data = await post('verify', { cpf, code }); setToken(data.resetToken); setStep('password'); say('Código confirmado. Crie a nova senha.') })
    }
    if (password.length < 6 || password.length > 72) return say('A nova senha deve ter entre 6 e 72 caracteres.', true)
    if (password !== confirm) return say('As duas senhas não são iguais.', true)
    return run(async () => {
      try { const data = await post('complete', { resetToken: token, password }); onDone(data.message) } catch (caught) {
        // The time to set the password ran out: start again from the code.
        if (/Peça um novo código/.test(caught.message)) { setStep('cpf'); setPassword(''); setConfirm('') }
        throw caught
      }
    })
  }

  const passwordField = (id, label, value, setValue, labelClass) => <>
    <label className={`field-label ${labelClass}`} htmlFor={id}>{label}</label>
    <div className="input-wrap"><Lock /><input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={72} required value={value} onChange={(event) => setValue(event.target.value)} placeholder="Mínimo de 6 caracteres" />
      <button className="visibility-button" type="button" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((current) => !current)}>{show ? <EyeOff /> : <Eye />}</button></div>
  </>

  return <div className="password-recovery">
    <h2>Redefinir senha</h2>
    <p className="password-recovery__intro">{step === 'cpf' ? 'Informe seu CPF. Enviaremos um código de 6 dígitos para o e-mail do seu cadastro.' : step === 'code' ? 'Digite o código de 6 dígitos que chegou no seu e-mail.' : 'Crie a nova senha de acesso.'}</p>
    <form onSubmit={submit} noValidate>
      {step === 'cpf' && <><label className="field-label" htmlFor="recovery-cpf">CPF</label>
        <div className="input-wrap"><User /><input id="recovery-cpf" inputMode="numeric" autoComplete="username" placeholder="00000000000" value={cpf} onChange={(event) => setCpf(event.target.value.replace(/\D/g, '').slice(0, 11))} required autoFocus /></div></>}
      {step === 'code' && <><label className="field-label" htmlFor="recovery-code">Código</label>
        <div className="input-wrap"><KeyRound /><input id="recovery-code" className="password-recovery__code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus /></div></>}
      {step === 'password' && <>{passwordField('recovery-password', 'Nova senha', password, setPassword, '')}{passwordField('recovery-confirm', 'Repita a nova senha', confirm, setConfirm, 'password-label')}</>}
      <button className="submit-button" type="submit" disabled={busy}>{busy ? 'Aguarde...' : step === 'cpf' ? 'Enviar código' : step === 'code' ? 'Confirmar código' : 'Redefinir senha'}</button>
    </form>
    {step === 'code' && <button className="forgot-link" type="button" disabled={busy || wait > 0} onClick={requestCode}>{wait > 0 ? `Reenviar código em ${wait}s` : 'Reenviar código'}</button>}
    <button className="forgot-link" type="button" onClick={onCancel}>Voltar ao login</button>
    {message && <p className={`form-message${error ? ' form-message--error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
    <p className="password-recovery__help">Não tem acesso ao e-mail do cadastro? Fale com o TI para redefinir sua senha.</p>
  </div>
}
