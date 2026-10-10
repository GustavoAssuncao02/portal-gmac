import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import MoneyInput from './MoneyInput.jsx'
import { payableRequest } from './payablesApi.js'

const tabs = [['issuers', 'Empresas'], ['nestle', 'Tabela Nestlé (FS-3055)'], ['etiqueta', 'Tabela Etiqueta'], ['texts', 'Textos padrão'], ['catalog', 'Catálogo fiscal']]
const issuerFields = [['letterName', 'Nome na carta'], ['tradeName', 'Nome fantasia'], ['legalName', 'Razão social'], ['address', 'Endereço'], ['zip', 'CEP'], ['city', 'Cidade'], ['state', 'UF'], ['phone', 'Telefone'], ['email', 'E-mail'], ['website', 'Site'], ['whatsapp', 'WhatsApp (rodapé das propostas)'], ['contact', 'Nome para contato'], ['technician', 'Técnico responsável'], ['technicianRegistry', 'Registro (CREA)'], ['technicianPhone', 'Contato do técnico']]
const toApi = (value) => value == null || value === '' ? '' : Number(value).toFixed(2)
const dateText = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const formatCnpj = (value) => String(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

function PriceTable({ name, table, onChange }) {
  const sap = name === 'nestle'
  const setRow = (kind, index, field, value) => onChange({ ...table, [kind]: table[kind].map((row, position) => position === index ? { ...row, [field]: value } : row) })
  const remove = (kind, index) => onChange({ ...table, [kind]: table[kind].filter((_, position) => position !== index) })
  const add = (kind) => onChange({ ...table, [kind]: [...table[kind], kind === 'labor' ? { id: '', description: '', unit: table.labor[0]?.unit || 'H', normal: '', night: '', holiday: '' } : { id: '', description: '', unit: table.materials[0]?.unit || 'KG', price: '' }] })
  return <div className="proposal-settings-table">
    <p className="payable-hint">Os valores valem para os próximos documentos; os já gerados mantêm os valores da época.</p>
    <h3>Mão de obra (valor da hora)</h3>
    <div className="proposal-table-wrap"><table className="proposal-table proposal-table--edit"><thead><tr><th>#</th>{sap && <th>Código SAP</th>}<th>Descrição</th><th>Unidade</th><th>Normal</th><th>Noturna/sáb.</th><th>Dom./feriado</th><th /></tr></thead>
      <tbody>{table.labor.map((row, index) => <tr key={row.id || `new-${index}`}><td>{index + 1}</td>{sap && <td><input aria-label={`Código SAP da linha ${index + 1}`} value={row.sap || ''} onChange={(event) => setRow('labor', index, 'sap', event.target.value)} /></td>}<td><input required aria-label={`Descrição da linha ${index + 1}`} value={row.description} onChange={(event) => setRow('labor', index, 'description', event.target.value)} /></td><td><input required aria-label={`Unidade da linha ${index + 1}`} value={row.unit} onChange={(event) => setRow('labor', index, 'unit', event.target.value)} /></td>
        {['normal', 'night', 'holiday'].map((field) => <td key={field}><MoneyInput aria-label={`${{ normal: 'Hora normal', night: 'Hora noturna', holiday: 'Hora domingo/feriado' }[field]} da linha ${index + 1}`} value={toApi(row[field])} onChange={(value) => setRow('labor', index, field, value)} /></td>)}
        <td><button type="button" className="payable-icon" aria-label={`Remover linha ${index + 1}`} onClick={() => remove('labor', index)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
    <button type="button" className="admin-tool-button" onClick={() => add('labor')}><Plus size={15} />Adicionar serviço</button>
    <h3>Materiais (valor unitário)</h3>
    <div className="proposal-table-wrap"><table className="proposal-table proposal-table--edit"><thead><tr><th>#</th>{sap && <th>Código SAP</th>}<th>Descrição</th><th>Unidade</th><th>Valor unitário</th><th /></tr></thead>
      <tbody>{table.materials.map((row, index) => <tr key={row.id || `new-${index}`}><td>{index + 1}</td>{sap && <td><input aria-label={`Código SAP do material ${index + 1}`} value={row.sap || ''} onChange={(event) => setRow('materials', index, 'sap', event.target.value)} /></td>}<td><input required aria-label={`Descrição do material ${index + 1}`} value={row.description} onChange={(event) => setRow('materials', index, 'description', event.target.value)} /></td><td><input required aria-label={`Unidade do material ${index + 1}`} value={row.unit} onChange={(event) => setRow('materials', index, 'unit', event.target.value)} /></td>
        <td><MoneyInput aria-label={`Valor do material ${index + 1}`} value={toApi(row.price)} onChange={(value) => setRow('materials', index, 'price', value)} /></td>
        <td><button type="button" className="payable-icon" aria-label={`Remover material ${index + 1}`} onClick={() => remove('materials', index)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
    <button type="button" className="admin-tool-button" onClick={() => add('materials')}><Plus size={15} />Adicionar material</button>
    {table.freight && <><h3>Frete</h3><div className="proposal-doc-grid">{table.freight.map((place, index) => <div key={index} className="proposal-doc-inline"><label>Local {index + 1}<input required value={place.name} onChange={(event) => onChange({ ...table, freight: table.freight.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} /></label><label>Valor<MoneyInput aria-label={`Valor do frete ${index + 1}`} value={toApi(place.value)} onChange={(value) => onChange({ ...table, freight: table.freight.map((item, position) => position === index ? { ...item, value } : item) })} /></label></div>)}</div></>}
  </div>
}

export default function ProposalSettingsModal({ onClose }) {
  const [tab, setTab] = useState('issuers'), [settings, setSettings] = useState(null), [status, setStatus] = useState(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([payableRequest('/proposal-settings'), payableRequest('/fiscal/status')]).then(([data, fiscal]) => { setSettings(data.settings); setStatus(fiscal) }).catch((caught) => setError(caught.message))
  }, [])
  const update = (change) => { setSettings((current) => ({ ...current, ...change })); setMessage('') }
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const number = (value) => value === '' || value == null ? null : Number(value)
      const tables = Object.fromEntries(Object.entries(settings.tables).map(([key, table]) => [key, { ...table, labor: table.labor.map((row) => ({ ...row, normal: number(row.normal), night: number(row.night), holiday: number(row.holiday) })), materials: table.materials.map((row) => ({ ...row, price: number(row.price) })), ...(table.freight ? { freight: table.freight.map((place) => ({ ...place, value: number(place.value) })) } : {}) }]))
      const result = await payableRequest('/proposal-settings', 'PUT', { issuers: settings.issuers, tables, important: settings.important, observation: settings.observation, validityDays: Number(settings.validityDays), lastQuoteNumber: Number(settings.lastQuoteNumber) })
      setSettings(result.settings); setMessage('Configurações salvas.')
    } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  async function sync() {
    setBusy(true); setError(''); setMessage('')
    try { setStatus(await payableRequest('/fiscal/sync', 'POST', {})); setMessage('Catálogo fiscal atualizado.') } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const footer = <><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Fechar</button>{tab !== 'catalog' && <button className="admin-tool-button admin-tool-button--primary" type="submit" form="proposal-settings-form" disabled={busy || !settings}><Save size={16} />{busy ? 'Salvando...' : 'Salvar configurações'}</button>}</>
  return <PayableModal title="Modelos de proposta" className="proposal-doc-modal proposal-settings" wide busy={busy} onClose={onClose} footer={footer}>
    <div className="proposal-settings-tabs" role="tablist" aria-label="Configurações dos modelos">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
    {!settings ? <p className="payable-hint" role="status">{error || 'Carregando...'}</p> : <form id="proposal-settings-form" onSubmit={save}><fieldset disabled={busy}>
      {tab === 'issuers' && settings.issuers.map((issuer, position) => <section className="proposal-doc-section" key={issuer.id}><h3>{issuer.label} · CNPJ {issuer.cnpj}</h3><div className="proposal-doc-grid">{issuerFields.map(([field, label]) => <label key={field}>{label}<input value={issuer[field] || ''} onChange={(event) => update({ issuers: settings.issuers.map((item, index) => index === position ? { ...item, [field]: event.target.value } : item) })} /></label>)}</div></section>)}
      {(tab === 'nestle' || tab === 'etiqueta') && <PriceTable name={tab} table={settings.tables[tab]} onChange={(table) => update({ tables: { ...settings.tables, [tab]: table } })} />}
      {tab === 'texts' && <section className="proposal-doc-section"><div className="proposal-doc-grid">
        <label className="proposal-doc-full">Seção "6. Importante" dos modelos A e B (um parágrafo por linha; _texto_ fica em itálico)<textarea rows={8} value={settings.important.join('\n')} onChange={(event) => update({ important: event.target.value.split('\n') })} /></label>
        <label className="proposal-doc-full">Observação da Nestlé e da etiqueta<input value={settings.observation} onChange={(event) => update({ observation: event.target.value })} /></label>
        <label>Validade padrão (dias)<input type="number" min={1} max={365} value={settings.validityDays} onChange={(event) => update({ validityDays: event.target.value })} /></label>
        <label>Última cotação emitida<input type="number" min={0} value={settings.lastQuoteNumber} onChange={(event) => update({ lastQuoteNumber: event.target.value })} /><small className="payable-hint">A próxima proposta usa o número seguinte.</small></label>
      </div></section>}
    </fieldset></form>}
    {tab === 'catalog' && <section className="proposal-doc-section proposal-catalog">
      {status && <><dl className="proposal-catalog-facts"><div><dt>Última verificação</dt><dd>{dateText(status.checkedAt)}</dd></div><div><dt>Próxima atualização</dt><dd>{dateText(status.nextRun)}</dd></div><div><dt>CNAE</dt><dd>{status.counts.cnae.toLocaleString('pt-BR')}</dd></div><div><dt>NBS</dt><dd>{status.counts.nbs.toLocaleString('pt-BR')}</dd></div><div><dt>NCM</dt><dd>{status.counts.ncm.toLocaleString('pt-BR')}</dd></div></dl>
        <ul className="proposal-catalog-sources">{status.sources.map((source) => <li key={source.key} className={source.error ? 'proposal-catalog-error' : ''}><strong>{source.label}</strong><span>{source.error ? `Falhou em ${dateText(source.checkedAt)}: ${source.error}${source.updatedAt ? ` · mantida a versão de ${dateText(source.updatedAt)}` : ''}` : `Atualizado em ${dateText(source.updatedAt)}`}</span></li>)}</ul>
        {status.companies.map((company) => <div key={company.cnpj} className="proposal-catalog-company"><h3>{company.tradeName || company.legalName} · CNPJ {formatCnpj(company.cnpj)}</h3><ul>{company.activities.map((activity) => <li key={activity.code}><strong>{activity.code}</strong> {activity.description}{activity.primary && <em className="fiscal-badge fiscal-badge--ok">Principal</em>}</li>)}</ul></div>)}</>}
      <button type="button" className="admin-tool-button" disabled={busy} onClick={sync}><RefreshCw size={16} />{busy ? 'Atualizando (pode levar 1 minuto)...' : 'Atualizar agora'}</button>
    </section>}
    {message && <p className="proposal-success" role="status">{message}</p>}
    {error && settings && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
