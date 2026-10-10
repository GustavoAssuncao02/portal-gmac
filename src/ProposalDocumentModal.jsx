import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowLeft, BadgeCheck, FileText, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import MoneyInput from './MoneyInput.jsx'
import ProposalSettingsModal from './ProposalSettingsModal.jsx'
import { payableRequest } from './payablesApi.js'
import { itemTotal, letterTotal, rateFor, situationNames, tableTotals } from '../server/proposalMath.js'
import './proposalDocuments.css'

export const proposalModels = [
  { key: 'model-a', title: 'Modelo A', subtitle: 'Escopo e preço global', example: 'Carta de proposta com o escopo em tópicos e um único valor global. Use quando o serviço é cobrado como um todo, como mão de obra ou serviço fechado.' },
  { key: 'model-b', title: 'Modelo B', subtitle: 'Composição detalhada', example: 'Carta de proposta com o valor de cada item do escopo, subtotais por grupo e total. Use quando o cliente pede o preço separado por etapa ou parte.' },
  { key: 'nestle', title: 'Nestlé (FS-3055)', subtitle: 'Planilha de preços da Nestlé', example: 'Formulário do próprio cliente: horas e materiais calculados pela tabela de preços da Nestlé, com código SAP. Use nas solicitações da Nestlé.' },
  { key: 'etiqueta', title: 'Etiqueta', subtitle: 'Planilha de preços da GMAC', example: 'Planilha da GMAC para serviços identificados por número de etiqueta: horas e materiais pela tabela da GMAC, com frete e total.' },
]
export const modelLabel = (document) => !document ? '' : document.model === 'nestle' ? `Nestlé FS-3055 nº ${document.number}` : document.model === 'etiqueta' ? `Etiqueta ${document.labelNumber}` : `${document.model === 'model-b' ? 'Modelo B' : 'Modelo A'} · cotação ${document.quoteNumber}`

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const decimal = (value) => value === '' || value == null ? '' : String(value).replace('.', ',')
const parseDecimal = (value) => { const text = String(value ?? '').trim().replace(/\./g, '').replace(',', '.'); return text === '' ? null : Number(text) }
const apiMoney = (value) => Number(value) ? Number(value).toFixed(2) : ''

function QuantityInput({ value, onChange, label }) {
  const [text, setText] = useState(decimal(value))
  useEffect(() => { if (parseDecimal(text) !== (value ?? null)) setText(decimal(value)) }, [value])
  return <input className="proposal-qty" inputMode="decimal" aria-label={label} value={text} placeholder="0" onChange={(event) => { setText(event.target.value); const number = parseDecimal(event.target.value); if (number === null || (Number.isFinite(number) && number >= 0)) onChange(number) }} />
}

// CNAE, NBS and NCM come from the official catalogs synchronized every week.
function FiscalPicker({ kind, label, value, onChange, cnpj, hint }) {
  const [query, setQuery] = useState(''), [items, setItems] = useState([]), [open, setOpen] = useState(false), [error, setError] = useState('')
  const listId = useId()
  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => payableRequest(`/fiscal/search?kind=${kind}&q=${encodeURIComponent(query)}&cnpj=${encodeURIComponent(cnpj || '')}`).then((data) => { setItems(data.items); setError('') }).catch((caught) => setError(caught.message)), 200)
    return () => clearTimeout(timer)
  }, [kind, query, cnpj, open])
  const pattern = { cnae: /^\d{4}-\d\/\d{2}$/, nbs: /^\d\.\d{4}\.\d{2}\.\d{2}$/, ncm: /^\d{4}\.\d{2}\.\d{2}$/ }[kind]
  const typed = query.trim()
  const choose = (item) => { onChange(item); setQuery(''); setOpen(false) }
  return <div className="fiscal-picker">
    <label>{label}<span className="fiscal-picker-search"><Search size={15} aria-hidden="true" /><input role="combobox" aria-expanded={open} aria-controls={listId} aria-label={label} value={query} placeholder={value ? 'Trocar código' : 'Busque por código ou descrição'} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} /></span></label>
    {open && <ul id={listId} role="listbox" className="fiscal-picker-list">
      {items.map((item) => <li key={item.code} role="option" aria-selected={value?.code === item.code}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}><strong>{item.code}</strong><span>{item.description}{item.group ? <small>{item.group}</small> : null}</span>{kind === 'cnae' && (item.registered ? <em className="fiscal-badge fiscal-badge--ok">No CNPJ</em> : <em className="fiscal-badge fiscal-badge--warn">Fora do CNPJ</em>)}</button></li>)}
      {!items.length && pattern.test(typed) && <li role="option" aria-selected="false"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose({ code: typed, description: '' })}><strong>{typed}</strong><span>Usar o código digitado</span></button></li>}
      {!items.length && !pattern.test(typed) && <li className="fiscal-picker-empty">{error || (query ? 'Nenhum código encontrado.' : 'Digite para buscar.')}</li>}
    </ul>}
    {value?.code ? <p className="fiscal-picker-value"><strong>{value.code}</strong><span>{value.description || 'Descrição não informada'}</span>{kind === 'cnae' && value.registered === false && <em className="fiscal-badge fiscal-badge--warn"><AlertTriangle size={13} aria-hidden="true" />Não registrado no CNPJ da emissora</em>}<button type="button" className="payable-link" onClick={() => onChange(null)}>Remover</button></p> : hint && <small className="payable-hint">{hint}</small>}
  </div>
}

