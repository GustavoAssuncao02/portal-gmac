import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { legacyStageGroup, stageLabel, orderedStageSelection } from '../server/serviceStages.js'

function SortableStageItem({ id, label, disabled, group = false, legacy = false, selected = false, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({ id, disabled, transition: null })
  const handle = <button type="button" ref={setActivatorNodeRef} className="offer-stage-drag" {...attributes} {...listeners} disabled={disabled} aria-label={`Reordenar ${group ? 'grupo' : 'etapa'} ${label}`} title={`Reordenar ${label}`}><GripVertical size={16} /></button>
  return <div ref={setNodeRef} data-stage-id={id} className={`${group ? 'offer-stage-group' : 'offer-stage-item'}${selected ? ' offer-stage-item--selected' : ''}${legacy ? ' offer-stage-group--legacy' : ''}${isDragging ? ' offer-stage-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform) }}>
    {group ? <div className="offer-stage-heading">{handle}<h3>{label}</h3>{children[0]}</div> : handle}{group ? children.slice(1) : children}
  </div>
}

// Planned time of a checked stage, typed as hours and minutes and saved in minutes when the field is left.
function StageTimeInput({ label, minutes, disabled, onChange }) {
  const split = (value) => ({ hours: value ? String(Math.floor(value / 60)) : '', mins: value ? String(value % 60) : '' })
  const [draft, setDraft] = useState(() => split(minutes))
  useEffect(() => { setDraft(split(minutes)) }, [minutes])
  const commit = () => {
    const total = Math.max(0, Math.floor(Number(draft.hours) || 0)) * 60 + Math.max(0, Math.floor(Number(draft.mins) || 0))
    if (total !== (minutes || 0)) onChange(total || null)
  }
  return <span className="offer-stage-time" title="Tempo previsto para esta etapa na OS inteira" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) commit() }}>
    <input type="number" min="0" step="1" inputMode="numeric" value={draft.hours} disabled={disabled} aria-label={`Horas previstas de ${label}`} placeholder="0" onChange={(event) => setDraft({ ...draft, hours: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><small>h</small>
    <input type="number" min="0" max="59" step="1" inputMode="numeric" value={draft.mins} disabled={disabled} aria-label={`Minutos previstos de ${label}`} placeholder="00" onChange={(event) => setDraft({ ...draft, mins: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /><small>min</small>
  </span>
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
export default function ServiceStageEditor({ layout, stages, onLayoutChange, onToggle, disabled, stageTimes, onStageTime }) {
  const visibleGroups = layout.filter((entry) => entry.group !== legacyStageGroup || entry.stages.some((key) => stages.includes(key)))
  const sequence = orderedStageSelection(layout, stages), position = (key) => sequence.indexOf(key) + 1
  return <fieldset><legend>Etapas do serviço</legend>
    <p className="offer-stage-hint">As etapas marcadas são feitas <strong>de cima para baixo</strong>, na ordem dos números. Arraste <GripVertical size={13} aria-hidden="true" /> para mudar a ordem de uma etapa ou de um grupo.{onStageTime && ' Ao lado de cada etapa marcada, informe o tempo previsto para a OS inteira: é a meta que o operador vê.'}</p>
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
          </SortableStageItem>)}</div>
        </SortableStages>
      </SortableStageItem>})}
    </SortableStages>
  </div></fieldset>
}
