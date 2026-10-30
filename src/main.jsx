import { StrictMode, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OperatorDashboard, { operatorEmployeeKey } from './OperatorDashboard.jsx'
import EmployeeActivityModal from './EmployeeActivityModal.jsx'
import PasswordRecovery from './PasswordRecovery.jsx'
import PasswordHistoryModal from './PasswordHistoryModal.jsx'
import OrderDetails from './OrderDetails.jsx'
import RejectOfferModal from './RejectOfferModal.jsx'
import DeclineProposalModal, { UndoDeclineModal, AcceptOfferModal, UndoAcceptModal } from './DeclineProposalModal.jsx'
import RejectMaterialRequestModal from './RejectMaterialRequestModal.jsx'
import { MaterialRequestModal, MaterialRequestHistoryModal } from './MaterialRequestModals.jsx'
import PendingMaterialsModal from './PendingMaterialsModal.jsx'
import AdminHome from './AdminHome.jsx'
import NotificationsButton from './NotificationsButton.jsx'
import ReportsScreen from './ReportsScreen.jsx'
import LaborServicesScreen from './LaborServicesScreen.jsx'
import AccountSettings from './AccountSettings.jsx'
import PayablesScreen from './PayablesScreen.jsx'
import AdminWorkspace from './AdminWorkspace.jsx'
import SimpleRegistryScreen from './SimpleRegistryScreen.jsx'
import RequestersScreen, { contactKinds } from './RequestersScreen.jsx'
import { RegistryToolbar, SortHeader, documentLabel, useRegistryList } from './RegistryList.jsx'
import { bySector, parseSectors, sectorsOf } from './machineSectors.js'
import ServicePanelRow, { collaboratorNames, panelDeadline, panelDuration } from './ServicePanelRow.jsx'
import PieceNameInput from './PieceNameInput.jsx'
import ClientNameInput from './ClientNameInput.jsx'
import RequesterNameInput from './RequesterNameInput.jsx'
import ProposalEmailModal, { ProposalEmailHistory } from './ProposalEmailModal.jsx'
import StagesScreen from './StagesScreen.jsx'
import { documentDigits, documentKind, maskClientDocument } from '../server/clientDocument.js'
import DownloadLink from './DownloadLink.jsx'
import { cachedResource, downloadFile } from './payablesApi.js'
import { PayableModal } from './PayableModal.jsx'
import BatchSettlementScreen from './BatchSettlementScreen.jsx'
import ReceivablesScreen from './ReceivablesScreen.jsx'
import TreasuryScreen from './TreasuryScreen.jsx'
import AccountPlanScreen from './AccountPlanScreen.jsx'
import DreScreen from './DreScreen.jsx'
import DreAdjustmentsScreen from './DreAdjustmentsScreen.jsx'
import CashFlowScreen from './CashFlowScreen.jsx'
import StockPurchaseFinance, { purchasedQuantity } from './StockPurchaseFinance.jsx'
import BankStatementsScreen from './BankStatementsScreen.jsx'
import ReceivableScheduleModal from './ReceivableScheduleModal.jsx'
import ProposalDocumentModal, { modelLabel } from './ProposalDocumentModal.jsx'
import LoginBrandPanel from './LoginBrandPanel.jsx'
import SectorPicker from './SectorPicker.jsx'
import PlanningScreen from './PlanningScreen.jsx'
import ServiceStageEditor from './ServiceStageEditor.jsx'
import MaterialAppearance, { MaterialVisual } from './MaterialAppearance.jsx'
import MachineHistoryModal from './MachineHistoryModal.jsx'
import MachineUsageBI from './MachineUsageBI.jsx'
import { useMobileModal } from './useMobileModal.js'
import { ThemeContext, useAccountTheme } from './accountTheme.js'
import { pollWhileVisible } from './polling.js'
import { newId } from './newId.js'
import { History, Monitor, Minimize2, Plus, Pencil, Trash2, Clock3, CreditCard, HandCoins, Banknote, Landmark, ChartColumn, Tags, FileChartColumn, FilePenLine, FolderTree, ChartNoAxesCombined, Truck, WalletCards, ChevronLeft, ChevronRight, ChevronDown, UsersRound, Menu, X, Info, ArrowLeft, ListChecks, Layers, CircleCheck, CircleX, ArrowUpDown, ArrowUp, ArrowDown, Building2, CirclePause, Power, Factory, Wrench, CalendarClock, Save, Contact, ShoppingCart, Mail, ListOrdered } from 'lucide-react'
import { proposalCosts, proposalPricing, hoursText, marginLimits, PROPOSAL_MARGIN_GAP } from '../server/proposalMath.js'
import { stageLabel, serviceDetails, serviceDescriptionText, readStageLayout, orderedStageSelection, stagePlanProblem, stagePlanPlace, setStageCatalog, onStageCatalogChange, defaultStageResource } from '../server/serviceStages.js'
import { findInventoryMaterial, materialsStock, normalizeSearch, purchaseMaterialRequests } from './offerResources.js'
import { deadlineCategories } from './serviceDeadline.js'
import { currentPieceProgress, emergenciesFirst } from './serviceProgress.js'
import { servicePanelOrders } from './servicePanels.js'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { operationElapsed } from '../server/operationSessions.js'
import { formatQuantity, materialUnit, materialUnits, quantityStep, unitPriceLabel, wholeUnit } from '../server/materialUnits.js'
import './styles.css'
import './desktop.css'
import './mobile.css'
import './darkTheme.generated.css'
import './blackTheme.generated.css'
import './theme.css'
import './fontSize.generated.css'

async function apiRequest(url, options = {}) {
  const token = window.sessionStorage.getItem('gmac-admin-token')
  const response = await fetch(url, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.message || 'Não foi possível concluir a operação.'), { status: response.status })
  return data
}

const jsonOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const loadMachineHistory = (id, query, signal) => apiRequest(`/api/machines/${encodeURIComponent(id)}/history?${query}`, { signal, cache: 'no-store' })
const loadMachineUsage = (url, signal) => apiRequest(url, { signal, cache: 'no-store' })
const pageLabel = (name) => ({ Dashboard: 'Início', Pedidos: 'Pedidos de material' }[name] || name)
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
  ['Serviços', 'services'],
  ['Etapas', 'stages'],
  ['Estoque', 'stock'],
  ['Pedidos', 'orders'],
  ['Calculadora de pesos e medidas', 'calculator'],
  ['Funcionários', 'employees'],
  ['Setores', 'sectors'],
  ['Razões de pausas', 'pause-reasons'],
  ['Bancos', 'banks'],
  ['Administradores', 'admins'],
  ['Serviços em andamento', 'services'],
  ['Serviços concluídos', 'completed-services'],
  ['Ofertas e serviços', 'offers'],
  ['Planejamento', 'planning'],
  ['Clientes', 'clients'],
  ['Solicitantes', 'requesters'],
  ['Compradores', 'buyers'],
  ['Contas a Pagar', 'payables'],
  ['Contas a Receber', 'receivables'],
  ['Tesouraria', 'treasury'],
  ['Fluxo de caixa', 'cash-flow'],
  ['Baixa em Lote', 'batch'],
  ['Conciliação bancária', 'bank'],
  ['Business Intelligence', 'bi'],
  ['DRE', 'dre'],
  ['Ajustes da DRE', 'dre-adjustments'],
  ['Grupos de contas', 'account-groups'],
  ['Classificações', 'classifications'],
  ['Fornecedores', 'suppliers'],
  ['Relatórios', 'reports'],
  ['Configurações', 'settings'],
]

const registrationNavigation = ['Fornecedores', 'Administradores', 'Funcionários', 'Setores', 'Clientes', 'Solicitantes', 'Compradores', 'Bancos', 'Razões de pausas'].map((label) => navigation.find(([name]) => name === label))
const isRegistrationPage = (label) => registrationNavigation.some(([name]) => name === label)
const financialNavigation = ['Contas a Pagar', 'Contas a Receber', 'Tesouraria', 'Fluxo de caixa', 'Baixa em Lote', 'Conciliação bancária', 'Business Intelligence', 'DRE', 'Ajustes da DRE', 'Grupos de contas', 'Classificações'].map((label) => navigation.find(([name]) => name === label))
const isFinancialPage = (label) => financialNavigation.some(([name]) => name === label)
const operationNavigation = ['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços', 'Planejamento'].map((label) => navigation.find(([name]) => name === label))
const isOperationPage = (label) => operationNavigation.some(([name]) => name === label)

const AdminIdentityContext = createContext(null)
const WorkspaceTabsContext = createContext(null)

// Each screen mounts its own sidebar; keeping the scroll here stops the menu from jumping between pages.
let sidebarScrollTop = 0

