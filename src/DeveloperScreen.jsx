import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Clock3, Copy, Database, Download, HardDrive, PencilLine, RefreshCw, Search, Server, Settings2, Users, XCircle } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { downloadBlob, downloadFile, payableRequest } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
import UpdateSchedule from './UpdateSchedule.jsx'
import ReleaseNotesEditor from './ReleaseNotesEditor.jsx'
import { PayableModal } from './PayableModal.jsx'
import './developer.css'

// Tela Desenvolvedor (only the accounts of server/developers.js): the logs of the system, who is online, how the server,
// the database and the storage are, and the export of everything in one file to hand over when solving a problem.
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
const periods = [[HOUR, 'Última hora'], [DAY, 'Últimas 24 horas'], [7 * DAY, 'Últimos 7 dias'], [30 * DAY, 'Últimos 30 dias']]
const exportPeriods = [[1, '24 horas'], [7, '7 dias'], [30, '30 dias']]
const levels = [['', 'Todos'], ['error', 'Erros'], ['warn', 'Avisos'], ['info', 'Informações']]
const levelNames = { error: 'Erro', warn: 'Aviso', info: 'Info' }
const sources = [['', 'Todas as origens'], ['server', 'Servidor'], ['request', 'Requisições'], ['browser', 'Navegador'], ['system', 'Sistema']]
const sourceNames = Object.fromEntries(sources)
const roleNames = { admin: 'Administrador', staff: 'Administrativo', operator: 'Tablet do operador' }
const metricTitles = { users: 'Usuários online', errors: 'Erros (24 h)', warnings: 'Avisos (24 h)', requests: 'Requisições (60 min)', server: 'Servidor no ar', database: 'Banco de dados' }

const moment = (ms) => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
const clock = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' })
const integer = (value) => Number(value || 0).toLocaleString('pt-BR')
function duration(seconds) {
  const total = Math.max(0, Math.round(seconds)), days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600), minutes = Math.floor(total % 3600 / 60)
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`
}
const ago = (ms) => { const minutes = Math.floor((Date.now() - ms) / MINUTE); return minutes < 1 ? 'agora' : minutes < 60 ? `há ${minutes} min` : `há ${duration((Date.now() - ms) / 1000)}` }
function bytes(value) {
  if (value == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(value), unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toLocaleString('pt-BR', { maximumFractionDigits: size < 10 && unit ? 1 : 0 })} ${units[unit]}`
}
const yes = (value) => value ? 'Sim' : 'Não'

function Metric({ icon: Icon, tone = '', kind, value, detail, onOpen }) {
  return <button type="button" aria-haspopup="dialog" className={`developer-metric${tone ? ` developer-metric--${tone}` : ''}`} onClick={() => onOpen(kind)}>
    <span className="developer-metric-icon" aria-hidden="true"><Icon size={18} /></span><span className="developer-metric-text"><small>{metricTitles[kind]}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</span><ChevronRight className="developer-metric-arrow" size={14} aria-hidden="true" />
  </button>
}
function Facts({ title, icon: Icon, rows }) {
  return <section className="developer-card"><h3><Icon size={16} aria-hidden="true" />{title}</h3><dl>{rows.filter(Boolean).map(([label, value, tone]) => <div key={label}><dt>{label}</dt><dd className={tone ? `developer-tone--${tone}` : undefined}>{value ?? '—'}</dd></div>)}</dl></section>
}

