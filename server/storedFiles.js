import { stat } from 'node:fs/promises'
import path from 'node:path'

// Every file the portal keeps in the data folder (DATA_DIR), by area, with where it shows in the portal and when it was
// sent (when the record keeps it). The records live in MySQL and only the files live on the disk: a data folder lost on
// a redeploy leaves records whose document no longer opens.
export function storedFileInventory(store, dataDirectory) {
  const folder = (name) => path.join(dataDirectory, name)
  const sentAt = (events, accountId, name) => (events || []).findLast((item) => item.type === 'attachment_added' && item.accountId === accountId && item.details?.name === name)?.at || null
  const accountFiles = (rows, events, settlement) => (rows || []).flatMap((row) => [...(row.attachments || []), ...(row[settlement]?.receipts || [])].map((file) => ({ id: file.id, name: file.name, where: row.id, at: sentAt(events, row.id, file.name) })))
  const orders = [...(store.orders || []), ...(store.cancelledOrders || [])]
  const offerFiles = new Map()
  for (const offer of store.offers || []) {
    for (const file of offer.attachments || []) offerFiles.set(file.id, { id: file.id, name: file.name, where: offer.code || offer.id, at: offer.createdAt || null })
    for (const email of offer.proposalEmails || []) for (const file of email.attachments || []) offerFiles.set(file.id, { id: file.id, name: file.name, where: `${offer.code || offer.id} (e-mail da proposta)`, at: email.sentAt || null })
  }
  for (const order of orders) {
    for (const file of order.attachments || []) if (!offerFiles.has(file.id)) offerFiles.set(file.id, { id: file.id, name: file.name, where: order.code, at: order.createdAt || null })
    for (const file of order.purchaseOrders || []) offerFiles.set(file.id, { id: file.id, name: file.name, where: `${order.code} (pedido de compra)`, at: file.uploadedAt || null })
  }
  const withPath = (directory, files, fileName = (file) => file.id) => files.map((file) => ({ ...file, path: path.join(directory, fileName(file)) }))
  return [
    { label: 'Contas a Pagar e Tesouraria', files: withPath(folder('payable-files'), accountFiles(store.payables, store.payableEvents, 'payment')) },
    { label: 'Contas a Receber', files: withPath(folder('receivable-files'), accountFiles(store.receivables, store.receivableEvents, 'receipt')) },
    { label: 'Ajustes da DRE', files: withPath(folder('dre-adjustment-files'), (store.dreAdjustments || []).flatMap((row) => (row.attachments || []).map((file) => ({ id: file.id, name: file.name, where: row.id, at: null })))) },
    { label: 'Ofertas e OS', files: withPath(folder('files'), [...offerFiles.values()]) },
    { label: 'Tickets de suporte', files: withPath(folder('support-ticket-files'), (store.supportTickets || []).flatMap((row) => (row.attachments || []).map((file) => ({ id: file.id, name: file.name, where: row.id, at: file.uploadedAt || row.createdAt || null })))) },
    // Only a copy of the imported statement: its transactions are in the database and the reconciliation does not read it.
    { label: 'Extratos OFX importados', files: withPath(folder('bank-statements'), (store.bankImports || []).map((row) => ({ id: row.id, name: row.fileName, where: 'Conciliação bancária', at: row.importedAt || null })), (file) => `${file.id}.ofx`) },
  ]
}

// The files of each area whose record exists and whose document is not on the disk.
export async function missingStoredFiles(areas) {
  const result = []
  for (const { label, files } of areas) {
    const missing = []
    for (const file of files) { try { await stat(file.path) } catch { missing.push(file) } }
    result.push({ label, total: files.length, missing })
  }
  return result
}

const dateLabel = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : 'data não registrada'
// Log lines of the start-up check: one summary per area and, for each missing document, where it is and when it was sent.
export function missingFilesReport(areas) {
  return areas.flatMap(({ label, total, missing }) => missing.length
    ? [`ATENCAO: ${missing.length} de ${total} arquivos de ${label} estão sem o documento no disco:`, ...missing.map((file) => `  - ${file.where} · ${file.name} · enviado em ${dateLabel(file.at)}`)]
    : [`Arquivos de ${label}: ${total} com o documento no disco.`])
}
