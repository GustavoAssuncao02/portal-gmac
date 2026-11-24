import { useEffect, useState } from 'react'
import { Check, FileText, Mail, Save } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import { downloadFile, payableRequest } from './payablesApi.js'
import DownloadLink from './DownloadLink.jsx'
import ProposalDocumentModal, { proposalModels } from './ProposalDocumentModal.jsx'
import ProposalEmailModal from './ProposalEmailModal.jsx'
import { formatQuantity, validQuantityFor } from '../server/materialUnits.js'
import './labelQuote.css'
import { quantityLabel } from '../server/quantityUnits.js'

// "Aguardando NF-e" of an etiqueta OS (server/labelQuotes.js): the OS, the hours really worked against the estimate and
// the material used, which is corrected here (less returns to the stock, more leaves it). Then the quote is generated,
// sent by e-mail and the OS is concluded, which opens the receivable as in every OS.
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hours = (value) => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`
const dateTime = (at) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : '—'
const decimal = (value) => String(value ?? '').replace('.', ',')
const parse = (text) => { const value = String(text ?? '').trim().replace(/\./g, '').replace(',', '.'); return value === '' ? NaN : Number(value) }

export default function LabelQuoteModal({ code, onClose, onConclude }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [typed, setTyped] = useState({}), [quoting, setQuoting] = useState(false), [emailing, setEmailing] = useState(false)
  const load = () => payableRequest(`/orders/${encodeURIComponent(code)}/label-quote`).then((result) => { setData(result); setTyped(Object.fromEntries(result.materials.map((row) => [row.id, decimal(row.quantity)]))) })
  useEffect(() => { load().catch((caught) => setError(caught.message)) }, [code])

  const changed = data ? data.materials.filter((row) => parse(typed[row.id]) !== row.quantity) : []
  const invalid = data ? data.materials.find((row) => { const value = parse(typed[row.id]); return !Number.isFinite(value) || value < 0 || !validQuantityFor(value, row.unit) }) : null
  async function saveMaterials() {
    if (invalid) return setError(`${invalid.name}: informe a quantidade usada${['un', 'cj'].includes(invalid.unit) ? ' (número inteiro)' : ''}.`)
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await payableRequest(`/orders/${encodeURIComponent(code)}/label-quote/materials`, 'PUT', { materials: changed.map((row) => ({ id: row.id, quantity: parse(typed[row.id]) })) })
      setData(result); setTyped(Object.fromEntries(result.materials.map((row) => [row.id, decimal(row.quantity)])))
      setMessage(result.discarded ? 'Material salvo. O orçamento gerado antes foi descartado: gere de novo.' : 'Material salvo e estoque atualizado.')
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }

  const quote = data?.quote
  const ready = data && !quote.pending
  const footer = data && <>
    <button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Fechar</button>
    <button className="admin-tool-button" type="button" disabled={busy || changed.length > 0} title={changed.length ? 'Salve o material antes de gerar o orçamento.' : undefined} onClick={() => { setError(''); setMessage(''); setQuoting(true) }}><FileText size={16} aria-hidden="true" />{ready ? 'Gerar orçamento de novo' : 'Gerar orçamento'}</button>
    <button className="admin-tool-button" type="button" disabled={busy || !ready} title={ready ? undefined : 'Gere o orçamento antes de enviar.'} onClick={() => setEmailing(true)}><Mail size={16} aria-hidden="true" />Enviar por e-mail</button>
    <button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy || !ready || changed.length > 0} title={ready ? undefined : 'Gere o orçamento antes de concluir a OS.'} onClick={() => onConclude(code)}><Check size={16} aria-hidden="true" />Concluir OS</button>
  </>
  return <>
    <PayableModal title={data ? `Aguardando NF-e · ${data.order.code}` : 'Aguardando NF-e'} wide busy={busy} onClose={onClose} footer={footer} className="label-quote-modal">
      {!data && !error && <p className="payable-muted">Carregando OS...</p>}
      {data && <>
        <dl className="payable-facts receivable-order-facts">{[['OS', data.order.code], ['Etiqueta', data.order.labelNumber], ['Cliente', data.order.company], ['Serviço', data.order.service], ['Quantidade', quantityLabel(data.order.quantity, data.order.quantityUnit, { short: true })], ['Prazo acordado', day(data.order.deadline)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>

        <section className="label-quote-section" aria-labelledby="label-quote-hours"><h3 id="label-quote-hours">Horas trabalhadas</h3>
          <div className="payable-table-scroll"><table className="payable-table label-quote-table"><thead><tr><th>Etapa</th><th>Máquina ou serviço</th><th>Previsto</th><th>Real</th></tr></thead>
            <tbody>{data.hours.map((row) => <tr key={row.code}><td>{row.stage}</td><td data-label="Máquina ou serviço">{row.resource || '—'}</td><td data-label="Previsto">{hours(row.estimatedHours)}</td><td data-label="Real"><strong>{hours(row.realHours)}</strong></td></tr>)}
              {!data.hours.length && <tr><td colSpan={4} className="payable-empty">Nenhuma etapa registrada.</td></tr>}</tbody></table></div>
        </section>

        <section className="label-quote-section" aria-labelledby="label-quote-materials"><h3 id="label-quote-materials">Material consumido</h3>
          <p className="payable-hint">Corrija a quantidade realmente usada antes de gerar o orçamento. O que diminuir volta ao estoque; o que aumentar sai do estoque (o que faltar fica como pedido de material).</p>
          <div className="payable-table-scroll"><table className="payable-table label-quote-table"><thead><tr><th>Material</th><th>Previsto</th><th>Usado</th></tr></thead>
            <tbody>{data.materials.map((row) => <tr key={row.id}><td><strong>{row.name}</strong>{row.detail && <small>{row.detail}</small>}{row.pending > 0 && <small className="label-quote-pending">{formatQuantity(row.pending, row.unit)} aguardando compra</small>}</td><td data-label="Previsto">{formatQuantity(row.estimated, row.unit)}</td>
              <td data-label="Usado"><span className="label-quote-quantity"><input inputMode="decimal" aria-label={`Quantidade usada de ${row.name}`} value={typed[row.id] ?? ''} disabled={busy || data.concluded} onChange={(event) => { setTyped({ ...typed, [row.id]: event.target.value }); setMessage('') }} /><span>{row.unit}</span></span></td></tr>)}
              {!data.materials.length && <tr><td colSpan={3} className="payable-empty">Nenhum material nesta OS.</td></tr>}</tbody></table></div>
          {changed.length > 0 && <div className="label-quote-save">{ready && <p className="payable-hint" role="status">O orçamento já gerado será descartado e precisará ser gerado de novo.</p>}<button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy} onClick={saveMaterials}><Save size={16} aria-hidden="true" />{busy ? 'Salvando...' : 'Salvar material'}</button></div>}
        </section>

        <section className="label-quote-section" aria-labelledby="label-quote-status"><h3 id="label-quote-status">Orçamento</h3>
          {quote.pending ? <p className="label-quote-state label-quote-state--pending">Orçamento pendente: gere o orçamento com as horas e o material acima.</p>
            : <p className="label-quote-state">{proposalModels.find((item) => item.key === quote.document?.model)?.title || 'Orçamento'}{quote.document?.number ? ` nº ${quote.document.number}` : ''} · <strong>{money(quote.total)}</strong> · gerado em {dateTime(quote.generatedAt)} por {quote.generatedByName}
              {' '}<DownloadLink url={`/api/offers/${encodeURIComponent(data.order.offerId)}/proposal.pdf`} name={`Orcamento-etiqueta-${data.order.labelNumber}.pdf`}>Baixar PDF</DownloadLink></p>}
          {data.emails.length > 0 && <ul className="label-quote-emails">{data.emails.map((email) => <li key={email.id}><Mail size={14} aria-hidden="true" />{email.subject} · {dateTime(email.sentAt)} · por {email.sentByName} · para {email.to.join(', ')}</li>)}</ul>}
        </section>
        {message && <p className="admin-tool-success" role="status">{message}</p>}
      </>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
    </PayableModal>
    {quoting && data && <ProposalDocumentModal offer={{ id: data.order.offerId, deadline: data.order.deadline, proposal: null }} orderCode={code} initialModel="etiqueta" onClose={() => setQuoting(false)} onSaved={(result) => { setData(result); setQuoting(false); setMessage('Orçamento gerado. Envie por e-mail e conclua a OS.')
      // As with the commercial proposal, the PDF is saved right away (it needs the session, so it is fetched).
      downloadFile(`/api/offers/${encodeURIComponent(result.order.offerId)}/proposal.pdf`, `Orcamento-etiqueta-${result.order.labelNumber}.pdf`).catch((caught) => setError(caught.message)) }} />}
    {emailing && data && <ProposalEmailModal offer={{ id: data.order.offerId, company: data.order.company }} onClose={() => setEmailing(false)} onSent={async () => { setEmailing(false); await load(); setMessage('E-mail enviado.') }} />}
  </>
}