const technicianOf = (issuer) => ({ name: issuer?.technician || '', registry: issuer?.technicianRegistry || '', phone: issuer?.technicianPhone || '' })

function LetterForm({ model, draft, setDraft, settings, catalog }) {
  const issuer = settings.issuers.find((item) => item.id === draft.issuerId)
  const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  const setItem = (index, field, value) => setDraft((current) => ({ ...current, items: current.items.map((item, position) => position === index ? { ...item, [field]: value } : item) }))
  const total = letterTotal({ items: draft.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) || 0 })) })
  const registered = (code) => catalog?.companies?.find((company) => company.cnpj === issuer?.cnpj.replace(/\D/g, ''))?.activities?.some((row) => row.code === code)
  const scopeText = draft.scope.join('\n')
  return <div className="proposal-doc-form">
    <section className="proposal-doc-section"><h3>Identificação</h3><div className="proposal-doc-grid">
      <label>Empresa emissora<select aria-label="Empresa emissora" value={draft.issuerId} onChange={(event) => { const next = settings.issuers.find((item) => item.id === event.target.value); const keep = JSON.stringify(draft.technician) !== JSON.stringify(technicianOf(issuer)); setDraft((current) => ({ ...current, issuerId: event.target.value, technician: keep ? current.technician : technicianOf(next) })) }}>{settings.issuers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.cnpj}</option>)}</select></label>
      <label>Data<input type="date" required value={draft.date} onChange={(event) => set('date', event.target.value)} /></label>
      <label>Nº da cotação<input required maxLength={20} value={draft.quoteNumber} onChange={(event) => set('quoteNumber', event.target.value)} /></label>
      <label className="proposal-doc-wide">Cliente (À)<input required maxLength={160} value={draft.customer} onChange={(event) => set('customer', event.target.value)} /></label>
      <label>CNPJ do cliente<input maxLength={20} value={draft.customerDocument || ''} onChange={(event) => set('customerDocument', event.target.value)} /></label>
      <label>Solicitante<input maxLength={80} value={draft.requester} onChange={(event) => set('requester', event.target.value)} /></label>
      <label>Aos cuidados de<input maxLength={80} value={draft.attention} onChange={(event) => set('attention', event.target.value)} /></label>
    </div></section>
    <section className="proposal-doc-section proposal-fiscal"><h3><BadgeCheck size={17} aria-hidden="true" />CNAE – Código de atividade – NCM/NBS</h3>
      <div className="proposal-doc-grid proposal-doc-grid--fiscal">
        <FiscalPicker kind="cnae" label="CNAE (código de atividade)" cnpj={issuer?.cnpj} value={draft.fiscal.cnae && { ...draft.fiscal.cnae, registered: draft.fiscal.cnae.registered ?? registered(draft.fiscal.cnae.code) }} onChange={(value) => set('fiscal', { ...draft.fiscal, cnae: value })} />
        <FiscalPicker kind="nbs" label="NBS (serviço)" value={draft.fiscal.nbs} onChange={(value) => set('fiscal', { ...draft.fiscal, nbs: value })} hint="Nomenclatura Brasileira de Serviços, exigida na NFS-e." />
        <FiscalPicker kind="ncm" label="NCM (produto)" value={draft.fiscal.ncm} onChange={(value) => set('fiscal', { ...draft.fiscal, ncm: value })} hint="Para peças vendidas como produto." />
      </div>
    </section>
    <section className="proposal-doc-section"><h3>1. Refere-se e 2. Escopo</h3>
      <label>Objeto da proposta<span className="proposal-doc-prefix">Submetemos à apreciação de V.S.ª a presente proposta para</span><input required maxLength={300} value={draft.subject} onChange={(event) => set('subject', event.target.value)} /></label>
      <label>Escopo (um tópico por linha){model === 'model-b' ? ' · numerado' : ' · em tópicos'}<textarea rows={Math.min(10, Math.max(3, draft.scope.length + 1))} value={scopeText} onChange={(event) => set('scope', event.target.value.split('\n'))} /></label>
    </section>
    <section className="proposal-doc-section"><div className="proposal-doc-heading"><h3>3. Composição e preço global</h3>{model === 'model-b' && <div className="proposal-doc-tools"><button type="button" className="admin-tool-button" onClick={() => set('items', [...draft.items, { description: '', quantity: 1, unit: 'Un', unitPrice: '', group: draft.items.at(-1)?.group || '' }])}><Plus size={16} />Adicionar item</button></div>}</div>
      {model === 'model-b' && <p className="payable-hint">Itens com o mesmo grupo (ex.: Obra civil, Estrutura metálica) aparecem juntos com subtotal. Deixe em branco para não agrupar.</p>}
      <div className="proposal-items">{draft.items.map((item, index) => <div className={`proposal-item ${model === 'model-b' ? 'proposal-item--grouped' : ''}`} key={index}>
        <strong>3.{index + 1}</strong>
        {model === 'model-b' && <label>Grupo<input maxLength={60} value={item.group || ''} placeholder="Opcional" onChange={(event) => setItem(index, 'group', event.target.value)} /></label>}
        <label>Descrição<input required maxLength={300} value={item.description} onChange={(event) => setItem(index, 'description', event.target.value)} /></label>
        <label>Quantidade<QuantityInput label={`Quantidade do item ${index + 1}`} value={item.quantity} onChange={(value) => setItem(index, 'quantity', value)} /></label>
        <label>Unidade<select aria-label={`Unidade do item ${index + 1}`} value={item.unit === 'kg' ? 'kg' : 'Un'} onChange={(event) => setItem(index, 'unit', event.target.value)}><option value="Un">Unidade</option><option value="kg">Kg</option></select></label>
        <label>Valor unitário<MoneyInput aria-label={`Valor unitário do item ${index + 1}`} value={item.unitPrice} onChange={(value) => setItem(index, 'unitPrice', value)} /></label>
        <span className="proposal-item-total">{money(itemTotal({ ...item, unitPrice: Number(item.unitPrice) || 0 }))}</span>
        {model === 'model-b' && <button type="button" className="payable-icon" aria-label={`Remover item ${index + 1}`} disabled={draft.items.length < 2} onClick={() => set('items', draft.items.filter((_, position) => position !== index))}><Trash2 size={16} /></button>}
      </div>)}</div>
      <p className="proposal-doc-total">Preço global: <strong>{money(total)}</strong></p>
    </section>
    <section className="proposal-doc-section"><h3>4. Prazos e condições</h3><div className="proposal-doc-grid">
      <label>Prazo de entrega<input maxLength={200} value={draft.deliveryTerm} onChange={(event) => set('deliveryTerm', event.target.value)} placeholder="Ex.: 15 dias úteis" /></label>
      <label className="proposal-doc-wide">Pagamento<input maxLength={300} value={draft.payment} onChange={(event) => set('payment', event.target.value)} placeholder="Ex.: 45 DDL" /></label>
      <label>Validade (dias)<input type="number" min={1} max={365} value={draft.validityDays} onChange={(event) => set('validityDays', event.target.value)} /></label>
    </div></section>
    <section className="proposal-doc-section"><div className="proposal-doc-heading"><h3>Técnico responsável</h3><button type="button" className="payable-link" onClick={() => set('technician', technicianOf(issuer))}>Usar o padrão da empresa</button></div>
      <p className="payable-hint">Aparece no fim da proposta. Vem do cadastro da empresa emissora; a alteração vale só para esta proposta. Deixe em branco para não exibir.</p>
      <div className="proposal-doc-grid">
        <label>Técnico responsável<input maxLength={120} value={draft.technician?.name || ''} onChange={(event) => set('technician', { ...draft.technician, name: event.target.value })} /></label>
        <label>Registro (CREA)<input maxLength={60} value={draft.technician?.registry || ''} onChange={(event) => set('technician', { ...draft.technician, registry: event.target.value })} /></label>
        <label>Contato<input maxLength={40} value={draft.technician?.phone || ''} onChange={(event) => set('technician', { ...draft.technician, phone: event.target.value })} /></label>
      </div>
    </section>
  </div>
}

