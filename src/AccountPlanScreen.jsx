import { useEffect, useId, useState } from 'react'
import { Plus, Pencil, Power, Trash2, Save } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import { PayableModal } from './PayableModal.jsx'
import { ConfirmAction } from './PayablesScreen.jsx'
import { RegistryToolbar, SortHeader, useRegistryList } from './RegistryList.jsx'
import ClassificationSelect from './ClassificationSelect.jsx'
import { payableRequest } from './payablesApi.js'
import { dreLines, behaviors, automaticSettings, natureOf, compareCodes } from '../server/accountPlanRules.js'
import './payables.css'
import './dre.css'

const natureHint = { revenue: 'Receita: aparece em Contas a Receber e nas entradas da Tesouraria.', expense: 'Despesa: aparece em Contas a Pagar e nas saídas da Tesouraria.', both: 'Fora do resultado: aparece nas entradas e nas saídas, sem entrar no lucro da DRE.' }
const usageText = (usage = {}) => [[usage.payables, 'a pagar'], [usage.receivables, 'a receber'], [usage.adjustments, usage.adjustments === 1 ? 'ajuste' : 'ajustes']].filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · ') || '—'
// The next free code of a group: 1.27 after 1.26.
const nextCode = (group, items) => `${group.code}.${String(Math.max(0, ...items.filter((item) => item.groupId === group.id).map((item) => Number(item.code.split('.')[1]) || 0)) + 1).padStart(2, '0')}`