function Sidebar({ collapsed, onToggle, activeNav, onNavigate, onLogout }) {
  const user = useContext(AdminIdentityContext)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef(null)
  const menuButtonRef = useRef(null)
  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 760px)')
    const closeOnDesktop = () => { if (!breakpoint.matches) setMobileOpen(false) }
    breakpoint.addEventListener('change', closeOnDesktop)
    return () => breakpoint.removeEventListener('change', closeOnDesktop)
  }, [])
  useEffect(() => {
    if (!mobileOpen) return
    const main = menuRef.current.closest('.dashboard-shell').querySelector('main')
    const previousOverflow = document.body.style.overflow
    main.inert = true
    document.body.style.overflow = 'hidden'
    menuRef.current.querySelector('.mobile-menu-close').focus()
    return () => {
      main.inert = false
      document.body.style.overflow = previousOverflow
      menuButtonRef.current?.focus({ preventScroll: true })
    }
  }, [mobileOpen])
  function menuKeyDown(event) {
    if (!mobileOpen) return
    if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false) }
    if (event.key !== 'Tab') return
    const buttons = [...menuRef.current.querySelectorAll('button')].filter((button) => button.getClientRects().length && !button.disabled)
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  // A page of a group opens it from the first frame (each screen mounts its own menu), without flashing closed.
  const [registrationsOpen, setRegistrationsOpen] = useState(() => isRegistrationPage(activeNav) || window.sessionStorage.getItem('gmac-cadastros-open') === 'true')
  const [financialOpen, setFinancialOpen] = useState(() => isFinancialPage(activeNav) || window.sessionStorage.getItem('gmac-finance-open') === 'true')
  // Operação holds the daily screens, so it starts open until the person closes it.
  const [operationOpen, setOperationOpen] = useState(() => isOperationPage(activeNav) || window.sessionStorage.getItem('gmac-operation-open') !== 'false')
  const navRef = useRef(null), revealGroup = useRef(null), anchorGroup = useRef(null), spacerRef = useRef(null)
  const [navEdges, setNavEdges] = useState({ above: false, below: false })
  // A spacer keeps a just-closed group under the pointer, shrinking as the list scrolls back up.
  function fitSpacer() {
    const nav = navRef.current, spacer = spacerRef.current
    if (!nav || !spacer || !spacer.offsetHeight) return
    const natural = nav.scrollHeight - spacer.offsetHeight
    spacer.style.height = `${Math.max(0, nav.scrollTop + nav.clientHeight - natural)}px`
  }
  function updateNavEdges() {
    const nav = navRef.current
    if (!nav) return
    const next = { above: nav.scrollTop > 2, below: nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2 }
    setNavEdges((current) => current.above === next.above && current.below === next.below ? current : next)
  }
  useLayoutEffect(() => {
    const nav = navRef.current
    if (nav) nav.scrollTop = sidebarScrollTop
  }, [])
  // Only a page change brings the current item into view; opening or closing a group never moves the list away from the pointer.
  useLayoutEffect(() => {
    const nav = navRef.current
    const selected = nav?.querySelector('.nav-item--active')
    if (selected && window.matchMedia('(min-width: 1101px)').matches) {
      const viewport = nav.getBoundingClientRect(), item = selected.getBoundingClientRect()
      if (item.bottom > viewport.bottom) nav.scrollTop += item.bottom - viewport.bottom + 8
      else if (item.top < viewport.top) nav.scrollTop -= viewport.top - item.top + 8
      sidebarScrollTop = nav.scrollTop
    }
    updateNavEdges()
  }, [activeNav, collapsed])
  useLayoutEffect(() => {
    const nav = navRef.current, id = revealGroup.current, anchor = anchorGroup.current
    revealGroup.current = null
    anchorGroup.current = null
    if (nav && anchor) {
      const header = nav.querySelector(`[aria-controls="${anchor.id}"]`)
      const target = nav.scrollTop + header.getBoundingClientRect().top - anchor.top
      const natural = nav.scrollHeight - spacerRef.current.offsetHeight
      spacerRef.current.style.height = `${Math.max(0, target + nav.clientHeight - natural)}px`
      nav.scrollTop = target
      sidebarScrollTop = nav.scrollTop
    }
    const group = id && nav?.querySelector(`#${id}`)
    if (group) {
      // Show as much of the opened group as fits while its header stays where it was clicked.
      const viewport = nav.getBoundingClientRect(), header = group.previousElementSibling.getBoundingClientRect(), menu = group.getBoundingClientRect()
      const shift = Math.min(menu.bottom - viewport.bottom + 8, header.top - viewport.top)
      if (shift > 0) nav.scrollTo({ top: nav.scrollTop + shift, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
    updateNavEdges()
  }, [registrationsOpen, financialOpen, operationOpen])
  useEffect(() => {
    window.addEventListener('resize', updateNavEdges)
    return () => window.removeEventListener('resize', updateNavEdges)
  }, [])
  useEffect(() => {
    if (isRegistrationPage(activeNav)) {
      setRegistrationsOpen(true)
      window.sessionStorage.setItem('gmac-cadastros-open', 'true')
    }
  }, [activeNav])
  useEffect(() => {
    if (isOperationPage(activeNav)) {
      setOperationOpen(true)
      window.sessionStorage.setItem('gmac-operation-open', 'true')
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
    if (next) revealGroup.current = 'sidebar-cadastros-menu'
    else anchorGroup.current = { id: 'sidebar-cadastros-menu', top: navRef.current?.querySelector('[aria-controls="sidebar-cadastros-menu"]')?.getBoundingClientRect().top ?? 0 }
    setRegistrationsOpen(next)
    window.sessionStorage.setItem('gmac-cadastros-open', String(next))
  }
  function toggleOperation() {
    const next = !operationOpen
    if (next) revealGroup.current = 'sidebar-operation-menu'
    else anchorGroup.current = { id: 'sidebar-operation-menu', top: navRef.current?.querySelector('[aria-controls="sidebar-operation-menu"]')?.getBoundingClientRect().top ?? 0 }
    setOperationOpen(next)
    window.sessionStorage.setItem('gmac-operation-open', String(next))
  }
  function toggleFinancial() {
    const next = !financialOpen
    if (next) revealGroup.current = 'sidebar-finance-menu'
    else anchorGroup.current = { id: 'sidebar-finance-menu', top: navRef.current?.querySelector('[aria-controls="sidebar-finance-menu"]')?.getBoundingClientRect().top ?? 0 }
    setFinancialOpen(next)
    window.sessionStorage.setItem('gmac-finance-open', String(next))
  }
  function navigationItem([label, icon]) {
    return <button className={`nav-item ${activeNav === label ? 'nav-item--active' : ''}`} key={label} type="button" title={pageLabel(label)} aria-label={pageLabel(label)} onClick={() => { setMobileOpen(false); onNavigate(label) }}>
      {['payables', 'receivables', 'treasury', 'cash-flow', 'batch', 'bank', 'bi', 'dre', 'dre-adjustments', 'account-groups', 'classifications', 'suppliers', 'completed-services', 'sectors', 'pause-reasons', 'banks', 'planning', 'requesters', 'buyers', 'stages'].includes(icon) ? (() => { const NavIcon = { planning: CalendarClock, payables: CreditCard, receivables: HandCoins, treasury: Banknote, 'cash-flow': ChartNoAxesCombined, batch: Layers, bank: Landmark, bi: ChartColumn, dre: FileChartColumn, 'dre-adjustments': FilePenLine, 'account-groups': FolderTree, classifications: Tags, suppliers: Truck, 'completed-services': ListChecks, sectors: Building2, 'pause-reasons': CirclePause, banks: Landmark, requesters: Contact, buyers: ShoppingCart, stages: ListOrdered }[icon]; return <NavIcon className="icon nav-icon" size={20} /> })() : <Icon name={icon} className="nav-icon" />}
      <span>{pageLabel(label)}</span>
    </button>
  }
  const name = user?.name || 'Administrador'
  const words = name.trim().split(/\s+/)
  const initials = [words[0], words.length > 1 ? words.at(-1) : ''].map((word) => word?.[0] || '').join('').toUpperCase()
  return (
    <>
    <button ref={menuButtonRef} className="mobile-menu-open" type="button" aria-label="Abrir menu de navegação" aria-expanded={mobileOpen} aria-controls="admin-navigation" onClick={() => setMobileOpen(true)}><Menu size={23} aria-hidden="true" /></button>
    {mobileOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Fechar menu de navegação" tabIndex={-1} onClick={() => setMobileOpen(false)} />}
    <aside ref={menuRef} id="admin-navigation" className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label={mobileOpen ? 'Menu de navegação' : undefined} onKeyDown={menuKeyDown}>
      <div className="sidebar-logo">
        <img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" />
        <button className="mobile-menu-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={22} aria-hidden="true" /></button>
        <button className="sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}>
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>
      <nav ref={navRef} className={`sidebar-nav${navEdges.above ? ' sidebar-nav--more-above' : ''}${navEdges.below ? ' sidebar-nav--more-below' : ''}`} aria-label="Navegação principal" onScroll={(event) => { sidebarScrollTop = event.currentTarget.scrollTop; fitSpacer(); updateNavEdges() }}>
        {navigation.flatMap((item) => {
          if (item[0] === 'Funcionários') return [<div className="sidebar-nav-group" key="cadastros">
            <button className={`nav-item sidebar-nav-group-toggle ${!registrationsOpen && isRegistrationPage(activeNav) ? 'nav-item--active' : ''}`} type="button" title="Cadastros" aria-label="Cadastros" aria-expanded={registrationsOpen} aria-controls="sidebar-cadastros-menu" onClick={toggleRegistrations}>
              <UsersRound className="icon nav-icon" size={20} aria-hidden="true" /><span>Cadastros</span>{registrationsOpen ? <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" /> : <ChevronRight className="sidebar-group-chevron" size={15} aria-hidden="true" />}
            </button>
            <div className="sidebar-submenu" id="sidebar-cadastros-menu" hidden={!registrationsOpen}>{registrationNavigation.map(navigationItem)}</div>
          </div>]
          if (item[0] === 'Serviços em andamento') return [<div className="sidebar-nav-group" key="operation">
            <button className={`nav-item sidebar-nav-group-toggle ${!operationOpen && isOperationPage(activeNav) ? 'nav-item--active' : ''}`} type="button" title="Operação" aria-label="Operação" aria-expanded={operationOpen} aria-controls="sidebar-operation-menu" onClick={toggleOperation}>
              <Factory className="icon nav-icon" size={20} aria-hidden="true" /><span>Operação</span>{operationOpen ? <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" /> : <ChevronRight className="sidebar-group-chevron" size={15} aria-hidden="true" />}
            </button>
            <div className="sidebar-submenu" id="sidebar-operation-menu" hidden={!operationOpen}>{operationNavigation.map(navigationItem)}</div>
          </div>]
          if (item[0] === 'Contas a Pagar') return user?.role === 'staff' ? [] : [<div className="sidebar-nav-group" key="finance">
            <button className={`nav-item sidebar-nav-group-toggle ${!financialOpen && isFinancialPage(activeNav) ? 'nav-item--active' : ''}`} type="button" title="Gestão Financeira" aria-label="Gestão Financeira" aria-expanded={financialOpen} aria-controls="sidebar-finance-menu" onClick={toggleFinancial}>
              <WalletCards className="icon nav-icon" size={20} aria-hidden="true" /><span>Gestão Financeira</span>{financialOpen ? <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" /> : <ChevronRight className="sidebar-group-chevron" size={15} aria-hidden="true" />}
            </button>
            <div className="sidebar-submenu" id="sidebar-finance-menu" hidden={!financialOpen}>{financialNavigation.map(navigationItem)}</div>
          </div>]
          return isRegistrationPage(item[0]) || isFinancialPage(item[0]) || isOperationPage(item[0]) ? [] : [navigationItem(item)]
        })}
        <div ref={spacerRef} className="sidebar-nav-spacer" aria-hidden="true" />
      </nav>
      <div className="sidebar-account"><div className="account-avatar">{initials}</div><div className="account-copy"><strong title={name}>{name}</strong><span>{user?.role === 'staff' ? 'Administrativo' : 'Administrador'}</span></div></div>
      <button className="logout-button" type="button" onClick={onLogout} title="Sair" aria-label="Sair"><span className="logout-icon" aria-hidden="true">↪</span><span>Sair</span></button>
    </aside>
    </>
  )
}

function WorkspaceTabs({ tabs, activeNav, onNavigate, onCloseTab, onReorderTabs }) {
  const closeAllTabs = useContext(WorkspaceTabsContext)
  const barRef = useRef(null)
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

  // On desktop the bar is fixed to the top; it follows the page area, whose width depends on the sidebar.
  useLayoutEffect(() => {
    const bar = barRef.current
    const area = bar.parentElement
    let left = null
    let width = null
    function place() {
      const rect = area.getBoundingClientRect()
      if (rect.left !== left) { left = rect.left; bar.style.setProperty('--workspace-tabs-left', `${left}px`) }
      if (rect.width !== width) { width = rect.width; bar.style.setProperty('--workspace-tabs-width', `${width}px`) }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(area)
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('scroll', place); window.removeEventListener('resize', place) }
  }, [])

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

  return <div ref={barRef} className="workspace-tabs">
    <span className="mobile-page-title">{pageLabel(activeNav)}</span>
    {scrollState.overflow && <button ref={leftArrowRef} className="workspace-tabs-control" type="button" aria-label="Rolar abas para a esquerda" title="Rolar abas para a esquerda" disabled={!scrollState.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={17} aria-hidden="true" /></button>}
    <div ref={listRef} className="workspace-tabs-list" role="tablist" aria-label="Telas abertas" onScroll={measureTabs}>
      {tabs.map((tab) => <div className={`workspace-tab ${activeNav === tab ? 'workspace-tab--active' : ''} ${draggedTab === tab ? 'workspace-tab--dragging' : ''}`} key={tab} draggable onDragStart={() => setDraggedTab(tab)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropTab(tab)} onDragEnd={() => setDraggedTab(null)}><button type="button" role="tab" aria-selected={activeNav === tab} onClick={() => onNavigate(tab)}>{pageLabel(tab)}</button>{tabs.length > 1 && <button className="workspace-tab-close" type="button" aria-label={`Fechar aba ${pageLabel(tab)}`} onClick={() => onCloseTab(tab)}>×</button>}</div>)}
    </div>
    {scrollState.overflow && <button ref={rightArrowRef} className="workspace-tabs-control" type="button" aria-label="Rolar abas para a direita" title="Rolar abas para a direita" disabled={!scrollState.right} onClick={() => scrollTabs(1)}><ChevronRight size={17} aria-hidden="true" /></button>}
    {tabs.length > 3 && <button className="workspace-tabs-control workspace-tabs-close-all" type="button" aria-label="Fechar todas as abas" title="Fechar todas as abas" onClick={closeAllTabs}><X size={17} aria-hidden="true" /></button>}
    <NotificationsButton onOpenAccount={(id) => { sessionStorage.setItem('gmac-payable-open', id); onNavigate('Contas a Pagar'); window.dispatchEvent(new CustomEvent('gmac-payable-open', { detail: id })) }} onOpenReceivable={(id) => { sessionStorage.setItem('gmac-receivable-open', id); onNavigate('Contas a Receber'); window.dispatchEvent(new CustomEvent('gmac-receivable-open', { detail: id })) }} onOpenNotice={(notice) => notice.type === 'proposal-saved' ? window.dispatchEvent(new CustomEvent('gmac-proposal-open', { detail: notice.offerId })) : notice.type === 'release' ? (sessionStorage.setItem('gmac-release-notes-open', '1'), onNavigate('Configurações'), window.dispatchEvent(new CustomEvent('gmac-release-notes-open'))) : onNavigate({ 'material-request': 'Pedidos', 'low-stock': 'Estoque', 'service-completed': 'Serviços em andamento', 'service-added': 'Serviços em andamento' }[notice.type] || 'Dashboard')} />
    <div className="workspace-tabs-clock" aria-label="Data e hora atual"><strong>{currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><span>{currentTime.toLocaleDateString('pt-BR')}</span></div>
  </div>
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

const loadOverviewPayables = (signal) => apiRequest('/api/payables', { signal, cache: 'no-store' })

// The stock lives only in the database; the browser keeps no copy of it.
async function loadOverviewInventory(signal) {
  const response = await fetch('/api/inventory', { signal, headers: { Authorization: `Bearer ${window.sessionStorage.getItem('gmac-admin-token') || ''}` } })
  if (!response.ok) throw new Error('Não foi possível carregar o estoque.')
  const data = await response.json()
  if (!Array.isArray(data.items)) throw new Error('Dados de estoque inválidos.')
  // MySQL sends DECIMAL columns as text ("40.00"); the screens work with numbers.
  return { items: normalizeInventory(data.items.map((item) => ({ ...item, quantity: Number(item.quantity), minimum: Number(item.minimum), unitPrice: Number(item.unitPrice) }))) }
}

// `knownSectors`: the sectors already in use, to mark with one touch. A machine can belong to more than one sector.
const machineStatusLabels = { working: 'Em funcionamento', idle: 'Ociosa', maintenance: 'Em manutenção' }
const maintenanceSince = (machine) => machine?.maintenance ? new Date(machine.maintenance.since).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }) : ''

// Puts a machine in maintenance (with the reason) or releases it; while in maintenance no operator can choose it.
function MachineMaintenanceModal({ machine, onClose, onDone }) {
  useMobileModal(true, '.machine-modal', onClose)
  const releasing = Boolean(machine.maintenance)
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const data = await apiRequest(`/api/machines/${machine.id}/maintenance`, jsonOptions('POST', releasing ? { active: false } : { active: true, reason }))
      onDone(data.item)
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="machine-modal" role="dialog" aria-modal="true" aria-labelledby="machine-maintenance-title">
        <div className="modal-heading"><div><h2 id="machine-maintenance-title">{releasing ? 'Liberar máquina' : 'Colocar em manutenção'}</h2><p>{machine.name}</p></div><button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Fechar">×</button></div>
        <form onSubmit={submit}>
          {releasing
            ? <p className="machine-maintenance-note">Em manutenção desde <strong>{maintenanceSince(machine)}</strong>{machine.maintenance.startedBy ? ` por ${machine.maintenance.startedBy}` : ''}.<br />Motivo: {machine.maintenance.reason}<br /><br />Ao liberar, a máquina volta a aparecer para os operadores.</p>
            : <><p className="machine-maintenance-note">Enquanto estiver em manutenção, nenhum operador consegue escolher esta máquina.</p>
              <label>Motivo da manutenção<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={500} rows={3} placeholder="Ex.: troca do rolamento do cabeçote" /></label></>}
          {error && <p className="workflow-error" role="alert">{error}</p>}
          <div className="modal-actions"><button className="modal-cancel" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="modal-save" type="submit" disabled={busy}>{busy ? 'Salvando...' : releasing ? 'Liberar máquina' : 'Colocar em manutenção'}</button></div>
        </form>
      </div>
    </div>
  )
}

function MachineModal({ machine, onClose, onSave }) {
  useMobileModal(true, '.machine-modal', onClose)
  const [draft, setDraft] = useState(machine ? { ...machine, type: machine.type || '', sectors: machine.sectors?.length ? machine.sectors : parseSectors(machine.sector), hourlyRate: machine.hourlyRate ?? '' } : { name: '', type: '', sectors: [], hourlyRate: '', status: 'idle', operator: '—', started: '—', usage: '0h 00min' })
  const [sectorError, setSectorError] = useState('')
  const isEditing = Boolean(machine)
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  const chosen = draft.sectors

  function submit(event) {
    event.preventDefault()
    if (!chosen.length) return setSectorError('Marque pelo menos um setor.')
    onSave({ ...draft, name: draft.name.trim(), type: draft.type.trim(), sectors: chosen, sector: chosen.join(', '), hourlyRate: Number(draft.hourlyRate) })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="machine-modal" role="dialog" aria-modal="true" aria-labelledby="machine-modal-title">
        <div className="modal-heading"><div><h2 id="machine-modal-title">{isEditing ? 'Editar máquina' : 'Adicionar máquina'}</h2><p>Preencha os dados da máquina.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button></div>
        <form onSubmit={submit}>
          <label>Nome da máquina<input value={draft.name} onChange={(event) => update('name', event.target.value)} required /></label>
          <label>Tipo<input value={draft.type} onChange={(event) => update('type', event.target.value)} placeholder="Opcional" /></label>
          <SectorPicker value={chosen} onChange={(sectors) => { setSectorError(''); update('sectors', sectors) }} error={sectorError} />
          <label>Valor da hora (R$)<input type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => update('hourlyRate', event.target.value)} required /></label>
          <label>Status atual<input value={machineStatusLabels[machine?.status] || 'Ociosa'} readOnly /></label>
          <div className="modal-actions"><button className="modal-cancel" type="button" onClick={onClose}>Cancelar</button><button className="modal-save" type="submit">Salvar máquina</button></div>
        </form>
      </div>
    </div>
  )
}

function Machines({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }) {
  const [machines, setMachines] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modalMachine, setModalMachine] = useState(undefined)
  const [historyMachine, setHistoryMachine] = useState(null)
  const [maintenanceMachine, setMaintenanceMachine] = useState(null)
  const [machineError, setMachineError] = useState('')
  const [idleEmployees, setIdleEmployees] = useState(null)
  useEffect(() => {
    let active = true, pending = false
    const controller = new AbortController()
    async function refresh() {
      if (pending) return
      pending = true
      try {
        // Idle employees help to decide who takes a stopped machine; their list failing does not hide the machines.
        const [data, idle] = await Promise.all([apiRequest('/api/machines', { signal: controller.signal, cache: 'no-store' }), apiRequest('/api/operations/idle-employees', { signal: controller.signal, cache: 'no-store' }).catch(() => null)])
        if (!active) return
        if (idle) setIdleEmployees(idle.items)
        setMachines(data.items)
        setSelectedId((current) => data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null)
        setMachineError('')
      } catch (error) { if (active) setMachineError(error.message) }
      finally { pending = false }
    }
    const resume = () => { if (document.visibilityState !== 'hidden') refresh() }
    refresh()
    const stopPolling = pollWhileVisible(refresh, 10000)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      active = false
      controller.abort()
      stopPolling()
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  const filteredMachines = machines.filter((machine) => {
    const matchesFilter = filter === 'all' || machine.status === filter
    const query = search.toLowerCase()
    return matchesFilter && (!query || `${machine.name} ${machine.type} ${machine.sector} ${machine.operator}`.toLowerCase().includes(query))
  })
  const workingCount = machines.filter((machine) => machine.status === 'working').length
  const idleCount = machines.filter((machine) => machine.status === 'idle').length
  const maintenanceCount = machines.filter((machine) => machine.status === 'maintenance').length
  // Machines used earlier today stay listed after they stop; the dot shows whether they are running now.
  const usedToday = machines.filter((machine) => machine.status === 'working' || machine.usageMs > 0).sort((a, b) => (b.usageMs || 0) - (a.usageMs || 0))
  const selectedMachine = machines.find((machine) => machine.id === selectedId)
  const percentage = (count) => machines.length ? `${((count / machines.length) * 100).toFixed(1).replace('.', ',')}%` : '0,0%'

  async function saveMachine(machine) {
    try {
      const data = await apiRequest(machine.id != null ? `/api/machines/${machine.id}` : '/api/machines', jsonOptions(machine.id != null ? 'PUT' : 'POST', machine))
      setMachines((current) => machine.id != null ? current.map((item) => String(item.id) === String(machine.id) ? { ...data.item, status: item.status, operator: item.operator, started: item.started, usage: item.usage, idle: item.idle } : item) : [...current, data.item])
      setSelectedId(data.item.id)
      setMachineError('')
      setModalMachine(undefined)
      const snapshot = await apiRequest('/api/machines', { cache: 'no-store' })
      setMachines(snapshot.items)
    } catch (error) { setMachineError(error.message) }
  }

  async function maintenanceChanged() {
    setMaintenanceMachine(null)
    setMachineError('')
    try { setMachines((await apiRequest('/api/machines', { cache: 'no-store' })).items) } catch (error) { setMachineError(error.message) }
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
        <div className="machines-header"><div><h1>Máquinas</h1><p>Gerencie o parque de máquinas, disponibilidade e utilização em tempo real.</p></div><div className="machines-header-actions"><div className="machine-search"><Icon name="search" /><input placeholder="Buscar máquina, setor ou operador..." value={search} onChange={(event) => setSearch(event.target.value)} /></div></div></div>
        <div className="machine-toolbar"><div className="machine-filters"><button className={`machine-filter ${filter === 'all' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('all')}>Todas</button><button className={`machine-filter ${filter === 'working' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('working')}><span className="status-dot status-dot--green" />Em funcionamento</button><button className={`machine-filter ${filter === 'idle' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('idle')}><span className="status-dot status-dot--gray" />Ociosas</button><button className={`machine-filter ${filter === 'maintenance' ? 'machine-filter--selected' : ''}`} type="button" onClick={() => setFilter('maintenance')}><span className="status-dot status-dot--amber" />Em manutenção</button></div><div className="machine-actions"><button className="machine-action machine-action--primary" type="button" onClick={() => setModalMachine(null)}><Icon name="plus" />Adicionar máquina</button><button className="machine-action" type="button" disabled={!selectedMachine} onClick={() => setModalMachine(selectedMachine)}><Icon name="edit" />Editar máquina</button><button className="machine-action" type="button" disabled={!selectedMachine || selectedMachine.status === 'working'} title={selectedMachine?.status === 'working' ? 'Pause o trabalho na máquina antes de colocá-la em manutenção' : undefined} onClick={() => setMaintenanceMachine(selectedMachine)}><Wrench className="icon" size={20} aria-hidden="true" />{selectedMachine?.maintenance ? 'Liberar máquina' : 'Manutenção'}</button><button className="machine-action machine-action--danger" type="button" disabled={!selectedMachine} onClick={() => removeSelected()}><Icon name="trash" />Remover máquina</button></div></div>
        <div className="machine-metrics"><div className="machine-metric"><span className="metric-icon metric-icon--blue"><Icon name="machines" /></span><div><span>Máquinas totais</span><strong>{machines.length}</strong><small>Parque de máquinas</small></div></div><div className="machine-metric"><span className="metric-icon metric-icon--green">▷</span><div><span>Em funcionamento</span><strong>{workingCount}</strong><small>{percentage(workingCount)} do total</small></div></div><div className="machine-metric"><span className="metric-icon metric-icon--blue">Ⅱ</span><div><span>Ociosas</span><strong>{idleCount}</strong><small>{percentage(idleCount)} do total</small></div></div><div className="machine-metric"><span className="metric-icon metric-icon--amber"><Wrench size={22} aria-hidden="true" /></span><div><span>Em manutenção</span><strong>{maintenanceCount}</strong><small>{percentage(maintenanceCount)} do total</small></div></div></div>
        <section className="machine-list-card"><h2>Lista de máquinas</h2><div className="machine-table-scroll"><div className="machine-table"><div className="machine-row machine-row--header"><span>Máquina</span><span>Tipo</span><span>Setor</span><span>Status</span><span>Operador atual</span><span>Início de uso</span><span>Tempo de uso<br />Total hoje</span><span>Ações</span></div>{filteredMachines.map((machine) => <div className={`machine-row ${selectedId === machine.id ? 'machine-row--selected' : ''}`} key={machine.id} onClick={() => setSelectedId(machine.id)}><div className="machine-name"><Icon name="machines" /><strong>{machine.name}</strong></div><span>{machine.type}</span><span>{machine.sector}</span><span><span className={`machine-status machine-status--${machine.status}`} title={machine.maintenance ? `Desde ${maintenanceSince(machine)} · ${machine.maintenance.reason}` : undefined}><i />{machineStatusLabels[machine.status] || 'Ociosa'}</span></span><span>{machine.operator}</span><span><span className="machine-started-content"><span>{machine.started}</span><button className="machine-history-button" type="button" title="Histórico de uso" aria-label={`Ver histórico de uso de ${machine.name}`} onClick={(event) => { event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); setHistoryMachine(machine) }}><Info size={16} aria-hidden="true" /></button></span></span><span>{machine.usage}</span><div className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(machine.id) }} aria-label={`Visualizar ${machine.name}`}><Icon name="eye" /></button><button type="button" onClick={(event) => { event.stopPropagation(); setModalMachine(machine) }} aria-label={`Editar ${machine.name}`}><Icon name="edit" /></button><button type="button" disabled={machine.status === 'working'} title={machine.maintenance ? 'Liberar máquina' : machine.status === 'working' ? 'Pause o trabalho antes da manutenção' : 'Colocar em manutenção'} onClick={(event) => { event.stopPropagation(); setSelectedId(machine.id); setMaintenanceMachine(machine) }} aria-label={`${machine.maintenance ? 'Liberar' : 'Manutenção de'} ${machine.name}`}><Wrench size={18} aria-hidden="true" /></button><button className="row-delete" type="button" onClick={(event) => { event.stopPropagation(); removeSelected(machine) }} aria-label={`Remover ${machine.name}`}><Icon name="trash" /></button></div></div>)}</div></div></section>
        <div className="machine-summary-grid"><section className="machine-summary-card availability-card"><h2>Visão de disponibilidade</h2><div className="availability-content"><div className="availability-donut" style={{ '--working-share': `${machines.length ? (workingCount / machines.length) * 100 : 0}%` }}><strong>{machines.length}</strong><span>máquinas</span></div><div className="availability-legend"><div><i className="dot-green" />Em funcionamento <strong>{workingCount}</strong><span>{percentage(workingCount)}</span></div><div><i className="dot-gray" />Ociosas <strong>{idleCount}</strong><span>{percentage(idleCount)}</span></div>{maintenanceCount > 0 && <div><i className="dot-amber" />Em manutenção <strong>{maintenanceCount}</strong><span>{percentage(maintenanceCount)}</span></div>}</div></div></section><section className="machine-summary-card"><h2>Tempo de uso (hoje)</h2>{usedToday.map((machine) => <div className="usage-line" key={machine.id}><i className={machine.status === 'working' ? 'dot-green' : 'dot-gray'} title={machine.status === 'working' ? 'Em funcionamento' : 'Parada agora'} /><span>{machine.name}</span><strong>{machine.usage}</strong></div>)}{!usedToday.length && <p className="usage-empty">Nenhuma máquina foi usada hoje.</p>}</section><section className="machine-summary-card"><h2>Máquinas ociosas (hoje)</h2>{idleCount > 0 && <div className="usage-scroll" role="region" aria-label="Máquinas ociosas (hoje)" tabIndex={0}>{machines.filter((machine) => machine.status === 'idle').map((machine) => <div className="usage-line" key={machine.id}><i className="dot-gray" /><span>{machine.name}</span><strong>{machine.idle}</strong></div>)}</div>}{machines.length > 0 && !idleCount && <p className="usage-empty">Todas as máquinas estão em funcionamento.</p>}</section></div>
        {idleEmployees && <section className="machine-summary-card idle-employees-card" aria-labelledby="idle-employees-title"><h2 id="idle-employees-title">Funcionários ociosos (agora) <span>{idleEmployees.length}</span></h2>{idleEmployees.length ? <ul>{idleEmployees.map((person) => <li className="usage-line" key={person.id}><i className="dot-gray" /><span>{person.name}</span><small>{person.idleSince ? `Parado desde ${new Date(person.idleSince).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}${person.reason ? ` · ${person.reason}` : ''}${person.orderCode ? ` · ${person.orderCode}` : ''}` : 'Sem trabalho hoje'}</small></li>)}</ul> : <p className="usage-empty">Todos os operadores estão trabalhando em alguma OS.</p>}</section>}
        <MachineUsageBI request={loadMachineUsage} machines={machines} />
      </main>
      {modalMachine !== undefined && <MachineModal machine={modalMachine == null ? modalMachine : machines.find((machine) => machine.id === modalMachine.id) || modalMachine} onClose={() => setModalMachine(undefined)} onSave={saveMachine} />}
      {historyMachine && <MachineHistoryModal machine={historyMachine} loadHistory={loadMachineHistory} onClose={() => setHistoryMachine(null)} />}
      {maintenanceMachine && <MachineMaintenanceModal machine={maintenanceMachine} onClose={() => setMaintenanceMachine(null)} onDone={maintenanceChanged} />}
    </div>
  )
}

// Purchase to offer to the financial module once the material is in stock; only an administrator can post it.
// It is not linked to an OS: material planned in a proposal is already part of that OS cost.
function stockPurchase(item) {
  const quantity = purchasedQuantity(item)
  return quantity > 0 && window.sessionStorage.getItem('gmac-admin-token') ? { name: item.name, detail: item.detail, unit: materialUnit(item.unit), quantity, unitPrice: item.unitPrice } : null
}

async function saveInventoryMaterial(item, materialRequestId, materialReceiptId) {
  if (item.id && Number(item.stockEntryQuantity) > 0) {
    await apiRequest(`/api/inventory/${item.id}/movements`, jsonOptions('POST', { type: 'entry', quantityKg: Number(item.stockEntryQuantity), unitPrice: Number(item.unitPrice), destination: 'Entrada de estoque', materialRequestId, materialReceiptId }))
  } else {
    const body = { name: item.name, detail: item.detail, unit: materialUnit(item.unit), minimum: item.minimum, unitPrice: item.unitPrice, icon: item.icon || 'sheet', photo: item.photo || null, materialRequestId, materialReceiptId, ...(!item.id ? { quantity: item.quantity } : {}) }
    await apiRequest(item.id ? `/api/inventory/${item.id}` : '/api/inventory', jsonOptions(item.id ? 'PATCH' : 'POST', body))
  }
}

function InventoryScreen({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, onSelectOrder }) {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [modalItem, setModalItem] = useState(undefined)
  const [historyItem, setHistoryItem] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [savingInventory, setSavingInventory] = useState(false)
  const [purchase, setPurchase] = useState(null)
  const filteredItems = items.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(search.trim().toLowerCase()))
  // Kilos, metres and units are added up apart: their sum would mean nothing.
  const totals = materialUnits.map(([unit]) => [unit, items.filter((item) => materialUnit(item.unit) === unit).reduce((total, item) => total + Number(item.quantity || 0), 0)]).filter(([unit, total]) => unit === 'kg' || total > 0)
  const lowStock = items.filter((item) => Number(item.quantity) <= Number(item.minimum)).length

  useEffect(() => {
    let active = true
    const refresh = () => loadOverviewInventory()
      .then((payload) => {
        if (!active || !Array.isArray(payload.items)) return
        setItems(payload.items)
        setLoaded(true)
        setError('')
      })
      .catch((failure) => { if (active) setError(failure.message) })
    refresh()
    const stopPolling = pollWhileVisible(refresh, 10000)
    return () => { active = false; stopPolling() }
  }, [])

  async function saveItem(item) {
    if (savingInventory || !loaded) return
    setSavingInventory(true)
    setError('')
    try {
      await saveInventoryMaterial(item)
      setModalItem(undefined)
      setPurchase(stockPurchase(item))
      setItems((await loadOverviewInventory()).items)
    } catch (failure) { setError(failure.message) }
    finally { setSavingInventory(false) }
  }

  async function removeItem(item) {
    if (savingInventory || !loaded) return
    if (!window.confirm(`Remover ${item.name} do estoque?`)) return
    setSavingInventory(true)
    try {
      await apiRequest(`/api/inventory/${item.id}`, { method: 'DELETE' })
      const result = await loadOverviewInventory()
      setItems(result.items)
      setError('')
    } catch (failure) { setError(failure.message) }
    finally { setSavingInventory(false) }
  }

  async function openHistory(item) {
    setHistoryItem(item)
    try {
      const response = await fetch(`/api/inventory/${item.id}/history`, { headers: { Authorization: `Bearer ${window.sessionStorage.getItem('gmac-admin-token') || ''}` } })
      if (!response.ok) return
      const payload = await response.json()
      if (Array.isArray(payload.history) && payload.history.length) setHistoryItem({ ...item, history: payload.history })
    } catch {
      // Without the answer, the modal keeps the history that came with the material list.
    }
  }

  return (
    <div className="dashboard-shell inventory-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="inventory-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="inventory-header"><div><span className="inventory-kicker">Controle de materiais</span><h1>Estoque</h1><p>Gerencie os materiais disponíveis para os serviços e propostas.</p></div><button className="inventory-add-button" type="button" onClick={() => setModalItem(null)}><Icon name="plus" />Adicionar material</button></div>
        <div className="inventory-metrics"><div><span className="inventory-metric-icon">▰</span><div><small>Materiais cadastrados</small><strong>{items.length}</strong></div></div><div><span className="inventory-metric-icon inventory-metric-icon--green">▣</span><div><small>Quantidade total</small><strong>{totals.map(([unit, total]) => formatQuantity(total, unit)).join(' · ')}</strong></div></div><div><span className="inventory-metric-icon inventory-metric-icon--orange">!</span><div><small>Estoque baixo</small><strong>{lowStock}</strong></div></div></div>
        <section className="inventory-card"><div className="inventory-toolbar"><h2>Materiais em estoque</h2><label className="inventory-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar material ou especificação..." /></label></div><div className="inventory-table-scroll"><div className="inventory-table"><div className="inventory-row inventory-row--header"><span>Material</span><span>Especificação</span><span>Disponível</span><span>Estoque mínimo</span><span>Valor unitário</span><span>Status</span><span>Ações</span></div>{filteredItems.map((item) => <div className="inventory-row" key={item.id}><div className="inventory-material-name"><MaterialVisual {...item} /><strong>{item.name}</strong></div><span>{item.detail}</span><strong>{formatQuantity(item.quantity, item.unit)}</strong><span>{formatQuantity(item.minimum, item.unit)}</span><span>{Number(item.unitPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{materialUnit(item.unit)}</span><span className={`inventory-status inventory-status--${Number(item.quantity) <= Number(item.minimum) ? 'low' : 'available'}`}>{Number(item.quantity) <= Number(item.minimum) ? 'Estoque baixo' : 'Disponível'}</span><div className="inventory-row-actions"><button className="inventory-info" type="button" onClick={() => openHistory(item)} aria-label={`Ver histórico de ${item.name}`}><Icon name="info" /></button><button type="button" onClick={() => setModalItem(item)} aria-label={`Editar ${item.name}`}><Icon name="edit" /></button><button className="inventory-delete" type="button" onClick={() => removeItem(item)} aria-label={`Remover ${item.name}`}><Icon name="trash" /></button></div></div>)}</div></div>{filteredItems.length === 0 && <div className="inventory-empty">Nenhum material encontrado.</div>}</section>
        {error && modalItem === undefined && <p role="alert" className="workflow-error">{error}</p>}
      </main>
      {modalItem !== undefined && <InventoryModal item={modalItem} inventoryItems={items} saving={savingInventory || !loaded} error={error} onClose={() => { if (!savingInventory) setModalItem(undefined) }} onSave={saveItem} />}
      {historyItem && <InventoryHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} onSelectOrder={(code) => { setHistoryItem(null); onSelectOrder(code) }} />}
      {purchase && <StockPurchaseFinance purchase={purchase} onClose={() => setPurchase(null)} />}
    </div>
  )
}

function InventoryHistoryModal({ item, onClose, onSelectOrder }) {
  useMobileModal(true, '.inventory-history-modal', onClose)
  const history = [...(item.history || [])].sort((left, right) => new Date(right.date) - new Date(left.date))
  const formatDate = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  }
  const movementLabel = { creation: 'Criação do material', entry: 'Entrada de material', exit: 'Saída de material' }

  return <div className="modal-backdrop inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="inventory-history-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-history-title" onMouseDown={(event) => event.stopPropagation()}><button className="inventory-modal-close" type="button" onClick={onClose} aria-label="Fechar">×</button><span className="inventory-kicker">Rastreabilidade do estoque</span><h2 id="inventory-history-title">Histórico do material</h2><div className="inventory-history-summary"><div><small>Material</small><strong>{item.name}</strong><span>{item.detail || 'Sem especificação'}</span></div><div><small>Saldo atual</small><strong>{formatQuantity(item.quantity, item.unit)}</strong></div></div><div className="inventory-history-heading"><h3>Movimentações registradas</h3><span>{history.length} {history.length === 1 ? 'registro' : 'registros'}</span></div><div className="inventory-history-table"><div className="inventory-history-row inventory-history-row--header"><span>Data</span><span>Movimentação</span><span>Quantidade</span><span>{unitPriceLabel(item.unit)}</span><span>Saldo após movimento</span><span>Destino / OS</span></div>{history.map((entry) => <div className="inventory-history-row" key={entry.id}><span>{formatDate(entry.date)}</span><strong className={`inventory-history-type inventory-history-type--${entry.type}`}>{movementLabel[entry.type] || 'Movimentação'}</strong><span className={entry.type === 'exit' ? 'inventory-history-quantity--exit' : 'inventory-history-quantity--entry'}>{entry.type === 'exit' ? '−' : '+'}{formatQuantity(entry.quantity, item.unit)}</span><strong className="inventory-history-price">{Number(entry.unitPrice || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{materialUnit(item.unit)}</strong><span>{formatQuantity(entry.balance, item.unit)}</span><span>{entry.destination || '—'}{entry.order && entry.order !== '—' ? <button className="inventory-history-order-link" type="button" onClick={() => onSelectOrder(entry.order)}>{entry.order}</button> : null}</span></div>)}</div><p className="inventory-history-note">O valor exibido é o preço unitário praticado em cada movimentação. O saldo atual usa o preço médio ponderado.</p></section></div>
}

function InventoryModal({ item, inventoryItems = [], initialExistingId = null, saving = false, error = '', onClose, onSave }) {
  const isEditing = Boolean(item?.id)
  const [processingPhoto, setProcessingPhoto] = useState(false)
  const busy = saving || processingPhoto
  useMobileModal(true, '.inventory-modal', () => { if (!busy) onClose() })
  const [form, setForm] = useState(item ? { ...item, unit: materialUnit(item.unit) } : { name: '', detail: '', unit: 'kg', quantity: '', minimum: '', unitPrice: '' })
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false)
  const [selectedExistingId, setSelectedExistingId] = useState(initialExistingId)
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const isStockEntry = !isEditing && selectedExistingId !== null
  const selectedExistingMaterial = inventoryItems.find((material) => material.id === selectedExistingId)
  // A stock entry is in the unit of the material; the unit of a registered material changes only with its balance at zero.
  const unit = materialUnit(isStockEntry ? selectedExistingMaterial?.unit : form.unit), unitLocked = isEditing && Number(item.quantity) !== 0
  const step = quantityStep(unit)
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
    if (busy) return
    if (isStockEntry) {
      const entryQuantity = Number(form.quantity) || 0
      if (entryQuantity <= 0) return
      onSave({ ...form, id: selectedExistingId, unit, stockEntryQuantity: entryQuantity, minimum: 0, unitPrice: Number(form.unitPrice) || 0 })
      return
    }
    onSave({ ...form, unit, quantity: isEditing ? Number(item.quantity) || 0 : Number(form.quantity) || 0, minimum: Number(form.minimum) || 0, unitPrice: Number(form.unitPrice) || 0 })
  }

  return <div className="modal-backdrop inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title" aria-busy={busy} onMouseDown={(event) => event.stopPropagation()}>
      <button className="inventory-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Fechar">×</button>
      <span className="inventory-kicker">Estoque</span><h2 id="inventory-modal-title">{isEditing ? 'Editar material' : 'Adicionar material'}</h2>
      {error && <p role="alert" className="workflow-error">{error}</p>}
      <form onSubmit={submit}>
        {!isStockEntry && <MaterialAppearance value={form} disabled={saving} processing={processingPhoto} onProcessing={setProcessingPhoto} onChange={(appearance) => setForm((current) => ({ ...current, ...appearance }))} />}
        <label>Nome do material *<div className="material-autocomplete"><div className="material-autocomplete-input"><input value={form.name} onFocus={() => setNameSuggestionsOpen(true)} onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 120)} onChange={(event) => { update('name', event.target.value); setSelectedExistingId(null); setNameSuggestionsOpen(true) }} placeholder="Digite para buscar no estoque" required /><span>⌄</span></div>{nameSuggestionsOpen && <div className="material-suggestions">{matchingMaterials.length > 0 ? matchingMaterials.map((material) => <button type="button" key={material.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectExistingMaterial(material)}><strong>{material.name}</strong><small>{material.detail}</small></button>) : <div className="material-suggestion-empty"><strong>Novo material</strong><span>Preencha os dados para cadastrar um novo material.</span></div>}</div>}</div></label>
        <label>Especificação<input value={form.detail} onChange={(event) => update('detail', event.target.value)} placeholder="Ex.: Chapa Alumínio 6061" /></label>
        {!isStockEntry && <fieldset className="inventory-unit-field" disabled={unitLocked || saving}><legend>Unidade de medida</legend><div>{materialUnits.map(([key, label]) => <label key={key}><input type="radio" name="inventory-unit" checked={unit === key} onChange={() => update('unit', key)} />{label}</label>)}</div>{unitLocked && <small>A unidade só muda com o saldo zerado.</small>}</fieldset>}
        {isStockEntry ? <label className="inventory-entry-field">Quantidade de entrada ({unit}) *<input type="number" min={step} step={step} value={form.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="0,00" required /><small>Saldo atual: {formatQuantity(currentQuantity, unit)}. Preço médio após a entrada: {projectedUnitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{unit}.</small></label> : <div className="inventory-form-grid"><label className={isEditing ? 'inventory-readonly-field' : ''}>{isEditing ? `Quantidade disponível (${unit}) — somente leitura` : `Quantidade disponível (${unit}) *`}<input type="number" min="0" step={step} value={form.quantity} onChange={(event) => update('quantity', event.target.value)} readOnly={isEditing} aria-readonly={isEditing} required /><small>{isEditing ? 'Altere o saldo usando uma entrada ou saída de estoque.' : 'Informe o saldo inicial do material.'}</small></label><label>Estoque mínimo ({unit})<input type="number" min="0" step={step} value={form.minimum} onChange={(event) => update('minimum', event.target.value)} /></label></div>}
        <label>{unitPriceLabel(unit)}<input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => update('unitPrice', event.target.value)} /></label>
        <div className="inventory-modal-actions"><button className="offer-modal-cancel" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="inventory-add-button" type="submit" disabled={busy}>{processingPhoto ? 'Preparando foto...' : saving ? 'Salvando...' : isStockEntry ? 'Registrar entrada' : isEditing ? 'Salvar alterações' : 'Adicionar material'}</button></div>
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
        <div className="calculator-mobile-choices"><label>Material<select aria-label="Material" value={material} onChange={(event) => selectMaterial(event.target.value)}>{calculatorMaterials.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><label>Formato<select aria-label="Formato" value={format} onChange={(event) => { setFormat(event.target.value); setValues({}) }}>{visibleFormats.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><div className="calculator-mobile-shape"><CalculatorFormatIcon format={format} /><span>{selectedFormat.name}</span><small>{selectedMaterial.density.toFixed(2).replace('.', ',')} g/cm³</small></div></div>
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

// A piece made before: the new offer comes with the materials, stages and times of its history (see server/pieces.js).
// Returns false when the piece is new.
async function applyPieceSuggestion(offer) {
  const query = new URLSearchParams({ name: offer.service, quantity: String(offer.quantity), offerId: offer.id })
  const { item } = await apiRequest(`/api/pieces/suggestion?${query}`)
  if (!item) return false
  await apiRequest(`/api/offers/${offer.id}/resources`, jsonOptions('PUT', item.resources))
  return item
}

// An employee is an operator (4-digit code), administrative (CPF and password) or both (`both`).
const operatesMachines = (type) => type === 'operator' || type === 'both'
const worksInOffice = (type) => type === 'administrative' || type === 'both'
const employeeType = (operator, staff) => operator && staff ? 'both' : staff ? 'administrative' : 'operator'
const employeeTypeLabel = (type) => [operatesMachines(type) && 'Operador', worksInOffice(type) && 'Administrativo'].filter(Boolean).join(' e ')

function RegistrationScreen({ kind, collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }) {
  const isEmployee = kind === 'employee'
  const isClient = kind === 'client'
  const [records, setRecords] = useState([])
  const endpoint = isEmployee ? '/api/employees' : isClient ? '/api/clients' : '/api/admins'
  const emptyForm = () => isClient ? { name: '', documentType: 'cnpj', document: '', email: '', notes: '' } : { name: '', birthDate: '', cpf: '', email: '', password: '', identification: '', ...(isEmployee ? { type: 'operator', accessCode: '', sectorId: '' } : {}) }
  const [form, setForm] = useState(emptyForm)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [activityEmployee, setActivityEmployee] = useState(null)
  const [passwordHistory, setPasswordHistory] = useState(false)
  const viewer = useContext(AdminIdentityContext)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const formId = `registration-form-${kind}`

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

  // The form lives in a modal: errors stay inside it, success closes it and shows the notice above the list.
  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    setSaving(true)
    try { await submitForm() } finally { setSaving(false) }
  }

  async function submitForm() {
    const setMessage = (text) => text.includes('sucesso') ? setNotice(text) : setFormError(text)
    if (isEmployee && operatesMachines(form.type) && !/^\d{4}$/.test(form.accessCode)) {
      setMessage('Informe o código de acesso do operador com 4 dígitos.')
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
    setForm(emptyForm())
    setEditingId(null)
    setShowPassword(false)
    setFormError('')
    setFormOpen(false)
  }
  const setNotice = (text) => setMessage(text)

  function newRecord() {
    clearForm()
    setMessage('')
    setFormOpen(true)
  }

  function editRecord(record) {
    setForm({ ...record, password: '', ...(isEmployee ? { accessCode: record.accessCode || '', sectorIds: record.sectorIds || [] } : {}) })
    setEditingId(record.id)
    setShowPassword(false)
    setFormError('')
    setMessage('')
    setFormOpen(true)
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

  // Once the employee worked or authored something, the registration is kept for the history: it is deactivated instead.
  async function toggleActive(record) {
    const active = record.active === false
    if (!window.confirm(`${active ? 'Reativar' : 'Desativar'} o cadastro de ${record.name}?${active ? '' : ' O histórico continua no sistema, mas ele não poderá mais entrar nem iniciar trabalhos.'}`)) return
    try {
      await apiRequest(`/api/employees/${record.id}/active`, jsonOptions('PATCH', { active }))
      setRecords((current) => current.map((item) => item.id === record.id ? { ...item, active } : item))
      setMessage(`Funcionário ${active ? 'reativado' : 'desativado'} com sucesso.`)
    } catch (error) { setMessage(error.message) }
  }

  const passwordRequired = editingId === null || isEmployee && !worksInOffice(records.find((item) => item.id === editingId)?.type)
  // Checking one role keeps the other as it is; at least one stays checked. Only operators have sectors.
  function changeEmployeeRole(role, checked) {
    const operator = role === 'operator' ? checked : operatesMachines(form.type)
    const staff = role === 'staff' ? checked : worksInOffice(form.type)
    if (!operator && !staff) return
    update('type', employeeType(operator, staff))
    if (!operator) update('sectorIds', [])
  }
  function generateAccessCode() {
    const taken = new Set(records.filter((item) => item.id !== editingId).map((item) => item.accessCode))
    let code
    do code = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); while (taken.has(code))
    update('accessCode', code)
  }

  const singular = isEmployee ? 'funcionário' : isClient ? 'cliente' : 'administrador'
  const title = isEmployee ? 'Funcionários' : isClient ? 'Clientes' : 'Administradores'
  const cpfMask = (value) => value.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  // The name has the room; documents are formatted; the actions stay at the right. Headers sort, the search finds any field.
  const listColumns = isClient
    ? [{ key: 'name', label: 'Nome / razão social', value: (row) => row.name, search: true }, { key: 'notes', value: (row) => row.notes, search: true, hidden: true }, { key: 'document', label: 'CPF / CNPJ', value: (row) => row.document, search: true }, { key: 'email', label: 'E-mail', value: (row) => row.email || '', search: true }]
    : [...(isEmployee ? [] : [{ key: 'id', label: 'ID', value: (row) => Number(row.id), numeric: true }]), { key: 'name', label: 'Nome', value: (row) => row.name, search: true },
      ...(isEmployee ? [{ key: 'type', label: 'Tipo', value: (row) => employeeTypeLabel(row.type) }, { key: 'sector', label: 'Setor', value: (row) => row.sectorName || '', search: true }, { key: 'accessCode', label: 'Código', value: (row) => row.accessCode || '', search: true }] : []),
      { key: 'cpf', label: 'CPF', value: (row) => row.cpf, search: true }, { key: 'email', label: 'E-mail', value: (row) => row.email || '', search: true }, { key: 'birthDate', label: 'Nascimento', value: (row) => row.birthDate || '' }]
  const list = useRegistryList(records, listColumns, 'name')
  const shownColumns = listColumns.filter((column) => !column.hidden)
  const navigationProps = { collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs }
  // Same pattern as Fornecedores: only the list on screen; adding and editing happen in a modal.
  return <AdminWorkspace Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={navigationProps} title={title}>
    <div className="payable-heading-actions">{kind === 'admin' && viewer?.role !== 'staff' && <button className="admin-tool-button" type="button" onClick={() => setPasswordHistory(true)}><History size={17} />Histórico de senhas</button>}<button className="admin-tool-button admin-tool-button--primary" type="button" onClick={newRecord}><Plus size={17} />Novo {singular}</button></div>
    {message && <p className={`registration-message ${message.includes('sucesso') ? 'registration-message--success' : 'registration-message--error'}`} role="status">{message}</p>}
    <RegistryToolbar list={list} total={records.length} singular={singular} plural={title.toLowerCase()} placeholder={isClient ? 'Nome, nome fantasia, CPF/CNPJ ou e-mail' : isEmployee ? 'Nome, código, CPF ou e-mail' : 'Nome, CPF ou e-mail'} />
    <div className="payable-table-scroll"><table className={`payable-table payable-registry-table registration-table registry-table registry-table--${kind}`}><thead><tr>{shownColumns.map((column) => <SortHeader key={column.key} column={column} list={list} className={`registry-col-${column.key}`} />)}<th className="registry-col-actions">Ações</th></tr></thead><tbody>
      {list.rows.map((record) => <tr key={record.id}>
        {!isEmployee && !isClient && <td data-label="ID" className="payable-id">{`ADM-${String(record.id).padStart(3, '0')}`}</td>}
        <td className="registry-name"><strong>{record.name}</strong>{isClient && record.notes && <small title={record.notes}>{record.notes}</small>}{isEmployee && record.active === false && <small className="registry-inactive">Desativado</small>}</td>
        {isEmployee && <><td data-label="Tipo"><span className="registry-badges">{operatesMachines(record.type) && <span className="registry-badge registry-badge--operator">Operador</span>}{worksInOffice(record.type) && <span className="registry-badge registry-badge--admin">Administrativo</span>}</span></td><td data-label="Setor">{record.sectorName || <span className="registry-empty">—</span>}</td><td data-label="Código" className="registry-code">{!operatesMachines(record.type) ? <span className="registry-empty">—</span> : record.accessCode || <span className="registry-empty">—</span>}</td></>}
        <td data-label={isClient ? 'CPF / CNPJ' : 'CPF'} className="registry-document"><span>{isClient && <span className="registry-doc-type">{record.documentType === 'cpf' ? 'CPF' : 'CNPJ'}</span>}{documentLabel(isClient ? record.document : record.cpf)}</span></td>
        <td data-label="E-mail">{record.email || <span className="registry-empty">—</span>}</td>
        {!isClient && <td data-label="Nascimento">{record.birthDate ? record.birthDate.split('-').reverse().join('/') : <span className="registry-empty">—</span>}</td>}
        <td className="registry-actions"><div className="payable-registry-actions">
          <button className="payable-icon" type="button" title="Editar" aria-label={`Editar ${record.name}`} onClick={() => !isEmployee && !isClient && Number(record.id) === 0 ? onNavigate('Configurações') : editRecord(record)}><Pencil size={16} /></button>
          {isEmployee && record.hasActivity ? <button className={`payable-icon${record.active === false ? ' payable-icon--inactive' : ''}`} type="button" title={record.active === false ? 'Reativar' : 'Desativar'} aria-label={`${record.active === false ? 'Reativar' : 'Desativar'} ${record.name}`} onClick={() => toggleActive(record)}><Power size={16} /></button>
            : <button className="payable-icon payable-danger" type="button" title="Excluir" aria-label={`Excluir ${record.name}`} onClick={() => deleteRecord(record.id)}><Trash2 size={16} /></button>}
          {isEmployee && <button className="payable-icon" type="button" title="Histórico de atividades" aria-label={`Ver histórico de ${record.name}`} onClick={() => setActivityEmployee(record)}><Info size={16} /></button>}
        </div></td>
      </tr>)}
      {!list.rows.length && <tr><td colSpan={shownColumns.length + 1} className="payable-empty">{records.length ? 'Nenhum cadastro encontrado para a busca.' : 'Nenhum cadastro.'}</td></tr>}
    </tbody></table></div>
    {formOpen && <PayableModal title={`${editingId !== null ? 'Editar' : 'Novo'} ${singular}`} busy={saving} onClose={clearForm} footer={<><button className="admin-tool-button" type="button" disabled={saving} onClick={clearForm}>Cancelar</button><button className="admin-tool-button admin-tool-button--primary" type="submit" form={formId} disabled={saving}>Salvar</button></>}>
      <form id={formId} className="payable-form registration-modal-form" onSubmit={handleSubmit}><fieldset disabled={saving}>
        <label>{isClient ? 'Nome / razão social' : 'Nome completo'}<input value={form.name} maxLength={160} onChange={(event) => update('name', event.target.value)} required /></label>
        {isClient ? <>
          <label>Tipo de documento<select value={form.documentType} onChange={(event) => { const documentType = event.target.value; update('documentType', documentType); update('document', formatClientDocument(form.document, documentType)) }}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option></select></label>
          <label>{form.documentType === 'cnpj' ? 'CNPJ' : 'CPF'}<input value={form.document} onChange={(event) => update('document', formatClientDocument(event.target.value))} inputMode="numeric" placeholder={form.documentType === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'} required /></label>
          <label>E-mail<input type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} placeholder="Opcional" /></label>
          <label>Observação<textarea rows={3} maxLength={1000} value={form.notes || ''} onChange={(event) => update('notes', event.target.value)} placeholder="Opcional" /></label>
        </> : <>
          {isEmployee && <fieldset className="registration-roles"><legend>Tipo de funcionário</legend>
            <div className="registration-roles-options"><label><input type="checkbox" checked={operatesMachines(form.type)} onChange={(event) => changeEmployeeRole('operator', event.target.checked)} />Operador</label><label><input type="checkbox" checked={worksInOffice(form.type)} onChange={(event) => changeEmployeeRole('staff', event.target.checked)} />Administrativo</label></div>
            <small className="payable-hint">{[operatesMachines(form.type) && 'Operador: entra na conta do operador com o código de 4 dígitos.', worksInOffice(form.type) && 'Administrativo: entra no sistema com CPF e senha, sem a Gestão Financeira.'].filter(Boolean).join(' ')}</small></fieldset>}
          {/* Setores são só dos operadores (fila do tablet); o administrativo não usa. */}
          {isEmployee && operatesMachines(form.type) && <SectorPicker by="id" value={form.sectorIds || []} onChange={(ids) => update('sectorIds', ids)} hint="Opcional. O operador vê no tablet a fila planejada dos seus setores. Para criar um setor novo, use Cadastros › Setores." />}
          {/* Operators may be registered without birth date and e-mail; administrative employees need the e-mail (the reset code goes to it) and administrators need both. */}
          <label>Data de nascimento<input type="date" aria-label="Data de nascimento" value={form.birthDate || ''} onChange={(event) => update('birthDate', event.target.value)} required={!isEmployee} />{isEmployee && <small className="payable-hint">Opcional.</small>}</label>
          <label>CPF<input value={form.cpf} onChange={(event) => update('cpf', cpfMask(event.target.value))} inputMode="numeric" placeholder="000.000.000-00" required /></label>
          <label>E-mail<input type="email" value={form.email || ''} onChange={(event) => update('email', event.target.value)} required={!isEmployee || worksInOffice(form.type)} placeholder={isEmployee && !worksInOffice(form.type) ? 'Opcional' : undefined} />{isEmployee && worksInOffice(form.type) && <small className="payable-hint">Obrigatório: é para este e-mail que vai o código de "Esqueci minha senha".</small>}</label>
          {isEmployee && operatesMachines(form.type) && <label>Código de acesso<span className="registration-access-code"><input value={form.accessCode} onChange={(event) => update('accessCode', event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="Ex.: 4827" autoComplete="off" required /><button type="button" onClick={generateAccessCode}>Gerar código</button></span><small className="payable-hint">4 dígitos, diferente para cada operador.</small></label>}
          {(!isEmployee || worksInOffice(form.type)) && <label>Senha<span className="registration-password"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={passwordRequired ? 'Crie uma senha de acesso' : 'Deixe em branco para manter a senha atual'} minLength={6} required={passwordRequired} autoComplete="new-password" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}><EyeIcon crossed={!showPassword} /></button></span><small className="payable-hint">{passwordRequired ? 'Mínimo de 6 caracteres.' : 'Preencha somente se quiser trocar a senha.'}</small></label>}
        </>}
        {formError && <p className="admin-tool-error" role="alert">{formError}</p>}
      </fieldset></form>
    </PayableModal>}
    {activityEmployee && <EmployeeActivityModal employee={activityEmployee} onClose={() => setActivityEmployee(null)} />}
    {passwordHistory && <PasswordHistoryModal onClose={() => setPasswordHistory(false)} />}
  </AdminWorkspace>
}

// Time since the proposal was sent (its last e-mail, or the generation of its PDF); after 7 days without an answer it turns orange.
const PROPOSAL_FOLLOW_UP_DAYS = 7
function sentSinceText(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000))
  if (minutes < 1) return 'Enviada agora há pouco'
  if (minutes < 60) return `Enviada há ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Enviada há ${hours} ${hours === 1 ? 'hora' : 'horas'}`
  const days = Math.floor(hours / 24)
  return `Enviada há ${days} ${days === 1 ? 'dia' : 'dias'}`
}
function ProposalSentSince({ at }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const late = now - Date.parse(at) >= PROPOSAL_FOLLOW_UP_DAYS * 86400000
  return <span className={`offer-sent-since${late ? ' offer-sent-since--late' : ''}`} title={`Proposta enviada em ${new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}${late ? ' · sem resposta há mais de 7 dias' : ''}`}><Clock3 size={12} aria-hidden="true" />{sentSinceText(at, now)}</span>
}

// An offer still in analysis whose proposal screen was saved: the list shows it and opens the proposal as it was left.
const savedProposal = (offer) => offer.status === 'review' && Boolean(offer.proposalDraft)

const offerFilters = [
  { key: 'review', label: 'Em análise' },
  { key: 'proposed', label: 'Propostas' },
  { key: 'accepted', label: 'Aceitas' },
  { key: 'rejected', label: 'Recusadas' },
]

function Offers({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, onRefresh, onSelectOffer, onSelectOrder, workflowError }) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [rejectingOffer, setRejectingOffer] = useState(null)
  const [decliningOffer, setDecliningOffer] = useState(null)
  const [undoingOffer, setUndoingOffer] = useState(null)
  const [acceptingOffer, setAcceptingOffer] = useState(null)
  const [unacceptingOffer, setUnacceptingOffer] = useState(null)
  useMobileModal(manualOpen, '.offer-manual-modal', () => setManualOpen(false))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const emptyForm = { cnpj: '', company: '', requester: '', buyer: '', deadline: '', service: '', quantity: '', description: '', labelNumber: '', attachment: null }
  const [manualForm, setManualForm] = useState(emptyForm)
  const [pieces, setPieces] = useState([])
  const [clients, setClients] = useState([])
  const [requesters, setRequesters] = useState([])
  const [buyers, setBuyers] = useState([])
  // "Solicitante cadastrado automaticamente" (or the buyer, or both): a discreet notice for 4 seconds after the offer is added.
  const [requesterNotice, setRequesterNotice] = useState('')
  useEffect(() => {
    if (!requesterNotice) return
    const timer = setTimeout(() => setRequesterNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [requesterNotice])
  // The client whose requesters and buyers are offered: the registered client with the typed CPF/CNPJ.
  const manualClient = documentDigits(manualForm.cnpj) ? clients.find((item) => documentDigits(item.document) === documentDigits(manualForm.cnpj)) : null
  // Shown on the list itself: the creation modal is already closed when something after the creation fails.
  const [pageNotice, setPageNotice] = useState('')
  useEffect(() => {
    if (!manualOpen) return
    apiRequest('/api/pieces').then((data) => setPieces(data.items || [])).catch(() => setPieces([]))
    apiRequest('/api/clients').then((data) => setClients(data.items || [])).catch(() => setClients([]))
    apiRequest('/api/requesters').then((data) => setRequesters(data.items || [])).catch(() => setRequesters([]))
    apiRequest('/api/buyers').then((data) => setBuyers(data.items || [])).catch(() => setBuyers([]))
  }, [manualOpen])
  const filteredOffers = offers.filter((offer) => {
    const query = search.trim().toLocaleLowerCase()
    return (activeFilter === 'all' || offer.status === activeFilter)
      && (!query || [offer.service, offer.company, offer.code, offer.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      && (!date || offer.requestedAt.slice(0, 10) === date)
  })

  function updateManualForm(field, value) {
    setManualForm((current) => ({ ...current, [field]: value }))
  }

  // A document typed by hand also finds the registered client, filling the company while it is still empty.
  function changeManualDocument(value) {
    const cnpj = maskClientDocument(value), client = clients.find((item) => documentDigits(item.document) === documentDigits(cnpj))
    setManualForm((current) => ({ ...current, cnpj, company: !current.company.trim() && client ? client.name : current.company }))
  }

  async function addOffer(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setPageNotice('')
    let created = false
    try {
      const { attachment, ...fields } = manualForm
      const { item, requesterCreated, buyerCreated } = await apiRequest('/api/offers', jsonOptions('POST', fields))
      created = true
      if (requesterCreated || buyerCreated) setRequesterNotice(requesterCreated && buyerCreated ? 'Solicitante e comprador cadastrados automaticamente' : `${requesterCreated ? 'Solicitante' : 'Comprador'} cadastrado automaticamente`)
      if (attachment) await uploadOfferAttachment(item.id, attachment)
      try { await applyPieceSuggestion(item) } catch (caught) { setPageNotice(`A oferta ${item.code} foi criada, mas não foi possível preencher com o histórico da peça (${caught.message}). Abra a oferta e use "Preencher com o histórico".`) }
      await onRefresh()
      setManualForm(emptyForm)
      setManualOpen(false)
      setActiveFilter('all')
      setDate('')
    } catch (caught) {
      if (created) setPageNotice(`Solicitação cadastrada, mas não foi possível salvar o anexo ou atualizar a lista: ${caught.message}`)
      else setError(caught.message)
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

  async function rejectOffer(offer) {
    await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/reject`, jsonOptions('POST', {}))
    await onRefresh()
  }

  async function declineProposal(offer, decline) {
    await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/decline`, jsonOptions('POST', decline))
    await onRefresh()
  }

  return (
    <div className="dashboard-shell offers-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="offers-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="offers-header"><div><h1>Ofertas de serviços</h1><p>Solicitações cadastradas para análise e retorno comercial.</p></div></div>
        {pageNotice && <p className="workflow-error offers-page-notice" role="alert">{pageNotice}<button type="button" className="offers-page-notice-close" aria-label="Fechar aviso" onClick={() => setPageNotice('')}>×</button></p>}
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
              <span data-label="Cliente">{offer.company}</span><span data-label="Etiqueta">{offer.labelNumber || "—"}</span><span data-label="Quantidade">{offer.quantity} un</span><span data-label="Solicitação">{displayDate(offer.requestedAt)}</span><span data-label="Prazo">{displayDate(offer.deadline)}</span>
              <div className="offer-status-cell"><div className={`offer-table-status offer-table-status--${savedProposal(offer) ? 'saved' : offer.status}`}><strong>{savedProposal(offer) ? 'Proposta salva' : offer.status === 'review' ? 'Em análise' : offer.status === 'proposed' ? 'Proposta gerada' : offer.status === 'rejected' ? offer.proposalDecline ? `Proposta ${offer.proposalDecline.key} recusada` : 'Recusada' : 'Aceita'}</strong>{savedProposal(offer) && <span>Opção {offer.proposalDraft.selectedKey}</span>}{offer.orderCode && <span>{offer.orderCode}</span>}{offer.proposalDecline?.reason && <span>{offer.proposalDecline.reason}</span>}</div>{offer.status === 'proposed' && offer.proposal?.generatedAt && <ProposalSentSince at={offer.proposalEmails?.[0]?.sentAt || offer.proposal.generatedAt} />}</div>
              <span data-label="Origem">{offer.origin}</span>
              <div className="offer-table-actions">
                {offer.status === 'rejected' ? offer.proposalDecline ? <button className="offer-review-button" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setUndoingOffer(offer) }}>Desfazer recusa</button> : <span>Recusada</span> : offer.status === 'accepted'
                  ? <><button className="offer-review-button" type="button" onClick={() => onSelectOrder(offer.orderCode)}>Ver OS</button><button className="offer-reject-button" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setUnacceptingOffer(offer) }}>Desfazer aceite</button></>
                  : <>{savedProposal(offer) ? <button className="offer-review-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent('gmac-proposal-open', { detail: offer.id }))}>Proposta salva</button> : <button className="offer-review-button" type="button" onClick={() => onSelectOffer(offer.id)}>{offer.status === 'review' ? 'Em análise' : 'Ver proposta'}</button>}{offer.status === 'review' && offer.origin === 'Inserida Manualmente' && !offer.orderCode && <button className="offer-reject-button" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setRejectingOffer(offer) }}><X size={15} aria-hidden="true" />Recusar</button>}{offer.proposal && <button className="offer-accept-button" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setAcceptingOffer(offer) }}>✓ Aceitar Oferta</button>}{offer.proposal && !offer.orderCode && <button className="offer-reject-button" type="button" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setDecliningOffer(offer) }}><X size={15} aria-hidden="true" />Cliente recusou</button>}</>}
              </div>
            </div>)}
          </div>{filteredOffers.length === 0 && <div className="offers-empty">Nenhuma oferta cadastrada para os filtros informados.</div>}</div>
        </section>
      </main>
      {rejectingOffer && <RejectOfferModal offer={rejectingOffer} onConfirm={rejectOffer} onClose={() => setRejectingOffer(null)} />}
      {decliningOffer && <DeclineProposalModal offer={decliningOffer} onConfirm={(decline) => declineProposal(decliningOffer, decline)} onClose={() => setDecliningOffer(null)} />}
      {acceptingOffer && <AcceptOfferModal offer={acceptingOffer} onConfirm={async () => { await apiRequest(`/api/offers/${acceptingOffer.id}/accept`, { method: 'POST' }); await onRefresh() }} onClose={() => setAcceptingOffer(null)} />}
      {unacceptingOffer && <UndoAcceptModal offer={unacceptingOffer} orderCode={unacceptingOffer.orderCode} onConfirm={async () => { await apiRequest(`/api/offers/${encodeURIComponent(unacceptingOffer.id)}/unaccept`, jsonOptions('POST', {})); await onRefresh() }} onClose={() => setUnacceptingOffer(null)} />}
      {undoingOffer && <UndoDeclineModal offer={undoingOffer} onConfirm={async () => { await apiRequest(`/api/offers/${encodeURIComponent(undoingOffer.id)}/undecline`, jsonOptions('POST', {})); await onRefresh() }} onClose={() => setUndoingOffer(null)} />}
      {manualOpen && <div className="modal-backdrop offer-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setManualOpen(false) }}>
        <section className="offer-manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-offer-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="offer-modal-header"><div><span className="offers-kicker">Nova solicitação</span><h2 id="manual-offer-title">Inserir oferta manualmente</h2><p>Preencha os dados da solicitação de serviço.</p></div><button className="offer-modal-close" type="button" onClick={() => setManualOpen(false)} aria-label="Fechar formulário">×</button></div>
          <form onSubmit={addOffer}><div className="offer-form-grid">
            <label>CNPJ/CPF *<input value={manualForm.cnpj} onChange={(event) => changeManualDocument(event.target.value)} inputMode="numeric" placeholder="CNPJ ou CPF do cliente" required /></label>
            <label>Empresa *<ClientNameInput label="Empresa *" value={manualForm.company} documentValue={manualForm.cnpj} clients={clients} onChange={(value) => updateManualForm('company', value)} onSelect={(client) => setManualForm((current) => ({ ...current, company: client.name, cnpj: maskClientDocument(client.document) }))} required /></label>
            <label>Solicitante<RequesterNameInput label="Solicitante" value={manualForm.requester} client={manualClient} requesters={requesters} onChange={(value) => updateManualForm('requester', value)} /></label>
            <label>Comprador<RequesterNameInput label="Comprador" kind={contactKinds.buyers} who="quem compra o serviço" value={manualForm.buyer} client={manualClient} requesters={buyers} onChange={(value) => updateManualForm('buyer', value)} /></label>
            <label>Peça/Serviço *<PieceNameInput label="Peça/Serviço *" value={manualForm.service} onChange={(value) => updateManualForm('service', value)} pieces={pieces} required /></label>
            <label>Prazo solicitado *<input type="date" value={manualForm.deadline} onChange={(event) => updateManualForm('deadline', event.target.value)} required /></label>
            <label>Quantidade *<input type="number" min="1" step="1" value={manualForm.quantity} onChange={(event) => updateManualForm('quantity', event.target.value)} required /></label>
            <label>Número da etiqueta<input value={manualForm.labelNumber} onChange={(event) => updateManualForm('labelNumber', event.target.value)} placeholder="Opcional" /></label>
            <label className="offer-form-field--full">Descrição do serviço *<textarea value={manualForm.description} onChange={(event) => updateManualForm('description', event.target.value)} rows="4" required /></label>
            <label className="offer-form-field--full offer-attachment-field">Anexo<span className="offer-file-picker"><input type="file" onChange={(event) => updateManualForm('attachment', event.target.files?.[0] || null)} /><span>Escolher arquivo</span><strong>{manualForm.attachment?.name || 'Nenhum arquivo selecionado'}</strong></span></label>
          </div>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="offer-modal-actions"><button className="offer-modal-cancel" type="button" onClick={() => setManualOpen(false)}>Cancelar</button><button className="manual-offer-button" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Adicionar solicitação'}</button></div></form>
        </section>
      </div>}
      {requesterNotice && <p className="app-toast" role="status"><CircleCheck size={16} aria-hidden="true" />{requesterNotice}</p>}
    </div>
  )
}
// How long this piece took the other times, from the OS to its completion (average and last time). New pieces show nothing.
const daysText = (days) => days < 1 ? `${Math.max(1, Math.round(days * 24))} ${Math.round(days * 24) <= 1 ? 'hora' : 'horas'}` : `${String(Math.round(days * 10) / 10).replace('.', ',')} ${Math.round(days * 10) / 10 === 1 ? 'dia' : 'dias'}`
function PieceLeadTime({ offer }) {
  const [item, setItem] = useState(null)
  useEffect(() => {
    let active = true
    setItem(null)
    const query = new URLSearchParams({ name: offer.service, offerId: offer.id })
    apiRequest(`/api/pieces/lead-time?${query}`).then((data) => { if (active) setItem(data.item) }).catch(() => {})
    return () => { active = false }
  }, [offer.id, offer.service])
  if (!item) return null
  return <div className="offer-lead-time"><Clock3 size={18} aria-hidden="true" /><div><small>Tempo para ficar pronta</small><strong>Em média {daysText(item.averageDays)}</strong><span>{item.count === 1 ? `Feita 1 vez · ${item.lastCode}` : `Média de ${item.count} vezes · última: ${daysText(item.lastDays)} (${item.lastCode})`}</span></div></div>
}

// Process settings of the offer and its service description, the same text typed when the offer was created.
const offerDetails = (resources, description) => ({ ...serviceDetails(resources), description: serviceDescriptionText(description, resources?.serviceDescription) })

function OfferDetailsV2({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offer, onRefresh, onSelectOrder }) {
  const [laborServices, setLaborServices] = useState([])
  const [inventory, setInventory] = useState([])
  const [machines, setMachines] = useState([])
  const [materials, setMaterials] = useState(offer?.resources?.materials || [])
  const [stages, setStages] = useState(offer?.resources?.stages ?? offer?.proposal?.stages ?? [])
  const [stageLayout, setStageLayout] = useState(() => readStageLayout({ ...offer?.resources, stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [] }))
  const [kind, setKind] = useState(offer?.resources?.kind ?? offer?.proposal?.kind ?? 'service')
  const [details, setDetails] = useState(() => offerDetails(offer?.resources, offer?.description))
  const [stageTimes, setStageTimes] = useState(offer?.resources?.stageTimes || {})
  const [stageResources, setStageResources] = useState(offer?.resources?.stageResources || {})
  const [pieceHistory, setPieceHistory] = useState(null)
  const [materialFormOpen, setMaterialFormOpen] = useState(false)
  const [materialForm, setMaterialForm] = useState({ name: '', detail: '', unit: 'kg', quantity: '', unitPrice: '' })
  // The row being edited in the material form (null: the form adds a new row).
  const [editingMaterialId, setEditingMaterialId] = useState(null)
  const [laborEntries, setLaborEntries] = useState(offer?.resources?.laborEntries || [])
  const [materialSuggestionsOpen, setMaterialSuggestionsOpen] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [saving, setSaving] = useState(false)
  const resourceDraft = useRef({ materials, laborEntries, stages, stageLayout, kind, ...details, stageTimes, stageResources })
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
    setDetails(offerDetails(offer?.resources, offer?.description))
    setStageTimes(offer?.resources?.stageTimes || {})
    setStageResources(offer?.resources?.stageResources || {})
    resourceDraft.current = {
      materials: offer?.resources?.materials || [],
      laborEntries: offer?.resources?.laborEntries || [],
      stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [],
      stageLayout: readStageLayout({ ...offer?.resources, stages: offer?.resources?.stages ?? offer?.proposal?.stages ?? [] }),
      kind: offer?.resources?.kind ?? offer?.proposal?.kind ?? 'service',
      ...offerDetails(offer?.resources, offer?.description),
      stageTimes: offer?.resources?.stageTimes || {},
      stageResources: offer?.resources?.stageResources || {},
    }
    persistedResources.current = resourceDraft.current
    // A row being edited belongs to the offer that was open.
    setEditingMaterialId(null)
    setMaterialFormOpen(false)
  }, [offer?.id])

  // An offer that arrives empty (for example, from the website) of a piece made before can be filled with its history.
  const emptyResources = !offer?.orderCode && !(offer?.resources?.materials?.length) && !(offer?.resources?.stages?.length)
  useEffect(() => {
    setPieceHistory(null)
    if (!offer || !emptyResources) return undefined
    let active = true
    const query = new URLSearchParams({ name: offer.service, quantity: String(offer.quantity), offerId: offer.id })
    apiRequest(`/api/pieces/suggestion?${query}`).then(({ item }) => { if (active) setPieceHistory(item) }).catch(() => {})
    return () => { active = false }
  }, [offer?.id, emptyResources])

  useEffect(() => {
    let active = true
    // Cache no navegador para os menus de máquina/serviço da oferta abrirem na hora; a rede confirma em seguida.
    cachedResource('/machines', (data) => { if (active) setMachines(data.items) }).catch(() => {})
    cachedResource('/labor-services', (data) => { if (active) setLaborServices(data.items) }).catch(() => {})
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
  const checkedMaterials = materialsStock(materials, inventory)
  const laborTotal = laborEntries.reduce((total, entry) => total + entry.hours * entry.hourlyRate, 0)
  // Sector of the machine or service as registered today; entries keep only its id.
  const laborSector = (entry) => (entry.type === 'machine' ? machines.find((item) => String(item.id) === String(entry.machineId)) : laborServices.find((item) => String(item.id) === String(entry.laborServiceId)))?.sector || '—'

  async function saveResources(changes = {}) {
    if (!offer || offer.orderCode) return false
    const offerId = offer.id
    const draft = { ...resourceDraft.current, ...changes }
    draft.materials = materialsStock(draft.materials, inventory)
    resourceDraft.current = draft
    pendingSaves.current += 1
    setSaving(true)
    setAttachmentError('')
    // Serialize snapshots so rapid stage/type changes cannot overwrite newer choices.
    const task = saveQueue.current.then(async () => {
      try {
        const { item } = await apiRequest(`/api/offers/${offerId}/resources`, jsonOptions('PUT', draft))
        const saved = { ...item.resources, description: item.description }
        if (activeOfferId.current === offerId) persistedResources.current = saved
        if (activeOfferId.current === offerId && resourceDraft.current === draft) {
          setAttachmentError('')
          resourceDraft.current = saved
          setMaterials(item.resources.materials)
          setLaborEntries(item.resources.laborEntries)
          setStages(item.resources.stages)
          setStageLayout(readStageLayout(item.resources))
          setKind(item.resources.kind)
          setDetails(offerDetails(item.resources, item.description))
          setStageTimes(item.resources.stageTimes || {})
          setStageResources(item.resources.stageResources || {})
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
          setDetails(offerDetails(persistedResources.current, persistedResources.current.description))
          setStageTimes(persistedResources.current.stageTimes || {})
          setStageResources(persistedResources.current.stageResources || {})
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
      unit: inventoryItem ? materialUnit(inventoryItem.unit) : current.inventoryId != null ? 'kg' : current.unit,
      detail: inventoryItem ? inventoryItem.detail || '' : current.inventoryId != null ? '' : current.detail,
      unitPrice: inventoryItem ? String(inventoryItem.unitPrice || 0) : current.inventoryId != null ? '' : current.unitPrice,
    }))
  }

  async function addMaterial(event) {
    event.preventDefault()
    const quantity = toNumber(materialForm.quantity)
    const unitPrice = toNumber(materialForm.unitPrice)
    if (!materialForm.name.trim() || quantity <= 0) return
    const unit = materialUnit(materialForm.unit)
    if (wholeUnit(unit) && !Number.isInteger(quantity)) return setAttachmentError('Material contado por unidade aceita só quantidades inteiras.')
    const changes = { ...materialForm, unit, name: materialForm.name.trim(), quantity, unitPrice }
    const next = editingMaterialId != null ? materials.map((material) => material.id === editingMaterialId ? { ...material, ...changes } : material) : [...materials, { ...changes, id: newId(), icon: '▰', requestedAt: new Date().toISOString() }]
    if (!await saveResources({ materials: next })) return
    closeMaterialForm()
  }

  function closeMaterialForm() {
    setMaterialForm({ name: '', detail: '', unit: 'kg', quantity: '', unitPrice: '' })
    setEditingMaterialId(null)
    setMaterialFormOpen(false)
  }

  // Opens the material form with the row filled in; saving replaces the row instead of adding another one.
  function editMaterial(material) {
    setMaterialForm({ name: material.name, detail: material.detail || '', unit: materialUnit(material.unit), quantity: String(material.quantity), unitPrice: String(material.unitPrice ?? ''), inventoryId: material.inventoryId ?? null })
    setEditingMaterialId(material.id)
    setMaterialFormOpen(true)
    window.requestAnimationFrame(() => document.querySelector('.offer-inline-form:not(.offer-labor-form)')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  function removeMaterial(id) {
    if (id === editingMaterialId) closeMaterialForm()
    saveResources({ materials: materials.filter((material) => material.id !== id) })
  }

  // A checked stage comes with its default machine or service (Etapas); the planner can still change it.
  function toggleStage(stage) {
    const currentStages = resourceDraft.current.stages
    const adding = !currentStages.includes(stage)
    const selected = adding ? [...currentStages, stage] : currentStages.filter((key) => key !== stage)
    const nextStages = orderedStageSelection(resourceDraft.current.stageLayout, selected)
    setStages(nextStages)
    const preset = adding && !resourceDraft.current.stageResources?.[stage] && defaultStageResource(stage, { machines, laborServices })
    if (!preset) return saveResources({ stages: nextStages })
    const nextResources = { ...resourceDraft.current.stageResources, [stage]: preset }
    setStageResources(nextResources)
    saveResources({ stages: nextStages, stageResources: nextResources })
  }

  // Planned time of a stage for the whole OS, in minutes; empty removes the target.
  function changeStageTime(code, minutes) {
    const next = { ...resourceDraft.current.stageTimes }
    if (minutes) next[code] = minutes
    else delete next[code]
    setStageTimes(next)
    saveResources({ stageTimes: next })
  }

  // Machine or labor service planned for a stage; empty removes it.
  function changeStageResource(code, choice) {
    const next = { ...resourceDraft.current.stageResources }
    if (choice) next[code] = choice
    else delete next[code]
    setStageResources(next)
    saveResources({ stageResources: next })
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

  // Labor comes from the stages (time and machine or service of each one); only an older hand-typed row can be removed.
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
    // Each stage goes to the tablet with its time and its machine or service: both are filled before the proposal.
    const problem = stagePlanProblem(stages, resourceDraft.current)
    if (problem) {
      setAttachmentError(`${problem} Preencha ao lado de cada etapa, em Etapas do serviço.`)
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
        <div className="offer-details-header"><button className="offer-back-button" type="button" onClick={() => onNavigate('Ofertas e serviços')} aria-label="Voltar para ofertas"><ArrowLeft size={24} aria-hidden="true" /></button><h1>Detalhes da oferta {offer.code}</h1></div>
        <div className="offer-details-grid">
          <section className="offer-information-card"><span className="offer-details-section-title">Informações do serviço</span><h2>{offer.service}</h2><p className="offer-details-description">{offer.description}</p><div className="offer-detail-facts"><div><span>▥</span><small>Cliente solicitante</small><strong>{offer.company}</strong><em>{documentKind(offer.cnpj)}: {offer.cnpj}</em>{offer.requester && <em>Solicitante: {offer.requester}</em>}{offer.buyer && <em>Comprador: {offer.buyer}</em>}</div><div><span>▣</span><small>Data da solicitação</small><strong>{displayDate(offer.requestedAt)}</strong></div><div><span>◇</span><small>Quantidade solicitada</small><strong>{offer.quantity} unidades</strong></div><div><span>◷</span><small>Prazo solicitado pelo cliente</small><strong>{displayDate(offer.deadline)}</strong></div></div><PieceLeadTime offer={offer} /><div className="offer-detail-text"><h3>Número da etiqueta</h3><p>{offer.labelNumber || 'Não informado'}</p></div><div className="offer-detail-text"><h3>Anexos da solicitação</h3>{offer.attachments?.length ? <ul>{offer.attachments.map((attachment) => <li key={attachment.id}><DownloadLink url={attachmentUrl(offer.id, attachment.id)} name={attachment.name}>{attachment.name}</DownloadLink></li>)}</ul> : <p>Nenhum anexo adicionado.</p>}</div>{offer.proposal && <div className="offer-detail-text"><h3>Proposta gerada</h3><p><DownloadLink url={`/api/offers/${offer.id}/proposal.pdf`} name={`proposta-${offer.code}.pdf`}>Baixar PDF da proposta</DownloadLink></p></div>}{(offer.proposal || offer.proposalEmails?.length > 0) && <ProposalEmailHistory offer={offer} />}</section>
          <section className="offer-materials-card offer-resources-card">
            <fieldset className="offer-resource-fields" disabled={Boolean(offer.orderCode)}>
            <div className="offer-resource-heading"><div><span className="offer-details-section-title">Materiais necessários</span><p>Adicione os materiais e informe a quantidade, em quilos (kg), em metros (m) ou em unidades (un).</p></div><button className="offer-add-resource-button" type="button" onClick={() => { if (editingMaterialId == null && materialFormOpen) return closeMaterialForm(); closeMaterialForm(); setMaterialFormOpen(true) }}><Icon name="plus" />Adicionar material</button></div>
            {materialFormOpen && <form className="offer-inline-form" onSubmit={addMaterial} aria-label={editingMaterialId != null ? 'Editar material' : 'Adicionar material'}>
              <label>Material *<div className="material-autocomplete"><div className="material-autocomplete-input">
                <input value={materialForm.name} autoComplete="off" role="combobox" aria-expanded={materialSuggestionsOpen} aria-controls="offer-material-suggestions" onFocus={() => setMaterialSuggestionsOpen(true)} onBlur={(event) => { if (!event.currentTarget.closest('.material-autocomplete')?.contains(event.relatedTarget)) setMaterialSuggestionsOpen(false) }} onChange={(event) => { selectInventoryMaterial(event.target.value); setMaterialSuggestionsOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setMaterialSuggestionsOpen(false); if (event.key === 'ArrowDown' && matchingInventory.length) { event.preventDefault(); document.getElementById('offer-material-suggestions')?.querySelector('button')?.focus() } }} placeholder="Digite para buscar no estoque" required /><span>⌄</span>
              </div>{materialSuggestionsOpen && <div className="material-suggestions" id="offer-material-suggestions" role="listbox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMaterialSuggestionsOpen(false) }}>
                {matchingInventory.length > 0 ? matchingInventory.map((item) => <button type="button" role="option" aria-selected={materialForm.inventoryId === item.id} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { selectInventoryMaterial(item.name, item); setMaterialSuggestionsOpen(false) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...event.currentTarget.parentElement.querySelectorAll('button')]; const next = buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1); buttons[(next + buttons.length) % buttons.length]?.focus() } if (event.key === 'Escape') setMaterialSuggestionsOpen(false) }}><strong>{item.name}</strong><small>{item.detail} · {formatQuantity(item.quantity, item.unit)} · {formatMoney(item.unitPrice)}/{materialUnit(item.unit)}</small></button>) : <div className="material-suggestion-empty"><strong>Novo material</strong><span>{materialForm.name.trim() || 'Material não cadastrado'}</span></div>}
              </div>}</div></label>
              <label>Especificação<input value={materialForm.detail} onChange={(event) => updateMaterial('detail', event.target.value)} placeholder="Ex.: Chapa 10 mm" /></label>
              <label>Unidade<select value={materialUnit(materialForm.unit)} disabled={materialForm.inventoryId != null} title={materialForm.inventoryId != null ? 'A unidade vem do cadastro do estoque' : undefined} onChange={(event) => updateMaterial('unit', event.target.value)}>{materialUnits.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>{`Quantidade (${materialUnit(materialForm.unit)}) *`}<input type="number" min={quantityStep(materialForm.unit)} step={quantityStep(materialForm.unit)} value={materialForm.quantity} onChange={(event) => updateMaterial('quantity', event.target.value)} placeholder={wholeUnit(materialForm.unit) ? '0' : '0,00'} required /></label>
              <label>{materialUnit(materialForm.unit) === 'kg' ? 'Valor unitário' : unitPriceLabel(materialForm.unit)}<input type="number" min="0" step="0.01" value={materialForm.unitPrice} onChange={(event) => updateMaterial('unitPrice', event.target.value)} placeholder="0,00" /></label>
              <div className="offer-inline-actions"><button className="offer-modal-cancel" type="button" onClick={closeMaterialForm}>Cancelar</button><button className="offer-add-resource-button" type="submit" disabled={saving}>{editingMaterialId != null ? 'Salvar alterações' : 'Adicionar material'}</button></div>
            </form>}
            {materials.length > 0 ? <><div className="offer-materials-head"><span>Material</span><span>Especificação</span><span>Qtd. necessária</span><span>Estoque</span><span>Valor unitário</span><span>Valor total</span><span>Ações</span></div><div className="offer-materials-list">{checkedMaterials.map((material) => <div className={`offer-material-row offer-material-row--managed${material.id === editingMaterialId ? ' offer-material-row--editing' : ''}`} key={material.id}><div className="material-visual">{material.icon}</div><div className="material-name"><strong>{material.name}</strong><span>{material.detail || '—'}</span></div><span>{formatQuantity(material.quantity, material.unit)}</span><span className={`material-stock-status material-stock-status--${material.groupStockStatus}`}>{material.groupStockStatus === 'unknown' ? 'Não verificado' : material.groupPurchaseQuantity > 0 ? `Falta: ${formatQuantity(material.groupPurchaseQuantity, material.unit)}` : material.stockStatus === 'available' ? `Disponível: ${formatQuantity(material.stockAvailable, material.unit)}` : material.stockStatus === 'partial' ? `Parcial: ${formatQuantity(material.stockAvailable, material.unit)}` : material.stockStatus === 'unknown' ? 'Não verificado' : 'Sem estoque'}</span><span>{formatMoney(material.unitPrice)}</span><strong>{formatMoney(material.quantity * material.unitPrice)}</strong><div className="offer-resource-actions"><button className="offer-resource-edit" type="button" disabled={saving} onClick={() => editMaterial(material)} aria-label={`Editar ${material.name}`} title="Editar"><Pencil size={14} aria-hidden="true" /></button><button className="offer-resource-remove" type="button" disabled={saving} onClick={() => removeMaterial(material.id)} aria-label={`Remover ${material.name}`} title="Remover">×</button></div></div>)}</div></> : <button className="offer-empty-state" type="button" onClick={() => setMaterialFormOpen(true)}><Icon name="plus" /><strong>Nenhum material adicionado</strong><span>Clique aqui ou no botão acima para buscar materiais cadastrados no estoque.</span></button>}
            <div className="offer-resource-subsection"><div className="offer-resource-heading"><div><span className="offer-details-section-title">Mão de obra</span><p>Vem das etapas do serviço: o tempo e a máquina ou o serviço de cada etapa, ao valor da hora do cadastro.</p></div></div>
              {laborEntries.length > 0 ? <><div className="offer-materials-head"><span>Tipo</span><span>Máquina / serviço</span><span>Tempo (h)</span><span>Setor</span><span>Valor/hora</span><span>Valor total</span><span>Ações</span></div><div className="offer-materials-list offer-labor-list">{laborEntries.map((entry) => <div className="offer-material-row offer-material-row--managed offer-material-row--labor" key={entry.id}><div className="material-visual"><Icon name={entry.type === 'machine' ? 'machines' : 'employees'} /></div><div className="material-name"><strong>{entry.resource}</strong><span>{entry.type === 'machine' ? 'Hora máquina' : 'Hora homem'} · {entry.stageCode ? stageLabel(entry.stageCode) : 'Lançada à mão antes das etapas'}</span></div><span>{Number(entry.hours).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h</span><span>{laborSector(entry)}</span><span>{formatMoney(entry.hourlyRate)}</span><strong>{formatMoney(entry.hours * entry.hourlyRate)}</strong><div className="offer-resource-actions">{!entry.stageCode && <button className="offer-resource-remove" type="button" disabled={saving} onClick={() => removeLabor(entry.id)} aria-label={`Remover ${entry.resource}`} title="Remover: a mão de obra agora vem das etapas">×</button>}</div></div>)}</div></> : <div className="offer-empty-state offer-empty-state--static"><strong>Nenhuma mão de obra ainda</strong><span>Informe o tempo e a máquina ou o serviço de cada etapa, em Etapas do serviço, e as horas aparecem aqui.</span></div>}
            </div>
            <div className="offer-resource-subsection offer-process-settings">
              {pieceHistory && emptyResources && <div className="piece-history-banner" role="status"><div><strong>Esta peça já foi feita antes.</strong><span>Dá para preencher os materiais, as etapas e os tempos com base no histórico{pieceHistory.samples ? ` (média de ${pieceHistory.samples} ${pieceHistory.samples === 1 ? 'registro' : 'registros'})` : ` (última vez: ${pieceHistory.source || 'oferta anterior'})`}.</span></div><button type="button" className="offer-add-resource-button" disabled={saving} onClick={async () => { if (await saveResources(pieceHistory.resources)) setPieceHistory(null) }}>Preencher com o histórico</button></div>}
              <ServiceStageEditor layout={stageLayout} stages={stages} onLayoutChange={reorderStageLayout} onToggle={toggleStage} disabled={Boolean(offer.orderCode)} stageTimes={stageTimes} onStageTime={changeStageTime} stageResources={stageResources} resourceOptions={{ machines, laborServices }} onStageResource={changeStageResource} />
              <fieldset><legend>Tipo</legend><div className="offer-kind-options"><label><input type="radio" name="offer-kind" checked={kind === 'service'} onChange={() => selectKind('service')} />Serviço</label><label><input type="radio" name="offer-kind" checked={kind === 'product'} onChange={() => selectKind('product')} />Produto</label></div></fieldset>
              <fieldset><legend>Fabricado a partir de</legend><div className="offer-kind-options">{[['sample', 'Amostra'], ['drawing', 'Desenho']].map(([key, label]) => <label key={key}><input type="radio" name="manufactured-from" checked={details.manufacturedFrom === key} onChange={() => updateDetails('manufacturedFrom', key)} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Têmpera</legend><div className="offer-kind-options">{[[true, 'Sim'], [false, 'Não']].map(([key, label]) => <label key={label}><input type="radio" name="tempering" checked={details.tempering === key} onChange={() => updateDetails('tempering', key)} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Tipo de proposta</legend><div className="offer-kind-options">{[['normal', 'Normal'], ['emergency', 'Emergencial']].map(([key, label]) => <label key={key}><input type="radio" name="offer-urgency" checked={details.urgency === key} onChange={() => updateDetails('urgency', key)} />{label}</label>)}</div></fieldset>
              <fieldset><legend>Tipo de serviço</legend><div className="offer-kind-options">{[['internal', 'Interno'], ['external', 'Externo']].map(([key, label]) => <label key={key}><input type="radio" name="offer-service-location" checked={details.serviceLocation === key} onChange={() => updateDetails('serviceLocation', key)} />{label}</label>)}</div></fieldset>
              {stages.includes('painting') && <label className="offer-service-field">Cor/Tipo<input value={details.paintColor} maxLength={160} onChange={(event) => updateDetails('paintColor', event.target.value, false)} onBlur={() => saveResources()} /></label>}
              <label className="offer-service-field">Descrição do serviço<textarea aria-label="Descrição do serviço" value={details.description} maxLength={5000} rows={4} required onChange={(event) => updateDetails('description', event.target.value, false)} onBlur={() => saveResources()} /></label>
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
  // The screen reopens as it was saved; a proposal generated after that save wins for its own option and the choice.
  const draft = offer?.proposalDraft
  const generatedLater = Boolean(offer?.proposal) && (!draft || String(offer.proposal.generatedAt || '') >= draft.savedAt)
  const [selectedKey, setSelectedKey] = useState((generatedLater ? offer.proposal.key : draft?.selectedKey) || 'A')
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [editingCell, setEditingCell] = useState(null)
  const [generated, setGenerated] = useState(Boolean(offer?.proposal))
  // "Enviar E-mail" is there from the start, but only works once the proposal PDF is generated.
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailNotice, setEmailNotice] = useState('')
  useEffect(() => {
    if (!emailNotice) return
    const timer = setTimeout(() => setEmailNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [emailNotice])
  async function proposalEmailSent({ email, registered = [], warnings = [] }) {
    setEmailOpen(false)
    setEmailNotice([`E-mail enviado para ${[...email.to, ...email.cc].join(', ')}`, ...registered.map((item) => `${item.email} cadastrado para o ${item.kind === 'client' ? 'cliente' : 'comprador'} ${item.name}`), ...warnings].join(' · '))
    try { await onRefresh() } catch { /* O erro de carregamento aparece na tela. */ }
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The message sits above the proposals, under the summary: it is brought into view, as the actions are further down.
  const errorRef = useRef(null)
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [error])
  const resourceData = offer?.resources || { materials: [], laborEntries: [] }
  const formatMoney = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  // Materials, labor and hours come from the offer and cannot be edited here; only the delivery term, the gross profit
  // percentage and the discount are chosen in each option. The OS value is what the customer pays.
  const costs = proposalCosts(resourceData)
  const materialCost = costs.materials
  const defaultProposal = { deadline: offer?.deadline || '', margin: 0, discount: 0, kind: resourceData.kind ?? offer?.proposal?.kind ?? 'service', stages: resourceData.stages ?? offer?.proposal?.stages ?? [] }
  const [proposals, setProposals] = useState(() => [
    { ...defaultProposal, key: 'A', margin: 15, tone: 'green', icon: '♢', title: 'Opção A', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'B', margin: 20, tone: 'blue', icon: '◎', title: 'Opção B', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'C', margin: 25, tone: 'purple', icon: '✧', title: 'Opção C', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
    { ...defaultProposal, key: 'D', margin: 30, tone: 'red', icon: 'ϟ', title: 'Opção D', tag: 'Personalizável', description: 'Defina os valores e o prazo desta opção.' },
  ].map((proposal) => {
    const saved = draft?.options?.find((option) => option.key === proposal.key)
    const restored = saved ? { ...proposal, margin: saved.margin, discount: saved.discount, deadline: saved.deadline } : proposal
    return generatedLater && offer.proposal.key === proposal.key ? { ...restored, ...offer.proposal, kind: defaultProposal.kind, stages: defaultProposal.stages } : restored
  }))
  // Each option starts from the average of the proposals accepted with it; an option already saved in the offer keeps its
  // value and the others give way so the order A < B < C < D, with the minimum gap, holds. Saved options keep their values.
  const [marginStats, setMarginStats] = useState(null)
  const [declining, setDeclining] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [unaccepting, setUnaccepting] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  // A proposal generated after the last save already differs from what was saved.
  const [unsaved, setUnsaved] = useState(Boolean(draft) && generatedLater)
  useEffect(() => {
    let active = true
    apiRequest('/api/proposal-margins').then(({ items }) => {
      if (!active) return
      setMarginStats(items)
      if (draft) return
      setProposals((current) => {
        const fixed = current.findIndex((proposal) => proposal.key === offer?.proposal?.key)
        const margins = current.map((proposal, index) => index === fixed ? Number(proposal.margin) : items.find((item) => item.key === proposal.key)?.margin ?? Number(proposal.margin))
        for (let index = fixed + 1; index < margins.length; index++) if (index > 0) margins[index] = Math.max(margins[index], margins[index - 1] + PROPOSAL_MARGIN_GAP)
        for (let index = fixed - 1; index >= 0; index--) margins[index] = Math.max(0, Math.min(margins[index], margins[index + 1] - PROPOSAL_MARGIN_GAP))
        return current.map((proposal, index) => ({ ...proposal, margin: Math.round(margins[index] * 10) / 10 }))
      })
    }).catch(() => {})
    return () => { active = false }
  }, [offer?.id])
  const visibleProposals = proposals.map((proposal) => ({ ...proposal, materials: costs.materials, labor: costs.labor, machine: hoursText(costs.machineHours), serviceTime: hoursText(costs.serviceHours), totalTime: hoursText(costs.totalHours), ...proposalPricing({ materials: costs.materials, labor: costs.labor, margin: proposal.margin, discount: proposal.discount }) }))
  const selectedProposal = visibleProposals.find((proposal) => proposal.key === selectedKey) || visibleProposals[0]
  function updateProposal(key, field, value) {
    setGenerated(false)
    setUnsaved(true)
    setProposals((current) => current.map((proposal) => proposal.key === key ? { ...proposal, [field]: value } : proposal))
  }

  function saveEditedValue(key, field, value) {
    const limits = { margin: 1000, discount: 100 }
    const nextValue = field in limits ? Math.min(limits[field], Math.max(0, Number(String(value).replace(',', '.')) || 0)) : value
    if (field === 'margin') {
      // The options never cross: each stays at least PROPOSAL_MARGIN_GAP points away from its neighbours.
      const index = proposals.findIndex((proposal) => proposal.key === key)
      const { min, max } = marginLimits(proposals.map((proposal) => proposal.margin), index)
      if (nextValue < min || nextValue > max) {
        updateProposal(key, field, editingCell?.initial ?? proposals[index].margin)
        setEditingCell(null)
        const previous = proposals[index - 1], next = proposals[index + 1]
        setError(`A opção ${key} precisa ficar ${[previous && `pelo menos ${PROPOSAL_MARGIN_GAP} pontos acima da ${previous.key} (${String(previous.margin).replace('.', ',')}%)`, next && `pelo menos ${PROPOSAL_MARGIN_GAP} pontos abaixo da ${next.key} (${String(next.margin).replace('.', ',')}%)`].filter(Boolean).join(' e ')}: use de ${String(min).replace('.', ',')}% a ${String(max).replace('.', ',')}%.`)
        return
      }
      setError('')
    }
    updateProposal(key, field, nextValue)
    setEditingCell(null)
  }

  function renderEditable(proposal, field, displayValue, inputType = 'text') {
    const isEditing = editingCell?.key === proposal.key && editingCell.field === field
    if (isEditing) return <input className="proposal-inline-edit" type={inputType} value={proposal[field]} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => updateProposal(proposal.key, field, event.target.value)} onBlur={(event) => saveEditedValue(proposal.key, field, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveEditedValue(proposal.key, field, event.currentTarget.value); if (event.key === 'Escape') setEditingCell(null) }} />
    return <><strong>{displayValue}</strong><button className="proposal-edit-button" type="button" onClick={(event) => { event.stopPropagation(); setEditingCell({ key: proposal.key, field, initial: proposal[field] }) }} aria-label={`Editar ${field}`}><Icon name="edit" /></button></>
  }

  // Keeps the four options and the chosen one, so the quote can be finished later or by someone else.
  async function saveDraft() {
    setDraftSaving(true); setError('')
    try {
      await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/proposal-draft`, jsonOptions('PUT', { selectedKey, options: proposals.map(({ key, margin, discount, deadline }) => ({ key, margin: Number(margin), discount: Number(discount), deadline: String(deadline ?? '') })) }))
      setUnsaved(false)
      await onRefresh().catch(() => {})
    } catch (caught) { setError(caught.message) }
    finally { setDraftSaving(false) }
  }

  // The commercial models (A, B, Nestlé and Etiqueta) are chosen and filled in the next window.
  function openModels() {
    if (!offer) return
    if (!selectedProposal.stages.length) {
      setError('Defina as etapas nos detalhes da oferta antes de gerar a proposta.')
      return
    }
    const problem = stagePlanProblem(selectedProposal.stages, offer.resources)
    if (problem) {
      setError(`${problem} ${stagePlanPlace}`)
      return
    }
    setError('')
    setLayoutOpen(true)
  }

  async function proposalSaved() {
    await onRefresh()
    setGenerated(true)
    setLayoutOpen(false)
    // The PDF needs the session, so it is fetched and saved instead of opened by a plain link.
    downloadFile(`/api/offers/${offer.id}/proposal.pdf`, `proposta-${offer.code}.pdf`).catch((caught) => setError(caught.message))
  }

  // Confirmed in AcceptOfferModal; the error stays in the modal.
  async function acceptOffer() {
    const { item } = await apiRequest(`/api/offers/${offer.id}/accept`, { method: 'POST' })
    await onRefresh()
    onSelectOrder(item.code)
  }

  if (!offer) return <div className="dashboard-shell proposal-shell"><Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} /><main className="proposal-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} /><p>Selecione uma oferta para fazer a proposta.</p><button type="button" onClick={() => onNavigate('Ofertas e serviços')}>Voltar às ofertas</button></main></div>

  return (
    <div className="dashboard-shell proposal-shell">
      <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="proposal-main">
        <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
        <div className="proposal-header"><div><button className="proposal-back-button" type="button" onClick={() => onNavigate('Detalhes da oferta')} aria-label="Voltar para detalhes"><ArrowLeft size={24} aria-hidden="true" /></button><div><h1>Fazer proposta</h1><p>Escolha uma das quatro opções e ajuste os valores para esta solicitação.</p></div></div></div>
        <section className="proposal-service-summary"><div className="proposal-service-image">▰</div><div className="proposal-service-client"><h2>{offer.service}</h2><span>Cliente solicitante</span><strong>{offer.company}</strong><small>{documentKind(offer.cnpj)}: {offer.cnpj}</small>{offer.requester && <small>Solicitante: {offer.requester}</small>}<small>Etiqueta: {offer.labelNumber || 'não informada'}</small></div><div className="proposal-service-fact"><span>▣</span><div><small>Prazo solicitado</small><strong>{displayDate(offer.deadline)}</strong></div><span>◇</span><div><small>Quantidade</small><strong>{offer.quantity} unidades</strong></div></div><div className="proposal-service-summary-copy"><strong>Resumo do serviço</strong><p>{offer.description}</p></div><div className="proposal-material-summary"><span>Materiais informados</span><strong>{formatMoney(materialCost)}</strong><button type="button" onClick={() => onNavigate('Detalhes da oferta')}>Ver detalhamento <span>›</span></button></div></section>
        {error && <p ref={errorRef} className="workflow-error" role="alert">{error}</p>}
        <h2 className="proposal-section-heading">Escolha uma das propostas abaixo ou personalize os valores</h2>
        <div className="proposal-card-grid">{visibleProposals.map((proposal) => <article className={`proposal-card proposal-card--${proposal.tone} ${selectedKey === proposal.key ? 'proposal-card--selected' : ''}`} key={proposal.key} onClick={() => { setSelectedKey(proposal.key); if (proposal.key !== selectedKey) { setGenerated(false); setUnsaved(true) } }}><div className="proposal-card-heading"><div><span className="proposal-card-label">PROPOSTA {proposal.key}</span><div className="proposal-card-intro"><span className="proposal-card-icon">{proposal.icon}</span><div><strong>{proposal.title}</strong><p>{proposal.description}</p></div></div></div><span className="proposal-card-tag">{proposal.tag}</span></div><div className="proposal-card-content"><div className="proposal-card-column"><div><span>◇</span><label>Materiais</label><strong>{formatMoney(proposal.materials)}</strong></div><div><span>♧</span><label>Mão de obra</label><strong>{formatMoney(proposal.labor)}</strong></div><div><span>＄</span><label>Valor do serviço</label><strong>{formatMoney(proposal.serviceValue)}</strong></div><div><span>▥</span><label>% de lucro bruto</label>{renderEditable(proposal, 'margin', `${Number(proposal.margin).toFixed(1).replace('.', ',')}%`, 'number')}</div>{marginStats && (() => { const stat = marginStats.find((item) => item.key === proposal.key); return stat && <small className="proposal-margin-hint">{stat.accepted ? `Média de ${stat.accepted} ${stat.accepted === 1 ? 'proposta aceita' : 'propostas aceitas'}` : 'Ainda sem propostas aceitas'}{stat.rate != null ? ` · ${stat.rate}% de aceite (${stat.won} de ${stat.won + stat.declined})` : ''}</small> })()}<div><span>◇</span><label>Desconto</label>{renderEditable(proposal, 'discount', `${Number(proposal.discount).toFixed(1).replace('.', ',')}%`, 'number')}</div></div><div className="proposal-card-column"><div><span>◷</span><label>Prazo de entrega</label>{renderEditable(proposal, 'deadline', proposal.deadline)}</div><div><span>⚙</span><label>Tempo de máquina</label><strong>{proposal.machine}</strong></div><div><span>◷</span><label>Tempo de serviço</label><strong>{proposal.serviceTime}</strong></div><div><span>◔</span><label>Horas totais</label><strong>{proposal.totalTime}</strong></div></div></div><div className="proposal-price"><strong>Valor da OS<small>valor cobrado do cliente</small></strong><b>{formatMoney(proposal.osValue)}</b></div><div className="proposal-profit"><strong>Lucro bruto esperado</strong><b>{formatMoney(proposal.profit)}</b></div></article>)}</div>
        <div className="proposal-bottom"><div className="proposal-notice"><span>ⓘ</span><div><strong>Confira os valores</strong><p>Materiais, mão de obra e horas vêm dos detalhes da oferta. Ajuste o prazo, o % de lucro bruto e o desconto: o Valor da OS é o que será cobrado do cliente no PDF.</p></div></div><div className="proposal-actions"><button className="proposal-cancel-button" type="button" onClick={() => onNavigate('Detalhes da oferta')}>× <strong>Cancelar</strong></button><button className="proposal-cancel-button" type="button" disabled={draftSaving || Boolean(offer.orderCode) || offer.status === 'rejected'} onClick={saveDraft}><Save size={17} aria-hidden="true" /><strong>{draftSaving ? 'Salvando...' : 'Salvar'}</strong></button><button className="proposal-send-button" type="button" onClick={openModels}><Icon name="send" /><strong>Gerar proposta em PDF</strong></button><button className="proposal-cancel-button proposal-email-button" type="button" disabled={!generated || !offer.proposal} title={generated && offer.proposal ? 'Enviar a proposta por e-mail' : 'Gere a proposta em PDF para enviar por e-mail'} onClick={() => setEmailOpen(true)}><Mail size={17} aria-hidden="true" /><strong>Enviar E-mail</strong></button></div></div>
        {(offer.proposalDraft || unsaved) && <p className={`proposal-draft-status${unsaved ? ' proposal-draft-status--unsaved' : ''}`} role="status">{unsaved ? 'Alterações ainda não salvas.' : <CircleCheck size={16} aria-hidden="true" />}{offer.proposalDraft && ` ${unsaved ? 'Última vez: proposta' : 'Proposta'} ${offer.proposalDraft.selectedKey} salva por ${offer.proposalDraft.savedByName} em ${new Date(offer.proposalDraft.savedAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })}.`}</p>}
        {generated && <div className="proposal-generated-actions"><DownloadLink url={`/api/offers/${offer.id}/proposal.pdf`} name={`proposta-${offer.code}.pdf`}>Baixar PDF da proposta{offer.proposal?.document ? ` · ${modelLabel(offer.proposal.document)}` : ''}</DownloadLink><button className="proposal-cancel-button" type="button" onClick={() => onNavigate('Ofertas e serviços')}>Retornar às ofertas</button>{!offer.orderCode && offer.status !== 'rejected' && <button className="proposal-cancel-button proposal-decline-button" type="button" disabled={saving} onClick={() => setDeclining(true)}>Cliente recusou a proposta</button>}{offer.status === 'rejected' ? <><span className="proposal-declined-note">Proposta {offer.proposalDecline?.key || offer.proposal?.key} recusada pelo cliente{offer.proposalDecline?.reason ? ` · ${offer.proposalDecline.reason}` : ''}</span>{offer.proposalDecline && <button className="proposal-cancel-button" type="button" onClick={() => setUndoing(true)}>Desfazer recusa</button>}</> : <button className="proposal-send-button" type="button" disabled={saving || Boolean(offer.orderCode)} onClick={() => setAccepting(true)}>{offer.orderCode ? `OS ${offer.orderCode} gerada` : 'Aceitar Oferta'}</button>}{offer.orderCode && <><button className="proposal-cancel-button" type="button" onClick={() => onSelectOrder(offer.orderCode)}>Ver OS</button><button className="proposal-cancel-button proposal-decline-button" type="button" onClick={() => setUnaccepting(true)}>Desfazer aceite</button></>}</div>}
      </main>
      {accepting && <AcceptOfferModal offer={offer} onConfirm={acceptOffer} onClose={() => setAccepting(false)} />}
      {unaccepting && <UndoAcceptModal offer={offer} orderCode={offer.orderCode} onConfirm={async () => { await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/unaccept`, jsonOptions('POST', {})); await onRefresh(); setGenerated(true) }} onClose={() => setUnaccepting(false)} />}
      {undoing && <UndoDeclineModal offer={offer} onConfirm={async () => { await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/undecline`, jsonOptions('POST', {})); await onRefresh() }} onClose={() => setUndoing(false)} />}
      {declining && <DeclineProposalModal offer={offer} onConfirm={async (decline) => { await apiRequest(`/api/offers/${encodeURIComponent(offer.id)}/decline`, jsonOptions('POST', decline)); await onRefresh() }} onClose={() => setDeclining(false)} />}
      {layoutOpen && <ProposalDocumentModal offer={offer} option={selectedProposal} onClose={() => setLayoutOpen(false)} onSaved={proposalSaved} />}
      {emailOpen && <ProposalEmailModal offer={offer} onClose={() => setEmailOpen(false)} onSent={proposalEmailSent} />}
      {emailNotice && <p className="app-toast" role="status"><CircleCheck size={16} aria-hidden="true" />{emailNotice}</p>}
    </div>
  )
}

const loadMaterialRequestHistory = (id, signal) => apiRequest(`/api/material-requests/${encodeURIComponent(id)}/history`, { signal })

function OrdersScreen({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, orders, onSelectOffer, onSelectOrder, onRefresh, materialRequestTarget, onRequestLocated }) {
  const [manualRequests, setManualRequests] = useState([])
  const [requestCodes, setRequestCodes] = useState({})
  const [requestListError, setRequestListError] = useState('')
  const [manualInventory, setManualInventory] = useState(null)
  const [openingRequest, setOpeningRequest] = useState(false)
  const [historyRequest, setHistoryRequest] = useState(null)
  const requests = useMemo(() => [...manualRequests.map((item) => ({ ...item, quantity: item.purchaseQuantity, requiredQuantity: Number(item.quantity), receipt: item.requestReceipt, rejection: item.requestRejection })), ...purchaseMaterialRequests(offers, orders).map((item) => ({ ...item, code: requestCodes[item.id] || null }))], [offers, orders, manualRequests, requestCodes])
  async function refreshMaterialRequests() {
    try { const data = await apiRequest('/api/material-requests'); setManualRequests(data.manualRequests || []); setRequestCodes(data.codes || {}); setRequestListError('') }
    catch (error) { setRequestListError(error.message); throw error }
  }
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try { const data = await apiRequest('/api/material-requests', { signal: controller.signal }); if (!controller.signal.aborted) { setManualRequests(data.manualRequests || []); setRequestCodes(data.codes || {}); setRequestListError('') } }
      catch (error) { if (!controller.signal.aborted) setRequestListError(error.message) }
    }
    refresh()
    const stopPolling = pollWhileVisible(refresh, 10000)
    return () => { controller.abort(); stopPolling() }
  }, [])
  async function openManualRequest() {
    if (openingRequest) return
    setOpeningRequest(true)
    setRequestListError('')
    try { setManualInventory((await loadOverviewInventory()).items) }
    catch (error) { setRequestListError(error.message) }
    finally { setOpeningRequest(false) }
  }
  async function saveManualRequest(body) {
    const data = await apiRequest('/api/material-requests', jsonOptions('POST', body))
    setManualRequests((current) => [data.item, ...current])
  }
  const requestRows = useRef(new Map())
  const [highlightedRequests, setHighlightedRequests] = useState([])
  useLayoutEffect(() => {
    if (!materialRequestTarget) return undefined
    const matches = requests.filter((request) => request.orderCode === materialRequestTarget.orderCode)
    const frame = window.requestAnimationFrame(() => {
      const firstRow = requestRows.current.get(matches[0]?.id)
      if (firstRow) {
        firstRow.scrollIntoView({ block: 'center', behavior: 'instant' })
        firstRow.querySelector('button')?.focus({ preventScroll: true })
        setHighlightedRequests(matches.map((request) => request.id))
      }
      onRequestLocated(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [materialRequestTarget, requests, onRequestLocated])
  useEffect(() => {
    if (!highlightedRequests.length) return undefined
    const timer = window.setTimeout(() => setHighlightedRequests([]), 2400)
    return () => window.clearTimeout(timer)
  }, [highlightedRequests])
  const [materialEntry, setMaterialEntry] = useState(null)
  const [materialEntryError, setMaterialEntryError] = useState('')
  const [openingMaterialId, setOpeningMaterialId] = useState(null)
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [rejectingRequest, setRejectingRequest] = useState(null)
  const [purchase, setPurchase] = useState(null)
  useEffect(() => pollWhileVisible(() => onRefresh().catch(() => {}), 10000), [])

  async function openMaterialEntry(request) {
    if (openingMaterialId || savingMaterial) return
    setOpeningMaterialId(request.id)
    setMaterialEntryError('')
    try {
      const inventory = await loadOverviewInventory()
      const existing = findInventoryMaterial(request, inventory.items)
      setMaterialEntry({ ...inventory, requestId: request.id, receiptId: newId(), existingId: existing?.id ?? null, form: { name: existing?.name || request.name || '', detail: request.detail || existing?.detail || '', unit: materialUnit(existing?.unit ?? request.unit), quantity: request.quantity, minimum: existing?.minimum ?? '', unitPrice: request.unitPrice ?? existing?.unitPrice ?? '' } })
    } catch (error) { setMaterialEntryError(error.message) }
    finally { setOpeningMaterialId(null) }
  }

  async function saveMaterialEntry(item) {
    if (savingMaterial || !materialEntry) return
    setSavingMaterial(true)
    setMaterialEntryError('')
    try {
      await saveInventoryMaterial(item, materialEntry.requestId, materialEntry.receiptId)
      setMaterialEntry(null)
      setPurchase(stockPurchase(item))
      await onRefresh()
      await refreshMaterialRequests()
    } catch (error) { setMaterialEntryError(error.message) }
    finally { setSavingMaterial(false) }
  }

  async function rejectMaterialRequest(request) {
    await apiRequest(`/api/material-requests/${encodeURIComponent(request.id)}/reject`, { method: 'POST' })
    try { await onRefresh(); await refreshMaterialRequests() } catch (error) { setMaterialEntryError(error.message) }
  }

  return <div className="dashboard-shell orders-shell">
    <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
    <main className="orders-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
      <div className="orders-header"><h1>Pedidos de material</h1><button className="os-button os-button--primary material-request-create" type="button" disabled={openingRequest} onClick={openManualRequest}><Icon name="plus" />{openingRequest ? 'Carregando...' : 'Solicitar material'}</button></div>
<div className="material-orders-table"><table><thead><tr><th className="material-orders-code">Código</th><th>Material solicitado</th><th>Especificação</th><th className="material-orders-quantity">Quantidade a pedir</th><th className="material-orders-quantity">Quantidade necessária</th><th className="material-orders-order">OS / Oferta relacionada</th><th className="material-orders-date">Data</th><th className="material-orders-actions">Ações</th><th className="material-orders-history">Histórico</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id} ref={(node) => { if (node) requestRows.current.set(request.id, node); else requestRows.current.delete(request.id) }} className={highlightedRequests.includes(request.id) ? 'material-request--highlighted' : undefined}><td data-label="Código" className="material-orders-code"><strong>{request.code || '—'}</strong></td><td data-label="Material solicitado"><button className="material-order-link" type="button" onClick={() => onNavigate('Estoque')}><strong>{request.name}</strong></button></td><td data-label="Especificação">{request.detail || '—'}</td><td data-label="Quantidade a pedir"><strong>{formatQuantity(request.quantity, request.unit)}</strong></td><td data-label="Quantidade necessária">{formatQuantity(request.requiredQuantity, request.unit)}</td><td data-label="OS / Oferta relacionada">{request.manual ? <span>Sem OS vinculada<small>Pedido manual</small></span> : <><button className="material-order-link" type="button" onClick={() => request.orderCode ? onSelectOrder(request.orderCode) : onSelectOffer(request.offerId)}>{request.orderCode || request.offerCode}<Icon name="eye" /></button>{!request.orderCode && <small>Aguardando OS</small>}</>}</td><td data-label="Data">{displayDate(request.requestedAt)}</td><td data-label="Ações" className="material-orders-actions">{request.rejection ? <span className="material-order-refused" role="status"><CircleX size={16} aria-hidden="true" />Pedido recusado</span> : request.receipt && request.quantity <= 0 ? <span className="material-order-received" role="status"><CircleCheck size={16} aria-hidden="true" />Material solicitado adicionado</span> : <div className="material-orders-action-group"><button className="material-order-action material-order-action--add" type="button" disabled={Boolean(openingMaterialId) || savingMaterial} onClick={() => openMaterialEntry(request)}><Icon name="plus" />{openingMaterialId === request.id ? 'Carregando...' : 'Adicionar material'}</button><button className="material-order-action material-order-action--reject" type="button" disabled={Boolean(openingMaterialId) || savingMaterial} onClick={() => setRejectingRequest(request)}><X size={15} aria-hidden="true" />Recusar pedido</button></div>}</td><td data-label="Histórico" className="material-orders-history"><button className="os-icon-button material-request-history-button" type="button" title="Histórico do pedido" aria-label={`Ver histórico do pedido de ${request.name}`} onClick={() => setHistoryRequest(request)}><Info size={17} aria-hidden="true" /></button></td></tr>)}</tbody></table>{!requests.length && <p className="material-orders-empty">Nenhum pedido de material.</p>}</div>
      {materialEntryError && !materialEntry && <p role="alert" className="workflow-error">{materialEntryError}</p>}
      {requestListError && <p role="alert" className="workflow-error">{requestListError}</p>}
    </main>
    {materialEntry && <InventoryModal item={materialEntry.form} inventoryItems={materialEntry.items} initialExistingId={materialEntry.existingId} saving={savingMaterial} error={materialEntryError} onClose={() => { if (!savingMaterial) setMaterialEntry(null) }} onSave={saveMaterialEntry} />}
    {manualInventory && <MaterialRequestModal inventory={manualInventory} onSave={saveManualRequest} onClose={() => setManualInventory(null)} />}
    {historyRequest && <MaterialRequestHistoryModal request={historyRequest} loadHistory={loadMaterialRequestHistory} onClose={() => setHistoryRequest(null)} />}
    {rejectingRequest && <RejectMaterialRequestModal request={rejectingRequest} onConfirm={rejectMaterialRequest} onClose={() => setRejectingRequest(null)} />}
    {purchase && <StockPurchaseFinance purchase={purchase} onClose={() => setPurchase(null)} />}
  </div>
}

// The OS has its own screen, opened from the service panels, offers and material requests.
function OrderScreen({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, orders, selectedOrderCode, onRefresh, onBack, onReopened, workflowLoading }) {
  const selectedOrder = orders.find((order) => order.code === selectedOrderCode)
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
  useEffect(() => pollWhileVisible(() => onRefresh().catch(() => {}), 10000), [selectedOrderCode])
  const operation = selectedOrder?.operation
  const activeMs = operation ? operationElapsed(operation, now) : 0
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

  async function interruptSession(reason, sessionId) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/interrupt`, jsonOptions('POST', { reason, sessionId }))
    setOperationError('')
    try { await onRefresh() } catch (error) { setOperationError(error.message) }
  }
  async function editOrder(draft) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}`, jsonOptions('PUT', draft))
    setOperationError('')
    try { await onRefresh() } catch (error) { setOperationError(error.message) }
  }
  // `options.receivables` is what the user chose for the accounts receivable posted for the OS ('keep' or 'delete').
  async function reopenOrder(options) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/reopen`, jsonOptions('POST', options || {}))
    setOperationError('')
    try { await onRefresh() } catch (error) { setOperationError(error.message) }
    onReopened(selectedOrderCode)
  }
  async function uploadOrderAttachment(file) {
    await apiRequest(`/api/offers/${selectedOrder.offerId}/attachments?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
    try { await onRefresh() } catch (error) { setOperationError(error.message) }
  }
  async function editEventTime(eventId, at) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/events/${encodeURIComponent(eventId)}/time`, jsonOptions('PUT', { at }))
    onRefresh().catch(() => {})
  }
  async function addOperationEvent(body) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(selectedOrderCode)}/events`, jsonOptions('POST', body))
    onRefresh().catch(() => {})
  }
  return <div className="dashboard-shell orders-shell orders-shell--detail">
    <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
    <main className="orders-main"><WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
      <div className="orders-header"><h1>Ordem de serviço</h1></div>
      {selectedOrder ? <OrderDetails key={selectedOrder.code} order={selectedOrder} activeTime={activeTime} stageNamesInput={stageNamesInput} onChangeStages={setStageNamesInput} onConfigureStages={configureStages} onInterrupt={interruptSession} onEdit={editOrder} onReopen={reopenOrder} onUpload={uploadOrderAttachment} onEditEventTime={editEventTime} onAddEvent={addOperationEvent} onRefresh={onRefresh} operationError={operationError} onBack={onBack} Icon={Icon} />
        : <div className="os-missing"><p role="status">{workflowLoading ? 'Carregando a ordem de serviço...' : 'Ordem de serviço não encontrada.'}</p>{!workflowLoading && <button className="os-button" type="button" onClick={onBack}><Icon name="collapse" />Voltar</button>}</div>}
    </main>
  </div>
}

