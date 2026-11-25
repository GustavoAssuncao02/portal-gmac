import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { todayBahia, splitPartial, mergeDivision } from '../server/payableRules.js'

// Baixa parcial (TCK-0011): the account stays open with the balance and each partial payment becomes its own paid account,
// linked to it. Interest and discount only come with the final settlement; the ISS of a receivable leaves with a partial
// receipt or with the last one, as the user chooses; reversing a partial payment gives the value back to the balance.
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
async function setup(t) {
  const f = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => f.close())
  const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
  const headers = { Authorization: `Bearer ${token}` }
  return { f, request: (route, method, body) => f.request(route, method, body, headers) }
}

test('the division between classifications follows the part paid and adds up exactly', () => {
  const row = { valueCents: 100000, classificationSplit: [{ classificationId: 'a', classificationName: 'Energia', valueCents: 60000 }, { classificationId: 'b', classificationName: 'Água', valueCents: 40000 }] }
  const { paid, balance } = splitPartial(row, 33333)
  assert.equal(paid.reduce((sum, part) => sum + part.valueCents, 0), 33333)
  assert.equal(balance.reduce((sum, part) => sum + part.valueCents, 0), 66667)
  for (const id of ['a', 'b']) assert.equal(paid.find((part) => part.classificationId === id).valueCents + balance.find((part) => part.classificationId === id).valueCents, row.classificationSplit.find((part) => part.classificationId === id).valueCents)
  assert.deepEqual(splitPartial({ valueCents: 500 }, 100), { paid: null, balance: null })
  const merged = mergeDivision({ valueCents: 66667, classificationSplit: balance }, { valueCents: 33333, classificationSplit: paid })
  assert.deepEqual(merged.map((part) => [part.classificationId, part.valueCents]), [['a', 60000], ['b', 40000]])
  assert.equal(mergeDivision({ valueCents: 1, classificationId: 'a' }, { valueCents: 1, classificationId: 'a' }), null)
})