// "2 pessoas e 1 tablet em versão antiga": who is online with a build different from the one published now.
function outdatedText(outdated) {
  const parts = [outdated?.people ? `${integer(outdated.people)} ${outdated.people === 1 ? 'pessoa' : 'pessoas'}` : '', outdated?.tablets ? `${integer(outdated.tablets)} ${outdated.tablets === 1 ? 'tablet' : 'tablets'}` : ''].filter(Boolean)
  return parts.length ? `${parts.join(' e ')} em versão antiga` : ''
}
const userMoment = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'medium' }) : 'Sem registro'
const useTime = (ms) => ms == null ? 'Sem medição' : ms === 0 ? '0 min' : ms < MINUTE ? `${Math.max(1, Math.round(ms / 1000))} s` : duration(Math.floor(ms / 1000))
const searchable = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function UserDetails({ person, onClose }) {
  return <PayableModal title={person.name} onClose={onClose} footer={<button type="button" className="admin-tool-button" onClick={onClose}>Fechar</button>}>
    <Facts title="Conta e atividade" icon={Users} rows={[
      ['Tipo', roleNames[person.role] || person.role], person.id != null && ['ID da conta', person.id], person.email && ['E-mail', person.email],
      person.registeredAt && ['Conta criada em', userMoment(person.registeredAt)], ['Último login registrado', userMoment(person.lastLoginAt)],
      ['Atividade no último login', useTime(person.lastLoginActiveMs)], ['Uso nas últimas 24 h', useTime(person.usage24hMs)], ['Logins registrados nas últimas 24 h', person.logins24h ?? 'Sem registro'],
      ['Última atividade medida', userMoment(person.lastActivityAt)], ['Visto por último', userMoment(person.lastSeenAt ?? person.lastAt)],
    ]} />
    <Facts title="Conexão" icon={Activity} rows={[
      ['Conexões ao vivo', person.tabs || 0], person.since && ['Presença observada desde', userMoment(person.since)],
      ['Dispositivo', person.device], ['IP', person.ip], ['Versão', person.version], person.build && ['Identificador da interface', person.build],
    ]} />
    {person.devices?.length > 0 && <section className="developer-card"><h3>Tablets observados recentemente</h3>
      <ul className="developer-user-devices">{person.devices.map((device) => <li key={device.key}>
        <strong>{device.device || 'Dispositivo sem identificação'}</strong>
        <span>{device.ip || 'IP indisponível'} · {device.version ? `Versão ${device.version}` : 'Versão indisponível'}{device.outdated ? ' (desatualizada)' : ''}</span>
        <span>{device.online ? `Online · ${device.tabs} ${device.tabs === 1 ? 'aba' : 'abas'}` : `Visto em ${userMoment(device.lastAt)}`}</span>
      </li>)}</ul>
    </section>}
  </PayableModal>
}

function DeveloperUsers({ online, users }) {
  const people = users?.people || online?.people || []
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selectedKey, setSelectedKey] = useState(null)
  const selected = people.find((person) => person.key === selectedKey)
  const query = searchable(search.trim())
  const visible = people.filter((person) => (filter === 'all' || person.online === (filter === 'online')) && searchable([person.name, person.email, person.ip, person.device].filter(Boolean).join(' ')).includes(query))
  const outdated = outdatedText(online?.outdated)
  return <section className="developer-section" aria-labelledby="developer-online-title">
    <div className="developer-section-heading"><h2 id="developer-online-title">Usuários</h2>{outdated && <span className="developer-outdated-count"><AlertTriangle size={13} aria-hidden="true" />{outdated}</span>}</div>
    <p className="developer-user-note">{online?.rule} Os tempos estimam o uso com a aba visível e em foco após uma interação, por até 1 min sem nova interação. Horário da Bahia. {outdated && 'Uma versão desatualizada precisa recarregar a página.'}</p>
    {users !== undefined && !users?.historyAvailable && <p className="admin-tool-error" role="status">O histórico de uso está indisponível no momento.</p>}
    <div className="developer-filters developer-user-filters">
      <label className="developer-search">Buscar usuário<span><Search size={15} aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, e-mail, IP ou dispositivo" /></span></label>
      <div className="developer-levels" role="group" aria-label="Filtrar por situação">{[['all', 'Todos'], ['online', 'Online'], ['offline', 'Offline']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className="developer-chip" onClick={() => setFilter(value)}>{label}</button>)}</div>
    </div>
    {visible.length ? <div className="developer-table-wrap"><table className="developer-table developer-online-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Situação</th><th>Último login</th><th>Atividade no último login</th><th>Uso em 24 h</th><th>Dispositivo</th><th>Versão</th><th>IP</th></tr></thead>
      <tbody>{visible.map((person) => <tr key={person.key} className={person.online ? '' : 'developer-row--idle'}>
        <td data-label="Nome"><button className="developer-user-link" type="button" onClick={() => setSelectedKey(person.key)}>{person.name}</button></td><td data-label="Tipo">{roleNames[person.role] || person.role}</td>
        <td data-label="Situação"><span className={`developer-presence${person.online ? ' developer-presence--on' : ''}`}><i aria-hidden="true" />{person.tabs ? `Portal aberto (${person.tabs} ${person.tabs === 1 ? 'aba' : 'abas'})` : person.online ? 'Ativo' : 'Offline'}</span>
          {(person.lastSeenAt || person.lastAt) && <small className="developer-user-seen" title={userMoment(person.lastSeenAt || person.lastAt)}>Visto {ago(person.lastSeenAt || person.lastAt)}</small>}</td>
        <td data-label="Último login">{userMoment(person.lastLoginAt)}</td><td data-label="Atividade no último login">{useTime(person.lastLoginActiveMs)}</td><td data-label="Uso em 24 h">{useTime(person.usage24hMs)}</td>
        <td data-label="Dispositivo">{person.device || '—'}</td>
        <td data-label="Versão"><span className="developer-version">{person.version || '—'}{person.outdated && <span className="developer-outdated">desatualizada</span>}</span></td><td data-label="IP">{person.ip || '—'}</td>
      </tr>)}</tbody></table></div> : <p className="developer-empty">Nenhum usuário encontrado.</p>}
    {selected && <UserDetails person={selected} onClose={() => setSelectedKey(null)} />}
  </section>
}

