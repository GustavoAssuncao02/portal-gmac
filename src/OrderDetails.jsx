import { useEffect, useRef, useState } from 'react'
import './orderDetails.css'
import { stageLabel } from '../server/serviceStages.js'
import OrderEditModal, { OrderActionModal } from './OrderEditModal.jsx'
import { activeEmployeeNames, activeSessions } from '../server/operationSessions.js'
import { timeEditableEvents } from '../server/operationEventTime.js'
import { osValueOf, proposalCosts, hoursText } from '../server/proposalMath.js'
import { pollWhileVisible } from './polling.js'
import { Info } from 'lucide-react'
import PieceTrack, { workingStageKeys } from './PieceTrack.jsx'
import { UndoAcceptModal } from './DeclineProposalModal.jsx'
import DownloadLink from './DownloadLink.jsx'
import { downloadFile } from './payablesApi.js'

const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Não informado'
const number = (value) => Number(value || 0).toLocaleString('pt-BR')
const duration = (value) => {
  const seconds = Math.floor(Math.max(0, Number(value || 0)) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}
const statusLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const eventLabels = { started: 'Início', resumed: 'Retomada', paused: 'Pausa', machine_changed: 'Troca de máquina', labor_service_changed: 'Troca de serviço de hora homem', resource_changed: 'Troca entre máquina e serviço', session_ended: 'Sessão encerrada na conclusão', stage_progress: 'Peças registradas', completed: 'Conclusão', completion_acknowledged: 'Conclusão confirmada no painel', admin_interrupted: 'Interrupção administrativa', stages_configured: 'Etapas configuradas', order_edited: 'OS editada', order_reopened: 'OS reaberta', order_created: 'OS criada', attachment_added: 'Anexo incluído', purchase_order_added: 'Pedido de compra anexado', purchase_order_removed: 'Pedido de compra removido', payable_event: 'Contas a pagar', receivable_event: 'Contas a receber', stage_changed: 'Troca de etapa', marked_atypical: 'Marcada como OS atípica', unmarked_atypical: 'Desmarcada como OS atípica' }

const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
// Operation times are typed and shown in Bahia time (UTC-3, without daylight saving time).
// Browsers drop zeroed seconds from a datetime-local value; both forms are handled.
const bahiaInput = (value) => new Date(new Date(value).getTime() - 3 * 3600000).toISOString().slice(0, 19).replace(/:00$/, '')
const bahiaInstant = (value) => new Date(`${value.length === 16 ? `${value}:00` : value}-03:00`).toISOString()

const fromCents = (cents) => currency(cents / 100)
const payableState = (row) => row.inactive ? 'Desativada' : row.payment ? 'Paga' : row.status === 'overdue' ? 'Vencida' : 'A pagar'

// Real cost of the OS: the cost planned in the proposal plus the payables linked to it later, compared with the OS price.
function OrderCosts({ code }) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetch(`/api/payables/order-costs/${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` } }).then(async (response) => {
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Não foi possível carregar os custos da OS.')
      if (active) setData(body.item)
    }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [code])
  const tone = !data || data.marginPercent == null ? '' : data.marginCents < 0 ? 'negative' : data.marginPercent < data.expectedMarginPercent ? 'below' : 'ok'
  return <section className="os-section os-costs"><div className="os-section-heading"><h3>Custo real e margem</h3>{data && <span>{data.payables.length} {data.payables.length === 1 ? 'custo adicional' : 'custos adicionais'}</span>}</div>
    {error ? <p className="os-empty">{error}</p> : !data ? <p className="os-empty">Carregando custos...</p> : <>
      <Facts className="os-cost-facts" items={[
        ['Valor da OS', data.discount ? `${fromCents(data.valueCents)} (com ${String(data.discount).replace('.', ',')}% de desconto)` : fromCents(data.valueCents)], ['Custo previsto na proposta', fromCents(data.estimatedCostCents)],
        ['Custos lançados', fromCents(data.costCents), data.extraCostCents ? `Previsto + ${fromCents(data.extraCostCents)} de custos adicionais${data.pendingCostCents ? ` (${fromCents(data.pendingCostCents)} a pagar)` : ''}` : 'Igual ao previsto na proposta'], ['Margem real', <span className={`order-margin order-margin--${tone}`}>{fromCents(data.marginCents)}{data.marginPercent == null ? '' : ` · ${String(data.marginPercent).replace('.', ',')}%`}</span>],
        ['Margem prevista', `${String(data.expectedMarginPercent).replace('.', ',')}%`], ['Recebimento do cliente', data.receivableCents ? `${fromCents(data.receivedCents)} recebido` : 'Nada lançado ainda', data.receivableCents ? `de ${fromCents(data.receivableCents)} lançado no contas a receber${data.receivableCents > data.receivedCents ? ` · faltam ${fromCents(data.receivableCents - data.receivedCents)}` : ' · tudo recebido'}` : 'O recebimento é programado no contas a receber quando a OS é concluída.'],
      ]} />
      {data.payables.length ? <ul className="os-cost-list">{data.payables.map((row) => <li key={row.id}><div><strong>{row.id} · {row.supplierName}</strong><span>{row.description || row.classificationName}</span></div><div><strong>{fromCents(row.payment ? row.payment.finalCents : row.valueCents)}</strong><span>{payableState(row)}</span></div></li>)}</ul> : <p className="os-empty">Nenhum custo adicional. Os custos previstos na proposta já estão lançados; se surgir uma compra além do previsto, vincule a conta a esta OS no campo "OS vinculada (custo)".</p>}
    </>}
  </section>
}

