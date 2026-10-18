import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

// Nothing that changes data or shows internal data answers without a session. The operator account reaches only what
// the production panel uses: the OS files, the OS history, the machines and the labor services.
test('sensitive routes require a session, and the operator account reaches only the production data', async () => {
  const fixture = await createWorkflowFixture()
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
    const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
    const raw = (route, method = 'GET', headers = {}) => fetch(`${fixture.url}/api${route}`, { method, headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: method === 'GET' ? undefined : 'x' })
    const closed = [
      ['POST', '/offers'], ['PUT', `/offers/${offer.id}/resources`], ['POST', `/offers/${offer.id}/attachments?name=a.txt`], ['POST', `/offers/${offer.id}/proposal`],
      ['GET', `/offers/${offer.id}/proposal.pdf`], ['POST', `/offers/${offer.id}/accept`], ['GET', `/offers/${offer.id}/attachments/arquivo`],
      ['GET', '/proposal-settings'], ['GET', `/offers/${offer.id}/proposal-draft?model=model-a`], ['POST', `/offers/${offer.id}/proposal-document`],
      ['GET', '/fiscal/search?kind=cnae&q=usinagem'], ['GET', '/fiscal/status'], ['GET', '/machines'], ['GET', '/labor-services'],
      ['GET', '/employees'], ['GET', '/employees/1/activities'], ['GET', '/operations/orders/OS-1/events'],
      ['PUT', '/operations/orders/OS-1/stages'], ['POST', '/operations/orders/OS-1/interrupt'], ['POST', '/operations/orders/OS-1/acknowledge-completion'],
    ]
    for (const [method, route] of closed) assert.equal((await raw(route, method)).status, 401, `${method} ${route} without a session`)
    // The operator account: its production data opens; administrative routes stay closed.
    for (const route of ['/machines', '/labor-services']) assert.equal((await raw(route, 'GET', operator)).status, 200, `operator: ${route}`)
    assert.equal((await raw(`/offers/${offer.id}/attachments/arquivo`, 'GET', operator)).status, 404, 'operator reaches the OS files')
    assert.equal((await raw('/operations/orders/OS-1/events', 'GET', operator)).status, 404, 'operator reaches the OS history')
    for (const [method, route] of [['GET', '/employees'], ['POST', `/offers/${offer.id}/accept`], ['PUT', `/offers/${offer.id}/resources`], ['GET', `/offers/${offer.id}/proposal.pdf`], ['POST', '/operations/orders/OS-1/interrupt'], ['GET', '/proposal-settings']]) {
      assert.equal((await raw(route, method, operator)).status, 401, `operator: ${method} ${route}`)
    }
  } finally { await fixture.close() }
})
