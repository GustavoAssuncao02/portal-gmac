import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { cachedResource, payableRequest } from './payablesApi.js'
import { bySector } from './machineSectors.js'
import { setStageCatalog } from '../server/serviceStages.js'
import './stages.css'

// "Etapas" (server/stageCatalog.js): the stages of the services by sector, in the order the offers show them. Dragging
// reorders the sectors and the stages; each stage lists the machines and services it is made on (the first is the
// default a new offer comes with; with none, the offer offers every machine and service). A stage already used is
// deactivated instead of deleted.
const choiceKey = (choice) => `${choice.type}:${choice.id}`

function Sortable({ ids, onMove, children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(active.id), to = ids.indexOf(over.id)
    if (from !== -1 && to !== -1) onMove(arrayMove(ids, from, to))
  }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext></DndContext>
}

function SortableRow({ id, label, disabled, className, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({ id, disabled, transition: null })
  return <div ref={setNodeRef} className={`${className}${isDragging ? ' stages-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform) }}>
    <button type="button" ref={setActivatorNodeRef} className="stages-drag" {...attributes} {...listeners} disabled={disabled} aria-label={`Reordenar ${label}`} title={`Reordenar ${label}`}><GripVertical size={16} /></button>
    {children}
  </div>
}

export default function StagesScreen({ Sidebar, WorkspaceTabs, navigationProps }) {
  const [data, setData] = useState(null), [message, setMessage] = useState(''), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false)
  const [machines, setMachines] = useState([]), [laborServices, setLaborServices] = useState([])
  useEffect(() => {
    let active = true
    payableRequest('/stages').then((result) => { if (active) apply(result) }).catch((caught) => setMessage(caught.message))
    cachedResource('/machines', (result) => { if (active) setMachines(result.items || []) }).catch(() => {})
    cachedResource('/labor-services', (result) => { if (active) setLaborServices(result.items || []) }).catch(() => {})
    return () => { active = false }
  }, [])
  function apply(result) { setData(result); setStageCatalog(result) }
  const resourceName = (choice) => (choice.type === 'machine' ? machines : laborServices).find((item) => String(item.id) === String(choice.id))?.name || '…'
  async function change(task, done) {
    setBusy(true); setMessage('')
    try { apply(await task()); if (done) setMessage(done) } catch (caught) { setMessage(caught.message) } finally { setBusy(false) }
  }

  const stages = data?.stages || []
  const groups = (data?.groups || []).map((name) => ({ name, sectorId: stages.find((row) => row.group === name)?.sectorId, stages: stages.filter((row) => row.group === name) })).filter((group) => group.stages.length)
  // The order goes whole to the server: sectors first, then every stage in the order on screen.
  const saveOrder = (nextGroups) => change(() => payableRequest('/stages-order', 'PUT', { groups: nextGroups.map((group) => group.sectorId).filter(Boolean), stages: nextGroups.flatMap((group) => group.stages.map((row) => row.code)) }))
  async function remove(row) {
    if (!window.confirm(`Excluir a etapa ${row.name}?`)) return
    await change(() => payableRequest(`/stages/${encodeURIComponent(row.code)}`, 'DELETE'), 'Etapa excluída com sucesso.')
  }
  async function toggle(row) {
    if (!window.confirm(row.active ? `Desativar a etapa ${row.name}? Ela some das ofertas novas; as ofertas e OS que já a têm continuam com ela.` : `Reativar a etapa ${row.name}?`)) return
    await change(() => payableRequest(`/stages/${encodeURIComponent(row.code)}/active`, 'PATCH', { active: !row.active }), `Etapa ${row.active ? 'desativada' : 'reativada'} com sucesso.`)
  }

  return <AdminWorkspace Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={navigationProps} title="Etapas">
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!data} onClick={() => { setMessage(''); setEditing({}) }}><Plus size={17} />Nova etapa</button></div>
    {message && <p className={`registration-message ${message.includes('sucesso') ? 'registration-message--success' : 'registration-message--error'}`} role="status">{message}</p>}
    <p className="stages-intro">As etapas aparecem nas ofertas por setor, nesta ordem: arraste <GripVertical size={13} aria-hidden="true" /> para mudar a ordem dos setores e das etapas. A <strong>primeira máquina ou serviço</strong> de cada etapa já vem escolhida na oferta; com mais de uma, dá para trocar entre elas. Sem nenhuma, a oferta mostra todas.</p>
    {!data && !message && <p className="payable-muted">Carregando...</p>}
    {data && <div className="stages-groups" aria-busy={busy}>
      <Sortable ids={groups.map((group) => group.name)} onMove={(names) => saveOrder(names.map((name) => groups.find((group) => group.name === name)))}>
        {groups.map((group) => <SortableRow key={group.name} id={group.name} label={`setor ${group.name}`} disabled={busy} className="stages-group">
          <div className="stages-group-body">
            <h2>{group.name}<small>{group.stages.filter((row) => row.active).length} {group.stages.filter((row) => row.active).length === 1 ? 'etapa ativa' : 'etapas ativas'}</small></h2>
            <Sortable ids={group.stages.map((row) => row.code)} onMove={(codes) => saveOrder(groups.map((item) => item === group ? { ...item, stages: codes.map((code) => group.stages.find((row) => row.code === code)) } : item))}>
              <div className="stages-list">{group.stages.map((row) => <SortableRow key={row.code} id={row.code} label={`etapa ${row.name}`} disabled={busy} className={`stages-row${row.active ? '' : ' stages-row--inactive'}`}>
                <div className="stages-row-name"><strong>{row.name}</strong>{!row.active && <span className="stages-badge">Desativada</span>}</div>
                <div className="stages-row-resources">{row.resources.length ? row.resources.map((choice, index) => <span key={choiceKey(choice)} className={`stages-chip${index === 0 ? ' stages-chip--default' : ''}`}>{resourceName(choice)}{index === 0 && <small>padrão</small>}</span>) : <span className="stages-any">Qualquer máquina ou serviço</span>}</div>
                <div className="payable-registry-actions">
                  <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${row.name}`} disabled={busy} onClick={() => { setMessage(''); setEditing(row) }}><Pencil size={16} /></button>
                  {row.inUse || !row.active ? <button className={`payable-icon${row.active ? '' : ' payable-icon--inactive'}`} type="button" title={row.active ? 'Desativar' : 'Reativar'} aria-label={`${row.active ? 'Desativar' : 'Reativar'} ${row.name}`} disabled={busy} onClick={() => toggle(row)}><Power size={16} /></button>
                    : <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${row.name}`} disabled={busy} onClick={() => remove(row)}><Trash2 size={16} /></button>}
                </div>
              </SortableRow>)}</div>
            </Sortable>
          </div>
        </SortableRow>)}
      </Sortable>
    </div>}
    {editing && <StageForm source={editing} sectors={data.sectors} machines={machines} laborServices={laborServices} onClose={() => setEditing(null)} onSave={async (values) => {
      apply(await payableRequest(editing.code ? `/stages/${encodeURIComponent(editing.code)}` : '/stages', editing.code ? 'PUT' : 'POST', values))
      setMessage(`Etapa ${editing.code ? 'atualizada' : 'cadastrada'} com sucesso.`)
      setEditing(null)
    }} />}
  </AdminWorkspace>
}

function StageForm({ source, sectors, machines, laborServices, onClose, onSave }) {
  const id = useId(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [name, setName] = useState(source.name || ''), [sectorId, setSectorId] = useState(source.sectorId || '')
  const [resources, setResources] = useState(source.resources || [])
  const named = (choice) => (choice.type === 'machine' ? machines : laborServices).find((item) => String(item.id) === String(choice.id))
  const chosen = new Set(resources.map(choiceKey))
  const move = (index, offset) => setResources((current) => arrayMove(current, index, index + offset))
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await onSave({ name, sectorId, resources }) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={source.code ? `Editar etapa ${source.name}` : 'Nova etapa'} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}>Salvar</button></>}>
    <form id={id} className="payable-form registration-modal-form stages-form" onSubmit={submit}><fieldset disabled={busy}>
      <label>Nome da etapa *<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required autoFocus />{source.aliases?.length > 0 && <small className="payable-hint">Já se chamou {source.aliases.join(', ')}.</small>}</label>
      <label>Setor *<select value={sectorId} onChange={(event) => setSectorId(event.target.value)} required><option value="">Escolha o setor</option>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select><small className="payable-hint">O setor é o grupo da etapa na oferta. Para um setor novo, use Cadastros › Setores.</small></label>
      <div className="stages-form-resources">
        <span className="stages-form-label">Máquinas e serviços da etapa</span>
        <small className="payable-hint">A primeira é a padrão: já vem escolhida na oferta. Com mais de uma, a oferta deixa trocar entre elas. Sem nenhuma, a oferta mostra todas as máquinas e serviços.</small>
        {resources.length > 0 && <ol>{resources.map((choice, index) => {
          const item = named(choice)
          return <li key={choiceKey(choice)}>
            <span className="stages-form-position">{index + 1}</span>
            <span className="stages-form-name"><strong>{item?.name || 'Não cadastrado'}</strong><small>{choice.type === 'machine' ? `Máquina${item?.sector ? ` · ${item.sector}` : ''}` : 'Serviço (hora homem)'}</small></span>
            {index === 0 && <span className="stages-chip stages-chip--default"><small>padrão</small></span>}
            <button type="button" className="payable-icon" aria-label={`Subir ${item?.name || ''}`} title="Subir" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
            <button type="button" className="payable-icon" aria-label={`Descer ${item?.name || ''}`} title="Descer" disabled={index === resources.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
            <button type="button" className="payable-icon" aria-label={`Remover ${item?.name || ''}`} title="Remover" onClick={() => setResources((current) => current.filter((_, position) => position !== index))}><X size={15} /></button>
          </li>
        })}</ol>}
        <select aria-label="Adicionar máquina ou serviço" value="" onChange={(event) => { const [type, ...rest] = event.target.value.split(':'); if (type) setResources((current) => [...current, { type, id: rest.join(':') }]) }}>
          <option value="">+ Adicionar máquina ou serviço</option>
          {bySector(machines.filter((item) => !chosen.has(`machine:${item.id}`))).map(([sector, items]) => <optgroup key={sector} label={`Máquinas · ${sector}`}>{items.map((item) => <option key={item.id} value={`machine:${item.id}`}>{item.name}</option>)}</optgroup>)}
          {laborServices.some((item) => !chosen.has(`labor-service:${item.id}`)) && <optgroup label="Serviços (hora homem)">{laborServices.filter((item) => !chosen.has(`labor-service:${item.id}`)).map((item) => <option key={item.id} value={`labor-service:${item.id}`}>{item.name}</option>)}</optgroup>}
        </select>
      </div>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}
