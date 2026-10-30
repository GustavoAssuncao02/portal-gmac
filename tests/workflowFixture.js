import 'dotenv/config'
import express from 'express'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { configureWeb, serveInterface } from '../server/webServer.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function createWorkflowFixture({ pool, inventoryPool = pool, accountsEnv, notificationInventory, fillStageTimes = true, fillClassifications = true } = {}) {
  const results = path.join(root, 'test-results')
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, 'workflow-'))
  // The copied modules keep their data next to them; a DATA_DIR from the shell would point them at real data.
  delete process.env.DATA_DIR
  for (const name of ['planning.js', 'planningRules.js', 'offers.js', 'stageLabor.js', 'proposalEmails.js', 'stageCatalog.js', 'orderHistory.js', 'pieces.js', 'access.js', 'orderMaterials.js', 'pendingMaterials.js', 'operations.js', 'orderEditing.js', 'operatorAuth.js', 'employeeAccess.js', 'employeeActivity.js', 'serviceStages.js', 'machines.js', 'laborServices.js', 'accounts.js', 'reports.js', 'reportData.js', 'documentExports.js', 'payables.js', 'payableRules.js', 'receivables.js', 'bankStatements.js', 'ofx.js', 'materialRequests.js', 'notificationRules.js', 'notificationEvents.js', 'operationSessions.js', 'operationEventTime.js', 'operationManualEvents.js', 'materialRequestCodes.js', 'notifications.js', 'fiscalCatalog.js', 'dataDirectory.js', 'proposalDocuments.js', 'clientDocument.js', 'proposalDefaults.js', 'proposalPdf.js', 'proposalBrand.js', 'proposalMath.js', 'moneyWords.js', 'store.js', 'materialUnits.js', 'banks.js', 'operatorAccount.js', 'registries.js', 'requesters.js','serviceLocation.js', 'materialRequestSources.js', 'inventory.js', 'inventoryAppearance.js', 'materialIcons.js', 'uploads.js', 'machineUsage.js', 'accountPlan.js', 'accountPlanRules.js', 'dre.js', 'dreRules.js', 'dreExport.js', 'passwordReset.js']) {
    await copyFile(path.join(root, 'server', name), path.join(directory, name))
  }
  // PDFs use the bundled logo and fonts.
  await cp(path.join(root, 'server', 'assets'), path.join(directory, 'assets'), { recursive: true })
  // The store always lives in MySQL: each fixture gets its own empty database, dropped on close.
  const storeDatabase = await createTestDatabase('gmac_test_store')
  const { configureStore } = await import(pathToFileURL(path.join(directory, 'store.js')))
  await configureStore(storeDatabase.pool)
  const { default: createOffersRouter, mutateStore, readStore } = await import(pathToFileURL(path.join(directory, 'offers.js')))
  const { default: operationsRouter } = await import(pathToFileURL(path.join(directory, 'operations.js')))
  const { issueOperatorToken } = await import(pathToFileURL(path.join(directory, 'operatorAuth.js')))
  const { createAccountService, createAccountsRouter, issueAdminToken, requireAdmin, restrictStaffFinance } = await import(pathToFileURL(path.join(directory, 'accounts.js')))
  const { default: machinesRouter } = await import(pathToFileURL(path.join(directory, 'machines.js')))
  const { default: laborServicesRouter, ensureLaborServices } = await import(pathToFileURL(path.join(directory, 'laborServices.js')))
  await ensureLaborServices()
  const { default: reportsRouter } = await import(pathToFileURL(path.join(directory, 'reports.js')))
  const { default: payablesRouter } = await import(pathToFileURL(path.join(directory, 'payables.js')))
  const { default: receivablesRouter } = await import(pathToFileURL(path.join(directory, 'receivables.js')))
  const { default: bankStatementsRouter } = await import(pathToFileURL(path.join(directory, 'bankStatements.js')))
  const { default: materialRequestsRouter, saveRequestedMaterial } = await import(pathToFileURL(path.join(directory, 'materialRequests.js')))
  const { default: notificationsRouter } = await import(pathToFileURL(path.join(directory, 'notifications.js')))
  const { default: fiscalRouter } = await import(pathToFileURL(path.join(directory, 'fiscalCatalog.js')))
  const { default: proposalDocumentsRouter } = await import(pathToFileURL(path.join(directory, 'proposalDocuments.js')))
  const { default: operatorAccountRouter } = await import(pathToFileURL(path.join(directory, 'operatorAccount.js')))
  const { default: registriesRouter } = await import(pathToFileURL(path.join(directory, 'registries.js')))
  const { default: stageCatalogRouter } = await import(pathToFileURL(path.join(directory, 'stageCatalog.js')))
  const { default: requestersRouter } = await import(pathToFileURL(path.join(directory, 'requesters.js')))
  const { default: proposalEmailsRouter } = await import(pathToFileURL(path.join(directory, 'proposalEmails.js')))
  const { default: planningRouter } = await import(pathToFileURL(path.join(directory, 'planning.js')))
  const { default: inventoryRouter } = await import(pathToFileURL(path.join(directory, 'inventory.js')))
  const { default: accountPlanRouter } = await import(pathToFileURL(path.join(directory, 'accountPlan.js')))
  const { default: dreRouter } = await import(pathToFileURL(path.join(directory, 'dre.js')))
  const { default: passwordResetRouter } = await import(pathToFileURL(path.join(directory, 'passwordReset.js')))
  // The stock screens use the real SQL routes, on the tests' own MySQL pool or on the fixture database (simulated pools only answer execute).
  const stockPool = typeof inventoryPool?.query === 'function' ? inventoryPool : storeDatabase.pool
  for (const statement of await inventorySchema()) await stockPool.query(statement)
  const accounts = createAccountService(pool, accountsEnv || {})
  const app = express()
  // Same compression, cache and security headers as the published portal.
  configureWeb(app)
  app.use(express.json())
  app.use('/api', restrictStaffFinance)
  // Every classification belongs to a group of accounts and every receivable has a revenue classification. Most tests are
  // not about it: a classification created without a group goes to a test group (with the next free code), and a
  // receivable created without a classification gets a test revenue classification ("98.01 · Receita de teste", also
  // offered by the receivable forms once Contas a Receber, Tesouraria or the OS receipt is opened).
  // `fillClassifications: false` keeps the requests as sent (tests of the plan itself, which install GMAC's plan).
  if (fillClassifications) app.use('/api', async (request, _response, next) => {
    try {
      const classification = request.method === 'POST' && request.path === '/classifications' && request.body && !request.body.groupId
      const receivable = (request.method === 'POST' && request.path === '/receivables' || request.method === 'GET' && /^\/receivables(\/order\/[^/]+)?$/.test(request.path))
      if (!classification && !receivable) return next()
      await mutateStore((store) => {
        store.accountGroups ||= []; store.classifications ||= []
        const group = (code, name, dreLine) => store.accountGroups.find((row) => row.code === code) || store.accountGroups[store.accountGroups.push({ id: randomUUID(), code, name, dreLine, inactive: false }) - 1]
        if (classification) {
          const own = group('99', 'Grupo de testes', 'operating'), used = store.classifications.filter((row) => row.groupId === own.id).length
          Object.assign(request.body, { groupId: own.id, code: request.body.code || `99.${String(used + 1).padStart(2, '0')}`, behavior: request.body.behavior || 'variable' })
        }
        if (receivable) {
          const own = group('98', 'Receitas de teste', 'gross_revenue')
          let item = store.classifications.find((row) => row.groupId === own.id)
          if (!item) store.classifications.push(item = { id: randomUUID(), code: '98.01', name: 'Receita de teste', groupId: own.id, behavior: 'variable', dreLine: 'gross_revenue', inactive: false })
          if (request.method === 'POST' && request.body && !request.body.classificationId) request.body.classificationId = item.id
        }
      })
      next()
    } catch (error) { next(error) }
  })
  // The planned time and the machine or service of every stage are mandatory. Most tests are not about it: stages they
  // send without a time get 60 minutes, as a detailed offer has, and stages without a machine or service get the first
  // labor service. Once the offer is accepted, the OS loses those filled resources again, like an OS from before the
  // rule: the operator tests keep choosing their machine or service through the API. `fillStageTimes: false` keeps the
  // requests as sent (tests of the rule itself).
  const filledPlans = new Map()
  if (fillStageTimes) app.use('/api', async (request, _response, next) => {
    try {
      const offer = request.method === 'PUT' && request.path.match(/^\/offers\/([^/]+)\/resources$/)
      const resources = offer ? request.body : request.method === 'PUT' && /^\/operations\/orders\/[^/]+$/.test(request.path) ? request.body?.order?.resources : null
      if (!Array.isArray(resources?.stages)) return next()
      resources.stageTimes = { ...Object.fromEntries(resources.stages.map((code) => [code, 60])), ...Object.fromEntries(Object.entries(resources.stageTimes || {}).filter(([, minutes]) => minutes)) }
      const store = await readStore()
      const service = store.laborServices?.[0]
      if (!service) return next()
      const plans = { ...(resources.stageResources ?? (offer ? store.offers.find((item) => item.id === offer[1])?.resources?.stageResources : null) ?? {}) }
      const filled = resources.stages.filter((code) => !plans[code])
      for (const code of filled) plans[code] = { type: 'labor-service', id: service.id }
      resources.stageResources = plans
      if (offer && filled.length) filledPlans.set(offer[1], new Set([...(filledPlans.get(offer[1]) || []), ...filled]))
      next()
    } catch (error) { next(error) }
  })
  if (fillStageTimes) app.use('/api', async (request, response, next) => {
    const accept = request.method === 'POST' && request.path.match(/^\/offers\/([^/]+)\/accept$/)
    if (!accept) return next()
    // An offer accepted again (after an undone acceptance) gets its filled resources back for the acceptance.
    try {
      await mutateStore((store) => {
        const item = store.offers.find((entry) => entry.id === accept[1]), service = store.laborServices?.[0]
        const stages = item?.resources?.stages || []
        if (!item || item.orderCode || !service) return
        const missing = stages.filter((code) => !item.resources.stageResources?.[code])
        if (!missing.length) return
        item.resources.stageResources = { ...item.resources.stageResources, ...Object.fromEntries(missing.map((code) => [code, { type: 'labor-service', id: service.id, name: service.name }])) }
        filledPlans.set(accept[1], new Set([...(filledPlans.get(accept[1]) || []), ...missing]))
      })
    } catch (error) { return next(error) }
    const filled = filledPlans.get(accept[1])
    if (!filled?.size) return next()
    const send = response.json.bind(response)
    const filledHere = (plan, code, service) => filled.has(code) && plan?.type === 'labor-service' && String(plan.id) === String(service?.id)
    response.json = (body) => {
      if (response.statusCode >= 400) return send(body)
      mutateStore((store) => {
        const service = store.laborServices?.[0]
        for (const item of [store.offers.find((entry) => entry.id === accept[1]), store.orders.find((entry) => entry.offerId === accept[1])]) {
          for (const [code, plan] of Object.entries(item?.resources?.stageResources || {})) if (filledHere(plan, code, service)) delete item.resources.stageResources[code]
        }
        for (const [code, plan] of Object.entries(body?.item?.resources?.stageResources || {})) if (filledHere(plan, code, service)) delete body.item.resources.stageResources[code]
      }).then(() => { filledPlans.delete(accept[1]); send(body) }, next)
      return response
    }
    next()
  })
  app.use('/api', createOffersRouter(inventoryPool, requireAdmin, accounts))
  app.use('/api', operationsRouter(pool))
  app.use('/api', createAccountsRouter(accounts))
  app.use('/api', machinesRouter(requireAdmin, pool))
  app.use('/api', laborServicesRouter(requireAdmin, pool))
  app.use('/api', registriesRouter(requireAdmin, pool))
  app.use('/api', stageCatalogRouter(requireAdmin, pool))
  app.use('/api', requestersRouter(accounts, requireAdmin))
  app.use('/api', planningRouter(requireAdmin, pool))
  app.use('/api', operatorAccountRouter(requireAdmin))
  app.use('/api', reportsRouter(pool, accounts, requireAdmin))
  const payables = payablesRouter(accounts, requireAdmin)
  app.use('/api', payables)
  const receivables = receivablesRouter(accounts, requireAdmin, pool)
  app.use('/api', receivables)
  app.use('/api', accountPlanRouter(accounts, requireAdmin))
  app.use('/api', dreRouter(accounts, requireAdmin))
  // "Esqueci minha senha" never reaches an SMTP server: the e-mails stay in `sentMail`.
  const sentMail = []
  app.use('/api', passwordResetRouter(accounts, requireAdmin, { mailer: { configured: () => true, send: async (message) => { sentMail.push(message) } } }))
  // The proposal e-mails never reach an SMTP server either: they stay in `proposalMail` (`failMail` makes the next one fail).
  const proposalMail = []
  const mailControl = { failNext: false }
  app.use('/api', proposalEmailsRouter(accounts, requireAdmin, { env: { MAIL_FROM: 'comercial@gmacmetalurgica.com.br' }, mailer: { configured: () => true, send: async (message) => { if (mailControl.failNext) { mailControl.failNext = false; throw Object.assign(new Error('down'), { code: 'ECONNECTION' }) } proposalMail.push(message) } } }))
  app.use('/api', bankStatementsRouter(accounts, requireAdmin))
  // Tests never reach the Anthropic API; they pass a fake analysis.
  app.use('/api', fiscalRouter(requireAdmin))
  app.use('/api', proposalDocumentsRouter(requireAdmin))
  app.use('/api', notificationsRouter({ requireAdmin, payables, receivables, loadInventory: notificationInventory }))
  app.use('/api', materialRequestsRouter(requireAdmin, inventoryPool, accounts))
  app.use('/api', inventoryRouter(stockPool, requireAdmin))
  app.post('/api/auth/login', async (request, response, next) => {
    if (!accountsEnv) return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
    try {
      const user = await accounts.authenticate(request.body.cpf, request.body.password)
      if (!user) return response.status(401).json({ message: 'CPF ou senha inválidos.' })
      response.json({ user, token: await issueAdminToken(user) })
    } catch (error) { next(error) }
  })
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ message: error.message }))
  serveInterface(app, path.join(root, 'dist'))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const adminToken = await issueAdminToken({ id: 0 })
  return {
    url,
    directory,
    adminToken,
    admin: { Authorization: `Bearer ${adminToken}` },
    operatorToken: issueOperatorToken(),
    mutateStore,
    sentMail,
    proposalMail,
    failNextMail: () => { mailControl.failNext = true },
    // A server module of this fixture (same database), for start-up tasks the HTTP routes do not run.
    serverModule: (name) => import(pathToFileURL(path.join(directory, name))),
    saveRequestedMaterial,
    async request(route, method = 'GET', body, headers = {}) {
      const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      return { status: response.status, data: text ? JSON.parse(text) : null }
    },
    // The same request with the administrator session (the routes of offers, OS and registrations require it).
    // Uses `admin`, so a test that renews the session (after a password change) updates every later call.
    async adminRequest(route, method = 'GET', body, headers = this.admin) {
      return this.request(route, method, body, headers)
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await storeDatabase.drop()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

const inventorySchema = async () => (await readFile(path.join(root, 'database', 'schema.sql'), 'utf8')).match(/CREATE TABLE IF NOT EXISTS inventory_\w+ \([\s\S]*?\n\);/g)

const databaseOptions = () => ({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' })

// A throwaway database named `<prefix>_<uuid>`; `drop` removes it and closes the pool.
export async function createTestDatabase(prefix) {
  const name = `${prefix}_${randomUUID().replaceAll('-', '')}`
  if (!/^gmac_test_[a-z_]+_[a-f0-9]{32}$/.test(name)) throw new Error(`Nome de banco de teste inválido: ${name}`)
  const admin = await mysql.createConnection(databaseOptions())
  try { await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`) } finally { await admin.end() }
  const pool = mysql.createPool({ ...databaseOptions(), database: name, connectionLimit: 5 })
  return {
    name,
    pool,
    async drop() {
      await pool.end().catch(() => {})
      const connection = await mysql.createConnection(databaseOptions())
      try { await connection.query(`DROP DATABASE IF EXISTS \`${name}\``) } finally { await connection.end() }
    },
  }
}

export const offerDraft = { cnpj: '12345678000190', company: 'Teste de fluxo', deadline: '2026-12-20', service: 'Peca de teste', quantity: 10, description: 'Verificacao isolada do fluxo de materiais', labelNumber: 'TESTE' }
