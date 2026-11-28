import { invoicePdf, sampleNfe, sampleNfse } from './invoiceSample.js'

// The NF-e of an OS in the browser tests (src/OrderInvoiceModal.jsx): a fictitious invoice of the client of the OS is
// chosen in the window "NF-e · <OS>", checked as the user would, and "Concluir OS" (or `submit`) attaches it, generating
// the account receivable. The client is registered by the API first, before `open` opens the window (it loads the clients).
// `kind`: 'nfse' (one due date, `due`) or 'nfe' (a DANFE with its duplicates, `dues`: [{ due, cents }]).
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const br = (iso) => iso.split('-').reverse().join('/')

export async function invoiceFor({ kind = 'nfse', cnpj, company, number = '2026000000777', valueCents, issCents = 0, issued, due, dues = [] }) {
  const document = String(cnpj).replace(/\D/g, ''), customer = company.toUpperCase()
  if (kind === 'nfe') return invoicePdf([{ ...sampleNfe, customer, document, issued: br(issued), value: brl(valueCents), dues: dues.map((part, index) => [String(index + 1).padStart(3, '0'), br(part.due), brl(part.cents)]) }])
  const net = valueCents - issCents
  return invoicePdf([{ ...sampleNfse, number, customer, document, value: brl(valueCents), iss: brl(issCents), net: brl(net), issued: br(issued), dues: `${br(due)} - R$${brl(net)}` }])
}

export async function attachOrderInvoice({ fixture, page, open, code, cnpj, company, kind = 'nfse', number = '2026000000777', valueCents, issCents = 0, issued, due, dues, classification, submit = 'Concluir OS', headers = fixture.admin }) {
  const clients = (await fixture.request('/clients', 'GET', undefined, headers)).data?.items || []
  const digits = String(cnpj).replace(/\D/g, '')
  if (!clients.some((client) => String(client.document || '').replace(/\D/g, '') === digits)) await fixture.request('/clients', 'POST', { name: company, document: digits, documentType: digits.length === 11 ? 'cpf' : 'cnpj' }, headers)
  await open()
  const dialog = page.getByRole('dialog', { name: `NF-e · ${code}`, exact: true })
  const pdf = await invoiceFor({ kind, cnpj, company, number, valueCents, issCents, issued, due, dues })
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'nota.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  const title = kind === 'nfe' ? `NF-e ${sampleNfe.number}` : `NFS-e ${number}`
  const card = dialog.getByRole('article', { name: title, exact: true })
  await card.waitFor()
  if (classification) await card.getByLabel(`Classificação de ${title}`, { exact: true }).selectOption({ label: classification })
  await dialog.getByRole('button', { name: submit, exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
}
