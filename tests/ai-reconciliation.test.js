import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { parseOfx } from '../server/ofx.js'
import { buildAnalysisData, userPrompt, extractHtml, assembleReport, SYSTEM_PROMPT } from '../server/aiReconciliation.js'
import { sampleOfx, sampleRows } from './ofxSample.js'

const payment = { date: '2026-10-01', method: 'pix', interestCents: 0, discountCents: 0, finalCents: 80000, note: '' }
const store = () => ({
  suppliers: [{ id: 's1', name: 'Sodexo Pass do Brasil', document: '49930514000135' }],
  classifications: [{ id: 'c1', name: 'Benefícios' }],
  payables: [
    { id: 'PAG-000001', supplierId: 's1', supplierName: 'Sodexo', classificationId: 'c1', description: 'Vale', dueDate: '2026-10-01', valueCents: 80000, installmentNumber: 1, installmentCount: 1, payment, inactive: false },
    { id: 'PAG-000002', supplierId: 's1', supplierName: 'Sodexo', classificationId: 'c1', dueDate: '2026-09-01', valueCents: 1000, installmentNumber: 2, installmentCount: 3, payment: null, inactive: false },
    { id: 'PAG-000003', supplierId: 's1', supplierName: 'Sodexo', dueDate: '2026-09-01', valueCents: 5, payment: null, inactive: true },
  ],
  receivables: [{ id: 'REC-000001', customerName: 'Cliente Teste Ltda', customerDocument: '11222333000181', orderCode: 'OS-1', dueDate: '2026-10-03', valueCents: 50000, receipt: null, inactive: false }],
  bankTransactions: [{ id: 'b1', key: 'gmac|0341|0001234567|T5', fitId: 'T5', bankDate: '2026-10-01', amountCents: -5000, reconciliation: { kind: 'payable', recordId: 'PAG-000002' } }],
  bankSettings: { dateToleranceDays: 3 },
})

test('the analysis data carries the whole statement, every active account and the system suggestions', () => {
  const parsed = parseOfx(Buffer.from(sampleOfx(sampleRows), 'utf8'))
  const data = buildAnalysisData(store(), parsed, 'extrato.ofx', '2026-10-05')
  const { extrato, sistema } = data
  assert.deepEqual([extrato.arquivo, extrato.banco, extrato.conta, extrato.periodo.inicio, extrato.periodo.fim], ['extrato.ofx', '0341', '0001234567', '2026-10-01', '2026-10-02'])
  assert.equal(extrato.movimentacoes.length, 6); assert.equal(extrato.saldos.length, 2)
  assert.deepEqual([extrato.validacaoDoSistema.saldoAnteriorCentavos, extrato.validacaoDoSistema.diferencaCentavos], [200000, 18])
  const pix = extrato.movimentacoes.find((row) => row.fitId === 'T2')
  assert.deepEqual([pix.valorCentavos, pix.direcao, pix.documentoContraparte], [-80000, 'saída', '49930514000135'])
  assert.deepEqual(pix.sugestoesDoSistema.map((row) => [row.id, row.forca]), [['PAG-000001', 'Forte']])
  assert.deepEqual(extrato.movimentacoes.find((row) => row.fitId === 'T5').situacaoNoSistema, { importadaNoSistema: true, conciliadaCom: { tipo: 'conta a pagar', id: 'PAG-000002' } })
  assert.deepEqual(sistema.contasAPagar.map((row) => [row.id, row.situacao, row.parcela]), [['PAG-000001', 'paga', null], ['PAG-000002', 'vencida', '2/3']], 'Inactive accounts are left out')
  assert.deepEqual([sistema.contasAPagar[0].fornecedor, sistema.contasAPagar[0].documentoFornecedor, sistema.contasAPagar[0].classificacao, sistema.contasAPagar[0].pagamento.forma], ['Sodexo Pass do Brasil', '49930514000135', 'Benefícios', 'Pix'])
  assert.deepEqual(sistema.contasAPagar[1].conciliacaoBancaria, { fitId: 'T5', dataBanco: '2026-10-01', valorCentavos: -5000 })
  assert.deepEqual([sistema.contasAReceber[0].situacao, sistema.contasAReceber[0].ordemDeServico], ['vencida', 'OS-1'], 'Due on 03/10 and still open on 05/10')
  const prompt = userPrompt(data)
  assert.ok(prompt.startsWith('<dados_gmac>\n{') && prompt.includes('</dados_gmac>') && prompt.includes('extrato.ofx'))
  assert.ok(SYSTEM_PROMPT.includes('window.GMAC_DADOS') && SYSTEM_PROMPT.includes('<!DOCTYPE html>'))
})

