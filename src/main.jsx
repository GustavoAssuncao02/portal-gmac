import { StrictMode, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OperatorDashboard from './OperatorDashboard.jsx'
import EmployeeActivityModal from './EmployeeActivityModal.jsx'
import OrderDetails from './OrderDetails.jsx'
import AdminHome from './AdminHome.jsx'
import NotificationsButton from './NotificationsButton.jsx'
import ReportsScreen from './ReportsScreen.jsx'
import AccountSettings from './AccountSettings.jsx'
import PayablesScreen from './PayablesScreen.jsx'
import ServiceStageEditor from './ServiceStageEditor.jsx'
import { Monitor, Minimize2, CreditCard, ChartColumn, Tags, Truck, WalletCards, ChevronLeft, ChevronRight, ChevronDown, UsersRound, X } from 'lucide-react'
import { stageLabel, stageGroupLabel, serviceDetails, readStageLayout, orderedStageSelection } from '../server/serviceStages.js'
import { findInventoryMaterial, materialStock, normalizeSearch, pendingInventoryRequests, purchaseMaterialRequests } from './offerResources.js'
import { deadlineCategories, serviceDeadline } from './serviceDeadline.js'
import { currentPieceProgress } from './serviceProgress.js'
import './styles.css'

async function apiRequest(url, options = {}) {
  const token = window.sessionStorage.getItem('gmac-admin-token')
  const response = await fetch(url, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.message || 'Não foi possível concluir a operação.'), { status: response.status })
  return data
}

const jsonOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const pageLabel = (name) => name === 'Dashboard' ? 'Início' : name
const attachmentUrl = (offerId, attachmentId) => `/api/offers/${offerId}/attachments/${attachmentId}`
const displayDate = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'
const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function uploadOfferAttachment(offerId, file) {
  return apiRequest(`/api/offers/${offerId}/attachments?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  })
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.65-3.28 3.02-5 7-5s6.35 1.72 7 5" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10" width="13" height="10" rx="1.6" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  )
}

function EyeIcon({ crossed }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.25" />
      {crossed && <path d="m4 4 16 16" />}
    </svg>
  )
}

function Icon({ name, className = '' }) {
  const paths = {
    dashboard: <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5V21h13V9.5M9 21v-6h6v6" /></>,
    machines: <><rect x="7" y="4" width="10" height="16" rx="2" /><path d="M9.5 4V2.5h5V4M9.5 8h5M9.5 12h5M9.5 16h5" /></>,
    stock: <><path d="M3.5 8.5 12 4l8.5 4.5L12 13 3.5 8.5Z" /><path d="M3.5 8.5V16L12 20.5 20.5 16V8.5M12 13v7.5" /></>,
    employees: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-3.2 2.35-5 5.5-5s5 1.8 5.5 5M17 11V5M14 8h6" /></>,
    admins: <><path d="M12 3.5 19 6v5.2c0 4.3-2.7 7.7-7 9.3-4.3-1.6-7-5-7-9.3V6l7-2.5Z" /><path d="M12 8v4M12 15.5h.01" /></>,
    calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2" /></>,
    offers: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    services: <><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
    clients: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-3.2 2.35-5 5.5-5s5 1.8 5.5 5" /><circle cx="17" cy="9" r="2.2" /><path d="M15.2 15.3c2.8-.1 4.6 1.5 5.2 4.7" /></>,
    parts: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5V21" /></>,
    orders: <><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M14.5 3.5v4h3.5M9 12h6M9 16h6" /></>,
    production: <><path d="M4 20.5h16M5.5 20.5V10l5-3v4l4-2v5l4-2v8" /><path d="M8 13.5h1M12 13.5h1M16 13.5h1" /></>,
    quality: <><path d="M12 3.5 19 6v5.2c0 4.3-2.7 7.7-7 9.3-4.3-1.6-7-5-7-9.3V6l7-2.5Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    reports: <><path d="M4 20V4M4 20h17" /><path d="m7 16 3-4 3 2 5-7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L13.7 2h-3.4L10 5.1a8 8 0 0 0-2.6 1.5L5 5.6 3 9l2 1.5a7.8 7.8 0 0 0 0 3L3 15l2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.3 3.1h3.4l.3-3.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z" /></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></>,
    send: <><path d="m3 4 18 8-18 8 3.5-8L3 4Z" /><path d="M6 12h9" /></>,
    bell: <><path d="M5 17h14l-1.5-2v-4a5.5 5.5 0 0 0-11 0v4L5 17ZM10 20h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    edit: <><path d="m4 16.5-.7 3.7 3.7-.7L18.8 7.7a2.6 2.6 0 0 0-3.7-3.7L4 16.5Z" /><path d="m13.7 5.3 3.7 3.7" /></>,
    trash: <><path d="M4.5 7h15M10 11v5M14 11v5M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3" /></>,
    eye: <><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.25" /></>,
    info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.7h.01" /></>,
    collapse: <><path d="m14 6-6 6 6 6" /><path d="M19 4v16" /></>,
    expand: <><path d="m10 6 6 6-6 6" /><path d="M5 4v16" /></>,
  }

  return <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

const navigation = [
  ['Dashboard', 'dashboard'],
  ['Máquinas', 'machines'],
  ['Estoque', 'stock'],
  ['Calculadora de pesos e medidas', 'calculator'],
  ['Funcionários', 'employees'],
  ['Administradores', 'admins'],
  ['Serviços em andamento', 'services'],
  ['Ofertas e serviços', 'offers'],
  ['Clientes', 'clients'],
  ['Pedidos', 'orders'],
  ['Contas a Pagar', 'payables'],
  ['Business Intelligence', 'bi'],
  ['Classificações', 'classifications'],
  ['Fornecedores', 'suppliers'],
  ['Relatórios', 'reports'],
  ['Configurações', 'settings'],
]

const registrationNavigation = ['Fornecedores', 'Administradores', 'Funcionários', 'Clientes'].map((label) => navigation.find(([name]) => name === label))
const isRegistrationPage = (label) => registrationNavigation.some(([name]) => name === label)
const financialNavigation = ['Contas a Pagar', 'Business Intelligence', 'Classificações'].map((label) => navigation.find(([name]) => name === label))
const isFinancialPage = (label) => financialNavigation.some(([name]) => name === label)

const AdminIdentityContext = createContext(null)
const WorkspaceTabsContext = createContext(null)

function Sidebar({ collapsed, onToggle, activeNav, onNavigate, onLogout }) {
  const user = useContext(AdminIdentityContext)
  const [registrationsOpen, setRegistrationsOpen] = useState(() => isRegistrationPage(activeNav) || window.sessionStorage.getItem('gmac-cadastros-open') !== 'false')
  const [financialOpen, setFinancialOpen] = useState(() => isFinancialPage(activeNav) || window.sessionStorage.getItem('gmac-finance-open') !== 'false')
  useEffect(() => {
    if (isRegistrationPage(activeNav)) {
      setRegistrationsOpen(true)
      window.sessionStorage.setItem('gmac-cadastros-open', 'true')
    }
  }, [activeNav])
  useEffect(() => {
    if (isFinancialPage(activeNav)) {
      setFinancialOpen(true)
      window.sessionStorage.setItem('gmac-finance-open', 'true')
    }
  }, [activeNav])
  function toggleRegistrations() {
    const next = !registrationsOpen
    setRegistrationsOpen(next)
    window.sessionStorage.setItem('gmac-cadastros-open', String(next))
  }
  function toggleFinancial() {
    const next = !financialOpen
    setFinancialOpen(next)
    window.sessionStorage.setItem('gmac-finance-open', String(next))
  }
  function navigationItem([label, icon]) {
    return <button className={`nav-item ${activeNav === label ? 'nav-item--active' : ''}`} key={label} type="button" title={pageLabel(label)} aria-label={pageLabel(label)} onClick={() => onNavigate(label)}>
      {['payables', 'bi', 'classifications', 'suppliers'].includes(icon) ? (() => { const NavIcon = { payables: CreditCard, bi: ChartColumn, classifications: Tags, suppliers: Truck }[icon]; return <NavIcon className="icon nav-icon" size={20} /> })() : <Icon name={icon} className="nav-icon" />}
      <span>{pageLabel(label)}</span>
    </button>
  }
  const name = user?.name || 'Administrador'
  const words = name.trim().split(/\s+/)
  const initials = [words[0], words.length > 1 ? words.at(-1) : ''].map((word) => word?.[0] || '').join('').toUpperCase()
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" />
        <button className="sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}>
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navigation.flatMap((item) => {
          if (item[0] === 'Funcionários') return [<div className="sidebar-nav-group" key="cadastros">
            <button className={`nav-item sidebar-nav-group-toggle ${!registrationsOpen && isRegistrationPage(activeNav) ? 'nav-item--active' : ''}`} type="button" title="Cadastros" aria-label="Cadastros" aria-expanded={registrationsOpen} aria-controls="sidebar-cadastros-menu" onClick={toggleRegistrations}>
              <UsersRound className="icon nav-icon" size={20} aria-hidden="true" /><span>Cadastros</span>{registrationsOpen ? <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" /> : <ChevronRight className="sidebar-group-chevron" size={15} aria-hidden="true" />}
            </button>
            <div className="sidebar-submenu" id="sidebar-cadastros-menu" hidden={!registrationsOpen}>{registrationNavigation.map(navigationItem)}</div>
          </div>]
          if (item[0] === 'Contas a Pagar') return [<div className="sidebar-nav-group" key="finance">
            <button className={`nav-item sidebar-nav-group-toggle ${!financialOpen && isFinancialPage(activeNav) ? 'nav-item--active' : ''}`} type="button" title="Gestão Financeira" aria-label="Gestão Financeira" aria-expanded={financialOpen} aria-controls="sidebar-finance-menu" onClick={toggleFinancial}>
              <WalletCards className="icon nav-icon" size={20} aria-hidden="true" /><span>Gestão Financeira</span>{financialOpen ? <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" /> : <ChevronRight className="sidebar-group-chevron" size={15} aria-hidden="true" />}
            </button>
            <div className="sidebar-submenu" id="sidebar-finance-menu" hidden={!financialOpen}>{financialNavigation.map(navigationItem)}</div>
          </div>]
          return isRegistrationPage(item[0]) || isFinancialPage(item[0]) ? [] : [navigationItem(item)]
        })}
      </nav>
      <div className="sidebar-account"><div className="account-avatar">{initials}</div><div className="account-copy"><strong title={name}>{name}</strong><span>Administrador</span></div><span className="account-chevron">›</span></div>
      <button className="logout-button" type="button" onClick={onLogout} title="Sair" aria-label="Sair"><span className="logout-icon" aria-hidden="true">↪</span><span>Sair</span></button>
    </aside>
  )
}

function WorkspaceTabs({ tabs, activeNav, onNavigate, onCloseTab, onReorderTabs }) {
  const closeAllTabs = useContext(WorkspaceTabsContext)
  const listRef = useRef(null)
  const leftArrowRef = useRef(null)
  const rightArrowRef = useRef(null)
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false })
  const [draggedTab, setDraggedTab] = useState(null)
  const [currentTime, setCurrentTime] = useState(() => new Date())

  function measureTabs() {
    const list = listRef.current
    if (!list) return
    // Measure the space without arrows so their own width cannot keep overflow enabled.
    const arrowWidth = (leftArrowRef.current?.getBoundingClientRect().width || 0) + (rightArrowRef.current?.getBoundingClientRect().width || 0)
    const next = {
      overflow: list.scrollWidth > list.clientWidth + arrowWidth + 1,
      left: list.scrollLeft > 1,
      right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
    }
    setScrollState((previous) => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next)
  }

  useLayoutEffect(() => {
    let active = true
    const measure = () => { if (active) measureTabs() }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(listRef.current)
    for (const tab of listRef.current.children) observer.observe(tab)
    document.fonts?.ready.then(measure)
    return () => { active = false; observer.disconnect() }
  }, [tabs])

  useLayoutEffect(() => {
    const list = listRef.current
    const selected = list.querySelector('.workspace-tab--active')
    if (!selected) return
    const viewport = list.getBoundingClientRect()
    const tab = selected.getBoundingClientRect()
    if (tab.left < viewport.left) list.scrollLeft += tab.left - viewport.left
    else if (tab.right > viewport.right) list.scrollLeft += tab.right - viewport.right
    measureTabs()
  }, [tabs, activeNav, scrollState.overflow])

  function scrollTabs(direction) {
    const list = listRef.current
    list.scrollBy({ left: direction * Math.max(120, list.clientWidth * 0.75), behavior: 'auto' })
    measureTabs()
  }

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  function dropTab(targetTab) {
    if (draggedTab && draggedTab !== targetTab) onReorderTabs(draggedTab, targetTab)
    setDraggedTab(null)
  }

  return <div className="workspace-tabs">
    {scrollState.overflow && <button ref={leftArrowRef} className="workspace-tabs-control" type="button" aria-label="Rolar abas para a esquerda" title="Rolar abas para a esquerda" disabled={!scrollState.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={17} aria-hidden="true" /></button>}
    <div ref={listRef} className="workspace-tabs-list" role="tablist" aria-label="Telas abertas" onScroll={measureTabs}>
      {tabs.map((tab) => <div className={`workspace-tab ${activeNav === tab ? 'workspace-tab--active' : ''} ${draggedTab === tab ? 'workspace-tab--dragging' : ''}`} key={tab} draggable onDragStart={() => setDraggedTab(tab)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropTab(tab)} onDragEnd={() => setDraggedTab(null)}><button type="button" role="tab" aria-selected={activeNav === tab} onClick={() => onNavigate(tab)}>{pageLabel(tab)}</button>{tabs.length > 1 && <button className="workspace-tab-close" type="button" aria-label={`Fechar aba ${pageLabel(tab)}`} onClick={() => onCloseTab(tab)}>×</button>}</div>)}
    </div>
    {scrollState.overflow && <button ref={rightArrowRef} className="workspace-tabs-control" type="button" aria-label="Rolar abas para a direita" title="Rolar abas para a direita" disabled={!scrollState.right} onClick={() => scrollTabs(1)}><ChevronRight size={17} aria-hidden="true" /></button>}
    {tabs.length > 3 && <button className="workspace-tabs-control workspace-tabs-close-all" type="button" aria-label="Fechar todas as abas" title="Fechar todas as abas" onClick={closeAllTabs}><X size={17} aria-hidden="true" /></button>}
    <NotificationsButton onOpenAccount={(id) => { sessionStorage.setItem('gmac-payable-open', id); onNavigate('Contas a Pagar'); window.dispatchEvent(new CustomEvent('gmac-payable-open', { detail: id })) }} />
    <div className="workspace-tabs-clock" aria-label="Data e hora atual"><strong>{currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><span>{currentTime.toLocaleDateString('pt-BR')}</span></div>
  </div>
}

const initialMachines = [
  { id: 1, name: 'Torno CNC 01', type: 'Torno CNC', sector: 'Usinagem', status: 'working', operator: 'Carlos Mendes', started: '08:15', usage: '6h 09min' },
  { id: 2, name: 'Centro de Usinagem 02', type: 'Centro de Usinagem', sector: 'Usinagem', status: 'working', operator: 'Ana Ferreira', started: '07:30', usage: '5h 42min' },
  { id: 3, name: 'Dobradeira Hidráulica', type: 'Dobradeira', sector: 'Caldeiraria', status: 'idle', operator: '—', started: '—', usage: '0h 00min' },
  { id: 4, name: 'Corte a Plasma 01', type: 'Corte a Plasma', sector: 'Corte', status: 'working', operator: 'João Silva', started: '08:00', usage: '7h 12min' },
  { id: 5, name: 'Fresa Convencional', type: 'Fresa', sector: 'Usinagem', status: 'idle', operator: '—', started: '—', usage: '0h 00min' },
  { id: 6, name: 'Guilhotina', type: 'Guilhotina', sector: 'Corte', status: 'idle', operator: '—', started: '—', usage: '0h 00min' },
  { id: 7, name: 'Solda MIG 03', type: 'Solda MIG', sector: 'Caldeiraria', status: 'working', operator: 'Marcos Lima', started: '09:10', usage: '3h 58min' },
  { id: 8, name: 'Prensa Hidráulica', type: 'Prensa', sector: 'Estamparia', status: 'idle', operator: '—', started: '—', usage: '0h 00min' },
]

const initialInventory = [
  { id: 1, name: 'Alumínio 1', detail: 'Alumínio 6061 — Chapa', quantity: 85, minimum: 20, unitPrice: 32.5 },
  { id: 2, name: 'Alumínio 2', detail: 'Alumínio 5052 — Barra', quantity: 42, minimum: 15, unitPrice: 28.9 },
  { id: 3, name: 'Alumínio 3', detail: 'Alumínio 7075 — Bloco', quantity: 8, minimum: 10, unitPrice: 46.75 },
  { id: 4, name: 'Aço SAE 1020', detail: 'Barra redonda', quantity: 160, minimum: 30, unitPrice: 12.8 },
  { id: 5, name: 'Aço Inox 304', detail: 'Chapa inoxidável', quantity: 24, minimum: 20, unitPrice: 38.4 },
]

const initialPendingMaterialRequests = []

function readMachines() {
  try {
    const stored = JSON.parse(window.localStorage.getItem('gmac-machines') || 'null')
    return Array.isArray(stored) ? stored : initialMachines
  } catch {
    return initialMachines
  }
}

function createInventoryCreationLog(item) {
  return {
    id: `creation-${item.id}`,
    type: 'creation',
    date: new Date().toISOString(),
    quantity: Number(item.quantity || 0),
    balance: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    destination: 'Cadastro inicial',
    order: '—',
  }
}

function normalizeInventory(items) {
  return items.map((item) => {
    const history = Array.isArray(item.history) && item.history.length ? item.history : [createInventoryCreationLog(item)]
    return {
      ...item,
      history: history.map((entry) => ({ ...entry, unitPrice: entry.unitPrice ?? item.unitPrice ?? 0 })),
    }
  })
}

function readInventory() {
  try {
    return normalizeInventory(JSON.parse(window.localStorage.getItem('gmac-inventory') || 'null') || initialInventory)
  } catch {
    return normalizeInventory(initialInventory)
  }
}

function persistInventory(items) {
  window.localStorage.setItem('gmac-inventory', JSON.stringify(items))
}

let inventoryImport
async function importLocalInventory() {
  if (window.localStorage.getItem('gmac-inventory-migrated-v1')) return
  if (!window.sessionStorage.getItem('gmac-admin-token')) return
  if (!inventoryImport) inventoryImport = (async () => {
    const previous = window.localStorage.getItem('gmac-inventory')
    if (previous && !window.localStorage.getItem('gmac-inventory-before-mysql')) window.localStorage.setItem('gmac-inventory-before-mysql', previous)
    try {
      await apiRequest('/api/inventory/import', jsonOptions('POST', { items: readInventory(), onlyIfEmpty: !previous }))
      window.localStorage.setItem('gmac-inventory-migrated-v1', 'true')
    } catch (error) {
      if (error.status !== 503 && error.status !== 404) throw error
    }
  })().finally(() => { inventoryImport = null })
  return inventoryImport
}

const loadOverviewPayables = (signal) => apiRequest('/api/payables', { signal, cache: 'no-store' })

async function loadOverviewInventory(signal) {
  await importLocalInventory()
  const response = await fetch('/api/inventory', { signal })
  if (response.status === 503) return { items: readInventory(), source: 'local' }
  if (!response.ok) throw new Error('Não foi possível carregar o estoque.')
  const data = await response.json()
  if (!Array.isArray(data.items)) throw new Error('Dados de estoque inválidos.')
  const items = normalizeInventory(data.items)
  if (!signal?.aborted) persistInventory(items)
  return { items, source: 'server' }
}

function readPendingMaterialRequests() {
  try {
    return JSON.parse(window.localStorage.getItem('gmac-pending-materials') || 'null') || initialPendingMaterialRequests
  } catch {
    return initialPendingMaterialRequests
  }
}

function persistPendingMaterialRequests(requests) {
  window.localStorage.setItem('gmac-pending-materials', JSON.stringify(requests))
}

function useMaterialRequestStatuses() {
  const [items, setItems] = useState(readPendingMaterialRequests)
  useEffect(() => {
    let active = true, fetching = false
    const refresh = async () => {
      if (fetching) return
      fetching = true
      try {
        let result
        if (!window.localStorage.getItem('gmac-pending-materials-migrated-v1')) {
          const previous = readPendingMaterialRequests().filter((item) => item.status === 'purchase-requested')
          result = await apiRequest('/api/material-requests/import', jsonOptions('POST', { items: previous }))
          window.localStorage.setItem('gmac-pending-materials-migrated-v1', 'true')
        } else result = await apiRequest('/api/material-requests')
        if (active) { setItems(result.items); persistPendingMaterialRequests(result.items) }
      } catch { /* Keep the cached requests visible during a temporary outage. */ }
      finally { fetching = false }
    }
    refresh()
    const polling = window.setInterval(refresh, 10000)
    return () => { active = false; window.clearInterval(polling) }
  }, [])
  return [items, setItems]
}

function MachineModal({ machine, onClose, onSave }) {
  const [draft, setDraft] = useState(machine ? { ...machine, hourlyRate: machine.hourlyRate ?? '' } : { name: '', type: '', sector: '', hourlyRate: '', status: 'idle', operator: '—', started: '—', usage: '0h 00min' })
  const isEditing = Boolean(machine)
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  function submit(event) {
    event.preventDefault()
    onSave({ ...draft, name: draft.name.trim(), type: draft.type.trim(), sector: draft.sector.trim(), hourlyRate: Number(draft.hourlyRate) })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="machine-modal" role="dialog" aria-modal="true" aria-labelledby="machine-modal-title">
        <div className="modal-heading"><div><h2 id="machine-modal-title">{isEditing ? 'Editar máquina' : 'Adicionar máquina'}</h2><p>Preencha os dados da máquina.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button></div>
        <form onSubmit={submit}>
          <label>Nome da máquina<input value={draft.name} onChange={(event) => update('name', event.target.value)} required /></label>
          <div className="modal-fields"><label>Tipo<input value={draft.type} onChange={(event) => update('type', event.target.value)} required /></label><label>Setor<input value={draft.sector} onChange={(event) => update('sector', event.target.value)} required /></label></div>
          <label>Valor da hora (R$)<input type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => update('hourlyRate', event.target.value)} required /></label>
          <label>Status<select value={draft.status} onChange={(event) => update('status', event.target.value)}><option value="working">Em funcionamento</option><option value="idle">Ociosa</option></select></label>
          <div className="modal-actions"><button className="modal-cancel" type="button" onClick={onClose}>Cancelar</button><button className="modal-save" type="submit">Salvar máquina</button></div>
        </form>
      </div>
    </div>
  )
}

function Machines({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }) {
  const [machines, setMachines] = useState(readMachines)
  const [selectedId, setSelectedId] = useState(() => readMachines()[0]?.id ?? null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modalMachine, setModalMachine] = useState(undefined)
  const [machineError, setMachineError] = useState('')
  useEffect(() => { apiRequest('/api/machines').then((data) => setMachines(data.items)).catch((error) => setMachineError(error.message)) }, [])
  const filteredMachines = machines.filter((machine) => {
    const matchesFilter = filter === 'all' || machine.status === filter
    const query = search.toLowerCase()
    return matchesFilter && (!query || `${machine.name} ${machine.type} ${machine.sector} ${machine.operator}`.toLowerCase().includes(query))
  })
  const workingCount = machines.filter((machine) => machine.status === 'working').length
  const idleCount = machines.length - workingCount
  const selectedMachine = machines.find((machine) => machine.id === selectedId)
  const percentage = (count) => machines.length ? `${((count / machines.length) * 100).toFixed(1).replace('.', ',')}%` : '0,0%'

  useEffect(() => {
    window.localStorage.setItem('gmac-machines', JSON.stringify(machines))
  }, [machines])

  async function saveMachine(machine) {
    try {
      const data = await apiRequest(machine.id != null ? `/api/machines/${machine.id}` : '/api/machines', jsonOptions(machine.id != null ? 'PUT' : 'POST', machine))
      setMachines((current) => machine.id != null ? current.map((item) => String(item.id) === String(machine.id) ? data.item : item) : [...current, data.item])
      setSelectedId(data.item.id)
      setMachineError('')
      setModalMachine(undefined)
    } catch (error) { setMachineError(error.message) }
  }

  async function removeSelected(machine = selectedMachine) {
    if (!machine || !window.confirm(`Remover a máquina "${machine.name}"?`)) return
    try { await apiRequest(`/api/machines/${machine.id}`, { method: 'DELETE' }); setMachines((current) => current.filter((item) => item.id !== machine.id)); setSelectedId(null); setMachineError('') } catch (error) { setMachineError(error.message) }
  }

  return (
    <div className="dashboard-shell machines-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="machines-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        {machineError && <p className="workflow-error" role="alert">{machineError}</p>}
        <div className="machines-header"><div><h1>Máquinas</h1><p>Gerencie o parque de máquinas, disponibilidade e utilização em tempo real.</p></div><div className="machines-header-actions"><div className="machine-search"><Icon name="search" /><input placeholder="Buscar máquina, setor ou operador..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="machine-bell" type="button" aria-label="Notificações"><Icon name="bell" /></button></div></div>
        <div className="machine-toolbar"><div className="machine-filters"><button className={`machine-filter ${filter === 'all' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('all')}>Todas</button><button className={`machine-filter ${filter === 'working' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('working')}><span className="status-dot status-dot--green" />Em funcionamento</button><button className={`machine-filter ${filter === 'idle' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('idle')}><span className="status-dot status-dot--gray" />Ociosas</button></div><div className="machine-actions"><button className="machine-action machine-action--primary" type="button" onClick={() => setModalMachine(null)}><Icon name="plus" />Adicionar máquina</button><button className="machine-action" type="button" disabled={!selectedMachine} onClick={() => setModalMachine(selectedMachine)}><Icon name="edit" />Editar máquina</button><button className="machine-action machine-action--danger" type="button" disabled={!selectedMachine} onClick={() => removeSelected()}><Icon name="trash" />Remover máquina</button></div></div>
        <div className="machine-metrics"><div className="machine-metric"><span className="metric-icon metric-icon--blue"><Icon name="machines" /></span><div><span>Máquinas totais</span><strong>{machines.length}</strong><small>Parque de máquinas</small></div></div><div className="machine-metric"><span className="metric-icon metric-icon--green">▷</span><div><span>Em funcionamento</span><strong>{workingCount}</strong><small>{percentage(workingCount)} do total</small></div></div><div className="machine-metric"><span className="metric-icon metric-icon--blue">Ⅱ</span><div><span>Ociosas</span><strong>{idleCount}</strong><small>{percentage(idleCount)} do total</small></div></div></div>
        <section className="machine-list-card"><h2>Lista de máquinas</h2><div className="machine-table-scroll"><div className="machine-table"><div className="machine-row machine-row--header"><span>Máquina</span><span>Tipo</span><span>Setor</span><span>Status</span><span>Operador atual</span><span>Início de uso</span><span>Tempo de uso<br />Total hoje</span><span>Ações</span></div>{filteredMachines.map((machine) => <div className={`machine-row ${selectedId === machine.id ? 'machine-row--selected' : ''}`} key={machine.id} onClick={() => setSelectedId(machine.id)}><div className="machine-name"><Icon name="machines" /><strong>{machine.name}</strong></div><span>{machine.type}</span><span>{machine.sector}</span><span><span className={`machine-status machine-status--${machine.status}`}><i />{machine.status === 'working' ? 'Em funcionamento' : 'Ociosa'}</span></span><span>{machine.operator}</span><span>{machine.started}</span><span>{machine.usage}</span><div className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(machine.id) }} aria-label={`Visualizar ${machine.name}`}><Icon name="eye" /></button><button type="button" onClick={(event) => { event.stopPropagation(); setModalMachine(machine) }} aria-label={`Editar ${machine.name}`}><Icon name="edit" /></button><button className="row-delete" type="button" onClick={(event) => { event.stopPropagation(); removeSelected(machine) }} aria-label={`Remover ${machine.name}`}><Icon name="trash" /></button></div></div>)}</div></div></section>
        <div className="machine-summary-grid"><section className="machine-summary-card availability-card"><h2>Visão de disponibilidade</h2><div className="availability-content"><div className="availability-donut" style={{ '--working': percentage(workingCount) }}><strong>{machines.length}</strong><span>máquinas</span></div><div className="availability-legend"><div><i className="dot-green" />Em funcionamento <strong>{workingCount}</strong><span>{percentage(workingCount)}</span></div><div><i className="dot-gray" />Ociosas <strong>{idleCount}</strong><span>{percentage(idleCount)}</span></div></div></div></section><section className="machine-summary-card"><h2>Tempo de uso (hoje)</h2>{machines.filter((machine) => machine.status === 'working').map((machine) => <div className="usage-line" key={machine.id}><i className="dot-green" /><span>{machine.name}</span><strong>{machine.usage}</strong></div>)}</section><section className="machine-summary-card"><h2>Máquinas ociosas (hoje)</h2>{machines.filter((machine) => machine.status === 'idle').map((machine) => <div className="usage-line" key={machine.id}><i className="dot-gray" /><span>{machine.name}</span><strong>{machine.usage}</strong></div>)}</section></div>
      </main>
      {modalMachine !== undefined && <MachineModal machine={modalMachine} onClose={() => setModalMachine(undefined)} onSave={saveMachine} />}
    </div>
  )
}

