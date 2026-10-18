import { stageGroupProgress } from './serviceProgress.js'

const stateLabels = { waiting: 'Não iniciada', active: 'Em andamento', done: 'Concluída' }

// Heading of a group of stages, shared by the operator screen and the project information: the name of the group, where it
// stands, the passages registered and a thin progress bar. The group is told apart by a quiet accent color (see operator.css).
export default function StageGroupHeading({ group, stageCounts, quantity, className }) {
  const { done, total, percent, state } = stageGroupProgress(group, stageCounts, quantity)
  return <div className={`${className} stage-group--${state}`}>
    <div className="stage-group-title"><h4>{group.name}</h4><em className="stage-group-state">{stateLabels[state]}</em></div>
    <span className="stage-group-count">{done}/{total} passagens</span>
    <div className="stage-group-bar" role="progressbar" aria-label={`Progresso de ${group.name}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: `${percent}%` }} /></div>
  </div>
}