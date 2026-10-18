import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import mysql from 'mysql2/promise'
import createOffersRouter, { mutateStore } from './offers.js'
import createOperationsRouter from './operations.js'
import { createAccountService, createAccountsRouter, requireAdmin, restrictStaffFinance } from './accounts.js'
import { ensureEmployeeAccess } from './employeeAccess.js'
import createLoginRouter, { testLoginEnabled } from './authLogin.js'
import createMachinesRouter from './machines.js'
import createLaborServicesRouter, { ensureLaborServices } from './laborServices.js'
import createReportsRouter from './reports.js'
import createPayablesRouter from './payables.js'
import createReceivablesRouter from './receivables.js'
import createBankStatementsRouter from './bankStatements.js'
import createFiscalRouter, { startFiscalCatalogSchedule } from './fiscalCatalog.js'
import createProposalDocumentsRouter from './proposalDocuments.js'
import createInventoryImportRouter from './inventoryImport.js'
import createMaterialRequestsRouter, { saveRequestedMaterial } from './materialRequests.js'
import createNotificationsRouter from './notifications.js'
import { inventorySignal } from './notificationEvents.js'
import { allocateReceivedMaterial } from './orderMaterials.js'
import { createApiRateLimiter } from './rateLimit.js'
import { ensureInventoryAppearance, inventoryAppearance } from './inventoryAppearance.js'
import { configureWeb, serveInterface, trustProxySetting } from './webServer.js'
import { startDataBackups } from './dataBackup.js'
import { dataDirectory } from './dataDirectory.js'

const app = express()
const port = Number(process.env.PORT || 3002)
const host = process.env.API_HOST || '127.0.0.1'

const production = process.env.NODE_ENV === 'production'
const corsOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)

app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY))
configureWeb(app)
// The interface and the API share one address, so a published portal answers other sites only when CORS_ORIGIN lists them.
if (corsOrigins.length) app.use(cors({ origin: corsOrigins }))
else if (!production) app.use(cors())
app.use('/api', createApiRateLimiter({ limit: Number(process.env.API_RATE_LIMIT) || 200 }))
app.use(express.json())

let pool
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  })
  await ensureInventoryAppearance(pool)
}

await ensureEmployeeAccess(pool)
await ensureLaborServices()
app.use('/api', restrictStaffFinance)
app.use('/api', createOffersRouter(pool, requireAdmin))
app.use('/api', createOperationsRouter(pool))
const accounts = createAccountService(pool)
app.use('/api', createAccountsRouter(accounts))
app.use('/api', createLoginRouter(accounts))
app.use('/api', createMachinesRouter(requireAdmin, pool))
app.use('/api', createLaborServicesRouter(requireAdmin, pool))
app.use('/api', createReportsRouter(pool, accounts, requireAdmin))
app.use('/api', createInventoryImportRouter(pool, requireAdmin))
app.use('/api', createMaterialRequestsRouter(requireAdmin, pool, accounts))
const payablesRouter = createPayablesRouter(accounts, requireAdmin)
app.use('/api', payablesRouter)
const receivablesRouter = createReceivablesRouter(accounts, requireAdmin, pool)
app.use('/api', receivablesRouter)
app.use('/api', createBankStatementsRouter(accounts, requireAdmin))
app.use('/api', createFiscalRouter(requireAdmin))
app.use('/api', createProposalDocumentsRouter(requireAdmin))
const notificationsRouter = createNotificationsRouter({ requireAdmin, payables: payablesRouter, receivables: receivablesRouter, loadInventory: async () => {
  if (!pool) return null
  const [rows] = await pool.execute('SELECT id, name, quantity_kg AS quantity, minimum_kg AS minimum FROM inventory_materials')
  return rows
} })
app.use('/api', notificationsRouter)
const refreshInventoryNotifications = () => notificationsRouter.sweepInventory().catch((error) => console.error('Falha ao verificar avisos de estoque:', error.message))
const recordInventoryNotification = (row, previousLow) => mutateStore((store) => inventorySignal(store, row, previousLow)).catch((error) => console.error('Falha ao registrar aviso de estoque:', error.message))
await refreshInventoryNotifications()
setInterval(refreshInventoryNotifications, 10000).unref()
setInterval(() => payablesRouter.sweep().catch((error) => console.error('Falha ao verificar vencimentos:', error.message)), 60000).unref()
startDataBackups(dataDirectory)
setInterval(() => receivablesRouter.sweep().catch((error) => console.error('Falha ao verificar recebimentos:', error.message)), 60000).unref()
// CNAE, NCM, NBS and the companies' registered activities are refreshed every Sunday at midnight.
if (process.env.FISCAL_CATALOG_SYNC !== 'off') startFiscalCatalogSchedule()

app.get('/api/health', async (_request, response) => {
  try {
    if (pool) await pool.execute('SELECT 1')
    response.json({ status: 'ok', databaseConfigured: Boolean(pool), databaseConnected: Boolean(pool) })
  } catch {
    response.status(503).json({ status: 'unavailable', databaseConfigured: true, databaseConnected: false })
  }
})

