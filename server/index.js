import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import mysql from 'mysql2/promise'
import createOffersRouter, { mutateStore } from './offers.js'
import createOperationsRouter from './operations.js'
import createLabelQuotesRouter from './labelQuotes.js'
import createEmailTemplatesRouter from './emailTemplates.js'
import { adminIdentity, createAccountService, createAccountsRouter, loadAdminSessions, requireAdmin, restrictStaffFinance } from './accounts.js'
import { ensureEmployeeAccess } from './employeeAccess.js'
import createLoginRouter, { testLoginEnabled } from './authLogin.js'
import createPasswordResetRouter from './passwordReset.js'
import { createLoginThrottle } from './loginThrottle.js'
import createOperatorAccountRouter, { loadOperatorAccount } from './operatorAccount.js'
import createMachinesRouter from './machines.js'
import createLaborServicesRouter, { ensureLaborServices } from './laborServices.js'
import createRegistriesRouter, { ensurePauseReasons, ensureSectors } from './registries.js'
import createRequestersRouter from './requesters.js'
import createRegistryHistoryRouter from './registryHistory.js'
import createProposalEmailsRouter from './proposalEmails.js'
import createStageCatalogRouter, { ensureStageCatalog } from './stageCatalog.js'
import { announceRelease } from './notificationEvents.js'
import { releaseNotes } from '../src/releaseNotes.js'
import { createSiteQuotes } from './siteQuotes/index.js'
import createPlanningRouter from './planning.js'
import createReportsRouter from './reports.js'
import createPayablesRouter from './payables.js'
import createReceivablesRouter from './receivables.js'
import createAccountPlanRouter, { ensureAccountPlan } from './accountPlan.js'
import createDreRouter from './dre.js'
import createBankStatementsRouter from './bankStatements.js'
import createFiscalRouter, { startFiscalCatalogSchedule, importJsonFiscalCatalog } from './fiscalCatalog.js'
import createProposalDocumentsRouter from './proposalDocuments.js'
import createInventoryImportRouter from './inventoryImport.js'
import createInventoryRouter from './inventory.js'
import createAdminInventoryRouter, { ensureAdminInventory, loadAdminInventoryRows } from './adminInventory.js'
import createMaterialRequestsRouter from './materialRequests.js'
import createNotificationsRouter from './notifications.js'
import createSupportTicketsRouter from './supportTickets.js'
import createNotesRouter from './notes.js'
import createOfferResponseNotices from './offerResponseNotices.js'
import createOfferRequestsRouter from './offerRequests.js'
import { inventorySignal } from './notificationEvents.js'
import { createApiRateLimiter } from './rateLimit.js'
import { ensureInventoryAppearance } from './inventoryAppearance.js'
import { configureWeb, serveInterface, trustProxySetting } from './webServer.js'
import { startDataBackups } from './dataBackup.js'
import { missingFilesReport, missingStoredFiles, storedFileInventory } from './storedFiles.js'
import { configureStore, importJsonStore, onStoreChange, readStore } from './store.js'
import { createLiveUpdates } from './liveUpdates.js'
import { requireAdminOrOperator } from './access.js'
import { apiErrorHandler, createSystemLog } from './systemLog.js'
import createDeveloperRouter from './developer.js'
import { createUpdateScheduler } from './updateSchedule.js'
import { developerCpfs } from './developers.js'
import { dataDirectory } from './dataDirectory.js'
import { enabled, flag, isProduction } from './envFlags.js'

const app = express()
const port = Number(process.env.PORT || 3002)
const host = process.env.API_HOST || '127.0.0.1'