function AdminServicesView({ collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, orders, onSelectOrder, onRefresh, workflowError, highlightCode }) {
  const completedView = activeNav === 'Serviços concluídos'
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [collaborator, setCollaborator] = useState('')
  const [sort, setSort] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [schedulingCode, setSchedulingCode] = useState(null)
  const displayRef = useRef(null)
  const [displayMode, setDisplayMode] = useState(false)
  const [displayError, setDisplayError] = useState('')
  const [pendingInspectionCode, setPendingInspectionCode] = useState(null)
  const inspectedOrder = orders.find((order) => order.code === pendingInspectionCode)
  const inspectedMaterials = pendingOrderMaterials(inspectedOrder)
  // An OS that was just reopened is brought into view (once, when the panel opens).
  useEffect(() => { if (highlightCode) document.querySelector('.admin-os-row--reopened')?.scrollIntoView({ block: 'nearest' }) }, [])
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
  const labels = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', stage_done: 'Etapa concluída', finalizing: 'Finalizando', completed: 'Concluído' }
  const totalTime = (operation) => operationElapsed(operation, now)
  const deadlineState = (order) => panelDeadline(order, now)
  const panelOrders = servicePanelOrders(orders, completedView)
  const matchesFilter = (order, key) => key === 'all' || (key === 'completed' ? order.operation.status === 'completed' : deadlineState(order).key === key)
  // Finished services: everyone who worked on the OS, to filter by employee.
  const collaboratorOptions = completedView ? [...new Map(panelOrders.flatMap((order) => (order.collaborators || []).map((person) => [person.id, person.name])))].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR')) : []
  const completionTime = (order) => [order.operation.completedAt, order.operation.completionAcknowledgedAt, order.createdAt].map((value) => Date.parse(value)).find(Number.isFinite)
  const matching = panelOrders.filter((order) => {
    const query = search.trim().toLocaleLowerCase()
    return matchesFilter(order, filter) && (!completedView || !collaborator || (order.collaborators || []).some((person) => person.id === collaborator)) && (!query || [order.service, order.company, order.code, order.labelNumber].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })
  // Headers of the finished services sort the table: numbers and dates start from the largest, text from A to Z.
  const sortValues = { code: (order) => order.code, company: (order) => order.company || '', collaborators: collaboratorNames, pieces: (order) => currentPieceProgress(order.operation, order.quantity).completedPieces, active: (order) => totalTime(order.operation), completion: (order) => completionTime(order) || 0, purchase: (order) => order.purchaseOrders?.length || 0 }
  const largestFirst = new Set(['code', 'pieces', 'active', 'completion', 'purchase'])
  const sortBy = (key) => setSort((current) => ({ key, direction: current?.key === key ? -current.direction : largestFirst.has(key) ? -1 : 1 }))
  const sorted = sort ? [...matching].sort((left, right) => { const a = sortValues[sort.key](left), b = sortValues[sort.key](right); return sort.direction * (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true })) || left.code.localeCompare(right.code) }) : matching
  const header = (label, key) => completedView && key ? <th key={label} aria-sort={sort?.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button className="admin-os-sort" type="button" onClick={() => sortBy(key)}>{label}{sort?.key !== key ? <ArrowUpDown size={12} aria-hidden="true" /> : sort.direction === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}</button></th> : <th key={label}>{label}</th>
  // Emergencies come first while the work is in progress; finished services keep their order unless a header is chosen.
  const visible = completedView ? sorted : emergenciesFirst(matching)
  async function acknowledgeCompletion(code) {
    await apiRequest(`/api/operations/orders/${encodeURIComponent(code)}/acknowledge-completion`, jsonOptions('POST', {}))
    await onRefresh()
  }
  return <div className={`dashboard-shell admin-os-shell${completedView ? ' admin-os-shell--completed' : ''}`}>
    <Sidebar collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} />
    <main className="dashboard-main admin-os-main" ref={displayRef}>
      <WorkspaceTabs tabs={tabs} activeNav={activeNav} onNavigate={onNavigate} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
      <div className="dashboard-header"><div><h1>{completedView ? 'Serviços concluídos' : 'Painel de serviços em andamento'}</h1><p></p></div><label className="global-search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por serviço, cliente ou OS..." aria-label="Buscar serviços" /></label></div>
      {workflowError && <p className="workflow-error" role="alert">{workflowError}</p>}
      {!completedView && <div className="admin-os-filters deadline-filters">{[['all', 'Todos'], ...deadlineCategories, ['completed', 'Concluídos']].map(([key, label]) => <button className={filter === key ? 'selected' : ''} type="button" key={key} onClick={() => setFilter(key)}><span className={`admin-os-filter-icon admin-os-filter-icon--${key}`} aria-hidden="true">{key === 'all' ? '◉' : ['at-deadline', 'late'].includes(key) ? '!' : key === 'completed' ? '✓' : '●'}</span>{label}<strong>{panelOrders.filter((order) => matchesFilter(order, key)).length}</strong></button>)}</div>}
      {!completedView && <div className="admin-os-filters">{[['open', 'Abertas'], ['waiting', 'Aguardando'], ['running', 'Em execução'], ['paused', 'Pausadas'], ['stage_done', 'Etapa concluída'], ['finalizing', 'Finalizando'], ['completed', 'Concluídas']].map(([key, label]) => <button className={filter === key ? 'selected' : ''} type="button" key={key} onClick={() => setFilter(key)}>{label}<strong>{orders.filter((order) => key === 'open' ? order.operation.status !== 'completed' : order.operation.status === key).length}</strong></button>)}</div>}
      {completedView && <div className="admin-os-collaborator-filter"><label>Colaborador<select aria-label="Filtrar por colaborador" value={collaborator} onChange={(event) => setCollaborator(event.target.value)}><option value="">Todos</option>{collaboratorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>{collaborator && <span>{visible.length} {visible.length === 1 ? 'serviço' : 'serviços'}</span>}</div>}
      <div className="admin-os-table-wrap"><table className="admin-os-table"><thead><tr>{header('OS / Serviço', 'code')}{header('Cliente', 'company')}{header(completedView ? 'Colaboradores' : 'Operador', 'collaborators')}{header('Etapa atual')}{header('Peças concluídas', 'pieces')}{!completedView && <th>Progresso</th>}{header('Tempo ativo', 'active')}{header(completedView ? 'Conclusão' : 'Tempo restante', 'completion')}{header('Status')}{completedView && header('Pedido de compra', 'purchase')}<th></th></tr></thead><tbody>{visible.map((order) => <ServicePanelRow key={order.code} order={order} now={now} completedView={completedView} highlighted={order.code === highlightCode} onSelectOrder={onSelectOrder} onMaterialAlert={setPendingInspectionCode} onCompletedStatus={setSchedulingCode} />)}</tbody></table>{!visible.length && <p className="admin-os-empty">{completedView ? 'Nenhum serviço concluído encontrado.' : 'Nenhuma OS real encontrada para este filtro.'}</p>}</div>
      {completedView ? <div className="admin-os-summary admin-os-summary--completed"><div><strong>{panelOrders.length}</strong><span>Serviços concluídos</span></div><div><strong>{panelOrders.reduce((total, order) => total + currentPieceProgress(order.operation, order.quantity).completedPieces, 0)}</strong><span>Peças concluídas</span></div><div><strong>{panelDuration(panelOrders.reduce((total, order) => total + totalTime(order.operation), 0))}</strong><span>Tempo ativo somado</span></div></div> : <div className="admin-os-summary"><div><strong>{orders.filter((order) => order.operation.status !== 'completed').length}</strong><span>OS abertas</span></div><div><strong>{orders.filter((order) => order.operation.status === 'running' || order.operation.status === 'finalizing').length}</strong><span>Em execução</span></div><div><strong>{panelDuration(orders.reduce((total, order) => total + totalTime(order.operation), 0))}</strong><span>Tempo ativo somado</span></div><div><strong>{orders.filter((order) => order.operation.status === 'completed').length}</strong><span>Concluídas</span></div></div>}
      {displayError && <p className="workflow-error" role="alert">{displayError}</p>}
      <footer className="admin-os-display-controls">{displayMode && <time>{new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}</time>}<button type="button" onClick={toggleDisplayMode}>{displayMode ? <Minimize2 size={18} /> : <Monitor size={18} />}{displayMode ? 'Sair do modo de exibição' : 'Modo de exibição'}</button></footer>
      {schedulingCode && <ReceivableScheduleModal key={schedulingCode} orderCode={schedulingCode} onClose={() => setSchedulingCode(null)} onAcknowledge={acknowledgeCompletion} />}
      {inspectedOrder && inspectedMaterials.length > 0 && <PendingMaterialsModal orderCode={inspectedOrder.code} materials={inspectedMaterials} onClose={() => setPendingInspectionCode(null)} onOpenRequest={() => { setPendingInspectionCode(null); onNavigate('Pedidos', { orderCode: inspectedOrder.code }) }} />}
    </main>
  </div>
}

