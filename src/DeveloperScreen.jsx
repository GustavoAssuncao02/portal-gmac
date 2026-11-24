import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Clock3, Database, Download, HardDrive, RefreshCw, Search, Server, Settings2, Users, XCircle } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { downloadFile, payableRequest } from './payablesApi.js'
import { pollWhileVisible } from './polling.js'
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

function Metric({ icon: Icon, tone = '', label, value, detail }) {
  return <article className={`developer-metric${tone ? ` developer-metric--${tone}` : ''}`}><span className="developer-metric-icon" aria-hidden="true"><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div></article>
}
function Facts({ title, icon: Icon, rows }) {
  return <section className="developer-card"><h3><Icon size={16} aria-hidden="true" />{title}</h3><dl>{rows.filter(Boolean).map(([label, value, tone]) => <div key={label}><dt>{label}</dt><dd className={tone ? `developer-tone--${tone}` : undefined}>{value ?? '—'}</dd></div>)}</dl></section>
}

function OnlineUsers({ online }) {
  const people = online?.people || []
  return <section className="developer-section" aria-labelledby="developer-online-title">
    <div className="developer-section-heading"><h2 id="developer-online-title">Usuários online</h2><small>{online?.rule}</small></div>
    {people.length ? <div className="developer-table-wrap"><table className="developer-table developer-online-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Situação</th><th>Desde</th><th>Dispositivo</th><th>IP</th></tr></thead>
      <tbody>{people.map((person) => <tr key={person.key} className={person.online ? '' : 'developer-row--idle'}>
        <td data-label="Nome"><strong>{person.name}</strong></td><td data-label="Tipo">{roleNames[person.role] || person.role}</td>
        <td data-label="Situação"><span className={`developer-presence${person.online ? ' developer-presence--on' : ''}`}><i aria-hidden="true" />{person.tabs ? `Portal aberto (${person.tabs} ${person.tabs === 1 ? 'aba' : 'abas'})` : person.online ? `Ativo ${ago(person.lastAt)}` : `Visto ${ago(person.lastAt)}`}</span></td>
        <td data-label="Desde">{moment(person.since)}</td><td data-label="Dispositivo">{person.device || '—'}</td><td data-label="IP">{person.ip || '—'}</td>
      </tr>)}</tbody></table></div> : <p className="developer-empty">Ninguém com o portal aberto agora.</p>}
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

function Logs({ refreshKey }) {
  const [level, setLevel] = useState(''), [source, setSource] = useState(''), [period, setPeriod] = useState(DAY), [typed, setTyped] = useState(''), [search, setSearch] = useState('')
  const [items, setItems] = useState(null), [more, setMore] = useState(false), [open, setOpen] = useState(() => new Set()), [error, setError] = useState(''), [loadingMore, setLoadingMore] = useState(false)
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
  const toggle = (id) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return <section className="developer-section" aria-labelledby="developer-logs-title">
    <div className="developer-section-heading"><h2 id="developer-logs-title">Logs do sistema</h2><small>Erros, avisos e alterações ficam guardados por 30 dias. Clique em um registro para ver os detalhes.</small></div>
    <div className="developer-filters">
      <div className="developer-levels" role="group" aria-label="Nível">{levels.map(([value, label]) => <button key={value || 'all'} type="button" aria-pressed={level === value} className={`developer-chip${value ? ` developer-chip--${value}` : ''}`} onClick={() => setLevel(value)}>{label}</button>)}</div>
      <label>Origem<select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select></label>
      <label>Período<select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="developer-search">Buscar<span><Search size={15} aria-hidden="true" /><input type="search" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Mensagem, usuário, rota..." /></span></label>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!items ? <p className="developer-empty" role="status">Carregando logs...</p> : !items.length ? <p className="developer-empty">Nenhum registro com esses filtros.</p> : <ol className="developer-log-list">
      {items.map((entry) => { const expanded = open.has(entry.id); return <li key={entry.id} className={`developer-log developer-log--${entry.level}`}>
        <button type="button" aria-expanded={expanded} onClick={() => toggle(entry.id)}>
          {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          <time>{moment(entry.at)}</time><span className={`developer-level developer-level--${entry.level}`}>{levelNames[entry.level] || entry.level}</span><span className="developer-source">{sourceNames[entry.source] || entry.source}</span>
          <span className="developer-message">{entry.message}</span><span className="developer-user">{entry.user || ''}</span>
        </button>
        {expanded && <LogDetails entry={entry} />}
      </li> })}
    </ol>}
    {items && more && <button className="admin-tool-button developer-more" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</button>}
  </section>
}

const trafficViews = [['slowest', 'Mais lentas'], ['failing', 'Com erros'], ['busiest', 'Mais usadas']]
function Traffic({ traffic }) {
  const [view, setView] = useState('slowest')
  const rows = traffic?.[view] || []
  return <section className="developer-section" aria-labelledby="developer-traffic-title">
    <div className="developer-section-heading"><h2 id="developer-traffic-title">Requisições da última hora</h2><small>Rotas agrupadas (números e códigos viram :id). p95: 95% das respostas vieram nesse tempo ou menos.</small></div>
    <div className="developer-levels" role="group" aria-label="Ordenar rotas">{trafficViews.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} className="developer-chip" onClick={() => setView(value)}>{label}</button>)}</div>
    {rows.length ? <div className="developer-table-wrap"><table className="developer-table"><thead><tr><th>Rota</th><th className="developer-number">Requisições</th><th className="developer-number">Erros 4xx</th><th className="developer-number">Erros 5xx</th><th className="developer-number">Média</th><th className="developer-number">p95</th><th className="developer-number">Máximo</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.route}><td data-label="Rota"><code>{row.route}</code></td><td data-label="Requisições" className="developer-number">{integer(row.count)}</td><td data-label="Erros 4xx" className="developer-number">{integer(row.clientErrors)}</td><td data-label="Erros 5xx" className={`developer-number${row.serverErrors ? ' developer-tone--bad' : ''}`}>{integer(row.serverErrors)}</td><td data-label="Média" className="developer-number">{integer(row.averageMs)} ms</td><td data-label="p95" className="developer-number">{integer(row.p95Ms)} ms</td><td data-label="Máximo" className="developer-number">{integer(row.maxMs)} ms</td></tr>)}</tbody></table></div>
      : <p className="developer-empty">{view === 'failing' ? 'Nenhuma rota com erro na última hora.' : 'Nenhuma requisição na última hora.'}</p>}
  </section>
}