function Facts({ items, className = '' }) {
  return <dl className={`os-facts ${className}`}>{items.map(([label, value, detail]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Não informado'}{detail && <small>{detail}</small>}</dd></div>)}</dl>
}

function OrderHistoryModal({ order, onClose, onEditTime, Icon }) {
  const dialog = useRef(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [originalOpen, setOriginalOpen] = useState(null)
  const canEditTime = Boolean(onEditTime && sessionStorage.getItem('gmac-admin-token'))
  async function saveTime(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setEditing((current) => ({ ...current, error: '' }))
    try {
      await onEditTime(editing.id, bahiaInstant(editing.value))
      setEditing(null)
      setRetry((value) => value + 1)
    } catch (caught) {
      setEditing((current) => current && { ...current, error: caught.message || 'Não foi possível salvar o horário. Tente novamente.' })
    } finally { setSaving(false) }
  }
  function timeCell(event) {
    const label = eventLabels[event.type] || event.type
    if (editing?.id === event.id) return <form className="os-history-time-form" onSubmit={saveTime} aria-busy={saving}>
      <input type="datetime-local" step="1" required autoFocus aria-label={`Novo horário de ${label}`} value={editing.value} max={bahiaInput(Date.now())} disabled={saving} onChange={(change) => setEditing((current) => ({ ...current, value: change.target.value, error: '' }))} aria-invalid={Boolean(editing.error)} />
      <div><button className="os-button os-history-time-save" type="submit" disabled={saving || !editing.value || editing.value === editing.initial}>{saving ? 'Salvando...' : 'Salvar'}</button><button className="os-button" type="button" disabled={saving} onClick={() => setEditing(null)}>Cancelar</button></div>
      {editing.error && <p className="os-interrupt-error" role="alert">{editing.error}</p>}
    </form>
    const lastEdit = event.timeEdits?.at(-1)
    return <>
      <div className="os-history-time"><time dateTime={event.at}>{moment(event.at)}</time>{canEditTime && event.sessionId && timeEditableEvents.includes(event.type) && <button className="os-history-time-action" type="button" disabled={saving} aria-label={`Editar horário de ${label}`} title="Editar horário" onClick={() => { const value = bahiaInput(event.at); setEditing({ id: event.id, value, initial: value, error: '' }) }}><Icon name="edit" /></button>}</div>
      {event.originalAt && <div className="os-history-edited"><b>Horário editado</b><button className="os-history-time-action" type="button" aria-label={`Ver horário original de ${label}`} title="Ver horário original" aria-expanded={originalOpen === event.id} onClick={() => setOriginalOpen((current) => current === event.id ? null : event.id)}><Info size={15} aria-hidden="true" /></button></div>}
      {event.originalAt && originalOpen === event.id && <p className="os-history-original" role="note"><strong>Horário original: {moment(event.originalAt)}</strong>{lastEdit && <small>Editado por {lastEdit.adminName} em {moment(lastEdit.editedAt)}</small>}</p>}
    </>
  }
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const token = sessionStorage.getItem('gmac-admin-token')
        const response = await fetch(`/api/operations/orders/${encodeURIComponent(order.code)}/events`, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Não foi possível carregar o histórico.')
        if (!controller.signal.aborted) { setItems([...data.items].reverse()); setError('') }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught.message)
      } finally {
        fetching = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    const stopPolling = pollWhileVisible(load, 10000)
    return () => { stopPolling(); controller.abort() }
  }, [order.code, retry])
  return <dialog ref={dialog} className="os-history-modal" aria-labelledby="os-history-title" onCancel={(event) => { event.preventDefault(); if (editing) { if (!saving) setEditing(null) } else onClose() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
  }}>
    <header className="os-history-heading"><div><h2 id="os-history-title">Histórico de operações</h2><p>{order.code} · {order.service}</p></div><button className="os-icon-button" type="button" onClick={onClose} aria-label="Fechar histórico" title="Fechar histórico">{'\u00d7'}</button></header>
    <div className="os-history-content" aria-busy={loading}>
      {error && <div className="os-history-error"><p role="alert">{error}</p><button className="os-button" type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1) }}><Icon name="expand" />Tentar novamente</button></div>}
      {loading ? <p className="os-history-empty" role="status">Carregando operações...</p> : !error && !items.length ? <p className="os-history-empty">Nenhuma interação registrada.</p> : items.length > 0 && <>
        <p className="os-history-count" role="status">{items.length} {items.length === 1 ? 'operação registrada' : 'operações registradas'}</p>
        <div className="os-history-table-wrap"><table><thead><tr><th>Data e hora</th><th>Operação</th><th>Responsável</th><th>Detalhes</th></tr></thead><tbody>{items.map((event) => <tr key={event.id}>
          <td>{timeCell(event)}</td><td><strong>{eventLabels[event.type] || event.type}</strong></td><td>{event.employeeName || 'Administrador'}{event.affectedEmployeeName && <small>Operador: {event.affectedEmployeeName}</small>}</td><td>{event.reason && <span>{event.reason}</span>}{event.workStageName && event.type !== 'stage_changed' && <span>Etapa: {event.workStageName}</span>}{event.stageName && <span>{event.stageName}: +{number(event.quantity)} peça(s), {number(event.stageTotal)}/{number(order.quantity)} no total</span>}{event.details && <span>{Array.isArray(event.details) ? event.details.join(', ') : String(event.details)}</span>}{event.lines?.length > 0 && <ul className="os-history-changes">{event.lines.map((line) => <li key={line}>{line}</li>)}</ul>}{event.durationMs != null && <span>{event.type === 'machine_changed' ? 'Tempo na máquina anterior' : 'Tempo da sessão'}: {duration(event.durationMs)}</span>}{!event.reason && !event.stageName && !event.details && event.durationMs == null && '—'}</td>
        </tr>)}</tbody></table></div>
      </>}
    </div>
  </dialog>
}