function GroupForm({ source, onClose, onSaved }) {
  const id = useId(), [draft, setDraft] = useState({ code: source?.code || '', name: source?.name || '', dreLine: source?.dreLine || 'operating' }), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await payableRequest(source ? `/account-groups/${source.id}` : '/account-groups', source ? 'PUT' : 'POST', { ...source, ...draft }); await onSaved() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  return <PayableModal title={source ? `Editar grupo ${source.code}` : 'Novo grupo de contas'} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}><Save size={16} />Salvar</button></>}>
    <form id={id} className="payable-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Código<input aria-label="Código" required inputMode="numeric" maxLength={2} pattern="\d{1,2}" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.replace(/\D/g, '') })} autoFocus />{source && draft.code !== source.code && source.count > 0 && <small className="payable-hint">As {source.count} classificações do grupo serão renumeradas ({source.code}.01 passa a {draft.code || '?'}.01).</small>}</label>
      <label>Nome do grupo<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="payable-form-wide">Linha da DRE<select aria-label="Linha da DRE" value={draft.dreLine} onChange={(event) => setDraft({ ...draft, dreLine: event.target.value })}>{Object.entries(dreLines).map(([key, line]) => <option key={key} value={key}>{line.label}</option>)}</select><small className="payable-hint">{natureHint[natureOf({ dreLine: draft.dreLine })]} As novas classificações do grupo começam nesta linha{source ? '; mudar a linha também move as classificações que seguem a linha atual do grupo' : ''}.</small></label>
      {error && <p className="admin-tool-error payable-form-wide" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

function ClassificationForm({ source, groups, items, onClose, onSaved }) {
  const id = useId()
  const [draft, setDraft] = useState(() => ({ groupId: source?.groupId || '', code: source?.code || '', name: source?.name || '', behavior: source?.behavior || 'variable', dreLine: source?.dreLine || '' })), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const group = groups.find((row) => row.id === draft.groupId)
  // Choosing the group fills the next free code and the group's line, unless they were already set for that group.
  function chooseGroup(groupId) {
    const next = groups.find((row) => row.id === groupId)
    if (!next) return setDraft({ ...draft, groupId })
    const ownCode = source && source.groupId === groupId ? source.code : nextCode(next, items)
    setDraft({ ...draft, groupId, code: draft.code.startsWith(`${next.code}.`) ? draft.code : ownCode, dreLine: source && source.groupId === groupId ? source.dreLine : next.dreLine })
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await payableRequest(source ? `/classifications/${source.id}` : '/classifications', source ? 'PUT' : 'POST', { ...draft, dreLine: draft.dreLine || group?.dreLine }); await onSaved() } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  const usage = source?.usage && usageText(source.usage)
  return <PayableModal title={source ? `Editar ${source.code} · ${source.name}` : 'Nova classificação'} busy={busy} onClose={onClose} footer={<><button className="admin-tool-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={id} disabled={busy}><Save size={16} />Salvar</button></>}>
    <form id={id} className="payable-form" onSubmit={save}><fieldset disabled={busy}>
      <label className="payable-form-wide">Grupo de contas<select aria-label="Grupo de contas" required value={draft.groupId} onChange={(event) => chooseGroup(event.target.value)} autoFocus={!source}><option value="">Selecione o grupo</option>{groups.filter((row) => !row.inactive || row.id === draft.groupId).map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}{row.inactive ? ' (D)' : ''}</option>)}</select><small className="payable-hint">Toda classificação pertence a um grupo de contas.</small></label>
      <label>Código<input aria-label="Código" required maxLength={5} pattern="\d{1,2}\.\d{2}" placeholder={group ? nextCode(group, items) : 'N.NN'} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.replace(/[^\d.]/g, '') })} /><small className="payable-hint">{group ? `Começa por ${group.code}. (ex.: ${nextCode(group, items)}).` : 'Formato N.NN, começando pelo número do grupo.'}</small></label>
      <label>Fixo / variável<select aria-label="Fixo / variável" value={draft.behavior} onChange={(event) => setDraft({ ...draft, behavior: event.target.value })}>{Object.entries(behaviors).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="payable-form-wide">Nome da classificação<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="payable-form-wide">Linha da DRE<select aria-label="Linha da DRE" value={draft.dreLine || group?.dreLine || ''} disabled={!group} onChange={(event) => setDraft({ ...draft, dreLine: event.target.value })}>{!group && <option value="">Escolha o grupo primeiro</option>}{Object.entries(dreLines).map(([key, line]) => <option key={key} value={key}>{line.label}{group?.dreLine === key ? ' (padrão do grupo)' : ''}</option>)}</select>{group && <small className="payable-hint">{natureHint[natureOf({ dreLine: draft.dreLine || group.dreLine })]}</small>}</label>
      {usage && usage !== '—' && <p className="payable-hint payable-form-wide">Em uso: {usage}.</p>}
      {error && <p className="admin-tool-error payable-form-wide" role="alert">{error}</p>}
    </fieldset></form>
  </PayableModal>
}

// Classifications that the receipts and payments fill on their own (ISS, interest, discounts).
function AutomaticSettings({ settings, items, onSaved }) {
  const [draft, setDraft] = useState(settings), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => setDraft(settings), [settings])
  const changed = automaticSettings.some(([key]) => draft[key] !== settings[key])
  async function save() { setBusy(true); setError(''); setNotice(''); try { await payableRequest('/account-groups/settings', 'PUT', draft); await onSaved(); setNotice('Classificações automáticas salvas.') } catch (caught) { setError(caught.message) } finally { setBusy(false) } }
  return <section className="account-plan-settings"><h2>Classificações automáticas</h2><p className="payable-muted">Na baixa de uma conta, estes valores saem da classificação da conta e vão para a classificação escolhida aqui.</p>
    <div className="account-plan-settings-grid">{automaticSettings.map(([key, label, nature]) => <label key={key}>{label}<ClassificationSelect classifications={items.filter((item) => item.nature === nature)} use="adjustment" keep={[draft[key]].filter(Boolean)} label={label} value={draft[key] || ''} disabled={busy} onChange={(value) => setDraft({ ...draft, [key]: value })} /></label>)}</div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}{notice && <p className="treasury-notice" role="status">{notice}</p>}
    <button className="admin-tool-button admin-tool-button--primary" type="button" disabled={busy || !changed} onClick={save}><Save size={16} />Salvar classificações automáticas</button>
  </section>
}