function InventoryScreen({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, orders, onSelectOffer, onSelectOrder, requestStatuses, onRequestStatuses }) {
  const [items, setItems] = useState(readInventory)
  const [search, setSearch] = useState('')
  const [modalItem, setModalItem] = useState(undefined)
  const [purchaseRequest, setPurchaseRequest] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState('')
  const [savingInventory, setSavingInventory] = useState(false)
  const filteredItems = items.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(search.trim().toLowerCase()))
  const totalWeight = items.reduce((total, item) => total + Number(item.quantity || 0), 0)
  const lowStock = items.filter((item) => Number(item.quantity) <= Number(item.minimum)).length
  const pendingRequests = pendingInventoryRequests(offers, orders, items, requestStatuses)

  useEffect(() => {
    let active = true
    const refresh = () => loadOverviewInventory()
      .then((payload) => {
        if (!active || !Array.isArray(payload.items)) return
        setItems(payload.items)
        setSource(payload.source)
        setError('')
      })
      .catch((failure) => { if (active) setError(failure.message) })
    refresh()
    const polling = window.setInterval(refresh, 10000)
    return () => { active = false; window.clearInterval(polling) }
  }, [])

  async function saveItem(item) {
    if (savingInventory || !source) return
    if (source === 'server') {
      setSavingInventory(true)
      setError('')
      try {
        if (item.id && Number(item.stockEntryQuantity) > 0) {
          await apiRequest(`/api/inventory/${item.id}/movements`, jsonOptions('POST', { type: 'entry', quantityKg: Number(item.stockEntryQuantity), unitPrice: Number(item.unitPrice), destination: 'Entrada de estoque' }))
        } else {
          const body = { name: item.name, detail: item.detail, minimum: item.minimum, unitPrice: item.unitPrice, ...(!item.id ? { quantity: item.quantity } : {}) }
          await apiRequest(item.id ? `/api/inventory/${item.id}` : '/api/inventory', jsonOptions(item.id ? 'PATCH' : 'POST', body))
        }
        setModalItem(undefined)
        const result = await loadOverviewInventory()
        setItems(result.items)
      } catch (failure) { setError(failure.message) }
      finally { setSavingInventory(false) }
      return
    }
    const isNew = !item.id
    const nextId = isNew ? Math.max(0, ...items.map((current) => current.id)) + 1 : item.id
    const currentItem = items.find((current) => current.id === item.id)
    const entryQuantity = Number(item.stockEntryQuantity || 0)
    const isStockEntry = Boolean(!isNew && entryQuantity > 0)
    if (isStockEntry) {
      const currentQuantity = Number(currentItem.quantity || 0)
      const currentUnitPrice = Number(currentItem.unitPrice || 0)
      const entryUnitPrice = Number(item.unitPrice || 0)
      const nextBalance = currentQuantity + entryQuantity
      const weightedUnitPrice = nextBalance > 0
        ? ((currentQuantity * currentUnitPrice) + (entryQuantity * entryUnitPrice)) / nextBalance
        : entryUnitPrice
      const nextItem = {
        ...currentItem,
        detail: item.detail,
        unitPrice: weightedUnitPrice,
        quantity: nextBalance,
        history: [...(currentItem.history || [createInventoryCreationLog(currentItem)]), { id: `entry-${Date.now()}`, type: 'entry', date: new Date().toISOString(), quantity: entryQuantity, balance: nextBalance, unitPrice: entryUnitPrice, destination: 'Entrada de estoque', order: '—' }],
      }
      const nextItems = items.map((current) => current.id === item.id ? nextItem : current)
      setItems(nextItems)
      persistInventory(nextItems)
      setModalItem(undefined)
      return
    }
    const nextItem = isNew
      ? { ...item, id: nextId }
      : { ...currentItem, ...item, quantity: currentItem.quantity, history: currentItem.history || [createInventoryCreationLog(currentItem)] }
    if (isNew) nextItem.history = [createInventoryCreationLog(nextItem)]
    const nextItems = isNew ? [...items, nextItem] : items.map((current) => current.id === item.id ? nextItem : current)
    setItems(nextItems)
    persistInventory(nextItems)
    setModalItem(undefined)

  }

  async function removeItem(item) {
    if (savingInventory || !source) return
    if (!window.confirm(`Remover ${item.name} do estoque?`)) return
    if (source === 'server') {
      setSavingInventory(true)
      try {
        await apiRequest(`/api/inventory/${item.id}`, { method: 'DELETE' })
        const result = await loadOverviewInventory()
        setItems(result.items)
        setError('')
      } catch (failure) { setError(failure.message) }
      finally { setSavingInventory(false) }
      return
    }
    const nextItems = items.filter((current) => current.id !== item.id)
    setItems(nextItems)
    persistInventory(nextItems)
  }

  async function openHistory(item) {
    setHistoryItem(item)
    try {
      const response = await fetch(`/api/inventory/${item.id}/history`)
      if (!response.ok) return
      const payload = await response.json()
      if (Array.isArray(payload.history) && payload.history.length) setHistoryItem({ ...item, history: payload.history })
    } catch {
      // O histórico local continua disponível quando o banco não está configurado.
    }
  }

  async function confirmPurchaseRequest() {
    if (!purchaseRequest || savingInventory) return
    setSavingInventory(true)
    try {
      const { items } = await apiRequest(`/api/material-requests/${encodeURIComponent(purchaseRequest.id)}/approve`, { method: 'POST' })
      onRequestStatuses(items)
      persistPendingMaterialRequests(items)
      setPurchaseRequest(null)
      setError('')
    } catch (failure) { setError(failure.message); setPurchaseRequest(null) }
    finally { setSavingInventory(false) }
  }

  return (
    <div className="dashboard-shell inventory-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="inventory-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="inventory-header"><div><span className="inventory-kicker">Controle de materiais</span><h1>Estoque</h1><p>Gerencie os materiais disponíveis para os serviços e propostas.</p></div><button className="inventory-add-button" type="button" onClick={() => setModalItem(null)}><Icon name="plus" />Adicionar material</button></div>
        <div className="inventory-metrics"><div><span className="inventory-metric-icon">▰</span><div><small>Materiais cadastrados</small><strong>{items.length}</strong></div></div><div><span className="inventory-metric-icon inventory-metric-icon--green">▣</span><div><small>Quantidade total</small><strong>{totalWeight.toLocaleString('pt-BR')} kg</strong></div></div><div><span className="inventory-metric-icon inventory-metric-icon--orange">!</span><div><small>Estoque baixo</small><strong>{lowStock}</strong></div></div></div>
        <section className="inventory-card"><div className="inventory-toolbar"><h2>Materiais em estoque</h2><label className="inventory-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar material ou especificação..." /></label></div><div className="inventory-table-scroll"><div className="inventory-table"><div className="inventory-row inventory-row--header"><span>Material</span><span>Especificação</span><span>Disponível</span><span>Estoque mínimo</span><span>Valor por kg</span><span>Status</span><span>Ações</span></div>{filteredItems.map((item) => <div className="inventory-row" key={item.id}><div className="inventory-material-name"><span>▰</span><strong>{item.name}</strong></div><span>{item.detail}</span><strong>{Number(item.quantity).toLocaleString('pt-BR')} kg</strong><span>{Number(item.minimum).toLocaleString('pt-BR')} kg</span><span>{Number(item.unitPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span><span className={`inventory-status inventory-status--${Number(item.quantity) <= Number(item.minimum) ? 'low' : 'available'}`}>{Number(item.quantity) <= Number(item.minimum) ? 'Estoque baixo' : 'Disponível'}</span><div className="inventory-row-actions"><button className="inventory-info" type="button" onClick={() => openHistory(item)} aria-label={`Ver histórico de ${item.name}`}><Icon name="info" /></button><button type="button" onClick={() => setModalItem(item)} aria-label={`Editar ${item.name}`}><Icon name="edit" /></button><button className="inventory-delete" type="button" onClick={() => removeItem(item)} aria-label={`Remover ${item.name}`}><Icon name="trash" /></button></div></div>)}</div></div>{filteredItems.length === 0 && <div className="inventory-empty">Nenhum material encontrado.</div>}</section>
        <section className="pending-material-card">
          <div className="pending-material-heading"><div><span className="inventory-kicker">Pré-cadastro</span><h2>Produtos solicitados pendentes</h2><p>Materiais usados em ofertas que ainda não foram cadastrados no estoque.</p></div><strong>{pendingRequests.length} {pendingRequests.length === 1 ? 'pendência' : 'pendências'}</strong></div>
          {pendingRequests.length > 0 ? <div className="pending-material-list">
            <div className="pending-material-row pending-material-row--header"><span>Material</span><span>Especificação</span><span>Quantidade</span><span>OS / Oferta relacionada</span><span>Status</span><span>Ação</span></div>
            {pendingRequests.map((request) => <div className="pending-material-row" key={request.id}>
              <div><strong>{request.name}</strong><small>{displayDate(request.requestedAt)}</small></div><span>{request.detail || '—'}</span><strong>{Number(request.quantity).toLocaleString('pt-BR')} kg</strong>
              <button className="pending-material-os material-order-link" type="button" onClick={() => request.orderCode ? onSelectOrder(request.orderCode) : onSelectOffer(request.offerId)}>{request.os}</button>
              <span className={`pending-material-status pending-material-status--${request.status}`}>{request.status === 'purchase-requested' ? 'Compra solicitada' : 'Pendente'}</span>
              {request.status === 'purchase-requested' ? <span className="pending-material-done">Em andamento</span> : <button className="purchase-request-button" type="button" onClick={() => setPurchaseRequest(request)}>Abrir solicitação de compra</button>}
            </div>)}
          </div> : <div className="pending-material-empty">Nenhum produto solicitado pendente.</div>}
        </section>
        {error && modalItem === undefined && <p role="alert" className="workflow-error">{error}</p>}
      </main>
      {modalItem !== undefined && <InventoryModal item={modalItem} inventoryItems={items} saving={savingInventory || !source} error={error} onClose={() => { if (!savingInventory) setModalItem(undefined) }} onSave={saveItem} />}
      {historyItem && <InventoryHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}
      {purchaseRequest && <div className="modal-backdrop purchase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPurchaseRequest(null) }}><section className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title" onMouseDown={(event) => event.stopPropagation()}><button className="purchase-modal-close" type="button" onClick={() => setPurchaseRequest(null)} aria-label="Fechar">×</button><span className="inventory-kicker">Solicitação de compra</span><h2 id="purchase-modal-title">Abrir compra de material</h2><p>Confirme a solicitação para que o setor responsável possa providenciar o material.</p><div className="purchase-modal-summary"><strong>{purchaseRequest.name}</strong><span>{purchaseRequest.detail || 'Especificação não informada'}</span><span>{Number(purchaseRequest.quantity).toLocaleString('pt-BR')} kg · {purchaseRequest.os}</span></div><div className="inventory-modal-actions"><button className="offer-modal-cancel" type="button" onClick={() => setPurchaseRequest(null)}>Cancelar</button><button className="purchase-request-button" type="button" onClick={confirmPurchaseRequest}>Confirmar solicitação</button></div></section></div>}
    </div>
  )
}

function InventoryHistoryModal({ item, onClose }) {
  const history = [...(item.history || [])].sort((left, right) => new Date(right.date) - new Date(left.date))
  const formatDate = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  }
  const movementLabel = { creation: 'Criação do material', entry: 'Entrada de material', exit: 'Saída de material' }

  return <div className="modal-backdrop inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="inventory-history-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-history-title" onMouseDown={(event) => event.stopPropagation()}><button className="inventory-modal-close" type="button" onClick={onClose} aria-label="Fechar">×</button><span className="inventory-kicker">Rastreabilidade do estoque</span><h2 id="inventory-history-title">Histórico do material</h2><div className="inventory-history-summary"><div><small>Material</small><strong>{item.name}</strong><span>{item.detail || 'Sem especificação'}</span></div><div><small>Saldo atual</small><strong>{Number(item.quantity).toLocaleString('pt-BR')} kg</strong></div></div><div className="inventory-history-heading"><h3>Movimentações registradas</h3><span>{history.length} {history.length === 1 ? 'registro' : 'registros'}</span></div><div className="inventory-history-table"><div className="inventory-history-row inventory-history-row--header"><span>Data</span><span>Movimentação</span><span>Quantidade</span><span>Valor por kg</span><span>Saldo após movimento</span><span>Destino / OS</span></div>{history.map((entry) => <div className="inventory-history-row" key={entry.id}><span>{formatDate(entry.date)}</span><strong className={`inventory-history-type inventory-history-type--${entry.type}`}>{movementLabel[entry.type] || 'Movimentação'}</strong><span className={entry.type === 'exit' ? 'inventory-history-quantity--exit' : 'inventory-history-quantity--entry'}>{entry.type === 'exit' ? '−' : '+'}{Number(entry.quantity || 0).toLocaleString('pt-BR')} kg</span><strong className="inventory-history-price">{Number(entry.unitPrice || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/kg</strong><span>{Number(entry.balance || 0).toLocaleString('pt-BR')} kg</span><span>{entry.destination || '—'}{entry.order && entry.order !== '—' ? <small>{entry.order}</small> : null}</span></div>)}</div><p className="inventory-history-note">O valor exibido é o preço unitário praticado em cada movimentação. O saldo atual usa o preço médio ponderado.</p></section></div>
}

