import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { legacyStageGroup, stageLabel } from '../server/serviceStages.js'

function SortableStageItem({ id, label, disabled, group = false, legacy = false, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({ id, disabled, transition: null })
  const handle = <button type="button" ref={setActivatorNodeRef} className="offer-stage-drag" {...attributes} {...listeners} disabled={disabled} aria-label={`Reordenar ${group ? 'grupo' : 'etapa'} ${label}`} title={`Reordenar ${label}`}><GripVertical size={16} /></button>
  return <div ref={setNodeRef} data-stage-id={id} className={`${group ? 'offer-stage-group' : 'offer-stage-item'}${legacy ? ' offer-stage-group--legacy' : ''}${isDragging ? ' offer-stage-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform) }}>
    {group ? <div className="offer-stage-heading">{handle}<h3>{label}</h3></div> : handle}{children}
  </div>
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

export default function ServiceStageEditor({ layout, stages, onLayoutChange, onToggle, disabled }) {
  const visibleGroups = layout.filter((entry) => entry.group !== legacyStageGroup || entry.stages.some((key) => stages.includes(key)))
  return <fieldset><legend>Etapas do serviço</legend><div className="offer-stage-groups">
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
        return <SortableStageItem key={entry.group} id={entry.group} label={entry.group} group legacy={entry.group === legacyStageGroup} disabled={disabled}>
        <SortableStages ids={options} onMove={(keys) => {
          let index = 0
          onLayoutChange(layout.map((item) => item.group === entry.group ? { ...item, stages: item.stages.map((key) => keys.includes(key) ? keys[index++] : key) } : item))
        }}>
          <div className="offer-stage-options">{options.map((key) => <SortableStageItem key={key} id={key} label={stageLabel(key)} disabled={disabled}>
            <label><input type="checkbox" checked={stages.includes(key)} disabled={disabled} onChange={() => onToggle(key)} />{stageLabel(key)}</label>
          </SortableStageItem>)}</div>
        </SortableStages>
      </SortableStageItem>})}
    </SortableStages>
  </div></fieldset>
}
