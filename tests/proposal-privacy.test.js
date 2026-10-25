import assert from 'node:assert/strict'
import test from 'node:test'
import { proposalSections } from '../server/offers.js'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

const offer = { code: 'OF-2026-0001', service: 'Estrutura', company: 'Cliente', cnpj: '12345678000190', labelNumber: 'E1', quantity: 5, deadline: '2026-12-20', description: 'Descrição' }
const resources = { materials: [{ name: 'Chapa', detail: '10 mm', quantity: 20, unitPrice: 12.5 }], laborEntries: [{ resource: 'Torno', hours: 3, hourlyRate: 80 }], stages: ['cutting'], kind: 'service' }
const proposal = { key: 'A', title: 'Opção A', deadline: '2026-12-20', serviceValue: 5000, materials: 250, labor: 240, margin: 37.77, discount: 3, profit: 4510.55, machine: '3 horas', serviceTime: '3 horas', stages: ['cutting'], kind: 'service' }

test('the customer proposal never shows margin, profit, costs or unit prices', () => {
  const sections = proposalSections(offer, proposal, resources)
  const labels = sections.flatMap((section) => section.columns)
  assert.ok(!labels.some((label) => /margem|lucro|valor\/|total|\(R\$\)/i.test(label.replace(/^Valor do serviço$/, ''))), labels.join(', '))
  // No cell may carry a margin, profit, cost total or unit price (checked as exact numbers, not as text).
  const numbers = sections.flatMap((section) => section.rows.flat()).filter((value) => typeof value === 'number')
  for (const hidden of [37.77, 4510.55, 250, 240, 12.5, 80, 250.5]) assert.ok(!numbers.includes(hidden), `${hidden} must not be present`)
  // Materials and labor are listed by name, specification, quantity and hours only.
  assert.deepEqual(sections.find((section) => section.name === 'Materiais necessários').rows, [['Chapa', '10 mm', 20, 'kg']])
  assert.deepEqual(sections.find((section) => section.name === 'Mão de obra').rows, [['Torno', 3]])
  // Commercial conditions that the customer needs are still there.
  const conditions = sections.find((section) => section.name === 'Condições da proposta')
  assert.deepEqual(conditions.columns, ['Opção', 'Prazo de entrega', 'Valor do serviço', 'Desconto (%)', 'Tempo de máquina', 'Tempo de serviço'])
})

test('the proposal PDF is always built from the saved proposal, so old stored files are never sent', async (t) => {
  const fixture = await createWorkflowFixture()
  t.after(() => fixture.close())
  const created = (await fixture.adminRequest('/offers', 'POST', offerDraft)).data.item
  await fixture.adminRequest(`/offers/${created.id}/resources`, 'PUT', { materials: [], laborEntries: [], stages: ['cutting'], kind: 'service' })
  const generated = await fixture.adminRequest(`/offers/${created.id}/proposal`, 'POST', { layout: 'executive', proposal: { key: 'A', title: 'Opção A', deadline: offerDraft.deadline, serviceValue: 100, margin: 37.77, profit: 4510.55 } })
  assert.equal(generated.status, 200)
  assert.equal(generated.data.item.proposal.pdfId, undefined, 'no PDF file is stored')
  // A file stored by an earlier version (with the margin) is ignored even if it is still referenced.
  await fixture.mutateStore((store) => { store.offers[0].proposal.pdfId = 'legacy-file-with-margin' })
  const first = await fetch(`${fixture.url}/api/offers/${created.id}/proposal.pdf`, { headers: fixture.admin })
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('content-type'), 'application/pdf')
  const bytes = Buffer.from(await first.arrayBuffer())
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  // Downloading again gives the same document (the issue date is the proposal generation date).
  const second = Buffer.from(await (await fetch(`${fixture.url}/api/offers/${created.id}/proposal.pdf`, { headers: fixture.admin })).arrayBuffer())
  assert.equal(second.length, bytes.length)
})