function InventoryModal({ item, inventoryItems = [], saving = false, error = '', onClose, onSave }) {
  const [form, setForm] = useState(item || { name: '', detail: '', quantity: '', minimum: '', unitPrice: '' })
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false)
  const [selectedExistingId, setSelectedExistingId] = useState(null)
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const isStockEntry = !item && selectedExistingId !== null
  const selectedExistingMaterial = inventoryItems.find((material) => material.id === selectedExistingId)
  const entryQuantity = Number(form.quantity) || 0
  const entryUnitPrice = Number(form.unitPrice) || 0
  const currentQuantity = Number(selectedExistingMaterial?.quantity || 0)
  const currentUnitPrice = Number(selectedExistingMaterial?.unitPrice || 0)
  const projectedUnitPrice = currentQuantity + entryQuantity > 0
    ? ((currentQuantity * currentUnitPrice) + (entryQuantity * entryUnitPrice)) / (currentQuantity + entryQuantity)
    : 0
  const matchingMaterials = inventoryItems.filter((material) => {
    if (item && material.id === item.id) return false
    const query = form.name.trim().toLowerCase()
    return !query || `${material.name} ${material.detail}`.toLowerCase().includes(query)
  })

  function selectExistingMaterial(material) {
    setSelectedExistingId(material.id)
    setForm((current) => ({ ...current, name: material.name, detail: material.detail, quantity: '', unitPrice: material.unitPrice }))
    setNameSuggestionsOpen(false)
  }
  function submit(event) {
    event.preventDefault()
    if (saving) return
    if (isStockEntry) {
      const entryQuantity = Number(form.quantity) || 0
      if (entryQuantity <= 0) return
      onSave({ ...form, id: selectedExistingId, stockEntryQuantity: entryQuantity, minimum: 0, unitPrice: Number(form.unitPrice) || 0 })
      return
    }
    onSave({ ...form, quantity: item ? Number(item.quantity) || 0 : Number(form.quantity) || 0, minimum: Number(form.minimum) || 0, unitPrice: Number(form.unitPrice) || 0 })
  }

  return <div className="modal-backdrop inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title" aria-busy={saving} onMouseDown={(event) => event.stopPropagation()}>
      <button className="inventory-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button>
      <span className="inventory-kicker">Estoque</span><h2 id="inventory-modal-title">{item ? 'Editar material' : 'Adicionar material'}</h2>
      {error && <p role="alert" className="workflow-error">{error}</p>}
      <form onSubmit={submit}>
        <label>Nome do material *<div className="material-autocomplete"><div className="material-autocomplete-input"><input value={form.name} onFocus={() => setNameSuggestionsOpen(true)} onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 120)} onChange={(event) => { update('name', event.target.value); setSelectedExistingId(null); setNameSuggestionsOpen(true) }} placeholder="Digite para buscar no estoque" required /><span>⌄</span></div>{nameSuggestionsOpen && <div className="material-suggestions">{matchingMaterials.length > 0 ? matchingMaterials.map((material) => <button type="button" key={material.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectExistingMaterial(material)}><strong>{material.name}</strong><small>{material.detail}</small></button>) : <div className="material-suggestion-empty"><strong>Novo material</strong><span>Preencha os dados para cadastrar um novo material.</span></div>}</div>}</div></label>
        <label>Especificação<input value={form.detail} onChange={(event) => update('detail', event.target.value)} placeholder="Ex.: Chapa Alumínio 6061" /></label>
        {isStockEntry ? <label className="inventory-entry-field">Quantidade de entrada (kg) *<input type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="0,00" required /><small>Saldo atual: {currentQuantity.toLocaleString('pt-BR')} kg. Preço médio após a entrada: {projectedUnitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/kg.</small></label> : <div className="inventory-form-grid"><label className={item ? 'inventory-readonly-field' : ''}>{item ? 'Quantidade disponível (kg) — somente leitura' : 'Quantidade disponível (kg) *'}<input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} readOnly={Boolean(item)} aria-readonly={Boolean(item)} required /><small>{item ? 'Altere o saldo usando uma entrada ou saída de estoque.' : 'Informe o saldo inicial do material.'}</small></label><label>Estoque mínimo (kg)<input type="number" min="0" step="0.001" value={form.minimum} onChange={(event) => update('minimum', event.target.value)} /></label></div>}
        <label>Valor por kg<input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => update('unitPrice', event.target.value)} /></label>
        <div className="inventory-modal-actions"><button className="offer-modal-cancel" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="inventory-add-button" type="submit" disabled={saving}>{saving ? 'Salvando...' : isStockEntry ? 'Registrar entrada' : item ? 'Salvar alterações' : 'Adicionar material'}</button></div>
      </form>
    </section>
  </div>
}

const calculatorMaterials = [
  { key: 'carbon', name: 'Aço Carbono', density: 8 },
  { key: 'stainless', name: 'Aço Inox', density: 8 },
  { key: 'aluminum', name: 'Alumínio', density: 2.75 },
  { key: 'bronze', name: 'Bronze', density: 9 },
  { key: 'copper', name: 'Cobre', density: 9 },
  { key: 'brass', name: 'Latão', density: 8.7 },
]

const conversionFractions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
const conversionOptions = Array.from({ length: 24 }, (_, whole) => conversionFractions
    .filter((fraction) => whole < 23 || fraction < 32)
    .map((fraction) => whole * 32 + fraction))
  .flat()
  .map((numerator, index) => {
  const whole = Math.floor(numerator / 32)
  const remainder = numerator % 32
  const greatestCommonDivisor = (a, b) => (b ? greatestCommonDivisor(b, a % b) : a)
  const divisor = remainder ? greatestCommonDivisor(remainder, 32) : 1
  const fraction = remainder ? `${remainder / divisor}/${32 / divisor}` : ''
  const inchLabel = whole ? (fraction ? `${whole}.${fraction}` : `${whole}`) : fraction
  const millimeter = Number(((numerator / 32) * 25.4).toFixed(2))
  return { key: String(index), inchLabel, millimeter, millimeterLabel: millimeter.toFixed(2).replace('.', ',') }
})