const production = isProduction()
// Logs do sistema (tela Desenvolvedor): the output of the server, the failed or changing requests, the errors of the
// browsers and how the process starts and stops. Saved in the database once it is connected (below).
const systemLog = createSystemLog({
  crashFile: path.join(dataDirectory, 'logs', 'encerramentos.jsonl'),
  identify: (request) => {
    const session = adminIdentity(request)
    if (session) return { key: `${session.role || 'admin'}:${session.id}`, name: session.name || 'Sem nome', role: session.role || 'admin' }
    // The operator's tablet signs its requests with a token of two parts; each tablet is told apart by address and browser.
    if (String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').includes('.')) return { key: `operator:${request.ip}|${String(request.headers['user-agent'] || '').slice(0, 300)}`, name: 'Operador (tablet)', role: 'operator' }
    return null
  },
})
systemLog.captureConsole()
systemLog.watchProcess()
const corsOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)

app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY))
configureWeb(app)
app.use(['/api', '/gmac'], systemLog.requestLogger)
// The quote form of the main site (gmacmetalurgica.com.br) posts to /gmac/api/quotes. It comes before the portal's CORS and
// request limit: it answers only the sites in QUOTES_ALLOWED_ORIGINS, with its own limit of attempts.
const siteQuotes = createSiteQuotes()
app.use('/gmac', siteQuotes.app)
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
systemLog.connect(pool)
const restartNotes = systemLog.importLastWords()
if (restartNotes) console.log(`Registros do encerramento anterior do servidor recuperados: ${restartNotes}.`)
await configureStore(pool)
if (await importJsonStore(path.join(dataDirectory, 'offers.json'), path.join(dataDirectory, 'backups'))) console.log('Dados de offers.json importados para o banco; o arquivo foi movido para backups/.')
if (await importJsonFiscalCatalog(path.join(dataDirectory, 'fiscal-catalog.json'))) console.log('Catálogo fiscal importado para o banco.')
await ensureInventoryAppearance(pool)
await ensureAdminInventory(pool)

