import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import mysql from 'mysql2/promise'
import offersRouter from './offers.js'
import createOperationsRouter from './operations.js'
import { issueOperatorToken, operatorConfigured, operatorCredentialsMatch } from './operatorAuth.js'
import { createAccountService, createAccountsRouter, issueAdminToken, requireAdmin } from './accounts.js'
import createMachinesRouter from './machines.js'
import createReportsRouter from './reports.js'
import createPayablesRouter from './payables.js'
import createInventoryImportRouter from './inventoryImport.js'
import createMaterialRequestsRouter from './materialRequests.js'
import { createApiRateLimiter } from './rateLimit.js'
import { ensureInventoryAppearance, inventoryAppearance } from './inventoryAppearance.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'

app.set('trust proxy', 'loopback')
app.use(cors())
app.use('/api', createApiRateLimiter())
app.use(express.json())
app.use('/api', offersRouter)

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

app.use('/api', createOperationsRouter(pool))
const accounts = createAccountService(pool)
app.use('/api', createAccountsRouter(accounts))
app.use('/api', createMachinesRouter(requireAdmin, pool))
app.use('/api', createReportsRouter(pool, accounts, requireAdmin))
app.use('/api', createInventoryImportRouter(pool, requireAdmin))
app.use('/api', createMaterialRequestsRouter(requireAdmin))
const payablesRouter = createPayablesRouter(accounts, requireAdmin)
app.use('/api', payablesRouter)
setInterval(() => payablesRouter.sweep().catch((error) => console.error('Falha ao verificar vencimentos:', error.message)), 60000).unref()

app.post('/api/auth/operator-login', (request, response) => {
  if (typeof request.body?.username !== 'string' || !/^\d{11}$/.test(request.body.username)) return response.status(400).json({ message: 'Informe os 11 dígitos do usuário, sem pontos ou traços.' })
  if (!operatorConfigured()) return response.status(503).json({ message: 'A conta compartilhada do operador ainda não foi configurada no servidor.' })
  if (!operatorCredentialsMatch(request.body?.username, request.body?.password)) return response.status(401).json({ message: 'Usuário ou senha do operador inválidos.' })
  return response.json({ token: issueOperatorToken(), role: 'operator' })
})

app.get('/api/health', async (_request, response) => {
  try {
    if (pool) await pool.execute('SELECT 1')
    response.json({ status: 'ok', databaseConfigured: Boolean(pool), databaseConnected: Boolean(pool) })
  } catch {
    response.status(503).json({ status: 'unavailable', databaseConfigured: true, databaseConnected: false })
  }
})

app.get('/api/inventory', async (_request, response) => {
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
    const items = materials.map((material) => ({
      ...material,
      history: movements.filter((movement) => movement.material_id === material.id),
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
    connection = await pool.getConnection()
    await connection.beginTransaction()
    const [result] = await connection.execute(
      `INSERT INTO inventory_materials (name, detail, quantity_kg, minimum_kg, unit_price, icon, photo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(name).trim(), detail || null, initialQuantity, Number(minimum) || 0, Number(unitPrice) || 0, appearance.icon || 'sheet', appearance.photo || null],
    )
    await connection.execute(
      `INSERT INTO inventory_movements
        (material_id, movement_type, quantity_kg, unit_price_kg, balance_after_kg, destination)
       VALUES (?, 'creation', ?, ?, ?, 'Cadastro inicial')`,
      [result.insertId, initialQuantity, Number(unitPrice) || 0, initialQuantity],
    )
    await connection.commit()
    return response.status(201).json({ id: result.insertId })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error.status === 400) return response.status(400).json({ message: error.message })
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
    return response.json({ ok: true })
  } catch (error) {
    if (error.status === 400) return response.status(400).json({ message: error.message })
    console.error('Falha ao editar material:', error)
    return response.status(500).json({ message: 'Não foi possível editar o material.' })
  }
})

app.delete('/api/inventory/:materialId', async (request, response) => {
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

app.get('/api/inventory/:materialId/history', async (request, response) => {
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

app.post('/api/inventory/:materialId/movements', async (request, response) => {
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
    connection = await pool.getConnection()
    await connection.beginTransaction()
    const [materials] = await connection.execute(
      'SELECT id, quantity_kg, unit_price FROM inventory_materials WHERE id = ? FOR UPDATE',
      [request.params.materialId],
    )
    const material = materials[0]
    if (!material) {
      await connection.rollback()
      return response.status(404).json({ message: 'Material não encontrado.' })
    }

    const currentBalance = Number(material.quantity_kg)
    const currentUnitPrice = Number(material.unit_price)
    const incomingUnitPrice = Number(unitPrice)
    const nextBalance = type === 'entry' ? currentBalance + quantity : currentBalance - quantity
    if (nextBalance < 0) {
      await connection.rollback()
      return response.status(409).json({ message: 'A saída não pode ser maior que o saldo disponível.' })
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
      [request.params.materialId, type, quantity, type === 'entry' ? incomingUnitPrice : currentUnitPrice, nextBalance, destination || null, orderCode || null, notes || null],
    )
    await connection.commit()
    return response.status(201).json({ materialId: Number(request.params.materialId), balance: nextBalance, unitPrice: nextUnitPrice })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Falha ao registrar movimentação do estoque:', error)
    return response.status(500).json({ message: 'Não foi possível registrar a movimentação.' })
  } finally {
    connection?.release()
  }
})

app.post('/api/auth/login', async (request, response) => {
  const { cpf, password } = request.body ?? {}

  if (!cpf || !password) {
    return response.status(400).json({ message: 'Informe seu CPF e sua senha.' })
  }
  if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf)) {
    return response.status(400).json({ message: 'Informe os 11 dígitos do CPF, sem pontos ou traços.' })
  }

  try {
    const user = await accounts.authenticate(cpf, password)
    if (!user) {
      return response.status(401).json({ message: 'CPF ou senha inválidos.' })
    }
    return response.json({ user, token: issueAdminToken(user) })
  } catch (error) {
    console.error('Falha no login:', error)
    return response.status(500).json({ message: 'Não foi possível acessar o sistema agora.' })
  }
})

app.use((error, _request, response, _next) => {
  console.error('Falha na API:', error.message)
  response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir a operação.' })
})

app.listen(port, host, () => {
  console.log(`API GMAC disponível em http://${host}:${port}`)
})