// Stock (quantities and prices) is for the administrative portal only.
app.get('/api/inventory', requireAdmin, async (_request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  try {
    const [materials] = await pool.execute(
      `SELECT id, name, detail, quantity_kg AS quantity, minimum_kg AS minimum,
              unit_price AS unitPrice, icon, photo, created_at
         FROM inventory_materials
        ORDER BY name ASC`,
    )
    if (!materials.length) return response.json({ items: [] })
    const ids = materials.map((material) => material.id)
    const placeholders = ids.map(() => '?').join(', ')
    const [movements] = await pool.execute(
      `SELECT id, material_id, movement_type AS type, created_at AS date,
              quantity_kg AS quantity, unit_price_kg AS unitPrice, balance_after_kg AS balance,
              destination, order_code AS \`order\`, notes
         FROM inventory_movements
        WHERE material_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC`,
      ids,
    )
    const historyByMaterial = new Map()
    for (const movement of movements) {
      if (!historyByMaterial.has(movement.material_id)) historyByMaterial.set(movement.material_id, [])
      historyByMaterial.get(movement.material_id).push(movement)
    }
    const items = materials.map((material) => ({
      ...material,
      history: historyByMaterial.get(material.id) || [],
    }))
    return response.json({ items })
  } catch (error) {
    console.error('Falha ao consultar estoque:', error)
    return response.status(500).json({ message: 'Não foi possível consultar o estoque.' })
  }
})

