import { useEffect, useRef, useState } from 'react'
import { FileUp, Download, LoaderCircle, TriangleAlert, Info } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { payableRequest, dateLabel, downloadBlob } from './payablesApi.js'
import { useAccountAppearance } from './accountTheme.js'
import { pollWhileVisible } from './polling.js'
import './payables.css'

const statusLabel = { running: 'Em andamento', done: 'Concluída', failed: 'Falhou' }
const periodLabel = (period) => period?.inicio ? `${dateLabel(period.inicio)} a ${dateLabel(period.fim)}` : 'período não informado'
const elapsed = (from, now) => { const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
const dateTime = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })

async function uploadForAnalysis(file) {
  const response = await fetch(`/api/ai-reconciliations?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/octet-stream' }, body: file })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Não foi possível enviar o extrato.')
  return result.item
}

function Usage({ item }) {
  if (!item.usage) return null
  const tokens = (item.usage.inputTokens + item.usage.outputTokens).toLocaleString('pt-BR')
  return <> · {tokens} tokens{item.estimatedCostUsd != null && ` (≈ ${item.estimatedCostUsd.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })})`}</>
}

export default function AiReconciliationScreen(props) {
  const theme = useAccountAppearance()?.theme === 'dark' ? 'dark' : 'light'
  const [data, setData] = useState(null), [error, setError] = useState(''), [uploading, setUploading] = useState(false), [selectedId, setSelectedId] = useState('')
  const [report, setReport] = useState(null), [reportError, setReportError] = useState(''), [height, setHeight] = useState(900), [now, setNow] = useState(() => Date.now())
  const input = useRef(null), frame = useRef(null)
  async function refresh() { const next = await payableRequest('/ai-reconciliations'); setData(next); setError(''); return next }
  useEffect(() => { refresh().catch((caught) => setError(caught.message)) }, [])
  const items = data?.items || []
  const selected = items.find((row) => row.id === selectedId) || items[0]
  const running = items.some((row) => row.status === 'running')
  // The analysis runs on the server; polling lets the user leave the screen and come back.
  useEffect(() => {
    if (!running) return undefined
    const stopPolling = pollWhileVisible(() => refresh().catch((caught) => setError(caught.message)), 3000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { stopPolling(); clearInterval(clock) }
  }, [running])
  useEffect(() => {
    if (selected?.status !== 'done') return undefined
    let active = true
    setReportError('')
    payableRequest(`/ai-reconciliations/${selected.id}/report?theme=${theme}`).then((result) => { if (active) setReport({ id: selected.id, html: result.html }) }).catch((caught) => { if (active) setReportError(caught.message) })
    return () => { active = false }
  }, [selected?.id, selected?.status, theme])
  useEffect(() => {
    function resize(event) { if (event.source === frame.current?.contentWindow && event.data?.type === 'gmac-ai-report-height') setHeight(Math.min(Math.max(Number(event.data.height) || 0, 480), 40000)) }
    window.addEventListener('message', resize)
    return () => window.removeEventListener('message', resize)
  }, [])
  async function analyze(file) {
    if (!file) return
    setUploading(true); setError('')
    try { const item = await uploadForAnalysis(file); setSelectedId(item.id); await refresh() } catch (caught) { setError(caught.message) } finally { setUploading(false) }
  }
  const shown = report?.id === selected?.id ? report : null
  return <AdminWorkspace {...props} title="Conciliação bancária com IA">
    <div className="payable-heading-actions"><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={uploading || running} title={running ? 'Aguarde a análise em andamento terminar' : undefined} onClick={() => input.current.click()}><FileUp size={17} />{uploading ? 'Enviando...' : 'Analisar extrato OFX'}</button><input ref={input} type="file" accept=".ofx,.OFX" hidden aria-label="Arquivo OFX" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; analyze(file) }} /></div>
    <p className="ai-intro payable-muted">O extrato OFX e as contas a pagar e a receber do sistema são enviados ao Claude{data?.model ? ` (${data.model})` : ''}, da Anthropic, que devolve uma análise da conciliação com gráficos. Nada é alterado no sistema: os vínculos continuam sendo feitos em Conciliação bancária.</p>
    {data && !data.credentialsConfigured && <p className="bank-warning bank-warning--warning"><TriangleAlert size={16} aria-hidden="true" /><span><strong>Nenhuma chave da API da Anthropic configurada.</strong><small>Defina ANTHROPIC_API_KEY no arquivo .env do servidor e reinicie o sistema. A chave é criada em platform.claude.com.</small></span></p>}
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {!data ? !error && <p>Carregando...</p> : !items.length ? <p className="payable-muted">Nenhuma análise feita ainda. Envie um extrato OFX para começar.</p> : <>
      <div className="ai-toolbar">
        <label className="bank-filter">Análise<select aria-label="Análise" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{items.map((row) => <option key={row.id} value={row.id}>{row.id} · {row.fileName} · {periodLabel(row.period)} · {statusLabel[row.status]}</option>)}</select></label>
        {selected.status === 'done' && shown && <button type="button" className="admin-tool-button" onClick={() => downloadBlob(new Blob([shown.html], { type: 'text/html' }), `conciliacao-ia-${selected.id}.html`)}><Download size={15} />Baixar relatório</button>}
      </div>
      <p className="ai-meta">Enviada em {dateTime(selected.createdAt)} por {selected.userName} · {selected.transactionCount} movimentações · conta {selected.accountId}{selected.status === 'done' && <> · {selected.model}<Usage item={selected} /></>}</p>
      {selected.status === 'running' && <div className="ai-progress" role="status"><LoaderCircle className="ai-spin" size={22} aria-hidden="true" /><div><strong>{selected.progress?.outputChars ? `O Claude está escrevendo o relatório (${Math.round(selected.progress.outputChars / 1024)} KB)` : 'O Claude está cruzando o extrato com os lançamentos do sistema'}</strong><p>Tempo decorrido: {elapsed(selected.progress?.startedAt || selected.createdAt, now)}. A análise costuma levar alguns minutos e continua no servidor mesmo se você sair desta tela.</p></div></div>}
      {selected.status === 'failed' && <p className="bank-warning bank-warning--warning" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span><strong>A análise não foi concluída.</strong><small>{selected.error}</small></span></p>}
      {selected.status === 'done' && (reportError ? <p className="admin-tool-error" role="alert">{reportError}</p> : !shown ? <p className="bank-warning"><Info size={16} aria-hidden="true" /><span><strong>Carregando o relatório...</strong></span></p> : <iframe ref={frame} key={selected.id} className="ai-report-frame" title={`Relatório da análise ${selected.id}`} sandbox="allow-scripts" srcDoc={shown.html} style={{ height }} />)}
    </>}
  </AdminWorkspace>
}
