// Pieces of one stage: a slot per piece (up to 30; above that, a continuous bar). Pieces already made are dark blue while
// someone is working on the OS and turn green when the work stops; a finished stage is all green; what is missing stays gray.
import { productionStages } from '../server/serviceStages.js'

export const PIECE_SLOTS_LIMIT = 30

// While someone works, the stages in production are dark blue: the stage each operator chose to work on, plus any stage
// where an open session has registered pieces. Sessions started before the choice existed use the first unfinished stage.
export function workingStageKeys(operation, quantity) {
  const sessions = operation?.activeSessions || []
  if (!sessions.length) return new Set()
  const unfinished = (key) => Number(operation.stageCounts?.[key] || 0) < Number(quantity)
  const first = sessions.some((session) => !session.stageKey) ? (operation.stages || []).find((stage) => unfinished(stage.key))?.key : null
  return new Set([first, ...sessions.flatMap((session) => [session.stageKey, ...(session.workedStages || [])])].filter((key) => key && unfinished(key)))
}

// Planned time of an operation stage (the OS stores it by stage code) and the time already spent on it, people added up.
export const stageCode = (stage) => productionStages.find(([, label]) => label === stage?.name)?.[0] ?? null
export function stageElapsedMs(operation, stageKey, now = Date.now()) {
  const open = (operation?.activeSessions || []).filter((session) => session.stageKey === stageKey).reduce((sum, session) => sum + Math.max(0, now - Date.parse(session.stageSince || session.startedAt)), 0)
  return Number(operation?.stageTimeMs?.[stageKey] || 0) + open
}
export const minutesLabel = (minutes) => { const value = Math.max(0, Math.round(minutes)); const hours = Math.floor(value / 60), rest = value % 60; return hours ? `${hours}h${rest ? ` ${rest}min` : ''}` : `${rest}min` }

export function pieceTrackState(count, quantity, working, alert = false) {
  const total = Math.max(0, Math.floor(Number(quantity) || 0)), done = Math.min(total, Math.max(0, Math.floor(Number(count) || 0)))
  // A finished stage is always green, even if it took longer than planned.
  return { total, done, tone: total && done >= total ? 'done' : alert ? 'alert' : working ? 'working' : 'stopped', slots: total > 0 && total <= PIECE_SLOTS_LIMIT }
}

export default function PieceTrack({ count, quantity, working = false, alert = false, label, className = '' }) {
  const { total, done, tone, slots } = pieceTrackState(count, quantity, working, alert)
  const text = `${label ? `${label}: ` : ''}${done} de ${total} peças${tone === 'done' ? ', concluída' : tone === 'alert' ? ', perto do tempo previsto' : tone === 'working' ? ', em produção' : ''}`
  return <div className={`piece-track piece-track--${tone} ${className}`} role="progressbar" aria-label={text} title={text} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
    {slots ? Array.from({ length: total }, (_, index) => <i key={index} className={index < done ? 'piece-track-filled' : undefined} />) : <i className="piece-track-filled piece-track-bar" style={{ width: `${total ? done / total * 100 : 0}%` }} />}
  </div>
}
