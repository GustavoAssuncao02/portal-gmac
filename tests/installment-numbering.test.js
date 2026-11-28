import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, shiftMonth, planNumbering, planNumbers } from '../server/payableRules.js'

// Numeração real (2026-11-28): a plan already running elsewhere (a DAS "parcela 54/188") is launched with the number of
// its first installment and the total of the agreement. Only the numbering changes; deleting one installment keeps the
// numbers of the others, and a plan already in progress (even with a settled installment) can be renumbered.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
const numbering = (rows) => rows.map((row) => [row.installmentNumber, row.installmentCount])

test('the rules: start and total of the agreement, the numbers kept with the gaps of removed installments', () => {
  assert.equal(planNumbering({}, 3), null, 'without the fields: 1..n of n')
  assert.equal(planNumbering({ installmentStart: '1', installmentTotal: '' }, 3), null)
  assert.deepEqual(planNumbering({ installmentStart: '54', installmentTotal: '188' }, 50), { start: 54, total: 188 })
  assert.deepEqual(planNumbering({ installmentStart: 54 }, 50), { start: 54, total: 103 }, 'the total follows the last one')
  assert.deepEqual(planNumbering({ installmentStart: 1, installmentTotal: 188 }, 50), { start: 1, total: 188 })
  assert.throws(() => planNumbering({ installmentStart: 0 }, 3), /primeira parcela/)
  assert.throws(() => planNumbering({ installmentStart: 54, installmentTotal: 100 }, 50), /pelo menos 103/)
  assert.deepEqual(planNumbers(3, null), { numbers: [1, 2, 3], total: 3, real: false })
  assert.deepEqual(planNumbers(3, { start: 54, total: 188 }), { numbers: [54, 55, 56], total: 188, real: true })
  const gaps = [{ installmentNumber: 54 }, { installmentNumber: 55 }, { installmentNumber: 57 }]
  assert.deepEqual(planNumbers(3, { start: 60, total: 188 }, gaps).numbers, [60, 61, 63], 'the same installments move together')
  assert.deepEqual(planNumbers(4, { start: 60, total: 188 }, gaps).numbers, [60, 61, 62, 63], 'a new structure is numbered in sequence')
  assert.throws(() => planNumbers(3, { start: 54, total: 56 }, gaps), /pelo menos 57/)
})