test('payables: a partial payment keeps the balance open, links the paid part and can be reversed', async (t) => {
  const { f, request } = await setup(t)
  const today = todayBahia()
  await f.mutateStore((store) => {
    store.payables = [{ id: 'PAG-000001', supplierId: null, supplierName: 'Fornecedor Exemplo', classificationId: 'a', classificationName: 'Energia + Água', classificationSplit: [{ classificationId: 'a', classificationName: 'Energia', valueCents: 60000 }, { classificationId: 'b', classificationName: 'Água', valueCents: 40000 }], description: 'Compra', documentNumber: 'NF1', issueDate: '2026-11-01', dueDate: '2027-01-31', valueCents: 100000, originalTotalCents: 100000, kind: 'normal', inactive: false, payment: null, attachments: [], createdAt: '2026-11-01T12:00:00.000Z', lastStatus: 'pending', orderCode: null }]
    store.payableSequence = 1
  })
  const pay = { date: today, method: 'pix', paid: '400.00', balanceDueDate: '2027-02-15', note: 'Primeira parte', interest: '9.00', discount: '' }
  assert.equal((await request('/payables/PAG-000001/partial', 'POST', { ...pay, paid: '1000.00' })).status, 400, 'paying all is the total settlement')
  assert.equal((await request('/payables/PAG-000001/partial', 'POST', { ...pay, paid: '0' })).status, 400)
  assert.equal((await request('/payables/PAG-000001/partial', 'POST', { ...pay, balanceDueDate: '2027-02-30' })).status, 400)
  assert.equal((await request('/payables/PAG-000001/partial', 'POST', { ...pay, date: '2999-01-01' })).status, 400, 'no future date')

  const first = await request('/payables/PAG-000001/partial', 'POST', pay)
  assert.equal(first.status, 201)
  const { item: parent, partial: part } = first.data
  assert.equal(parent.valueCents, 60000)
  assert.equal(parent.fullValueCents, 100000)
  assert.equal(parent.partialPaidCents, 40000)
  assert.equal(parent.dueDate, '2027-02-15')
  assert.equal(parent.status, 'pending')
  assert.deepEqual(parent.classificationSplit.map((item) => item.valueCents), [36000, 24000])
  assert.equal(part.id, 'PAG-000002')
  assert.equal(part.partialOf, 'PAG-000001')
  assert.equal(part.valueCents, 40000)
  assert.equal(part.status, 'paid')
  assert.equal(part.payment.finalCents, 40000)
  assert.equal(part.payment.interestCents, 0, 'interest is for the final settlement')
  assert.deepEqual(part.classificationSplit.map((item) => item.valueCents), [24000, 16000])

  const details = (await request('/payables/PAG-000001')).data
  assert.deepEqual(details.partials.map((item) => item.id), ['PAG-000002'])
  assert.equal(details.canDelete, false)
  assert.match(details.deleteBlock, /baixa parcial/)
  assert.equal((await request('/payables/PAG-000001', 'PUT', {})).status, 409, 'an account with partial payments is not edited')
  assert.equal((await request('/payables/PAG-000002/partial', 'POST', pay)).status, 409, 'a paid account takes no partial payment')

  const second = await request('/payables/PAG-000001/partial', 'POST', { ...pay, paid: '100.00', balanceDueDate: '2027-03-10' })
  assert.equal(second.data.item.valueCents, 50000)
  assert.equal(second.data.item.dueDate, '2027-03-10')
  assert.deepEqual(second.data.item.partialIds, ['PAG-000002', 'PAG-000003'])

  // Reversing the second partial payment gives its value (and its classification parts) back to the balance.
  assert.equal((await request('/payables/PAG-000003/reverse', 'POST', { reason: 'curto' })).status, 400)
  const reversed = await request('/payables/PAG-000003/reverse', 'POST', { reason: 'Pagamento lançado por engano' })
  assert.equal(reversed.status, 200)
  assert.equal(reversed.data.item.id, 'PAG-000001')
  assert.equal(reversed.data.item.valueCents, 60000)
  assert.deepEqual(reversed.data.item.classificationSplit.map((item) => [item.classificationId, item.valueCents]), [['a', 36000], ['b', 24000]])
  assert.deepEqual(reversed.data.item.partialIds, ['PAG-000002'])
  assert.equal((await request('/payables/PAG-000003')).status, 404, 'the partial record leaves the lists')
  const history = (await request('/payables/history')).data.items
  assert.ok(history.some((event) => event.accountId === 'PAG-000003' && event.type === 'reversed'), 'its history stays')
  assert.ok(history.some((event) => event.accountId === 'PAG-000001' && event.type === 'partial_reversed'))

  // The final settlement closes the account; while it stands, the partial payments cannot be reversed.
  const final = await request('/payables/PAG-000001/pay', 'POST', { date: today, method: 'pix', interest: '3.00' })
  assert.equal(final.status, 200)
  assert.equal(final.data.item.payment.finalCents, 60300)
  assert.equal((await request('/payables/PAG-000002/reverse', 'POST', { reason: 'Estorno de teste' })).status, 409)
  assert.equal((await request('/payables/PAG-000001/reverse', 'POST', { reason: 'Estorno da baixa final' })).status, 200)
  const back = await request('/payables/PAG-000002/reverse', 'POST', { reason: 'Estorno da parcial' })
  assert.equal(back.status, 200)
  assert.equal(back.data.item.valueCents, 100000)
  assert.equal(back.data.item.partialPaidCents, undefined)
  assert.deepEqual(back.data.item.classificationSplit.map((item) => item.valueCents), [60000, 40000])
  assert.equal((await request('/payables/PAG-000001', 'DELETE')).status, 200, 'with no partial payment left the account can be deleted again')
})

