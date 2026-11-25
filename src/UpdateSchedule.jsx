import { useCallback, useEffect, useId, useState } from 'react'
import { CalendarClock, CheckCircle2, PencilLine, XCircle } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { payableRequest } from './payablesApi.js'
import { todayBahia } from '../server/payableRules.js'

// Desenvolvedor › Programar atualização (server/updateSchedule.js): the day and the hour of the next update of the portal,
// the notices that go to everybody and, with the SaveInCloud token configured, the update made by the server itself.
const statusNames = { scheduled: 'Programada', done: 'Concluída', canceled: 'Cancelada', expired: 'Não executada' }
const statusOf = (row) => row.status === 'started' ? (row.mode === 'auto' ? 'Atualizando (automática)' : 'Aguardando a atualização manual') : statusNames[row.status] || row.status
const when = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
// The date and the hour of a moment as the inputs take them, in Bahia.
function inputsOf(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}
// Today at 19:00 (the usual hour), or tomorrow when 19:00 is less than 10 minutes away.
function defaultDraft() {
  const today = todayBahia(), evening = Date.parse(`${today}T19:00:00-03:00`)
  return { date: evening - Date.now() >= 10 * 60000 ? today : inputsOf(evening + 24 * 3600000).date, time: '19:00', message: '' }
}

function UpdateForm({ initial, submitLabel, busy, onSubmit, onCancel }) {
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const change = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }))
  return <form className="developer-update-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draft) }}>
    <fieldset disabled={busy}>
      <label htmlFor={`${id}-date`}>Data<input id={`${id}-date`} type="date" required min={todayBahia()} value={draft.date} onChange={change('date')} /></label>
      <label htmlFor={`${id}-time`}>Hora<input id={`${id}-time`} type="time" required value={draft.time} onChange={change('time')} /></label>
      <label htmlFor={`${id}-message`} className="developer-update-message">O que muda (opcional)<input id={`${id}-message`} type="text" maxLength={300} placeholder="Ex.: melhorias no Contas a Receber" value={draft.message} onChange={change('message')} /></label>
      <div className="developer-update-buttons">
        {onCancel && <button className="admin-tool-button" type="button" onClick={onCancel}>Voltar</button>}
        <button className="admin-tool-button admin-tool-button--primary" type="submit"><CalendarClock size={15} aria-hidden="true" />{busy ? 'Salvando...' : submitLabel}</button>
      </div>
    </fieldset>
  </form>
}

