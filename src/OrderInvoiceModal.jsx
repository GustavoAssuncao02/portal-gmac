import { useEffect, useRef, useState } from 'react'
import { Check, CircleOff, FileText, TriangleAlert, Upload } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { money, dateLabel, payableRequest } from './payablesApi.js'
import { cents } from '../server/payableRules.js'
import { InvoiceCard, blockOf, documentLabel, invoiceDrafts } from './ReceivableInvoiceImport.jsx'
import ClientQuickForm from './ClientQuickForm.jsx'
import './payables.css'

// NF-e da OS (server/orderInvoices.js): "Aguardando NF-e" and Ver OS › NF-e open this window. The PDF of the invoice is read
// in the layouts Contas a Receber already reads; the user checks each note (as in "Importar notas (PDF)") and "Concluir
// OS" attaches it, generates the account receivable and concludes the OS. Administrative employees use it too.
const token = () => ({ Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` })
const safeCents = (value) => { try { return cents(value || '0') } catch { return 0 } }
const plainDocument = (value) => String(value || '').replace(/\D/g, '')
const base = (code) => `/orders/${encodeURIComponent(code)}/invoices`
export const invoiceNotCompleted = 'A OS não está concluída, não é possível importar a NF-e.'
const accountLine = (row) => `${row.id} · ${money(row.valueCents)}${row.installments > 1 ? ` em ${row.installments} parcelas` : ''} · vence em ${dateLabel(row.dueDate)}`

async function readPdf(code, file) {
  const response = await fetch(`/api${base(code)}/read?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...token(), 'Content-Type': 'application/octet-stream' }, body: file })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${file.name}: ${result.message || 'não foi possível ler o arquivo.'}`)
  return result
}

// The questions asked before attaching: a possible duplicate, a note of another company, concluding without NF-e.
function Question({ ask, order, busy, onAnswer, onClose }) {
  if (ask.kind === 'duplicate') return <PayableModal title="Possível lançamento duplicado" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={() => onAnswer('attach')}>Só anexar na OS</button>
    <button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => onAnswer('post')}>Lançar mesmo assim</button>
  </>}>
    <p>A <strong>{ask.row.label} {ask.row.documentNumber}</strong> pode já estar lançada no Contas a Receber:</p>
    <ul className="order-invoice-matches">{ask.matches.map((row) => <li key={row.id}><strong>{accountLine(row)}</strong><small>{row.customerName}{row.documentNumber ? ` · documento ${row.documentNumber}` : ''}{row.orderCode ? ` · ${row.orderCode}` : ''}</small></li>)}</ul>
    <p className="payable-hint"><strong>Lançar mesmo assim</strong> cria outra conta a receber. <strong>Só anexar na OS</strong> guarda a NF-e na OS sem criar conta.</p>
  </PayableModal>
  if (ask.kind === 'client') return <PayableModal title="NF-e de outra empresa" busy={busy} onClose={onClose} footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => onAnswer('confirm')}>Continuar</button></>}>
    <p>A <strong>{ask.row.label} {ask.row.documentNumber}</strong> é de <strong>{ask.row.customerName || 'outro cliente'}</strong> ({documentLabel(ask.row.customerDocument)}), e a OS é de <strong>{order.company}</strong> ({documentLabel(order.cnpj)}).</p>
    <p>Deseja anexar esta nota na {order.code} mesmo assim?</p>
  </PayableModal>
  return <PayableModal title="Concluir sem NF-e" busy={busy} onClose={onClose} footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy} onClick={() => onAnswer('skip')}>{busy ? 'Concluindo...' : 'Concluir sem NF-e'}</button></>}>
    <p><strong>Nenhuma conta a receber será gerada.</strong></p>
    <p>A {order.code} fica concluída com a marca «Sem NF-e». A nota pode ser importada depois, em Ver OS › NF-e, e então gera a conta a receber.</p>
    <p>Deseja concluir a OS sem NF-e?</p>
  </PayableModal>
}

export default function OrderInvoiceModal({ code, onClose, onDone }) {
  const [info, setInfo] = useState(null), [loadError, setLoadError] = useState(''), [rows, setRows] = useState([]), [problems, setProblems] = useState([])
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [ask, setAsk] = useState(null)
  const [registering, setRegistering] = useState(null), [newClients, setNewClients] = useState([])
  const input = useRef(null)
  const load = () => payableRequest(base(code)).then((result) => { setInfo(result); return result })
  useEffect(() => { load().catch((caught) => setLoadError(caught.message)) }, [code])
  const order = info?.order, attached = info?.invoices || []
  const allClients = [...(info?.clients || []), ...newClients]
  const clientOf = (row) => row.customerDocument ? allClients.find((item) => plainDocument(item.document) === row.customerDocument) : null
  const update = (key, patch) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  const ready = order && order.completed && !order.labelQuotePending

  async function choose(files) {
    setReading(true); setError('')
    const results = [], failed = []
    for (const file of files) { try { results.push(await readPdf(code, file)) } catch (caught) { failed.push(caught.message) } }
    if (results.length) {
      const found = new Map(results.flatMap((result) => result.items.map((note) => [note.file.id, note])))
      const drafts = invoiceDrafts(results, info.classifications).map((row) => {
        const note = found.get(row.fileId), otherClient = Boolean(order.cnpj && row.customerDocument && row.customerDocument !== order.cnpj)
        const warnings = [...row.warnings,
          ...(note.duplicates?.length ? [`Possível lançamento duplicado: esta nota pode já estar em ${note.duplicates.map((item) => item.id).join(', ')}. Ao concluir, você escolhe o que fazer.`] : []),
          ...(otherClient ? [`A nota é de ${documentLabel(row.customerDocument)}, e a OS é de ${order.company} (${documentLabel(order.cnpj)}).`] : [])]
        return { ...row, selected: true, duplicateOf: null, warnings, duplicates: note.duplicates || [], otherClient, clientConfirmed: false, mode: 'post', allowDuplicate: false }
      })
      setRows((current) => [...current, ...drafts])
      setProblems((current) => [...current, ...results.flatMap((result) => result.problems.map((item) => ({ ...item, source: result.source })))])
    }
    if (failed.length) setError(failed.join(' '))
    setReading(false)
  }
  // The PDFs read and not attached are let go.
  const discard = (ids) => { if (ids.length) payableRequest(`${base(code)}/discard`, 'POST', { ids }).catch(() => {}) }
  function takeOut(row) { discard([row.fileId]); setRows((current) => current.filter((item) => item.key !== row.key)) }
  function close() { if (busy) return; discard(rows.map((row) => row.fileId)); onClose() }

  async function conclude(list = rows) {
    setError('')
    if (!list.length && !attached.length) return setError('Selecione o PDF da NF-e.')
    const blocked = list.map((row) => [row, blockOf(row, clientOf(row))]).filter(([, message]) => message)
    if (blocked.length) {
      setRows((current) => current.map((row) => { const found = blocked.find(([item]) => item.key === row.key); return found ? { ...row, error: found[1] } : row }))
      return setError(`Confira ${blocked.length === 1 ? 'a nota' : `as ${blocked.length} notas`} abaixo.`)
    }
    const other = list.find((row) => row.otherClient && !row.clientConfirmed)
    if (other) return setAsk({ kind: 'client', row: other })
    setBusy(true)
    let attachedNow = false
    try {
      if (list.length) {
        await payableRequest(base(code), 'POST', { notes: list.map((row) => ({ fileId: row.fileId, kind: row.kind, clientId: clientOf(row).id, documentNumber: row.documentNumber.trim(), issueDate: row.issueDate, description: row.description, value: row.value, iss: row.iss || '', classificationId: row.classificationId, installments: row.installments, mode: row.mode, allowDuplicate: row.allowDuplicate })) })
        attachedNow = true
        setRows([])
        await load().catch(() => {})
      }
      if (!order.concluded) await payableRequest(`/operations/orders/${encodeURIComponent(code)}/acknowledge-completion`, 'POST', {})
      await onDone()
    } catch (caught) {
      if (caught.data?.duplicate) {
        const row = list.find((item) => item.fileId === caught.data.fileId)
        if (row) setAsk({ kind: 'duplicate', row, matches: caught.data.matches || [], list })
        else setError(caught.message)
      } else setError(attachedNow ? `A NF-e foi anexada, mas a OS não foi concluída: ${caught.message} Clique em Concluir OS para tentar de novo.` : caught.message)
    } finally { setBusy(false) }
  }
  async function answer(choice) {
    const current = ask
    setAsk(null)
    if (choice === 'skip') {
      setBusy(true); setError('')
      try { await payableRequest(`/operations/orders/${encodeURIComponent(code)}/acknowledge-completion`, 'POST', { withoutInvoice: true }); await onDone() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
      return
    }
    const patch = choice === 'confirm' ? { clientConfirmed: true } : choice === 'attach' ? { mode: 'attach', allowDuplicate: false } : { mode: 'post', allowDuplicate: true }
    const next = (current.list || rows).map((row) => row.key === current.row.key ? { ...row, ...patch } : row)
    setRows(next)
    await conclude(next)
  }

  const notesCents = attached.reduce((sum, file) => sum + (Number(file.valueCents) || 0), 0) + rows.reduce((sum, row) => sum + safeCents(row.value), 0)
  const differs = order && order.valueCents > 0 && (rows.length || attached.length) && notesCents !== order.valueCents
  const footer = info && <>
    <button type="button" className="admin-tool-button" disabled={busy} onClick={close}>Cancelar</button>
    {ready && !order.concluded && !attached.length && !rows.length && <button type="button" className="admin-tool-button" disabled={busy || reading} onClick={() => setAsk({ kind: 'skip' })}><CircleOff size={16} />Concluir sem NF-e</button>}
    {ready && <button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy || reading || (!rows.length && (!attached.length || order.concluded))} onClick={() => conclude()}><Check size={16} />{busy ? 'Salvando...' : order.concluded ? 'Anexar NF-e' : 'Concluir OS'}</button>}
  </>
  return <PayableModal title={`NF-e · ${code}`} className="payable-modal--form invoice-import-modal order-invoice-modal" wide={rows.length > 0} busy={busy} onClose={close} footer={footer}>
    {loadError && <p className="admin-tool-error" role="alert">{loadError}</p>}
    {!info ? !loadError && <p role="status">Carregando OS...</p> : <>
      <dl className="payable-facts receivable-order-facts">{[['OS', order.code], ['Cliente', order.company || '—'], ['Serviço', order.service || '—'], ['Valor da OS', order.valueCents ? money(order.valueCents) : '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {!order.completed ? <p className="bank-warning bank-warning--warning" role="alert"><TriangleAlert size={16} aria-hidden="true" />{invoiceNotCompleted}</p>
        : order.labelQuotePending ? <p className="bank-warning bank-warning--warning" role="alert"><TriangleAlert size={16} aria-hidden="true" />Gere o orçamento da etiqueta antes de importar a NF-e.</p> : <>
          <p className="payable-hint">{order.concluded ? 'Anexe o PDF da NF-e emitida para este serviço: cada nota vira uma conta a receber da OS, com o PDF anexado.' : 'Anexe o PDF da NF-e emitida para este serviço. Cada nota vira uma conta a receber da OS, com o PDF anexado, e a OS é concluída.'}</p>
          {attached.length > 0 && <div className="order-invoice-attached"><span>{attached.length === 1 ? 'NF-e já anexada' : 'NF-e já anexadas'}</span><ul>{attached.map((file) => <li key={file.id}><FileText size={14} aria-hidden="true" /><strong>{file.label} {file.number}</strong><small>{file.accounts.length ? file.accounts.map((row) => row.id).join(', ') : file.existing.length ? `já lançada em ${file.existing.map((row) => row.id).join(', ')}` : 'sem conta a receber'}</small></li>)}</ul></div>}
          <div className="order-invoice-pick"><button type="button" className="admin-tool-button" disabled={busy || reading} onClick={() => input.current.click()}><Upload size={16} />{reading ? 'Lendo a nota...' : rows.length || attached.length ? 'Adicionar outra NF-e' : 'Selecionar PDF da NF-e'}</button><input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="PDF da NF-e" onChange={(event) => { const list = [...event.target.files]; event.target.value = ''; if (list.length) choose(list) }} /></div>
          {problems.length > 0 && <ul className="invoice-import-problems" aria-label="Páginas não lidas">{problems.map((item, index) => <li key={`${item.source}-${item.page}-${index}`}><TriangleAlert size={14} aria-hidden="true" />{item.source}{item.page ? `, página ${item.page}` : ''}: {item.message}</li>)}</ul>}
          <div className="invoice-import">{rows.map((row) => <InvoiceCard key={row.key} row={row} client={clientOf(row)} classifications={info.classifications} disabled={busy} selectable={false} onChange={(patch) => update(row.key, patch)} onRegister={() => setRegistering(row)}
            extra={<span className="order-invoice-card-actions">{row.mode === 'attach' && <em className="order-invoice-mode">Só anexar, sem conta a receber <button type="button" className="payable-link" onClick={() => update(row.key, { mode: 'post', allowDuplicate: false })}>desfazer</button></em>}<button type="button" className="payable-link" disabled={busy} onClick={() => takeOut(row)}>Tirar da lista</button></span>} />)}</div>
          {differs ? <p className="bank-warning bank-warning--warning" role="note"><TriangleAlert size={16} aria-hidden="true" />O total {rows.length + attached.length > 1 ? 'das notas' : 'da nota'} ({money(notesCents)}) é diferente do valor da OS ({money(order.valueCents)}). Vale o valor {rows.length + attached.length > 1 ? 'das notas' : 'da nota'}.</p> : null}
        </>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </>}
    {ask && <Question ask={ask} order={order} busy={busy} onAnswer={answer} onClose={() => setAsk(null)} />}
    {registering && <ClientQuickForm initial={{ name: registering.customerName, document: registering.customerDocument }} onClose={() => setRegistering(null)} onCreated={async (client) => { setNewClients((current) => [...current, { id: String(client.id), name: client.name, document: plainDocument(client.document) }]); setRegistering(null) }} />}
  </PayableModal>
}

// Taking an NF-e out of the OS: two boxes, two answers. The PDF leaves the OS (marked when the window opens, since the ×
// was clicked) and, apart, the account receivable it generated is deleted. An account with a receipt or reconciled stays.
export function OrderInvoiceRemoveModal({ code, file, onClose, onDone }) {
  const [info, setInfo] = useState(null), [removeFile, setRemoveFile] = useState(true), [removeAccounts, setRemoveAccounts] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { payableRequest(base(code)).then((result) => setInfo(result.invoices.find((item) => item.id === file.id) || { accounts: [], existing: [] })).catch((caught) => setError(caught.message)) }, [code, file.id])
  const accounts = info?.accounts || [], blocked = Boolean(info?.deleteBlock)
  async function confirm() {
    setBusy(true); setError('')
    try { await payableRequest(`${base(code)}/${encodeURIComponent(file.id)}/remove`, 'POST', { file: removeFile, receivables: removeAccounts && accounts.length > 0 && !blocked }); await onDone() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={`Remover ${file.label} ${file.number}`} busy={busy} onClose={onClose} footer={<><button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="admin-tool-button admin-tool-button--primary" disabled={busy || !info || (!removeFile && !(removeAccounts && accounts.length))} onClick={confirm}>{busy ? 'Removendo...' : 'Confirmar'}</button></>}>
    <p>Marque o que deseja remover:</p>
    <fieldset className="order-invoice-remove" disabled={busy || !info}>
      <label><input type="checkbox" checked={removeFile} onChange={(event) => setRemoveFile(event.target.checked)} /><span><strong>Remover a NF-e da OS</strong><small>O PDF sai da {code}.</small></span></label>
      <label className={!accounts.length || blocked ? 'is-disabled' : ''}><input type="checkbox" checked={removeAccounts && accounts.length > 0 && !blocked} disabled={!accounts.length || blocked} onChange={(event) => setRemoveAccounts(event.target.checked)} /><span><strong>{accounts.length > 1 ? 'Excluir as contas a receber geradas por ela' : 'Excluir a conta a receber gerada por ela'}</strong>
        <small>{!info ? 'Verificando...' : !accounts.length ? 'Esta NF-e não tem conta a receber gerada por ela.' : blocked ? `Não pode ser excluída: ${info.deleteBlock}` : accounts.map((row) => `${row.id} · ${money(row.valueCents)} · vence em ${dateLabel(row.dueDate)}`).join('; ')}</small></span></label>
    </fieldset>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
