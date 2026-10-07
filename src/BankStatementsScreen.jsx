import { useEffect, useRef, useState } from 'react'
import { FileUp, Search, TriangleAlert, CircleCheck, Info, Link2, Unlink, ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { money, dateLabel, payableRequest } from './payablesApi.js'
import './payables.css'

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const documentLabel = (digits) => !digits ? '' : digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
const accountLabel = (account) => `Banco ${account.bankId} · Conta ${account.accountId}${account.accountType ? ` · ${account.accountType === 'CHECKING' ? 'Conta corrente' : account.accountType}` : ''}`
const PAGE_SIZE = 50
const signed = (cents) => `${cents < 0 ? '−' : '+'} ${money(Math.abs(cents))}`

async function uploadStatement(file) {
  const response = await fetch(`/api/bank-statements/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/octet-stream' }, body: file })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Não foi possível importar o extrato.')
  return result.item
}

function Warnings({ rows }) {
  if (!rows?.length) return null
  return <ul className="bank-warnings">{rows.map((row, index) => <li key={`${row.code}-${index}`} className={`bank-warning bank-warning--${row.level === 'warning' ? 'warning' : 'info'}`}>{row.level === 'warning' ? <TriangleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<span><strong>{row.message}</strong>{row.detail && <small>{row.detail}</small>}</span></li>)}</ul>
}

function ImportResult({ item, onClose }) {
  const c = item.counts
  return <section className="bank-import-result" aria-live="polite"><header><h2>Lote {item.id} · {item.fileName}</h2><button type="button" className="admin-tool-button" onClick={onClose}>Fechar</button></header>
    <p>{c.records} registros lidos: <strong>{c.transactions} movimentações</strong> ({c.credits} créditos e {c.debits} débitos) e <strong>{c.balances} posições de saldo</strong>.</p>
    <p><strong>{c.new}</strong> movimentações novas · <strong>{c.existing}</strong> já existentes{c.conflicts ? <> · <strong>{c.conflicts}</strong> em conflito</> : ''}{c.duplicatesInFile ? ` · ${c.duplicatesInFile} repetidas no arquivo` : ''}{item.sameFileImportIds.length ? ` · arquivo idêntico já importado no lote ${item.sameFileImportIds.join(', ')}` : ''}.</p>
    <Warnings rows={item.warnings} />
  </section>
}

function ReconcileModal({ transaction, onClose, onDone }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { payableRequest(`/bank-statements/transactions/${transaction.id}/candidates`).then(setData).catch((caught) => setError(caught.message)) }, [transaction.id])
  async function link(candidate) { setBusy(true); setError(''); try { await payableRequest(`/bank-statements/transactions/${transaction.id}/reconcile`, 'POST', { kind: candidate.kind, recordId: candidate.id }); await onDone() } catch (caught) { setError(caught.message) } finally { setBusy(false) } }
  const target = transaction.direction === 'out' ? 'contas a pagar' : 'contas a receber'
  return <PayableModal title="Conciliar movimentação" wide busy={busy} onClose={onClose}>
    <section><dl className="payable-facts">{[['Data bancária', dateLabel(transaction.bankDate)], ['Valor', signed(transaction.amountCents)], ['Histórico original', transaction.memo], ['Contraparte identificada', [transaction.counterpartyName, documentLabel(transaction.counterpartyDocument)].filter(Boolean).join(' · ') || 'Não identificada no histórico'], ['FITID', transaction.fitId], ['CHECKNUM', transaction.checkNum || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section><h3>Candidatos em {target}</h3>
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
      {!data ? !error && <p>Buscando candidatos...</p> : <>
        <p className="payable-muted">Somente registros com valor exato e ainda não conciliados. Tolerância de data configurada: {data.toleranceDays} dia{data.toleranceDays === 1 ? '' : 's'}.</p>
        {data.ambiguous && <p className="bank-warning bank-warning--warning"><TriangleAlert size={16} aria-hidden="true" /><span><strong>Mais de um candidato com a mesma força de evidência.</strong><small>Confira os dados antes de escolher; o sistema não escolhe automaticamente.</small></span></p>}
        {!data.candidates.length && <p>Nenhum registro em {target} com valor exato de {money(Math.abs(transaction.amountCents))} e evidência suficiente.</p>}
        <ul className="bank-candidates">{data.candidates.map((row) => <li key={row.id}><div><strong>{row.id} · {row.name}</strong><span>{money(row.valueCents)} · {row.dateKind} em {dateLabel(row.date)}{row.description ? ` · ${row.description}` : ''}</span><ul>{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div><span className={`bank-strength bank-strength--${row.level}`}>{row.strength}</span><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => link(row)}><Link2 size={15} />Conciliar</button></li>)}</ul>
      </>}
    </section>
  </PayableModal>
}

export default function BankStatementsScreen(props) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [importing, setImporting] = useState(false), [result, setResult] = useState(null)
  const [accountId, setAccountId] = useState(''), [filters, setFilters] = useState({ search: '', direction: '', status: '' }), [reconciling, setReconciling] = useState(null), [tolerance, setTolerance] = useState(''), [busyId, setBusyId] = useState(''), [page, setPage] = useState(1)
  const input = useRef(null)
  async function refresh() { const next = await payableRequest('/bank-statements'); setData(next); setTolerance(String(next.settings.dateToleranceDays)); setError(''); return next }
  useEffect(() => { refresh().catch((caught) => setError(caught.message)) }, [])
  const account = data?.accounts.find((row) => row.id === accountId) || data?.accounts[0]
  const latest = data?.imports.find((row) => row.bankAccountId === account?.id)
  async function importFile(file) {
    if (!file) return
    setImporting(true); setError('')
    try { const item = await uploadStatement(file); setResult(item); setAccountId(item.bankAccountId); await refresh() } catch (caught) { setError(caught.message) } finally { setImporting(false) }
  }
  async function unlink(row) { setBusyId(row.id); setError(''); try { await payableRequest(`/bank-statements/transactions/${row.id}/reconcile`, 'DELETE'); await refresh() } catch (caught) { setError(caught.message) } finally { setBusyId('') } }
  async function saveTolerance(event) { event.preventDefault(); setError(''); try { await payableRequest('/bank-statements/settings', 'PUT', { dateToleranceDays: Number(tolerance) }); await refresh() } catch (caught) { setError(caught.message) } }
  const search = normalize(filters.search)
  const transactions = (data?.transactions || []).filter((row) => row.bankAccountId === account?.id && (!filters.direction || row.direction === filters.direction) && (!filters.status || (filters.status === 'reconciled') === Boolean(row.reconciliation)) && (!search || normalize([row.memo, row.counterpartyName, row.counterpartyDocument, row.fitId, row.operationLabel].join(' ')).includes(search))).sort((a, b) => a.bankDate.localeCompare(b.bankDate) || a.position - b.position)
  const pages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE)), currentPage = Math.min(page, pages), visible = transactions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const changeFilter = (key, value) => { setFilters({ ...filters, [key]: value }); setPage(1) }
  const balances = (data?.balances || []).filter((row) => row.bankAccountId === account?.id).sort((a, b) => a.bankDate.localeCompare(b.bankDate) || a.position - b.position)
  const conflicts = (data?.conflicts || []).filter((row) => row.bankAccountId === account?.id && row.status === 'open')
  const v = latest?.validation
  return <AdminWorkspace {...props} title="Conciliação bancária">
    <div className="payable-heading-actions"><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={importing} onClick={() => input.current.click()}><FileUp size={17} />{importing ? 'Importando...' : 'Importar extrato OFX'}</button><input ref={input} type="file" accept=".ofx,.OFX" hidden aria-label="Arquivo OFX" onChange={(event) => { const [file] = event.target.files; event.target.value = ''; importFile(file) }} /></div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
    {result && <ImportResult item={result} onClose={() => setResult(null)} />}
    {!data ? !error && <p>Carregando...</p> : !data.accounts.length ? <p className="payable-muted">Nenhum extrato importado. Importe um arquivo OFX para organizar as movimentações e preparar a conciliação.</p> : <>
      <div className="bank-account-bar">{data.accounts.length > 1 ? <label>Conta bancária<select aria-label="Conta bancária" value={account.id} onChange={(event) => { setAccountId(event.target.value); setPage(1) }}>{data.accounts.map((row) => <option key={row.id} value={row.id}>{accountLabel(row)}</option>)}</select></label> : <strong>{accountLabel(account)}</strong>}{latest && <span>Último lote {latest.id} · {latest.fileName} · período {dateLabel(latest.period.start?.date)} a {dateLabel(latest.period.end?.date)}{account.currency ? ` · ${account.currency}` : ''}</span>}<form className="bank-tolerance" onSubmit={saveTolerance}><label>Tolerância de data (dias)<input type="number" min={0} max={30} required value={tolerance} onChange={(event) => setTolerance(event.target.value)} /></label><button className="admin-tool-button" type="submit" disabled={tolerance === String(data.settings.dateToleranceDays)}>Salvar</button></form></div>
      {latest && <>{result?.id !== latest.id && <Warnings rows={latest.warnings.filter((row) => row.level === 'warning' || row.code.startsWith('encoding'))} />}
        <section className="bank-summary" aria-label="Validação do último extrato">{[['Saldo anterior', v.openingCents, v.openingDate ? `em ${dateLabel(v.openingDate)}` : 'não informado'], ['Créditos', v.creditsCents, `${v.creditCount} entradas`], ['Débitos', v.debitsCents, `${v.debitCount} saídas`], ['Saldo final calculado', v.computedFinalCents, 'saldo anterior + movimentações'], ['Saldo informado (LEDGERBAL)', v.ledgerCents, latest.ledgerBalance?.asOf ? `em ${dateLabel(latest.ledgerBalance.asOf.date)}` : ''], ['Divergência', v.differenceCents, 'informado − calculado']].map(([label, cents, note]) => <article key={label} className={`payable-metric${label === 'Divergência' && cents ? ' payable-metric--overdue' : ''}`}><span>{label}</span><strong>{cents == null ? '—' : money(cents)}</strong><small>{note}</small></article>)}</section>
        <div className="bank-columns">
          <section className="payable-chart"><h2>Fechamento por dia</h2><table className="payable-table bank-days"><thead><tr><th>Data</th><th>Movimentações</th><th>Saldo calculado</th><th>Saldo informado</th><th>Situação</th></tr></thead><tbody>{v.days.map((day) => <tr key={day.date}><td data-label="Data">{dateLabel(day.date)}</td><td data-label="Movimentações">{day.movementCount}</td><td data-label="Saldo calculado">{money(day.closingCents)}</td><td data-label="Saldo informado">{day.reportedCents == null ? '—' : money(day.reportedCents)}</td><td data-label="Situação">{day.matches == null ? <span className="payable-muted">Sem saldo do dia</span> : day.matches ? <span className="bank-ok"><CircleCheck size={14} aria-hidden="true" />Confere</span> : <span className="bank-diverges"><TriangleAlert size={14} aria-hidden="true" />Diverge</span>}</td></tr>)}</tbody></table></section>
          <section className="payable-chart"><h2>Posições de saldo informadas</h2><p className="payable-muted">Registros de saldo do extrato: não são movimentações e ficam fora dos totais e da conciliação.</p><ul className="bank-balances">{balances.map((row) => <li key={row.id}><span>{dateLabel(row.bankDate)} · {row.kind === 'opening' ? 'Saldo anterior' : 'Saldo do dia'}</span><strong>{money(row.amountCents)}</strong><small>{row.memo} · FITID {row.fitId}</small></li>)}</ul></section>
        </div></>}
      {conflicts.length > 0 && <section className="payable-chart bank-conflicts"><h2>Conflitos para revisão ({conflicts.length})</h2><p className="payable-muted">O mesmo FITID chegou com dados diferentes. O registro original foi mantido.</p><ul>{conflicts.map((row) => <li key={row.id}><strong>FITID {row.fitId} · lote {row.importId}</strong><span>Existente: {dateLabel(row.existing.bankDate)} · {signed(row.existing.amountCents)} · {row.existing.memo}</span><span>Recebido: {dateLabel(row.incoming.bankDate)} · {signed(row.incoming.amountCents)} · {row.incoming.memo}</span><button type="button" className="admin-tool-button" onClick={async () => { try { await payableRequest(`/bank-statements/conflicts/${row.id}/review`, 'POST', {}); await refresh() } catch (caught) { setError(caught.message) } }}>Marcar como revisado</button></li>)}</ul></section>}
      <h2 className="bank-section-title">Movimentações</h2>
      <div className="payable-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Buscar movimentações" placeholder="Histórico, contraparte, CPF/CNPJ ou FITID" value={filters.search} onChange={(event) => changeFilter('search', event.target.value)} /></label><label className="bank-filter">Direção<select aria-label="Direção" value={filters.direction} onChange={(event) => changeFilter('direction', event.target.value)}><option value="">Entradas e saídas</option><option value="in">Entradas</option><option value="out">Saídas</option></select></label><label className="bank-filter">Conciliação<select aria-label="Conciliação" value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">Todas</option><option value="pending">Pendentes</option><option value="reconciled">Conciliadas</option></select></label></div>
      <div className="payable-table-scroll"><table className="payable-table bank-transactions"><thead><tr><th>Data</th><th>Histórico</th><th>Contraparte</th><th>Operação</th><th>Valor</th><th>Conciliação</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td data-label="Data">{dateLabel(row.bankDate)}</td><td data-label="Histórico"><span className="bank-memo">{row.memo}</span><small>FITID {row.fitId}{row.typeConsistency !== 'ok' && row.typeConsistency !== 'unchecked' ? ' · TRNTYPE incoerente com o sinal' : ''}</small></td><td data-label="Contraparte">{row.counterpartyName || <span className="payable-muted">Não identificada</span>}{row.counterpartyDocument && <small>{row.documentType === 'cnpj' ? 'CNPJ' : 'CPF'} {documentLabel(row.counterpartyDocument)}</small>}</td><td data-label="Operação">{row.operationLabel}</td><td data-label="Valor" className={`bank-amount bank-amount--${row.direction}`}>{row.direction === 'in' ? <ArrowDownLeft size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}{signed(row.amountCents)}</td><td data-label="Conciliação">{row.reconciliation ? <div className="bank-linked"><span className="bank-ok"><Link2 size={14} aria-hidden="true" />{row.reconciliation.recordId}</span><small>{row.reconciliation.record?.name}</small><button type="button" className="admin-tool-button" disabled={busyId === row.id} onClick={() => unlink(row)}><Unlink size={14} />Desfazer</button></div> : row.direction === 'zero' ? '—' : <button type="button" className="admin-tool-button" onClick={() => setReconciling(row)}><Link2 size={14} />Conciliar</button>}</td></tr>)}{!transactions.length && <tr><td colSpan={6} className="payable-empty">Nenhuma movimentação encontrada.</td></tr>}</tbody></table></div>
      <div className="payable-pagination"><span>{transactions.length} movimentações</span><button className="payable-icon" title="Página anterior" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {pages}</span><button className="payable-icon" title="Próxima página" aria-label="Próxima página" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>
      <section className="payable-chart"><h2>Lotes importados</h2><ul className="bank-imports">{data.imports.filter((row) => row.bankAccountId === account.id).map((row) => <li key={row.id}><strong>{row.id} · {row.fileName}</strong><span>{new Date(row.importedAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })} · {row.userName}</span><span>{row.counts.new} novas · {row.counts.existing} já existentes{row.counts.conflicts ? ` · ${row.counts.conflicts} conflitos` : ''} · leitura {row.encoding.toUpperCase()}</span></li>)}</ul></section>
    </>}
    {reconciling && <ReconcileModal transaction={reconciling} onClose={() => setReconciling(null)} onDone={async () => { setReconciling(null); await refresh() }} />}
  </AdminWorkspace>
}
