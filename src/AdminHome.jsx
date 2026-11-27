import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, GripVertical, MoveVertical, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { adminFirstName, adminOverview } from './adminOverview.js'
import { DEFAULT_HOME_PERIOD, defaultHomeLayout, homeModules, homeWidget, homeWidgets, widgetAllowed } from '../server/homeWidgets.js'
import { todayBahia } from '../server/payableRules.js'
import { useHomeLayout } from './homeLayout.js'
import { sourceLoaders, useHomeSources } from './homeSources.js'
import { widgetViews } from './HomeWidgets.jsx'
import { PayableModal } from './PayableModal.jsx'
import './payables.css'
import './adminHome.css'

const widthNames = { 1: ['1/4', 'Um quarto da linha'], 2: ['1/2', 'Metade da linha'], 3: ['3/4', 'Três quartos da linha'], 4: ['Inteira', 'A linha inteira'] }
const moduleName = Object.fromEntries(homeModules)
const sameLayout = (left, right) => JSON.stringify(left) === JSON.stringify(right)
// The items do not slide while dragging: the list itself changes order as the pointer passes over another widget.
const noShift = () => null
// With the mouse or a finger the widget under the pointer is the target; with the keyboard, the nearest one.
const collision = (args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)

const moveArrows = { left: { Icon: ChevronLeft, label: 'para a esquerda' }, right: { Icon: ChevronRight, label: 'para a direita' }, up: { Icon: ChevronUp, label: 'para cima' }, down: { Icon: ChevronDown, label: 'para baixo' } }
// The arrows point where the widget really goes: to the side when its neighbor in the list is on the same row, up or down
// when the neighbor is on another row (a full-width widget, or any widget on a narrow screen).
function arrowDirections(grid) {
  const nodes = [...grid.querySelectorAll(':scope > [data-widget]')]
  const tops = nodes.map((node) => node.getBoundingClientRect().top)
  const sameRow = (left, right) => Math.abs(tops[left] - tops[right]) < 4
  return Object.fromEntries(nodes.map((node, index) => [node.dataset.widget, {
    before: index > 0 && sameRow(index, index - 1) ? 'left' : 'up',
    after: index < nodes.length - 1 && sameRow(index, index + 1) ? 'right' : 'down',
  }]))
}

function WidgetSlot({ entry, index, count, editing, arrows = { before: 'up', after: 'down' }, onChange, onRemove, onMove, children }) {
  const item = homeWidget(entry.id)
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useSortable({ id: entry.id, disabled: !editing })
  const content = useRef(null)
  // While editing, the widget is a block to arrange: its buttons and fields stop responding (and leave the Tab order).
  useEffect(() => { if (content.current) content.current.inert = editing }, [editing])
  const className = `home-widget home-widget--w${entry.w} home-widget--h${entry.h}${editing ? ' home-widget--editing' : ''}${isDragging ? ' home-widget--dragging' : ''}`
  return <div ref={setNodeRef} className={className} data-widget={entry.id} onMouseDown={editing ? listeners?.onMouseDown : undefined} onTouchStart={editing ? listeners?.onTouchStart : undefined}>
    {editing && <div className="home-widget-toolbar">
      <button ref={setActivatorNodeRef} className="home-widget-grip" type="button" {...attributes} onKeyDown={listeners?.onKeyDown} aria-label={`Mover ${item.title}: espaço para pegar, setas para levar, espaço para soltar`} title="Arraste para trocar de lugar"><GripVertical className="icon" aria-hidden="true" /></button>
      <span className="home-widget-name" title={item.title}>{item.title}</span>
      <span className="home-widget-tools">
        {[[-1, arrows.before, index === 0], [1, arrows.after, index === count - 1]].map(([step, direction, disabled]) => {
          const { Icon, label } = moveArrows[direction]
          return <button type="button" key={step} className="home-widget-tool" disabled={disabled} onClick={() => onMove(step)} aria-label={`Levar ${item.title} ${label}`} title={`Levar ${label}`}><Icon className="icon" aria-hidden="true" /></button>
        })}
        {item.widths.length > 1 && <span className="home-widget-sizes" role="group" aria-label={`Largura de ${item.title}`}>{item.widths.map((width) => <button type="button" key={width} aria-pressed={entry.w === width} title={`Largura: ${widthNames[width][1].toLowerCase()}`} onClick={() => onChange({ w: width })}>{widthNames[width][0]}</button>)}</span>}
        {item.tall && <button type="button" className="home-widget-tool home-widget-tool--text" aria-pressed={entry.h === 2} onClick={() => onChange({ h: entry.h === 2 ? 1 : 2 })} title={entry.h === 2 ? 'Voltar para a altura normal' : 'Altura dupla: mostra mais itens'}><MoveVertical className="icon" aria-hidden="true" /><span>Alto</span></button>}
        <button type="button" className="home-widget-tool home-widget-remove" onClick={onRemove} aria-label={`Remover ${item.title}`} title="Remover do Início"><X className="icon" aria-hidden="true" /></button>
      </span>
    </div>}
    <div className="home-widget-content" ref={content}>{children}</div>
  </div>
}