test('Contas a Pagar and Contas a Receber: real numbering on launch, on delete and on a plan already in progress', async (t) => {
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const request = (route, method, body) => f.request(route, method, body, { Authorization: `Bearer ${token}` })
  const today = todayBahia(), first = shiftMonth(today, 1)
  const supplier = (await request('/suppliers', 'POST', { name: 'Receita Federal', document: '00394460000141' })).data.item
  const classification = (await request('/classifications', 'POST', { name: 'Impostos parcelados' })).data.item
  const das = { supplierId: supplier.id, classificationId: classification.id, description: 'DAS do Parcelamento RELPSN nº 9131', issueDate: today, value: '300.00', dueDate: first, kind: 'installment', count: 3, allowDuplicate: true }

  // Launched as the installments 54 to 56 of 188.
  assert.equal((await request('/payables', 'POST', { ...das, installmentStart: 54, installmentTotal: 100 })).status, 201, 'a total above the last one is fine')
  const small = await request('/payables', 'POST', { ...das, installmentStart: 54, installmentTotal: 55 })
  assert.deepEqual([small.status, small.data.message], [400, 'O total de parcelas do acordo deve ser de pelo menos 56.'])
  const created = (await request('/payables', 'POST', { ...das, documentNumber: 'DAS 07.18', installmentStart: 54, installmentTotal: 188 })).data.items
  assert.deepEqual(numbering(created), [[54, 188], [55, 188], [56, 188]])
  assert.ok(created.every((row) => row.realNumbering === true && row.originalTotalCents === 30000))
  const plain = (await request('/payables', 'POST', { ...das, documentNumber: 'Plano comum' })).data.items
  assert.deepEqual(numbering(plain), [[1, 3], [2, 3], [3, 3]])
  assert.ok(plain.every((row) => row.realNumbering === false))

  // Deleting one: the real numbers stay (the 56 is still the 56); a plain plan is numbered again, as before.
  assert.equal((await request(`/payables/${created[1].id}`, 'DELETE')).status, 200)
  let rows = (await request(`/payables/${created[0].id}`)).data.siblings.sort((a, b) => a.installmentNumber - b.installmentNumber)
  assert.deepEqual(numbering(rows), [[54, 188], [56, 188]])
  assert.ok(rows.every((row) => row.originalTotalCents === 20000), 'the value of the installments launched')
  await request(`/payables/${plain[1].id}`, 'DELETE')
  rows = (await request(`/payables/${plain[0].id}`)).data.siblings.sort((a, b) => a.installmentNumber - b.installmentNumber)
  assert.deepEqual(numbering(rows), [[1, 2], [2, 2]])

  // A plan launched before as 1..3 and already with a payment: renumbered as 10..12 of 20, values and dates kept.
  const running = (await request('/payables', 'POST', { ...das, documentNumber: 'Em andamento' })).data.items
  assert.equal((await request(`/payables/${running[0].id}/pay`, 'POST', { date: today, method: 'pix' })).status, 200)
  const body = { ...das, documentNumber: 'Em andamento', dueDate: running[1].dueDate, installments: running.map((row) => ({ value: (row.valueCents / 100).toFixed(2), dueDate: row.dueDate })) }
  const renumbered = await request(`/payables/${running[1].id}`, 'PUT', { ...body, installmentStart: 10, installmentTotal: 20 })
  assert.equal(renumbered.status, 200, renumbered.data.message)
  rows = (await request(`/payables/${running[0].id}`)).data.siblings.sort((a, b) => a.installmentNumber - b.installmentNumber)
  assert.deepEqual(rows.map((row) => [row.id, row.installmentNumber, row.installmentCount, row.valueCents, Boolean(row.payment)]), running.map((row, index) => [row.id, 10 + index, 20, row.valueCents, index === 0]))
  // An edit from an older screen (without the fields) keeps the numbering.
  assert.equal((await request(`/payables/${running[1].id}`, 'PUT', { ...body, description: 'DAS RELPSN' })).status, 200)
  rows = (await request(`/payables/${running[0].id}`)).data.siblings
  assert.deepEqual(numbering(rows).sort((a, b) => a[0] - b[0]), [[10, 20], [11, 20], [12, 20]])

  // Contas a Receber: the same rules.
  const base = { customerName: 'Cliente Exemplo Ltda', customerDocument: '11222333000181', description: 'Acordo em andamento', documentNumber: 'ACORDO 7', value: '200.00', dueDate: first, kind: 'installment', count: 2, allowDuplicate: true }
  const receivables = (await request('/receivables', 'POST', { ...base, installmentStart: 5, installmentTotal: 10 })).data.items
  assert.deepEqual(numbering(receivables), [[5, 10], [6, 10]])
  const history = (await request(`/receivables/${receivables[0].id}`)).data.history
  assert.match(JSON.stringify(history), /Parcela 5 de 10/)
  assert.equal((await request(`/receivables/${receivables[0].id}/receive`, 'POST', { date: today, method: 'pix' })).status, 200)
  const again = await request(`/receivables/${receivables[1].id}`, 'PUT', { ...base, dueDate: receivables[1].dueDate, installments: receivables.map((row) => ({ value: (row.valueCents / 100).toFixed(2), dueDate: row.dueDate })), installmentStart: 7, installmentTotal: 12 })
  assert.equal(again.status, 200, again.data.message)
  rows = (await request(`/receivables/${receivables[0].id}`)).data.siblings
  assert.deepEqual(numbering(rows), [[7, 12], [8, 12]])
  const plainReceivables = (await request('/receivables', 'POST', { ...base, documentNumber: 'ACORDO 8', count: 3 })).data.items
  assert.equal((await request(`/receivables/${plainReceivables[0].id}?scope=one`, 'DELETE')).status, 200)
  rows = (await request(`/receivables/${plainReceivables[1].id}`)).data.siblings
  assert.deepEqual(numbering(rows), [[1, 2], [2, 2]], 'a plain plan is numbered again')
})
