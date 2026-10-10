import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { makeInstallments, shiftMonth, todayBahia } from '../server/payableRules.js'

// Creates demonstration accounts through the same API used by the portal.
// Run without --apply to inspect the plan. Re-running resumes this batch.
const base = process.env.GMAC_API_URL || 'http://localhost:5174/api'
const start = '2026-10-10'
const end = '2026-12-31'
const prefix = 'DEMO-REC-2026Q4-'
const apply = process.argv.includes('--apply')
const reais = (valueCents) => (valueCents / 100).toFixed(2)
const dateAt = (days) => new Date(Date.parse(`${start}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
let token

async function api(route, method = 'GET', body) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('Retry-After')) || 60
      console.log(`Limite da API: aguardando ${seconds}s para continuar.`)
      await delay(seconds * 1000)
      continue
    }
    const data = await response.json()
    if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${data.message || JSON.stringify(data)}`)
    return data
  }
}

function plan(clients) {
  assert.ok(clients.length > 0, 'Cadastre um cliente antes de popular as contas.')
  const services = [
    'Corte e dobra de chapas', 'Usinagem de componentes', 'Soldagem de estruturas',
    'Manutenção de equipamentos', 'Fabricação de suportes metálicos',
    'Pintura de peças metálicas', 'Montagem de conjuntos', 'Reparo de componentes',
    'Fabricação de proteções metálicas', 'Serviços de caldeiraria',
  ]
  const drafts = []
  function common(index, tag, description) {
    return {
      clientId: clients[index % clients.length].id,
      description: `[DEMONSTRAÇÃO] ${description} · lote outubro–dezembro/2026`,
      documentNumber: `${prefix}${tag}`,
      issueDate: start,
    }
  }
  for (let i = 0; i < 60; i++) {
    drafts.push({ ...common(i, `AV-${String(i + 1).padStart(3, '0')}`, services[i % services.length]),
      kind: 'single', value: reais(48000 + ((i * 79193) % 1750000)), dueDate: dateAt(Math.round(i * 82 / 59)) })
  }
  for (let i = 0; i < 15; i++) {
    drafts.push({ ...common(i, `PAR-${String(i + 1).padStart(3, '0')}`, `${services[(i + 4) % services.length]} · pagamento em 3 parcelas`),
      kind: 'installment', count: 3, value: reais(450000 + i * 79317), dueDate: dateAt(i) })
  }
  for (let i = 0; i < 5; i++) {
    drafts.push({ ...common(i + 5, `MEN-${String(i + 1).padStart(3, '0')}`, 'Contrato mensal de manutenção preventiva'),
      kind: 'recurring', recurrence: 'monthly', ahead: 2, value: reais(220000 + i * 47329), dueDate: dateAt(1 + i * 4) })
  }
  return drafts
}

function expectedParts(draft) {
  const valueCents = Math.round(Number(draft.value) * 100)
  if (draft.kind === 'installment') return makeInstallments(valueCents, draft.dueDate, draft.count)
  if (draft.kind === 'recurring') return Array.from({ length: draft.ahead + 1 }, (_, i) => ({ valueCents, dueDate: shiftMonth(draft.dueDate, i) }))
  return [{ valueCents, dueDate: draft.dueDate }]
}