const calculatorFormats = [
  { key: 'flat', name: 'Barra Chata', icon: '▱', materials: ['carbon', 'stainless', 'bronze', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'square', name: 'Barra Quadrada', icon: '◇', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Lado']] },
  { key: 'round', name: 'Barra Redonda', icon: '◉', materials: ['carbon', 'stainless', 'aluminum', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['diameter', 'Diâmetro']] },
  { key: 'rectangular', name: 'Barra Retangular', icon: '▰', materials: ['copper', 'brass', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'hex', name: 'Barra Sextavada', icon: '⬡', materials: ['carbon', 'stainless', 'aluminum', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Altura']] },
  { key: 'coil', name: 'Bobina', icon: '◎', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'bushing', name: 'Bucha', icon: '◉', materials: ['bronze'], resultLabel: 'peça com 500 mm', resultUnit: 'kg', fields: [['outerDiameter', 'Diâmetro externo'], ['innerDiameter', 'Diâmetro interno']] },
  { key: 'plate', name: 'Chapa', icon: '▱', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'peça', resultUnit: 'kg', fields: [['thickness', 'Espessura'], ['width', 'Largura'], ['length', 'Comprimento']] },
  { key: 'checkered', name: 'Chapa Xadrez', icon: '▤', materials: ['carbon', 'aluminum'], resultLabel: 'peça', resultUnit: 'kg', fields: [['thickness', 'Espessura'], ['width', 'Largura'], ['length', 'Comprimento']] },
  { key: 'angle', name: 'Perfil L', icon: '⌞', materials: ['carbon', 'stainless', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'tee', name: 'Perfil T', icon: '⊥', materials: ['aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'channel', name: 'Perfil U', icon: '∪', materials: ['carbon', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'unequalChannel', name: 'Perfil U (abas desiguais) / dobrado', icon: '∪', materials: ['carbon'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['base', 'Base'], ['flangeLarge', 'Aba maior'], ['flangeSmall', 'Aba menor']] },
  { key: 'billet', name: 'Tarugo', icon: '▣', materials: ['bronze'], resultLabel: 'peça com 500 mm', resultUnit: 'kg', fields: [['diameter', 'Diâmetro']] },
  { key: 'squareTube', name: 'Tubo Quadrado', icon: '□', materials: ['carbon', 'aluminum', 'copper', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['side', 'Lado']] },
  { key: 'roundTube', name: 'Tubo Redondo', icon: '◎', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['diameter', 'Diâmetro']] },
  { key: 'rectangularTube', name: 'Tubo Retangular', icon: '▭', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['sideOne', 'Lado 1'], ['sideTwo', 'Lado 2']] },
  { key: 'scheduleTube', name: 'Tubo Schedule', icon: '◎', materials: ['carbon', 'stainless', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['diameter', 'Diâmetro']] },
  { key: 'squareRebar', name: 'Vergalhão Quadrado', icon: '□', materials: ['brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Lado']] },
  { key: 'roundRebar', name: 'Vergalhão Redondo', icon: '◉', materials: ['stainless', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['diameter', 'Diâmetro']] },
  { key: 'hexRebar', name: 'Vergalhão Sextavado', icon: '⬡', materials: ['brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Distância']] },
]

function calculatorVolume(format, values) {
  const n = (field) => Number(values[field]) || 0
  const t = n('thickness')
  const w = n('width')
  const h = n('height')
  const d = n('diameter')
  const s = n('side')
  const outer = n('outerDiameter')
  const inner = n('innerDiameter')
  const length = n('length')
  const sideOne = n('sideOne')
  const sideTwo = n('sideTwo')
  switch (format) {
    case 'flat':
    case 'rectangular':
    case 'coil': return (t * w) / 1000
    case 'plate': return (t * w * length) / 1000000
    case 'checkered': return ((t * w * length) / 1000000) * 1.1
    case 'square':
    case 'squareRebar': return (s ** 2) / 1000
    case 'round':
    case 'roundRebar': return (d ** 2 * 0.7854) / 1000
    case 'hex':
    case 'hexRebar': return (s ** 2 * 0.866) / 1000
    case 'bushing': return outer > inner ? ((outer + 1.58) ** 2 - (inner - 1.58) ** 2) * 0.003534 : 0
    case 'billet': return d ? ((d + 1.58) ** 2 * 0.7854) / 2000 : 0
    case 'angle':
    case 'tee': return (2 * w * t - t ** 2) / 1000
    case 'channel': return (3 * w * t - 2 * t ** 2) / 1000
    case 'unequalChannel': return ((n('base') + n('flangeLarge') + n('flangeSmall')) * t) / 1000
    case 'squareTube': return s > (2 * t) ? ((2 * s - 2 * t) * 2 * t) / 1000 : 0
    case 'roundTube':
    case 'scheduleTube': return (Math.PI * t * (d - t)) / 1000
    case 'rectangularTube': return sideOne > (2 * t) && sideTwo > (2 * t) ? ((sideOne + sideTwo - (2 * t)) * 2 * t) / 1000 : 0
    default: return 0
  }
}

function calculatorWeight(format, material, values) {
  const volume = calculatorVolume(format, values)
  return format === 'bushing' ? volume : volume * material.density
}

function CalculatorFormatIcon({ format }) {
  const shapes = {
    flat: <path d="m5 20 4-14h15l-4 14H5Z" />,
    square: <path d="m7 8 10-4 8 4v10l-10 4-8-4V8Zm0 0 8 4 10-4m-10 4v10" />,
    round: <><ellipse cx="9" cy="12" rx="4" ry="7" /><path d="M9 5h10c3 0 5 3 5 7s-2 7-5 7H9" /><ellipse cx="19" cy="12" rx="4" ry="7" /></>,
    rectangular: <path d="m4 18 4-13h17l-4 13H4Z" />,
    hex: <path d="m5 9 8-5 8 5v8l-8 5-8-5V9Zm0 0 8 5 8-5m-8 5v8" />,
    coil: <><circle cx="13" cy="12" r="9" /><circle cx="13" cy="12" r="6" /><circle cx="13" cy="12" r="3" /></>,
    bushing: <><ellipse cx="8" cy="12" rx="4" ry="7" /><path d="M8 5h10c3 0 5 3 5 7s-2 7-5 7H8" /><ellipse cx="18" cy="12" rx="5" ry="7" /><ellipse cx="18" cy="12" rx="2.5" ry="4" /></>,
    plate: <path d="m4 18 5-13h17l-5 13H4Zm5-13 7 4m10-4-7 13" />,
    checkered: <path d="m4 18 5-13h17l-5 13H4Zm4-2h14M9 5l7 4m10-4-7 13" />,
    angle: <path d="M6 4h7v13h13v6H6V4Z" />,
    tee: <path d="M4 5h22v6h-8v13h-6V11H4V5Z" />,
    channel: <path d="M6 4h18v5H12v10h12v5H6V4Z" />,
    unequalChannel: <path d="M5 4h19v5H11v5h10v5H11v5H5V4Z" />,
    billet: <><ellipse cx="13" cy="12" rx="8" ry="9" /><path d="M13 3h5c4 0 7 4 7 9s-3 9-7 9h-5" /></>,
    squareTube: <><path d="m5 8 10-4 8 4v11l-10 3-8-4V8Zm0 0 8 4m10-4-10 4m0 0v10" /><path d="m10 10 3 1.5v5l-3-1.2v-5.3Z" /></>,
    roundTube: <><path d="m8 6 11-2c4-.4 7 3 7 8s-3 8-7 9l-11 2" /><ellipse cx="8" cy="14.5" rx="5" ry="8.5" transform="rotate(12 8 14.5)" /><ellipse cx="8" cy="14.5" rx="2.5" ry="5.5" transform="rotate(12 8 14.5)" /></>,
    rectangularTube: <><path d="m4 9 10-5h12v11l-10 5H4V9Zm0 0h12l10-5m-10 5v11" /><path d="m8 12 6-0.1v4l-6 .1v-4Z" /></>,
    scheduleTube: <><ellipse cx="8" cy="12" rx="5" ry="8" /><ellipse cx="8" cy="12" rx="2.5" ry="5" /><path d="M8 4h12c3 0 5 3 5 8s-2 8-5 8H8" /></>,
    squareRebar: <path d="m5 8 10-4 8 4v11l-10 3-8-4V8Zm0 0 8 4m10-4-10 4m0 0v10" />,
    roundRebar: <><ellipse cx="8" cy="12" rx="4" ry="7" /><path d="M8 5h12c3 0 5 3 5 7s-2 7-5 7H8" /><ellipse cx="20" cy="12" rx="4" ry="7" /></>,
    hexRebar: <><path d="m5 9 7-5 7 4v8l-7 5-7-4V9Zm0 0 7 4 7-5m-7 5v8" /><path d="m19 8 5 3v8l-5 2" /></>,
  }
  return <svg className="calculator-format-icon" viewBox="0 0 30 28" aria-hidden="true">{shapes[format] || <path d="M5 5h20v18H5z" />}</svg>
}

function Calculator({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }) {
  const [material, setMaterial] = useState('carbon')
  const [format, setFormat] = useState('flat')
  const [values, setValues] = useState({})
  const [conversion, setConversion] = useState('')
  const selectedFormat = calculatorFormats.find((item) => item.key === format)
  const selectedMaterial = calculatorMaterials.find((item) => item.key === material)
  const visibleFormats = calculatorFormats.filter((item) => item.materials.includes(material))
  const weightValue = calculatorWeight(format, selectedMaterial, values)
  const weight = weightValue > 0 ? weightValue : null
  const fieldPrefixes = { thickness: 'E', width: 'L', side: 'L', diameter: 'D', outerDiameter: 'DE', innerDiameter: 'DI', length: 'C', base: 'B', flangeLarge: 'A1', flangeSmall: 'A2', sideOne: 'L1', sideTwo: 'L2' }

  function formatWeight(value) {
    const inTons = value >= 1000
    const result = inTons ? value / 1000 : value
    return `${Number(result.toFixed(3)).toString().replace('.', ',')} ${inTons ? 't' : 'kg'}`
  }

  function selectMaterial(nextMaterial) {
    const nextFormat = calculatorFormats.find((item) => item.materials.includes(nextMaterial))
    setMaterial(nextMaterial)
    setFormat(nextFormat.key)
    setValues({})
  }

  return (
    <div className="dashboard-shell calculator-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="calculator-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="calculator-header"><div><span className="calculator-kicker">Ferramentas de produção</span><h1>Calculadora de pesos e medidas</h1><p>Selecione o material, o formato e informe as medidas em milímetros.</p></div><div className="calculator-unit-badge">Resultado por <strong>{selectedFormat.resultLabel}</strong></div></div>
        <div className="calculator-workspace">
          <section className="calculator-materials"><h2>Primeiro escolha o <strong>Material</strong></h2><div className="material-list">{calculatorMaterials.map((item) => <button className={'material-option ' + (material === item.key ? 'material-option--selected' : '')} type="button" key={item.key} onClick={() => selectMaterial(item.key)}>{item.name}</button>)}</div><div className="density-note"><span>Densidade selecionada</span><strong>{selectedMaterial.density.toFixed(2).replace('.', ',')} g/cm³</strong></div></section>
          <section className="calculator-formats"><h2>Escolha o <strong>Formato</strong></h2><div className="format-grid">{visibleFormats.map((item) => <button className={'format-option ' + (format === item.key ? 'format-option--selected' : '')} type="button" key={item.key} onClick={() => { setFormat(item.key); setValues({}) }}><span className="format-icon"><CalculatorFormatIcon format={item.key} /></span><span>{item.name}</span></button>)}</div></section>
          <section className="calculator-measures"><h2>Calcule por <strong>Medidas</strong></h2><div className="measure-fields">{selectedFormat.fields.map(([key, label]) => <label key={key}><span><b>{fieldPrefixes[key] || 'M'}</b> {label} (mm)</span><input type="number" min="0" step="0.01" value={values[key] || ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="-" /></label>)}</div><div className="weight-result"><span>Peso por {selectedFormat.resultLabel}</span><strong>{weight ? formatWeight(weight) : '-'}</strong></div><button className="calculator-clear" type="button" onClick={() => setValues({})}>Limpar medidas</button></section>
        </div>
        <div className="calculator-footnote"><strong>Como funciona?</strong><span>Selecione o material, escolha o formato e preencha as medidas em milímetros. O valor é calculado usando a densidade do material.</span></div>
        <section className="conversion-panel"><div className="conversion-copy"><h2>Conversão de Medidas</h2><p><strong>Precisão e eficiência</strong> nos processos produtivos são fundamentais. Converta medidas com a mesma tabela de referência usada na calculadora.</p></div><div className="conversion-controls"><label><span>Polegadas (&quot;)</span><select size="10" value={conversion} onChange={(event) => setConversion(event.target.value)}><option value="" disabled>Selecione</option>{conversionOptions.map((option) => <option value={option.key} key={option.key}>{option.inchLabel}</option>)}</select></label><span className="conversion-equals">=</span><label><span>Milímetros (mm)</span><select size="10" value={conversion} onChange={(event) => setConversion(event.target.value)}><option value="" disabled>Selecione</option>{conversionOptions.map((option) => <option value={option.key} key={option.key}>{option.millimeterLabel}</option>)}</select></label><div className="conversion-result">{conversion ? <><strong>{conversionOptions[Number(conversion)].inchLabel}&quot;</strong><span>=</span><strong>{conversionOptions[Number(conversion)].millimeterLabel} mm</strong></> : <><span>—</span><span>=</span><span>—</span></>}</div></div></section>
      </main>
    </div>
  )
}

function RegistrationScreen({ kind, collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }) {
  const isEmployee = kind === 'employee'
  const isClient = kind === 'client'
  const [records, setRecords] = useState([])
  const endpoint = isEmployee ? '/api/employees' : isClient ? '/api/clients' : '/api/admins'
  const [form, setForm] = useState(isClient ? { name: '', documentType: 'cnpj', document: '', email: '' } : { name: '', birthDate: '', cpf: '', email: '', password: '', identification: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [activityEmployee, setActivityEmployee] = useState(null)

  useEffect(() => {
    apiRequest(endpoint).then((data) => setRecords(data.items)).catch((error) => setMessage(error.message))
  }, [endpoint])

  function formatClientDocument(value, documentType = form.documentType) {
    const digits = value.replace(/\D/g, '').slice(0, documentType === 'cnpj' ? 14 : 11)
    if (documentType === 'cnpj') return digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
    return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isEmployee && !/^\d{3}$/.test(form.identification)) {
      setMessage('Informe o código de identificação com 3 dígitos.')
      return
    }
    if (isEmployee) {
      try {
        await apiRequest(editingId !== null ? `/api/employees/${editingId}` : '/api/employees', jsonOptions(editingId !== null ? 'PUT' : 'POST', form))
        const data = await apiRequest('/api/employees')
        setRecords(data.items)
        setMessage(editingId !== null ? 'Funcionário atualizado com sucesso.' : 'Funcionário cadastrado com sucesso.')
        clearForm()
      } catch (error) { setMessage(error.message) }
      return
    }
    if (isClient) {
      const documentDigits = String(form.document || '').replace(/\D/g, '')
      const expectedLength = form.documentType === 'cnpj' ? 14 : 11
      if (documentDigits.length !== expectedLength) {
        setMessage(`Informe um ${form.documentType === 'cnpj' ? 'CNPJ' : 'CPF'} válido.`)
        return
      }
    }

    try {
      await apiRequest(editingId !== null ? `${endpoint}/${editingId}` : endpoint, jsonOptions(editingId !== null ? 'PUT' : 'POST', form))
      setRecords((await apiRequest(endpoint)).items)
      setMessage(`${isClient ? 'Cliente' : 'Administrador'} ${editingId !== null ? 'atualizado' : 'cadastrado'} com sucesso.`)
      clearForm()
    } catch (error) { setMessage(error.message) }
  }

  function clearForm() {
    setForm(isClient ? { name: '', documentType: 'cnpj', document: '', email: '' } : { name: '', birthDate: '', cpf: '', email: '', password: '', identification: '' })
    setEditingId(null)
    setShowPassword(false)
  }

  function editRecord(record) {
    setForm({ ...record, password: '' })
    setEditingId(record.id)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteRecord(id) {
    const record = records.find((item) => item.id === id)
    if (!record || !window.confirm(`Excluir o cadastro de ${record.name}?`)) return
    if (isEmployee) {
      try {
        await apiRequest(`/api/employees/${id}`, { method: 'DELETE' })
        setRecords((current) => current.filter((item) => item.id !== id))
        if (editingId === id) clearForm()
        setMessage('Funcionário excluído com sucesso. Os registros anteriores dele permanecem na OS.')
      } catch (error) { setMessage(error.message) }
      return
    }
    try {
      await apiRequest(`${endpoint}/${id}`, { method: 'DELETE' })
      setRecords((current) => current.filter((item) => item.id !== id))
      if (editingId === id) clearForm()
      setMessage(`${isClient ? 'Cliente' : 'Administrador'} excluído com sucesso.`)
    } catch (error) { setMessage(error.message) }
  }

  return (
    <div className="dashboard-shell registration-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="registration-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="registration-header"><div><span className="registration-kicker">{isClient ? 'Relacionamento' : 'Administração'}</span><h1>Cadastro de {isEmployee ? 'funcionário' : isClient ? 'cliente' : 'administrador'}</h1><p>{isClient ? 'Cadastre empresas e pessoas físicas para acompanhar suas solicitações e serviços.' : 'Informe apenas os dados necessários para criar o acesso ao sistema.'}</p></div><div className="registration-badge"><Icon name={isClient ? 'clients' : isEmployee ? 'employees' : 'admins'} /><span>{isClient ? 'Novo cliente' : isEmployee ? 'Novo funcionário' : 'Novo administrador'}</span></div></div>
        <div className="registration-layout">
          <section className="registration-card">
            <div className="registration-card-heading"><div><h2>{editingId !== null ? 'Editar cadastro' : isClient ? 'Dados do cliente' : 'Dados de acesso'}</h2><p>Os campos marcados com <b>*</b> são obrigatórios.</p></div><span className="required-note">Cadastro {isEmployee ? 'de funcionário' : isClient ? 'de cliente' : 'de ADM'}</span></div>
            <form onSubmit={handleSubmit}>
              <div className="registration-fields">
                <label className="registration-field registration-field--wide">{isClient ? 'Nome / Razão social *' : 'Nome completo *'}<input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder={isClient ? 'Digite o nome ou a razão social' : 'Digite o nome completo'} required /></label>
                {isClient ? <><label className="registration-field">Tipo de documento *<select value={form.documentType} onChange={(event) => { const documentType = event.target.value; update('documentType', documentType); update('document', formatClientDocument(form.document, documentType)) }}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option></select></label><label className="registration-field">{form.documentType === 'cnpj' ? 'CNPJ' : 'CPF'} *<input value={form.document} onChange={(event) => update('document', formatClientDocument(event.target.value))} inputMode="numeric" placeholder={form.documentType === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'} required /></label><label className="registration-field registration-field--wide">E-mail *<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="contato@empresa.com" required /></label></> : <><>{isEmployee && <label className="registration-field">Identificação *<input value={form.identification} onChange={(event) => update('identification', event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" maxLength={3} pattern="[0-9]{3}" placeholder="Ex.: 001" required /><small>Use exatamente 3 dígitos.</small></label>}</><label className="registration-field">Data de nascimento *<input type="date" value={form.birthDate} onChange={(event) => update('birthDate', event.target.value)} required /></label><label className="registration-field">CPF *<input value={form.cpf} onChange={(event) => update('cpf', event.target.value.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'))} inputMode="numeric" placeholder="000.000.000-00" required /></label><label className="registration-field registration-field--wide">E-mail *<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="nome@empresa.com" required /></label>{!isEmployee && <label className="registration-field registration-field--wide">Senha {editingId === null && '*'}<span className="registration-password"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={editingId !== null ? 'Deixe em branco para manter a senha atual' : 'Crie uma senha de acesso'} minLength={6} required={editingId === null} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}><EyeIcon crossed={!showPassword} /></button></span><small>{editingId !== null ? 'Preencha somente se quiser trocar a senha.' : 'Mínimo de 6 caracteres.'}</small></label>}</>}
              </div>
              {message && <p className={`registration-message ${message.includes('sucesso') ? 'registration-message--success' : 'registration-message--error'}`} role="status">{message}</p>}
              <div className="registration-actions"><button className="registration-clear" type="button" onClick={clearForm}>{editingId !== null ? 'Cancelar' : 'Limpar'}</button><button className="registration-submit" type="submit">{editingId !== null ? 'Salvar alterações' : `Cadastrar ${isEmployee ? 'funcionário' : isClient ? 'cliente' : 'administrador'}`}</button></div>
            </form>
          </section>
          <aside className="registration-help"><div className="registration-help-icon"><Icon name={isClient ? 'clients' : isEmployee ? 'employees' : 'admins'} /></div><h2>{isClient ? 'Cadastro do cliente' : isEmployee ? 'Acesso do funcionário' : 'Acesso administrativo'}</h2><p>{isClient ? 'Use CNPJ para empresas e CPF para pessoas físicas. O documento será usado para identificar o cliente.' : isEmployee ? 'Os funcionários usam uma conta compartilhada e se identificam antes de iniciar uma OS.' : 'Administradores poderão acessar as áreas de gestão do sistema.'}</p>{isEmployee && <div className="identification-example"><span>Campo no banco</span><strong>i_identificacao</strong><small>Exemplo: 001</small></div>}{isClient && <div className="identification-example"><span>Documentos aceitos</span><strong>CPF ou CNPJ</strong><small>Selecione o tipo no cadastro.</small></div>}<div className="registration-future"><span>Modo atual</span><strong>{isEmployee ? 'Cadastro persistido' : 'Dados demonstrativos'}</strong><small>{isEmployee ? 'Estes funcionários aparecem na seleção ao iniciar uma OS.' : 'A gravação definitiva será conectada ao MySQL.'}</small></div></aside>
        </div>
        <section className="registration-list-card">
          <div className="registration-list-heading"><div><span className="registration-kicker">Cadastros existentes</span><h2>{isEmployee ? 'Funcionários cadastrados' : isClient ? 'Clientes cadastrados' : 'Administradores cadastrados'}</h2></div><strong>{records.length} {records.length === 1 ? 'registro' : 'registros'}</strong></div>
          <div className={`registration-list${isEmployee ? ' registration-list--employees' : ''}`}>
            <div className="registration-list-row registration-list-row--header"><span>{isClient ? 'Tipo' : isEmployee ? 'Código' : 'ID'}</span><span>{isClient ? 'Nome / Razão social' : 'Nome'}</span><span>{isClient ? 'CPF / CNPJ' : 'CPF'}</span><span>E-mail</span><span>{isClient ? 'Cadastro' : 'Data de nascimento'}</span><span>Ações</span></div>
            {records.map((record) => <div className="registration-list-row" key={record.id}>
              <span className="registration-identification">{isClient ? record.documentType.toUpperCase() : isEmployee ? record.identification : `ADM-${String(record.id).padStart(3, '0')}`}</span><strong>{record.name}</strong><span>{isClient ? record.document : record.cpf}</span><span>{record.email || '—'}</span><span>{isClient ? 'Cliente ativo' : record.birthDate ? record.birthDate.split('-').reverse().join('/') : '—'}</span>
              <div className="registration-row-actions"><button className="registration-edit" type="button" onClick={() => !isEmployee && !isClient && Number(record.id) === 0 ? onNavigate('Configurações') : editRecord(record)}><Icon name="edit" />Editar</button><button className="registration-delete" type="button" onClick={() => deleteRecord(record.id)}><Icon name="trash" />Excluir</button>{isEmployee && <button className="registration-info" type="button" onClick={() => setActivityEmployee(record)} aria-label={`Ver histórico de ${record.name}`} title="Histórico de atividades"><Icon name="info" /></button>}</div>
            </div>)}
          </div>
        </section>
      </main>
      {activityEmployee && <EmployeeActivityModal employee={activityEmployee} onClose={() => setActivityEmployee(null)} />}
    </div>
  )
}

const offerFilters = [
  { key: 'review', label: 'Em análise' },
  { key: 'proposed', label: 'Propostas' },
  { key: 'accepted', label: 'Aceitas' },
]

function Offers({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, onRefresh, onSelectOffer, onSelectOrder, workflowError }) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const emptyForm = { cnpj: '', company: '', deadline: '', service: '', quantity: '', description: '', labelNumber: '', attachment: null }
  const [manualForm, setManualForm] = useState(emptyForm)
  const filteredOffers = offers.filter((offer) => {
    const query = search.trim().toLocaleLowerCase()
    return (activeFilter === 'all' || offer.status === activeFilter)
      && (!query || [offer.service, offer.company, offer.code, offer.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      && (!date || offer.requestedAt.slice(0, 10) === date)
  })

  function updateManualForm(field, value) {
    setManualForm((current) => ({ ...current, [field]: value }))
  }

  function formatCnpj(value) {
    return value.replace(/\D/g, '').slice(0, 14).replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }

  async function addOffer(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    let created = false
    try {
      const { attachment, ...fields } = manualForm
      const { item } = await apiRequest('/api/offers', jsonOptions('POST', fields))
      created = true
      if (attachment) await uploadOfferAttachment(item.id, attachment)
      await onRefresh()
      setManualForm(emptyForm)
      setManualOpen(false)
      setActiveFilter('all')
      setDate('')
    } catch (caught) {
      setError(created ? `Solicitação cadastrada, mas não foi possível salvar o anexo ou atualizar a lista: ${caught.message}` : caught.message)
      if (created) {
        setManualForm(emptyForm)
        setManualOpen(false)
        setActiveFilter('all')
        setDate('')
      }
      try { await onRefresh() } catch { /* O erro de carregamento aparece na tela. */ }
    } finally {
      setSaving(false)
    }
  }

  async function acceptOffer(offer) {
    setError('')
    try {
      await apiRequest(`/api/offers/${offer.id}/accept`, { method: 'POST' })
      await onRefresh()
    } catch (caught) {
      setError(caught.message)
    }
  }

  return (
    <div className="dashboard-shell offers-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="offers-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="offers-header"><div><h1>Ofertas de serviços</h1><p>Solicitações cadastradas para análise e retorno comercial.</p></div></div>
        {(error || workflowError) && <p className="workflow-error" role="alert">{error || workflowError}</p>}
        <section className="offers-board">
          <div className="offers-board-toolbar">
            <div className="offers-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por serviço, cliente, código ou etiqueta" /></div>
            <label className="offers-date"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <div className="offer-filters">
              {offerFilters.map((filter) => <button className={`offer-filter offer-filter--${filter.key} ${activeFilter === filter.key ? 'offer-filter--selected' : ''}`} type="button" key={filter.key} onClick={() => setActiveFilter(activeFilter === filter.key ? 'all' : filter.key)}><span>{filter.label}</span><strong>{offers.filter((offer) => offer.status === filter.key).length}</strong></button>)}
              <button className="manual-offer-button" type="button" onClick={() => { setError(''); setManualOpen(true) }}><Icon name="plus" />Inserir Oferta Manualmente</button>
            </div>
          </div>
          <div className="offers-table-wrap"><div className="offers-table">
            <div className="offers-table-row offers-table-header"><span>Peça / Serviço</span><span>Cliente</span><span>Etiqueta</span><span>Quantidade</span><span>Data de solicitação</span><span>Prazo solicitado</span><span>Status</span><span>Origem</span><span>Ações</span></div>
            {filteredOffers.map((offer) => <div className="offers-table-row" key={offer.id}>
              <div className="offer-piece"><strong>{offer.service}</strong><span>{offer.code}</span></div>
              <span>{offer.company}</span><span>{offer.labelNumber}</span><span>{offer.quantity} un</span><span>{displayDate(offer.requestedAt)}</span><span>{displayDate(offer.deadline)}</span>
              <div className={`offer-table-status offer-table-status--${offer.status}`}><strong>{offer.status === 'review' ? 'Em análise' : offer.status === 'proposed' ? 'Proposta gerada' : 'Aceita'}</strong>{offer.orderCode && <span>{offer.orderCode}</span>}</div>
              <span>{offer.origin}</span>
              <div className="offer-table-actions">
                {offer.status === 'accepted'
                  ? <button className="offer-review-button" type="button" onClick={() => onSelectOrder(offer.orderCode)}>Ver OS</button>
                  : <><button className="offer-review-button" type="button" onClick={() => onSelectOffer(offer.id)}>{offer.status === 'review' ? 'Em análise' : 'Ver proposta'}</button>{offer.proposal && <button className="offer-accept-button" type="button" onClick={() => acceptOffer(offer)}>✓ Aceitar Oferta</button>}</>}
              </div>
            </div>)}
          </div>{filteredOffers.length === 0 && <div className="offers-empty">Nenhuma oferta cadastrada para os filtros informados.</div>}</div>
        </section>
      </main>
      {manualOpen && <div className="modal-backdrop offer-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setManualOpen(false) }}>
        <section className="offer-manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-offer-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="offer-modal-header"><div><span className="offers-kicker">Nova solicitação</span><h2 id="manual-offer-title">Inserir oferta manualmente</h2><p>Preencha os dados da solicitação de serviço.</p></div><button className="offer-modal-close" type="button" onClick={() => setManualOpen(false)} aria-label="Fechar formulário">×</button></div>
          <form onSubmit={addOffer}><div className="offer-form-grid">
            <label>CNPJ *<input value={manualForm.cnpj} onChange={(event) => updateManualForm('cnpj', formatCnpj(event.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" required /></label>
            <label>Empresa *<input value={manualForm.company} onChange={(event) => updateManualForm('company', event.target.value)} placeholder="Nome da empresa" required /></label>
            <label>Prazo solicitado *<input type="date" value={manualForm.deadline} onChange={(event) => updateManualForm('deadline', event.target.value)} required /></label>
            <label>Peça/Serviço *<input value={manualForm.service} onChange={(event) => updateManualForm('service', event.target.value)} required /></label>
            <label>Quantidade *<input type="number" min="1" step="1" value={manualForm.quantity} onChange={(event) => updateManualForm('quantity', event.target.value)} required /></label>
            <label>Número da etiqueta *<input value={manualForm.labelNumber} onChange={(event) => updateManualForm('labelNumber', event.target.value)} required /></label>
            <label className="offer-form-field--full">Descrição do serviço *<textarea value={manualForm.description} onChange={(event) => updateManualForm('description', event.target.value)} rows="4" required /></label>
            <label className="offer-form-field--full offer-attachment-field">Anexo<span className="offer-file-picker"><input type="file" onChange={(event) => updateManualForm('attachment', event.target.files?.[0] || null)} /><span>Escolher arquivo</span><strong>{manualForm.attachment?.name || 'Nenhum arquivo selecionado'}</strong></span></label>
          </div>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="offer-modal-actions"><button className="offer-modal-cancel" type="button" onClick={() => setManualOpen(false)}>Cancelar</button><button className="manual-offer-button" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Adicionar solicitação'}</button></div></form>
        </section>
      </div>}
    </div>
  )
}
function OfferDetailsV2({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offer, onRefresh, onSelectOrder }) {
  const [inventory, setInventory] = useState(readInventory)
  const [machines, setMachines] = useState(readMachines)
  const [materials, setMaterials] = useState(offer?.resources?.materials || [])
  const [stages, setStages] = useState(offer?.resources?.stages ?? offer?.proposal?.stages ?? [])
  const [stageLayout, setStageLayout] = useState(() => readStageLayout({ ...offer?.resources, stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [] }))
  const [kind, setKind] = useState(offer?.resources?.kind ?? offer?.proposal?.kind ?? 'service')
  const [details, setDetails] = useState(() => serviceDetails(offer?.resources))
  const [materialFormOpen, setMaterialFormOpen] = useState(false)
  const [materialForm, setMaterialForm] = useState({ name: '', detail: '', quantity: '', unitPrice: '' })
  const [laborEntries, setLaborEntries] = useState(offer?.resources?.laborEntries || [])
  const [laborFormOpen, setLaborFormOpen] = useState(false)
  const [laborForm, setLaborForm] = useState({ type: 'machine', resource: '', hours: '', hourlyRate: '' })
  const [materialSuggestionsOpen, setMaterialSuggestionsOpen] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [saving, setSaving] = useState(false)
  const resourceDraft = useRef({ materials, laborEntries, stages, stageLayout, kind, ...details })
  const persistedResources = useRef(resourceDraft.current)
  const saveQueue = useRef(Promise.resolve())
  const pendingSaves = useRef(0)
  const activeOfferId = useRef(offer?.id)
  activeOfferId.current = offer?.id

  useEffect(() => {
    setMaterials(offer?.resources?.materials || [])
    setLaborEntries(offer?.resources?.laborEntries || [])
    setStages(offer?.resources?.stages ?? offer?.proposal?.stages ?? [])
    setStageLayout(readStageLayout({ ...offer?.resources, stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [] }))
    setKind(offer?.resources?.kind ?? offer?.proposal?.kind ?? 'service')
    setDetails(serviceDetails(offer?.resources))
    resourceDraft.current = {
      materials: offer?.resources?.materials || [],
      laborEntries: offer?.resources?.laborEntries || [],
      stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [],
      stageLayout: readStageLayout({ ...offer?.resources, stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [] }),
      kind: offer?.resources?.kind ?? offer?.proposal?.kind ?? 'service',
      ...serviceDetails(offer?.resources),
    }
    persistedResources.current = resourceDraft.current
  }, [offer?.id])

  useEffect(() => {
    let active = true
    apiRequest('/api/machines').then((data) => { if (active) setMachines(data.items) }).catch(() => {})
    loadOverviewInventory().then((data) => {
      if (active && Array.isArray(data.items)) setInventory(data.items)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const matchingInventory = inventory.filter((item) => {
    const query = normalizeSearch(materialForm.name)
    return !query || normalizeSearch(`${item.name} ${item.detail}`).includes(query)
  })
  const toNumber = (value) => {
    const text = String(value ?? '').trim()
    return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text) || 0
  }
  const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const materialsTotal = materials.reduce((total, material) => total + material.quantity * material.unitPrice, 0)
  const laborTotal = laborEntries.reduce((total, entry) => total + entry.hours * entry.hourlyRate, 0)

  async function saveResources(changes = {}) {
    if (!offer || offer.orderCode) return false
    const offerId = offer.id
    const draft = { ...resourceDraft.current, ...changes }
    resourceDraft.current = draft
    pendingSaves.current += 1
    setSaving(true)
    setAttachmentError('')
    // Serialize snapshots so rapid stage/type changes cannot overwrite newer choices.
    const task = saveQueue.current.then(async () => {
      try {
        const { item } = await apiRequest(`/api/offers/${offerId}/resources`, jsonOptions('PUT', draft))
        if (activeOfferId.current === offerId) persistedResources.current = item.resources
        if (activeOfferId.current === offerId && resourceDraft.current === draft) {
          setAttachmentError('')
          resourceDraft.current = item.resources
          setMaterials(item.resources.materials)
          setLaborEntries(item.resources.laborEntries)
          setStages(item.resources.stages)
          setStageLayout(readStageLayout(item.resources))
          setKind(item.resources.kind)
          setDetails(serviceDetails(item.resources))
        }
        await onRefresh()
        return true
      } catch (error) {
        if (activeOfferId.current === offerId && resourceDraft.current === draft) {
          resourceDraft.current = persistedResources.current
          setMaterials(persistedResources.current.materials)
          setLaborEntries(persistedResources.current.laborEntries)
          setStages(persistedResources.current.stages)
          setStageLayout(readStageLayout(persistedResources.current))
          setKind(persistedResources.current.kind)
          setDetails(serviceDetails(persistedResources.current))
        }
        if (activeOfferId.current === offerId) setAttachmentError(error.message)
        return false
      } finally {
        pendingSaves.current -= 1
        if (!pendingSaves.current) setSaving(false)
      }
    })
    saveQueue.current = task
    return task
  }

  function updateMaterial(field, value) {
    setMaterialForm((current) => ({ ...current, [field]: value }))
  }

  function selectInventoryMaterial(value, selectedItem) {
    const inventoryItem = selectedItem || findInventoryMaterial({ name: value }, inventory)
    setMaterialForm((current) => ({
      ...current,
      name: inventoryItem?.name || value,
      inventoryId: inventoryItem?.id ?? null,
      detail: inventoryItem ? inventoryItem.detail || '' : current.inventoryId != null ? '' : current.detail,
      unitPrice: inventoryItem ? String(inventoryItem.unitPrice || 0) : current.inventoryId != null ? '' : current.unitPrice,
    }))
  }

  async function addMaterial(event) {
    event.preventDefault()
    const quantity = toNumber(materialForm.quantity)
    const unitPrice = toNumber(materialForm.unitPrice)
    if (!materialForm.name.trim() || quantity <= 0) return
    const material = { ...materialForm, name: materialForm.name.trim(), id: crypto.randomUUID(), quantity, unitPrice, icon: '▰', requestedAt: new Date().toISOString() }
    if (!await saveResources({ materials: [...materials, { ...material, ...materialStock(material, inventory) }] })) return
    setMaterialForm({ name: '', detail: '', quantity: '', unitPrice: '' })
    setMaterialFormOpen(false)
  }

  function removeMaterial(id) {
    saveResources({ materials: materials.filter((material) => material.id !== id) })
  }

  function selectLaborType(type) {
    setLaborForm({ type, resource: '', hours: '', hourlyRate: '' })
  }

  function selectMachine(id) {
    const machine = machines.find((item) => String(item.id) === id)
    setLaborForm((current) => ({ ...current, machineId: machine?.id ?? '', resource: machine?.name || '', hourlyRate: machine?.hourlyRate ?? '' }))
  }

  function toggleStage(stage) {
    const currentStages = resourceDraft.current.stages
    const selected = currentStages.includes(stage) ? currentStages.filter((key) => key !== stage) : [...currentStages, stage]
    const nextStages = orderedStageSelection(resourceDraft.current.stageLayout, selected)
    setStages(nextStages)
    saveResources({ stages: nextStages })
  }

  function reorderStageLayout(nextLayout) {
    const nextStages = orderedStageSelection(nextLayout, resourceDraft.current.stages)
    setStageLayout(nextLayout)
    setStages(nextStages)
    saveResources({ stageLayout: nextLayout, stages: nextStages })
  }

  function selectKind(nextKind) {
    setKind(nextKind)
    saveResources({ kind: nextKind })
  }

  function updateDetails(field, value, persist = true) {
    setDetails((current) => ({ ...current, [field]: value }))
    if (persist) saveResources({ [field]: value })
    else resourceDraft.current = { ...resourceDraft.current, [field]: value }
  }

  async function addLabor(event) {
    event.preventDefault()
    const hours = toNumber(laborForm.hours)
    const hourlyRate = toNumber(laborForm.hourlyRate)
    if (!laborForm.resource.trim() || hours <= 0 || hourlyRate < 0 || laborForm.hourlyRate === '') return
    if (!await saveResources({ laborEntries: [...laborEntries, { ...laborForm, resource: laborForm.resource.trim(), id: crypto.randomUUID(), hours, hourlyRate }] })) return
    setLaborForm({ type: laborForm.type, resource: '', hours: '', hourlyRate: '' })
    setLaborFormOpen(false)
  }

  function removeLabor(id) {
    saveResources({ laborEntries: laborEntries.filter((entry) => entry.id !== id) })
  }

  async function addAttachment(event) {
    const file = event.target.files?.[0]
    if (!file || !offer) return
    setAttachmentError('')
    try {
      await uploadOfferAttachment(offer.id, file)
      await onRefresh()
    } catch (error) {
      setAttachmentError(error.message)
    }
    event.target.value = ''
  }

  async function goToProposal() {
    if (!offer) return
    if (!stages.length) {
      setAttachmentError('Selecione pelo menos uma etapa do serviço antes de fazer a proposta.')
      return
    }
    if (await saveResources()) onNavigate('Fazer proposta')
  }

  if (!offer) return <div className="dashboard-shell offer-details-shell"><Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} /><main className="offer-details-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} /><p>Selecione uma oferta na lista para ver os detalhes.</p><button type="button" onClick={() => onNavigate('Ofertas e serviços')}>Voltar às ofertas</button></main></div>

  return (
    <div className="dashboard-shell offer-details-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="offer-details-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="offer-details-header"><button className="offer-back-button" type="button" onClick={() => onNavigate('Ofertas e serviços')} aria-label="Voltar para ofertas">←</button><h1>Detalhes da oferta {offer.code}</h1></div>
        <div className="offer-details-grid">
          <section className="offer-information-card"><span className="offer-details-section-title">Informações do serviço</span><h2>{offer.service}</h2><p className="offer-details-description">{offer.description}</p><div className="offer-detail-facts"><div><span>▥</span><small>Cliente solicitante</small><strong>{offer.company}</strong><em>CNPJ: {offer.cnpj}</em></div><div><span>▣</span><small>Data da solicitação</small><strong>{displayDate(offer.requestedAt)}</strong></div><div><span>◇</span><small>Quantidade solicitada</small><strong>{offer.quantity} unidades</strong></div><div><span>◷</span><small>Prazo solicitado pelo cliente</small><strong>{displayDate(offer.deadline)}</strong></div></div><div className="offer-detail-text"><h3>Número da etiqueta</h3><p>{offer.labelNumber}</p></div><div className="offer-detail-text"><h3>Anexos da solicitação</h3>{offer.attachments?.length ? <ul>{offer.attachments.map((attachment) => <li key={attachment.id}><a href={attachmentUrl(offer.id, attachment.id)}>{attachment.name}</a></li>)}</ul> : <p>Nenhum anexo adicionado.</p>}</div>{offer.proposal && <div className="offer-detail-text"><h3>Proposta gerada</h3><p><a href={`/api/offers/${offer.id}/proposal.pdf`}>Baixar PDF da proposta</a></p></div>}</section>
          <section className="offer-materials-card offer-resources-card">
            <fieldset className="offer-resource-fields" disabled={Boolean(offer.orderCode)}>
            <div className="offer-resource-heading"><div><span className="offer-details-section-title">Materiais necessários</span><p>Adicione os materiais e informe a quantidade em kg.</p></div><button className="offer-add-resource-button" type="button" onClick={() => setMaterialFormOpen((current) => !current)}><Icon name="plus" />Adicionar material</button></div>
            {materialFormOpen && <form className="offer-inline-form" onSubmit={addMaterial}>
              <label>Material *<div className="material-autocomplete"><div className="material-autocomplete-input">
                <input value={materialForm.name} autoComplete="off" role="combobox" aria-expanded={materialSuggestionsOpen} aria-controls="offer-material-suggestions" onFocus={() => setMaterialSuggestionsOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.material-autocomplete')?.contains(event.relatedTarget)) setMaterialSuggestionsOpen(false) }} onChange={(event) => { selectInventoryMaterial(event.target.value); setMaterialSuggestionsOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setMaterialSuggestionsOpen(false); if (event.key === 'ArrowDown' && matchingInventory.length) { event.preventDefault(); document.getElementById('offer-material-suggestions')?.querySelector('button')?.focus() } }} placeholder="Digite para buscar no estoque" required /><span>⌄</span>
              </div>{materialSuggestionsOpen && <div className="material-suggestions" id="offer-material-suggestions" role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMaterialSuggestionsOpen(false) }}>
                {matchingInventory.length > 0 ? matchingInventory.map((item) => <button type="button" role="option" aria-selected={materialForm.inventoryId === item.id} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { selectInventoryMaterial(item.name, item); setMaterialSuggestionsOpen(false) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') setMaterialSuggestionsOpen(false) }}><strong>{item.name}</strong><small>{item.detail} · {Number(item.quantity).toLocaleString('pt-BR')} kg · {formatMoney(item.unitPrice)}/kg</small></button>) : <div className="material-suggestion-empty"><strong>Novo material</strong><span>{materialForm.name.trim() || 'Material não cadastrado'}</span></div>}
              </div>}</div></label>
              <label>Especificação<input value={materialForm.detail} onChange={(event) => updateMaterial('detail', event.target.value)} placeholder="Ex.: Chapa 10 mm" /></label>
              <label>Quantidade (kg) *<input type="number" min="0.001" step="0.001" value={materialForm.quantity} onChange={(event) => updateMaterial('quantity', event.target.value)} placeholder="0,00" required /></label>
              <label>Valor unitário<input type="number" min="0" step="0.01" value={materialForm.unitPrice} onChange={(event) => updateMaterial('unitPrice', event.target.value)} placeholder="0,00" /></label>
              <div className="offer-inline-actions"><button className="offer-modal-cancel" type="button" onClick={() => setMaterialFormOpen(false)}>Cancelar</button><button className="offer-add-resource-button" type="submit" disabled={saving}>Adicionar material</button></div>
            </form>}
            {materials.length > 0 ? <><div className="offer-materials-head"><span>Material</span><span>Especificação</span><span>Qtd. necessária (kg)</span><span>Estoque</span><span>Valor unitário</span><span>Valor total</span><span>Ações</span></div><div className="offer-materials-list">{materials.map((material) => <div className="offer-material-row offer-material-row--managed" key={material.id}><div className="material-visual">{material.icon}</div><div className="material-name"><strong>{material.name}</strong><span>{material.detail || '—'}</span></div><span>{material.quantity.toLocaleString('pt-BR')} kg</span><span className={`material-stock-status material-stock-status--${material.stockStatus}`}>{material.stockStatus === 'available' ? `Disponível: ${material.stockAvailable.toLocaleString('pt-BR')} kg` : material.stockStatus === 'partial' ? `Parcial: ${material.stockAvailable.toLocaleString('pt-BR')} kg` : material.stockStatus === 'unknown' ? 'Não verificado' : 'Sem estoque'}</span><span>{formatMoney(material.unitPrice)}</span><strong>{formatMoney(material.quantity * material.unitPrice)}</strong><button className="offer-resource-remove" type="button" disabled={saving} onClick={() => removeMaterial(material.id)} aria-label={`Remover ${material.name}`}>×</button></div>)}</div></> : <div className="offer-empty-state"><Icon name="plus" /><strong>Nenhum material adicionado</strong><span>Use o botão acima para buscar materiais cadastrados no estoque.</span></div>}
            <div className="offer-resource-subsection"><div className="offer-resource-heading"><div><span className="offer-details-section-title">Mão de obra</span><p>Adicione horas de máquina ou de profissionais.</p></div><button className="offer-add-resource-button" type="button" onClick={() => setLaborFormOpen((current) => !current)}><Icon name="plus" />Adicionar mão de obra</button></div>
              {laborFormOpen && <form className="offer-inline-form offer-labor-form" onSubmit={addLabor}>
                <label>Tipo<select value={laborForm.type} onChange={(event) => selectLaborType(event.target.value)}><option value="machine">Hora máquina</option><option value="person">Hora homem</option></select></label>
                <label>{laborForm.type === 'machine' ? 'Máquina' : 'Serviço do profissional'}{laborForm.type === 'machine' ? <select value={laborForm.machineId || ''} onChange={(event) => selectMachine(event.target.value)} required><option value="">Selecionar máquina</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}{machine.hourlyRate != null ? ` · ${formatMoney(machine.hourlyRate)}/h` : ''}</option>)}</select> : <input value={laborForm.resource} onChange={(event) => setLaborForm((current) => ({ ...current, resource: event.target.value }))} required />}</label>
                <label>Tempo (horas)<input type="number" min="0.01" step="0.01" value={laborForm.hours} onChange={(event) => setLaborForm((current) => ({ ...current, hours: event.target.value }))} placeholder="0,00" required /></label>
                <label>Valor da hora<input type="number" min="0" step="0.01" value={laborForm.hourlyRate} onChange={(event) => setLaborForm((current) => ({ ...current, hourlyRate: event.target.value }))} placeholder="0,00" required /></label>
                <div className="offer-inline-actions"><button className="offer-modal-cancel" type="button" onClick={() => setLaborFormOpen(false)}>Cancelar</button><button className="offer-add-resource-button" type="submit" disabled={saving}>Adicionar mão de obra</button></div>
              </form>}
              {laborEntries.length > 0 ? <div className="offer-labor-list"><div className="offer-labor-row offer-labor-row--header"><span>Tipo</span><span>Máquina / serviço</span><span>Tempo</span><span>Valor/h</span><span>Total</span><span>Ações</span></div>{laborEntries.map((entry) => <div className="offer-labor-row" key={entry.id}><span>{entry.type === 'machine' ? 'Hora máquina' : 'Hora homem'}</span><strong>{entry.resource}</strong><span>{entry.hours.toLocaleString('pt-BR')} h</span><span>{formatMoney(entry.hourlyRate)}</span><strong>{formatMoney(entry.hours * entry.hourlyRate)}</strong><button className="offer-resource-remove" type="button" disabled={saving} onClick={() => removeLabor(entry.id)} aria-label={`Remover ${entry.resource}`}>×</button></div>)}</div> : <div className="offer-empty-state offer-empty-state--labor"><strong>Nenhuma mão de obra adicionada</strong><span>Informe a máquina ou o serviço e o tempo utilizado.</span></div>}
            </div>
            <div className="offer-resource-subsection offer-process-settings">
              <ServiceStageEditor layout={stageLayout} stages={stages} onLayoutChange={reorderStageLayout} onToggle={toggleStage} disabled={Boolean(offer.orderCode)} />
              <fieldset><legend>Tipo</legend><div className="offer-kind-options"><label><input type="radio" name="offer-kind" checked={kind === 'service'} onChange={() => selectKind('service')} />Serviço</label><label><input type="radio" name="offer-kind" checked={kind === 'product'} onChange={() => selectKind('product')} />Produto</label></div></fieldset>
              <fieldset><legend>Fabricado a partir de</legend><div className="offer-kind-options">{[['sample', 'Amostra'], ['drawing', 'Desenho']].map(([key, label]) => <label key={key}><input type="radio" name="manufactured-from" checked={details.manufacturedFrom === key} onChange={() => updateDetails('manufacturedFrom', key)} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Têmpera</legend><div className="offer-kind-options">{[[true, 'Sim'], [false, 'Não']].map(([key, label]) => <label key={label}><input type="radio" name="tempering" checked={details.tempering === key} onChange={() => updateDetails('tempering', key)} />{label}</label>)}</div></fieldset>
              {stages.includes('painting') && <label className="offer-service-field">Cor/Tipo<input value={details.paintColor} maxLength={160} onChange={(event) => updateDetails('paintColor', event.target.value, false)} onBlur={() => saveResources()} /></label>}
              <label className="offer-service-field">Descrição do serviço<textarea aria-label="Descrição do serviço" value={details.serviceDescription} maxLength={5000} rows={4} onChange={(event) => updateDetails('serviceDescription', event.target.value, false)} onBlur={() => saveResources()} /></label>
              <div className="offer-kind-options offer-strict-process"><label><input type="checkbox" checked={details.strictProcess} onChange={(event) => updateDetails('strictProcess', event.target.checked)} />Processo Injessado</label></div>
            </div>
            <div className="offer-resource-totals"><div><span>Total de materiais</span><strong>{formatMoney(materialsTotal)}</strong></div><div><span>Total de mão de obra</span><strong>{formatMoney(laborTotal)}</strong></div><div className="offer-resource-total"><span>Total estimado</span><strong>{formatMoney(materialsTotal + laborTotal)}</strong></div></div>
            </fieldset>
          </section>
        </div>
        <div className="offer-details-footer"><div className="offer-details-tip"><span>♡</span><p>Os anexos ficam vinculados à solicitação e à OS gerada.</p></div><div className="offer-details-actions"><label className="offer-attachment-button">📎 <strong>Anexo</strong><input className="visually-hidden-file" type="file" onChange={addAttachment} /></label>{offer.orderCode ? <button className="offer-proposal-button" type="button" onClick={() => onSelectOrder(offer.orderCode)}>Ver OS {offer.orderCode}</button> : <button className="offer-proposal-button" type="button" onClick={goToProposal} disabled={saving}><Icon name="edit" /><strong>{saving ? 'Salvando...' : 'Fazer proposta'}</strong></button>}</div></div>{attachmentError && <p className="workflow-error" role="alert">{attachmentError}</p>}
      </main>
    </div>
  )
}

function ProposalBuilder({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offer, onRefresh, onSelectOrder }) {
  const [selectedKey, setSelectedKey] = useState(offer?.proposal?.key || 'A')
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [selectedLayout, setSelectedLayout] = useState(offer?.proposal?.layout || 'classic')
  const [editingCell, setEditingCell] = useState(null)
  const [generated, setGenerated] = useState(Boolean(offer?.proposal))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const resourceData = offer?.resources || { materials: [], laborEntries: [] }
  const formatMoney = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const materialCost = resourceData.materials.reduce((total, item) => total + Number(item.quantity) * Number(item.unitPrice), 0)
  const laborCost = resourceData.laborEntries.reduce((total, item) => total + Number(item.hours) * Number(item.hourlyRate), 0)
  const defaultProposal = { deadline: offer?.deadline || '', serviceValue: materialCost + laborCost, materials: materialCost, labor: laborCost, machine: `${resourceData.laborEntries.filter((item) => item.type === 'machine').reduce((total, item) => total + Number(item.hours), 0)} horas`, serviceTime: `${resourceData.laborEntries.reduce((total, item) => total + Number(item.hours), 0)} horas`, margin: 0, discount: 0, kind: resourceData.kind ?? offer?.proposal?.kind ?? 'service', stages: resourceData.stages ?? offer?.proposal?.stages ?? [] }
  const [proposals, setProposals] = useState(() => [
    { ...defaultProposal, key: 'A', margin: 15, tone: 'green', icon: '♢', title: 'Opção A', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'B', margin: 20, tone: 'blue', icon: '◎', title: 'Opção B', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'C', margin: 25, tone: 'purple', icon: '✧', title: 'Opção C', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'D', margin: 30, tone: 'red', icon: 'ϟ', title: 'Opção D', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
  ].map((proposal) => offer?.proposal?.key === proposal.key ? { ...proposal, ...offer.proposal, kind: defaultProposal.kind, stages: defaultProposal.stages } : proposal))
  const calculateProfit = (proposal) => proposal.serviceValue * (1 - proposal.discount / 100) * (proposal.margin / 100)
  const visibleProposals = proposals.map((proposal) => ({ ...proposal, profit: calculateProfit(proposal) }))
  const selectedProposal = visibleProposals.find((proposal) => proposal.key === selectedKey) || visibleProposals[0]

  function updateProposal(key, field, value) {
    setGenerated(false)
    setProposals((current) => current.map((proposal) => proposal.key === key ? { ...proposal, [field]: value } : proposal))
  }

  function saveEditedValue(key, field, value) {
    const numericFields = ['serviceValue', 'materials', 'labor', 'margin', 'discount']
    const nextValue = numericFields.includes(field) ? Number(String(value).replace(',', '.')) || 0 : value
    updateProposal(key, field, nextValue)
    setEditingCell(null)
  }

  function renderEditable(proposal, field, displayValue, inputType = 'text') {
    const isEditing = editingCell?.key === proposal.key && editingCell.field === field
    if (isEditing) return <input className="proposal-inline-edit" type={inputType} value={proposal[field]} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => updateProposal(proposal.key, field, event.target.value)} onBlur={(event) => saveEditedValue(proposal.key, field, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveEditedValue(proposal.key, field, event.currentTarget.value); if (event.key === 'Escape') setEditingCell(null) }} />
    return <><strong>{displayValue}</strong><button className="proposal-edit-button" type="button" onClick={(event) => { event.stopPropagation(); setEditingCell({ key: proposal.key, field }) }} aria-label={`Editar ${field}`}><Icon name="edit" /></button></>
  }

  async function generatePdf() {
    if (!offer) return
    if (Number(selectedProposal.serviceValue) <= 0 || !String(selectedProposal.deadline).trim() || !selectedProposal.stages.length) {
      setError('Informe o valor, o prazo e selecione pelo menos uma etapa antes de gerar o PDF.')
      setLayoutOpen(false)
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/offers/${offer.id}/proposal`, jsonOptions('POST', { proposal: selectedProposal, layout: selectedLayout }))
      await onRefresh()
      setGenerated(true)
      setLayoutOpen(false)
      const link = document.createElement('a')
      link.href = `/api/offers/${offer.id}/proposal.pdf`
      link.click()
    } catch (caught) {
      setError(caught.message)
      setLayoutOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function acceptOffer() {
    setSaving(true)
    setError('')
    try {
      const { item } = await apiRequest(`/api/offers/${offer.id}/accept`, { method: 'POST' })
      await onRefresh()
      onSelectOrder(item.code)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  if (!offer) return <div className="dashboard-shell proposal-shell"><Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} /><main className="proposal-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} /><p>Selecione uma oferta para fazer a proposta.</p><button type="button" onClick={() => onNavigate('Ofertas e serviços')}>Voltar às ofertas</button></main></div>

  return (
    <div className="dashboard-shell proposal-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="proposal-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="proposal-header"><div><button className="proposal-back-button" type="button" onClick={() => onNavigate('Detalhes da oferta')} aria-label="Voltar para detalhes">←</button><div><h1>Fazer proposta</h1><p>Escolha uma das quatro opções e ajuste os valores para esta solicitação.</p></div></div></div>
        <section className="proposal-service-summary"><div className="proposal-service-image">▰</div><div className="proposal-service-client"><h2>{offer.service}</h2><span>Cliente solicitante</span><strong>{offer.company}</strong><small>CNPJ: {offer.cnpj}</small><small>Etiqueta: {offer.labelNumber}</small></div><div className="proposal-service-fact"><span>▣</span><div><small>Prazo solicitado</small><strong>{displayDate(offer.deadline)}</strong></div><span>◇</span><div><small>Quantidade</small><strong>{offer.quantity} unidades</strong></div></div><div className="proposal-service-summary-copy"><strong>Resumo do serviço</strong><p>{offer.description}</p></div><div className="proposal-material-summary"><span>Materiais informados</span><strong>{formatMoney(materialCost)}</strong><button type="button" onClick={() => onNavigate('Detalhes da oferta')}>Ver detalhamento <span>›</span></button></div></section>
        <h2 className="proposal-section-heading">Escolha uma das propostas abaixo ou personalize os valores</h2>
        <div className="proposal-card-grid">{visibleProposals.map((proposal) => <article className={`proposal-card proposal-card--${proposal.tone} ${selectedKey === proposal.key ? 'proposal-card--selected' : ''}`} key={proposal.key} onClick={() => { setSelectedKey(proposal.key); if (proposal.key !== selectedKey) setGenerated(false) }}><div className="proposal-card-heading"><div><span className="proposal-card-label">PROPOSTA {proposal.key}</span><div className="proposal-card-intro"><span className="proposal-card-icon">{proposal.icon}</span><div><strong>{proposal.title}</strong><p>{proposal.description}</p></div></div></div><span className="proposal-card-tag">{proposal.tag}</span></div><div className="proposal-card-content"><div className="proposal-card-column"><div><span>◷</span><label>Prazo de entrega</label>{renderEditable(proposal, 'deadline', proposal.deadline)}</div><div><span>＄</span><label>Valor do serviço</label>{renderEditable(proposal, 'serviceValue', formatMoney(Number(proposal.serviceValue)), 'number')}</div><div><span>◇</span><label>Materiais</label>{renderEditable(proposal, 'materials', formatMoney(Number(proposal.materials)), 'number')}</div><div><span>♧</span><label>Mão de obra</label>{renderEditable(proposal, 'labor', formatMoney(Number(proposal.labor)), 'number')}</div></div><div className="proposal-card-column"><div><span>⚙</span><label>Tempo de máquina</label>{renderEditable(proposal, 'machine', proposal.machine)}</div><div><span>◷</span><label>Tempo de serviço</label>{renderEditable(proposal, 'serviceTime', proposal.serviceTime)}</div><div><span>▥</span><label>% de lucro bruto</label>{renderEditable(proposal, 'margin', `${Number(proposal.margin).toFixed(1).replace('.', ',')}%`, 'number')}</div><div><span>◇</span><label>Desconto</label>{renderEditable(proposal, 'discount', `${Number(proposal.discount).toFixed(1).replace('.', ',')}%`, 'number')}</div></div></div><div className="proposal-profit"><strong>Lucro bruto esperado</strong><b>{formatMoney(proposal.profit)}</b></div></article>)}</div>
        <div className="proposal-bottom"><div className="proposal-notice"><span>ⓘ</span><div><strong>Confira os valores</strong><p>Os valores e prazos são definidos por você antes da geração do PDF.</p></div></div><div className="proposal-actions"><button className="proposal-cancel-button" type="button" onClick={() => onNavigate('Detalhes da oferta')}>× <strong>Cancelar</strong></button><button className="proposal-send-button" type="button" onClick={() => setLayoutOpen(true)}><Icon name="send" /><strong>Gerar proposta em PDF</strong></button></div></div>
        {error && <p className="workflow-error" role="alert">{error}</p>}
        {generated && <div className="proposal-generated-actions"><a href={`/api/offers/${offer.id}/proposal.pdf`}>Baixar PDF da proposta</a><button className="proposal-cancel-button" type="button" onClick={() => onNavigate('Ofertas e serviços')}>Retornar às ofertas</button><button className="proposal-send-button" type="button" disabled={saving || Boolean(offer.orderCode)} onClick={acceptOffer}>{offer.orderCode ? `OS ${offer.orderCode} gerada` : saving ? 'Aceitando...' : 'Aceitar Oferta'}</button>{offer.orderCode && <button className="proposal-cancel-button" type="button" onClick={() => onSelectOrder(offer.orderCode)}>Ver OS</button>}</div>}
      </main>
      {layoutOpen && <div className="modal-backdrop proposal-layout-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLayoutOpen(false) }}><section className="proposal-layout-modal" role="dialog" aria-modal="true" aria-labelledby="proposal-layout-title" onMouseDown={(event) => event.stopPropagation()}><button className="proposal-modal-close" type="button" onClick={() => setLayoutOpen(false)} aria-label="Fechar">×</button><span className="proposal-modal-kicker">Gerar documento</span><h2 id="proposal-layout-title">Escolha o layout da proposta</h2><p>Selecione o modelo que será usado para gerar o PDF da proposta.</p><div className="proposal-layout-options">{[['classic', 'Clássico', 'Visual limpo com destaque para o serviço'], ['executive', 'Executivo', 'Resumo direto e corporativo'], ['compact', 'Compacto', 'Mais informações em menos espaço']].map(([key, label, description]) => <button className={`proposal-layout-option ${selectedLayout === key ? 'proposal-layout-option--selected' : ''}`} type="button" key={key} onClick={() => setSelectedLayout(key)}><span className={`proposal-layout-preview proposal-layout-preview--${key}`}><i /><i /><i /><i /></span><strong>{label}</strong><small>{description}</small></button>)}</div><div className="proposal-modal-actions"><button className="proposal-cancel-button" type="button" onClick={() => setLayoutOpen(false)}>Cancelar</button><button className="proposal-send-button" type="button" disabled={saving} onClick={generatePdf}><Icon name="send" /><strong>{saving ? 'Gerando...' : 'Gerar PDF'}</strong></button></div></section></div>}
    </div>
  )
}

function OrdersScreen({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, orders, selectedOrderCode, onSelectOffer, onSelectOrder, onRefresh, requestStatuses }) {
  const selectedOrder = orders.find((order) => order.code === selectedOrderCode)
  const requests = purchaseMaterialRequests(offers, orders, requestStatuses)
  const [stageNamesInput, setStageNamesInput] = useState('')
  const [operationError, setOperationError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setStageNamesInput('')
    setOperationError('')
  }, [selectedOrderCode])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!selectedOrderCode) return undefined
    const polling = window.setInterval(() => onRefresh().catch(() => {}), 10000)
    return () => window.clearInterval(polling)
  }, [selectedOrderCode])
  const operation = selectedOrder?.operation
  const activeMs = operation ? Number(operation.accumulatedMs || 0) + (operation.activeSession ? Math.max(0, now - Date.parse(operation.activeSession.startedAt)) : 0) : 0
  const seconds = Math.floor(activeMs / 1000)
  const activeTime = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')

  async function configureStages() {
    const stages = stageNamesInput.split(',').map((name) => name.trim()).filter(Boolean)
    try {
      await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/stages`, jsonOptions('PUT', { stages }))
      await onRefresh()
      setOperationError('')
    } catch (error) { setOperationError(error.message) }
  }

  async function interruptSession() {
    const reason = window.prompt('Informe a justificativa para encerrar esta sessão de trabalho:')
    if (!reason?.trim()) return
    try {
      await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/interrupt`, jsonOptions('POST', { reason }))
      await onRefresh()
      setOperationError('')
    } catch (error) { setOperationError(error.message) }
  }
  return <div className={`dashboard-shell orders-shell${selectedOrder ? ' orders-shell--detail' : ''}`}>
    <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
    <main className="orders-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
      <div className="orders-header"><h1>{selectedOrder ? 'Ordem de serviço' : 'Pedidos de material'}</h1></div>
      {selectedOrder ? <OrderDetails key={selectedOrder.code} order={selectedOrder} activeTime={activeTime} stageNamesInput={stageNamesInput} onChangeStages={setStageNamesInput} onConfigureStages={configureStages} onInterrupt={interruptSession} operationError={operationError} onBack={() => onSelectOrder(null)} Icon={Icon} /> : <div className="material-orders-table"><table><thead><tr><th>Material solicitado</th><th>Especificação</th><th>Quantidade a pedir</th><th>Quantidade necessária</th><th>OS / Oferta relacionada</th><th>Data</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td data-label="Material solicitado"><button className="material-order-link" type="button" onClick={() => request.orderCode ? onSelectOrder(request.orderCode) : onSelectOffer(request.offerId)}><strong>{request.name}</strong></button></td><td data-label="Especificação">{request.detail || '—'}</td><td data-label="Quantidade a pedir"><strong>{Number(request.quantity).toLocaleString('pt-BR')} kg</strong></td><td data-label="Quantidade necessária">{request.requiredQuantity.toLocaleString('pt-BR')} kg</td><td data-label="OS / Oferta relacionada"><button className="material-order-link" type="button" onClick={() => request.orderCode ? onSelectOrder(request.orderCode) : onSelectOffer(request.offerId)}>{request.orderCode || request.offerCode}<Icon name="eye" /></button>{!request.orderCode && <small>Aguardando OS</small>}</td><td data-label="Data">{displayDate(request.requestedAt)}</td></tr>)}</tbody></table>{!requests.length && <p className="material-orders-empty">Nenhum pedido de material.</p>}</div>}
    </main>
  </div>
}

function AdminServicesView({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, orders, onSelectOrder, onRefresh, workflowError }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [now, setNow] = useState(Date.now())
  const [acknowledgingCode, setAcknowledgingCode] = useState(null)
  const [acknowledgeError, setAcknowledgeError] = useState('')
  const displayRef = useRef(null)
  const [displayMode, setDisplayMode] = useState(false)
  const [displayError, setDisplayError] = useState('')
  useEffect(() => {
    const panel = displayRef.current
    const sync = () => setDisplayMode(document.fullscreenElement === panel)
    document.addEventListener('fullscreenchange', sync)
    return () => { document.removeEventListener('fullscreenchange', sync); if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {}) }
  }, [])
  async function toggleDisplayMode() {
    setDisplayError('')
    try {
      if (document.fullscreenElement === displayRef.current) await document.exitFullscreen()
      else await displayRef.current.requestFullscreen()
    } catch { setDisplayError('Não foi possível abrir a tela cheia neste navegador.') }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const labels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
  const duration = (milliseconds) => {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':')
  }
  const totalTime = (operation) => Number(operation.accumulatedMs || 0) + (operation.activeSession ? Math.max(0, now - Date.parse(operation.activeSession.startedAt)) : 0)
  const deadlineState = (order) => {
    const completedAt = Date.parse(order.operation.completedAt)
    return serviceDeadline(order, order.operation.status === 'completed' && Number.isFinite(completedAt) ? completedAt : now)
  }
  const panelOrders = orders.filter((order) => order.operation.status !== 'completed' || !order.operation.completionAcknowledgedAt)
  const matchesFilter = (order, key) => key === 'all' || (key === 'completed' ? order.operation.status === 'completed' : deadlineState(order).key === key)
  const visible = panelOrders.filter((order) => {
    const query = search.trim().toLocaleLowerCase()
    return matchesFilter(order, filter) && (!query || [order.service, order.company, order.code, order.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })
  async function acknowledgeCompletion(code) {
    if (acknowledgingCode) return
    setAcknowledgingCode(code)
    setAcknowledgeError('')
    try {
      await apiRequest(`/api/operations/orders/${encodeURIComponent(code)}/acknowledge-completion`, jsonOptions('POST', {}))
      await onRefresh()
    } catch (error) {
      setAcknowledgeError(error.message)
    } finally {
      setAcknowledgingCode(null)
    }
  }
  return <div className="dashboard-shell admin-os-shell">
    <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
    <main className="dashboard-main admin-os-main" ref={displayRef}>
      <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
      <div className="dashboard-header"><div><h1>Painel de serviços em andamento</h1><p></p></div><label className="global-search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por serviço, cliente ou OS..." aria-label="Buscar serviços" /></label></div>
      {workflowError && <p className="workflow-error" role="alert">{workflowError}</p>}
      {acknowledgeError && <p className="workflow-error" role="alert">{acknowledgeError}</p>}
      <div className="admin-os-filters deadline-filters">{[['all', 'Todos'], ...deadlineCategories, ['completed', 'Concluídos']].map(([key, label]) => <button className={filter === key ? 'selected' : ''} type="button" key={key} onClick={() => setFilter(key)}><span className={`admin-os-filter-icon admin-os-filter-icon--${key}`} aria-hidden="true">{key === 'all' ? '◉' : ['at-deadline', 'late'].includes(key) ? '!' : key === 'completed' ? '✓' : '●'}</span>{label}<strong>{panelOrders.filter((order) => matchesFilter(order, key)).length}</strong></button>)}</div>
      <div className="admin-os-filters">{[['open', 'Abertas'], ['waiting', 'Aguardando'], ['running', 'Em execução'], ['paused', 'Pausadas'], ['finalizing', 'Finalizando'], ['completed', 'Concluídas']].map(([key, label]) => <button className={filter === key ? 'selected' : ''} type="button" key={key} onClick={() => setFilter(key)}>{label}<strong>{orders.filter((order) => key === 'open' ? order.operation.status !== 'completed' : order.operation.status === key).length}</strong></button>)}</div>
      <div className="admin-os-table-wrap"><table className="admin-os-table"><thead><tr><th>OS / Serviço</th><th>Cliente</th><th>Operador</th><th>Etapa atual</th><th>Peças concluídas</th><th>Progresso</th><th>Tempo ativo</th><th>Tempo restante</th><th>Status</th><th></th></tr></thead><tbody>{visible.map((order) => {
        const operation = order.operation
        const due = operation.status === 'completed' ? { key: 'completed', label: 'Concluído', remaining: '—' } : deadlineState(order)
        const pieceProgress = currentPieceProgress(operation, order.quantity)
        const completedPieces = pieceProgress.completedPieces
        const current = pieceProgress.stages.find((stage) => !stage.filled)
        return <tr key={order.code}><td><strong>{order.service}</strong><small>{order.code} · Etiqueta {order.labelNumber}</small></td><td>{order.company}</td><td>{operation.activeSession?.employeeName || '—'}</td><td>{current ? stageGroupLabel(current) || 'Não definida' : operation.stages.length ? 'Etapas concluídas' : 'Não definida'}</td><td>{completedPieces}/{order.quantity}</td>
          <td>{operation.stages.length ? <div className={`admin-os-stage-track admin-os-stage-track--${due.key}`} style={{ '--stage-count': operation.stages.length }} role="group" aria-label={`Progresso da peça ${pieceProgress.pieceNumber} de ${order.quantity}. Progresso total: ${operation.progress}%. ${due.label}`}>
            {pieceProgress.stages.map((stage, index) => {
              const done = stage.filled && stage.count >= Number(order.quantity)
              const state = !stage.filled ? 'pending' : done ? 'done' : 'started'
              const label = done ? 'Concluída em todas as peças' : stage.filled ? `Concluída na peça ${pieceProgress.pieceNumber}` : `Pendente na peça ${pieceProgress.pieceNumber}`
              return <span className={`admin-os-stage admin-os-stage--${state}`} key={stage.key} title={`${stage.name}: ${stage.count}/${order.quantity} peças · ${label}`}>
                <span className="admin-os-stage-label">{index + 1}. {stage.name}</span>
                <span className="admin-os-stage-block" role="img" aria-label={`${stage.name}: ${label}, ${stage.count}/${order.quantity} peças`}>{done && <span className="admin-os-stage-check" aria-hidden="true">✓</span>}</span>
              </span>
            })}
          </div> : <span className="admin-os-stage-empty">Etapas não definidas</span>}</td>
          <td>{duration(totalTime(operation))}</td><td className={`admin-os-remaining admin-os-remaining--${due.key}`}>{due.remaining}</td><td>{operation.status === 'completed' ? <button className="admin-os-status admin-os-status--completed" type="button" aria-label="Concluído" title="Confirmar leitura da conclusão e retirar do painel" disabled={Boolean(acknowledgingCode)} aria-busy={acknowledgingCode === order.code} onClick={() => acknowledgeCompletion(order.code)}>Concluído</button> : <span className={`admin-os-status admin-os-status--deadline-${due.key}`}>{due.label}</span>}</td><td><button type="button" onClick={() => onSelectOrder(order.code)}>Ver OS</button></td></tr>
      })}</tbody></table>{!visible.length && <p className="admin-os-empty">Nenhuma OS real encontrada para este filtro.</p>}</div>
      <div className="admin-os-summary"><div><strong>{orders.filter((order) => order.operation.status !== 'completed').length}</strong><span>OS abertas</span></div><div><strong>{orders.filter((order) => order.operation.status === 'running' || order.operation.status === 'finalizing').length}</strong><span>Em execução</span></div><div><strong>{duration(orders.reduce((total, order) => total + totalTime(order.operation), 0))}</strong><span>Tempo ativo somado</span></div><div><strong>{orders.filter((order) => order.operation.status === 'completed').length}</strong><span>Concluídas</span></div></div>
      {displayError && <p className="workflow-error" role="alert">{displayError}</p>}
      <footer className="admin-os-display-controls">{displayMode && <time>{new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}</time>}<button type="button" onClick={toggleDisplayMode}>{displayMode ? <Minimize2 size={18} /> : <Monitor size={18} />}{displayMode ? 'Sair do modo de exibição' : 'Modo de exibição'}</button></footer>
    </main>
  </div>
}

function Dashboard({ user, onUpdateUser, collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, orders, selectedOfferId, selectedOrderCode, onRefresh, onSelectOffer, onSelectOrder, onOpenPayables, payableFilters, workflowError, workflowLoading }) {
  const [requestStatuses, setRequestStatuses] = useMaterialRequestStatuses()
  const toolProps = { Sidebar, WorkspaceTabs, navigationProps: { collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs } }
  if (['Contas a Pagar', 'Business Intelligence', 'Classificações', 'Fornecedores'].includes(activeNav)) return <PayablesScreen {...toolProps} accountFilters={payableFilters} mode={{ 'Contas a Pagar': 'accounts', 'Business Intelligence': 'bi', 'Classificações': 'classifications', 'Fornecedores': 'suppliers' }[activeNav]} />
  if (activeNav === 'Relatórios') return <ReportsScreen {...toolProps} />
  if (activeNav === 'Configurações') return <AccountSettings {...toolProps} user={user} onUpdateUser={onUpdateUser} />
  if (activeNav === 'Dashboard') return <AdminHome user={user} orders={orders} offers={offers} workflowError={workflowError} workflowLoading={workflowLoading} onRefresh={onRefresh} onNavigate={onNavigate} onSelectOrder={onSelectOrder} onOpenPayables={onOpenPayables} loadPayables={loadOverviewPayables} loadInventory={loadOverviewInventory} readInventory={readInventory} readPendingMaterialRequests={() => requestStatuses} Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={{ collapsed, onToggle, activeNav, onLogout, tabs, onCloseTab, onReorderTabs }} />
  if (activeNav === 'Máquinas') return <Machines collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Estoque') return <InventoryScreen collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offers={offers} orders={orders} onSelectOffer={onSelectOffer} onSelectOrder={onSelectOrder} requestStatuses={requestStatuses} onRequestStatuses={setRequestStatuses} />
  if (activeNav === 'Calculadora de pesos e medidas') return <Calculator collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Funcionários') return <RegistrationScreen key="employee" kind="employee" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Administradores') return <RegistrationScreen key="admin" kind="admin" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Clientes') return <RegistrationScreen key="client" kind="client" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Ofertas e serviços') return <Offers collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offers={offers} onRefresh={onRefresh} onSelectOffer={onSelectOffer} onSelectOrder={onSelectOrder} workflowError={workflowError} />
  if (activeNav === 'Detalhes da oferta') return <OfferDetailsV2 collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offer={offers.find((item) => item.id === selectedOfferId)} onRefresh={onRefresh} onSelectOrder={onSelectOrder} />
  if (activeNav === 'Fazer proposta') return <ProposalBuilder collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offer={offers.find((item) => item.id === selectedOfferId)} onRefresh={onRefresh} onSelectOrder={onSelectOrder} />
  if (activeNav === 'Pedidos') return <OrdersScreen collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offers={offers} orders={orders} selectedOrderCode={selectedOrderCode} onSelectOffer={onSelectOffer} onSelectOrder={onSelectOrder} onRefresh={onRefresh} requestStatuses={requestStatuses} />
  return <AdminServicesView collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} orders={orders} onSelectOrder={onSelectOrder} onRefresh={onRefresh} workflowError={workflowError} />
}
function App() {
  const [cpf, setCpf] = useState('')
  const [operatorUsername, setOperatorUsername] = useState('')
  const [loginMode, setLoginMode] = useState('admin')
  const [operatorToken, setOperatorToken] = useState(() => window.sessionStorage.getItem('gmac-operator-token'))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isDashboard, setIsDashboard] = useState(false)
  const [adminUser, setAdminUser] = useState(null)
  const [restoringSession, setRestoringSession] = useState(() => !operatorToken && Boolean(window.sessionStorage.getItem('gmac-admin-token')))
  const [restoreError, setRestoreError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [openTabs, setOpenTabs] = useState(['Dashboard'])
  const [offers, setOffers] = useState([])
  const [orders, setOrders] = useState([])
  const [payableFilters, setPayableFilters] = useState(null)
  const [selectedOfferId, setSelectedOfferId] = useState(null)
  const [selectedOrderCode, setSelectedOrderCode] = useState(null)
  const [workflowError, setWorkflowError] = useState('')
  const [workflowLoading, setWorkflowLoading] = useState(true)

  async function refreshWorkflow() {
    try {
      const [offersResult, ordersResult] = await Promise.all([apiRequest('/api/offers'), apiRequest('/api/operations/orders')])
      setOffers(offersResult.items)
      setOrders(ordersResult.items)
      setWorkflowError('')
    } catch (error) {
      setWorkflowError(`Não foi possível carregar ofertas e OS: ${error.message}`)
      throw error
    } finally { setWorkflowLoading(false) }
  }

  useEffect(() => { if (!operatorToken) refreshWorkflow().catch(() => {}) }, [operatorToken])

  useEffect(() => {
    if (!restoringSession) return undefined
    const controller = new AbortController()
    async function restore() {
      setRestoreError('')
      try {
        const response = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${window.sessionStorage.getItem('gmac-admin-token') || ''}` }, signal: controller.signal })
        if (response.status === 401) {
          window.sessionStorage.removeItem('gmac-admin-token')
          window.sessionStorage.removeItem('gmac-admin-workspace')
          setRestoringSession(false)
          return
        }
        if (!response.ok) throw new Error('Não foi possível restaurar sua sessão. Tente novamente.')
        const { user } = await response.json()
        if (!user || user.id == null || !user.name) throw new Error('Não foi possível confirmar sua conta.')
        let workspace
        try { workspace = JSON.parse(window.sessionStorage.getItem('gmac-admin-workspace') || 'null') } catch { workspace = null }
        const validPages = [...navigation.map(([name]) => name), 'Detalhes da oferta', 'Fazer proposta']
        if (String(workspace?.userId) === String(user.id) && validPages.includes(workspace?.activeNav)) {
          setActiveNav(workspace.activeNav)
          setOpenTabs([...new Set([...(Array.isArray(workspace.tabs) ? workspace.tabs.filter((tab) => validPages.includes(tab)) : []), workspace.activeNav])])
          setSidebarCollapsed(Boolean(workspace.collapsed))
          setSelectedOfferId(typeof workspace.offerId === 'string' ? workspace.offerId : null)
          setSelectedOrderCode(typeof workspace.orderCode === 'string' ? workspace.orderCode : null)
        }
        setAdminUser(user)
        setIsDashboard(true)
        setRestoringSession(false)
      } catch (error) {
        if (!controller.signal.aborted) setRestoreError(error.message === 'Failed to fetch' ? 'Não foi possível conectar ao servidor. Tente novamente.' : error.message)
      }
    }
    restore()
    return () => controller.abort()
  }, [restoringSession, restoreAttempt])

  useEffect(() => {
    if (!isDashboard || !adminUser || !window.sessionStorage.getItem('gmac-admin-token')) return
    window.sessionStorage.setItem('gmac-admin-workspace', JSON.stringify({ userId: adminUser.id, activeNav, tabs: openTabs, collapsed: sidebarCollapsed, offerId: selectedOfferId, orderCode: selectedOrderCode }))
  }, [isDashboard, adminUser, activeNav, openTabs, sidebarCollapsed, selectedOfferId, selectedOrderCode])

  useEffect(() => {
    if (!isDashboard || !['Serviços em andamento', 'Dashboard'].includes(activeNav)) return undefined
    const polling = window.setInterval(() => refreshWorkflow().catch(() => {}), 10000)
    return () => window.clearInterval(polling)
  }, [isDashboard, activeNav])

  function selectOffer(id) {
    setSelectedOfferId(id)
    navigateTo('Detalhes da oferta')
  }

  function selectOrder(code) {
    navigateTo('Pedidos')
    setSelectedOrderCode(code)
  }

  function navigateTo(label) {
    if (label === 'Contas a Pagar') setPayableFilters(null)
    if (label === 'Pedidos') setSelectedOrderCode(null)
    setActiveNav(label)
    setOpenTabs((current) => current.includes(label) ? current : [...current, label])
  }

  function openPayables(filters) {
    navigateTo('Contas a Pagar')
    setPayableFilters(filters)
  }

  function closeTab(label) {
    if (openTabs.length <= 1) return
    const index = openTabs.indexOf(label)
    const nextTabs = openTabs.filter((tab) => tab !== label)
    setOpenTabs(nextTabs)
    if (activeNav === label) setActiveNav(nextTabs[Math.max(0, Math.min(index, nextTabs.length - 1))])
  }

  function closeAllTabs() {
    setOpenTabs(['Dashboard'])
    setActiveNav('Dashboard')
    setSelectedOfferId(null)
    setSelectedOrderCode(null)
  }

  function reorderTabs(sourceTab, targetTab) {
    setOpenTabs((current) => {
      const sourceIndex = current.indexOf(sourceTab)
      const targetIndex = current.indexOf(targetTab)
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current
      const nextTabs = [...current]
      nextTabs.splice(sourceIndex, 1)
      nextTabs.splice(targetIndex, 0, sourceTab)
      return nextTabs
    })
  }

  function formatLogin(value) {
    return value.replace(/\D/g, '').slice(0, 11)
  }

  function enterAdmin(user, token) {
    window.sessionStorage.removeItem('gmac-admin-workspace')
    setRestoringSession(false)
    if (token) {
      window.sessionStorage.setItem('gmac-admin-token', token)
      apiRequest('/api/machines/import', jsonOptions('POST', { items: readMachines() })).catch(() => {})
    } else window.sessionStorage.removeItem('gmac-admin-token')
    setAdminUser(user || null)
    setActiveNav('Dashboard')
    setOpenTabs(['Dashboard'])
    setSelectedOfferId(null)
    setSelectedOrderCode(null)
    setPassword('')
    setIsDashboard(true)
    refreshWorkflow().catch(() => {})
  }

  function logoutAdmin() {
    apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.sessionStorage.removeItem('gmac-admin-token')
    window.sessionStorage.removeItem('gmac-admin-workspace')
    setRestoringSession(false)
    setIsDashboard(false)
    setAdminUser(null)
    setPassword('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      if (loginMode === 'operator') {
        const data = await apiRequest('/api/auth/operator-login', jsonOptions('POST', { username: operatorUsername, password }))
        window.sessionStorage.setItem('gmac-operator-token', data.token)
        setOperatorToken(data.token)
        setPassword('')
        return
      }
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Não foi possível entrar.')
      enterAdmin(data.user, data.token)
    } catch (error) {
      if (loginMode === 'admin' && error.message === 'O banco de dados ainda não está configurado.') {
        enterAdmin(null)
      } else {
        setMessage(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (operatorToken) return <OperatorDashboard token={operatorToken} onLogout={() => { window.sessionStorage.removeItem('gmac-operator-token'); setOperatorToken(null) }} />
  if (restoringSession) return <main className="session-restore"><img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" />{restoreError ? <><p role="alert">{restoreError}</p><div><button type="button" className="admin-tool-button admin-tool-button--primary" onClick={() => setRestoreAttempt((value) => value + 1)}>Tentar novamente</button><button type="button" className="admin-tool-button" onClick={logoutAdmin}>Sair</button></div></> : <p role="status">Restaurando sessão...</p>}</main>
  if (isDashboard) return <AdminIdentityContext.Provider value={adminUser}><WorkspaceTabsContext.Provider value={closeAllTabs}><Dashboard user={adminUser} onUpdateUser={setAdminUser} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((current) => !current)} activeNav={activeNav} onNavigate={navigateTo} onCloseTab={closeTab} onReorderTabs={reorderTabs} tabs={openTabs} onLogout={logoutAdmin} offers={offers} orders={orders} selectedOfferId={selectedOfferId} selectedOrderCode={selectedOrderCode} onRefresh={refreshWorkflow} onSelectOffer={selectOffer} onSelectOrder={selectOrder} onOpenPayables={openPayables} payableFilters={payableFilters} workflowError={workflowError} workflowLoading={workflowLoading} /></WorkspaceTabsContext.Provider></AdminIdentityContext.Provider>

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="GMAC Metalúrgica">
        <div className="brand-panel__veil" />
      </section>

      <section className="access-panel">
        <div className="login-card">
          <div className="login-card__heading">
            <h1>Entrar no sistema</h1>
            <p>{loginMode === 'admin' ? 'Informe seu CPF e senha para acessar.' : 'Use a conta compartilhada dos operadores.'}</p>
          </div>

          <div className="login-role-switch"><button className={loginMode === 'admin' ? 'active' : ''} type="button" onClick={() => { setLoginMode('admin'); setMessage(''); setPassword('') }}>Administrador</button><button className={loginMode === 'operator' ? 'active' : ''} type="button" onClick={() => { setLoginMode('operator'); setMessage(''); setPassword('') }}>Operador</button></div>

          <div className="heading-rule" />

          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor={loginMode === 'admin' ? 'cpf' : 'operator-username'}>{loginMode === 'admin' ? 'CPF' : 'Usuário compartilhado'}</label>
            <div className="input-wrap">
              <UserIcon />
              {loginMode === 'admin' ? <input
                id="cpf"
                name="cpf"
                inputMode="numeric"
                autoComplete="username"
                placeholder="00000000000"
                value={cpf}
                onChange={(event) => setCpf(formatLogin(event.target.value))}
                pattern="[0-9]{11}"
                minLength={11}
                required
              /> : <input id="operator-username" name="operator-username" inputMode="numeric" autoComplete="username" value={operatorUsername} onChange={(event) => setOperatorUsername(formatLogin(event.target.value))} placeholder="00000000000" pattern="[0-9]{11}" minLength={11} required />}
            </div>

            <label className="field-label password-label" htmlFor="password">Senha</label>
            <div className="input-wrap">
              <LockIcon />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="visibility-button"
                type="button"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setShowPassword((current) => !current)}
              >
                <EyeIcon crossed={!showPassword} />
              </button>
            </div>

            <button className="submit-button" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {loginMode === 'admin' && <button className="forgot-link" type="button" onClick={() => setMessage('Entre em contato com o administrador para redefinir sua senha.')}>Esqueci minha senha</button>}
          {message && <p className="form-message" role="status">{message}</p>}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
