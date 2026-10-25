import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import mysql from 'mysql2/promise'
import createOffersRouter, { mutateStore } from './offers.js'
import createOperationsRouter from './operations.js'
import { createAccountService, createAccountsRouter, loadAdminSessions, requireAdmin, restrictStaffFinance } from './accounts.js'
import { ensureEmployeeAccess } from './employeeAccess.js'
import createLoginRouter, { testLoginEnabled } from './authLogin.js'
import createOperatorAccountRouter, { loadOperatorAccount } from './operatorAccount.js'
import createMachinesRouter from './machines.js'
import createLaborServicesRouter, { ensureLaborServices } from './laborServices.js'
import createRegistriesRouter, { ensurePauseReasons, ensureSectors } from './registries.js'
import createPlanningRouter from './planning.js'
import createReportsRouter from './reports.js'
import createPayablesRouter from './payables.js'
import createReceivablesRouter from './receivables.js'
import createBankStatementsRouter from './bankStatements.js'
import createFiscalRouter, { startFiscalCatalogSchedule, importJsonFiscalCatalog } from './fiscalCatalog.js'
import createProposalDocumentsRouter from './proposalDocuments.js'
import createInventoryImportRouter from './inventoryImport.js'
import createInventoryRouter from './inventory.js'
import createMaterialRequestsRouter from './materialRequests.js'
import createNotificationsRouter from './notifications.js'
import { inventorySignal } from './notificationEvents.js'
import { createApiRateLimiter } from './rateLimit.js'
import { ensureInventoryAppearance } from './inventoryAppearance.js'
import { configureWeb, serveInterface, trustProxySetting } from './webServer.js'
import { startDataBackups } from './dataBackup.js'
import { configureStore, importJsonStore, readStore } from './store.js'
import { dataDirectory } from './dataDirectory.js'
import { flag, isProduction } from './envFlags.js'

const app = express()
const port = Number(process.env.PORT || 3002)
const host = process.env.API_HOST || '127.0.0.1'

const production = isProduction()
const corsOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)

app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY))
configureWeb(app)
// The interface and the API share one address, so a published portal answers other sites only when CORS_ORIGIN lists them.
if (corsOrigins.length) app.use(cors({ origin: corsOrigins }))
else if (!production) app.use(cors())
app.use('/api', createApiRateLimiter({ limit: Number(process.env.API_RATE_LIMIT) || 200 }))
app.use(express.json())

// Every piece of data lives in MySQL; uploaded files (attachments, receipts, OFX statements) stay in DATA_DIR and the
// database keeps their names and paths. Without the database the portal does not start.
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
  console.error('O banco de dados é obrigatório: configure DB_HOST, DB_USER, DB_PASSWORD e DB_NAME (veja .env.example).')
  process.exit(1)
}
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
})
await configureStore(pool)
if (await importJsonStore(path.join(dataDirectory, 'offers.json'), path.join(dataDirectory, 'backups'))) console.log('Dados de offers.json importados para o banco; o arquivo foi movido para backups/.')
if (await importJsonFiscalCatalog(path.join(dataDirectory, 'fiscal-catalog.json'))) console.log('Catálogo fiscal importado para o banco.')
await ensureInventoryAppearance(pool)

await ensureEmployeeAccess(pool)
await ensureLaborServices()
await ensureSectors()
await ensurePauseReasons()
await loadOperatorAccount()
// The administrators keep their logins across a restart of the API: the open sessions come back from the database.
await loadAdminSessions()
app.use('/api', restrictStaffFinance)
app.use('/api', createOffersRouter(pool, requireAdmin))
app.use('/api', createOperationsRouter(pool))
const accounts = createAccountService(pool)
app.use('/api', createAccountsRouter(accounts))
app.use('/api', createLoginRouter(accounts))
app.use('/api', createOperatorAccountRouter(requireAdmin))
app.use('/api', createMachinesRouter(requireAdmin, pool))
app.use('/api', createLaborServicesRouter(requireAdmin, pool))
app.use('/api', createRegistriesRouter(requireAdmin, pool))
app.use('/api', createPlanningRouter(requireAdmin, pool))
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
  const [rows] = await pool.execute('SELECT id, name, unit, quantity_kg AS quantity, minimum_kg AS minimum FROM inventory_materials')
  return rows
} })
app.use('/api', notificationsRouter)
const refreshInventoryNotifications = () => notificationsRouter.sweepInventory().catch((error) => console.error('Falha ao verificar avisos de estoque:', error.message))
const recordInventoryNotification = (row, previousLow) => mutateStore((store) => inventorySignal(store, row, previousLow)).catch((error) => console.error('Falha ao registrar aviso de estoque:', error.message))
await refreshInventoryNotifications()
setInterval(refreshInventoryNotifications, 10000).unref()
setInterval(() => payablesRouter.sweep().catch((error) => console.error('Falha ao verificar vencimentos:', error.message)), 60000).unref()
startDataBackups(dataDirectory, readStore)
setInterval(() => receivablesRouter.sweep().catch((error) => console.error('Falha ao verificar recebimentos:', error.message)), 60000).unref()
// CNAE, NCM, NBS and the companies' registered activities are refreshed every Sunday at midnight.
if (flag(process.env.FISCAL_CATALOG_SYNC) !== 'off') startFiscalCatalogSchedule()

app.get('/api/health', async (_request, response) => {
  try {
    await pool.execute('SELECT 1')
    response.json({ status: 'ok', databaseConfigured: true, databaseConnected: true })
  } catch {
    response.status(503).json({ status: 'unavailable', databaseConfigured: true, databaseConnected: false })
  }
})

app.use('/api', createInventoryRouter(pool, requireAdmin, { recordInventoryNotification, refreshInventoryNotifications }))

const interfacePublished = serveInterface(app, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'))

app.use((error, _request, response, _next) => {
  console.error('Falha na API:', error.message)
  response.status(error.status || 500).json({ message: error.status ? error.message : 'Não foi possível concluir a operação.' })
})

const server = app.listen(port, host, () => {
  console.log(`API GMAC disponível em http://${host}:${port}`)
  if (interfacePublished) console.log('Interface publicada no mesmo endereço, a partir de dist/.')
  else if (production) console.warn('ATENCAO: dist/ não encontrado. Execute "npm run build" para publicar a interface.')
  if (testLoginEnabled()) console.warn('ATENCAO: acesso sem senha ativado para testes. Desative TEST_LOGIN_ENABLED antes de publicar o portal.')
})
// Attachments have no size limit: a big file on a slow connection takes as long as it needs. Node would end any request
// after 5 minutes; the headers still have their own short limit.
server.requestTimeout = 0
