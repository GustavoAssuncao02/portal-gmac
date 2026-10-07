import 'dotenv/config'
import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { readStore } from '../server/offers.js'
import { saveRequestedMaterial } from '../server/materialRequests.js'
import { allocateReceivedMaterial } from '../server/orderMaterials.js'

const { values } = parseArgs({ options: { order: { type: 'string' }, material: { type: 'string' }, movement: { type: 'string' } } })
if (!values.order || !values.material || !/^\d+$/.test(values.movement || '')) throw Error('Informe --order, --material e --movement para uma entrada já registrada.')
const store = await readStore()
const order = store.orders.find((entry) => entry.code === values.order)
if (!order?.resources.materials.some((entry) => entry.id === values.material)) throw Error('Material não encontrado nesta OS.')
const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
let connection
try {
  const result = await saveRequestedMaterial(`${order.offerId}-${values.material}`, 'repair', async ({ order: currentOrder, material, remainingQuantity }) => {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    const [[movement]] = await connection.execute('SELECT * FROM inventory_movements WHERE id = ? FOR UPDATE', [values.movement])
    if (!movement || movement.movement_type !== 'entry' || Number(movement.material_id) !== Number(material.inventoryId)) throw Error('A movimentação não é uma entrada deste material.')
    if (movement.order_code && movement.order_code !== currentOrder.code) throw Error('A entrada pertence a outra OS.')
    if (Date.parse(movement.created_at) < Date.parse(currentOrder.createdAt)) throw Error('A entrada é anterior à criação da OS.')
    if (!(remainingQuantity > 0) || Number(movement.quantity_kg) > remainingQuantity) throw Error('Confira a quantidade da entrada e a pendência antes de reparar.')
    const [[inventory]] = await connection.execute('SELECT * FROM inventory_materials WHERE id = ? FOR UPDATE', [movement.material_id])
    if (Number(inventory.quantity_kg) < Number(movement.quantity_kg)) throw Error('O saldo já não permite destinar a entrada completa para esta OS.')
    await mkdir('test-results', { recursive: true })
    await writeFile(`test-results/receipt-repair-before-${values.movement}-${Date.now()}.json`, JSON.stringify({ order: currentOrder, movement, inventory }, null, 2))
    await connection.execute('UPDATE inventory_movements SET order_code = ?, notes = ? WHERE id = ?', [currentOrder.code, `Entrada vinculada à OS na correção de recebimento. ${movement.notes || ''}`.trim(), movement.id])
    return { materialId: Number(movement.material_id), receivedQuantity: Number(movement.quantity_kg), sourceMovementId: Number(movement.id) }
  }, { receiptId: `repair-entry-${values.movement}`, allocate: (receipt, context) => allocateReceivedMaterial(connection, receipt, context), commit: () => connection?.commit(), rollback: () => connection?.rollback() })
  console.log(JSON.stringify({ order: order.code, ...result }))
} finally { connection?.release(); await pool.end() }