// Grupos de contas and Classificações: the plan of accounts behind the payables, the receivables and the DRE.
export default function AccountPlanScreen({ mode = 'classifications', ...props }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [form, setForm] = useState(null), [confirm, setConfirm] = useState(null), [groupFilter, setGroupFilter] = useState('')
  const load = () => payableRequest('/classifications').then((result) => { setData(result); setError('') })
  useEffect(() => { load().catch((caught) => setError(caught.message)) }, [])
  // A classification without its usage (an answer of an older server) counts as unused instead of breaking the screen.
  const groups = data?.groups || [], items = (data?.items || []).map((row) => ({ ...row, usage: { payables: 0, receivables: 0, adjustments: 0, ...row.usage } }))
  const columns = [{ key: 'code', label: 'Código', value: (row) => row.code, search: true }, { key: 'name', label: 'Classificação', value: (row) => row.name, search: true }, { key: 'dreLine', label: 'Linha da DRE', value: (row) => dreLines[row.dreLine]?.label, search: true }, { key: 'behavior', label: 'Fixo / variável', value: (row) => behaviors[row.behavior] || '', search: true }, { key: 'usage', label: 'Lançamentos', value: (row) => row.usage.payables + row.usage.receivables + row.usage.adjustments, numeric: true }, { key: 'status', label: 'Status', value: (row) => row.inactive ? 'Desativada' : 'Ativa' }]
  const list = useRegistryList(items.filter((row) => !groupFilter || row.groupId === groupFilter), columns, 'code')
  const toggle = (kind, row) => setConfirm({ title: `${row.inactive ? 'Reativar' : 'Desativar'} ${kind === 'group' ? 'grupo' : 'classificação'}`, text: `${row.code} · ${row.name}${!row.inactive ? kind === 'group' ? ' deixa de aparecer em novos lançamentos, com todas as suas classificações.' : ' deixa de aparecer em novos lançamentos; os lançamentos que já a usam continuam com ela.' : ''}`, onConfirm: async () => { await payableRequest(`/${kind === 'group' ? 'account-groups' : 'classifications'}/${row.id}`, 'PUT', { inactive: !row.inactive }); await load(); setConfirm(null) } })
  const remove = (kind, row) => setConfirm({ title: `Excluir ${kind === 'group' ? 'grupo' : 'classificação'}`, text: `${row.code} · ${row.name}`, onConfirm: async () => { await payableRequest(`/${kind === 'group' ? 'account-groups' : 'classifications'}/${row.id}`, 'DELETE'); await load(); setConfirm(null) } })
  const actions = (kind, row) => <div className="payable-registry-actions">
    <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${row.name}`} onClick={() => setForm({ kind, source: row })}><Pencil size={16} /></button>
    <button className={`payable-icon${row.inactive ? ' payable-icon--inactive' : ''}`} type="button" title={row.inactive ? 'Reativar' : 'Desativar'} aria-label={`${row.inactive ? 'Reativar' : 'Desativar'} ${row.name}`} onClick={() => toggle(kind, row)}><Power size={16} /></button>
    <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${row.name}`} onClick={() => remove(kind, row)}><Trash2 size={16} /></button>
  </div>
  // Sorted by code, the classifications are shown under their groups.
  const byGroup = list.sort.key === 'code' ? [...groups].sort((a, b) => compareCodes(a.code, b.code) * list.sort.direction).map((group) => [group, list.rows.filter((row) => row.groupId === group.id)]).filter(([, rows]) => rows.length) : [[null, list.rows]]
  return <AdminWorkspace {...props} title={mode === 'groups' ? 'Grupos de contas' : 'Classificações'}>
    <div className="payable-heading-actions"><button className="admin-tool-button admin-tool-button--primary" type="button" disabled={!data} onClick={() => setForm({ kind: mode === 'groups' ? 'group' : 'classification' })}><Plus size={17} />{mode === 'groups' ? 'Novo grupo' : 'Nova classificação'}</button></div>
    {error && <p className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" type="button" onClick={() => load().catch((caught) => setError(caught.message))}>Tentar novamente</button></p>}
    {!data ? !error && <p>Carregando...</p> : mode === 'groups' ? <>
      <p className="payable-muted account-plan-intro">Cada classificação pertence a um grupo de contas, e cada grupo indica em que linha da DRE suas classificações entram.</p>
      <div className="payable-table-scroll"><table className="payable-table payable-registry-table account-plan-table"><thead><tr><th className="account-plan-code">Código</th><th>Grupo de contas</th><th>Linha da DRE</th><th className="simple-registry-count">Classificações</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {groups.map((row) => <tr key={row.id} className={row.inactive ? 'account-plan-row--inactive' : ''}><td className="account-plan-code" data-label="Código">{row.code}</td><td data-label="Grupo de contas"><strong>{row.name}</strong></td><td data-label="Linha da DRE">{dreLines[row.dreLine]?.label}</td><td className="simple-registry-count" data-label="Classificações">{row.count}</td><td data-label="Status">{row.inactive ? 'Desativado' : 'Ativo'}</td><td>{actions('group', row)}</td></tr>)}
        {!groups.length && <tr><td colSpan={6} className="payable-empty">Nenhum grupo cadastrado.</td></tr>}
      </tbody></table></div>
      <AutomaticSettings settings={data.settings} items={items} onSaved={load} />
    </> : <>
      <div className="account-plan-toolbar"><RegistryToolbar list={list} total={items.length} singular="classificação" plural="classificações" placeholder="Código, nome ou linha da DRE" /><label>Grupo de contas<select aria-label="Filtrar por grupo de contas" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">Todos os grupos</option>{groups.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label></div>
      <div className="payable-table-scroll"><table className="payable-table payable-registry-table account-plan-table"><thead><tr>{columns.map((column) => <SortHeader key={column.key} column={column} list={list} className={column.key === 'code' ? 'account-plan-code' : column.key === 'usage' ? 'simple-registry-count' : undefined} />)}<th>Ações</th></tr></thead>
        {byGroup.map(([group, rows]) => <tbody key={group?.id || 'all'}>
          {group && <tr className="account-plan-group-row"><th colSpan={7} scope="rowgroup">{group.code} · {group.name}<small>{rows.length} {rows.length === 1 ? 'classificação' : 'classificações'}{group.inactive ? ' · grupo desativado' : ''}</small></th></tr>}
          {rows.map((row) => <tr key={row.id} className={row.inactive || row.groupInactive ? 'account-plan-row--inactive' : ''}><td className="account-plan-code" data-label="Código">{row.code}</td><td data-label="Classificação">{row.name}{row.inactive ? ' (D)' : ''}</td><td data-label="Linha da DRE">{dreLines[row.dreLine]?.label}</td><td data-label="Fixo / variável">{behaviors[row.behavior] || '—'}</td><td className="simple-registry-count" data-label="Lançamentos">{usageText(row.usage)}</td><td data-label="Status">{row.inactive ? 'Desativada' : 'Ativa'}</td><td>{actions('classification', row)}</td></tr>)}
        </tbody>)}
        {!list.rows.length && <tbody><tr><td colSpan={7} className="payable-empty">{items.length ? 'Nenhuma classificação encontrada.' : 'Nenhuma classificação cadastrada.'}</td></tr></tbody>}
      </table></div>
    </>}
    {form?.kind === 'group' && <GroupForm source={form.source} onClose={() => setForm(null)} onSaved={async () => { await load(); setForm(null) }} />}
    {form?.kind === 'classification' && <ClassificationForm source={form.source} groups={groups} items={items} onClose={() => setForm(null)} onSaved={async () => { await load(); setForm(null) }} />}
    {confirm && <ConfirmAction {...confirm} onClose={() => setConfirm(null)}><p>{confirm.text}</p></ConfirmAction>}
  </AdminWorkspace>
}
