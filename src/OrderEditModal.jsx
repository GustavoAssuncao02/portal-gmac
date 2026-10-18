import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, X, RotateCcw } from 'lucide-react'
import ServiceStageEditor from './ServiceStageEditor.jsx'
import { productionStages, stageLabel, serviceDetails, readStageLayout, orderedStageSelection } from '../server/serviceStages.js'
import { activeSessions } from '../server/operationSessions.js'
import { newId } from './newId.js'
import { payableRequest, money, dateLabel } from './payablesApi.js'
import './orderEditing.css'

function useDialog(dialog) {
  useEffect(() => {
    const element = dialog.current
    const focus = document.activeElement
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = overflow; focus?.focus({ preventScroll: true }) }
  }, [dialog])
}

const backdrop = (event, close) => {
  if (event.target !== event.currentTarget) return
  const box = event.currentTarget.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
}

// One line per account receivable posted for the OS: scheduled, in installments or already received in Tesouraria.
const receivableLine = (row) => `${row.id}${row.groupId ? ` · parcela ${row.installmentNumber} de ${row.installmentCount}` : ''} · ${money(row.receipt ? row.receipt.finalCents : row.valueCents)} · ${row.receipt ? `${row.treasury ? 'recebido na Tesouraria' : 'recebido'} em ${dateLabel(row.receipt.date)}` : `previsto para ${dateLabel(row.dueDate)}`}`