function WidgetCatalog({ role, layout, onAdd, onRemove, onClose }) {
  const [module, setModule] = useState('all')
  const [search, setSearch] = useState('')
  const placed = new Set(layout.map((entry) => entry.id))
  const available = homeWidgets.filter((item) => widgetAllowed(item, role))
  const plain = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const query = plain(search.trim())
  const shown = available.filter((item) => (module === 'all' || item.module === module) && (!query || plain(`${item.title} ${item.description} ${moduleName[item.module]}`).includes(query)))
  const modules = homeModules.filter(([key]) => available.some((item) => item.module === key))
  return <PayableModal title="Adicionar widgets" className="home-catalog-modal" onClose={onClose} footer={<button className="admin-tool-button admin-tool-button--primary" type="button" onClick={onClose}>Concluir</button>}>
    <p className="home-catalog-intro">Escolha o que aparece no seu Início. Os widgets entram no fim da tela; depois é só arrastar para o lugar certo.</p>
    <div className="home-catalog-tools">
      <label className="home-catalog-search"><Search className="icon" aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar widget" aria-label="Buscar widget" /></label>
      <div className="home-catalog-modules" role="group" aria-label="Módulo do sistema">{[['all', 'Todos'], ...modules].map(([key, label]) => <button type="button" key={key} aria-pressed={module === key} onClick={() => setModule(key)}>{label}<small>{key === 'all' ? available.length : available.filter((item) => item.module === key).length}</small></button>)}</div>
    </div>
    <ul className="home-catalog-list">{shown.map((item) => {
      const Icon = widgetViews[item.id].icon || FileText
      const added = placed.has(item.id)
      return <li key={item.id} className={added ? 'home-catalog-item home-catalog-item--added' : 'home-catalog-item'}>
        <span className="home-catalog-icon"><Icon className="icon" aria-hidden="true" strokeWidth={1.7} /></span>
        <span className="home-catalog-copy"><strong>{item.title}</strong><small>{moduleName[item.module]}{item.finance ? ' · Financeiro' : ''}</small><span>{item.description}</span></span>
        {added ? <button key="added" type="button" className="admin-tool-button home-catalog-action" onClick={() => onRemove(item.id)} aria-label={`Remover ${item.title}`}><Check className="icon" aria-hidden="true" /><span>No Início</span></button>
          : <button key="add" type="button" className="admin-tool-button admin-tool-button--primary home-catalog-action" onClick={() => onAdd(item)} aria-label={`Adicionar ${item.title}`}><Plus className="icon" aria-hidden="true" /><span>Adicionar</span></button>}
      </li>
    })}</ul>
    {!shown.length && <p className="home-card-empty">Nenhum widget encontrado.</p>}
  </PayableModal>
}

