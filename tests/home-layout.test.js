import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { defaultHomeLayout, homeModules, homeWidgets, normalizeHomeLayout, validHomeLayout } from '../server/homeWidgets.js'
import { readFile } from 'node:fs/promises'

const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Teste' }
const original = [{ id: 'operation-summary', w: 4, h: 1 }, { id: 'payables-summary', w: 4, h: 1 }, { id: 'open-orders', w: 3, h: 2 }, { id: 'low-stock', w: 1, h: 1 }, { id: 'calculator-shortcut', w: 1, h: 1 }, { id: 'management-attention', w: 4, h: 1 }]

test('the catalog has drawable widgets in every module, more for Operação and Gestão Financeira', async () => {
  const views = await readFile(new URL('../src/HomeWidgets.jsx', import.meta.url), 'utf8')
  assert.equal(new Set(homeWidgets.map((item) => item.id)).size, homeWidgets.length, 'ids are unique')
  for (const item of homeWidgets) {
    assert.match(views, new RegExp(`'${item.id}': \{ Component: `), `${item.id} has a component`)
    assert.ok(homeModules.some(([key]) => key === item.module), `${item.id} belongs to a module`)
    assert.ok(item.widths.includes(item.w) && item.widths.every((width) => [1, 2, 3, 4].includes(width)), `${item.id} sizes`)
    assert.ok(item.h === 1 || item.tall, `${item.id} height`)
  }
  const count = (module) => homeWidgets.filter((item) => item.module === module).length
  assert.ok(count('operation') >= 5 && count('finance') >= 5 && count('operational') >= 5)
  assert.ok(homeWidgets.filter((item) => item.module === 'finance').every((item) => item.finance), 'Gestão Financeira widgets are hidden from administrative employees')
})

test('the default is the home screen as it was, without Contas a pagar for administrative employees', () => {
  assert.deepEqual(defaultHomeLayout('admin'), original)
  assert.deepEqual(defaultHomeLayout('staff'), original.filter((entry) => entry.id !== 'payables-summary'))
  assert.deepEqual(normalizeHomeLayout(null, 'admin'), original)
  assert.deepEqual(normalizeHomeLayout([{ id: 'unknown', w: 1, h: 1 }, { id: 'month-cash', w: 2, h: 1 }, { id: 'month-cash', w: 1, h: 1 }, { id: 'low-stock', w: 3, h: 2 }, { id: 'quick-access', w: 1, h: 2 }], 'staff'), [{ id: 'low-stock', w: 2, h: 2 }, { id: 'quick-access', w: 1, h: 1 }], 'unknown, repeated and forbidden widgets leave; sizes fit the widget')
  assert.equal(validHomeLayout([{ id: 'open-orders', w: 1, h: 1 }], 'admin'), false, 'width the widget does not accept')
  assert.equal(validHomeLayout([{ id: 'quick-access', w: 2, h: 2 }], 'admin'), false, 'height the widget does not accept')
  assert.equal(validHomeLayout([], 'admin'), true, 'an empty home screen is allowed')
})

test('each account saves its own home layout; invalid layouts are refused and null restores the default', async (t) => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const login = async (cpf, password) => (await fixture.request('/auth/login', 'POST', { cpf, password })).data.token
  const admin = { Authorization: `Bearer ${await login(env.DEMO_ADMIN_CPF, env.DEMO_ADMIN_PASSWORD)}` }
  const route = '/account/home-layout'
  assert.equal((await fixture.request(route)).status, 401)
  assert.equal((await fixture.request(route, 'PUT', { layout: [] }, { Authorization: `Bearer ${fixture.operatorToken}` })).status, 401)
  assert.deepEqual((await fixture.request(route, 'GET', undefined, admin)).data, { layout: original, customized: false })

  const mine = [{ id: 'month-cash', w: 2, h: 1 }, { id: 'machines-now', w: 2, h: 2 }, { id: 'operation-summary', w: 4, h: 1 }]
  const saved = await fixture.request(route, 'PUT', { layout: mine }, admin)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data, { layout: mine, customized: true })
  for (const layout of [undefined, 'x', [{ id: 'unknown', w: 1, h: 1 }], [{ id: 'month-cash', w: 2, h: 1 }, { id: 'month-cash', w: 2, h: 1 }], [{ id: 'month-cash', w: 3, h: 1 }], [{ id: 'month-cash', w: 2, h: 2 }], [{ id: 'month-cash', w: '2', h: 1 }], [null]]) {
    assert.equal((await fixture.request(route, 'PUT', { layout }, admin)).status, 400, JSON.stringify(layout))
  }
  assert.deepEqual((await fixture.request(route, 'GET', undefined, admin)).data.layout, mine, 'a refused save keeps the layout')

  // An administrative employee has a layout of their own and cannot place Gestão Financeira widgets.
  await fixture.adminRequest('/employees', 'POST', { name: 'Funcionária Escritório', birthDate: '1990-01-01', cpf: '00000000004', email: 'escritorio@example.invalid', identification: '', type: 'administrative', password: 'senha123' }, fixture.admin)
  const staff = { Authorization: `Bearer ${await login('00000000004', 'senha123')}` }
  assert.deepEqual((await fixture.request(route, 'GET', undefined, staff)).data, { layout: defaultHomeLayout('staff'), customized: false })
  assert.equal((await fixture.request(route, 'PUT', { layout: [{ id: 'payables-summary', w: 4, h: 1 }] }, staff)).status, 400)
  assert.equal((await fixture.request(route, 'PUT', { layout: [{ id: 'low-stock', w: 2, h: 2 }] }, staff)).status, 200)
  assert.deepEqual((await fixture.request(route, 'GET', undefined, admin)).data.layout, mine, 'one account never changes another')

  assert.deepEqual((await fixture.request(route, 'PUT', { layout: null }, admin)).data, { layout: original, customized: false })
  assert.deepEqual((await fixture.request(route, 'GET', undefined, staff)).data.layout, [{ id: 'low-stock', w: 2, h: 2 }])
})