function LogDetails({ entry }) {
  const { details } = entry
  if (!details) return <p className="developer-empty">Sem detalhes registrados.</p>
  const stack = details.stack || details.error?.stack
  const rest = { ...details }
  delete rest.stack
  if (rest.error) rest.error = { ...rest.error, stack: undefined }
  return <div className="developer-log-details">
    <pre>{JSON.stringify(rest, null, 2)}</pre>
    {stack && <><h4>Pilha do erro</h4><pre>{stack}</pre></>}
  </div>
}

function LogEntries({ items, open, toggle }) {
  return <ol className="developer-log-list">
    {items.map((entry) => { const expanded = open.has(entry.id); return <li key={entry.id} className={`developer-log developer-log--${entry.level}`}>
      <button type="button" aria-expanded={expanded} onClick={() => toggle(entry.id)}>
        {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <time>{moment(entry.at)}</time><span className={`developer-level developer-level--${entry.level}`}>{levelNames[entry.level] || entry.level}</span><span className="developer-source">{sourceNames[entry.source] || entry.source}</span>
        <span className="developer-message">{entry.message}</span><span className="developer-user">{entry.user || ''}</span>
      </button>
      {expanded && <LogDetails entry={entry} />}
    </li> })}
  </ol>
}

function useOpenLogs() {
  const [open, setOpen] = useState(() => new Set())
  const toggle = (id) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return { open, toggle }
}

function Logs({ refreshKey }) {
  const [level, setLevel] = useState(''), [source, setSource] = useState(''), [period, setPeriod] = useState(DAY), [typed, setTyped] = useState(''), [search, setSearch] = useState('')
  const [items, setItems] = useState(null), [more, setMore] = useState(false), [error, setError] = useState(''), [loadingMore, setLoadingMore] = useState(false)
  const openLogs = useOpenLogs()
  const latest = useRef(0), lastQuery = useRef(null), shown = useRef(null)
  shown.current = items
  useEffect(() => { const timer = window.setTimeout(() => setSearch(typed.trim()), 350); return () => window.clearTimeout(timer) }, [typed])
  const query = useCallback((before) => {
    const params = new URLSearchParams({ limit: '200', since: String(Date.now() - period) })
    if (level) params.set('level', level)
    if (source) params.set('source', source)
    if (search) params.set('search', search)
    if (before) params.set('before', before)
    return payableRequest(`/developer/logs?${params}`)
  }, [level, source, period, search])
  // The first page again. New filters replace the list; the automatic refresh keeps the older pages already loaded.
  useEffect(() => {
    const id = ++latest.current, sameFilters = lastQuery.current === query
    lastQuery.current = query
    query().then((data) => {
      if (id !== latest.current) return
      const oldest = Number(data.items.at(-1)?.id), current = shown.current
      const keepPages = sameFilters && Number.isFinite(oldest) && current?.length > data.items.length
      setItems(keepPages ? [...data.items, ...current.filter((item) => Number(item.id) < oldest)] : data.items)
      if (!keepPages) setMore(data.more)
      setError('')
    }).catch((caught) => { if (id === latest.current) setError(caught.message) })
  }, [query, refreshKey])
  async function loadMore() {
    setLoadingMore(true)
    try { const data = await query(items.at(-1)?.id); setItems((current) => [...current, ...data.items.filter((item) => !current.some((other) => other.id === item.id))]); setMore(data.more) } catch (caught) { setError(caught.message) } finally { setLoadingMore(false) }
  }
  return <section className="developer-section" aria-labelledby="developer-logs-title">
    <div className="developer-section-heading"><h2 id="developer-logs-title">Logs do sistema</h2><small>Erros, avisos e alterações ficam guardados por 30 dias. Clique em um registro para ver os detalhes.</small></div>
    <div className="developer-filters">
      <div className="developer-levels" role="group" aria-label="Nível">{levels.map(([value, label]) => <button key={value || 'all'} type="button" aria-pressed={level === value} className={`developer-chip${value ? ` developer-chip--${value}` : ''}`} onClick={() => setLevel(value)}>{label}</button>)}</div>
      <label>Origem<select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select></label>
      <label>Período<select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="developer-search">Buscar<span><Search size={15} aria-hidden="true" /><input type="search" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Mensagem, usuário, rota..." /></span></label>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!items ? <p className="developer-empty" role="status">Carregando logs...</p> : !items.length ? <p className="developer-empty">Nenhum registro com esses filtros.</p> : <LogEntries items={items} {...openLogs} />}
    {items && more && <button className="admin-tool-button developer-more" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>}
  </section>
}

const trafficViews = [['slowest', 'Mais lentas'], ['failing', 'Com erros'], ['busiest', 'Mais usadas']]
function TrafficRoutes({ traffic }) {
  const [view, setView] = useState('slowest')
  const rows = traffic?.[view] || []
  return <>
    <div className="developer-levels" role="group" aria-label="Ordenar rotas">{trafficViews.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} className="developer-chip" onClick={() => setView(value)}>{label}</button>)}</div>
    {rows.length ? <div className="developer-table-wrap"><table className="developer-table"><thead><tr><th>Rota</th><th className="developer-number">Requisições</th><th className="developer-number">Erros 4xx</th><th className="developer-number">Erros 5xx</th><th className="developer-number">Média</th><th className="developer-number">p95</th><th className="developer-number">Máximo</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.route}><td data-label="Rota"><code>{row.route}</code></td><td data-label="Requisições" className="developer-number">{integer(row.count)}</td><td data-label="Erros 4xx" className="developer-number">{integer(row.clientErrors)}</td><td data-label="Erros 5xx" className={`developer-number${row.serverErrors ? ' developer-tone--bad' : ''}`}>{integer(row.serverErrors)}</td><td data-label="Média" className="developer-number">{integer(row.averageMs)} ms</td><td data-label="p95" className="developer-number">{integer(row.p95Ms)} ms</td><td data-label="Máximo" className="developer-number">{integer(row.maxMs)} ms</td></tr>)}</tbody></table></div>
      : <p className="developer-empty">{view === 'failing' ? 'Nenhuma rota com erro na última hora.' : 'Nenhuma requisição na última hora.'}</p>}
  </>
}