export function OrderActionModal({ order, action, onConfirm, onClose }) {
  const dialog = useRef(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reopen = action === 'reopen'
  // Reopening an OS that has an account receivable asks what to do with it; nothing is assumed before the answer.
  const [linked, setLinked] = useState(null)
  const [choice, setChoice] = useState('')
  useDialog(dialog)
  useEffect(() => {
    if (!reopen) return undefined
    let active = true
    payableRequest(`/receivables/order/${encodeURIComponent(order.code)}`).then((result) => { if (active) setLinked({ items: result.items || [], deleteBlock: result.deleteBlock || '' }) }).catch(() => { if (active) setLinked({ items: [], failed: true }) })
    return () => { active = false }
  }, [reopen, order.code])
  const items = linked?.items || [], asking = items.length > 0 && !linked.deleteBlock
  const close = () => { if (!pending.current) onClose() }
  async function confirm() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await onConfirm(reopen ? { receivables: asking ? choice : 'keep' } : undefined); onClose() } catch (caught) { setError(caught.message) } finally { pending.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="os-history-modal os-action-modal" aria-labelledby="os-action-title" onCancel={(event) => { event.preventDefault(); close() }} onClick={(event) => backdrop(event, close)}>
    <header className="os-history-heading"><div><h2 id="os-action-title">{reopen ? 'Reabrir OS' : 'Editar OS finalizada?'}</h2><p>{order.code} · {order.service}</p></div><button className="os-icon-button" type="button" onClick={close} disabled={busy} aria-label="Fechar confirmação" title="Fechar confirmação"><X size={18} /></button></header>
    <div className="os-action-content"><p>{reopen ? 'Deseja reabrir esta ordem de serviço? As quantidades produzidas e o histórico serão mantidos, e a OS voltará ao painel de serviços em andamento.' : 'Esta ordem de serviço já foi finalizada. Tem certeza de que deseja editar seus dados?'}</p>
      {reopen && items.length > 0 && <div className="os-action-receivables">
        <h3 id="os-action-receivables-title">{items.length > 1 ? 'Contas a receber vinculadas a esta OS' : 'Conta a receber vinculada a esta OS'}</h3>
        <ul>{items.map((row) => <li key={row.id}>{receivableLine(row)}</li>)}</ul>
        {asking ? <fieldset className="os-action-choice" disabled={busy}><legend>O que fazer {items.length > 1 ? 'com elas' : 'com ela'}?</legend>
          {[['keep', items.length > 1 ? 'Manter as contas a receber' : 'Manter a conta a receber', 'Os lançamentos continuam no financeiro, como estão.'], ['delete', items.length > 1 ? 'Excluir as contas a receber' : 'Excluir a conta a receber', 'Os lançamentos saem do financeiro; o histórico registra a exclusão.']].map(([value, label, hint]) => <label key={value}><input type="radio" name="os-action-receivables" value={value} checked={choice === value} onChange={() => setChoice(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}
        </fieldset> : <p className="os-action-note">Não é possível excluir {items.length > 1 ? 'estas contas' : 'esta conta'}: {linked.deleteBlock} {items.length > 1 ? 'Elas serão mantidas.' : 'Ela será mantida.'}</p>}
      </div>}
      {reopen && linked?.failed && <p className="os-action-note os-action-note--standalone">Não foi possível verificar se há conta a receber vinculada a esta OS. Se houver, ela será mantida.</p>}
      {error && <p className="os-edit-error" role="alert">{error}</p>}<footer className="os-edit-actions"><button className="os-button" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="os-button os-edit-primary" type="button" onClick={confirm} disabled={busy || (reopen && (!linked || (asking && !choice)))}>{reopen && <RotateCcw size={16} />}{busy ? 'Reabrindo...' : reopen ? 'Reabrir OS' : 'Sim, editar OS'}</button></footer></div>
  </dialog>
}

export function orderEditDraft(order) {
  const source = structuredClone(order)
  const stages = source.operation.stages.map((stage) => productionStages.find(([, name]) => name === stage.name)?.[0] || stage.name)
  const resources = { materials: [], laborEntries: [], ...source.resources, ...serviceDetails(source.resources), stages, kind: source.resources?.kind || source.proposal?.kind || 'service' }
  resources.stageLayout = readStageLayout(resources)
  return { order: { ...source, resources, proposal: { key: 'A', title: '', materials: 0, labor: 0, serviceValue: 0, margin: 0, discount: 0, ...source.proposal }, attachmentIds: (source.attachments || []).map((item) => item.id) }, stageCounts: Object.fromEntries(stages.map((code, index) => [code, source.operation.stageCounts[source.operation.stages[index].key] || 0])), expectedUpdatedAt: source.updatedAt || source.createdAt, expectedOperation: { status: source.operation.status, stages: source.operation.stages, stageCounts: source.operation.stageCounts, activeSessionIds: activeSessions(source.operation).map((session) => session.id) } }
}

export default function OrderEditModal({ order, confirmCompleted, onSave, onUpload, onClose }) {
  const dialog = useRef(null)
  const pending = useRef(false)
  const saved = useRef(false)
  const [draft, setDraft] = useState(() => orderEditDraft(order))
  const [tab, setTab] = useState('data')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState([])
  const [deadlineReason, setDeadlineReason] = useState('')
  useDialog(dialog)
  const data = draft.order
  const resources = data.resources
  const locked = busy || saved.current
  const deadlineChanged = (data.deadline || '') !== (order.deadline || '')
  const close = () => { if (!pending.current) onClose() }
  const update = (field, value) => setDraft((current) => ({ ...current, order: { ...current.order, [field]: value } }))
  const resource = (field, value) => setDraft((current) => ({ ...current, order: { ...current.order, resources: { ...current.order.resources, [field]: value } } }))
  const proposal = (field, value) => setDraft((current) => ({ ...current, order: { ...current.order, proposal: { ...current.order.proposal, [field]: value } } }))
  const row = (kind, id, field, value) => resource(kind, resources[kind].map((item) => item.id === id ? { ...item, [field]: value } : item))
  function toggleStage(code) {
    const selected = resources.stages.includes(code) ? resources.stages.filter((key) => key !== code) : [...resources.stages, code]
    resource('stages', orderedStageSelection(resources.stageLayout, selected))
  }
  function reorder(layout) {
    setDraft((current) => ({ ...current, order: { ...current.order, resources: { ...current.order.resources, stageLayout: layout, stages: orderedStageSelection(layout, current.order.resources.stages) } } }))
  }
  async function submit(event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (deadlineChanged && deadlineReason.trim().length < 10) { setTab('data'); throw new Error('Justifique a alteração do prazo solicitado (pelo menos 10 caracteres).') }
      if (!saved.current) { await onSave({ ...draft, deadlineReason: deadlineChanged ? deadlineReason.trim() : '', stageCounts: Object.fromEntries(resources.stages.map((code) => [code, draft.stageCounts[code] ?? 0])), confirmCompleted }); saved.current = true }
      for (const file of files) {
        await onUpload(file)
        setFiles((current) => current.filter((entry) => entry !== file))
      }
      onClose()
    } catch (caught) {
      setError(`${saved.current ? 'A OS foi salva, mas um anexo não foi enviado. ' : ''}${caught.message}`)
    } finally { pending.current = false; setBusy(false) }
  }
  const field = (label, key, options = {}) => <label className="os-edit-field" key={key}>{label}<input value={data[key] || ''} onChange={(event) => update(key, event.target.value)} {...options} /></label>
  const numberField = (label, key) => <label className="os-edit-field" key={key}>{label}<input type="number" min="0" max={['margin', 'discount'].includes(key) ? 100 : undefined} step="0.01" value={data.proposal[key] ?? ''} onChange={(event) => proposal(key, event.target.value)} required /></label>
  return <dialog ref={dialog} className="os-history-modal os-edit-modal" aria-labelledby="os-edit-title" onCancel={(event) => { event.preventDefault(); close() }} onClick={(event) => backdrop(event, close)}>
    <header className="os-history-heading"><div><h2 id="os-edit-title">Editar ordem de serviço</h2><p>{order.code} · {order.service}</p></div><button className="os-icon-button" type="button" onClick={close} disabled={busy} aria-label="Fechar edição" title="Fechar edição"><X size={18} /></button></header>
    <div className="os-edit-tabs" role="tablist" aria-label="Dados da edição">{[['data', 'Dados da OS'], ['resources', 'Recursos'], ['process', 'Processo'], ['proposal', 'Proposta e anexos']].map(([key, label]) => <button key={key} type="button" id={`os-edit-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`os-edit-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(event) => {
      const keys = ['data', 'resources', 'process', 'proposal']
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[3] : keys[(keys.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 3)) % 4]
      setTab(next); document.getElementById(`os-edit-tab-${next}`).focus()
    }}>{label}</button>)}</div>
    <form className="os-edit-form" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="os-edit-body" role="tabpanel" id={`os-edit-panel-${tab}`} aria-labelledby={`os-edit-tab-${tab}`}>
        <fieldset className="os-edit-fields" disabled={locked}>
          {tab === 'data' && <div className="os-edit-grid">
            {field('Peça / Serviço', 'service', { required: true, maxLength: 160 })}{field('Cliente', 'company', { required: true, maxLength: 160 })}
            {field('CNPJ', 'cnpj', { required: true, maxLength: 18, inputMode: 'numeric' })}{field('Número da etiqueta', 'labelNumber', { maxLength: 80 })}
            {field('Quantidade de peças', 'quantity', { type: 'number', min: 1, step: 1, required: true })}{field('Prazo solicitado', 'deadline', { type: 'date', required: true })}{deadlineChanged && <label className="os-edit-field os-edit-wide os-deadline-reason">Justificativa da alteração do prazo<textarea required minLength={10} maxLength={1000} rows={3} value={deadlineReason} onChange={(event) => setDeadlineReason(event.target.value)} placeholder="Explique por que o prazo de entrega desta OS foi alterado" /></label>}
            <label className="os-edit-field">Data da solicitação<input type="date" value={data.requestedAt?.slice(0, 10) || ''} onChange={(event) => update('requestedAt', event.target.value ? `${event.target.value}T03:00:00.000Z` : '')} required /></label>
            <label className="os-edit-field os-edit-wide">Descrição da OS<textarea aria-label="Descrição da OS" rows={3} maxLength={5000} value={data.description} onChange={(event) => update('description', event.target.value)} required /></label>
          </div>}
          {tab === 'resources' && <>
            <div className="os-edit-section-heading"><h3>Materiais</h3><button className="os-button" type="button" onClick={() => resource('materials', [...resources.materials, { id: newId(), name: '', detail: '', quantity: 1, unitPrice: 0 }])}><Plus size={16} />Adicionar material</button></div>
            {resources.materials.map((item) => <div className="os-edit-resource-row" key={item.id}>
              <label className="os-edit-field">Material<input value={item.name} maxLength={160} onChange={(event) => row('materials', item.id, 'name', event.target.value)} required /></label>
              <label className="os-edit-field">Especificação<input value={item.detail || ''} maxLength={500} onChange={(event) => row('materials', item.id, 'detail', event.target.value)} /></label>
              <label className="os-edit-field">Quantidade (kg)<input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => row('materials', item.id, 'quantity', event.target.value)} required /></label>
              <label className="os-edit-field">Valor/kg (R$)<input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => row('materials', item.id, 'unitPrice', event.target.value)} required /></label>
              <button className="os-icon-button" type="button" title="Remover material" aria-label={`Remover material ${item.name || 'sem nome'}`} onClick={() => resource('materials', resources.materials.filter((entry) => entry.id !== item.id))}><Trash2 size={16} /></button>
            </div>)}
            <div className="os-edit-section-heading"><h3>Mão de obra</h3><button className="os-button" type="button" onClick={() => resource('laborEntries', [...resources.laborEntries, { id: newId(), type: 'person', resource: '', hours: 1, hourlyRate: 0 }])}><Plus size={16} />Adicionar mão de obra</button></div>
            {resources.laborEntries.map((item) => <div className="os-edit-resource-row" key={item.id}>
              <label className="os-edit-field">Tipo de recurso<select aria-label="Tipo de recurso" value={item.type} onChange={(event) => row('laborEntries', item.id, 'type', event.target.value)}><option value="machine">Hora máquina</option><option value="person">Hora homem</option></select></label>
              <label className="os-edit-field">Recurso<input value={item.resource} maxLength={160} onChange={(event) => row('laborEntries', item.id, 'resource', event.target.value)} required /></label>
              <label className="os-edit-field">Horas previstas<input type="number" min="0" step="0.01" value={item.hours} onChange={(event) => row('laborEntries', item.id, 'hours', event.target.value)} required /></label>
              <label className="os-edit-field">Valor/hora (R$)<input type="number" min="0" step="0.01" value={item.hourlyRate} onChange={(event) => row('laborEntries', item.id, 'hourlyRate', event.target.value)} required /></label>
              <button className="os-icon-button" type="button" title="Remover mão de obra" aria-label={`Remover recurso ${item.resource || 'sem nome'}`} onClick={() => resource('laborEntries', resources.laborEntries.filter((entry) => entry.id !== item.id))}><Trash2 size={16} /></button>
            </div>)}
          </>}
          {tab === 'process' && <div className="offer-process-settings os-edit-process">
            <ServiceStageEditor layout={resources.stageLayout} stages={resources.stages} onLayoutChange={reorder} onToggle={toggleStage} disabled={locked} stageTimes={resources.stageTimes} onStageTime={(code, minutes) => { const next = { ...resources.stageTimes }; if (minutes) next[code] = minutes; else delete next[code]; resource('stageTimes', next) }} />
            {resources.stages.filter((key) => !productionStages.some(([code]) => code === key)).map((key) => <label key={key} className="os-edit-checkbox"><input type="checkbox" checked onChange={() => toggleStage(key)} />{key}</label>)}
            <div className="os-edit-grid">
              <label className="os-edit-field">Tipo<select aria-label="Tipo" value={resources.kind} onChange={(event) => resource('kind', event.target.value)}><option value="service">Serviço</option><option value="product">Produto</option></select></label>
              <label className="os-edit-field">Fabricado a partir de<select aria-label="Fabricado a partir de" value={resources.manufacturedFrom || ''} onChange={(event) => resource('manufacturedFrom', event.target.value || null)}><option value="">Não informado</option><option value="sample">Amostra</option><option value="drawing">Desenho</option></select></label>
              <label className="os-edit-field">Têmpera<select aria-label="Têmpera" value={resources.tempering == null ? '' : String(resources.tempering)} onChange={(event) => resource('tempering', event.target.value === '' ? null : event.target.value === 'true')}><option value="">Não informada</option><option value="true">Sim</option><option value="false">Não</option></select></label>
              {resources.stages.includes('painting') && <label className="os-edit-field">Cor/Tipo<input value={resources.paintColor} maxLength={160} onChange={(event) => resource('paintColor', event.target.value)} /></label>}
              <label className="os-edit-field os-edit-wide">Descrição do serviço<textarea aria-label="Descrição do serviço" rows={3} maxLength={5000} value={resources.serviceDescription} onChange={(event) => resource('serviceDescription', event.target.value)} /></label>
            </div>
            <label className="os-edit-checkbox"><input type="checkbox" checked={resources.strictProcess} onChange={(event) => resource('strictProcess', event.target.checked)} />Processo Injessado</label>
            <h3>Peças registradas por etapa</h3><div className="os-edit-grid">{resources.stages.map((code) => <label className="os-edit-field" key={code}>{stageLabel(code)}<input type="number" min="0" max={data.quantity} step="1" value={draft.stageCounts[code] ?? 0} onChange={(event) => setDraft((current) => ({ ...current, stageCounts: { ...current.stageCounts, [code]: event.target.value } }))} /></label>)}</div>
          </div>}
          {tab === 'proposal' && <>
            <h3>Proposta aceita</h3><div className="os-edit-grid">
              <label className="os-edit-field">Opção da proposta<select aria-label="Opção da proposta" value={data.proposal.key} onChange={(event) => proposal('key', event.target.value)}>{['A', 'B', 'C', 'D'].map((key) => <option key={key} value={key}>Opção {key}</option>)}</select></label>
              <label className="os-edit-field">Título da proposta<input value={data.proposal.title || ''} maxLength={160} onChange={(event) => proposal('title', event.target.value)} /></label>
              <label className="os-edit-field">Prazo acordado<input type="date" value={data.proposal.deadline?.slice(0, 10) || ''} onChange={(event) => proposal('deadline', event.target.value)} required /></label>
              {data.proposal.osValue != null && numberField('Valor da OS (R$)', 'osValue')}{numberField('Valor do serviço (R$)', 'serviceValue')}{numberField('Materiais (R$)', 'materials')}{numberField('Mão de obra (R$)', 'labor')}{numberField('Margem (%)', 'margin')}{numberField('Desconto (%)', 'discount')}
              <label className="os-edit-field">Tempo de máquina<input value={data.proposal.machine || ''} maxLength={160} onChange={(event) => proposal('machine', event.target.value)} /></label><label className="os-edit-field">Tempo de serviço<input value={data.proposal.serviceTime || ''} maxLength={160} onChange={(event) => proposal('serviceTime', event.target.value)} /></label>{data.proposal.totalTime != null && <label className="os-edit-field">Horas totais<input value={data.proposal.totalTime} maxLength={160} onChange={(event) => proposal('totalTime', event.target.value)} /></label>}
            </div><h3>Anexos</h3><ul className="os-edit-attachments">{(order.attachments || []).filter((item) => data.attachmentIds.includes(item.id)).map((item) => <li key={item.id}><span>{item.name}</span><button className="os-icon-button" type="button" aria-label={`Remover anexo ${item.name}`} title="Remover anexo" onClick={() => update('attachmentIds', data.attachmentIds.filter((id) => id !== item.id))}><Trash2 size={16} /></button></li>)}</ul>
          </>}
        </fieldset>
        {tab === 'proposal' && <><label className="os-edit-field">Adicionar anexos<input type="file" multiple disabled={busy} onChange={(event) => { const selected = [...event.target.files]; if (selected.some((file) => !file.size || file.size > 20 * 1024 * 1024)) { setError('Cada anexo deve ter entre 1 byte e 20 MB.'); return } setFiles((current) => [...current, ...selected]); event.target.value = '' }} /></label><ul className="os-edit-attachments">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button className="os-icon-button" type="button" disabled={busy} aria-label={`Remover novo anexo ${file.name}`} title="Remover anexo" onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} /></button></li>)}</ul></>}
      </div>
      <footer className="os-edit-footer">{error && <p className="os-edit-error" role="alert">{error}</p>}<div className="os-edit-actions"><button className="os-button" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="os-button os-edit-primary" type="submit" disabled={busy}><Save size={16} />{busy ? 'Salvando...' : saved.current ? 'Reenviar anexos' : 'Salvar alterações'}</button></div></footer>
    </form>
  </dialog>
}