function TableForm({ model, draft, setDraft, settings, assignments, setAssignments }) {
  const table = settings.tables[model]
  const [filled, setFilled] = useState(false)
  const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  const rowsOf = (kind) => (kind === 'labor' ? table.labor : table.materials).map((row) => ({ ...row, ...draft[kind].find((entry) => entry.id === row.id) }))
  const document = { labor: rowsOf('labor'), materials: rowsOf('materials'), freight: model === 'etiqueta' ? { ...draft.freight, places: table.freight } : undefined }
  const totals = tableTotals(document)
  const update = (kind, id, change) => set(kind, draft[kind].map((row) => row.id === id ? { ...row, ...change } : row))
  // Moving a system record to another line moves its quantity with it.
  function assign(item, rowId) {
    const kind = item.kind === 'labor' ? 'labor' : 'materials'
    const previous = assignments[item.id] ?? item.rowId
    setDraft((current) => ({ ...current, [kind]: current[kind].map((row) => {
      let quantityValue = Number(row.quantity) || 0
      if (row.id === previous) quantityValue = Math.max(0, Math.round((quantityValue - item.quantity) * 100) / 100)
      if (row.id === rowId) quantityValue = Math.round((quantityValue + item.quantity) * 100) / 100
      return { ...row, quantity: quantityValue || null }
    }) }))
    setAssignments({ ...assignments, [item.id]: rowId || null })
  }
  const visible = (rows) => filled ? rows.filter((row) => Number(row.quantity)) : rows
  return <div className="proposal-doc-form">
    <section className="proposal-doc-section"><h3>{model === 'nestle' ? 'Dados da solicitação (células amarelas)' : 'Identificação da etiqueta'}</h3><div className="proposal-doc-grid">
      <label>Empresa emissora<select aria-label="Empresa emissora" value={draft.issuerId} onChange={(event) => { const issuer = settings.issuers.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, issuerId: event.target.value, contact: issuer.contact })) }}>{settings.issuers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.cnpj}</option>)}</select></label>
      <label>Data<input type="date" required value={draft.date} onChange={(event) => set('date', event.target.value)} /></label>
      {model === 'nestle' ? <label>Nº da solicitação<input required maxLength={40} value={draft.number} onChange={(event) => set('number', event.target.value)} /></label> : <label>Etiqueta<input required maxLength={40} value={draft.labelNumber} onChange={(event) => set('labelNumber', event.target.value)} /></label>}
      {model === 'etiqueta' && <><label className="proposal-doc-wide">Nome do componente<input required maxLength={120} value={draft.componentName} onChange={(event) => set('componentName', event.target.value)} /></label>
        <label>Equipamento<input maxLength={120} value={draft.equipment} onChange={(event) => set('equipment', event.target.value)} /></label>
        <label>Componente<input maxLength={120} value={draft.component} onChange={(event) => set('component', event.target.value)} /></label>
        <label>Responsável<input maxLength={80} value={draft.responsible} onChange={(event) => set('responsible', event.target.value)} /></label></>}
      <label>{model === 'nestle' ? 'Solicitante' : 'Requisitante'}<input maxLength={80} value={draft.requester} onChange={(event) => set('requester', event.target.value)} /></label>
      <label>Quantidade<span className="proposal-doc-inline"><QuantityInput label="Quantidade de peças" value={draft.quantity} onChange={(value) => set('quantity', value)} />{model === 'nestle' && <input aria-label="Unidade" maxLength={10} value={draft.quantityUnit} onChange={(event) => set('quantityUnit', event.target.value)} />}</span></label>
      <label>Nome para contato<input maxLength={80} value={draft.contact} onChange={(event) => set('contact', event.target.value)} /></label>
      <label className="proposal-doc-full">Descrição do serviço<textarea rows={2} required maxLength={600} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
    </div></section>
    {draft.usage?.length > 0 && <section className="proposal-doc-section proposal-usage"><h3>Registrado no sistema (previsto na oferta)</h3>
      <p className="payable-hint">Cada registro foi lançado na linha correspondente da planilha. Troque a linha quando precisar; a escolha fica lembrada para as próximas.</p>
      <ul>{draft.usage.map((item) => { const rowId = item.id in assignments ? assignments[item.id] : item.rowId; return <li key={item.id} className={rowId ? '' : 'proposal-usage--pending'}>
        <span><strong>{item.name}</strong><small>{decimal(item.quantity)} {item.unit} · {item.source}</small></span>
        <label>Lançar em<select aria-label={`Linha da planilha para ${item.name}`} value={rowId || ''} onChange={(event) => assign(item, event.target.value)}><option value="">Não lançar</option>{(item.kind === 'labor' ? table.labor : table.materials).map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.description}</option>)}</select></label>
      </li> })}</ul>
    </section>}
    <section className="proposal-doc-section"><div className="proposal-doc-heading"><h3>Mão de obra</h3><label className="proposal-doc-check"><input type="checkbox" checked={filled} onChange={(event) => setFilled(event.target.checked)} />Mostrar só linhas preenchidas</label></div>
      <div className="proposal-table-wrap"><table className="proposal-table"><thead><tr><th>Item</th>{model === 'nestle' && <th>Código SAP</th>}<th>Descrição</th><th>Normal</th><th>Noturna/sáb.</th><th>Dom./feriado</th><th>Situação</th><th>Quantidade (h)</th><th>Total</th></tr></thead>
        <tbody>{visible(document.labor).map((row) => { const index = table.labor.findIndex((item) => item.id === row.id); return <tr key={row.id}><td>{index + 1}</td>{model === 'nestle' && <td>{row.sap}</td>}<td>{row.description}</td><td>{money(row.normal)}</td><td>{row.night == null ? '—' : money(row.night)}</td><td>{row.holiday == null ? '—' : money(row.holiday)}</td>
          <td><select aria-label={`Situação de ${row.description}`} value={row.situation || 'normal'} onChange={(event) => update('labor', row.id, { situation: event.target.value })}>{Object.entries(situationNames).filter(([key]) => key === 'normal' || row[key] != null).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
          <td className="proposal-yellow"><QuantityInput label={`Horas de ${row.description}`} value={row.quantity} onChange={(value) => update('labor', row.id, { quantity: value })} /></td><td>{money(totals.labor[document.labor.indexOf(row)])}<small>{money(rateFor(row))}/h</small></td></tr> })}</tbody></table></div>
    </section>
    <section className="proposal-doc-section"><h3>Materiais</h3>
      <div className="proposal-table-wrap"><table className="proposal-table"><thead><tr><th>Item</th>{model === 'nestle' && <th>Código SAP</th>}<th>Descrição</th><th>Unidade</th><th>Valor unitário</th><th>Quantidade</th><th>Total</th></tr></thead>
        <tbody>{visible(document.materials).map((row) => { const index = table.materials.findIndex((item) => item.id === row.id); return <tr key={row.id}><td>{index + 1}</td>{model === 'nestle' && <td>{row.sap}</td>}<td>{row.description}</td><td>{row.unit}</td><td>{money(row.price)}</td><td className="proposal-yellow"><QuantityInput label={`Quantidade de ${row.description}`} value={row.quantity} onChange={(value) => update('materials', row.id, { quantity: value })} /></td><td>{money(totals.materials[document.materials.indexOf(row)])}</td></tr> })}</tbody></table></div>
    </section>
    {model === 'etiqueta' && <section className="proposal-doc-section"><h3>Frete</h3><div className="proposal-doc-grid">
      <label>Local<select aria-label="Local do frete" value={draft.freight.place} onChange={(event) => set('freight', { ...draft.freight, place: event.target.value })}><option value="">Sem local</option>{table.freight.map((place) => <option key={place.name} value={place.name}>{place.name} · {money(place.value)}</option>)}</select></label>
      <label className="proposal-doc-check"><input type="checkbox" checked={Boolean(draft.freight.charge)} disabled={!draft.freight.place} onChange={(event) => set('freight', { ...draft.freight, charge: event.target.checked })} />Cobrar o frete deste local</label>
    </div></section>}
    <section className="proposal-doc-section"><label>Observação (faixa vermelha)<input maxLength={200} value={draft.observation} onChange={(event) => set('observation', event.target.value)} /></label></section>
    <div className="proposal-doc-totals" aria-live="polite"><span>Serviços<strong>{money(totals.laborTotal)}</strong></span><span>Materiais<strong>{money(totals.materialsTotal)}</strong></span>{model === 'etiqueta' && <span>Frete<strong>{money(totals.freight)}</strong></span>}<span className="proposal-doc-totals-main">Total do contrato<strong>{money(totals.total)}</strong></span></div>
  </div>
}