function Traffic({ traffic }) {
  return <section className="developer-section" aria-labelledby="developer-traffic-title">
    <div className="developer-section-heading"><h2 id="developer-traffic-title">Requisições da última hora</h2><small>Rotas agrupadas (números e códigos viram :id). p95: 95% das respostas vieram nesse tempo ou menos.</small></div>
    <TrafficRoutes traffic={traffic} />
  </section>
}

function ServerFacts({ server, version, expanded = false }) {
  return <Facts title="Servidor" icon={Server} rows={[
    expanded && ['Versão do portal', version?.version], expanded && ['Tempo no ar', duration(server.uptimeSeconds)],
    ['Node.js', server.node], ['Sistema', server.platform], ['Máquina', server.hostname], ['Processo (PID)', server.pid], ['No ar desde', moment(server.startedAt)],
    ['Memória do processo', `${bytes(server.memory.rss)} (heap ${bytes(server.memory.heapUsed)} de ${bytes(server.memory.heapTotal)})`], ['Memória da máquina', `${bytes(server.systemMemory.free)} livres de ${bytes(server.systemMemory.total)}`, server.systemMemory.free / server.systemMemory.total < 0.1 ? 'bad' : ''],
    ['Processadores', `${server.cpus} · carga ${server.loadAverage.join(' / ')}`], ['Fuso do servidor', server.timeZone], expanded && ['Horário do servidor (Bahia)', server.serverTime],
  ]} />
}

function DatabaseFacts({ database }) {
  return <Facts title="Banco de dados" icon={Database} rows={database.connected ? [
    ['Conexão', 'Conectado', 'good'], ['Tempo de resposta', `${String(database.latencyMs).replace('.', ',')} ms`, database.latencyMs > 200 ? 'bad' : ''], ['MySQL', database.version], ['Conexões abertas', database.connectedThreads != null ? `${database.connectedThreads} de ${database.maxConnections}` : '—'],
    ['Conexões do portal (limite)', database.poolLimit], ['Fuso do banco', database.timeZone], ['Revisão dos dados', integer(database.storeRevision)], ['Última gravação', moment(database.storeUpdatedAt)],
  ] : [['Conexão', 'Sem conexão', 'bad'], ['Erro', database.error?.message]]} />
}

