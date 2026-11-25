// The client's documents of an OS: the "Nº do pedido de compra", the "Nota de entrada" and the files kept in "Anexos
// administrativos". Used by the acceptance of an offer, by Ver OS and by Serviços em andamento.
const authHeaders = () => { const token = window.sessionStorage.getItem('gmac-admin-token'); return token ? { Authorization: `Bearer ${token}` } : {} }
const check = async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Não foi possível concluir a operação.'); return response }
const base = (code) => `/api/orders/${encodeURIComponent(code)}`

export async function uploadPurchaseOrders(code, files) {
  for (const file of files) await check(await fetch(`${base(code)}/purchase-orders?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' }, body: file }))
}

// { purchaseOrderNumber, entryInvoiceNumber }: a field left out is not touched, an empty one is removed.
export async function savePurchaseInfo(code, fields) {
  return (await (await check(await fetch(`${base(code)}/purchase-info`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }))).json()).item
}

// What is still missing on an OS, for the discreet mark of Serviços em andamento.
export function missingPurchaseInfo(order) {
  const missing = []
  if (!String(order?.purchaseOrderNumber ?? '').trim()) missing.push('pedido de compra')
  if (!String(order?.entryInvoiceNumber ?? '').trim()) missing.push('nota de entrada')
  return missing
}
