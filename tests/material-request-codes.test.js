import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { assignMaterialRequestCodes, nextMaterialRequestCode } from '../server/materialRequestCodes.js'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }

test('existing requests receive permanent codes in chronological order, sharing the manual sequence', () => {
  const store = {
    manualMaterialRequests: [{ id: 'manual-1', code: 'PM-2026-0001' }],
    offers: [{ id: 'offer-1', status: 'accepted', requestedAt: '2026-10-01T10:00:00Z', resources: { materials: [
      { id: 'late', quantity: 5, purchaseQuantity: 5, requestedAt: '2026-10-03T10:00:00Z' },
      { id: 'early', quantity: 2, purchaseQuantity: 2, requestedAt: '2026-10-02T10:00:00Z' },
      { id: 'in-stock', quantity: 2, purchaseQuantity: 0 },
      { id: 'received', quantity: 2, purchaseQuantity: 0, requestReceipt: { id: 'r' } },
    ] } }, { id: 'rejected-offer', status: 'rejected', resources: { materials: [{ id: 'x', quantity: 1, purchaseQuantity: 1 }] } }],
    orders: [],
  }
  assignMaterialRequestCodes(store)
  assert.deepEqual(store.materialRequestCodes, { 'offer-1-received': 'PM-2026-0002', 'offer-1-early': 'PM-2026-0003', 'offer-1-late': 'PM-2026-0004' })
  store.offers[0].resources.materials[0].purchaseQuantity = 0
  assignMaterialRequestCodes(store)
  assert.equal(store.materialRequestCodes['offer-1-late'], 'PM-2026-0004', 'codes never change')
  assert.equal(nextMaterialRequestCode(store, '2026-12-31T12:00:00Z'), 'PM-2026-0005')
})

test('the material requests API returns a code for offer/OS requests and keeps the sequence for manual ones', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const login = (await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data
    const headers = { Authorization: `Bearer ${login.token}` }
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    await fixture.mutateStore((store) => { store.offers[0].resources = { materials: [{ id: 'inox', name: 'Inox 304', quantity: 10, purchaseQuantity: 10 }] } })
    const listed = await fixture.request('/material-requests', 'GET', undefined, headers)
    assert.equal(listed.status, 200)
    const code = listed.data.codes[`${offer.id}-inox`]
    assert.match(code, /^PM-\d{4}-0001$/)
    const manual = (await fixture.request('/material-requests', 'POST', { name: 'Titanio', detail: '', quantity: 1 }, headers)).data.item
    assert.equal(manual.code, code.replace(/0001$/, '0002'))
    assert.equal((await fixture.request('/material-requests', 'GET', undefined, headers)).data.codes[`${offer.id}-inox`], code)
  } finally { await fixture.close() }
})