function SystemDetails({ data }) {
  const { server, database, storage, config, data: store } = data
  const missing = (storage.attachments || []).reduce((sum, area) => sum + area.missing, 0)
  return <section className="developer-section" aria-labelledby="developer-system-title">
    <div className="developer-section-heading"><h2 id="developer-system-title">Sistema</h2><small>Gerado às {clock(data.generatedAt)} (horário da Bahia). Valores de senhas e chaves nunca aparecem aqui.</small></div>
    <div className="developer-cards">
      <ServerFacts server={server} />
      <DatabaseFacts database={database} />
      <Facts title="Armazenamento" icon={HardDrive} rows={[
        ['Pasta de dados', <code key="path">{storage.dataDirectory}</code>], ['DATA_DIR configurado', yes(storage.dataDirConfigured), storage.dataDirConfigured ? 'good' : 'bad'],
        ['Disco', storage.disk ? `${bytes(storage.disk.freeBytes)} livres de ${bytes(storage.disk.totalBytes)}` : storage.diskError || '—', storage.disk && storage.disk.freeBytes / storage.disk.totalBytes < 0.1 ? 'bad' : ''],
        ['Backups diários', storage.backups?.count ? `${storage.backups.count} · último ${moment(storage.backups.lastAt)}` : 'Nenhum'],
        ['Anexos sem arquivo no disco', storage.attachmentsError || (missing ? `${missing} (veja a exportação)` : 'Nenhum'), missing ? 'bad' : 'good'],
      ]} />
      <Facts title="Configuração" icon={Settings2} rows={[
        ['Ambiente', config.environment], ['Endereço', `${config.host}:${config.port}`], ['Banco', <code key="db">{config.database}</code>], ['E-mail (SMTP)', config.smtp ? 'Configurado' : 'Não configurado', config.smtp ? 'good' : 'bad'],
        ['Captcha do site', config.turnstile ? 'Configurado' : 'Não configurado'], ['Login sem senha (testes)', config.testLogin ? 'Ativo' : 'Desativado', config.testLogin && config.environment === 'produção' ? 'bad' : ''],
        ['Limite de requisições', `${integer(config.apiRateLimit)} por janela`], ['Proxy confiável', config.trustProxy], ['Origens CORS', integer(config.corsOrigins)], ['Sites do orçamento', integer(config.quotesAllowedOrigins)],
        ['Catálogo fiscal semanal', config.fiscalCatalogSync ? 'Ativo' : 'Desativado'], ['E-mails dos tickets', config.supportTicketEmails ? 'Lista própria' : 'Lista padrão'], ['CPFs da oferta em aberto', config.openOfferDefaultCpfs ? 'Configurados' : 'Não configurados'], ['CPFs dos avisos do prazo da proposta', config.proposalDeadlineNoticeCpfs ? 'Configurados' : 'Não configurados'],
      ]} />
      <section className="developer-card developer-card--wide"><h3><Database size={16} aria-hidden="true" />Dados do portal</h3><p className="developer-card-note">Tamanho total: {bytes(store.bytes)} · tickets abertos: {integer(store.openTickets)}</p>
        <ul className="developer-collections">{store.collections.slice(0, 16).map((row) => <li key={row.name}><code>{row.name}</code><strong>{integer(row.items)}</strong></li>)}</ul></section>
    </div>
  </section>
}

function OnlineMetric({ online, people }) {
  return <>
    <Facts title="Presença" icon={Users} rows={[
      ['Pessoas online', online.online], ['Tablets do operador', online.tablets], ['Conexões ao vivo', online.connections],
      ['Em versão antiga', outdatedText(online.outdated) || 'Nenhum'],
    ]} />
    <p className="developer-metric-note">{online.rule}</p>
    {people.length ? <div className="developer-table-wrap"><table className="developer-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Abas</th><th>Dispositivo</th><th>Versão</th><th>IP</th></tr></thead>
      <tbody>{people.map((person) => <tr key={person.key}><td data-label="Nome"><strong>{person.name}</strong></td><td data-label="Tipo">{roleNames[person.role] || person.role}</td><td data-label="Abas">{person.tabs}</td>
        <td data-label="Dispositivo">{person.device || '—'}</td><td data-label="Versão"><span className="developer-version">{person.version || '—'}{person.outdated && <span className="developer-outdated">desatualizada</span>}</span></td><td data-label="IP">{person.ip || '—'}</td></tr>)}</tbody>
    </table></div> : <p className="developer-empty">Nenhum usuário ou tablet online.</p>}
  </>
}