export default function UpdateSchedule({ refreshKey }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(null)
  const load = useCallback(() => payableRequest('/developer/updates').then((result) => { setData(result); setError('') }).catch((caught) => setError(caught.message)), [])
  useEffect(() => { load() }, [load, refreshKey])
  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await load(); setEditing(false); setConfirm(null); return true } catch (caught) { setError(caught.message); return false } finally { setBusy(false) }
  }
  const active = data?.items.find((row) => row.status === 'scheduled' || row.status === 'started') || null
  const past = (data?.items || []).filter((row) => row !== active)
  // Another update (or the same one, started) closes the form of a previous "Remarcar".
  const activeKey = active ? `${active.id}:${active.status}` : ''
  useEffect(() => { setEditing(false) }, [activeKey])
  return <section className="developer-section developer-update" aria-labelledby="developer-update-title">
    <div className="developer-section-heading"><h2 id="developer-update-title">Programar atualização</h2>
      {data && <small className={`developer-update-mode${data.automatic ? ' developer-update-mode--auto' : ''}`}>{data.automatic ? 'Modo automático (SaveInCloud)' : 'Modo manual'}</small>}</div>
    <p className="developer-update-note">Todos do portal administrativo recebem um aviso no sino quando a atualização é programada, remarcada ou cancelada, e de novo 5 minutos antes. Nos 2 minutos finais aparece uma contagem discreta no topo das telas. Vai para o ar o que estiver no <code>main</code> do GitHub no horário.</p>
    {data && <p className="developer-update-note">{data.automatic ? `No horário, o portal pede ao SaveInCloud a atualização do ambiente ${data.environment}, o mesmo que Implementações › ROOT › Atualizar.` : 'No horário, os desenvolvedores recebem um aviso no sino para atualizar pelo SaveInCloud (Implementações › ROOT › Atualizar). Para ser automática, configure SAVEINCLOUD_TOKEN e SAVEINCLOUD_ENV no servidor.'}</p>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!data ? !error && <p className="developer-empty" role="status">Carregando...</p> : active ? <article className={`developer-update-active developer-update-active--${active.status}`}>
      <div className="developer-update-info">
        <span className={`developer-update-status developer-update-status--${active.status}`}>{statusOf(active)}</span>
        <strong>{when(active.at)}</strong>
        {active.message && <p>{active.message}</p>}
        <small>Programada por {active.createdBy || '—'} em {when(active.createdAt)}{active.history.length ? ` · remarcada ${active.history.length} ${active.history.length === 1 ? 'vez' : 'vezes'}` : ''}</small>
        {active.error && <p className="developer-update-error" role="alert">{active.error}</p>}
      </div>
      <div className="developer-update-actions">
        {active.status === 'scheduled' && <><button className="admin-tool-button" type="button" disabled={busy || editing} onClick={() => setEditing(true)}><PencilLine size={15} aria-hidden="true" />Remarcar</button>
          <button className="admin-tool-button developer-update-cancel" type="button" disabled={busy} onClick={() => setConfirm('cancel')}><XCircle size={15} aria-hidden="true" />Cancelar atualização</button></>}
        {active.status === 'started' && <button className="admin-tool-button" type="button" disabled={busy} onClick={() => setConfirm('finish')}><CheckCircle2 size={15} aria-hidden="true" />Marcar como concluída</button>}
      </div>
      {editing && active.status === 'scheduled' && <UpdateForm key={active.id} initial={{ ...inputsOf(Date.parse(active.at)), message: active.message }} submitLabel="Salvar novo horário" busy={busy} onCancel={() => setEditing(false)} onSubmit={(draft) => run(() => payableRequest(`/developer/updates/${active.id}`, 'PUT', draft))} />}
    </article> : <UpdateForm initial={defaultDraft()} submitLabel="Programar atualização" busy={busy} onSubmit={(draft) => run(() => payableRequest('/developer/updates', 'POST', draft))} />}
    {past.length > 0 && <div className="developer-table-wrap developer-update-history"><table className="developer-table"><thead><tr><th>Data e hora</th><th>Situação</th><th>Programada por</th><th>Versão</th></tr></thead>
      <tbody>{past.map((row) => <tr key={row.id}><td data-label="Data e hora">{when(row.at)}{row.message && <small className="developer-update-row-message">{row.message}</small>}</td><td data-label="Situação">{statusOf(row)}{row.status === 'canceled' && row.canceledBy ? ` por ${row.canceledBy}` : ''}</td><td data-label="Programada por">{row.createdBy || '—'}</td><td data-label="Versão">{row.versionAfter ? `${row.versionBefore && row.versionBefore !== row.versionAfter ? `${row.versionBefore} → ` : ''}${row.versionAfter}` : '—'}</td></tr>)}</tbody></table></div>}
    {confirm && active && <PayableModal title={confirm === 'cancel' ? 'Cancelar a atualização?' : 'Marcar como concluída?'} busy={busy} onClose={() => setConfirm(null)} footer={<>
      <button className="admin-tool-button" type="button" disabled={busy} onClick={() => setConfirm(null)}>Voltar</button>
      <button className={`admin-tool-button admin-tool-button--primary${confirm === 'cancel' ? ' admin-tool-button--danger' : ''}`} type="button" disabled={busy} onClick={() => run(() => payableRequest(`/developer/updates/${active.id}/${confirm}`, 'POST'))}>{busy ? 'Salvando...' : confirm === 'cancel' ? 'Cancelar atualização' : 'Marcar como concluída'}</button>
    </>}>
      <p>{confirm === 'cancel' ? `A atualização de ${when(active.at)} será cancelada e todos recebem um aviso no sino.` : 'Use quando a atualização foi feita sem reiniciar o servidor ou quando ela não vai mais acontecer. Ninguém recebe aviso.'}</p>
    </PayableModal>}
  </section>
}
