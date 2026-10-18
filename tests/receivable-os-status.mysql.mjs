import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'
import { todayBahia, shiftMonth } from '../server/payableRules.js'

// With the database, the state of the operation lives in order_operations. An OS finished by the operator must be accepted
// for the receipt (scheduled or already received), instead of being refused as "not finished".
const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_receipt_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_receipt_[a-f0-9]{32}$/)
const admin = await mysql.createConnection(options)
let pool, fixture
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS users'), schema.indexOf('CREATE TABLE IF NOT EXISTS inventory_materials')))
  await pool.query(await readFile(new URL('../database/migrations/003_operator_workflow.sql', import.meta.url), 'utf8'))
  const [inserted] = await pool.execute("INSERT INTO users (name, birth_date, cpf, email, password_hash, role) VALUES ('Gestor Teste', '1980-01-01', '11122233344', 'gestor@example.invalid', 'x', 'admin')")
  fixture = await createWorkflowFixture({ pool })
  // The token of the administrator of the temporary database, issued by the same module the portal under test uses.
  const { issueAdminToken } = await import(pathToFileURL(path.join(fixture.directory, 'accounts.js')).href)
  const auth = { Authorization: `Bearer ${issueAdminToken({ id: inserted.insertId, name: 'Gestor Teste' })}` }
  const operator = { Authorization: `Bearer ${fixture.operatorToken}` }
  const request = (path, method, body) => fixture.request(path, method, body, auth)
  const employee = (await request('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', birthDate: '1990-01-01', email: 'ana@example.invalid', identification: '001' })).data.item
  async function createOrder(service) {
    const offer = (await request('/offers', 'POST', { ...offerDraft, service })).data.item
    await request(`/offers/${offer.id}/resources`, 'PUT', { materials: [], laborEntries: [], kind: 'service', stages: ['painting'] })
    await request(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', serviceValue: 960, osValue: 960, deadline: offer.deadline } })
    return (await request(`/offers/${offer.id}/accept`, 'POST')).data.item
  }
  async function finish(order) {
    const route = `/operations/orders/${order.code}`
    const started = await fixture.request(`${route}/start`, 'POST', { employeeId: employee.id }, operator)
    assert.equal(started.status, 200, JSON.stringify(started.data))
    const session = { sessionId: started.data.operation.activeSession.id, sessionToken: started.data.sessionToken }
    assert.equal((await fixture.request(`${route}/stages/${started.data.operation.stages[0].key}`, 'POST', { ...session, quantity: order.quantity }, operator)).status, 200)
    assert.equal((await fixture.request(`${route}/complete`, 'POST', session, operator)).status, 200)
  }
  const first = await createOrder('OS concluida pelo operador'), second = await createOrder('OS recebida na entrega')
  const schedule = { orderCode: first.code, value: '960', dueDate: shiftMonth(todayBahia(), 1) }
  const received = { orderCode: second.code, treasury: true, value: '960', date: todayBahia(), method: 'pix' }

  // Still being worked on: it cannot be received yet.
  assert.equal((await request(`/receivables/order/${first.code}`)).data.order.completed, false)
  const early = await request('/receivables', 'POST', schedule)
  assert.equal(early.status, 409); assert.match(early.data.message, /precisa estar concluída/)
  assert.equal((await request('/receivables', 'POST', received)).status, 409)

  // Finished by the operator: the state is only in the database, and the receipt now follows it.
  await finish(first); await finish(second)
  assert.equal(await fixture.mutateStore((store) => store.orders.find((item) => item.code === first.code).operation), undefined, 'the saved order has no operation state')
  const info = (await request(`/receivables/order/${first.code}`)).data
  assert.deepEqual([info.order.completed, info.order.valueCents, info.item], [true, 96000, null])
  const scheduled = await request('/receivables', 'POST', schedule)
  assert.equal(scheduled.status, 201, JSON.stringify(scheduled.data))
  assert.deepEqual([scheduled.data.item.orderCode, scheduled.data.item.status, scheduled.data.item.valueCents], [first.code, 'pending', 96000])
  assert.equal((await request('/receivables', 'POST', schedule)).status, 409, 'one receivable per OS')
  const paid = await request('/receivables', 'POST', received)
  assert.equal(paid.status, 201, JSON.stringify(paid.data))
  assert.deepEqual([paid.data.item.orderCode, paid.data.item.status, paid.data.item.treasury, paid.data.item.receipt.finalCents], [second.code, 'received', true, 96000])
  console.log('Isolated MySQL OS receipt passed: refused while in progress, accepted once the operator finishes it (scheduled and already received), one receivable per OS.')
} finally {
  await fixture?.close()
  await pool?.end()
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
