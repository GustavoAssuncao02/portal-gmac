import { useSavedState } from './savedListState.js'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, TriangleAlert } from 'lucide-react'
import { pendingOrderMaterials } from '../server/pendingMaterials.js'
import { formatQuantity } from '../server/materialUnits.js'
import { labelQuotePending, labelQuotePendingText } from '../server/labelQuoteRules.js'
import { todayBahia } from '../server/payableRules.js'
import { missingPurchaseInfo } from './purchaseOrders.js'
import { isEmergency } from './serviceProgress.js'
import { byLongestWait, invoiceWait } from './invoiceWaiting.js'

const completedLabel = (order) => {
  const at = Date.parse(order.operation.completedAt)
  return Number.isFinite(at) ? new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }) : '—'
}

// The block "Aguardando NF-e" at the end of Serviços em andamento (src/invoiceWaiting.js): the OS whose production is
// finished, with only what the invoicing needs: when it was completed, how long it has been waiting, what is still
// missing (purchase order, nota de entrada, material, the quote of an etiqueta) and the same green button as before,
// which schedules the receivable and takes the OS out of the panel. `open` and `onToggle`: the block can be collapsed.
export default function InvoiceWaitingBlock({ orders, now, open, onToggle, onSelectOrder, onCompletedStatus, onMaterialAlert }) {
  const today = todayBahia(new Date(now))
  // Without a title chosen, the one waiting longest first; numbers and dates start from the largest, text from A.
  const [sort, setSort] = useSavedState('services-panel', 'invoice-sort', null)
  const values = { code: (order) => order.code, company: (order) => order.company || '', completion: (order) => Date.parse(order.operation.completedAt) || 0, waiting: (order) => invoiceWait(order, today)?.days ?? -1 }
  const sortBy = (key) => setSort((current) => ({ key, direction: current?.key === key ? -current.direction : key === 'company' ? 1 : -1 }))
  const rows = sort ? [...orders].sort((left, right) => { const a = values[sort.key](left), b = values[sort.key](right); return sort.direction * (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true })) || left.code.localeCompare(right.code, 'pt-BR', { numeric: true }) }) : byLongestWait(orders)
  const header = (label, key) => <th key={label} aria-sort={sort?.key === key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button className="admin-os-sort" type="button" onClick={() => sortBy(key)}>{label}{sort?.key !== key ? <ArrowUpDown size={13} aria-hidden="true" /> : sort.direction === 1 ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}</button></th>
  return <section className={`admin-invoice-block${open ? '' : ' admin-invoice-block--closed'}`} aria-labelledby="admin-invoice-title">
    <button className="admin-invoice-heading" type="button" aria-expanded={open} aria-controls="admin-invoice-list" onClick={onToggle}>
      <ChevronDown className="admin-invoice-chevron" size={18} aria-hidden="true" />
      <span className="admin-invoice-title" id="admin-invoice-title">Aguardando NF-e</span><strong>{orders.length}</strong>
      <small>Produção concluída: programe o recebimento quando a NF-e for emitida.</small>
      <span className="admin-invoice-toggle-text">{open ? 'Recolher' : 'Mostrar'}</span>
    </button>
    {open && <div className="admin-invoice-wrap" id="admin-invoice-list">{rows.length ? <table className="admin-invoice-table"><thead><tr>{header('OS / Serviço', 'code')}{header('Cliente', 'company')}{header('Concluída em', 'completion')}{header('Esperando', 'waiting')}<th>Pendências</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{rows.map((order) => {
      const wait = invoiceWait(order, today)
      const materials = pendingOrderMaterials(order)
      const missing = missingPurchaseInfo(order)
      const quote = labelQuotePending(order)
      return <tr key={order.code} className={isEmergency(order) ? 'admin-invoice-row--emergency' : undefined}>
        <td><strong>{order.service}</strong><small>{order.code}{order.labelNumber ? ` · Etiqueta ${order.labelNumber}` : ''}{isEmergency(order) && <> · <span className="os-emergency-label">Emergencial</span></>}</small></td>
        <td data-label="Cliente">{order.company}</td>
        <td data-label="Concluída em">{completedLabel(order)}</td>
        <td data-label="Esperando">{wait ? <span className={`admin-invoice-wait admin-invoice-wait--${wait.tone}`}>{wait.label}</span> : '—'}</td>
        <td data-label="Pendências">{materials.length || missing.length || quote ? <span className="admin-invoice-pending">
          {quote && <span className="admin-invoice-quote">{labelQuotePendingText}</span>}
          {materials.length > 0 && <button type="button" className="admin-os-material-alert" title={materials.map((material) => `${material.name}: ${formatQuantity(material.quantity, material.unit)} pendentes`).join('; ')} onClick={() => onMaterialAlert(order.code)}><TriangleAlert size={15} aria-hidden="true" />Material pendente</button>}
          {missing.length > 0 && <span className="admin-os-po-missing" title={`Falta informar ${missing.join(' e ')}: informe em Ver OS.`}>{missing.map((item) => <span key={item}>Sem {item}</span>)}</span>}
        </span> : '—'}</td>
        <td className="admin-invoice-actions"><button className="admin-os-status admin-os-status--completed" type="button" aria-label="Aguardando NF-e" title="Programar o recebimento e retirar do painel" aria-haspopup="dialog" onClick={() => onCompletedStatus(order.code)}>Aguardando NF-e</button><button type="button" className="admin-invoice-open" onClick={() => onSelectOrder(order.code)}>Ver OS</button></td>
      </tr>
    })}</tbody></table> : <p className="admin-os-empty">Nenhuma OS aguardando NF-e.</p>}</div>}
  </section>
}
