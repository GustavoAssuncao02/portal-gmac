// Local regression snapshot: store response hashes, never credentials or business data.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const base = process.env.GMAC_API_URL || 'http://localhost:5174/api'
const output = new URL('../test-results/sql-api-baseline.json', import.meta.url)
const dynamicFields = new Set(['idle', 'usage', 'usageMs', 'generatedAt'])
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => !dynamicFields.has(key)).map((key) => [key, stable(value[key])]))
  return value
}
async function request(route, token, method = 'GET') {
  const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(30000) })
  return { status: response.status, data: await response.json() }
}
assert.equal((await request('/auth/config')).data.testLoginEnabled, true, 'This check uses the already enabled local test login.')
const admin = (await request('/auth/login', null, 'POST')).data.token
const operator = (await request('/auth/operator-login', null, 'POST')).data.token
assert.ok(admin && operator)
try {
  const routes = ['/auth/config', '/admins', '/clients', '/payables', '/receivables', '/offers', '/orders', '/operations/orders', '/operations/operator/orders', '/employees', '/inventory', '/machines', '/labor-services', '/reports/catalog']
  const employees = (await request('/employees', admin)).data.items
  for (const employee of employees) for (const period of ['today', 'all']) routes.push(`/employees/${encodeURIComponent(employee.id)}/activities?period=${period}`)
  const results = {}
  for (const route of routes) for (const [role, token] of [['admin', admin], ['operator', operator], ['anonymous', null]]) {
    const response = await request(route, token)
    assert.ok(response.status !== 429 && response.status < 500, `Unavailable: ${role} ${route}`)
    results[`${role} ${route}`] = { status: response.status, sha256: createHash('sha256').update(JSON.stringify(stable(response.data))).digest('hex') }
  }
  if (process.argv.includes('--record')) {
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true })
    await writeFile(output, JSON.stringify(results, null, 2))
    console.log(`Recorded ${Object.keys(results).length} API response hashes.`)
  } else {
    assert.deepEqual(results, JSON.parse(await readFile(output, 'utf8')))
    console.log(`Verified ${Object.keys(results).length} API responses: same data, ordering and access decisions (elapsed-time display fields excluded).`)
  }
} finally {
  await request('/auth/logout', admin, 'POST')
}