await ensureEmployeeAccess(pool)
await ensureLaborServices()
await ensureSectors()
// The stages come from "Etapas": the first start saves the stages the system always had.
await ensureStageCatalog()
// A new version of the portal: the bell tells everybody once (src/releaseNotes.js is the list of the versions).
if (!(await readStore()).operationalNotifications?.some((item) => item.id === `release:${releaseNotes[0].version}`)) await mutateStore((store) => { announceRelease(store, releaseNotes[0]) })
await ensurePauseReasons()
await ensureAccountPlan()
await loadOperatorAccount()
// The administrators keep their logins across a restart of the API: the open sessions come back from the database.
await loadAdminSessions()
// Live updates: the open screens hear of every saved change (store and API writes) instead of asking every 10 seconds.
const live = createLiveUpdates()
onStoreChange(live.fromStore)
app.use('/api', live.fromRequests)
app.use('/api', live.router(requireAdminOrOperator))
app.use('/api', restrictStaffFinance)
const accounts = createAccountService(pool)
// Ofertar Serviço do site: as rotas públicas ficam no mesmo app /gmac dos orçamentos (antes do CORS e do limite
// gerais da API) e usam o mesmo SMTP. Sem TURNSTILE_SECRET_KEY elas respondem 503 e o resto do portal segue normal.
siteQuotes.app.use('/api/offer-requests', createOfferRequestsRouter({ pool, accounts, sendMail: siteQuotes.sendMail, from: siteQuotes.from }))
app.use('/api', createOffersRouter(pool, requireAdmin, accounts))
app.use('/api', createOperationsRouter(pool))
app.use('/api', createLabelQuotesRouter({ pool, requireAdmin, accounts }))
app.use('/api', createEmailTemplatesRouter(requireAdmin))
app.use('/api', createAccountsRouter(accounts))
// One count of wrong passwords, cleared when the password is reset by e-mail.
const loginThrottle = createLoginThrottle()
app.use('/api', createLoginRouter(accounts, process.env, loginThrottle))
app.use('/api', createPasswordResetRouter(accounts, requireAdmin, { throttle: loginThrottle }))
app.use('/api', createOperatorAccountRouter(requireAdmin))
app.use('/api', createMachinesRouter(requireAdmin, pool))
app.use('/api', createLaborServicesRouter(requireAdmin, pool))
app.use('/api', createRegistriesRouter(requireAdmin, pool))
app.use('/api', createRequestersRouter(accounts, requireAdmin))
app.use('/api', createRegistryHistoryRouter(requireAdmin))
app.use('/api', createProposalEmailsRouter(accounts, requireAdmin))
app.use('/api', createStageCatalogRouter(requireAdmin, pool))
app.use('/api', createPlanningRouter(requireAdmin, pool))
app.use('/api', createReportsRouter(pool, accounts, requireAdmin))
app.use('/api', createInventoryImportRouter(pool, requireAdmin))
app.use('/api', createMaterialRequestsRouter(requireAdmin, pool, accounts))
const payablesRouter = createPayablesRouter(accounts, requireAdmin)
app.use('/api', payablesRouter)
const receivablesRouter = createReceivablesRouter(accounts, requireAdmin, pool)
app.use('/api', receivablesRouter)
app.use('/api', createAccountPlanRouter(accounts, requireAdmin))
app.use('/api', createDreRouter(accounts, requireAdmin))
app.use('/api', createBankStatementsRouter(accounts, requireAdmin))
app.use('/api', createFiscalRouter(requireAdmin))
app.use('/api', createProposalDocumentsRouter(requireAdmin, accounts))
app.use('/api', createSupportTicketsRouter(accounts, requireAdmin))
// Anotações e Tarefas: the reminders and the notices of a task near its day are checked every minute.
const notesRouter = createNotesRouter(accounts, requireAdmin)
// TCK-0012: the notices of the deadline for the client to answer a proposal, at 07:30 (checked every minute).
const offerResponseNotices = createOfferResponseNotices({ people: () => accounts.people() })
setInterval(() => offerResponseNotices.sweep().catch((error) => console.error('Falha ao verificar os prazos de resposta das ofertas:', error.message)), 60000).unref()
app.use('/api', notesRouter)
setInterval(() => notesRouter.sweep().catch((error) => console.error('Falha ao verificar os lembretes das tarefas:', error.message)), 60000).unref()
// Programar atualização (Desenvolvedor): the notices, the countdown and, at the hour, the update through the SaveInCloud.
// This start may be the update itself: boot() closes it. The schedule is checked every 15 seconds.
const updateScheduler = createUpdateScheduler({ readStore, mutateStore, version: releaseNotes[0]?.version || null, log: (message) => console.log(message),
  developerIds: async () => (await Promise.all(developerCpfs.map((cpf) => accounts.accountByCpf(cpf)))).filter(Boolean).map((account) => account.id) })
