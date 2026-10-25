import { useState } from 'react'
import { CalendarClock, CircleCheck } from 'lucide-react'
import { PayableModal } from './PayableModal.jsx'
import PayableForm from './PayableForm.jsx'
import { money, decimal, payableRequest } from './payablesApi.js'
import { formatQuantity } from '../server/materialUnits.js'
import './payables.css'

// Quantity that actually entered the stock: a stock entry or the opening balance of a new material.
export const purchasedQuantity = (item) => Number(item.stockEntryQuantity) > 0 ? Number(item.stockEntryQuantity) : item.id ? 0 : Number(item.quantity) || 0

// After material enters the stock, its purchase can go to the financial module: as a bill still to be paid
// (Contas a Pagar) or as a payment already made (Tesouraria). The account form opens filled with the purchase.
export default function StockPurchaseFinance({ purchase, onClose }) {
  const [mode, setMode] = useState(null), [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const quantity = Number(purchase.quantity) || 0, unitPrice = Number(purchase.unitPrice) || 0, totalCents = Math.round(quantity * unitPrice * 100)
  const amount = formatQuantity(quantity, purchase.unit)
  async function choose(next) {
    setBusy(true); setError('')
    try { setData(await payableRequest('/payables')); setMode(next) } catch (caught) { setError(caught.message) } finally { setBusy(false) }
  }
  if (mode) return <PayableForm treasury={mode === 'treasury'} single prefill={{ value: totalCents ? decimal(totalCents) : '', description: `Compra de material: ${purchase.name}${purchase.detail ? ` · ${purchase.detail}` : ''} (${amount})` }} suppliers={data.suppliers} classifications={data.classifications} orders={data.orders || []} items={data.items} onClose={onClose} onSaved={async () => onClose()} />
  return <PayableModal title="Lançar esta compra no financeiro?" busy={busy} onClose={onClose} footer={<button type="button" className="admin-tool-button" disabled={busy} onClick={onClose}>Não lançar agora</button>}>
    <p className="finance-choice-summary"><strong>{purchase.name}</strong>{purchase.detail ? ` · ${purchase.detail}` : ''} entrou no estoque: {amount}{totalCents ? <> × {money(Math.round(unitPrice * 100))} = <strong>{money(totalCents)}</strong></> : ''}.</p>
    <div className="finance-choice">
      <button type="button" disabled={busy} onClick={() => choose('payable')}><CalendarClock size={20} aria-hidden="true" /><span><strong>Conta a pagar</strong><small>A compra ainda será paga. Abre Contas a Pagar para informar fornecedor e vencimento.</small></span></button>
      <button type="button" disabled={busy} onClick={() => choose('treasury')}><CircleCheck size={20} aria-hidden="true" /><span><strong>Pagamento já realizado</strong><small>A compra já foi paga. Registra a saída na Tesouraria, já baixada.</small></span></button>
    </div>
    {error && <p className="admin-tool-error" role="alert">{error}</p>}
  </PayableModal>
}