function Dashboard({ user, onUpdateUser, collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs, offers, orders, selectedOfferId, selectedOrderCode, onRefresh, onSelectOffer, onSelectOrder, onCloseOrder, onOrderReopened, reopenedCode, onOpenPayables, payableFilters, workflowError, workflowLoading, materialRequestTarget, onRequestLocated }) {
  const toolProps = { Sidebar, WorkspaceTabs, navigationProps: { collapsed, onToggle, activeNav, onNavigate, onLogout, tabs, onCloseTab, onReorderTabs } }
  if (['Contas a Pagar', 'Business Intelligence', 'Fornecedores'].includes(activeNav)) return <PayablesScreen {...toolProps} accountFilters={payableFilters} mode={{ 'Contas a Pagar': 'accounts', 'Business Intelligence': 'bi', 'Fornecedores': 'suppliers' }[activeNav]} />
  if (['Grupos de contas', 'Classificações'].includes(activeNav)) return <AccountPlanScreen key={activeNav} {...toolProps} mode={activeNav === 'Grupos de contas' ? 'groups' : 'classifications'} />
  if (activeNav === 'DRE') return <DreScreen {...toolProps} />
  if (activeNav === 'Ajustes da DRE') return <DreAdjustmentsScreen {...toolProps} />
  if (activeNav === 'Contas a Receber') return <ReceivablesScreen {...toolProps} />
  if (activeNav === 'Tesouraria') return <TreasuryScreen {...toolProps} />
  if (activeNav === 'Fluxo de caixa') return <CashFlowScreen {...toolProps} />
  if (activeNav === 'Baixa em Lote') return <BatchSettlementScreen {...toolProps} />
  if (activeNav === 'Conciliação bancária') return <BankStatementsScreen {...toolProps} />
  if (activeNav === 'Relatórios') return <ReportsScreen {...toolProps} />
  if (activeNav === 'Serviços') return <LaborServicesScreen {...toolProps} />
  if (activeNav === 'Etapas') return <StagesScreen {...toolProps} />
  if (activeNav === 'Planejamento') return <PlanningScreen {...toolProps} />
  if (activeNav === 'Setores') return <SimpleRegistryScreen key="sectors" {...toolProps} title="Setores" singular="setor" endpoint="/sectors" nameLabel="Nome do setor" countLabel="Em uso por" count={(item) => [[item.employees, 'funcionário', 'funcionários'], [item.machines, 'máquina', 'máquinas'], [item.laborServices, 'serviço', 'serviços']].filter(([total]) => total).map(([total, one, many]) => `${total} ${total === 1 ? one : many}`).join(' · ') || '—'} />
  if (activeNav === 'Solicitantes') return <RequestersScreen key="requesters" {...toolProps} />
  if (activeNav === 'Compradores') return <RequestersScreen key="buyers" {...toolProps} kind={contactKinds.buyers} />
  if (activeNav === 'Bancos') return <SimpleRegistryScreen key="banks" {...toolProps} title="Bancos" singular="banco" endpoint="/banks" nameLabel="Nome do banco" fields={[['agency', 'Agência', 20], ['account', 'Conta', 30]]} countLabel="Baixas registradas" count={(item) => item.settlements} />
  if (activeNav === 'Razões de pausas') return <SimpleRegistryScreen key="pause-reasons" {...toolProps} title="Razões de pausas" singular="razão de pausa" article="a" endpoint="/pause-reasons" nameLabel="Razão da pausa" chart />
  if (activeNav === 'Configurações') return <AccountSettings {...toolProps} user={user} onUpdateUser={onUpdateUser} />
  if (activeNav === 'Dashboard') return <AdminHome user={user} orders={orders} offers={offers} workflowError={workflowError} workflowLoading={workflowLoading} onRefresh={onRefresh} onNavigate={onNavigate} onSelectOrder={onSelectOrder} onOpenPayables={onOpenPayables} loadPayables={user?.role === 'staff' ? null : loadOverviewPayables} loadInventory={loadOverviewInventory} Sidebar={Sidebar} WorkspaceTabs={WorkspaceTabs} navigationProps={{ collapsed, onToggle, activeNav, onLogout, tabs, onCloseTab, onReorderTabs }} />
  if (activeNav === 'Máquinas') return <Machines collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Estoque') return <InventoryScreen collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} onSelectOrder={onSelectOrder} />
  if (activeNav === 'Calculadora de pesos e medidas') return <Calculator collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Funcionários') return <RegistrationScreen key="employee" kind="employee" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Administradores') return <RegistrationScreen key="admin" kind="admin" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Clientes') return <RegistrationScreen key="client" kind="client" collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} />
  if (activeNav === 'Ofertas e serviços') return <Offers collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offers={offers} onRefresh={onRefresh} onSelectOffer={onSelectOffer} onSelectOrder={onSelectOrder} workflowError={workflowError} />
  if (activeNav === 'Detalhes da oferta') return <OfferDetailsV2 collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offer={offers.find((item) => item.id === selectedOfferId)} onRefresh={onRefresh} onSelectOrder={onSelectOrder} />
  if (activeNav === 'Fazer proposta') return <ProposalBuilder collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offer={offers.find((item) => item.id === selectedOfferId)} onRefresh={onRefresh} onSelectOrder={onSelectOrder} />
  if (activeNav === 'Pedidos') return <OrdersScreen collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} offers={offers} orders={orders} onSelectOffer={onSelectOffer} onSelectOrder={onSelectOrder} onRefresh={onRefresh} materialRequestTarget={materialRequestTarget} onRequestLocated={onRequestLocated} />
  if (activeNav === 'Ordem de serviço') return <OrderScreen collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} orders={orders} selectedOrderCode={selectedOrderCode} onRefresh={onRefresh} onBack={onCloseOrder} onReopened={onOrderReopened} workflowLoading={workflowLoading} />
  return <AdminServicesView key={activeNav} highlightCode={reopenedCode} collapsed={collapsed} onToggle={onToggle} activeNav={activeNav} onNavigate={onNavigate} onLogout={onLogout} tabs={tabs} onCloseTab={onCloseTab} onReorderTabs={onReorderTabs} orders={orders} onSelectOrder={onSelectOrder} onRefresh={onRefresh} workflowError={workflowError} />
}
function App() {
  const [cpf, setCpf] = useState('')
  const [operatorUsername, setOperatorUsername] = useState('')
  const [loginMode, setLoginMode] = useState('admin')
  const [recovering, setRecovering] = useState(false)
  const [testLoginEnabled, setTestLoginEnabled] = useState(null)
  const [operatorToken, setOperatorToken] = useState(() => window.sessionStorage.getItem('gmac-operator-token'))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [isDashboard, setIsDashboard] = useState(false)
  const [adminUser, setAdminUser] = useState(null)
  // The stages come from "Etapas": loaded once signed in (this device's last copy first), and every screen is drawn again
  // when they change.
  const [, setStageVersion] = useState(0)
  useEffect(() => onStageCatalogChange(() => setStageVersion((value) => value + 1)), [])
  useEffect(() => { if (isDashboard) cachedResource('/stages', setStageCatalog).catch(() => {}) }, [isDashboard])
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
  const [orderOrigin, setOrderOrigin] = useState(null)
  const [reopenedCode, setReopenedCode] = useState(null)
  const [materialRequestTarget, setMaterialRequestTarget] = useState(null)
  const [workflowError, setWorkflowError] = useState('')
  const [workflowLoading, setWorkflowLoading] = useState(true)
  const appearance = useAccountTheme(isDashboard ? adminUser : null, restoringSession)

  useEffect(() => {
    const controller = new AbortController()
    let retryTimer
    async function loadLoginConfig() {
      try {
        const response = await fetch('/api/auth/config', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Configuração de acesso indisponível.')
        const data = await response.json()
        if (typeof data.testLoginEnabled !== 'boolean') throw new Error('Configuração de acesso inválida.')
        if (!controller.signal.aborted) setTestLoginEnabled(data.testLoginEnabled)
      } catch {
        if (!controller.signal.aborted) retryTimer = window.setTimeout(loadLoginConfig, 2000)
      }
    }
    loadLoginConfig()
    return () => { controller.abort(); window.clearTimeout(retryTimer) }
  }, [])

  // Every screen opens at its top, whatever the scroll of the previous one.
  useLayoutEffect(() => {
    if (isDashboard) window.scrollTo({ top: 0, behavior: 'auto' })
  }, [isDashboard, activeNav, selectedOfferId, selectedOrderCode])

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
        const validPages = [...navigation.map(([name]) => name), 'Detalhes da oferta', 'Fazer proposta', 'Ordem de serviço'].filter((name) => user.role !== 'staff' || !isFinancialPage(name))
        if (String(workspace?.userId) === String(user.id) && validPages.includes(workspace?.activeNav)) {
          setActiveNav(workspace.activeNav)
          setOpenTabs([...new Set([...(Array.isArray(workspace.tabs) ? workspace.tabs.filter((tab) => validPages.includes(tab)) : []), workspace.activeNav])])
          setSidebarCollapsed(Boolean(workspace.collapsed))
          setSelectedOfferId(typeof workspace.offerId === 'string' ? workspace.offerId : null)
          setSelectedOrderCode(typeof workspace.orderCode === 'string' ? workspace.orderCode : null)
          setOrderOrigin(validPages.includes(workspace.orderOrigin) ? workspace.orderOrigin : null)
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
    window.sessionStorage.setItem('gmac-admin-workspace', JSON.stringify({ userId: adminUser.id, activeNav, tabs: openTabs, collapsed: sidebarCollapsed, offerId: selectedOfferId, orderCode: selectedOrderCode, orderOrigin }))
  }, [isDashboard, adminUser, activeNav, openTabs, sidebarCollapsed, selectedOfferId, selectedOrderCode, orderOrigin])

  useEffect(() => {
    // Screens of work in progress, finished services and offers refresh by themselves, as the panel does.
    if (!isDashboard || !['Serviços em andamento', 'Serviços concluídos', 'Ofertas e serviços', 'Dashboard'].includes(activeNav)) return undefined
    return pollWhileVisible(() => refreshWorkflow().catch(() => {}), 10000)
  }, [isDashboard, activeNav])

  function selectOffer(id) {
    setSelectedOfferId(id)
    navigateTo('Detalhes da oferta')
  }

  // The notice of a saved proposal opens it; the offers are read first, so the screen starts from the values just saved.
  useEffect(() => {
    const openProposal = ({ detail }) => refreshWorkflow().catch(() => {}).then(() => { setSelectedOfferId(detail); navigateTo('Fazer proposta') })
    window.addEventListener('gmac-proposal-open', openProposal)
    return () => window.removeEventListener('gmac-proposal-open', openProposal)
  }, [adminUser?.role])

  function selectOrder(code) {
    if (activeNav !== 'Ordem de serviço') setOrderOrigin(activeNav)
    setSelectedOrderCode(code)
    navigateTo('Ordem de serviço')
  }

  // A reopened OS is back in progress: it goes to the panel of services in progress, highlighted for a few seconds.
  function orderReopened(code) {
    setOpenTabs((current) => { const next = current.filter((tab) => tab !== 'Ordem de serviço'); return next.includes('Serviços em andamento') ? next : [...next, 'Serviços em andamento'] })
    setActiveNav('Serviços em andamento')
    setSelectedOrderCode(null)
    setReopenedCode(code)
  }
  useEffect(() => {
    if (!reopenedCode) return undefined
    const timer = window.setTimeout(() => setReopenedCode(null), 8000)
    return () => window.clearTimeout(timer)
  }, [reopenedCode])

  // Leaves the OS screen and returns to the screen it was opened from.
  function closeOrder() {
    const origin = orderOrigin || 'Serviços em andamento'
    setOpenTabs((current) => { const next = current.filter((tab) => tab !== 'Ordem de serviço'); return next.includes(origin) ? next : [...next, origin] })
    setActiveNav(origin)
    setSelectedOrderCode(null)
  }

  function navigateTo(label, requestTarget = null) {
    if (adminUser?.role === 'staff' && isFinancialPage(label)) return
    setMaterialRequestTarget(label === 'Pedidos' ? requestTarget : null)
    if (label === 'Contas a Pagar') setPayableFilters(null)
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
    if (token) window.sessionStorage.setItem('gmac-admin-token', token)
    else window.sessionStorage.removeItem('gmac-admin-token')
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
    setMessageError(false)
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
      if (!response.ok) {
        // After the 3rd wrong password, the server sends how many tries are left (2 or 1): warn in red.
        if (typeof data.attemptsRemaining === 'number' && data.attemptsRemaining > 0 && data.attemptsRemaining <= 2) {
          throw new Error(`${data.message || 'CPF ou senha inválidos.'} ${data.attemptsRemaining} ${data.attemptsRemaining === 1 ? 'tentativa restante' : 'tentativas restantes'} antes do bloqueio temporário.`)
        }
        throw new Error(data.message || 'Não foi possível entrar.')
      }
      enterAdmin(data.user, data.token)
    } catch (error) {
      if (loginMode === 'admin' && error.message === 'O banco de dados ainda não está configurado.') {
        enterAdmin(null)
      } else {
        setMessageError(true)
        setMessage(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (operatorToken) return <OperatorDashboard token={operatorToken} onLogout={() => { window.sessionStorage.removeItem('gmac-operator-token'); window.sessionStorage.removeItem(operatorEmployeeKey); setOperatorToken(null) }} />
  if (restoringSession) return <main className="session-restore"><img src="/images/gmac-logo-transparent.png" alt="GMAC Metalúrgica" />{restoreError ? <><p role="alert">{restoreError}</p><div><button type="button" className="admin-tool-button admin-tool-button--primary" onClick={() => setRestoreAttempt((value) => value + 1)}>Tentar novamente</button><button type="button" className="admin-tool-button" onClick={logoutAdmin}>Sair</button></div></> : <p role="status">Restaurando sessão...</p>}</main>
  if (isDashboard) return <ThemeContext.Provider value={appearance}><AdminIdentityContext.Provider value={adminUser}><WorkspaceTabsContext.Provider value={closeAllTabs}><Dashboard user={adminUser} onUpdateUser={setAdminUser} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((current) => !current)} activeNav={activeNav} onNavigate={navigateTo} onCloseTab={closeTab} onReorderTabs={reorderTabs} tabs={openTabs} onLogout={logoutAdmin} offers={offers} orders={orders} selectedOfferId={selectedOfferId} selectedOrderCode={selectedOrderCode} onRefresh={refreshWorkflow} onSelectOffer={selectOffer} onSelectOrder={selectOrder} onCloseOrder={closeOrder} onOrderReopened={orderReopened} reopenedCode={reopenedCode} onOpenPayables={openPayables} payableFilters={payableFilters} workflowError={workflowError} workflowLoading={workflowLoading} materialRequestTarget={materialRequestTarget} onRequestLocated={setMaterialRequestTarget} /></WorkspaceTabsContext.Provider></AdminIdentityContext.Provider></ThemeContext.Provider>

  return (
    <main className="login-page">
      <LoginBrandPanel />

      <section className="access-panel">
        <div className="login-card">
          <div className="login-card__heading">
            <h1>Entrar no sistema</h1>
            <p>{testLoginEnabled == null ? 'Verificando configuração de acesso...' : testLoginEnabled ? 'Ambiente de teste: acesso sem senha.' : loginMode === 'admin' ? 'Informe seu CPF e senha para acessar.' : 'Use a conta compartilhada dos operadores.'}</p>
          </div>

          <div className="login-role-switch"><button className={loginMode === 'admin' ? 'active' : ''} type="button" onClick={() => { setLoginMode('admin'); setMessage(''); setPassword('') }}>Administrativo</button><button className={loginMode === 'operator' ? 'active' : ''} type="button" onClick={() => { setLoginMode('operator'); setRecovering(false); setMessage(''); setPassword('') }}>Operador</button></div>

          <div className="heading-rule" />

          {recovering ? <PasswordRecovery initialCpf={cpf} onCancel={() => { setRecovering(false); setMessage('') }} onDone={(text) => { setRecovering(false); setPassword(''); setMessageError(false); setMessage(text) }} /> : <>
          <form onSubmit={handleSubmit} noValidate={testLoginEnabled !== false}>
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
                required={testLoginEnabled === false}
              /> : <input id="operator-username" name="operator-username" inputMode="numeric" autoComplete="username" value={operatorUsername} onChange={(event) => setOperatorUsername(formatLogin(event.target.value))} placeholder="00000000000" pattern="[0-9]{11}" minLength={11} required={testLoginEnabled === false} />}
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
                required={testLoginEnabled === false}
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

          {loginMode === 'admin' && <button className="forgot-link" type="button" onClick={() => { setMessage(''); setRecovering(true) }}>Esqueci minha senha</button>}
          {message && <p className={`form-message${messageError ? ' form-message--error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
          </>}
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
