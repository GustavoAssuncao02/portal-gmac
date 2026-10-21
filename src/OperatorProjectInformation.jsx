import DownloadLink from './DownloadLink.jsx'
import StageGroupHeading from './OperatorStageGroup.jsx'
import { currentPieceProgress, groupProjectStages, stageGroupTone } from './serviceProgress.js'
import { activeEmployeeNames, activeSessions, activeSince, operationElapsed } from '../server/operationSessions.js'
import { documentKind } from '../server/clientDocument.js'

const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '\u2014'
const moment = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '\u2014'
const number = (value) => Number(value || 0).toLocaleString('pt-BR')
const delivery = (value) => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? date(value) : value || '\u2014'
const stockLabels = { available: 'Dispon\u00edvel', partial: 'Estoque parcial', missing: 'Sem estoque', unknown: 'N\u00e3o verificado' }
const fileSize = (value) => value >= 1048576 ? `${number(Math.round(value / 1048576 * 10) / 10)} MB` : `${number(Math.ceil((value || 0) / 1024))} KB`

export default function OperatorProjectInformation({ order, token, events, now, onBack, statusLabels, eventLabels, formatDuration }) {
  const operation = order.operation
  const materials = order.resources?.materials || []
  const laborEntries = order.resources?.laborEntries || []
  const attachments = order.attachments || []
  const activeMs = operationElapsed(operation, now)
  const sessions = activeSessions(operation)
  const currentStart = activeSince(operation)
  const unique = (values) => [...new Set(values.filter(Boolean))].join(', ')
  const current = operation.stages.find((stage) => Number(operation.stageCounts[stage.key] || 0) < Number(order.quantity))
  const completedPieces = currentPieceProgress(operation, order.quantity).completedPieces
  const facts = [
    ['OS', order.code], ['Etiqueta', order.labelNumber || 'Não informada'], ['Tipo', order.kind === 'product' ? 'Produto' : 'Servi\u00e7o'],
    ['Cliente', order.company], [documentKind(order.cnpj), order.cnpj], ['Quantidade', `${number(order.quantity)} unidades`],
    ['Solicita\u00e7\u00e3o recebida', moment(order.requestedAt)], ['OS criada em', moment(order.createdAt)],
    ['Prazo solicitado', date(order.deadline)], ['Entrega prevista', delivery(order.deliveryDeadline || order.deadline)],
    ['Processo', order.resources?.strictProcess === false ? 'Etapas livres' : 'Sequência obrigatória'],
    ['Fabricado a partir de', order.resources?.manufacturedFrom === 'sample' ? 'Amostra' : order.resources?.manufacturedFrom === 'drawing' ? 'Desenho' : '\u2014'], ['Têmpera', order.resources?.tempering === true ? 'Sim' : order.resources?.tempering === false ? 'Não' : '\u2014'], ['Cor/Tipo', order.resources?.paintColor || '\u2014'], ['Máquina atual', unique(sessions.map((session) => session.machineName)) || '\u2014'], ['Servi\u00e7o atual', unique(sessions.map((session) => session.laborServiceName)) || '\u2014'],
  ]
  return <div className="operator-project-info">
    <header className="operator-info-header">
      <button className="operator-info-back" type="button" onClick={onBack}><span aria-hidden="true">{'\u2190'}</span>Voltar aos projetos</button>
      <div><h1>Informações do projeto</h1><span className={`operator-status operator-status--${operation.status}`}>{statusLabels[operation.status]}</span></div>
      <h2>{order.service}</h2>
    </header>
    <section className="operator-info-section" aria-labelledby="operator-info-details"><h3 id="operator-info-details">Dados do projeto</h3><dl className="operator-info-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl></section>
    <section className="operator-info-section" aria-labelledby="operator-info-description"><h3 id="operator-info-description">Descrição do serviço</h3><p className="operator-info-description">{order.description || 'Nenhuma descri\u00e7\u00e3o informada.'}</p>{order.resources?.serviceDescription && <p className="operator-info-description">{order.resources.serviceDescription}</p>}</section>
    <section className="operator-info-section" aria-labelledby="operator-info-materials"><h3 id="operator-info-materials">Materiais necessários</h3>{materials.length ? <div className="operator-info-table-scroll"><table><thead><tr><th>Material</th><th>Especificação</th><th>Quantidade necessária</th><th>Estoque</th><th>Quantidade a solicitar</th></tr></thead><tbody>{materials.map((material) => <tr key={material.id}><td>{material.name}</td><td>{material.detail || '\u2014'}</td><td>{number(material.quantity)} kg</td><td>{stockLabels[material.stockStatus] || stockLabels.unknown}{material.stockStatus && material.stockStatus !== 'unknown' && <small>{number(material.stockAvailable)} kg disponíveis</small>}</td><td>{number(material.purchaseQuantity ?? Math.max(0, Number(material.quantity) - Number(material.stockAvailable || 0)))} kg</td></tr>)}</tbody></table></div> : <p>Nenhum material informado.</p>}</section>
    <section className="operator-info-section" aria-labelledby="operator-info-resources"><h3 id="operator-info-resources">Máquinas e serviços previstos</h3>{laborEntries.length ? <div className="operator-info-table-scroll"><table><thead><tr><th>Tipo de recurso</th><th>Máquina / serviço</th><th>Tempo previsto</th></tr></thead><tbody>{laborEntries.map((entry) => <tr key={entry.id}><td>{entry.type === 'machine' ? 'Hora m\u00e1quina' : 'Hora homem'}</td><td>{entry.resource}</td><td>{number(entry.hours)} h</td></tr>)}</tbody></table></div> : <p>Nenhum recurso informado.</p>}<dl className="operator-info-facts operator-info-time-estimates"><div><dt>Tempo de máquina previsto</dt><dd>{order.estimatedMachineTime || `${number(laborEntries.filter((entry) => entry.type === 'machine').reduce((total, entry) => total + Number(entry.hours || 0), 0))} h`}</dd></div><div><dt>Tempo de serviço previsto</dt><dd>{order.estimatedServiceTime || `${number(laborEntries.reduce((total, entry) => total + Number(entry.hours || 0), 0))} h`}</dd></div></dl></section>
    <section className="operator-info-section operator-info-section--progress" aria-labelledby="operator-info-operation"><h3 id="operator-info-operation">Andamento e etapas</h3><dl className="operator-info-facts">
      <div><dt>{sessions.length > 1 ? 'Operadores atuais' : 'Operador atual'}</dt><dd>{activeEmployeeNames(operation) || 'Aguardando identifica\u00e7\u00e3o'}</dd></div><div><dt>Etapa atual</dt><dd>{current?.name || (operation.stages.length ? 'Etapas conclu\u00eddas' : 'N\u00e3o definida')}</dd></div><div><dt>Progresso</dt><dd>{number(operation.progress)}%</dd></div><div><dt>Peças concluídas</dt><dd>{number(completedPieces)}/{number(order.quantity)}</dd></div><div><dt>Tempo ativo</dt><dd>{formatDuration(activeMs)}</dd></div><div><dt>Tempo da sessão atual</dt><dd>{formatDuration(currentStart ? now - Date.parse(currentStart) : 0)}</dd></div><div><dt>Trabalho iniciado em</dt><dd>{moment(operation.startedAt)}</dd></div><div><dt>Concluído em</dt><dd>{moment(operation.completedAt)}</dd></div>{operation.lastPauseReason && <div><dt>Última pausa</dt><dd>{operation.lastPauseReason}</dd></div>}
    </dl>{operation.stages.length ? <div className="operator-info-stage-groups">{groupProjectStages(operation.stages).map((group) => <section className={`operator-info-stage-group stage-tone--${stageGroupTone(group.name)}`} key={group.stages[0].stage.key} aria-label={`Etapas de ${group.name}`}>
      <StageGroupHeading className="operator-info-stage-heading" group={group} stageCounts={operation.stageCounts} quantity={order.quantity} />
      <ol className="operator-info-stage-list">{group.stages.map(({ stage, index }) => <li key={stage.key}><span>{index + 1}</span><strong>{stage.name}</strong><small>{number(operation.stageCounts[stage.key])}/{number(order.quantity)} peças</small></li>)}</ol>
    </section>)}</div> : <p>Nenhuma etapa definida.</p>}</section>
    <section className="operator-info-section" aria-labelledby="operator-info-files"><h3 id="operator-info-files">Arquivos da OS <small>({attachments.length})</small></h3>{attachments.length ? <ul className="operator-info-files">{attachments.map((file) => {
      const url = `/api/offers/${encodeURIComponent(order.offerId)}/attachments/${encodeURIComponent(file.id)}`
      return <li key={file.id}><div><strong>{file.name}</strong><small>{file.contentType || 'Arquivo'}{file.size != null ? ` \u00b7 ${fileSize(file.size)}` : ''}</small></div><DownloadLink url={url} name={file.name} token={token} className="operator-info-download" aria-label={`Baixar ${file.name}`}>Baixar arquivo</DownloadLink></li>
    })}</ul> : <p>Nenhum arquivo anexado à OS.</p>}</section>
    <section className="operator-info-section" aria-labelledby="operator-info-history"><h3 id="operator-info-history">Histórico de atividades</h3>{events.length ? <ol className="operator-info-events">{[...events].reverse().map((event) => <li key={event.id}><strong>{eventLabels[event.type] || event.type}</strong><span>{event.employeeName || 'Administrador'} · {moment(event.at)}{event.registeredByEmployeeName ? ` · Registrado por ${event.registeredByEmployeeName}` : ''}</span>{event.reason && <p>{event.reason}</p>}{event.stageName && <p>{event.stageName}: +{number(event.quantity)} peças · Total: {number(event.stageTotal)}</p>}{event.details?.length > 0 && <p>{Array.isArray(event.details) ? event.details.join(', ') : event.details}</p>}</li>)}</ol> : <p>Nenhuma atividade registrada.</p>}</section>
  </div>
}