test('receivables: the ISS leaves with a partial receipt or with the last one, as the user chooses', async (t) => {
  const { f, request } = await setup(t)
  const today = todayBahia()
  await f.mutateStore((store) => {
    // R$ 1.575,00 with R$ 75,00 of ISS withheld by the customer.
    store.receivables = [{ id: 'REC-000001', origin: 'manual', kind: 'single', customerName: 'Cliente Exemplo', customerDocument: null, classificationId: null, description: '', documentNumber: 'NF9', issueDate: '2026-11-01', dueDate: '2027-01-31', valueCents: 157500, originalTotalCents: 157500, issCents: 7500, receipt: null, inactive: false, attachments: [], createdAt: '2026-11-01T12:00:00.000Z', lastStatus: 'pending' }]
    store.receivableSequence = 1
  })
  const body = { date: today, method: 'pix', received: '500.00', issMode: 'last', balanceDueDate: '2027-02-28', interest: '5.00' }
  assert.equal((await request('/receivables/REC-000001/partial', 'POST', { ...body, issMode: 'maybe' })).status, 400)
  assert.equal((await request('/receivables/REC-000001/partial', 'POST', { ...body, received: '1500.00' })).status, 400, 'with the ISS still to come this would leave nothing to receive')

  // ISS with the last receipt: this one leaves the ISS in the balance.
  const first = await request('/receivables/REC-000001/partial', 'POST', body)
  assert.equal(first.status, 201)
  assert.equal(first.data.partial.id, 'REC-000002')
  assert.equal(first.data.partial.valueCents, 50000)
  assert.equal(first.data.partial.issCents, 0)
  assert.equal(first.data.partial.receipt.finalCents, 50000)
  assert.equal(first.data.partial.receipt.interestCents, 0)
  assert.equal(first.data.item.valueCents, 107500)
  assert.equal(first.data.item.issCents, 7500)
  assert.equal(first.data.item.dueDate, '2027-02-28')
  assert.equal(first.data.item.fullValueCents, 157500)

  // ISS in this receipt: the whole ISS leaves now, the balance has none.
  const second = await request('/receivables/REC-000001/partial', 'POST', { ...body, received: '300.00', issMode: 'now' })
  assert.equal(second.status, 201)
  assert.equal(second.data.partial.valueCents, 37500)
  assert.equal(second.data.partial.issCents, 7500)
  assert.equal(second.data.partial.receipt.issCents, 7500)
  assert.equal(second.data.partial.receipt.finalCents, 30000)
  assert.equal(second.data.item.valueCents, 70000)
  assert.equal(second.data.item.issCents, 0)
  assert.equal(second.data.item.fullIssCents, 7500)
  assert.equal((await request('/receivables/REC-000001/partial', 'POST', { ...body, received: '700.00', issMode: 'now' })).status, 400)
  assert.equal((await request('/receivables/REC-000001')).data.canDelete, false)

  // Undoing the receipt that took the ISS gives the ISS back to the balance.
  const undone = await request('/receivables/REC-000003/reverse', 'POST', { reason: 'Recebimento lançado por engano' })
  assert.equal(undone.status, 200)
  assert.equal(undone.data.item.valueCents, 107500)
  assert.equal(undone.data.item.issCents, 7500)
  assert.deepEqual(undone.data.item.partialIds, ['REC-000002'])
  assert.equal((await request('/receivables/REC-000003')).status, 404)

  // The last receipt closes the account (the ISS still to come leaves with it).
  const final = await request('/receivables/REC-000001/receive', 'POST', { date: today, method: 'pix', iss: '75.00' })
  assert.equal(final.status, 200)
  assert.equal(final.data.item.receipt.finalCents, 100000)
  assert.equal((await request('/receivables/REC-000002/reverse', 'POST', { reason: 'Estorno de teste' })).status, 409)
  assert.equal((await request('/receivables/REC-000001/reverse', 'POST', { reason: 'Estorno do recebimento final' })).status, 200)
  const all = await request('/receivables/REC-000002/reverse', 'POST', { reason: 'Estorno do parcial' })
  assert.equal(all.data.item.valueCents, 157500)
  assert.equal(all.data.item.partialPaidCents, undefined)
  const totals = await f.mutateStore((store) => ({ rows: store.receivables.length, value: store.receivables.reduce((sum, row) => sum + row.valueCents, 0) }))
  assert.deepEqual(totals, { rows: 1, value: 157500 })
})
