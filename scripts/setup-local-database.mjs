import 'dotenv/config'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureInventoryAppearance } from '../server/inventoryAppearance.js'
import { dataDirectory } from '../server/dataDirectory.js'

const root = new URL('../', import.meta.url)
const env = process.env
if (env.DB_NAME !== 'portal_gmac' || !env.DB_USER || !env.DB_HOST) throw new Error('Configure o banco dedicado portal_gmac no .env antes de importar.')
const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD || '', multipleStatements: true })
try {
  await connection.query(await readFile(new URL('database/schema.sql', root), 'utf8'))
  await ensureInventoryAppearance(connection)
  await connection.query('CREATE TABLE IF NOT EXISTS local_imports (name VARCHAR(80) PRIMARY KEY, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
  const [done] = await connection.execute("SELECT name FROM local_imports WHERE name = 'json-workflow-v1'")
  if (done.length) {
    console.log('Banco ja preparado. Os dados atuais foram mantidos.')
  } else {
    for (const table of ['users', 'employees', 'clients', 'order_operations', 'order_operation_events']) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS total FROM ${table}`)
      if (row.total) throw new Error(`A tabela ${table} ja possui dados. Importacao interrompida para nao sobrescrever registros.`)
    }
    const source = path.join(dataDirectory, 'offers.json')
    const store = JSON.parse(await readFile(source, 'utf8'))
    const directory = path.join(dataDirectory, 'backups')
    await mkdir(directory, { recursive: true })
    const backup = path.join(directory, `before-mysql-${Date.now()}.json`)
    await copyFile(source, backup)
    await connection.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',NO_AUTO_VALUE_ON_ZERO')")
    await connection.beginTransaction()
    const employees = new Map()
    for (const employee of store.employees || []) {
      const [result] = await connection.execute('INSERT INTO employees (name, birth_date, cpf, email, i_identificacao) VALUES (?, ?, ?, ?, ?)', [employee.name, employee.birthDate, employee.cpf, employee.email, employee.identification])
      employees.set(String(employee.id), result.insertId)
    }
    const demo = { id: 0, name: env.DEMO_ADMIN_NAME || 'Administrador', cpf: env.DEMO_ADMIN_CPF, birthDate: '1990-01-01', email: 'admin@example.invalid', ...store.demoAdmin }
    const admins = env.DEMO_ADMIN_CPF ? [demo, ...(store.admins || [])] : store.admins || []
    for (const admin of admins) {
      const hash = admin.passwordHash || (admin.id === 0 && env.DEMO_ADMIN_PASSWORD ? await bcrypt.hash(env.DEMO_ADMIN_PASSWORD, 12) : null)
      if (!hash) throw new Error('Administrador sem hash de senha. Importacao interrompida.')
      await connection.execute("INSERT INTO users (id, name, birth_date, cpf, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, 'admin')", [admin.id, admin.name, admin.birthDate, admin.cpf, admin.email, hash])
    }
    for (const client of store.clients || []) await connection.execute('INSERT INTO clients (name, document_type, document, email) VALUES (?, ?, ?, ?)', [client.name, client.documentType, client.document, client.email])
    // Transform only the SQL copy; the original JSON remains a complete fallback/backup.
    const mapped = JSON.parse(JSON.stringify(store.orders || []), (key, value) => key === 'employeeId' && employees.has(String(value)) ? employees.get(String(value)) : value)
    let events = 0
    for (const order of mapped) {
      if (!order.operation) continue
      await connection.execute('INSERT INTO order_operations (order_code, data) VALUES (?, ?)', [order.code, JSON.stringify(order.operation)])
      for (const event of order.operationEvents || []) {
        await connection.execute('INSERT INTO order_operation_events (id, order_code, data, occurred_at) VALUES (?, ?, ?, ?)', [event.id, order.code, JSON.stringify(event), new Date(event.at)])
        events++
      }
    }
    await connection.execute("INSERT INTO local_imports (name) VALUES ('json-workflow-v1')")
    await connection.commit()
    console.log(JSON.stringify({ employees: employees.size, administrators: admins.length, orders: mapped.filter((order) => order.operation).length, events, preservedPayables: store.payables?.length || 0, backup }))
  }
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