function verifyDraft(rows, draft) {
  const sorted = [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const parts = expectedParts(draft)
  assert.equal(sorted.length, parts.length, `Lote incompleto: ${draft.documentNumber}`)
  for (let i = 0; i < parts.length; i++) {
    assert.equal(sorted[i].dueDate, parts[i].dueDate)
    assert.equal(sorted[i].valueCents, parts[i].valueCents)
    assert.equal(sorted[i].issueDate, start)
    assert.equal(sorted[i].clientId, String(draft.clientId))
    assert.equal(sorted[i].description, draft.description)
    assert.equal(sorted[i].kind, draft.kind)
    assert.equal(sorted[i].inactive, false)
  }
}

try {
  assert.equal((await api('/health')).status, 'ok')
  assert.equal((await api('/auth/config')).testLoginEnabled, true, 'Este script usa somente o acesso de teste já habilitado.')
  token = (await api('/auth/login', 'POST', {})).token
  assert.ok(token, 'A API não retornou a sessão.')
  const before = await api('/receivables')
  const drafts = plan(before.clients)
  const documents = new Set(drafts.map((row) => row.documentNumber))
  const existing = before.items.filter((row) => documents.has(row.documentNumber))
  const previous = before.items.filter((row) => !documents.has(row.documentNumber))
  console.log(JSON.stringify({ apply, period: [start, end], planned: 120, single: 60, installment: 45, recurring: 15, received: 40, pending: 80, existingInBatch: existing.length, previousAccounts: previous.length }))
  if (apply) {
    assert.equal(todayBahia(), start, 'Confira a data do lote antes de executar as baixas de hoje.')
    let created = 0
    for (const draft of drafts) {
      let rows = existing.filter((row) => row.documentNumber === draft.documentNumber)
      if (!rows.length) {
        const response = await api('/receivables', 'POST', draft)
        rows = response.items || [response.item]
        created += rows.length
      }
      verifyDraft(rows, draft)
      if (created && created % 20 === 0) console.log(`Contas criadas nesta execução: ${created}`)
    }
    const all = (await api('/receivables')).items
    const batch = all.filter((row) => documents.has(row.documentNumber))
    assert.equal(batch.length, 120)
    // Keep both received and pending accounts visible in each month's filters.
    // Future maturities received today are explicitly identified as advances.
    const settled = [['2026-10', 20], ['2026-11', 10], ['2026-12', 10]].flatMap(([month, count]) =>
      batch.filter((row) => row.dueDate.startsWith(month)).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)).slice(0, count))
    const settledIds = new Set(settled.map((row) => row.id))
    for (const row of batch.filter((row) => row.receipt && !settledIds.has(row.id))) {
      await api(`/receivables/${row.id}/reverse`, 'POST', {
        reason: '[DEMONSTRAÇÃO] Ajuste da distribuição do lote para manter contas em aberto nos três meses.',
      })
    }
    const methods = ['pix', 'transfer', 'boleto', 'card', 'cash']
    for (const [i, row] of settled.entries()) {
      if (row.receipt) continue
      await api(`/receivables/${row.id}/receive`, 'POST', {
        date: start, method: methods[i % methods.length],
        note: row.dueDate > start ? '[DEMONSTRAÇÃO] Recebimento antecipado registrado em 10/10/2026.' : '[DEMONSTRAÇÃO] Recebimento no vencimento em 10/10/2026.',
      })
    }
    const final = (await api('/receivables')).items
    const rows = final.filter((row) => documents.has(row.documentNumber))
    const history = (await api('/receivables/history')).items
    assert.equal(rows.length, 120)
    assert.equal(rows.filter((row) => row.status === 'received').length, 40)
    assert.equal(rows.filter((row) => row.status === 'pending').length, 80)
    assert.equal(final.length, before.items.length + created)
    for (const old of previous) assert.deepEqual(final.find((row) => row.id === old.id), old, `Conta anterior alterada: ${old.id}`)
    for (const draft of drafts) verifyDraft(rows.filter((row) => row.documentNumber === draft.documentNumber), draft)
    for (const row of rows) {
      assert.ok(row.dueDate >= start && row.dueDate <= end)
      assert.ok(history.some((entry) => entry.accountId === row.id && entry.type === 'created'))
      if (row.receipt) {
        assert.equal(row.receipt.date, start)
        assert.equal(row.receipt.finalCents, row.valueCents)
        assert.ok(history.some((entry) => entry.accountId === row.id && entry.type === 'received'))
      }
    }
    const sum = (items) => reais(items.reduce((total, row) => total + row.valueCents, 0))
    console.log(JSON.stringify({ verified: true, created, batch: rows.length, received: 40, pending: 80,
      firstDueDate: [...rows.map((row) => row.dueDate)].sort()[0], lastDueDate: [...rows.map((row) => row.dueDate)].sort().at(-1),
      totalValue: sum(rows), receivedValue: sum(rows.filter((row) => row.receipt)), pendingValue: sum(rows.filter((row) => !row.receipt)),
      byMonth: ['2026-10', '2026-11', '2026-12'].map((month) => { const monthRows = rows.filter((row) => row.dueDate.startsWith(month)); return { month, total: monthRows.length, received: monthRows.filter((row) => row.receipt).length, pending: monthRows.filter((row) => !row.receipt).length } }),
      previousAccountsPreserved: previous.length,
    }, null, 2))
  }
} finally {
  if (token) await api('/auth/logout', 'POST')
}
