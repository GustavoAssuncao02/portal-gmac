import express from 'express'
import { copyFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { configureWeb, serveInterface } from '../server/webServer.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function createWorkflowFixture({ pool, inventoryPool = pool, accountsEnv, notificationInventory, aiAnalyze } = {}) {
  const results = path.join(root, 'test-results')
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, 'workflow-'))
  for (const name of ['offers.js', 'orderMaterials.js', 'pendingMaterials.js', 'operations.js', 'orderEditing.js', 'operatorAuth.js', 'employeeActivity.js', 'serviceStages.js', 'machines.js', 'laborServices.js', 'accounts.js', 'reports.js', 'reportData.js', 'documentExports.js', 'payables.js', 'payableRules.js', 'receivables.js', 'bankStatements.js', 'aiReconciliation.js', 'ofx.js', 'materialRequests.js', 'notificationRules.js', 'notificationEvents.js', 'operationSessions.js', 'materialRequestCodes.js', 'notifications.js', 'fiscalCatalog.js', 'proposalDocuments.js', 'proposalDefaults.js', 'proposalPdf.js', 'proposalBrand.js', 'proposalMath.js', 'moneyWords.js']) {
    await copyFile(path.join(root, 'server', name), path.join(directory, name))
  }
  // PDFs use the bundled logo and fonts.
  await cp(path.join(root, 'server', 'assets'), path.join(directory, 'assets'), { recursive: true })
  const { default: createOffersRouter, mutateStore } = await import(pathToFileURL(path.join(directory, 'offers.js')))
  const { default: operationsRouter } = await import(pathToFileURL(path.join(directory, 'operations.js')))
  const { issueOperatorToken } = await import(pathToFileURL(path.join(directory, 'operatorAuth.js')))
  const { createAccountService, createAccountsRouter, issueAdminToken, requireAdmin } = await import(pathToFileURL(path.join(directory, 'accounts.js')))
  const { default: machinesRouter } = await import(pathToFileURL(path.join(directory, 'machines.js')))
  const { default: laborServicesRouter, ensureLaborServices } = await import(pathToFileURL(path.join(directory, 'laborServices.js')))
  await ensureLaborServices()
  const { default: reportsRouter } = await import(pathToFileURL(path.join(directory, 'reports.js')))
  const { default: payablesRouter } = await import(pathToFileURL(path.join(directory, 'payables.js')))
  const { default: receivablesRouter } = await import(pathToFileURL(path.join(directory, 'receivables.js')))
  const { default: bankStatementsRouter } = await import(pathToFileURL(path.join(directory, 'bankStatements.js')))
  const { default: aiReconciliationRouter } = await import(pathToFileURL(path.join(directory, 'aiReconciliation.js')))
  const { default: materialRequestsRouter, saveRequestedMaterial } = await import(pathToFileURL(path.join(directory, 'materialRequests.js')))
  const { default: notificationsRouter } = await import(pathToFileURL(path.join(directory, 'notifications.js')))
  const { default: fiscalRouter } = await import(pathToFileURL(path.join(directory, 'fiscalCatalog.js')))
  const { default: proposalDocumentsRouter } = await import(pathToFileURL(path.join(directory, 'proposalDocuments.js')))
  const accounts = createAccountService(pool, accountsEnv || {})
  const app = express()
  // Same compression, cache and security headers as the published portal.
  configureWeb(app)
  app.use(express.json())
  app.use('/api', createOffersRouter(inventoryPool, requireAdmin))
  app.use('/api', operationsRouter(pool))
  app.use('/api', createAccountsRouter(accounts))
  app.use('/api', machinesRouter(requireAdmin, pool))
  app.use('/api', laborServicesRouter(requireAdmin, pool))
  app.use('/api', reportsRouter(pool, accounts, requireAdmin))
  const payables = payablesRouter(accounts, requireAdmin)
  app.use('/api', payables)
  const receivables = receivablesRouter(accounts, requireAdmin)
  app.use('/api', receivables)
  app.use('/api', bankStatementsRouter(accounts, requireAdmin))
  // Tests never reach the Anthropic API; they pass a fake analysis.
  app.use('/api', aiReconciliationRouter(accounts, requireAdmin, { analyze: aiAnalyze || (async () => { throw new Error('Análise com IA não configurada neste teste.') }) }))
  app.use('/api', fiscalRouter(requireAdmin))
  app.use('/api', proposalDocumentsRouter(requireAdmin))
  app.use('/api', notificationsRouter({ requireAdmin, payables, receivables, loadInventory: notificationInventory }))
  app.use('/api', materialRequestsRouter(requireAdmin, inventoryPool, accounts))
  app.get('/api/inventory', (_request, response) => response.status(503).json({ message: 'O banco de dados ainda não está configurado.' }))
  app.post('/api/auth/login', async (request, response, next) => {
    if (!accountsEnv) return response.status(503).json({ message: 'O banco de dados ainda não está configurado.' })
    try {
      const user = await accounts.authenticate(request.body.cpf, request.body.password)
      if (!user) return response.status(401).json({ message: 'CPF ou senha inválidos.' })
      response.json({ user, token: issueAdminToken(user) })
    } catch (error) { next(error) }
  })
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ message: error.message }))
  serveInterface(app, path.join(root, 'dist'))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    directory,
    adminToken: issueAdminToken({ id: 0 }),
    operatorToken: issueOperatorToken(),
    mutateStore,
    saveRequestedMaterial,
    async request(route, method = 'GET', body, headers = {}) {
      const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: response.status, data: await response.json() }
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export const offerDraft = { cnpj: '12345678000190', company: 'Teste de fluxo', deadline: '2026-12-20', service: 'Peca de teste', quantity: 10, description: 'Verificacao isolada do fluxo de materiais', labelNumber: 'TESTE' }