function RequestMetric({ traffic, items }) {
  const [visible, setVisible] = useState(100)
  return <>
    <Facts title="Resumo da última hora" icon={Activity} rows={[
      ['Requisições', integer(traffic.total)], ['Tempo médio', `${integer(traffic.averageMs)} ms`], ['p95', `${integer(traffic.p95Ms)} ms`],
      ['Lentas', integer(traffic.slow)], ['Respostas 4xx', integer(traffic.clientErrors)], ['Respostas 5xx', integer(traffic.serverErrors)],
    ]} />
    <section className="developer-metric-section"><h3>Por rota</h3><TrafficRoutes traffic={traffic} /></section>
    {items && <section className="developer-metric-section"><h3>Requisições individuais</h3>
      {items.length !== traffic.total && <p className="developer-metric-note">Registros disponíveis na memória do servidor: {integer(items.length)} de {integer(traffic.total)}.</p>}
      {items.length ? <div className="developer-table-wrap"><table className="developer-table"><thead><tr><th>Horário</th><th>Método</th><th>Rota</th><th>Resposta</th><th>Duração</th></tr></thead>
        <tbody>{items.slice(0, visible).map((item, index) => <tr key={index}><td data-label="Horário">{moment(item.at)}</td><td data-label="Método">{item.method}</td><td data-label="Rota"><code>{item.route}</code></td><td data-label="Resposta" className={item.status >= 400 ? 'developer-tone--bad' : undefined}>{item.status}</td><td data-label="Duração">{integer(item.ms)} ms</td></tr>)}</tbody>
      </table></div> : <p className="developer-empty">Nenhum registro de requisição no período.</p>}
      {visible < items.length && <button className="admin-tool-button developer-more" type="button" onClick={() => setVisible((current) => current + 100)}>Mostrar mais requisições</button>}
    </section>}
  </>
}

async function copyMetricJson(text, button) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return } catch { /* Try copying inside the open dialog. */ }
  }
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.position = 'fixed'
  field.style.opacity = '0'
  button.closest('dialog').appendChild(field)
  try {
    field.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally { field.remove(); button.focus() }
}