await updateScheduler.boot().catch((error) => console.error('Falha ao conferir a atualização programada:', error.message))
setInterval(() => updateScheduler.sweep().catch((error) => console.error('Falha ao verificar a atualização programada:', error.message)), 15000).unref()
app.use('/api', createDeveloperRouter({ accounts, requireAdmin, requireSession: requireAdminOrOperator, systemLog, live, pool, readStore, dataDirectory, interfaceDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'), updates: updateScheduler, version: releaseNotes[0] ? { version: releaseNotes[0].version, date: releaseNotes[0].date } : null, config: () => ({
  environment: production ? 'produção' : 'desenvolvimento', nodeEnv: process.env.NODE_ENV || '', host, port, database: `${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`,
  dataDir: Boolean(process.env.DATA_DIR), smtp: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every((key) => process.env[key]?.trim()), turnstile: Boolean(process.env.TURNSTILE_SECRET_KEY), testLogin: testLoginEnabled(),
  corsOrigins: corsOrigins.length, apiRateLimit: Number(process.env.API_RATE_LIMIT) || 200, trustProxy: process.env.TRUST_PROXY || '(padrão)', fiscalCatalogSync: flag(process.env.FISCAL_CATALOG_SYNC) !== 'off',
  automaticUpdate: updateScheduler.automatic(), openOfferDefaultCpfs: Boolean(process.env.OPEN_OFFER_DEFAULT_CPFS), supportTicketEmails: Boolean(process.env.SUPPORT_TICKET_EMAILS), quotesAllowedOrigins: String(process.env.QUOTES_ALLOWED_ORIGINS || '').split(',').filter((item) => item.trim()).length,
}) }))
const notificationsRouter = createNotificationsRouter({ requireAdmin, payables: payablesRouter, receivables: receivablesRouter, loadInventory: async () => {
  const [rows] = await pool.execute('SELECT id, name, unit, quantity_kg AS quantity, minimum_kg AS minimum FROM inventory_materials')
  return [...rows, ...await loadAdminInventoryRows(pool)]
} })
app.use('/api', notificationsRouter)
const refreshInventoryNotifications = () => notificationsRouter.sweepInventory().catch((error) => console.error('Falha ao verificar avisos de estoque:', error.message))
const recordInventoryNotification = (row, previousLow) => mutateStore((store) => inventorySignal(store, row, previousLow)).catch((error) => console.error('Falha ao registrar aviso de estoque:', error.message))
await refreshInventoryNotifications()
setInterval(refreshInventoryNotifications, 10000).unref()
setInterval(() => payablesRouter.sweep().catch((error) => console.error('Falha ao verificar vencimentos:', error.message)), 60000).unref()
startDataBackups(dataDirectory, readStore)
// Attachments live in the data folder. Without DATA_DIR on a volume a redeploy erases the files and keeps their records,
// and the attachment then fails to open: the log says where the files are and how many are missing.
console.log(`Pasta de dados e anexos: ${dataDirectory}`)
if (!process.env.DATA_DIR && (production || host !== '127.0.0.1')) console.warn('ATENCAO: DATA_DIR não definido. Os anexos ficam dentro da pasta do código e são apagados a cada deploy; aponte DATA_DIR para uma pasta declarada como volume.')
readStore().then((store) => missingStoredFiles(storedFileInventory(store, dataDirectory))).then((areas) => { for (const line of missingFilesReport(areas)) console.log(line) }).catch((error) => console.error('Falha ao conferir os anexos:', error.message))
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
app.use('/api', createAdminInventoryRouter(pool, requireAdmin, { recordInventoryNotification }))

const interfacePublished = serveInterface(app, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'))

app.use(apiErrorHandler)

const server = app.listen(port, host, () => {
  console.log(`API GMAC disponível em http://${host}:${port}`)
  if (interfacePublished) console.log('Interface publicada no mesmo endereço, a partir de dist/.')
  else if (production) console.warn('ATENCAO: dist/ não encontrado. Execute "npm run build" para publicar a interface.')
  if (testLoginEnabled()) console.warn('ATENCAO: acesso sem senha ativado para testes. Desative TEST_LOGIN_ENABLED antes de publicar o portal.')
  else if (enabled(process.env.TEST_LOGIN_ENABLED)) console.warn('ATENCAO: TEST_LOGIN_ENABLED foi ignorado e o login continua exigindo senha. O acesso sem senha só funciona com a API e o banco neste computador (API_HOST e DB_HOST locais) e sem NODE_ENV=production.')
  siteQuotes.start()
  systemLog.record({ level: 'info', source: 'system', message: `Servidor iniciado: versão ${releaseNotes[0]?.version || '?'}, Node ${process.version}, ${production ? 'produção' : 'desenvolvimento'}, porta ${port}.` })
})
// Logs older than 30 days leave the database: at the start and every six hours.
const pruneLogs = () => systemLog.prune().then((removed) => { if (removed) console.log(`Logs do sistema com mais de 30 dias removidos: ${removed}.`) }).catch((error) => console.error('Falha ao limpar os logs antigos:', error.message))
pruneLogs()
setInterval(pruneLogs, 6 * 60 * 60 * 1000).unref()
// A big attachment (up to the limit of uploads.js) on a slow connection takes as long as it needs. Node would end any
// request after 5 minutes; the headers still have their own short limit (60 s), and a body that stalls is dropped by
// bodyProgressGuard (webServer.js).
server.requestTimeout = 0