function InterruptSessionModal({ order, onConfirm, onClose, Icon }) {
  const dialog = useRef(null)
  const submitting = useRef(false)
  const sessions = activeSessions(order.operation)
  const [reason, setReason] = useState('')
  const [sessionId, setSessionId] = useState(sessions.length === 1 ? sessions[0].id : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    element.querySelector('textarea').focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true }) }
  }, [])
  function close() {
    if (!submitting.current) onClose()
  }
  async function submit(event) {
    event.preventDefault()
    if (submitting.current) return
    if (!sessionId) {
      setError('Selecione o funcionário cuja sessão será encerrada.')
      dialog.current.querySelector('select')?.focus()
      return
    }
    if (!reason.trim()) {
      setError('Informe a justificativa da interrupção.')
      dialog.current.querySelector('textarea').focus()
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim(), sessionId)
      onClose()
    } catch (caught) {
      setError(caught.message || 'Não foi possível encerrar a sessão. Tente novamente.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <dialog ref={dialog} className="os-history-modal os-interrupt-modal" aria-labelledby="os-interrupt-title" onCancel={(event) => { event.preventDefault(); close() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
  }}>
    <header className="os-history-heading"><div><h2 id="os-interrupt-title">Encerrar sessão de trabalho</h2><p>{order.code} · {order.service}</p></div><button className="os-icon-button" type="button" onClick={close} disabled={busy} aria-label="Fechar janela" title="Fechar janela">{'\u00d7'}</button></header>
    <form className="os-interrupt-form" onSubmit={submit} aria-busy={busy}>
      {sessions.length > 1 ? <><label htmlFor="os-interrupt-session">Funcionário <span>(obrigatório)</span></label><select id="os-interrupt-session" className="os-interrupt-session" value={sessionId} disabled={busy} onChange={(event) => { setSessionId(event.target.value); setError('') }}><option value="">Selecione o funcionário</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.employeeName}{session.machineName || session.laborServiceName ? ` · ${session.machineName || session.laborServiceName}` : ''}</option>)}</select></> : <p className="os-interrupt-operator">Operador: <strong>{sessions[0]?.employeeName || 'Não informado'}</strong></p>}
      <label htmlFor="os-interrupt-reason">Justificativa <span>(obrigatória)</span></label>
      <textarea id="os-interrupt-reason" autoFocus required maxLength={250} rows={4} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={error ? 'os-interrupt-error' : undefined} />
      {error && <p id="os-interrupt-error" className="os-interrupt-error" role="alert">{error}</p>}
      <footer className="os-interrupt-actions"><button className="os-button" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="os-button os-interrupt-confirm" type="submit" disabled={busy}><Icon name="admins" />{busy ? 'Encerrando...' : 'Encerrar sessão'}</button></footer>
    </form>
  </dialog>
}

