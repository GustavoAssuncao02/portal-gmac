import test from 'node:test'
import assert from 'node:assert/strict'
import { reconciliationCandidates, registeredBankFor } from '../server/bankStatements.js'

const banks = [{ id: 'itau', name: 'Itaú', agency: '0443', account: '98840-7' }, { id: 'sicoob', name: 'Sicoob', agency: '3025', account: '1234-5' }]
const account = { id: 'ofx-itau', bankId: '0341', branchId: '0443', accountId: '0443988407' }
const payable = (id, payment) => ({ id, supplierName: 'Posto Avenida', supplierId: null, valueCents: 10000, dueDate: '2026-10-10', payment })
const store = (matchBank) => ({
  banks, bankSettings: { dateToleranceDays: 3, matchBank }, bankAccounts: [account], bankTransactions: [],
  payables: [payable('PAG-1', { date: '2026-10-10', finalCents: 10000, bankId: 'itau' }), payable('PAG-2', { date: '2026-10-10', finalCents: 10000, bankId: 'sicoob' }), payable('PAG-3', null), payable('PAG-4', { date: '2026-10-10', finalCents: 10000 })],
  receivables: [],
})
const transaction = { id: 't1', bankAccountId: 'ofx-itau', direction: 'out', amountCents: -10000, bankDate: '2026-10-10' }

test('an OFX account finds its registered bank by branch and account, or by the choice made on the screen', () => {
  assert.equal(registeredBankFor({ banks }, account).id, 'itau', 'agency 0443 + account 98840-7 = 0443988407')
  assert.equal(registeredBankFor({ banks }, { accountId: '000012345', branchId: '3025' }).id, 'sicoob')
  assert.equal(registeredBankFor({ banks }, { accountId: '777' }), null)
  assert.equal(registeredBankFor({ banks }, { ...account, registryBankId: 'sicoob' }).id, 'sicoob', 'the manual choice wins')
})

test('"considerar o banco" leaves out what was settled through another bank and keeps what has no bank yet', () => {
  const ids = (result) => result.candidates.map((row) => row.id).sort()
  assert.deepEqual(ids(reconciliationCandidates(store(false), transaction)), ['PAG-1', 'PAG-2', 'PAG-3', 'PAG-4'], 'unchecked, nothing changes')
  const checked = reconciliationCandidates(store(true), transaction)
  assert.deepEqual(ids(checked), ['PAG-1', 'PAG-3', 'PAG-4'])
  assert.equal(checked.bankName, 'Itaú')
  assert.ok(checked.candidates.find((row) => row.id === 'PAG-1').reasons.includes('Baixa registrada no mesmo banco (Itaú)'))
  assert.ok(checked.candidates.find((row) => row.id === 'PAG-3').reasons.includes('Sem banco registrado na baixa'))
  const unlinked = reconciliationCandidates({ ...store(true), bankAccounts: [{ id: 'ofx-itau', accountId: '999' }] }, transaction)
  assert.equal(unlinked.bankUnlinked, true, 'an account without a registered bank is reported, and nothing is filtered')
  assert.equal(unlinked.candidates.length, 4)
})
