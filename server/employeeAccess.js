import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { mutateStore, readStore } from './offers.js'

// `both`: the same person works at the machines (4-digit code) and in the office (CPF and password).
export const employeeTypes = ['operator', 'administrative', 'both']
export const isOperator = (employee) => employee?.type === 'operator' || employee?.type === 'both'
export const isStaff = (employee) => employee?.type === 'administrative' || employee?.type === 'both'
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }

// Administrative employees sign in like administrators; the prefix keeps their sessions and preferences apart from administrator ids.
export const staffAccountId = (employeeId) => `employee-${employeeId}`

// An employee may belong to more than one sector (`sectorIds`); `sectorId` keeps the first one for older readers.
const sectorIdsOf = (list, single) => {
  let ids = list
  if (typeof ids === 'string') try { ids = JSON.parse(ids) } catch { ids = null }
  return Array.isArray(ids) ? ids.map(String) : single ? [String(single)] : []
}
export async function employeeRecords(pool) {
  if (!pool) return ((await readStore()).employees || []).map((item) => ({ ...item, type: item.type || 'operator', sectorId: item.sectorId ?? null, sectorIds: sectorIdsOf(item.sectorIds, item.sectorId), active: item.active !== false }))
  const [rows] = await pool.execute("SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, i_identificacao AS identification, employee_type AS type, access_code AS accessCode, password_hash AS passwordHash, sector_id AS sectorId, sector_ids AS sectorIds, active FROM employees ORDER BY name")
  return rows.map((row) => ({ ...row, sectorIds: sectorIdsOf(row.sectorIds, row.sectorId), active: Boolean(Number(row.active)) }))
}

// Preferences and read marks are not work: they do not stop an employee from being deleted.
const notActivity = new Set(['employees', 'adminAppearancePreferences', 'adminNotificationPreferences', 'operationalNotifications', 'payableNotifications', 'receivableNotifications'])
// Ids of the employees that already left a mark: work recorded in an OS, or, for administrative employees, their account
// (employee-<id>) as the author of any record (bills, receivables, material requests, OS changes).
export async function employeesWithActivity(pool) {
  const ids = new Set()
  const store = await readStore()
  const marks = (text) => { for (const match of text.matchAll(/"employee-([^"]+)"/g)) ids.add(match[1]) }
  marks(JSON.stringify(Object.fromEntries(Object.entries(store).filter(([key]) => !notActivity.has(key)))))
  if (pool) {
    const [rows] = await pool.query("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(data, '$.employeeId')) AS id FROM order_operation_events")
    for (const row of rows) if (row.id && row.id !== 'null') ids.add(String(row.id))
    const [authored] = await pool.query(`SELECT data FROM order_operation_events WHERE data LIKE '%"employee-%'`)
    for (const row of authored) marks(typeof row.data === 'string' ? row.data : JSON.stringify(row.data))
  } else for (const order of store.orders || []) for (const event of order.operationEvents || []) if (event.employeeId != null) ids.add(String(event.employeeId))
  return ids
}

export function publicEmployee({ accessCode, passwordHash, ...employee }, { withCode = false } = {}) {
  return withCode && isOperator(employee) ? { ...employee, accessCode: accessCode || null } : employee
}

export function newAccessCode(taken) {
  let code
  do code = String(randomInt(10000)).padStart(4, '0'); while (taken.has(code))
  return code
}

// Operators get a unique 4-digit code; administrative employees get a password; `both` get the two.
export async function accessFields(body, current, employees) {
  const type = body?.type ?? current?.type ?? 'operator'
  if (!employeeTypes.includes(type)) fail(400, 'Escolha se o funcionário é operador, administrativo ou os dois.')
  return { type, accessCode: isOperator({ type }) ? accessCodeOf(body, current, employees) : null, passwordHash: isStaff({ type }) ? await passwordHashOf(body, current) : null }
}
async function passwordHashOf(body, current) {
  const password = body?.password
  if (!password && current?.passwordHash) return current.passwordHash
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) fail(400, 'A senha do funcionário administrativo deve ter entre 6 e 72 caracteres.')
  return bcrypt.hash(password, 12)
}
function accessCodeOf(body, current, employees) {
  const taken = new Set(employees.filter((item) => String(item.id) !== String(current?.id)).map((item) => item.accessCode).filter(Boolean))
  const accessCode = String(body?.accessCode ?? '').trim() || current?.accessCode || null
  if (accessCode && !/^\d{4}$/.test(accessCode)) fail(400, 'O código do operador deve ter exatamente 4 dígitos.')
  if (accessCode && taken.has(accessCode)) fail(409, 'Este código já está em uso por outro operador.')
  return accessCode || newAccessCode(taken)
}

// Adds the access columns to an existing database and gives every operator already registered a code.
export async function ensureEmployeeAccess(pool) {
  if (!pool) {
    const pending = (store) => (store.employees || []).filter((item) => !item.type || isOperator(item) && !item.accessCode)
    if (!pending(await readStore()).length) return
    return mutateStore((store) => {
      const taken = new Set(store.employees.map((item) => item.accessCode).filter(Boolean))
      for (const item of pending(store)) {
        item.type ||= 'operator'
        if (isOperator(item) && !item.accessCode) taken.add(item.accessCode = newAccessCode(taken))
      }
    })
  }
  const typeDefinition = "ENUM('operator', 'administrative', 'both') NOT NULL DEFAULT 'operator'"
  const [columns] = await pool.execute("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'")
  const names = new Set(columns.map((column) => column.name))
  // Databases created before the `both` type have the two-value ENUM.
  const typeColumn = columns.find((column) => column.name === 'employee_type')
  if (typeColumn && !String(typeColumn.type).includes("'both'")) await pool.execute(`ALTER TABLE employees MODIFY employee_type ${typeDefinition}`)
  for (const [name, definition] of [['employee_type', typeDefinition], ['access_code', 'CHAR(4) NULL UNIQUE'], ['password_hash', 'VARCHAR(255) NULL'], ['sector_id', 'VARCHAR(64) NULL'], ['sector_ids', 'TEXT NULL'], ['active', 'TINYINT(1) NOT NULL DEFAULT 1']]) {
    if (names.has(name)) continue
    try { await pool.execute(`ALTER TABLE employees ADD COLUMN ${name} ${definition}`) }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  }
  // Administrative employees have no 3-digit identification; birth date and e-mail are optional (the payroll list has neither).
  const [nullable] = await pool.execute("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND IS_NULLABLE = 'NO'")
  const required = new Set(nullable.map((column) => column.name))
  for (const [name, definition] of [['i_identificacao', 'CHAR(3) NULL'], ['birth_date', 'DATE NULL'], ['email', 'VARCHAR(160) NULL']]) if (required.has(name)) await pool.execute(`ALTER TABLE employees MODIFY ${name} ${definition}`)
  const [rows] = await pool.execute("SELECT id, access_code AS accessCode FROM employees WHERE employee_type IN ('operator', 'both')")
  const taken = new Set(rows.map((row) => row.accessCode).filter(Boolean))
  for (const row of rows.filter((item) => !item.accessCode)) {
    const code = newAccessCode(taken)
    taken.add(code)
    await pool.execute('UPDATE employees SET access_code = ? WHERE id = ? AND access_code IS NULL', [code, row.id])
  }
}
