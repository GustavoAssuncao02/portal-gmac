import { useEffect, useRef, useState } from 'react'
import './orderDetails.css'
import { stageLabel } from '../server/serviceStages.js'
import OrderEditModal, { OrderActionModal } from './OrderEditModal.jsx'
import { activeEmployeeNames, activeSessions } from '../server/operationSessions.js'

const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Não informado'
const number = (value) => Number(value || 0).toLocaleString('pt-BR')
const duration = (value) => {
  const seconds = Math.floor(Math.max(0, Number(value || 0)) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
}
const statusLabels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const eventLabels = { started: 'Início', resumed: 'Retomada', paused: 'Pausa', machine_changed: 'Troca de máquina', labor_service_changed: 'Troca de serviço de hora homem', resource_changed: 'Troca entre máquina e serviço', session_ended: 'Sessão encerrada na conclusão', stage_progress: 'Peças registradas', completed: 'Conclusão', completion_acknowledged: 'Conclusão confirmada no painel', admin_interrupted: 'Interrupção administrativa', stages_configured: 'Etapas configuradas', order_edited: 'OS editada', order_reopened: 'OS reaberta' }

function Facts({ items, className = '' }) {
  return <dl className={`os-facts ${className}`}>{items.map(([label, value, detail]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Não informado'}{detail && <small>{detail}</small>}</dd></div>)}</dl>
}

function OrderHistoryModal({ order, onClose, Icon }) {
  const dialog = useRef(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
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
    const timer = window.setInterval(load, 10000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [order.code, retry])
  return <dialog ref={dialog} className="os-history-modal" aria-labelledby="os-history-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
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
          <td>{new Date(event.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}</td><td><strong>{eventLabels[event.type] || event.type}</strong></td><td>{event.employeeName || 'Administrador'}{event.affectedEmployeeName && <small>Operador: {event.affectedEmployeeName}</small>}</td><td>{event.reason && <span>{event.reason}</span>}{event.stageName && <span>{event.stageName}: +{number(event.quantity)} peça(s), {number(event.stageTotal)}/{number(order.quantity)} no total</span>}{event.details && <span>{Array.isArray(event.details) ? event.details.join(', ') : String(event.details)}</span>}{event.durationMs != null && <span>{event.type === 'machine_changed' ? 'Tempo na máquina anterior' : 'Tempo da sessão'}: {duration(event.durationMs)}</span>}{!event.reason && !event.stageName && !event.details && event.durationMs == null && '—'}</td>
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

export default function OrderDetails({ order, activeTime, stageNamesInput, onChangeStages, onConfigureStages, onInterrupt, onEdit, onReopen, onUpload, operationError, onBack, Icon }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [interruptOpen, setInterruptOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editConfirmed, setEditConfirmed] = useState(false)
  const [action, setAction] = useState(null)
  const operation = order.operation
  const proposal = order.proposal || {}
  const materials = order.resources?.materials || []
  const labor = order.resources?.laborEntries || []
  const proposalStages = proposal.stages || order.resources?.stages || []
  return <article className="order-detail-card os-detail">
    <header className="os-detail-heading"><div className="os-detail-title"><button className="os-icon-button" type="button" onClick={onBack} aria-label="Voltar à lista de ordens" title="Voltar à lista de ordens"><Icon name="collapse" /></button><div><span>{order.code}</span><h2>{order.service}</h2></div></div><div className="os-detail-actions"><button className="os-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setEditConfirmed(false); if (operation?.status === 'completed') setAction('edit'); else setEditOpen(true) }}><Icon name="edit" />Editar OS</button>{operation?.status === 'completed' && <button className="os-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setAction('reopen') }}><Icon name="expand" />Reabrir OS</button>}<button className="os-button os-history-trigger" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setHistoryOpen(true) }} aria-haspopup="dialog"><Icon name="services" />Histórico de operações</button></div></header>
    <Facts className="os-order-summary" items={[
      ['Cliente', order.company, `CNPJ: ${order.cnpj || 'Não informado'}`], ['Número da etiqueta', order.labelNumber], ['Quantidade', `${number(order.quantity)} unidades`],
      ['Prazo solicitado', date(order.deadline)], ['Solicitação', date(order.requestedAt)], ['OS criada em', date(order.createdAt)],
    ]} />
    <div className="os-detail-layout"><div className="os-detail-primary">
      {operation && <section className="os-section os-operation"><div className="os-section-heading"><h3>Operação da OS</h3><span className={`os-status os-status--${operation.status}`}>{statusLabels[operation.status] || operation.status}</span></div>
        <Facts className="os-operation-facts" items={[
          ['Tempo ativo acumulado', activeTime], ['Progresso total', `${number(operation.progress)}%`], [activeSessions(operation).length > 1 ? 'Operadores atuais' : 'Operador atual', activeEmployeeNames(operation) || 'Sem sessão ativa'],
        ]} />
        {operation.stages.length ? <div className="os-stage-list">{operation.stages.map((stage, index) => <div key={stage.key}><span className="os-stage-number">{index + 1}</span><div><strong>{stage.name}</strong><span>{number(operation.stageCounts[stage.key])}/{number(order.quantity)} peças</span></div><progress value={operation.stageCounts[stage.key] || 0} max={Number(order.quantity) || 1} aria-label={`Progresso de ${stage.name}`} /></div>)}</div> : operation.status === 'waiting' && <div className="os-stage-setup"><label htmlFor="os-stage-input">Etapas na ordem de produção</label><div><input id="os-stage-input" value={stageNamesInput} onChange={(event) => onChangeStages(event.target.value)} placeholder="Ex.: Corte, Usinagem, Soldagem" /><button className="os-button" type="button" onClick={onConfigureStages}><Icon name="plus" />Salvar etapas</button></div></div>}
        {activeSessions(operation).length > 0 && <button className="os-button os-interrupt-button" type="button" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setInterruptOpen(true) }}><Icon name="admins" />Encerrar sessão ativa com justificativa</button>}
        {operationError && <p className="workflow-error" role="alert">{operationError}</p>}
      </section>}
      <section className="os-section"><div className="os-section-heading"><h3>Descrição do serviço</h3></div><p className="os-description">{order.description || 'Nenhuma descrição informada.'}</p></section>
      <section className="os-section"><div className="os-section-heading"><h3>Materiais necessários</h3><span>{materials.length} {materials.length === 1 ? 'material' : 'materiais'}</span></div>{materials.length ? <div className="os-resource-table-wrap"><table className="os-resource-table"><thead><tr><th>Material / Especificação</th><th>Quantidade</th><th>Valor total</th></tr></thead><tbody>{materials.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.detail || 'Sem especificação'}</small></td><td>{number(item.quantity)} kg</td><td>{currency(item.quantity * item.unitPrice)}</td></tr>)}</tbody></table></div> : <p className="os-empty">Nenhum material informado.</p>}</section>
      <section className="os-section"><div className="os-section-heading"><h3>Mão de obra</h3><span>{labor.length} {labor.length === 1 ? 'registro' : 'registros'}</span></div>{labor.length ? <div className="os-resource-table-wrap"><table className="os-resource-table"><thead><tr><th>Recurso</th><th>Tempo</th><th>Valor total</th></tr></thead><tbody>{labor.map((item) => <tr key={item.id}><td><strong>{item.resource}</strong><small>{item.type === 'machine' ? 'Hora máquina' : 'Profissional'}</small></td><td>{number(item.hours)} h</td><td>{currency(item.hours * item.hourlyRate)}</td></tr>)}</tbody></table></div> : <p className="os-empty">Nenhuma mão de obra informada.</p>}</section>
    </div><div className="os-detail-secondary">
      <section className="os-section os-proposal"><div className="os-section-heading"><h3>Proposta aceita</h3><span className="os-proposal-option">Opção {proposal.key || '—'}</span></div>{proposal.title && proposal.title !== `Opção ${proposal.key}` && <p className="os-proposal-title">{proposal.title}</p>}
        <Facts className="os-proposal-summary" items={[
          ['Valor do serviço', currency(proposal.serviceValue)], ['Prazo acordado', date(proposal.deadline)],
        ]} />
        <h4>Composição e condições</h4><Facts className="os-proposal-values" items={[
          ['Materiais', currency(proposal.materials)], ['Mão de obra', currency(proposal.labor)], ['Desconto', `${number(proposal.discount)}%`], ['Margem', `${number(proposal.margin)}%`],
        ]} />
        <h4>Planejamento</h4><Facts className="os-planning-facts" items={[
          ['Tipo', (proposal.kind || order.resources?.kind) === 'product' ? 'Produto' : 'Serviço'], ['Tempo de máquina', proposal.machine || 'Não informado'], ['Tempo de serviço', proposal.serviceTime || 'Não informado'],
          ['Processo', order.resources?.strictProcess === false ? 'Etapas livres' : 'Sequência obrigatória'],
          ['Fabricado a partir de', order.resources?.manufacturedFrom === 'sample' ? 'Amostra' : order.resources?.manufacturedFrom === 'drawing' ? 'Desenho' : 'Não informado'], ['Têmpera', order.resources?.tempering === true ? 'Sim' : order.resources?.tempering === false ? 'Não' : 'Não informada'], ...(proposalStages.includes('painting') ? [['Cor/Tipo', order.resources?.paintColor || 'Não informado']] : []),
        ]} />
        {order.resources?.serviceDescription && <p className="os-description">{order.resources.serviceDescription}</p>}
        <div className="os-proposal-stages"><span>Etapas do serviço</span>{proposalStages.length ? <ol>{proposalStages.map((stage, index) => <li key={stage}><b>{index + 1}</b>{stageLabel(stage)}</li>)}</ol> : <p className="os-empty">A definir</p>}</div>
        <button className="os-button os-download-button" type="button" onClick={() => window.location.assign(`/api/offers/${order.offerId}/proposal.pdf`)}><Icon name="orders" />Baixar PDF da proposta</button>
      </section>
      <section className="os-section os-attachments"><div className="os-section-heading"><h3>Anexos da OS</h3><span>{order.attachments?.length || 0} {order.attachments?.length === 1 ? 'arquivo' : 'arquivos'}</span></div>{order.attachments?.length ? <ul>{order.attachments.map((attachment) => <li key={attachment.id}><a href={`/api/offers/${order.offerId}/attachments/${attachment.id}`} download><Icon name="orders" /><span>{attachment.name}</span><Icon name="expand" /></a></li>)}</ul> : <p className="os-empty">Nenhum anexo.</p>}</section>
    </div></div>
    {historyOpen && <OrderHistoryModal order={order} onClose={() => setHistoryOpen(false)} Icon={Icon} />}
    {interruptOpen && <InterruptSessionModal order={order} onConfirm={onInterrupt} onClose={() => setInterruptOpen(false)} Icon={Icon} />}
    {action && <OrderActionModal order={order} action={action} onClose={() => setAction(null)} onConfirm={action === 'reopen' ? onReopen : () => { setEditConfirmed(true); setEditOpen(true) }} />}
    {editOpen && <OrderEditModal order={order} confirmCompleted={editConfirmed} onSave={onEdit} onUpload={onUpload} onClose={() => setEditOpen(false)} />}
  </article>
}