function SystemDetails({ data }) {
  const { server, database, storage, config, data: store } = data
  const missing = (storage.attachments || []).reduce((sum, area) => sum + area.missing, 0)
  return <section className="developer-section" aria-labelledby="developer-system-title">
    <div className="developer-section-heading"><h2 id="developer-system-title">Sistema</h2><small>Gerado às {clock(data.generatedAt)} (horário da Bahia). Valores de senhas e chaves nunca aparecem aqui.</small></div>
    <div className="developer-cards">
      <Facts title="Servidor" icon={Server} rows={[
        ['Node.js', server.node], ['Sistema', server.platform], ['Máquina', server.hostname], ['Processo (PID)', server.pid], ['No ar desde', moment(server.startedAt)],
        ['Memória do processo', `${bytes(server.memory.rss)} (heap ${bytes(server.memory.heapUsed)} de ${bytes(server.memory.heapTotal)})`], ['Memória da máquina', `${bytes(server.systemMemory.free)} livres de ${bytes(server.systemMemory.total)}`, server.systemMemory.free / server.systemMemory.total < 0.1 ? 'bad' : ''],
        ['Processadores', `${server.cpus} · carga ${server.loadAverage.join(' / ')}`], ['Fuso do servidor', server.timeZone],
      ]} />
      <Facts title="Banco de dados" icon={Database} rows={database.connected ? [
        ['Conexão', 'Conectado', 'good'], ['Tempo de resposta', `${String(database.latencyMs).replace('.', ',')} ms`, database.latencyMs > 200 ? 'bad' : ''], ['MySQL', database.version], ['Conexões abertas', database.connectedThreads != null ? `${database.connectedThreads} de ${database.maxConnections}` : '—'],
        ['Conexões do portal (limite)', database.poolLimit], ['Fuso do banco', database.timeZone], ['Revisão dos dados', integer(database.storeRevision)], ['Última gravação', moment(database.storeUpdatedAt)],
      ] : [['Conexão', 'Sem conexão', 'bad'], ['Erro', database.error?.message]]} />
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
        ['Catálogo fiscal semanal', config.fiscalCatalogSync ? 'Ativo' : 'Desativado'], ['E-mails dos tickets', config.supportTicketEmails ? 'Lista própria' : 'Lista padrão'], ['CPFs da oferta em aberto', config.openOfferDefaultCpfs ? 'Configurados' : 'Não configurados'],
      ]} />
      <section className="developer-card developer-card--wide"><h3><Database size={16} aria-hidden="true" />Dados do portal</h3><p className="developer-card-note">Tamanho total: {bytes(store.bytes)} · tickets abertos: {integer(store.openTickets)}</p>
        <ul className="developer-collections">{store.collections.slice(0, 16).map((row) => <li key={row.name}><code>{row.name}</code><strong>{integer(row.items)}</strong></li>)}</ul></section>
    </div>
  </section>
}