export default function AdminHome({ user, orders, offers, workflowError, workflowLoading, onRefresh, onNavigate, onSelectOrder, onSelectOffer, onOpenPayables, loadPayables, loadInventory, Sidebar, WorkspaceTabs, navigationProps }) {
  const role = user?.role
  const home = useHomeLayout(user)
  // `draft`: the layout being edited (null when not editing). Nothing reaches the server until "Salvar".
  const [draft, setDraft] = useState(null)
  const editing = draft !== null
  const layout = editing ? draft : home.layout
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (!notice) return undefined; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer) }, [notice])
  const loaders = useMemo(() => sourceLoaders({ loadPayables, loadInventory }), [loadPayables, loadInventory])
  const needed = useMemo(() => new Set(layout.flatMap((entry) => widgetViews[entry.id]?.sources || [])), [layout])
  const sources = useHomeSources(loaders, needed, retry)
  const summary = adminOverview(orders, offers, sources.inventory.data || [], now)
  const today = new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: 'numeric', month: 'long', year: 'numeric' })
  const ctx = { user, staff: role === 'staff', orders, offers, summary, sources, workflowLoading, workflowError, now, today: todayBahia(new Date(now)), onNavigate, onSelectOrder, onSelectOffer, onOpenPayables, retry: () => setRetry((value) => value + 1) }

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [activeId, setActiveId] = useState(null)
  const before = useRef(null), lastOver = useRef(null)
  function dragStart({ active }) { setActiveId(active.id); before.current = draft; lastOver.current = active.id }
  // Passing over a widget takes its place at once. The same widget does not swap again until the pointer has left it,
  // so a large widget that moved under the pointer does not bounce back and forth.
  function dragOver({ active, over }) {
    if (!over || over.id === lastOver.current) return
    lastOver.current = over.id
    if (over.id === active.id) return
    setDraft((current) => {
      const from = current.findIndex((entry) => entry.id === active.id), to = current.findIndex((entry) => entry.id === over.id)
      return from < 0 || to < 0 || from === to ? current : arrayMove(current, from, to)
    })
  }
  function dragEnd() { setActiveId(null); before.current = null }
  function dragCancel() { setActiveId(null); if (before.current) setDraft(before.current); before.current = null }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setNow(Date.now())
    setRetry((value) => value + 1)
    try { await onRefresh() } catch { /* Workflow errors are displayed by the parent. */ }
    finally { setRefreshing(false) }
  }
  function startEditing() { setDraft(home.layout.map((entry) => ({ ...entry }))); setEditError(''); setNotice('') }
  function cancelEditing() { if (saving) return; setDraft(null); setCatalogOpen(false); setEditError('') }
  const change = (id, fields) => setDraft((current) => current.map((entry) => entry.id === id ? { ...entry, ...fields } : entry))
  const remove = (id) => setDraft((current) => current.filter((entry) => entry.id !== id))
  const move = (id, step) => setDraft((current) => { const from = current.findIndex((entry) => entry.id === id), to = from + step; return to < 0 || to >= current.length ? current : arrayMove(current, from, to) })
  const add = (item) => setDraft((current) => current.some((entry) => entry.id === item.id) ? current : [...current, { id: item.id, w: item.w, h: item.h }])
  // A setting chosen inside a widget (the period of Contas a pagar / a receber) is saved at once with the layout; the
  // default period is not written, so the default layout stays "nothing customized".
  async function saveWidget(id, fields) {
    const next = home.layout.map((entry) => {
      if (entry.id !== id) return entry
      const { period, ...rest } = { ...entry, ...fields }
      return period === undefined || period === DEFAULT_HOME_PERIOD ? rest : { ...rest, period }
    })
    setEditError('')
    try { await home.save(sameLayout(next, defaultHomeLayout(role)) ? null : next, { optimistic: true }) } catch (caught) { setEditError(caught.message) }
  }
  async function save() {
    if (saving) return
    setSaving(true); setEditError('')
    try {
      // The default layout is saved as "nothing customized": a later improvement of the default reaches this account too.
      await home.save(sameLayout(draft, defaultHomeLayout(role)) ? null : draft)
      setDraft(null); setCatalogOpen(false); setNotice('Início salvo. Ele aparece assim em qualquer computador em que você entrar.')
    } catch (caught) { setEditError(caught.message) }
    finally { setSaving(false) }
  }
  // Measured after each change of the layout and whenever the grid changes size (window, menu, font).
  const gridRef = useRef(null)
  const [arrows, setArrows] = useState({})
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!editing || !grid) return undefined
    const measure = () => { const next = arrowDirections(grid); setArrows((current) => sameLayout(current, next) ? current : next) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [editing, draft])
  const changed = editing && !sameLayout(draft, home.layout)
  const activeItem = activeId ? homeWidget(activeId) : null
  const ActiveIcon = activeItem ? widgetViews[activeItem.id]?.icon : null

  return <div className={`dashboard-shell admin-home-shell${editing ? ' admin-home-shell--editing' : ''}`}>
    <Sidebar {...navigationProps} onNavigate={onNavigate} />
    <main className="admin-home-main">
      <WorkspaceTabs {...navigationProps} onNavigate={onNavigate} />
      <header className="home-heading"><div><span className="home-eyebrow">GMAC Metalúrgica <span>/</span> Início</span><h1>Bem-vindo, {adminFirstName(user?.name)}</h1><p>{today}</p></div>
        <div className="home-heading-actions">{editing ? <Fragment key="edit">
          <button className="home-button" type="button" onClick={() => setCatalogOpen(true)} disabled={saving}><Plus className="icon" aria-hidden="true" /><span>Adicionar widget</span></button>
          <button className="home-button" type="button" onClick={() => setDraft(defaultHomeLayout(role))} disabled={saving || sameLayout(draft, defaultHomeLayout(role))} title="Voltar para o Início padrão do portal"><RotateCcw className="icon" aria-hidden="true" /><span>Restaurar padrão</span></button>
          <button className="home-button home-button--danger" type="button" onClick={() => setDraft([])} disabled={saving || !draft.length} title="Tirar todos os widgets do Início (Cancelar desfaz)"><Trash2 className="icon" aria-hidden="true" /><span>Remover todos</span></button>
          <button className="home-button" type="button" onClick={cancelEditing} disabled={saving}><X className="icon" aria-hidden="true" /><span>Cancelar</span></button>
          <button className="home-button home-button--primary" type="button" onClick={save} disabled={saving || !changed}><Check className="icon" aria-hidden="true" /><span>{saving ? 'Salvando...' : 'Salvar'}</span></button>
        </Fragment> : <Fragment key="view">
          <button className="home-button" type="button" onClick={refresh} disabled={refreshing} title="Atualizar resumos"><RefreshCw className="icon" aria-hidden="true" strokeWidth={1.7} /><span>{refreshing ? 'Atualizando...' : 'Atualizar'}</span></button>
          <button className="home-button" type="button" onClick={startEditing} title="Escolher, arrumar e redimensionar os widgets do seu Início"><Pencil className="icon" aria-hidden="true" strokeWidth={1.7} /><span>Editar início</span></button>
          <button className="home-button home-button--primary" type="button" onClick={() => onNavigate('Ofertas e serviços')}><FileText className="icon" aria-hidden="true" strokeWidth={1.7} /><span>Ofertas e serviços</span></button>
        </Fragment>}</div>
      </header>
      {editing && <p className="home-edit-banner" role="status"><Pencil className="icon" aria-hidden="true" /><span><strong>Editando o seu Início.</strong> Arraste os widgets para trocar de lugar (no celular, toque e segure), escolha a largura, deixe alto ou remova. Só você vê estas mudanças.</span></p>}
      {editError && <p className="home-error" role="alert">{editError}</p>}
      {notice && <p className="home-notice" role="status">{notice}</p>}
      {workflowError && <p className="home-error" role="alert">{workflowError}</p>}
      <DndContext sensors={sensors} collisionDetection={collision} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={dragStart} onDragOver={dragOver} onDragEnd={dragEnd} onDragCancel={dragCancel}>
        <SortableContext items={layout.map((entry) => entry.id)} strategy={noShift}>
          <div ref={gridRef} className={`home-grid${editing ? ' home-grid--editing' : ''}`}>
            {layout.map((entry, index) => {
              const View = widgetViews[entry.id].Component
              return <WidgetSlot key={entry.id} entry={entry} index={index} count={layout.length} editing={editing} arrows={arrows[entry.id]} onChange={(fields) => change(entry.id, fields)} onRemove={() => remove(entry.id)} onMove={(step) => move(entry.id, step)}><View ctx={ctx} size={entry} onSettings={editing ? undefined : (fields) => saveWidget(entry.id, fields)} /></WidgetSlot>
            })}
            {editing && <button className="home-add-tile" type="button" onClick={() => setCatalogOpen(true)}><Plus className="icon" aria-hidden="true" /><strong>Adicionar widget</strong><small>Operação, financeiro, estoque, cadastros e mais</small></button>}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>{activeItem && <div className="home-drag-ghost">{ActiveIcon && <ActiveIcon className="icon" aria-hidden="true" />}<strong>{activeItem.title}</strong><small>Solte onde quiser</small></div>}</DragOverlay>
      </DndContext>
      {!layout.length && !editing && <div className="home-empty-layout"><strong>Seu Início está vazio.</strong><span>Clique em "Editar início" para escolher os widgets que você quer ver aqui.</span><button className="home-button home-button--primary" type="button" onClick={startEditing}><Pencil className="icon" aria-hidden="true" /><span>Editar início</span></button></div>}
      <footer className="home-footer"><span><span className="home-live-dot" />Visão da operação</span><span>{workflowLoading ? 'Carregando dados' : workflowError ? 'Atualização indisponível' : `Consultado às ${new Date(now).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}`}</span></footer>
      {catalogOpen && editing && <WidgetCatalog role={role} layout={draft} onAdd={add} onRemove={remove} onClose={() => setCatalogOpen(false)} />}
    </main>
  </div>
}
