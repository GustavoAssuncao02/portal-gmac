import { TriangleAlert } from 'lucide-react'
import PieceTrack, { workingStageKeys } from './PieceTrack.jsx'
import { stageGroupLabel } from '../server/serviceStages.js'
import { serviceDeadline } from './serviceDeadline.js'
import { currentPieceProgress, isEmergency } from './serviceProgress.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { activeEmployeeNames, operationElapsed } from '../server/operationSessions.js'
import { formatQuantity } from '../server/materialUnits.js'

export const panelDuration = (milliseconds) => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':')
}
export const collaboratorNames = (order) => (order.collaborators || []).map((person) => person.name).join(', ')
// A finished OS is measured against its deadline at the moment it was completed.
export function panelDeadline(order, now) {
  const completedAt = Date.parse(order.operation.completedAt)
  return serviceDeadline(order, order.operation.status === 'completed' && Number.isFinite(completedAt) ? completedAt : now)
}

// One OS of the services panel. The actions are optional: without them (the operator's tablet before the code) the row
// only follows the work, with no button to open the OS.
export default function ServicePanelRow({ order, now, completedView = false, highlighted = false, onSelectOrder, onMaterialAlert, onCompletedStatus }) {
  const operation = order.operation
  const due = operation.status === 'completed' ? { key: 'completed', label: 'Concluído', remaining: '—' } : panelDeadline(order, now)
  const pieceProgress = currentPieceProgress(operation, order.quantity)
  const completedPieces = pieceProgress.completedPieces
  const current = pieceProgress.stages.find((stage) => !stage.filled)
  const completionAt = [operation.completedAt, operation.completionAcknowledgedAt, order.createdAt].find((value) => Number.isFinite(Date.parse(value)))
  const pendingMaterials = pendingOrderMaterials(order)
  const hasPendingMaterial = !completedView && pendingMaterials.length > 0
  const materialTitle = pendingMaterials.map((material) => `${material.name}: ${formatQuantity(material.quantity, material.unit)} pendentes`).join('; ')
  return <tr className={[hasPendingMaterial ? 'admin-os-row--material-pending' : '', highlighted ? 'admin-os-row--reopened' : '', isEmergency(order) ? 'admin-os-row--emergency' : ''].filter(Boolean).join(' ') || undefined}><td><strong>{order.service}</strong><small>{order.code}{order.labelNumber ? ` · Etiqueta ${order.labelNumber}` : ''}{isEmergency(order) && <> · <span className="os-emergency-label">Emergencial</span></>}</small>{hasPendingMaterial && (onMaterialAlert ? <button type="button" className="admin-os-material-alert" title={materialTitle} onClick={() => onMaterialAlert(order.code)}><TriangleAlert size={16} aria-hidden="true" />Material pendente</button> : <span className="admin-os-material-alert" title={materialTitle}><TriangleAlert size={16} aria-hidden="true" />Material pendente</span>)}</td><td data-label="Cliente">{order.company}</td><td data-label={completedView ? 'Colaboradores' : 'Operador'}>{(completedView ? collaboratorNames(order) : activeEmployeeNames(operation)) || '—'}</td><td data-label="Etapa atual">{current ? stageGroupLabel(current) || 'Não definida' : operation.stages.length ? 'Etapas concluídas' : 'Não definida'}</td><td data-label="Peças concluídas">{completedPieces}/{order.quantity}</td>
    {!completedView && <td data-label="Progresso">{operation.stages.length ? <div className={`admin-os-stage-track admin-os-stage-track--${due.key}${operation.stages.length > 8 ? ' admin-os-stage-track--many' : ''}`} style={{ '--stage-count': operation.stages.length, '--stage-columns': pieceProgress.stages.map((stage, index) => `${String(index + 1).length + stage.name.length + 3}fr`).join(' ') }} role="group" aria-label={`Progresso da peça ${pieceProgress.pieceNumber} de ${order.quantity}. Progresso total: ${operation.progress}%. ${due.label}`}>
      {pieceProgress.stages.map((stage, index) => <span className="admin-os-stage admin-os-stage--pieces" key={stage.key}>
        <span className="admin-os-stage-label">{index + 1}. {stage.name}</span>
        <span className="admin-os-stage-block"><PieceTrack count={stage.count} quantity={order.quantity} working={workingStageKeys(operation, order.quantity).has(stage.key)} label={stage.name} /></span>
      </span>)}
    </div> : <span className="admin-os-stage-empty">Etapas não definidas</span>}</td>}
    <td data-label="Tempo ativo">{panelDuration(operationElapsed(operation, now))}</td><td data-label={completedView ? 'Conclusão' : 'Tempo restante'} className={`admin-os-remaining admin-os-remaining--${due.key}`}>{completedView ? completionAt ? new Date(completionAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }) : '—' : due.remaining}</td><td data-label="Status">{completedView ? <span className="admin-os-status admin-os-status--completed">Concluído</span> : operation.status === 'completed' ? onCompletedStatus ? <button className="admin-os-status admin-os-status--completed" type="button" aria-label="Concluído" title="Programar o recebimento e retirar do painel" aria-haspopup="dialog" onClick={() => onCompletedStatus(order.code)}>Concluído</button> : <span className="admin-os-status admin-os-status--completed">Concluído</span> : <span className={`admin-os-status admin-os-status--deadline-${due.key}`}>{due.label}</span>}</td>{completedView && <td data-label="Pedido de compra">{order.purchaseOrders?.length ? <span className="admin-os-po admin-os-po--yes">Possui ({order.purchaseOrders.length})</span> : <span className="admin-os-po admin-os-po--no">Não possui</span>}</td>}{onSelectOrder && <td><button type="button" onClick={() => onSelectOrder(order.code)}>Ver OS</button></td>}</tr>
}
