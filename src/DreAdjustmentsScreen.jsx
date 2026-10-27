import { useEffect, useId, useState } from 'react'
import { Plus, Pencil, Trash2, Save, Search, Download, Paperclip } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal, FilePicker } from './PayableModal.jsx'
import MoneyInput from './MoneyInput.jsx'
import ClassificationSelect from './ClassificationSelect.jsx'
import { money, decimal, payableRequest, uploadFiles, downloadFile } from './payablesApi.js'
import { todayBahia, cents, shiftMonth } from '../server/payableRules.js'
import { monthLabel, repeatedValues } from '../server/dreRules.js'
import { classificationLabel } from '../server/accountPlanRules.js'
import './payables.css'
import './dre.css'

const addMonths = (month, count) => shiftMonth(`${month}-01`, count).slice(0, 7)
const safeCents = (value) => { try { return cents(value || '0') } catch { return 0 } }
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const variationNumber = (text) => { const number = Number(String(text || '0').replace(',', '.')); return Number.isFinite(number) ? number : NaN }

// One adjustment, or the same adjustment repeated for N months with a monthly variation (depreciation that falls 2% a month).
function AdjustmentForm({ source, classifications, onClose, onSaved }) {
  const id = useId()
  const [draft, setDraft] = useState(() => source ? { month: source.month, classificationId: source.classificationId, reversal: source.valueCents < 0, value: decimal(Math.abs(source.valueCents)), description: source.description, repeat: 1, variation: '0' } : { month: todayBahia().slice(0, 7), classificationId: '', reversal: false, value: '', description: '', repeat: 1, variation: '0' })
  const [files, setFiles] = useState([]), [attachments, setAttachments] = useState(source?.attachments || []), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const repeat = Math.max(1, Math.min(60, Number(draft.repeat) || 1)), variation = variationNumber(draft.variation), valueCents = safeCents(draft.value)
  const preview = !source && repeat > 1 && valueCents && Number.isFinite(variation) && variation > -100 && variation <= 100 ? repeatedValues(valueCents, repeat, variation) : null
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const fileIds = await uploadFiles('/dre-adjustments', files)
      const body = { month: draft.month, classificationId: draft.classificationId, reversal: draft.reversal, value: draft.value, description: draft.description, fileIds, ...(source ? {} : { repeat, variation: draft.variation }) }
      await payableRequest(source ? `/dre-adjustments/${source.id}` : '/dre-adjustments', source ? 'PUT' : 'POST', body)
      await onSaved()
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function removeFile(file) {
    try { await payableRequest(`/dre-adjustments/${source.id}/files/${file.id}`, 'DELETE'); setAttachments(attachments.filter((item) => item.id !== file.id)) } catch (caught) { setError(caught.message) }
  }
  return <PayableModal title={source ? `Editar ${source.id}` : 'Novo ajuste da DRE'} className="payable-modal--form" wide busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}><Save size={16} />{busy ? 'Salvando...' : repeat > 1 && !source ? `Salvar ${repeat} ajustes` : 'Salvar ajuste'}</button></>}>
    <form id={id} className="payable-form payable-entry-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Mês de competência<input type="month" aria-label="Mês de competência" required value={draft.month} onChange={(event) => setDraft({ ...draft, month: event.target.value })} /></label>
      <label>Classificação<ClassificationSelect classifications={classifications} use="adjustment" keep={source ? [source.classificationId] : []} value={draft.classificationId} onChange={(classificationId) => setDraft({ ...draft, classificationId })} /></label>
      <fieldset className="payable-type"><legend>Tipo do ajuste</legend>{[[false, 'Lançamento'], [true, 'Estorno']].map(([reversal, label]) => <label className="payable-radio" key={label}><input name={`${id}-kind`} type="radio" checked={draft.reversal === reversal} onChange={() => setDraft({ ...draft, reversal })} />{label}</label>)}<small className="payable-hint">{draft.reversal ? 'O estorno desfaz um valor lançado antes: entra na DRE com o sinal contrário.' : 'Entra na DRE na natureza da classificação (despesa reduz o resultado, receita aumenta).'}</small></fieldset>
      <label>{repeat > 1 && !source ? 'Valor do primeiro mês' : 'Valor'}<MoneyInput aria-label="Valor" required positive value={draft.value} onChange={(value) => setDraft({ ...draft, value })} /></label>
      <label className="payable-form-wide">Descrição<textarea aria-label="Descrição" required rows={2} maxLength={1000} placeholder="Ex.: depreciação das máquinas, provisão de férias" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      {!source && <><label>Repetir por quantos meses<input type="number" aria-label="Repetir por quantos meses" min={1} max={60} required value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value })} /><small className="payable-hint">{repeat > 1 ? `De ${monthLabel(draft.month || todayBahia().slice(0, 7))} a ${monthLabel(addMonths(draft.month || todayBahia().slice(0, 7), repeat - 1))}.` : 'Só este mês.'}</small></label>
        {repeat > 1 && <label>Variação por mês (%)<input inputMode="decimal" aria-label="Variação por mês (%)" value={draft.variation} onChange={(event) => setDraft({ ...draft, variation: event.target.value.replace(/[^\d,.-]/g, '') })} /><small className="payable-hint">0% repete o mesmo valor. Use um número negativo para reduzir (−2 reduz 2% a cada mês).</small></label>}
        {preview && <div className="payable-form-wide dre-adjustment-preview"><strong>Valores gerados</strong><ol>{preview.map((value, index) => <li key={index}><span>{monthLabel(addMonths(draft.month, index))}</span><strong>{draft.reversal ? '− ' : ''}{money(value)}</strong></li>)}</ol><span>Total: {draft.reversal ? '− ' : ''}{money(preview.reduce((sum, value) => sum + value, 0))}</span></div>}
      </>}
      {source?.seriesId && <p className="payable-hint payable-form-wide">Este ajuste é o mês {source.seriesIndex} de {source.seriesCount} de uma repetição; a edição muda só este mês.</p>}
      {attachments.length > 0 && <div className="payable-form-wide dre-adjustment-files"><strong>Anexos</strong>{attachments.map((file) => <span key={file.id}><Paperclip size={14} aria-hidden="true" />{file.name}<button type="button" className="payable-icon" title="Baixar" aria-label={`Baixar ${file.name}`} onClick={() => downloadFile(`/api/dre-adjustments/${source.id}/files/${file.id}`, file.name).catch((caught) => setError(caught.message))}><Download size={15} /></button><button type="button" className="payable-icon payable-danger" title="Remover" aria-label={`Remover ${file.name}`} onClick={() => removeFile(file)}><Trash2 size={15} /></button></span>)}</div>}
      <FilePicker title="Anexos (opcional)" files={files} setFiles={setFiles} disabled={busy} />
      {error && <p className="admin-tool-error payable-form-wide" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function RemoveAdjustment({ row, items, onClose, onRemoved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const following = row.seriesId ? items.filter((item) => item.seriesId === row.seriesId && item.month >= row.month).length : 1
  async function remove(scope) { setBusy(true); setError(''); try { await payableRequest(`/dre-adjustments/${row.id}${scope ? `?scope=${scope}` : ''}`, 'DELETE'); await onRemoved() } catch (caught) { setError(caught.message) } finally { setBusy(false) } }
  return <PayableModal title="Excluir ajuste" busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>{following > 1 && <button className="admin-tool-button admin-tool-button--danger" type="button" disabled={busy} onClick={() => remove('following')}>Excluir este e os próximos ({following})</button>}<button className="admin-tool-button admin-tool-button--primary admin-tool-button--danger" type="button" disabled={busy} onClick={() => remove('')}>{following > 1 ? 'Excluir só este' : 'Excluir'}</button></>}>
    <p>Excluir <strong>{row.id}</strong> · {monthLabel(row.month)} · {row.description}?</p>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}

// Ajustes da DRE: what does not go through the bank (depreciation, provisions for vacation and the 13th salary) posted
// straight to a month of the DRE. They appear in both views and never change Tesouraria or the bank balances.
export default function DreAdjustmentsScreen(props) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [form, setForm] = useState(null), [removing, setRemoving] = useState(null), [search, setSearch] = useState(''), [period, setPeriod] = useState({ start: '', end: '' })
  const load = () => payableRequest('/dre-adjustments').then((result) => { setData(result); setError(''); return result })
  useEffect(() => {
    // Opened from a line of the DRE: the adjustment comes up for editing.
    const openAdjustment = (id, result) => { const row = result?.items.find((item) => item.id === id); if (row) setForm({ source: row }); sessionStorage.removeItem('gmac-dre-adjustment-open') }
    const wanted = sessionStorage.getItem('gmac-dre-adjustment-open')
    load().then((result) => { if (wanted) openAdjustment(wanted, result) }).catch((caught) => setError(caught.message))
    const open = (event) => load().then((result) => openAdjustment(event.detail, result)).catch((caught) => setError(caught.message))
    window.addEventListener('gmac-dre-adjustment-open', open)
    return () => window.removeEventListener('gmac-dre-adjustment-open', open)
  }, [])
  const items = data?.items || [], term = plain(search.trim())
  const rows = items.filter((row) => (!period.start || row.month >= period.start) && (!period.end || row.month <= period.end) && (!term || plain(`${row.id} ${row.description} ${row.classificationCode} ${row.classificationName} ${monthLabel(row.month)}`).includes(term)))
  const total = rows.reduce((sum, row) => sum + (row.nature === 'revenue' ? row.valueCents : -row.valueCents), 0)
  return <AdminWorkspace {...props} title="Ajustes da DRE">
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!data} onClick={() => setForm({})}><Plus size={17} />Novo ajuste</button></div>
    <p className="payable-muted account-plan-intro">Valores que não passam pelo banco, como depreciação e provisões de férias e 13º, lançados direto no mês da DRE. Entram nas visões por caixa e por competência e não mudam a Tesouraria nem os saldos dos bancos.</p>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" type="button" onClick={() => load().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    {!data ? !error && <p>Carregando...</p> : <>
      <div className="payable-toolbar dre-adjustments-toolbar"><label className="payable-search"><Search size={18} /><input aria-label="Busca rápida" placeholder="ID, descrição ou classificação" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="treasury-date">De<input type="month" aria-label="Mês inicial" max={period.end || undefined} value={period.start} onChange={(event) => setPeriod({ ...period, start: event.target.value })} /></label><label className="treasury-date">Até<input type="month" aria-label="Mês final" min={period.start || undefined} value={period.end} onChange={(event) => setPeriod({ ...period, end: event.target.value })} /></label></div>
      <div className="payable-table-scroll"><table className="payable-table dre-adjustments-table"><thead><tr><th>ID</th><th>Mês</th><th>Classificação</th><th>Descrição</th><th>Repetição</th><th className="dre-value">Efeito no resultado</th><th>Ações</th></tr></thead><tbody>
        {rows.map((row) => { const effect = row.nature === 'revenue' ? row.valueCents : -row.valueCents; return <tr key={row.id}><td className="payable-id">{row.id}</td><td data-label="Mês">{monthLabel(row.month)}</td><td data-label="Classificação">{classificationLabel({ code: row.classificationCode, name: row.classificationName })}</td><td data-label="Descrição">{row.description}{row.valueCents < 0 ? <small className="dre-tag">Estorno</small> : null}{row.attachments.length ? <small className="dre-tag"><Paperclip size={12} aria-hidden="true" />{row.attachments.length}</small> : null}</td><td data-label="Repetição">{row.seriesId ? `${row.seriesIndex} de ${row.seriesCount}` : '—'}</td><td data-label="Efeito no resultado" className={`dre-value${effect < 0 ? ' dre-negative' : ''}`}>{money(effect)}</td><td><div className="payable-registry-actions"><button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${row.id}`} onClick={() => setForm({ source: row })}><Pencil size={16} /></button><button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${row.id}`} onClick={() => setRemoving(row)}><Trash2 size={16} /></button></div></td></tr> })}
        {!rows.length && <tr><td colSpan={7} className="payable-empty">{items.length ? 'Nenhum ajuste encontrado.' : 'Nenhum ajuste lançado.'}</td></tr>}
      </tbody></table></div>
      <div className="payable-pagination"><span>{rows.length} {rows.length === 1 ? 'ajuste' : 'ajustes'} · efeito no resultado {money(total)}</span></div>
    </>}
    {form && <AdjustmentForm source={form.source} classifications={data?.classifications || []} onClose={() => setForm(null)} onSaved={async () => { await load(); setForm(null) }} />}
    {removing && <RemoveAdjustment row={removing} items={items} onClose={() => setRemoving(null)} onRemoved={async () => { await load(); setRemoving(null) }} />}
  </AdminWorkspace>
}
