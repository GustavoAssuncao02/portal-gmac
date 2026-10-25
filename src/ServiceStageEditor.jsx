import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { legacyStageGroup, stageLabel, orderedStageSelection } from '../server/serviceStages.js'
import { bySector } from './machineSectors.js'

function SortableStageItem({ id, label, disabled, group = false, legacy = false, selected = false, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({ id, disabled, transition: null })
  const handle = <button type="button" ref={setActivatorNodeRef} className="offer-stage-drag" {...attributes} {...listeners} disabled={disabled} aria-label={`Reordenar ${group ? 'grupo' : 'etapa'} ${label}`} title={`Reordenar ${label}`}><GripVertical size={16} /></button>
  return <div ref={setNodeRef} data-stage-id={id} className={`${group ? 'offer-stage-group' : 'offer-stage-item'}${selected ? ' offer-stage-item--selected' : ''}${legacy ? ' offer-stage-group--legacy' : ''}${isDragging ? ' offer-stage-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform) }}>
    {group ? <div className="offer-stage-heading">{handle}<h3>{label}</h3>{children[0]}</div> : handle}{group ? children.slice(1) : children}
  </div>
}

// Planned time of a checked stage, typed as hours and minutes and saved in minutes when the field is left. It is
// mandatory (the planning is made from it): while empty it is marked.
function StageTimeInput({ label, minutes, disabled, onChange }) {
  const missing = !(minutes > 0)
  const split = (value) => ({ hours: value ? String(Math.floor(value / 60)) : '', mins: value ? String(value % 60) : '' })
  const [draft, setDraft] = useState(() => split(minutes))
  useEffect(() => { setDraft(split(minutes)) }, [minutes])
  const commit = () => {
    const total = Math.max(0, Math.floor(Number(draft.hours) || 0)) * 60 + Math.max(0, Math.floor(Number(draft.mins) || 0))
    if (total !== (minutes || 0)) onChange(total || null)
  }
  return <span className={`offer-stage-time${missing ? ' offer-stage-time--missing' : ''}`} title={missing ? 'Obrigatório: informe o tempo previsto desta etapa na OS inteira' : 'Tempo previsto para esta etapa na OS inteira'} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) commit() }}>
    <input type="number" min="0" step="1" inputMode="numeric" value={draft.hours} disabled={disabled} aria-label={`Horas previstas de ${label}`} aria-invalid={missing || undefined} placeholder="0" onChange={(event) => setDraft({ ...draft, hours: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><small>h</small>
    <input type="number" min="0" max="59" step="1" inputMode="numeric" value={draft.mins} disabled={disabled} aria-label={`Minutos previstos de ${label}`} aria-invalid={missing || undefined} placeholder="00" onChange={(event) => setDraft({ ...draft, mins: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><small>min</small>
  </span>
}

// Machine or labor service of the stage; the options come from Máquinas and Serviços. It is mandatory (the operator's
// tablet takes it from the stage): while empty it is marked.
function StageResourceSelect({ label, value, options, disabled, onChange }) {
  const selected = value ? `${value.type}:${value.id}` : ''
  const known = !value || [...options.machines.map((item) => `machine:${item.id}`), ...options.laborServices.map((item) => `labor-service:${item.id}`)].includes(selected)
  return <select className={`offer-stage-resource${value ? '' : ' offer-stage-resource--missing'}`} value={selected} disabled={disabled} aria-label={`Máquina ou serviço de ${label}`} aria-invalid={!value || undefined} title={value ? 'Máquina ou serviço desta etapa' : 'Obrigatório: escolha a máquina ou o serviço desta etapa'} onChange={(event) => {
    const [type, ...rest] = event.target.value.split(':'), id = rest.join(':')
    onChange(event.target.value ? { type, id } : null)
  }}>
    <option value="">Máquina / serviço</option>
    {!known && <option value={selected}>{value.name} (fora do cadastro)</option>}
    {/* Machines come by sector: the same name (Bancada) can exist in more than one, and the group tells them apart. */}
    {bySector(options.machines).map(([sector, group]) => <optgroup key={sector} label={`Máquinas · ${sector}`}>{group.map((item) => <option key={item.id} value={`machine:${item.id}`}>{item.name}{item.maintenance ? ' (em manutenção)' : ''}</option>)}</optgroup>)}
    {options.laborServices.length > 0 && <optgroup label="Serviços (hora homem)">{options.laborServices.map((item) => <option key={item.id} value={`labor-service:${item.id}`}>{item.name}</option>)}</optgroup>}
  </select>
}

function SortableStages({ ids, onMove, vertical = false, children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(active.id), to = ids.indexOf(over.id)
    if (from !== -1 && to !== -1) onMove(arrayMove(ids, from, to))
  }}>
    <SortableContext items={ids} strategy={vertical ? verticalListSortingStrategy : rectSortingStrategy}>{children}</SortableContext>
  </DndContext>
}

// The stages are a stack read from top to bottom: each checked stage shows its position in the execution (1, 2, 3…),
// counted across the groups in their order. Dragging a stage or a group renumbers everything at once.
export default function ServiceStageEditor({ layout, stages, onLayoutChange, onToggle, disabled, stageTimes, onStageTime, stageResources, resourceOptions, onStageResource }) {
  const visibleGroups = layout.filter((entry) => entry.group !== legacyStageGroup || entry.stages.some((key) => stages.includes(key)))
  const sequence = orderedStageSelection(layout, stages), position = (key) => sequence.indexOf(key) + 1
  return <fieldset><legend>Etapas do serviço</legend>
    <p className="offer-stage-hint">As etapas marcadas são feitas <strong>de cima para baixo</strong>, na ordem dos números. Arraste <GripVertical size={13} aria-hidden="true" /> para mudar a ordem de uma etapa ou de um grupo.{onStageTime && <> Ao lado de cada etapa marcada, informe o <strong>tempo previsto</strong> para a OS inteira (obrigatório): é a meta que o operador vê e a base do planejamento das máquinas.</>}{onStageResource && <> Escolha também a <strong>máquina ou o serviço</strong> de cada etapa (obrigatório): o operador não escolhe no tablet, a etapa já vem com ele.</>}</p>
    <div className="offer-stage-groups">
    <SortableStages ids={visibleGroups.map(({ group }) => group)} vertical onMove={(groups) => {
      let index = 0
      onLayoutChange(layout.map((entry) => {
        if (!groups.includes(entry.group)) return entry
        const group = groups[index++]
        return layout.find((item) => item.group === group)
      }))
    }}>
      {visibleGroups.map((entry) => {
        const options = entry.group === legacyStageGroup ? entry.stages.filter((key) => stages.includes(key)) : entry.stages
        const numbers = options.filter((key) => stages.includes(key)).map(position)
        return <SortableStageItem key={entry.group} id={entry.group} label={entry.group} group legacy={entry.group === legacyStageGroup} disabled={disabled}>
        <span className="offer-stage-range">{numbers.length ? numbers.length === 1 ? `Etapa ${numbers[0]}` : `Etapas ${numbers[0]} a ${numbers.at(-1)}` : 'Nenhuma etapa marcada'}</span>
        <SortableStages ids={options} vertical onMove={(keys) => {
          let index = 0
          onLayoutChange(layout.map((item) => item.group === entry.group ? { ...item, stages: item.stages.map((key) => keys.includes(key) ? keys[index++] : key) } : item))
        }}>
          <div className="offer-stage-options offer-stage-stack">{options.map((key) => <SortableStageItem key={key} id={key} label={stageLabel(key)} disabled={disabled} selected={stages.includes(key)}>
            <span className="offer-stage-number" aria-hidden="true">{stages.includes(key) ? position(key) : ''}</span>
            {stages.includes(key) && <span className="sr-only" id={`stage-order-${key}`}>Etapa {position(key)} da execução</span>}
            <label><input type="checkbox" checked={stages.includes(key)} disabled={disabled} aria-describedby={stages.includes(key) ? `stage-order-${key}` : undefined} onChange={() => onToggle(key)} />{stageLabel(key)}</label>
            {onStageTime && stages.includes(key) && <StageTimeInput label={stageLabel(key)} minutes={stageTimes?.[key]} disabled={disabled} onChange={(minutes) => onStageTime(key, minutes)} />}
            {onStageResource && stages.includes(key) && <StageResourceSelect label={stageLabel(key)} value={stageResources?.[key]} options={resourceOptions} disabled={disabled} onChange={(choice) => onStageResource(key, choice)} />}
          </SortableStageItem>)}</div>
        </SortableStages>
      </SortableStageItem>})}
    </SortableStages>
  </div></fieldset>
}
