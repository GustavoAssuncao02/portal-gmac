import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { todayBahia } from '../server/payableRules.js'

const prefix = 'DEMO-CP-2026'
const classifications = ['Mat\u00e9ria-prima', 'Ferramentas e consum\u00edveis', 'Manuten\u00e7\u00e3o de m\u00e1quinas', 'Energia el\u00e9trica', '\u00c1gua e utilidades', 'Fretes e log\u00edstica', 'Servi\u00e7os terceirizados', 'Aluguel e estrutura', 'Tecnologia e sistemas', 'EPIs e seguran\u00e7a']
const suppliers = ['MetalSul Materiais', 'Precis\u00e3o Ferramentas', 'Oficina Industrial', 'Energia Industrial', 'Utilidades Bahia', 'Rota Cargas', 'Acabamentos T\u00e9cnicos', 'Galp\u00e3o Empresarial', 'Sistemas Oficina', 'Prote\u00e7\u00e3o Industrial']
const descriptions = ['Chapas e barras para fabrica\u00e7\u00e3o', 'Pastilhas e brocas para usinagem', 'Manuten\u00e7\u00e3o preventiva de equipamentos', 'Consumo de energia do galp\u00e3o', 'Abastecimento e utilidades', 'Transporte de materiais e pe\u00e7as', 'Tratamento e acabamento de pe\u00e7as', 'Loca\u00e7\u00e3o da estrutura industrial', 'Licen\u00e7as e suporte de sistemas', 'Equipamentos de prote\u00e7\u00e3o individual']
const date = (month, day) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export async function populatePayables(request, today = todayBahia()) {
  const catalog = await request('/payables')
  const supplierIds = [], classificationIds = []
  for (let index = 0; index < classifications.length; index++) {
    const classificationName = `${classifications[index]} (Teste)`
    const existing = catalog.classifications.find((row) => row.name === classificationName)
    classificationIds.push(existing?.id || (await request('/classifications', 'POST', { name: classificationName })).item.id)
    const document = String(101 + index).padStart(14, '0')
    const current = catalog.suppliers.find((row) => row.document === document)
    supplierIds.push(current?.id || (await request('/suppliers', 'POST', { name: `${suppliers[index]} (Fict\u00edcio)`, document, email: `fornecedor${index + 1}@example.invalid`, phone: '' })).item.id)
  }
  const existingDocuments = new Set(catalog.items.map((row) => row.documentNumber))
  let created = 0, paid = 0, deactivated = 0
  async function create(body, payEligible = false, archive = false) {
    if (existingDocuments.has(body.documentNumber)) return
    const { items } = await request('/payables', 'POST', { ...body, description: `${body.description} [DEMO]` })
    existingDocuments.add(body.documentNumber); created += items.length
    for (const row of items) {
      if (!payEligible || row.dueDate > today) continue
      const adjustment = paid % 5 === 0 ? { interest: '12.50' } : paid % 5 === 1 ? { discount: '8.00' } : {}
      await request(`/payables/${row.id}/pay`, 'POST', { date: row.dueDate, method: ['pix', 'boleto', 'card'][paid % 3], note: 'Pagamento fict\u00edcio para demonstra\u00e7\u00e3o do m\u00f3dulo.', ...adjustment })
      paid++
      if (archive) { await request(`/payables/${row.id}/activation`, 'POST', { inactive: true }); deactivated++ }
    }
  }
  for (let month = 9; month <= 12; month++) {
    for (let day = 1; day <= 21; day++) {
      const index = (day - 1 + (month - 9) * 2) % 10
      const value = (15900 + (((month - 9) * 21 + day) * 13753 % 550000) + day).toString()
      await create({ supplierId: supplierIds[index], classificationId: classificationIds[index], description: `${descriptions[index]} - lote ${day}`, documentNumber: `${prefix}-N-${month}-${day}`, issueDate: date(month, 1), dueDate: date(month, day), value: (Number(value) / 100).toFixed(2), kind: 'normal' }, day % 3 !== 0, day % 8 === 0)
    }
    for (let index = 0; index < 3; index++) {
      const supplierIndex = [7, 8, 3][index]
      await create({ supplierId: supplierIds[supplierIndex], classificationId: classificationIds[supplierIndex], description: `${['Aluguel mensal do galp\u00e3o', 'Assinatura de sistemas', 'Contrato de fornecimento de energia'][index]} - ${month}/2026`, documentNumber: `${prefix}-R-${month}-${index}`, issueDate: date(month, 1), dueDate: date(month, [24, 27, 30][index]), value: ['2499.00', '499.00', '1299.00'][index], kind: 'recurring', recurrence: 'monthly' }, true)
    }
  }
  for (let index = 0; index < 6; index++) await create({ supplierId: supplierIds[index], classificationId: classificationIds[index], description: `Compra parcelada - ${descriptions[index]}`, documentNumber: `${prefix}-P-${index}`, issueDate: date(9, 1), dueDate: date(9, 2 + index * 4), value: ((150000 + index * 37647) / 100).toFixed(2), kind: 'installment', count: 4 }, index % 2 === 0)
  const final = await request('/payables')
  const demo = final.items.filter((row) => row.documentNumber.startsWith(prefix))
  if (demo.length < 100 || demo.some((row) => row.dueDate < '2026-09-01' || row.dueDate > '2026-12-30')) throw new Error('A popula\u00e7\u00e3o n\u00e3o corresponde ao per\u00edodo e quantidade solicitados.')
  return { created, paid, deactivated, totalDemo: demo.length, suppliers: supplierIds.length, classifications: classificationIds.length, months: Object.fromEntries([9, 10, 11, 12].map((month) => [date(month, 1).slice(0, 7), demo.filter((row) => row.dueDate.slice(0, 7) === date(month, 1).slice(0, 7)).length])) }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = `http://127.0.0.1:${process.env.PORT || 3002}/api`
  let token
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${root}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || `Falha em ${route}.`)
    return data
  }
  try {
    if (!process.env.DEMO_ADMIN_CPF || !process.env.DEMO_ADMIN_PASSWORD) throw new Error('Configure as credenciais administrativas locais antes de popular o m\u00f3dulo.')
    token = (await request('/auth/login', 'POST', { cpf: process.env.DEMO_ADMIN_CPF.replace(/\D/g, ''), password: process.env.DEMO_ADMIN_PASSWORD })).token
    console.log(JSON.stringify(await populatePayables(request)))
  } finally { if (token) await request('/auth/logout', 'POST').catch(() => {}) }
}