app.post('/api/inventory', requireAdmin, async (request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  const { name, detail, quantity, minimum, unitPrice } = request.body ?? {}
  const initialQuantity = Number(quantity)
  if (!String(name || '').trim() || !Number.isFinite(initialQuantity) || initialQuantity < 0) {
    return response.status(400).json({ message: 'Informe o nome e uma quantidade inicial válida.' })
  }

  let connection
  try {
    const appearance = await inventoryAppearance(request.body)
    const receipt = await saveRequestedMaterial(request.body.materialRequestId, request.adminId, async ({ order } = {}) => {
      if (request.body.materialRequestId && initialQuantity <= 0) throw Object.assign(new Error('Informe uma quantidade de entrada maior que zero.'), { status: 400 })
      connection = await pool.getConnection()
      await connection.beginTransaction()
      const [result] = await connection.execute(
        `INSERT INTO inventory_materials (name, detail, quantity_kg, minimum_kg, unit_price, icon, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [String(name).trim(), detail || null, initialQuantity, Number(minimum) || 0, Number(unitPrice) || 0, appearance.icon || 'sheet', appearance.photo || null],
      )
      await connection.execute(
        `INSERT INTO inventory_movements
          (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code)
         VALUES (?, 'creation', ?, ?, ?, ?, ?)`,
        [result.insertId, initialQuantity, Number(unitPrice) || 0, initialQuantity, order ? 'Entrada de material para a OS' : 'Cadastro inicial', order?.code || null],
      )
      return { id: result.insertId, receivedQuantity: initialQuantity }
    }, { commit: () => connection?.commit(), rollback: () => connection?.rollback(), receiptId: request.body.materialReceiptId, adminName: request.adminName, allocate: (result, context) => allocateReceivedMaterial(connection, result, context) })
    if (!receipt.alreadyReceived) await recordInventoryNotification({ id: receipt.id, name: String(name).trim(), quantity: receipt.balance ?? initialQuantity, minimum: Number(minimum) || 0 }, false)
    return response.status(201).json(receipt)
  } catch (error) {
    if (connection) await connection.rollback()
    if (error.status) return response.status(error.status).json({ message: error.message })
    console.error('Falha ao cadastrar material:', error)
    return response.status(500).json({ message: 'Não foi possível cadastrar o material.' })
  } finally {
    connection?.release()
  }
})

app.patch('/api/inventory/:materialId', requireAdmin, async (request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  const { name, detail, minimum, unitPrice } = request.body ?? {}
  try {
    const appearance = await inventoryAppearance(request.body)
    const appearanceFields = Object.keys(appearance)
    const [result] = await pool.execute(
      `UPDATE inventory_materials
          SET name = ?, detail = ?, minimum_kg = ?, unit_price = ?${appearanceFields.map((field) => `, ${field} = ?`).join('')}
        WHERE id = ?`,
      [String(name || '').trim(), detail || null, Number(minimum) || 0, Number(unitPrice) || 0, ...appearanceFields.map((field) => appearance[field]), request.params.materialId],
    )
    if (!result.affectedRows) return response.status(404).json({ message: 'Material não encontrado.' })
    await refreshInventoryNotifications()
    return response.json({ ok: true })
  } catch (error) {
    if (error.status === 400) return response.status(400).json({ message: error.message })
    console.error('Falha ao editar material:', error)
    return response.status(500).json({ message: 'Não foi possível editar o material.' })
  }
})

app.delete('/api/inventory/:materialId', requireAdmin, async (request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  try {
    const [result] = await pool.execute('DELETE FROM inventory_materials WHERE id = ?', [request.params.materialId])
    if (!result.affectedRows) return response.status(404).json({ message: 'Material não encontrado.' })
    return response.status(204).end()
  } catch (error) {
    console.error('Falha ao remover material:', error)
    return response.status(500).json({ message: 'Não foi possível remover o material.' })
  }
})

app.get('/api/inventory/:materialId/history', requireAdmin, async (request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, movement_type AS type, created_at AS date, quantity_kg AS quantity,
              unit_price_kg AS unitPrice, balance_after_kg AS balance,
              destination, order_code AS \`order\`, notes
         FROM inventory_movements
        WHERE material_id = ?
        ORDER BY created_at DESC, id DESC`,
      [request.params.materialId],
    )
    return response.json({ history: rows })
  } catch (error) {
    console.error('Falha ao consultar histórico do estoque:', error)
    return response.status(500).json({ message: 'Não foi possível consultar o histórico do material.' })
  }
})

app.post('/api/inventory/:materialId/movements', requireAdmin, async (request, response) => {
  if (!pool) {
    return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
  }

  const { type, quantityKg, unitPrice, destination, orderCode, notes } = request.body ?? {}
  const quantity = Number(quantityKg)
  if (!['entry', 'exit'].includes(type) || !Number.isFinite(quantity) || quantity <= 0) {
    return response.status(400).json({ message: 'Informe um tipo de movimentação e uma quantidade válida.' })
  }

  let connection
  try {
    let notification
    const receipt = await saveRequestedMaterial(request.body.materialRequestId, request.adminId, async ({ order } = {}) => {
      if (request.body.materialRequestId && type !== 'entry') throw Object.assign(new Error('O pedido exige uma entrada de material.'), { status: 400 })
      connection = await pool.getConnection()
      await connection.beginTransaction()
      const [materials] = await connection.execute(
        'SELECT id, name, quantity_kg, minimum_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE',
        [request.params.materialId],
      )
      const material = materials[0]
      if (!material) {
        throw Object.assign(new Error('Material não encontrado.'), { status: 404 })
      }

      const currentBalance = Number(material.quantity_kg)
      const currentUnitPrice = Number(material.unit_price)
      const incomingUnitPrice = Number(unitPrice)
      const nextBalance = type === 'entry' ? currentBalance + quantity : currentBalance - quantity
      if (nextBalance < 0) {
        throw Object.assign(new Error('A saída não pode ser maior que o saldo disponível.'), { status: 409 })
      }

      const nextUnitPrice = type === 'entry' && Number.isFinite(incomingUnitPrice) && incomingUnitPrice >= 0 && nextBalance > 0
        ? ((currentBalance * currentUnitPrice) + (quantity * incomingUnitPrice)) / nextBalance
        : currentUnitPrice
      await connection.execute(
        'UPDATE inventory_materials SET quantity_kg = ?, unit_price = ? WHERE id = ?',
        [nextBalance, nextUnitPrice, request.params.materialId],
      )
      await connection.execute(
        `INSERT INTO inventory_movements
          (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination, order_code, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [request.params.materialId, type, quantity, type === 'entry' ? incomingUnitPrice : currentUnitPrice, nextBalance, order ? 'Entrada de material para a OS' : destination || null, order?.code || orderCode || null, notes || null],
      )
      notification = { row: { id: material.id, name: material.name, quantity: nextBalance, minimum: Number(material.minimum_kg) }, previousLow: currentBalance <= Number(material.minimum_kg) }
      return { materialId: Number(request.params.materialId), balance: nextBalance, unitPrice: nextUnitPrice, receivedQuantity: quantity }
    }, { commit: () => connection?.commit(), rollback: () => connection?.rollback(), receiptId: request.body.materialReceiptId, adminName: request.adminName, allocate: (result, context) => allocateReceivedMaterial(connection, result, context) })
    if (notification) await recordInventoryNotification({ ...notification.row, quantity: receipt.balance }, notification.previousLow)
    return response.status(201).json(receipt)
  } catch (error) {
    if (connection) await connection.rollback()
    if (error.status) return response.status(error.status).json({ message: error.message })
    console.error('Falha ao registrar movimentação do estoque:', error)
    return response.status(500).json({ message: 'Não foi possível registrar a movimentação.' })
  } finally {
    connection?.release()
  }
})

const interfacePublished = serveInterface(app, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'))

app.use((error, _request, response, _next) => {
  console.error('Falha na API:', error.message)
  response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir a operação.' })
})

app.listen(port, host, () => {
  console.log(`API GMAC disponível em http://${host}:${port}`)
  if (interfacePublished) console.log('Interface publicada no mesmo endereço, a partir de dist/.')
  else if (production) console.warn('ATENCAO: dist/ não encontrado. Execute "npm run build" para publicar a interface.')
  if (testLoginEnabled()) console.warn('ATENCAO: acesso sem senha ativado para testes. Desative TEST_LOGIN_ENABLED antes de publicar o portal.')
})