test('the returned page is extracted and isolated: no network, local Chart.js, injected data that cannot close the script', async () => {
  assert.equal(extractHtml('Segue:\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```'), '<!DOCTYPE html><html><body>x</body></html>')
  assert.equal(extractHtml('sem html'), null)
  const page = await assembleReport('<!DOCTYPE html><html lang="pt-BR" data-theme="light"><head><title>R</title></head><body><main></main></body></html>', { extrato: { historico: '</script><script>alert(1)</script>' } }, 'dark')
  assert.match(page, /<html lang="pt-BR" data-theme="dark">/)
  assert.match(page, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'/)
  assert.ok(page.includes('window.GMAC_DADOS={"extrato":{"historico":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}}'))
  assert.ok(page.indexOf('Chart') < page.indexOf('window.GMAC_DADOS'), 'Chart.js is available before the data and the report code')
  assert.match(page, /gmac-ai-report-height[\s\S]*<\/script><\/body><\/html>$/)
  assert.equal((page.match(/<\/script/gi) || []).length, (page.match(/<script/gi) || []).length, 'Injected scripts stay balanced')
  const bare = await assembleReport('<html><body>x</body></html>', {}, 'light')
  assert.match(bare, /^<html data-theme="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/)
})

test('admins send an OFX, the analysis runs in the background and the report comes back assembled', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  let received, release
  const gate = new Promise((resolve) => { release = resolve })
  const aiAnalyze = async (data, onProgress) => {
    received = data
    onProgress(2048)
    if (await gate === 'fail') throw Object.assign(new Error('O Claude recusou a análise deste extrato. Tente novamente ou revise o arquivo.'), { status: 502 })
    return { html: '<!DOCTYPE html><html lang="pt-BR"><head><title>Análise</title></head><body><h1>Conciliação</h1></body></html>', model: 'claude-opus-5-5', usage: { inputTokens: 100000, outputTokens: 20000 } }
  }
  const f = await createWorkflowFixture({ accountsEnv: env, aiAnalyze })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const request = (route) => f.request(route, 'GET', undefined, headers)
    const upload = async (text) => { const response = await fetch(`${f.url}/api/ai-reconciliations?name=extrato.ofx`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(text, 'utf8') }); return { status: response.status, data: await response.json() } }
    assert.equal((await f.request('/ai-reconciliations')).status, 401)
    assert.equal((await upload('não é OFX')).status, 400)
    await f.mutateStore((target) => { target.receivables = [{ id: 'REC-000001', customerName: 'Cliente Teste Ltda', customerDocument: '11222333000181', dueDate: '2026-10-03', valueCents: 50000, receipt: null, inactive: false }] })
    const sent = await upload(sampleOfx(sampleRows))
    assert.equal(sent.status, 202)
    assert.deepEqual([sent.data.item.id, sent.data.item.status, sent.data.item.transactionCount, sent.data.item.period], ['IA-000001', 'running', 6, { inicio: '2026-10-01', fim: '2026-10-02' }])
    assert.equal(received.sistema.contasAReceber[0].id, 'REC-000001')
    assert.equal((await request('/ai-reconciliations/IA-000001')).data.item.progress.outputChars, 2048)
    assert.equal((await request('/ai-reconciliations/IA-000001/report')).status, 409)
    release('ok')
    let item
    for (let attempt = 0; attempt < 50 && item?.status !== 'done'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 20)); item = (await request('/ai-reconciliations/IA-000001')).data.item }
    assert.deepEqual([item.status, item.model, item.usage, item.estimatedCostUsd, item.progress], ['done', 'claude-opus-5-5', { inputTokens: 100000, outputTokens: 20000 }, 0.8, null])
    const report = (await request('/ai-reconciliations/IA-000001/report?theme=dark')).data.html
    assert.match(report, /<html lang="pt-BR" data-theme="dark">/)
    assert.ok(report.includes('window.GMAC_DADOS={') && report.includes('<h1>Conciliação</h1>'))
    const list = (await request('/ai-reconciliations')).data
    assert.deepEqual([list.items.length, list.model], [1, 'claude-opus-5-5'])
  } finally { await f.close() }
})

test('a failed analysis is recorded with the reason and no report', async () => {
  const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Gustavo' }
  const f = await createWorkflowFixture({ accountsEnv: env, aiAnalyze: async () => { throw new Error('Could not resolve authentication method. Expected one of apiKey') } })
  try {
    const token = (await f.request('/auth/login', 'POST', { cpf: env.DEMO_ADMIN_CPF, password: env.DEMO_ADMIN_PASSWORD })).data.token
    const headers = { Authorization: `Bearer ${token}` }
    const response = await fetch(`${f.url}/api/ai-reconciliations?name=extrato.ofx`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(sampleOfx(sampleRows), 'utf8') })
    assert.equal(response.status, 202)
    let item
    for (let attempt = 0; attempt < 50 && item?.status !== 'failed'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 20)); item = (await f.request('/ai-reconciliations/IA-000001', 'GET', undefined, headers)).data.item }
    assert.equal(item.status, 'failed')
    assert.equal(item.error, 'Nenhuma credencial da Anthropic foi encontrada. Defina ANTHROPIC_API_KEY no arquivo .env e reinicie o servidor.')
    assert.equal((await f.request('/ai-reconciliations/IA-000001/report', 'GET', undefined, headers)).status, 409)
  } finally { await f.close() }
})