const authHeaders = () => { const token = window.sessionStorage.getItem('gmac-admin-token'); return token ? { Authorization: `Bearer ${token}` } : {} }
// Purchase orders used for billing: only the administrative portal shows them; operators never receive these files.
// An atypical OS (redone piece, broken machine…) is left out of the averages of material and time of its piece.
function AtypicalToggle({ order, onChanged }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [checked, setChecked] = useState(Boolean(order.atypical))
  useEffect(() => { setChecked(Boolean(order.atypical)) }, [order.atypical])
  const hint = 'OS atípica: o tempo das tarefas e o material desta OS não serão levados em consideração para cálculos futuros da peça.'
  async function change(event) {
    const next = event.target.checked
    setBusy(true); setError(''); setChecked(next)
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.code)}/atypical`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ atypical: next }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Não foi possível salvar.')
      await onChanged?.()
    } catch (caught) { setChecked(!next); setError(caught.message) } finally { setBusy(false) }
  }
  return <div className="os-atypical"><label><input type="checkbox" checked={checked} disabled={busy} onChange={change} />OS atípica</label><span className="os-atypical-info" tabIndex={0} role="note" aria-label={hint}><Info size={14} aria-hidden="true" /><span className="os-atypical-tip" aria-hidden="true">{hint}</span></span>{error && <small role="alert">{error}</small>}</div>
}

function PurchaseOrders({ order, onChanged, Icon }) {
  const input = useRef(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const files = order.purchaseOrders || [], base = `/api/orders/${encodeURIComponent(order.code)}/purchase-orders`
  async function run(task) {
    setBusy(true); setError('')
    try { await task(); await onChanged?.() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const check = async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Não foi possível concluir a operação.'); return response }
  const upload = (list) => run(async () => { for (const file of list) { if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: o arquivo deve ter até 20 MB.`); await check(await fetch(`${base}?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' }, body: file })) } })
  async function download(file) {
    setError('')
    try { const blob = await (await check(await fetch(`${base}/${file.id}`, { headers: authHeaders() }))).blob(); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch (caught) { setError(caught.message) }
  }
  const remove = (file) => { if (window.confirm(`Remover o anexo "${file.name}"?`)) run(async () => { await check(await fetch(`${base}/${file.id}`, { method: 'DELETE', headers: authHeaders() })) }) }
  return <section className="os-section os-attachments os-purchase-orders"><div className="os-section-heading"><h3>Anexos de pedido de compra</h3><span>{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</span><button type="button" className="os-purchase-add" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Enviando...' : 'Anexar pedido de compra'}</button><input ref={input} type="file" multiple hidden aria-label="Arquivo do pedido de compra" onChange={(event) => { const list = [...event.target.files]; event.target.value = ''; if (list.length) upload(list) }} /></div>
    <p className="os-purchase-hint">Visível somente para administradores e funcionários administrativos. Usado no faturamento do serviço.</p>
    {files.length ? <ul>{files.map((file) => <li key={file.id}><button type="button" className="os-purchase-file" onClick={() => download(file)}><Icon name="orders" /><span>{file.name}</span><small>{file.uploadedBy ? `${file.uploadedBy} · ` : ''}{file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : ''}</small></button><button type="button" className="os-purchase-remove" disabled={busy} aria-label={`Remover ${file.name}`} title="Remover" onClick={() => remove(file)}>×</button></li>)}</ul> : <p className="os-empty">Nenhum pedido de compra anexado.</p>}
    {error && <p className="workflow-error" role="alert">{error}</p>}
  </section>
}

export default function OrderDetails({ order, activeTime, stageNamesInput, onChangeStages, onConfigureStages, onInterrupt, onEdit, onReopen, onUpload, onEditEventTime, onRefresh, operationError, onBack, Icon }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [unaccepting, setUnaccepting] = useState(false)
  const [interruptOpen, setInterruptOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editConfirmed, setEditConfirmed] = useState(false)
  const [action, setAction] = useState(null)
  const operation = order.operation
  const proposal = order.proposal || {}
  const materials = order.resources?.materials || []
  const labor = order.resources?.laborEntries || []
  const proposalStages = proposal.stages || order.resources?.stages || []
  // The service value is the cost (materials + labor); proposals saved before the OS value existed kept the price in it.
  const serviceCost = proposal.osValue != null ? Number(proposal.serviceValue) || 0 : (Number(proposal.materials) || 0) + (Number(proposal.labor) || 0)
  return <article className="order-detail-card os-detail">
    <header className="os-detail-heading"><div className="os-detail-title"><button className="os-icon-button" type="button" onClick={onBack} aria-label="Voltar para a tela anterior" title="Voltar para a tela anterior"><Icon name="collapse" /></button><div><span>{order.code}</span><h2>{order.service}</h2><AtypicalToggle order={order} onChanged={onRefresh} /></div></div><div className="os-detail-actions">{operation?.status === 'waiting' && !operation.startedAt && <button className="os-button os-undo-accept" type="button" aria-haspopup="dialog" onClick={() => setUnaccepting(true)}>Desfazer aceite</button>}<button className="os-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setEditConfirmed(false); if (operation?.status === 'completed') setAction('edit'); else setEditOpen(true) }}><Icon name="edit" />Editar OS</button>{operation?.status === 'completed' && <button className="os-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setAction('reopen') }}><Icon name="expand" />Reabrir OS</button>}<button className="os-icon-button os-history-trigger os-info-trigger" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setHistoryOpen(true) }} aria-haspopup="dialog" aria-label="Histórico de operações" title="Histórico da OS: tudo o que foi feito, quem fez e quando"><Info size={20} aria-hidden="true" /></button></div></header>
    <Facts className="os-order-summary" items={[
      ['Cliente', order.company, `CNPJ: ${order.cnpj || 'Não informado'}`], ['Número da etiqueta', order.labelNumber], ['Quantidade', `${number(order.quantity)} unidades`],
      ['Prazo solicitado', date(order.deadline), order.deadlineChange && <span className="os-deadline-changed" title={`De ${date(order.deadlineChange.from)} para ${date(order.deadlineChange.to)} em ${moment(order.deadlineChange.at)}. Justificativa: ${order.deadlineChange.reason}`}>Prazo alterado por {order.deadlineChange.by}</span>], ['Solicitação', date(order.requestedAt)], ['OS criada em', date(order.createdAt)],
    ]} />
    <div className="os-detail-layout"><div className="os-detail-primary">
      {operation && <section className="os-section os-operation"><div className="os-section-heading"><h3>Operação da OS</h3><span className={`os-status os-status--${operation.status}`}>{statusLabels[operation.status] || operation.status}</span></div>
        <Facts className="os-operation-facts" items={[
          ['Tempo ativo acumulado', activeTime], ['Progresso total', `${number(operation.progress)}%`], [activeSessions(operation).length > 1 ? 'Operadores atuais' : 'Operador atual', activeEmployeeNames(operation) || 'Sem sessão ativa'],
        ]} />
        {operation.stages.length ? <div className="os-stage-list">{operation.stages.map((stage, index) => <div key={stage.key}><span className="os-stage-number">{index + 1}</span><div><strong>{stage.name}</strong><span>{number(operation.stageCounts[stage.key])}/{number(order.quantity)} peças</span></div><PieceTrack count={operation.stageCounts[stage.key]} quantity={order.quantity} working={workingStageKeys(operation, order.quantity).has(stage.key)} label={stage.name} className="os-stage-pieces" /></div>)}</div> : operation.status === 'waiting' && <div className="os-stage-setup"><label htmlFor="os-stage-input">Etapas na ordem de produção</label><div><input id="os-stage-input" value={stageNamesInput} onChange={(event) => onChangeStages(event.target.value)} placeholder="Ex.: Corte, Usinagem, Soldagem" /><button className="os-button" type="button" onClick={onConfigureStages}><Icon name="plus" />Salvar etapas</button></div></div>}
        {activeSessions(operation).length > 0 && <button className="os-button os-interrupt-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setInterruptOpen(true) }}><Icon name="admins" />Encerrar sessão ativa com justificativa</button>}
        {operationError && <p className="workflow-error" role="alert">{operationError}</p>}
      </section>}
      <section className="os-section"><div className="os-section-heading"><h3>Descrição do serviço</h3></div><p className="os-description">{order.description || 'Nenhuma descrição informada.'}</p></section>
      <section className="os-section"><div className="os-section-heading"><h3>Materiais necessários</h3><span>{materials.length} {materials.length === 1 ? 'material' : 'materiais'}</span></div>{materials.length ? <div className="os-resource-table-wrap"><table className="os-resource-table"><thead><tr><th>Material / Especificação</th><th>Quantidade</th><th>Valor total</th></tr></thead><tbody>{materials.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.detail || 'Sem especificação'}</small></td><td>{number(item.quantity)} kg</td><td>{currency(item.quantity * item.unitPrice)}</td></tr>)}</tbody></table></div> : <p className="os-empty">Nenhum material informado.</p>}</section>
      <section className="os-section"><div className="os-section-heading"><h3>Mão de obra</h3><span>{labor.length} {labor.length === 1 ? 'registro' : 'registros'}</span></div>{labor.length ? <div className="os-resource-table-wrap"><table className="os-resource-table"><thead><tr><th>Recurso</th><th>Tempo</th><th>Valor total</th></tr></thead><tbody>{labor.map((item) => <tr key={item.id}><td><strong>{item.resource}</strong><small>{item.type === 'machine' ? 'Hora máquina' : 'Profissional'}</small></td><td>{number(item.hours)} h</td><td>{currency(item.hours * item.hourlyRate)}</td></tr>)}</tbody></table></div> : <p className="os-empty">Nenhuma mão de obra informada.</p>}</section>
    </div><div className="os-detail-secondary">
      <section className="os-section os-proposal"><div className="os-section-heading"><h3>Proposta aceita</h3><span className="os-proposal-option">Opção {proposal.key || '—'}</span></div>{proposal.title && proposal.title !== `Opção ${proposal.key}` && <p className="os-proposal-title">{proposal.title}</p>}
        <Facts className="os-proposal-summary" items={[
          ['Valor da OS', currency(osValueOf(proposal))], ['Prazo acordado', date(proposal.deadline)],
        ]} />
        <h4>Composição e condições</h4><Facts className="os-proposal-values" items={[
          ['Materiais', currency(proposal.materials)], ['Mão de obra', currency(proposal.labor)], ['Valor do serviço', currency(serviceCost)], ['Lucro bruto', currency(osValueOf(proposal) - serviceCost)], ['Desconto', `${number(proposal.discount)}%`], ['Margem', `${number(proposal.margin)}%`],
        ]} />
        <h4>Planejamento</h4><Facts className="os-planning-facts" items={[
          ['Tipo', (proposal.kind || order.resources?.kind) === 'product' ? 'Produto' : 'Serviço'], ['Tempo de máquina', proposal.machine || 'Não informado'], ['Tempo de serviço', proposal.serviceTime || 'Não informado'], ['Horas totais', proposal.totalTime || hoursText(proposalCosts(order.resources).totalHours)],
          ['Processo', order.resources?.strictProcess === false ? 'Etapas livres' : 'Sequência obrigatória'],
          ['Fabricado a partir de', order.resources?.manufacturedFrom === 'sample' ? 'Amostra' : order.resources?.manufacturedFrom === 'drawing' ? 'Desenho' : 'Não informado'], ['Têmpera', order.resources?.tempering === true ? 'Sim' : order.resources?.tempering === false ? 'Não' : 'Não informada'], ...(proposalStages.includes('painting') ? [['Cor/Tipo', order.resources?.paintColor || 'Não informado']] : []),
        ]} />
        {order.resources?.serviceDescription && <p className="os-description">{order.resources.serviceDescription}</p>}
        <div className="os-proposal-stages"><span>Etapas do serviço</span>{proposalStages.length ? <ol>{proposalStages.map((stage, index) => <li key={stage}><b>{index + 1}</b>{stageLabel(stage)}</li>)}</ol> : <p className="os-empty">A definir</p>}</div>
        <button className="os-button os-download-button" type="button" onClick={() => downloadFile(`/api/offers/${order.offerId}/proposal.pdf`, `proposta-${order.code}.pdf`).catch((caught) => window.alert(caught.message))}><Icon name="orders" />Baixar PDF da proposta</button>
      </section>
      <OrderCosts code={order.code} />
      <section className="os-section os-attachments"><div className="os-section-heading"><h3>Anexos da OS</h3><span>{order.attachments?.length || 0} {order.attachments?.length === 1 ? 'arquivo' : 'arquivos'}</span></div>{order.attachments?.length ? <ul>{order.attachments.map((attachment) => <li key={attachment.id}><DownloadLink className="os-attachment-download" url={`/api/offers/${order.offerId}/attachments/${attachment.id}`} name={attachment.name}><Icon name="orders" /><span>{attachment.name}</span><Icon name="expand" /></DownloadLink></li>)}</ul> : <p className="os-empty">Nenhum anexo.</p>}</section>
      <PurchaseOrders order={order} onChanged={onRefresh} Icon={Icon} />
    </div></div>
    {unaccepting && <UndoAcceptModal orderCode={order.code} onConfirm={async () => { const response = await fetch(`/api/offers/${encodeURIComponent(order.offerId)}/unaccept`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Não foi possível desfazer o aceite.'); await onRefresh?.(); onBack() }} onClose={() => setUnaccepting(false)} />}
    {historyOpen && <OrderHistoryModal order={order} onClose={() => setHistoryOpen(false)} onEditTime={onEditEventTime} Icon={Icon} />}
    {interruptOpen && <InterruptSessionModal order={order} onConfirm={onInterrupt} onClose={() => setInterruptOpen(false)} Icon={Icon} />}
    {action && <OrderActionModal order={order} action={action} onClose={() => setAction(null)} onConfirm={action === 'reopen' ? onReopen : () => { setEditConfirmed(true); setEditOpen(true) }} />}
    {editOpen && <OrderEditModal order={order} confirmCompleted={editConfirmed} onSave={onEdit} onUpload={onUpload} onClose={() => setEditOpen(false)} />}
  </article>
}