export default function DeveloperScreen(props) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [refreshKey, setRefreshKey] = useState(0), [busy, setBusy] = useState(false)
  const [exportDays, setExportDays] = useState(7), [exporting, setExporting] = useState(false)
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
  const day = data?.logs.day, hour = data?.logs.hour, traffic = data?.traffic
  return <AdminWorkspace title="Desenvolvedor" {...props}>
    <div className="developer-toolbar">
      <p>Logs e informações do sistema para encontrar e resolver problemas. Só os desenvolvedores veem esta tela.</p>
      <div className="developer-actions">
        {data && <small className="developer-updated"><Clock3 size={13} aria-hidden="true" />Atualizado às {clock(data.generatedAt)}</small>}
        <button className="admin-tool-button" type="button" onClick={refresh} disabled={busy}><RefreshCw size={15} aria-hidden="true" />Atualizar</button>
        <span className="developer-export"><label>Período da exportação<select value={exportDays} onChange={(event) => setExportDays(Number(event.target.value))}>{exportPeriods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={exportLogs} disabled={exporting}><Download size={15} aria-hidden="true" />{exporting ? 'Exportando...' : 'Exportar logs'}</button></span>
      </div>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!data ? !error && <p className="developer-empty" role="status">Carregando informações do sistema...</p> : <>
      <div className="developer-metrics">
        <Metric icon={Users} tone="blue" label="Usuários online" value={integer(data.online.online)} detail={`${integer(data.online.tablets)} ${data.online.tablets === 1 ? 'tablet' : 'tablets'} do operador · ${integer(data.online.connections)} ${data.online.connections === 1 ? 'conexão' : 'conexões'}`} />
        <Metric icon={XCircle} tone={day.error ? 'red' : 'green'} label="Erros (24 h)" value={integer(day.error)} detail={`${integer(hour.error)} na última hora`} />
        <Metric icon={AlertTriangle} tone={day.warn ? 'amber' : 'green'} label="Avisos (24 h)" value={integer(day.warn)} detail={`${integer(hour.warn)} na última hora`} />
        <Metric icon={Activity} label="Requisições (60 min)" value={integer(traffic.total)} detail={`média ${integer(traffic.averageMs)} ms · p95 ${integer(traffic.p95Ms)} ms${traffic.slow ? ` · ${integer(traffic.slow)} lentas` : ''}`} />
        <Metric icon={Server} label="Servidor no ar" value={duration(data.server.uptimeSeconds)} detail={`Versão ${data.version?.version || '—'} · Node ${data.server.node}`} />
        <Metric icon={Database} tone={data.database.connected ? '' : 'red'} label="Banco de dados" value={data.database.connected ? `${String(data.database.latencyMs).replace('.', ',')} ms` : 'Sem conexão'} detail={day.saved != null ? `${integer(day.saved)} logs guardados${day.oldest ? ` desde ${moment(day.oldest).slice(0, 5)}` : ''}` : ''} />
      </div>
      <OnlineUsers online={data.online} />
    </>}
    <Logs refreshKey={refreshKey} />
    {data && <><Traffic traffic={traffic} /><SystemDetails data={data} /></>}
  </AdminWorkspace>
}

