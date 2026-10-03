export const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const decimal = (cents) => (Number(cents || 0) / 100).toFixed(2)
export const dateLabel = (value) => value ? value.split('-').reverse().join('/') : ''
export async function payableRequest(route, method = 'GET', body) {
  const response = await fetch(`/api${route}`, { method, headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Não foi possível concluir a operação.')
  return result
}
export async function uploadPayableFiles(files, accountId) {
  const ids = []
  for (const file of files) {
    const response = await fetch(`/api/payables/${accountId ? `${accountId}/files` : 'uploads'}?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/octet-stream' }, body: file })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Falha ao enviar arquivo.')
    ids.push(result.item.id)
  }
  return ids
}
export async function downloadPayables(body) {
  const response = await fetch('/api/payables/export', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json()).message || 'Falha ao exportar.')
  downloadBlob(await response.blob(), `gmac-${body.id || 'contas-a-pagar'}.${body.format}`)
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function downloadPayableFile(accountId, file) {
  const response = await fetch(`/api/payables/${accountId}/files/${file.id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('gmac-admin-token') || ''}` } })
  if (!response.ok) throw new Error('Não foi possível baixar o arquivo.')
  downloadBlob(await response.blob(), file.name)
}
