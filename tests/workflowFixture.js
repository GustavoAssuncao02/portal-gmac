import express from 'express'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function createWorkflowFixture({ pool, accountsEnv } = {}) {
  const results = path.join(root, 'test-results')
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, 'workflow-'))
  for (const name of ['offers.js', 'operations.js', 'operatorAuth.js', 'employeeActivity.js', 'serviceStages.js', 'machines.js', 'accounts.js', 'reports.js', 'reportData.js', 'payables.js', 'payableRules.js', 'materialRequests.js']) {
    await copyFile(path.join(root, 'server', name), path.join(directory, name))
  }
  const { default: offersRouter, mutateStore } = await import(pathToFileURL(path.join(directory, 'offers.js')))
  const { default: operationsRouter } = await import(pathToFileURL(path.join(directory, 'operations.js')))
  const { issueOperatorToken } = await import(pathToFileURL(path.join(directory, 'operatorAuth.js')))
  const { createAccountService, createAccountsRouter, issueAdminToken, requireAdmin } = await import(pathToFileURL(path.join(directory, 'accounts.js')))
  const { default: machinesRouter } = await import(pathToFileURL(path.join(directory, 'machines.js')))
  const { default: reportsRouter } = await import(pathToFileURL(path.join(directory, 'reports.js')))
  const { default: payablesRouter } = await import(pathToFileURL(path.join(directory, 'payables.js')))
  const { default: materialRequestsRouter } = await import(pathToFileURL(path.join(directory, 'materialRequests.js')))
  const accounts = createAccountService(pool, accountsEnv || {})
  const app = express()
  app.use(express.json())
  app.use('/api', offersRouter)
  app.use('/api', operationsRouter(pool))
  app.use('/api', createAccountsRouter(accounts))
  app.use('/api', machinesRouter(requireAdmin))
  app.use('/api', reportsRouter(pool, accounts, requireAdmin))
  app.use('/api', payablesRouter(accounts, requireAdmin))
  app.use('/api', materialRequestsRouter(requireAdmin))
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
  app.use(express.static(path.join(root, 'dist')))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    operatorToken: issueOperatorToken(),
    mutateStore,
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