test('Contas a pagar / a receber keep a period of their own in the layout; 12 months is the default and is not written', async (t) => {
  // Only these two widgets accept it, with the values of the list.
  assert.equal(validHomeLayout([{ id: 'payables-summary', w: 4, h: 1, period: 6 }, { id: 'receivables-summary', w: 2, h: 1, period: 'all' }], 'admin'), true)
  for (const period of [12, 1, 3, 24]) assert.equal(validHomeLayout([{ id: 'payables-summary', w: 4, h: 1, period }], 'admin'), true, String(period))
  for (const period of [0, 5, '12', 'Tudo', null, 36]) assert.equal(validHomeLayout([{ id: 'payables-summary', w: 4, h: 1, period }], 'admin'), false, JSON.stringify(period))
  assert.equal(validHomeLayout([{ id: 'month-cash', w: 2, h: 1, period: 6 }], 'admin'), false, 'a widget without a period')
  assert.deepEqual(normalizeHomeLayout([{ id: 'payables-summary', w: 4, h: 1, period: 12 }, { id: 'receivables-summary', w: 4, h: 1, period: 3 }, { id: 'month-cash', w: 2, h: 1, period: 6 }], 'admin'),
    [{ id: 'payables-summary', w: 4, h: 1 }, { id: 'receivables-summary', w: 4, h: 1, period: 3 }, { id: 'month-cash', w: 2, h: 1 }])
  assert.deepEqual(normalizeHomeLayout([{ id: 'payables-summary', w: 4, h: 1, period: 7 }], 'admin'), [{ id: 'payables-summary', w: 4, h: 1 }], 'an unknown period goes back to the default')

  // Saved with the account, the same on every computer.
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  t.after(() => fixture.close())
  const admin = { Authorization: `Bearer ${(await fixture.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token}` }
  const route = '/account/home-layout'
  const layout = original.map((entry) => entry.id === 'payables-summary' ? { ...entry, period: 'all' } : entry)
  assert.deepEqual((await fixture.request(route, 'PUT', { layout }, admin)).data, { layout, customized: true })
  assert.deepEqual((await fixture.request(route, 'GET', undefined, admin)).data.layout.find((entry) => entry.id === 'payables-summary'), { id: 'payables-summary', w: 4, h: 1, period: 'all' })
  assert.equal((await fixture.request(route, 'PUT', { layout: original.map((entry) => entry.id === 'payables-summary' ? { ...entry, period: 5 } : entry) }, admin)).status, 400)
  assert.equal((await fixture.request(route, 'GET', undefined, admin)).data.layout.find((entry) => entry.id === 'payables-summary').period, 'all', 'a refused save keeps the period')
})

test('Próximas entregas is in Operação, for administrators and administrative employees, outside the default layout', () => {
  const item = homeWidgets.find((widget) => widget.id === 'upcoming-deliveries')
  assert.equal(item.module, 'operation')
  assert.equal(item.finance, false)
  assert.equal(validHomeLayout([{ id: 'upcoming-deliveries', w: 2, h: 2 }], 'staff'), true)
  assert.ok(!defaultHomeLayout('admin').some((entry) => entry.id === 'upcoming-deliveries'))
})

test('Anotações e Tarefas has its own module on the Início, for administrators and administrative employees, outside the default', () => {
  assert.ok(homeModules.some(([key, label]) => key === 'notes' && label === 'Anotações e Tarefas'))
  const ids = homeWidgets.filter((item) => item.module === 'notes').map((item) => item.id)
  assert.deepEqual(ids, ['my-tasks', 'recent-notes', 'quick-note', 'note-invites'])
  assert.equal(validHomeLayout(ids.map((id) => ({ id, w: homeWidgets.find((item) => item.id === id).w, h: 1 })), 'staff'), true)
  assert.ok(!defaultHomeLayout('admin').some((entry) => ids.includes(entry.id)))
})
