import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Info, Search, Save, X, Wrench } from 'lucide-react'
import AdminWorkspace from './AdminWorkspace.jsx'
import SectorPicker from './SectorPicker.jsx'
import MachineHistoryModal from './MachineHistoryModal.jsx'
import { pollWhileVisible } from './polling.js'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
async function request(path, options = {}) {
  const response = await fetch(`/api/labor-services${path}`, { ...options, headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, ...options.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Não foi possível carregar os serviços.')
  return data
}
const loadHistory = (id, query, signal) => request(`/${encodeURIComponent(id)}/history?${query}`, { signal, cache: 'no-store' })

function ServiceDialog({ item, removing, onClose, onSave }) {
  const dialog = useRef(null)
  const [draft, setDraft] = useState(item ? { ...item, sectors: item.sectors?.length ? item.sectors : String(item.sector || '').split(/[,;]/).map((name) => name.trim()).filter(Boolean) } : { name: '', type: 'Hora homem', sectors: [], hourlyRate: '' })
  const [sectorError, setSectorError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current, focus = document.activeElement, overflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = overflow; focus?.focus({ preventScroll: true }) }
  }, [])
  async function submit(event) {
    event.preventDefault()
    if (!removing && !draft.sectors.length) return setSectorError('Marque pelo menos um setor.')
    setBusy(true); setError('')
    try { await onSave(draft, removing); onClose() }
    catch (caught) { setError(caught.message) }
    finally { setBusy(false) }
  }
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  return <dialog ref={dialog} className="labor-service-dialog" aria-labelledby="labor-service-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id="labor-service-dialog-title">{removing ? 'Remover serviço?' : item ? 'Editar serviço' : 'Adicionar serviço'}</h2><button type="button" aria-label="Fechar janela" title="Fechar janela" disabled={busy} onClick={onClose}><X size={19} /></button></header>
    <form onSubmit={submit}><fieldset disabled={busy}>
      {removing ? <p>Remover <strong>{item.name}</strong> do cadastro? O histórico das utilizações anteriores será preservado.</p> : <div className="labor-service-fields">
        <label>Nome do serviço<input value={draft.name} onChange={(event) => field('name', event.target.value)} maxLength={160} required autoFocus /></label>
        <label>Tipo<input value={draft.type} onChange={(event) => field('type', event.target.value)} maxLength={100} /></label>
        <SectorPicker value={draft.sectors} onChange={(sectors) => { setSectorError(''); field('sectors', sectors) }} error={sectorError} />
        <label>Valor da hora (R$)<input type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => field('hourlyRate', event.target.value)} required /></label>
      </div>}
      {error && <p className="admin-tool-error" role="alert">{error}</p>}
      <footer><button className="admin-tool-button" type="button" onClick={onClose}>Cancelar</button><button className={`admin-tool-button ${removing ? 'labor-service-danger' : 'admin-tool-button--primary'}`} type="submit">{removing ? <Trash2 size={16} /> : <Save size={16} />}{busy ? 'Salvando...' : removing ? 'Remover serviço' : 'Salvar serviço'}</button></footer>
    </fieldset></form>
  </dialog>
}

export default function LaborServicesScreen(props) {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(undefined)
  const [removing, setRemoving] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try { const data = await request('', { signal: controller.signal, cache: 'no-store' }); if (!controller.signal.aborted) { setItems(data.items); setError('') } }
      catch (caught) { if (!controller.signal.aborted) setError(caught.message) }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    refresh(); const stopPolling = pollWhileVisible(refresh, 10000)
    return () => { controller.abort(); stopPolling() }
  }, [retry])
  const selected = items.find((item) => item.id === selectedId)
  const visible = items.filter((item) => [item.name, item.type, item.sector].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
  async function save(item, remove) {
    const suffix = item.id ? `/${encodeURIComponent(item.id)}` : ''
    const data = await request(suffix, { method: remove ? 'DELETE' : item.id ? 'PUT' : 'POST', ...(!remove ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) } : {}) })
    setItems((current) => remove ? current.filter((row) => row.id !== item.id) : item.id ? current.map((row) => row.id === item.id ? { ...row, ...data.item } : row) : [...current, data.item])
    if (remove) setSelectedId(null)
    setRetry((value) => value + 1)
  }
  return <AdminWorkspace title="Serviços" {...props}>
    <div className="labor-services-toolbar"><label className="labor-services-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Buscar serviço" placeholder="Buscar serviço ou setor..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="labor-services-commands">
      <button className="admin-tool-button admin-tool-button--primary" type="button" onClick={() => setEditing(null)}><Plus size={17} />Adicionar serviço</button>
      <button className="admin-tool-button" type="button" disabled={!selected} onClick={() => setEditing(selected)}><Pencil size={17} />Editar serviço</button>
      <button className="admin-tool-button labor-service-danger" type="button" disabled={!selected} onClick={() => setRemoving(selected)}><Trash2 size={17} />Remover serviço</button>
    </div></div>
    {error && <div className="admin-tool-error" role="alert">{error}<button className="admin-tool-button" type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    <section className="labor-services-list" aria-labelledby="labor-services-list-title"><header><h2 id="labor-services-list-title">Lista de serviços</h2><span>{items.length} cadastrados</span></header><table><thead><tr><th>Serviço</th><th>Tipo</th><th>Setor</th><th>Valor/hora</th><th>Tempo utilizado</th><th>Ações</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={6} className="reports-empty">Carregando serviços...</td></tr> : visible.map((item) => <tr key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
        <td data-label="Serviço"><span className="labor-service-name"><Wrench size={18} aria-hidden="true" /><strong>{item.name}</strong></span></td><td data-label="Tipo">{item.type || '—'}</td><td data-label="Setor">{item.sector || '—'}</td><td data-label="Valor/hora">{money(item.hourlyRate)}</td><td data-label="Tempo utilizado">{item.usage || '00:00:00'}</td><td data-label="Ações"><div className="labor-service-actions">
          <button type="button" aria-label={`Ver histórico de ${item.name}`} title="Histórico de uso" onClick={(event) => { event.stopPropagation(); setHistory(item) }}><Info size={17} /></button>
          <button type="button" aria-label={`Editar ${item.name}`} title="Editar serviço" onClick={(event) => { event.stopPropagation(); setEditing(item) }}><Pencil size={17} /></button>
          <button className="labor-service-danger" type="button" aria-label={`Remover ${item.name}`} title="Remover serviço" onClick={(event) => { event.stopPropagation(); setRemoving(item) }}><Trash2 size={17} /></button>
        </div></td>
      </tr>)}{!loading && !visible.length && <tr><td colSpan={6} className="reports-empty">Nenhum serviço encontrado.</td></tr>}
    </tbody></table></section>
    {editing !== undefined && <ServiceDialog item={editing} onSave={save} onClose={() => setEditing(undefined)} />}
    {removing && <ServiceDialog item={removing} removing onSave={save} onClose={() => setRemoving(null)} />}
    {history && <MachineHistoryModal machine={history} subject="service" loadHistory={loadHistory} onClose={() => setHistory(null)} />}
  </AdminWorkspace>
}