// Generates the proposal of an offer in one of the commercial team's models.
export default function ProposalDocumentModal({ offer, option, onClose, onSaved }) {
  const saved = offer.proposal?.document
  const [model, setModel] = useState(null), [draft, setDraft] = useState(null), [settings, setSettings] = useState(null), [catalog, setCatalog] = useState(null)
  const [assignments, setAssignments] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [settingsOpen, setSettingsOpen] = useState(false)
  const formId = useId()
  const value = option ? Number(option.serviceValue || 0) * (1 - Number(option.discount || 0) / 100) : 0

  async function load(key, fresh = false) {
    setLoading(true); setError(''); setAssignments({})
    try {
      const query = `/offers/${offer.id}/proposal-draft?model=${key}&value=${value.toFixed(2)}&deadline=${encodeURIComponent(option?.deadline || '')}${fresh ? '&fresh=1' : ''}`
      const [data, status] = await Promise.all([payableRequest(query), payableRequest('/fiscal/status').catch(() => null)])
      const next = data.draft
      // Units are limited to unit and kg; older proposals with other units reopen as unit.
      if (next.items) next.items = next.items.map((item) => ({ ...item, unit: /^kg$/i.test(item.unit || '') ? 'kg' : 'Un', unitPrice: apiMoney(item.unitPrice) }))
      setDraft(next); setSettings(data.settings); setCatalog(status); setModel(key)
    } catch (caught) { setError(caught.message) } finally { setLoading(false) }
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    const document = draft.items ? { ...draft, scope: draft.scope.map((line) => line.trim()).filter(Boolean), items: draft.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) || 0 })) } : draft
    const learned = Object.entries(assignments).map(([id, rowId]) => ({ name: draft.usage.find((item) => item.id === id)?.name, rowId })).filter((item) => item.name && item.rowId)
    try {
      const result = await payableRequest(`/offers/${offer.id}/proposal-document`, 'POST', { model, document, option, assignments: learned })
      await onSaved(result.item, model)
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }

  const current = proposalModels.find((item) => item.key === model)
  const footer = model ? <><button className="admin-tool-button" type="button" disabled={busy} onClick={() => { setModel(null); setDraft(null) }}><ArrowLeft size={16} />Trocar modelo</button><button className="admin-tool-button" type="button" disabled={busy} onClick={() => load(model, true)}>Recomeçar com dados do sistema</button><button className="admin-tool-button admin-tool-button--primary" form={formId} type="submit" disabled={busy}><FileText size={16} />{busy ? 'Gerando...' : 'Gerar PDF'}</button></> : <button className="admin-tool-button" type="button" onClick={onClose}>Cancelar</button>
  // Rendered at the document root so the screen that opens it cannot restyle the form.
  return createPortal(<>
    <PayableModal title={model ? `Proposta · ${current.title}` : 'Escolha o modelo da proposta'} className="proposal-doc-modal" wide busy={busy} onClose={onClose} footer={footer}>
      {!model ? <div className="proposal-model-step">
        <p>Selecione o modelo do documento que será enviado ao cliente. Os dados do sistema já vêm preenchidos.</p>
        {saved && <p className="proposal-model-saved">Último documento gerado: <strong>{modelLabel(saved)}</strong> · {money(saved.total)}</p>}
        <div className="proposal-model-grid">{proposalModels.map((item) => <button key={item.key} type="button" className={`proposal-model-card proposal-model-card--${item.key}`} disabled={loading} onClick={() => load(item.key)}><span className="proposal-model-thumb" aria-hidden="true"><i /><i /><i /><i /></span><strong>{item.title}</strong><span>{item.subtitle}</span><small>{item.example}</small></button>)}</div>
        <button type="button" className="payable-link proposal-settings-link" onClick={() => setSettingsOpen(true)}><Settings size={14} aria-hidden="true" />Empresas, tabelas de preço e catálogo fiscal</button>
        {loading && <p className="payable-hint" role="status">Carregando dados do sistema...</p>}
        {error && <p className="admin-tool-error" role="alert">{error}</p>}
      </div> : <form id={formId} onSubmit={submit}><fieldset disabled={busy}>
        {draft.items ? <LetterForm model={model} draft={draft} setDraft={setDraft} settings={settings} catalog={catalog} /> : <TableForm model={model} draft={draft} setDraft={setDraft} settings={settings} assignments={assignments} setAssignments={setAssignments} />}
        {error && <p className="admin-tool-error" role="alert">{error}</p>}
      </fieldset></form>}
    </PayableModal>
    {settingsOpen && <ProposalSettingsModal onClose={() => setSettingsOpen(false)} />}
  </>, document.body)
}
