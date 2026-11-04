// Forma de lançamento (por peça ou total do pedido) contra o servidor real e um banco MySQL temporário: baixa no estoque,
// pedido de material, recebimento, edição da quantidade da OS e desfazer o aceite. Cada caso é conferido e todos aparecem
// no resultado, mesmo depois de uma falha.
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import { offerDraft } from './workflowFixture.js'
import { operationVersion } from '../server/orderEditing.js'
import { materialRequests } from '../src/offerResources.js'

const failures = []
function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${same ? 'ok  ' : 'ERRO'} ${label}${same ? '' : `: veio ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`}`)
  if (!same) failures.push(label)
}

const options = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' }
const database = `gmac_test_entry_${randomUUID().replaceAll('-', '')}`
assert.match(database, /^gmac_test_entry_[a-f0-9]{32}$/)
const directory = await mkdtemp(path.resolve('test-results/entry-mode-'))
assert.ok(directory.startsWith(path.resolve('test-results') + path.sep))
const admin = await mysql.createConnection(options)
let pool, child, logs = ''
try {
  await admin.query(`CREATE DATABASE \`${database}\``)
  pool = mysql.createPool({ ...options, database, multipleStatements: true })
  const schema = await readFile('database/schema.sql', 'utf8')
  await pool.query(schema.slice(schema.indexOf('CREATE TABLE')))
  await pool.execute('INSERT INTO users (name,birth_date,cpf,email,password_hash,role) VALUES (?,?,?,?,?,?)', ['Teste', '1990-01-01', '12345678901', 'teste@example.invalid', await bcrypt.hash('teste123', 4), 'admin'])
  const listener = net.createServer().listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  const url = `http://127.0.0.1:${port}/api`
  child = spawn(process.execPath, ['server/index.js'], { windowsHide: true, env: { ...process.env, DB_NAME: database, DATA_DIR: directory, API_HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })
  let ready = false
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try { ready = (await fetch(`${url}/health`)).ok } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, logs)
  let token
  async function request(route, body, method = body == null ? 'GET' : 'POST') {
    const response = await fetch(`${url}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body == null ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  }
  token = (await request('/auth/login', { cpf: '12345678901', password: 'teste123' })).data.token
  assert.ok(token)
  const machine = (await request('/machines', { name: 'Torno', type: 'Teste', sector: 'Usinagem', hourlyRate: 100 })).data.item
  const plan = { turning: { type: 'machine', id: machine.id } }
  const stock = async (name, quantity, unit = 'kg') => (await request('/inventory', { name, quantity, minimum: 0, unitPrice: 10, unit })).data.id
  const balance = async (id) => Number((await pool.execute('SELECT quantity_kg FROM inventory_materials WHERE id=?', [id]))[0][0].quantity_kg)
  const movements = async (id, type) => (await pool.execute('SELECT quantity_kg FROM inventory_movements WHERE material_id=? AND movement_type=? ORDER BY id', [id, type]))[0].map((row) => Number(row.quantity_kg))
  const orderOf = async (code) => (await request('/operations/orders')).data.items.find((item) => item.code === code)
  const pendingOf = async (code, name) => {
    const [offers, orders] = await Promise.all([request('/offers'), request('/orders')])
    return materialRequests(offers.data.items, orders.data.items).filter((row) => row.orderCode === code && row.name === name && row.quantity > 0).map((row) => row.quantity)
  }
  async function open(resources, quantity = 10) {
    const offer = (await request('/offers', { ...offerDraft, quantity })).data.item
    const saved = await request(`/offers/${offer.id}/resources`, { laborEntries: [], kind: 'service', stages: ['turning'], stageResources: plan, ...resources }, 'PUT')
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    const proposal = await request(`/offers/${offer.id}/proposal`, { layout: 'classic', proposal: { key: 'A', serviceValue: 500, deadline: offerDraft.deadline } })
    assert.equal(proposal.status, 200, JSON.stringify(proposal.data))
    return { offer, saved: saved.data.item }
  }
  async function accept(resources, quantity) {
    const { offer } = await open(resources, quantity)
    const accepted = await request(`/offers/${offer.id}/accept`, {})
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data))
    return { offer, order: accepted.data.item }
  }
  // As the edit window fills what an older proposal does not have.
  const proposalDraft = (order) => ({ key: 'A', title: '', materials: 0, labor: 0, serviceValue: 0, margin: 0, discount: 0, ...order.proposal })
  async function editQuantity(code, quantity, change) {
    const order = await orderOf(code)
    change?.(order)
    const stages = order.resources.stages
    const body = { order: { ...structuredClone(order), quantity, attachmentIds: [], proposal: proposalDraft(order) }, stageCounts: Object.fromEntries(stages.map((stage) => [stage, 0])), expectedUpdatedAt: order.updatedAt || order.createdAt, expectedOperation: operationVersion(order.operation) }
    const result = await request(`/operations/orders/${code}`, body, 'PUT')
    assert.equal(result.status, 200, JSON.stringify(result.data))
    return orderOf(code)
  }
  const perPiece = (name, quantityPerPiece, extra = {}) => ({ id: randomUUID(), name, unit: 'kg', unitPrice: 10, quantityPerPiece, quantity: 1, ...extra })
  const piece = (materials, minutes = 30) => ({ entryMode: 'piece', materials, stageTimesPerPiece: { turning: minutes } })

  // 1. Tem estoque de sobra: baixa o total, não o valor de uma peça.
  const steel = await stock('Aco', 100)
  const first = await accept(piece([perPiece('Aco', 1, { inventoryId: steel })]))
  check('1. total do material = por peça × quantidade', first.order.resources.materials[0].quantity, 10)
  check('1. o valor por peça fica guardado', first.order.resources.materials[0].quantityPerPiece, 1)
  check('1. baixa no estoque é o total', await movements(steel, 'exit'), [10])
  check('1. saldo do estoque', await balance(steel), 90)
  check('1. sem pedido de material', await pendingOf(first.order.code, 'Aco'), [])
  check('1. tempo total da etapa', first.order.resources.stageTimes, { turning: 300 })
  check('1. horas da mão de obra', first.order.resources.laborEntries.map((row) => row.hours), [5])

  // 2. Estoque parcial: baixa o que tem e pede o resto; o recebimento completa a OS.
  const steelB = await stock('Inox', 4)
  const second = await accept(piece([perPiece('Inox', 1, { inventoryId: steelB })]))
  check('2. baixa o que tem', await movements(steelB, 'exit'), [4])
  check('2. saldo zerado', await balance(steelB), 0)
  check('2. pedido de material da diferença', await pendingOf(second.order.code, 'Inox'), [6])
  const receipt = await request(`/inventory/${steelB}/movements`, { type: 'entry', quantityKg: 6, unitPrice: 10, materialRequestId: `${second.offer.id}-${second.order.resources.materials[0].id}`, materialReceiptId: randomUUID() })
  check('2. recebimento aceito', receipt.status, 201)
  check('2. recebimento vai todo para a OS', receipt.data.allocatedQuantity, 6)
  check('2. pedido atendido', await pendingOf(second.order.code, 'Inox'), [])
  check('2. consumo final da OS', (await orderOf(second.order.code)).resources.materials[0].inventoryConsumedQuantity, 10)

  // 3. Material fora do cadastro: pede o total; ao cadastrar pelo pedido, vai para a OS.
  const third = await accept(piece([perPiece('Titanio', 0.5)]))
  check('3. total com decimais', third.order.resources.materials[0].quantity, 5)
  check('3. pedido do total', await pendingOf(third.order.code, 'Titanio'), [5])
  const createdFromRequest = await request('/inventory', { name: 'Titanio', quantity: 5, minimum: 0, unitPrice: 50, materialRequestId: `${third.offer.id}-${third.order.resources.materials[0].id}`, materialReceiptId: randomUUID() })
  check('3. cadastro pelo pedido', createdFromRequest.status, 201)
  check('3. pedido atendido', await pendingOf(third.order.code, 'Titanio'), [])

  // 4. Unidades: fração por peça, total inteiro para cima. Desfazer o aceite devolve o estoque.
  const bars = await stock('Barra', 20, 'un')
  const fourth = await accept(piece([perPiece('Barra', 0.25, { unit: 'un', inventoryId: bars })]))
  check('4. unidade arredonda para cima', fourth.order.resources.materials[0].quantity, 3)
  check('4. baixa inteira', await movements(bars, 'exit'), [3])
  const undone = await request(`/offers/${fourth.offer.id}/unaccept`, {})
  check('4. desfazer o aceite', undone.status, 200)
  check('4. estoque devolvido', await balance(bars), 20)

  // 5. O que já estava lançado (sem a escolha) não é multiplicado nem ganha campos novos.
  const legacyStock = await stock('Latao', 100)
  const legacy = await accept({ materials: [{ id: randomUUID(), name: 'Latao', unit: 'kg', unitPrice: 10, quantity: 10, inventoryId: legacyStock }], stageTimes: { turning: 120 } })
  check('5. antigo: material igual', legacy.order.resources.materials[0].quantity, 10)
  check('5. antigo: tempo igual', legacy.order.resources.stageTimes, { turning: 120 })
  check('5. antigo: baixa igual', await movements(legacyStock, 'exit'), [10])
  check('5. antigo: sem marca nova', [legacy.order.resources.entryMode, legacy.order.resources.stageTimesPerPiece], [null, null])
  const legacyEdited = await editQuantity(legacy.order.code, 15)
  check('5. antigo: mudar a quantidade não recalcula', [legacyEdited.resources.materials[0].quantity, legacyEdited.resources.stageTimes.turning], [10, 120])
  check('5. antigo: nenhuma baixa nova', await movements(legacyStock, 'exit'), [10])
  const handEdited = await editQuantity(legacy.order.code, 15, (order) => { order.resources.materials[0].quantity = 12 })
  check('5. antigo: aumentar o material à mão também baixa a diferença', [handEdited.resources.materials[0].inventoryConsumedQuantity, await balance(legacyStock)], [12, 88])

  // 6. Mudar a quantidade de uma OS por peça: recalcula e baixa a diferença do estoque, sem gerar pedido quando há material.
  const before = await orderOf(first.order.code)
  const grown = await editQuantity(first.order.code, 15)
  check('6. total recalculado', grown.resources.materials[0].quantity, 15)
  check('6. tempo recalculado', grown.resources.stageTimes, { turning: 450 })
  check('6. mão de obra recalculada', grown.resources.laborEntries.map((row) => row.hours), [7.5])
  check('6. valor da OS não muda', [grown.proposal.serviceValue, grown.proposal.osValue], [before.proposal.serviceValue, before.proposal.osValue])
  check('6. a diferença sai do estoque', await movements(steel, 'exit'), [10, 5])
  check('6. saldo do estoque', await balance(steel), 85)
  check('6. sem pedido, porque havia material', await pendingOf(first.order.code, 'Aco'), [])
  check('6. consumo da OS fecha com o total', [grown.resources.materials[0].inventoryConsumedQuantity, grown.resources.materials[0].purchaseQuantity], [15, 0])
  check('6. a baixa tem o código da OS', (await pool.execute("SELECT order_code FROM inventory_movements WHERE material_id=? AND movement_type='exit' ORDER BY id DESC LIMIT 1", [steel]))[0][0].order_code, first.order.code)
  const unchangedSave = await editQuantity(first.order.code, 15)
  check('6. salvar sem aumentar não baixa de novo', [await movements(steel, 'exit'), unchangedSave.resources.materials[0].inventoryConsumedQuantity], [[10, 5], 15])
  const shrunk = await editQuantity(first.order.code, 8)
  check('6. reduzir: total recalculado', shrunk.resources.materials[0].quantity, 8)
  check('6. reduzir: sem pedido', await pendingOf(first.order.code, 'Aco'), [])
  check('6. reduzir: nada volta ao estoque sozinho', await balance(steel), 85)
  check('6. reduzir: registro do que já saiu', shrunk.resources.materials[0].inventoryConsumedQuantity, 15)
  await editQuantity(first.order.code, 12)
  check('6. aumentar dentro do que já saiu não baixa de novo', [await movements(steel, 'exit'), await pendingOf(first.order.code, 'Aco')], [[10, 5], []])

  // 7. Estoque justo: baixa o que tem e pede só o que faltar.
  const tight = await stock('Cobre', 12)
  const seventh = await accept(piece([perPiece('Cobre', 1, { inventoryId: tight })]))
  check('7. baixa', await movements(tight, 'exit'), [10])
  await editQuantity(seventh.order.code, 15)
  check('7. baixa o que restava', await movements(tight, 'exit'), [10, 2])
  check('7. saldo zerado', await balance(tight), 0)
  check('7. pedido só do que faltou', await pendingOf(seventh.order.code, 'Cobre'), [3])
  const closing = await request(`/inventory/${tight}/movements`, { type: 'entry', quantityKg: 3, unitPrice: 10, materialRequestId: `${seventh.offer.id}-${seventh.order.resources.materials[0].id}`, materialReceiptId: randomUUID() })
  check('7. receber o pedido fecha a OS', [closing.status, closing.data.allocatedQuantity, (await orderOf(seventh.order.code)).resources.materials[0].inventoryConsumedQuantity, await balance(tight)], [201, 3, 15, 0])

  // 8. Pedido ainda em aberto acompanha a nova quantidade.
  const lack = await stock('Bronze', 2)
  const eighth = await accept(piece([perPiece('Bronze', 1, { inventoryId: lack })]))
  check('8. pedido inicial', await pendingOf(eighth.order.code, 'Bronze'), [8])
  await editQuantity(eighth.order.code, 5)
  check('8. pedido em aberto reduz', await pendingOf(eighth.order.code, 'Bronze'), [3])
  await request(`/inventory/${lack}/movements`, { type: 'entry', quantityKg: 10, unitPrice: 10 })
  await editQuantity(eighth.order.code, 7)
  check('8. com estoque novo, só o aumento sai; o pedido aberto continua', [await movements(lack, 'exit'), await balance(lack), await pendingOf(eighth.order.code, 'Bronze')], [[2, 2], 8, [3]])

  // 8b. Sem nenhum estoque: tudo vira pedido, sem movimento e sem erro.
  const none = await stock('Niquel', 10)
  const noStock = await accept(piece([perPiece('Niquel', 1, { inventoryId: none })]))
  check('8b. baixa inicial zera o estoque', await balance(none), 0)
  await editQuantity(noStock.order.code, 12)
  check('8b. aumento sem estoque vira pedido', [await movements(none, 'exit'), await pendingOf(noStock.order.code, 'Niquel')], [[10], [2]])

  // 8c. Desfazer o aceite devolve também o que saiu pelo aumento.
  const back = await stock('Prata', 50)
  const backOrder = await accept(piece([perPiece('Prata', 1, { inventoryId: back })]))
  await editQuantity(backOrder.order.code, 20)
  check('8c. baixa inicial e do aumento', await movements(back, 'exit'), [10, 10])
  const backUndo = await request(`/offers/${backOrder.offer.id}/unaccept`, {})
  check('8c. desfazer o aceite', backUndo.status, 200)
  check('8c. todo o material volta', await balance(back), 50)

  // 9. Trocar a forma de lançamento mantém os totais e a proposta já gerada.
  const open9 = await open(piece([perPiece('Zinco', 1)]))
  const switched = await request(`/offers/${open9.offer.id}/resources`, { ...open9.saved.resources, entryMode: 'total', stageTimesPerPiece: undefined, materials: open9.saved.resources.materials.map(({ quantityPerPiece, ...material }) => material) }, 'PUT')
  check('9. totais mantidos', [switched.data.item.resources.materials[0].quantity, switched.data.item.resources.stageTimes.turning], [10, 300])
  check('9. sem valor por peça', switched.data.item.resources.materials[0].quantityPerPiece ?? null, null)
  check('9. proposta mantida', Boolean(switched.data.item.proposal), true)

  // 10. Valores inválidos por peça são recusados.
  const invalid = await request(`/offers/${open9.offer.id}/resources`, { entryMode: 'piece', materials: [perPiece('Zinco', -1)], stages: ['turning'], stageResources: plan, stageTimesPerPiece: { turning: 30 } }, 'PUT')
  check('10. quantidade negativa', invalid.status, 400)
  const badMode = await request(`/offers/${open9.offer.id}/resources`, { entryMode: 'outro', materials: [], stages: ['turning'] }, 'PUT')
  check('10. forma inválida', badMode.status, 400)
  const blank = await orderOf(second.order.code)
  blank.resources.materials[0].quantityPerPiece = ''
  const blankResult = await request(`/operations/orders/${second.order.code}`, { order: { ...blank, attachmentIds: [], proposal: proposalDraft(blank) }, stageCounts: { turning: 0 }, expectedUpdatedAt: blank.updatedAt || blank.createdAt, expectedOperation: operationVersion(blank.operation) }, 'PUT')
  check('10. por peça vazio na OS', blankResult.status, 400)
} finally {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited.catch(() => {}) }
  await pool?.end().catch(() => {})
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {})
  await admin.end().catch(() => {})
  await rm(directory, { recursive: true, force: true }).catch(() => {})
}
if (failures.length) { console.log(`\n${failures.length} erro(s):\n- ${failures.join('\n- ')}`); process.exitCode = 1 } else console.log('\nForma de lançamento: tudo certo.')
