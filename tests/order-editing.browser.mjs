import assert from 'node:assert/strict'
import { chromium, webkit, devices } from 'playwright'
import { createWorkflowFixture, offerDraft } from './workflowFixture.js'

for (const device of ['desktop', 'iPhone 15', 'iPhone 15 Pro Max']) {
  const fixture = await createWorkflowFixture({ accountsEnv: { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123' } })
  const browser = await (device === 'desktop' ? chromium : webkit).launch({ headless: true })
  const context = await browser.newContext(device === 'desktop' ? { viewport: { width: 1366, height: 768 }, timezoneId: 'America/Bahia' } : { ...devices[device], timezoneId: 'America/Bahia' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', async (dialog) => { errors.push(dialog.type()); await dialog.dismiss() })
  try {
    const offer = (await fixture.adminRequest('/offers', 'POST', { ...offerDraft, service: 'OS concluida para revisar' })).data.item
    await fixture.adminRequest(`/offers/${offer.id}/resources`, 'PUT', { materials: [{ id: 'm1', name: 'Ferro', detail: '10 mm', quantity: 5, unitPrice: 10 }], laborEntries: [{ id: 'l1', type: 'person', resource: 'Soldador', hours: 2, hourlyRate: 30 }], stages: ['turning', 'painting'], kind: 'service' })
    await fixture.adminRequest(`/offers/${offer.id}/proposal`, 'POST', { layout: 'classic', proposal: { key: 'A', title: 'Proposta A', deadline: '2026-12-20', serviceValue: 300, materials: 50, labor: 60, margin: 15, discount: 0, machine: '2 horas', serviceTime: '2 horas' } })
    const order = (await fixture.adminRequest(`/offers/${offer.id}/accept`, 'POST')).data.item
    const employee = (await fixture.adminRequest('/employees', 'POST', { name: 'Ana Teste', cpf: '00000000001', identification: '001', birthDate: '1990-01-01', email: 'ana@example.invalid' }, fixture.admin)).data.item
    const operatorHeaders = { Authorization: `Bearer ${fixture.operatorToken}` }
    const base = `/operations/orders/${order.code}`
    // Materials still pending must be acknowledged before the work starts.
    const pending = await fixture.request(`${base}/start`, 'POST', { employeeId: employee.id }, operatorHeaders)
    const start = pending.status === 409 ? await fixture.request(`${base}/start`, 'POST', { employeeId: employee.id, pendingMaterialsConfirmation: pending.data.pendingMaterials?.map((row) => [row.key, row.quantity]) }, operatorHeaders) : pending
    const session = { sessionId: start.data.operation.activeSession.id, sessionToken: start.data.sessionToken }
    await fixture.request(`${base}/stages/stage-1`, 'POST', { ...session, quantity: 10 }, operatorHeaders)
    await fixture.request(`${base}/stages/stage-2`, 'POST', { ...session, quantity: 10 }, operatorHeaders)
    await fixture.request(`${base}/complete`, 'POST', session, operatorHeaders)
    await fixture.request(`${base}/acknowledge-completion`, 'POST', {})
    await page.goto(fixture.url)
    await page.getByLabel('CPF', { exact: true }).fill('12345678901')
    await page.getByLabel('Senha', { exact: true }).fill('teste123')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    async function navigate(name) {
      if (device !== 'desktop') await page.getByRole('button', { name: 'Abrir menu de navegação', exact: true }).click()
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
    }
    await navigate('Ofertas e serviços')
    await page.locator('.offers-table-row').filter({ hasText: offer.service }).getByRole('button', { name: 'Ver OS', exact: true }).click()
    const article = page.locator('.os-detail')
    await article.waitFor()
    const edit = article.getByRole('button', { name: 'Editar OS', exact: true })
    const dialog = page.getByRole('dialog')
    await edit.click()
    await dialog.getByRole('heading', { name: 'Editar OS finalizada?' }).waitFor()
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.ok(await edit.evaluate((element) => element === document.activeElement))
    await edit.click()
    await dialog.getByRole('button', { name: 'Sim, editar OS', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Editar ordem de serviço' }).waitFor()
    await dialog.getByLabel('Peça / Serviço', { exact: true }).fill('OS revisada pelo administrador')
    await dialog.getByLabel('Cliente', { exact: true }).fill('Cliente revisado')
    await dialog.getByLabel('Quantidade de peças', { exact: true }).fill('12')
    await dialog.getByLabel('Descrição da OS', { exact: true }).fill('Descricao alterada com o historico mantido.')
    await dialog.getByRole('tab', { name: 'Recursos', exact: true }).click()
    await dialog.getByLabel('Material', { exact: true }).fill('Aco inox')
    await dialog.getByLabel('Horas previstas', { exact: true }).fill('4')
    await dialog.getByRole('tab', { name: 'Processo', exact: true }).click()
    await dialog.getByLabel('Cor/Tipo', { exact: true }).fill('Azul industrial')
    await dialog.getByLabel('Fabricado a partir de', { exact: true }).selectOption('drawing')
    await dialog.getByLabel('Têmpera', { exact: true }).selectOption('true')
    await dialog.getByLabel('Descrição do serviço', { exact: true }).fill('Detalhes revisados')
    await dialog.getByRole('checkbox', { name: 'Processo Injessado', exact: true }).uncheck()
    const count = dialog.locator('label').filter({ hasText: /^Tornearia$/ }).locator('input[type=number]')
    await count.fill('8')
    for (const name of ['Dados da OS', 'Recursos', 'Processo', 'Proposta e anexos']) {
      await dialog.getByRole('tab', { name, exact: true }).click()
      const box = await dialog.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width)
      assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height)
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
      await page.screenshot({ path: `test-results/order-edit-${device.replaceAll(' ', '-')}-${name.split(' ')[0]}.png` })
    }
    await dialog.getByLabel('Valor do serviço (R$)', { exact: true }).fill('650')
    await dialog.getByLabel('Opção da proposta', { exact: true }).selectOption('C')
    await dialog.getByLabel('Adicionar anexos', { exact: true }).setInputFiles({ name: 'revisao.txt', mimeType: 'text/plain', buffer: Buffer.from('Anexo de revisao') })
    await page.route(`**/operations/orders/${order.code}`, (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada ao salvar.' } }), { times: 1 })
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    await dialog.getByRole('alert').getByText('Falha simulada ao salvar.').waitFor()
    assert.equal(await dialog.getByLabel('Valor do serviço (R$)', { exact: true }).inputValue(), '650')
    await page.route('**/attachments?*', (route) => route.fulfill({ status: 503, json: { message: 'Falha simulada no anexo.' } }), { times: 1 })
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
    await dialog.getByRole('alert').getByText('A OS foi salva, mas um anexo não foi enviado. Falha simulada no anexo.').waitFor()
    await dialog.getByRole('button', { name: 'Reenviar anexos', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await article.getByRole('heading', { name: 'OS revisada pelo administrador', exact: true }).waitFor()
    let current = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0]
    assert.equal(current.operation.status, 'completed')
    assert.deepEqual(current.operation.stageCounts, { 'stage-1': 8, 'stage-2': 10 })
    assert.equal(current.attachments[0].name, 'revisao.txt')
    assert.equal(current.proposal.serviceValue, 650)
    assert.equal(current.resources.materials[0].name, 'Aco inox')
    await article.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal((await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0].operation.status, 'completed')
    await article.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
    await dialog.getByRole('button', { name: 'Reabrir OS', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    // The reopened OS goes back to the panel of services in progress, highlighted so it is easy to find.
    const reopenedRow = page.locator('.admin-os-table tbody tr.admin-os-row--reopened').filter({ hasText: 'OS revisada pelo administrador' })
    await reopenedRow.waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Painel de serviços em andamento' }).count(), 1)
    await reopenedRow.getByRole('button', { name: 'Ver OS', exact: true }).click()
    await article.locator('.os-status').getByText('Pausado', { exact: true }).waitFor()
    current = (await fixture.request('/operations/orders', 'GET', undefined, fixture.admin)).data.items[0]
    assert.equal(current.operation.completionAcknowledgedAt, null)
    assert.deepEqual(current.operation.stageCounts, { 'stage-1': 8, 'stage-2': 10 })
    await edit.click()
    await dialog.getByRole('heading', { name: 'Editar ordem de serviço' }).waitFor()
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await article.getByRole('button', { name: 'Histórico de operações', exact: true }).click()
    await dialog.getByRole('cell', { name: 'OS editada', exact: true }).waitFor()
    await dialog.getByRole('cell', { name: 'OS reaberta', exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Fechar histórico' }).click()
    await navigate('Serviços em andamento')
    await page.locator('.admin-os-table tbody tr').filter({ hasText: 'OS revisada pelo administrador' }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    console.log(`Order editing/reopening passed: ${device}`)
  } catch (error) {
    await page.screenshot({ path: `test-results/order-edit-failure-${device.replaceAll(' ', '-')}.png`, fullPage: true })
    throw error
  } finally { await browser.close(); await fixture.close() }
}