function MetricDialog({ kind, snapshot, onClose }) {
  const level = { errors: 'error', warnings: 'warn' }[kind]
  const logWindow = snapshot.logWindow || { since: snapshot.generatedAt - DAY, until: snapshot.generatedAt }
  const total = level ? snapshot.logs.day[level] : kind === 'requests' ? snapshot.traffic.total : 0
  const people = kind === 'users' ? snapshot.online.people.filter((person) => person.online) : []
  const [result, setResult] = useState(null), [error, setError] = useState(''), [loadingMore, setLoadingMore] = useState(false), [copyState, setCopyState] = useState('')
  const openLogs = useOpenLogs()
  const items = result?.items || []
  const ready = !total || result !== null
  const logParams = new URLSearchParams({ level, limit: '100', since: String(logWindow.since), until: String(logWindow.until) })
  if (logWindow.through) logParams.set('through', logWindow.through)
  const route = level ? `/developer/logs?${logParams}` : `/developer/requests?until=${snapshot.generatedAt}`

  useEffect(() => {
    if (!total) return
    let active = true
    payableRequest(route).then((data) => { if (active) setResult(data) }).catch((caught) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [route, total])

  async function loadMore() {
    setLoadingMore(true); setError(''); setCopyState('')
    try {
      const next = await payableRequest(`${route}&before=${encodeURIComponent(items.at(-1).id)}`)
      const known = new Set(items.map((item) => item.id))
      const added = next.items.filter((item) => !known.has(item.id))
      setResult({ items: [...items, ...added], more: next.more && added.length > 0 })
    } catch (caught) { setError(caught.message) } finally { setLoadingMore(false) }
  }

  function json() {
    const { online, traffic, server, version, database, logs } = snapshot
    const period = (since, until) => ({ de: new Date(since).toISOString(), ate: new Date(until).toISOString() })
    const values = {
      users: () => ({ pessoasOnline: online.online, tablets: online.tablets, conexoes: online.connections, versoesAntigas: online.outdated, registros: people.map(({ key, ...person }) => person) }),
      requests: () => ({ periodo: period(snapshot.generatedAt - HOUR, snapshot.generatedAt), resumo: traffic, registros: items }),
      server: () => ({ versao: version, servidor: server }),
      database: () => ({ banco: database, logs: { guardados: logs.day.saved ?? null, primeiroRegistroEm: logs.day.oldest ?? null } }),
    }
    const data = level ? { periodo: period(logWindow.since, logWindow.until), total, registros: items } : values[kind]()
    return JSON.stringify({ indicador: metricTitles[kind], atualizadoEm: new Date(snapshot.generatedAt).toISOString(), ...data }, null, 2)
  }
  async function copy(event) {
    const button = event.currentTarget
    setCopyState('copying')
    try { await copyMetricJson(json(), button); setCopyState('copied') } catch { setCopyState('error') }
  }

  return <PayableModal title={metricTitles[kind]} className="developer-metric-modal" wide={Boolean(level) || kind === 'users' || kind === 'requests'} onClose={onClose} footer={<>
    <button className="admin-tool-button" type="button" onClick={onClose}>Fechar</button>
    <button className="admin-tool-button" type="button" disabled={!ready || loadingMore} onClick={() => downloadBlob(new Blob([json()], { type: 'application/json' }), `gmac-${kind}.json`)}><Download size={15} aria-hidden="true" />Baixar JSON</button>
    <button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!ready || loadingMore || copyState === 'copying'} onClick={copy}><Copy size={15} aria-hidden="true" />Copiar JSON</button>
    {copyState === 'copied' && <p className="developer-copy-feedback" role="status">JSON copiado para a área de transferência.</p>}
    {copyState === 'error' && <p className="developer-copy-feedback" role="alert">Não foi possível copiar. Use Baixar JSON.</p>}
  </>}>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {level && <>
      <p className="developer-metric-note">{moment(logWindow.since)} a {moment(logWindow.until)} (Bahia) · {integer(total)} {total === 1 ? 'registro' : 'registros'}</p>
      {ready && !items.length && <p className="developer-empty">Nenhum registro disponível no período.</p>}
      {items.length > 0 && <LogEntries items={items} {...openLogs} />}
      {ready && items.length < total && <p className="developer-metric-note">{integer(items.length)} de {integer(total)} registros carregados. O JSON inclui os registros carregados.</p>}
      {result?.more && items.length < total && <button className="admin-tool-button developer-more" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>}
    </>}
    {kind === 'requests' && <RequestMetric traffic={snapshot.traffic} items={ready ? items : null} />}
    {!ready && !error && <p className="developer-empty" role="status">Carregando registros...</p>}
    {kind === 'users' && <OnlineMetric online={snapshot.online} people={people} />}
    {kind === 'server' && <ServerFacts server={snapshot.server} version={snapshot.version} expanded />}
    {kind === 'database' && <><DatabaseFacts database={snapshot.database} /><Facts title="Logs armazenados" icon={Database} rows={[
      ['Registros guardados', snapshot.logs.day.saved == null ? 'Indisponível' : integer(snapshot.logs.day.saved)], ['Registro mais antigo', moment(snapshot.logs.day.oldest)],
    ]} /></>}
  </PayableModal>
}

export default function DeveloperScreen(props) {
  const [editingReleaseNotes, setEditingReleaseNotes] = useState(false)
  const [metric, setMetric] = useState(null)
  const [data, setData] = useState(null), [error, setError] = useState(''), [refreshKey, setRefreshKey] = useState(0), [busy, setBusy] = useState(false)
  const [exportDays, setExportDays] = useState(7), [exporting, setExporting] = useState(false)
  const [diagnosticCode, setDiagnosticCode] = useState(''), [diagnosing, setDiagnosing] = useState(false)
  const latest = useRef(0)
  const load = useCallback(async () => {
    const id = ++latest.current
    try { const result = await payableRequest('/developer/overview'); if (id === latest.current) { setData(result); setError('') } } catch (caught) { if (id === latest.current) setError(caught.message) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => pollWhileVisible(() => { load(); setRefreshKey((value) => value + 1) }, 15000), [load])
  async function refresh() {
    setBusy(true)
    setRefreshKey((value) => value + 1)
    try { await load() } finally { setBusy(false) }
  }
  async function exportLogs() {
    setExporting(true); setError('')
    try { await downloadFile(`/api/developer/export?days=${exportDays}`, 'logs-portal-gmac.json') } catch (caught) { setError(caught.message) } finally { setExporting(false) }
  }
  // Diagnóstico de uma OS: its data, the state of the operation, every event and the logs that mention it.
  async function exportDiagnostic(event) {
    event.preventDefault()
    const code = diagnosticCode.trim().toUpperCase()
    if (!/^OS-\d{4}-[0-9A-Z]{3,}$/.test(code)) return setError('Informe o código da OS, por exemplo OS-2026-0001.')
    setDiagnosing(true); setError('')
    try { await downloadFile(`/api/developer/diagnostics/${encodeURIComponent(code)}`, `diagnostico-${code}.json`) } catch (caught) { setError(caught.message) } finally { setDiagnosing(false) }
  }
  const day = data?.logs.day, hour = data?.logs.hour, traffic = data?.traffic
  const openMetric = (kind) => setMetric({ kind, snapshot: data })
  return <AdminWorkspace title="Desenvolvedor" {...props}>
    <div className="developer-toolbar">
      <p>Logs e informações do sistema para encontrar e resolver problemas. Só os desenvolvedores veem esta tela.</p>
      <div className="developer-actions">
        {data && <small className="developer-updated"><Clock3 size={13} aria-hidden="true" />Atualizado às {clock(data.generatedAt)}</small>}
        <button className="admin-tool-button" type="button" onClick={refresh} disabled={busy}><RefreshCw size={15} aria-hidden="true" />Atualizar</button>
        <button className="admin-tool-button" type="button" onClick={() => setEditingReleaseNotes(true)}><PencilLine size={15} aria-hidden="true" />Editar notas de atualização</button>
        <span className="developer-export"><label>Período da exportação<select value={exportDays} onChange={(event) => setExportDays(Number(event.target.value))}>{exportPeriods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={exportLogs} disabled={exporting}><Download size={15} aria-hidden="true" />{exporting ? 'Exportando...' : 'Exportar logs'}</button></span>
        <form className="developer-export developer-diagnostic" onSubmit={exportDiagnostic}><label>Diagnóstico de uma OS<input value={diagnosticCode} onChange={(event) => setDiagnosticCode(event.target.value)} placeholder="OS-2026-0001" maxLength={20} autoComplete="off" spellCheck={false} /></label>
          <button className="admin-tool-button" type="submit" disabled={diagnosing}><Download size={15} aria-hidden="true" />{diagnosing ? 'Exportando...' : 'Exportar diagnóstico'}</button></form>
      </div>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!data ? !error && <p className="developer-empty" role="status">Carregando informações do sistema...</p> : <>
      <div className="developer-metrics">
        <Metric icon={Users} tone="blue" kind="users" onOpen={openMetric} value={integer(data.online.online)} detail={`${integer(data.online.tablets)} ${data.online.tablets === 1 ? 'tablet' : 'tablets'} do operador · ${integer(data.online.connections)} ${data.online.connections === 1 ? 'conexão' : 'conexões'}`} />
        <Metric icon={XCircle} tone={day.error ? 'red' : 'green'} kind="errors" onOpen={openMetric} value={integer(day.error)} detail={`${integer(hour.error)} na última hora`} />
        <Metric icon={AlertTriangle} tone={day.warn ? 'amber' : 'green'} kind="warnings" onOpen={openMetric} value={integer(day.warn)} detail={`${integer(hour.warn)} na última hora`} />
        <Metric icon={Activity} kind="requests" onOpen={openMetric} value={integer(traffic.total)} detail={`média ${integer(traffic.averageMs)} ms · p95 ${integer(traffic.p95Ms)} ms${traffic.slow ? ` · ${integer(traffic.slow)} lentas` : ''}`} />
        <Metric icon={Server} kind="server" onOpen={openMetric} value={duration(data.server.uptimeSeconds)} detail={`Versão ${data.version?.version || '—'} · Node ${data.server.node}`} />
        <Metric icon={Database} tone={data.database.connected ? '' : 'red'} kind="database" onOpen={openMetric} value={data.database.connected ? `${String(data.database.latencyMs).replace('.', ',')} ms` : 'Sem conexão'} detail={day.saved != null ? `${integer(day.saved)} logs guardados${day.oldest ? ` desde ${moment(day.oldest).slice(0, 5)}` : ''}` : ''} />
      </div>
      <DeveloperUsers online={data.online} users={data.users} />
    </>}
    <UpdateSchedule refreshKey={refreshKey} />
    <Logs refreshKey={refreshKey} />
    {data && <><Traffic traffic={traffic} /><SystemDetails data={data} /></>}
    {metric && <MetricDialog {...metric} onClose={() => setMetric(null)} />}
    {editingReleaseNotes && <ReleaseNotesEditor onClose={() => setEditingReleaseNotes(false)} />}
  </AdminWorkspace>
}

