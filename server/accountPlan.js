import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { classificationParts, shiftMonth } from './payableRules.js'
import { dreLines, behaviors, automaticSettings, fitsUse, natureOf, groupCodePattern, classificationCodePattern, compareCodes } from './accountPlanRules.js'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit)
const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const init = (store) => { store.accountGroups ||= []; store.classifications ||= []; store.payableEvents ||= []; store.dreSettings ||= {} }

// GMAC's plan (PLANO CLASSIFICACOES - GMAC.xlsx), the same for Usinagem and Metalúrgica: [code, group, default line of
// the DRE, classifications as [code, name, fixed/variable, line when it differs from the group's]]. 4.06, 4.07, 6.11,
// 6.12 and group 7 were added to it for the receipts, the interest, the discounts and the money that is not revenue.
const plan = [
  ['1', 'Custos de produção', 'costs', [
    ['1.01', 'Matéria-prima', 'variable'], ['1.02', 'Insumos solda', 'variable'], ['1.03', 'Insumos químicos', 'variable'], ['1.04', 'Insumos gases', 'variable'],
    ['1.05', 'Insumos consumíveis', 'variable'], ['1.06', 'Ferramentas de produção', 'variable'], ['1.07', 'Serviços de produção terceirizados', 'variable'],
    ['1.08', 'Pessoal da produção - Salário', 'mixed'], ['1.09', 'Férias', 'mixed'], ['1.10', 'FGTS', 'mixed'], ['1.11', '13º salário', 'mixed'],
    ['1.12', 'Alimentação', 'fixed'], ['1.13', 'Plano de saúde', 'fixed'], ['1.14', 'Vale transporte', 'variable'], ['1.15', 'Seguro de vida', 'fixed'],
    ['1.16', 'PGR/PCMSO/LTCAT', 'fixed'], ['1.17', 'Saúde ocupacional', 'variable'], ['1.18', 'Uniformes', 'variable'], ['1.19', 'EPI', 'mixed'],
    ['1.20', 'Segurança do trabalho', 'fixed'], ['1.21', 'Manutenção de máquinas e equipamentos', 'mixed'], ['1.22', 'Locação de máquinas e equipamentos', 'variable'],
    ['1.23', 'Energia da produção', 'fixed'], ['1.24', 'Estrutura da fábrica', 'mixed'], ['1.25', 'Fretes de compras e industrialização', 'variable'],
    ['1.26', 'Depreciação da produção', 'fixed'],
  ]],
  ['2', 'Despesas administrativas', 'operating', [
    ['2.01', 'Pessoal administrativo', 'fixed'], ['2.02', 'Encargos e provisões administrativos', 'mixed'], ['2.03', 'Benefícios administrativos', 'mixed'],
    ['2.04', 'Pró-labore da administração', 'fixed'], ['2.05', 'Contabilidade', 'fixed'], ['2.06', 'Jurídico e consultorias', 'mixed'],
    ['2.07', 'Sistemas administrativos', 'fixed'], ['2.08', 'Telefonia e internet', 'fixed'], ['2.09', 'Materiais de escritório', 'variable'],
    ['2.10', 'Manutenção administrativa e TI', 'fixed'], ['2.11', 'Material de limpeza', 'variable'], ['2.12', 'Segurança e monitoramento', 'variable'],
    ['2.13', 'Taxas, licenças e anuidades', 'variable'], ['2.14', 'Seguros administrativos e patrimoniais', 'fixed'], ['2.15', 'Água', 'fixed'],
    ['2.16', 'Energia', 'fixed'], ['2.17', 'Brindes', 'variable'],
  ]],
  ['3', 'Despesas comerciais', 'operating', [
    ['3.01', 'Pessoal e comissões comerciais', 'mixed'], ['3.02', 'Marketing e relacionamento', 'fixed'], ['3.03', 'Visitas e viagens comerciais', 'variable'],
    ['3.04', 'Portais de clientes e vendas', 'fixed'], ['3.05', 'Fretes de entrega', 'variable'], ['3.06', 'Veículos comerciais', 'mixed'],
  ]],
  ['4', 'Resultado financeiro', 'financial_expense', [
    ['4.01', 'Juros de empréstimos e financiamentos', 'fixed'], ['4.02', 'Juros de cheque especial e cartão', 'variable'], ['4.03', 'Antecipação de recebíveis', 'variable'],
    ['4.04', 'Tarifas bancárias e de cobrança', 'mixed'], ['4.05', 'Multas e juros por atraso', 'variable'], ['4.06', 'Receitas financeiras', 'variable', 'financial_revenue'],
    ['4.07', 'Descontos concedidos', 'variable'],
  ]],
  ['5', 'Tributos', 'deductions', [
    ['5.01', 'ICMS', 'variable'], ['5.02', 'ISS', 'variable'], ['5.03', 'IPI', 'variable'], ['5.04', 'COFINS', 'variable'],
    ['5.05', 'IRPJ', 'variable', 'income_tax'], ['5.06', 'CSLL', 'variable', 'income_tax'], ['5.07', 'Multas tributárias', 'variable', 'tax_charges'],
    ['5.08', 'Juros de tributos', 'variable', 'tax_charges'], ['5.09', 'Parcelamentos tributários', 'variable', 'tax_charges'],
  ]],
  ['6', 'Movimentações fora do resultado', 'outside', [
    ['6.01', 'Transferências entre Usinagem e Metalúrgica', 'none'], ['6.02', 'Transferências entre contas da mesma empresa', 'none'],
    ['6.03', 'Amortização de empréstimos e financiamentos', 'none'], ['6.04', 'Compra de máquinas e equipamentos', 'none'], ['6.05', 'Obras, instalações e melhorias', 'none'],
    ['6.06', 'Adiantamentos a fornecedores', 'none'], ['6.08', 'Distribuição de lucros', 'none'], ['6.09', 'Despesas pessoais pagas pela empresa', 'none'],
    ['6.10', 'Pagamento de fatura de cartão', 'none'], ['6.11', 'Captação de empréstimos', 'none'], ['6.12', 'Aporte de sócios', 'none'],
  ]],
  ['7', 'Receitas', 'gross_revenue', [
    ['7.01', 'Receita de Serviços à Vista', 'variable'], ['7.02', 'Receita de Serviços a Prazo', 'variable'],
    ['7.03', 'Receita de Industrialização à Vista', 'variable'], ['7.04', 'Receita de Industrialização a Prazo', 'variable'],
  ]],
]
// The classifications of the first tests and the plan's classification that takes over their accounts.
const formerCodes = { 'materia-prima': '1.01', 'ferramentas e consumiveis': '1.06', 'manutencao de maquinas': '1.21', 'energia eletrica': '1.23', 'agua e utilidades': '2.15', 'fretes e logistica': '1.25', 'servicos terceirizados': '1.07', 'aluguel e estrutura': '1.24', 'tecnologia e sistemas': '2.07', 'epis e seguranca': '1.19' }
const settingCodes = { iss: '5.02', interestPaid: '4.05', discountReceived: '4.06', interestReceived: '4.06', discountGiven: '4.07' }

// Recurring accounts generated ahead used to keep the first issue date; each occurrence now belongs to its own month,
// so the DRE by competência spreads a contract over its months. Occurrences edited by hand keep their date.
function spreadSeriesIssueDates(rows) {
  const series = new Map()
  for (const row of rows) if (row.seriesId) series.set(row.seriesId, [...(series.get(row.seriesId) || []), row])
  for (const items of series.values()) {
    const first = items.find((row) => row.seriesIndex === 1)
    if (!first) continue
    for (const row of items) {
      if (row === first || row.issueDate !== first.issueDate) continue
      const issueDate = shiftMonth(first.issueDate, (row.seriesIndex - 1) * (row.recurrence === 'yearly' ? 12 : 1))
      row.issueDate = issueDate > row.dueDate ? row.dueDate : issueDate
    }
  }
}

// Installs the plan once: the test classifications are replaced (their accounts move to the matching classification of
// the plan), receivables get a revenue classification and the receipts and payments get their automatic classifications.
export async function ensureAccountPlan() {
  if ((await readStore()).accountPlanVersion >= 1) return
  await mutateStore((store) => {
    if (store.accountPlanVersion >= 1) return
    init(store)
    const createdAt = new Date().toISOString(), groups = [], classifications = []
    for (const [code, name, dreLine, rows] of plan) {
      const group = { id: randomUUID(), code, name, dreLine, inactive: false, createdAt }
      groups.push(group)
      for (const [itemCode, itemName, behavior, line] of rows) classifications.push({ id: randomUUID(), code: itemCode, name: itemName, groupId: group.id, behavior, dreLine: line || dreLine, inactive: false, createdAt })
    }
    const byCode = (code) => classifications.find((item) => item.code === code)
    const replaced = new Map(store.classifications.map((old) => [old.id, byCode(formerCodes[plain(old.name)])]).filter(([, item]) => item))
    const move = (part) => { const item = replaced.get(part.classificationId); return item ? { ...part, classificationId: item.id, classificationName: item.name } : part }
    for (const row of store.payables || []) {
      if (row.classificationSplit?.length) {
        row.classificationSplit = row.classificationSplit.map(move)
        Object.assign(row, { classificationId: row.classificationSplit[0].classificationId, classificationName: row.classificationSplit.map((part) => part.classificationName).join(' + ') })
      } else Object.assign(row, move({ classificationId: row.classificationId, classificationName: row.classificationName }))
    }
    for (const row of store.receivables || []) {
      if (row.classificationId) continue
      const item = byCode(row.treasury || !(row.groupId || row.dueDate > row.issueDate) ? '7.01' : '7.02')
      Object.assign(row, { classificationId: item.id, classificationName: item.name })
    }
    spreadSeriesIssueDates(store.payables || [])
    spreadSeriesIssueDates(store.receivables || [])
    store.accountGroups = groups
    store.classifications = classifications
    store.dreSettings = Object.fromEntries(Object.entries(settingCodes).map(([key, code]) => [key, byCode(code).id]))
    store.accountPlanVersion = 1
  })
}

// Classifications as the screens use them: with their group, their nature and in the order of the codes.
export function classificationList(store) {
  const groups = store.accountGroups || []
  return (store.classifications || []).map((item) => {
    const group = groups.find((row) => row.id === item.groupId)
    return { ...item, groupCode: group?.code || '', groupName: group?.name || '', groupInactive: Boolean(group?.inactive), nature: natureOf(item) }
  }).sort((a, b) => compareCodes(a.code, b.code) || a.name.localeCompare(b.name, 'pt-BR'))
}
export const groupList = (store) => [...(store.accountGroups || [])].sort((a, b) => compareCodes(a.code, b.code))
// The classification of an entry, when it can be used there. An account keeps the classification it already has even
// after the classification (or its group) was deactivated or moved to another line.
export function entryClassification(store, id, use, kept = []) {
  const item = (store.classifications || []).find((row) => row.id === id)
  if (!item) return null
  if (kept.includes(id)) return item
  const group = (store.accountGroups || []).find((row) => row.id === item.groupId)
  return !item.inactive && !group?.inactive && fitsUse(item, use) ? item : null
}
export function classificationUsage(store, id) {
  return { payables: (store.payables || []).filter((row) => classificationParts(row).some((part) => part.classificationId === id)).length, receivables: (store.receivables || []).filter((row) => row.classificationId === id).length, adjustments: (store.dreAdjustments || []).filter((row) => row.classificationId === id).length }
}
export const dreSettings = (store) => Object.fromEntries(automaticSettings.map(([key]) => [key, store.dreSettings?.[key] || '']))

function event(store, actor, type, details) { store.payableEvents.push({ id: randomUUID(), at: new Date().toISOString(), type, accountId: null, userId: actor?.id ?? null, userName: actor?.name || 'Sistema', details }) }

export default function createAccountPlanRouter(accounts, requireAdmin) {
  const router = express.Router()
  router.use(['/account-groups', '/classifications'], requireAdmin, async (request, _response, next) => { try { request.actor = await accounts.account(request.adminId); if (!request.actor) fail('Administrador não encontrado.', 401); next() } catch (error) { next(error) } })
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (error) { next(error) } }
  const planView = (store) => {
    init(store)
    const items = classificationList(store).map((item) => { const usage = classificationUsage(store, item.id); return { ...item, usage, count: usage.payables } })
    return { groups: groupList(store).map((group) => ({ ...group, count: items.filter((item) => item.groupId === group.id).length })), items, settings: dreSettings(store), dreLines, behaviors }
  }
  router.get('/account-groups', handle(async (_req, res) => { res.json(planView(await readStore())) }))
  router.get('/classifications', handle(async (_req, res) => { res.json(planView(await readStore())) }))

  router.put('/account-groups/settings', handle(async (req, res) => {
    const result = await mutateStore((store) => {
      init(store)
      const before = dreSettings(store), next = {}
      for (const [key, label, nature] of automaticSettings) {
        const id = clean(req.body[key], 80)
        if (!id) fail(`Selecione a classificação de ${label.toLocaleLowerCase('pt-BR')}.`)
        const item = store.classifications.find((row) => row.id === id)
        if (!item || natureOf(item) !== nature) fail(`A classificação de ${label.toLocaleLowerCase('pt-BR')} deve ser de ${nature === 'revenue' ? 'receita' : 'despesa'}.`)
        next[key] = id
      }
      store.dreSettings = next
      event(store, req.actor, 'dre_settings_edited', { before, after: next })
      return planView(store)
    }); res.json(result)
  }))
  for (const method of ['post', 'put']) router[method](method === 'post' ? '/account-groups' : '/account-groups/:id', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store)
      // An edit may send only what changes; the rest stays as it is.
      const body = { ...store.accountGroups.find((group) => group.id === req.params.id), ...req.body }
      const code = clean(body.code, 2), name = clean(body.name, 120), dreLine = body.dreLine
      if (!groupCodePattern.test(code)) fail('Informe o código do grupo: um número de até dois dígitos (ex.: 7).')
      if (!name) fail('Informe o nome do grupo.')
      if (!Object.hasOwn(dreLines, dreLine)) fail('Selecione a linha da DRE do grupo.')
      const other = store.accountGroups.find((row) => row.id !== req.params.id && row.code === code)
      if (other) fail(`O código ${code} já pertence ao grupo ${other.name}.`, 409)
      if (store.accountGroups.some((row) => row.id !== req.params.id && plain(row.name) === plain(name))) fail('Grupo de contas já cadastrado.', 409)
      let row = store.accountGroups.find((group) => group.id === req.params.id)
      if (method === 'put' && !row) fail('Grupo de contas não encontrado.', 404)
      const before = row ? { ...row } : null
      if (!row) { row = { id: randomUUID(), createdAt: new Date().toISOString() }; store.accountGroups.push(row) }
      const children = store.classifications.filter((item) => item.groupId === row.id)
      // The codes of the classifications start with the group's: a new group code renumbers them (1.05 becomes 8.05).
      if (before && before.code !== code) for (const item of children) item.code = `${code}.${item.code.split('.')[1]}`
      // Classifications that follow the group's line move with it; the ones placed on another line stay there.
      if (before && before.dreLine !== dreLine) {
        for (const item of children.filter((child) => child.dreLine === before.dreLine)) {
          const usage = classificationUsage(store, item.id)
          if (natureOf({ dreLine }) !== natureOf(item) && (usage.payables && !fitsUse({ dreLine }, 'payable') || usage.receivables && !fitsUse({ dreLine }, 'receivable'))) fail(`${item.code} · ${item.name} já tem lançamentos que não cabem na nova linha da DRE.`, 409)
          item.dreLine = dreLine
        }
      }
      Object.assign(row, { code, name, dreLine, inactive: typeof body.inactive === 'boolean' ? body.inactive : Boolean(row.inactive) })
      event(store, req.actor, before ? 'account_group_edited' : 'account_group_created', { before, after: { ...row } })
      return row
    }); res.json({ item })
  }))
  router.delete('/account-groups/:id', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store)
      const row = store.accountGroups.find((group) => group.id === req.params.id)
      if (!row) fail('Grupo de contas não encontrado.', 404)
      if (store.classifications.some((item) => item.groupId === row.id)) fail('Este grupo tem classificações vinculadas. Desative o grupo para que ele não apareça em novos lançamentos.', 409)
      store.accountGroups = store.accountGroups.filter((group) => group.id !== row.id)
      event(store, req.actor, 'account_group_deleted', row)
    }); res.json({ ok: true })
  }))

  for (const method of ['post', 'put']) router[method](method === 'post' ? '/classifications' : '/classifications/:id', handle(async (req, res) => {
    const item = await mutateStore((store) => {
      init(store)
      // An edit may send only what changes (the name and the status, for instance); the rest stays as it is.
      const body = { ...store.classifications.find((entry) => entry.id === req.params.id), ...req.body }
      const group = store.accountGroups.find((row) => row.id === body.groupId)
      if (!group) fail('Selecione o grupo de contas da classificação.')
      const code = clean(body.code, 5), name = clean(body.name, 120)
      if (!classificationCodePattern.test(code)) fail('Informe o código no formato N.NN (ex.: 1.01).')
      if (!code.startsWith(`${group.code}.`)) fail(`O código deve começar pelo número do grupo ${group.name} (${group.code}.).`)
      const other = store.classifications.find((row) => row.id !== req.params.id && row.code === code)
      if (other) fail(`O código ${code} já pertence a ${other.name}.`, 409)
      if (!name) fail('Informe o nome.')
      if (store.classifications.some((row) => row.id !== req.params.id && plain(row.name) === plain(name))) fail('Classificação já cadastrada.', 409)
      if (!Object.hasOwn(behaviors, body.behavior)) fail('Informe se a classificação é fixa, variável, mista ou se não se aplica.')
      const dreLine = body.dreLine || group.dreLine
      if (!Object.hasOwn(dreLines, dreLine)) fail('Selecione a linha da DRE.')
      let row = store.classifications.find((entry) => entry.id === req.params.id)
      if (method === 'put' && !row) fail('Classificação não encontrada.', 404)
      const before = row ? { ...row } : null
      if (row && natureOf({ dreLine }) !== natureOf(row)) {
        const usage = classificationUsage(store, row.id)
        if (usage.payables && !fitsUse({ dreLine }, 'payable') || usage.receivables && !fitsUse({ dreLine }, 'receivable')) fail('Esta classificação já tem lançamentos que não cabem nessa linha da DRE (uma linha de receita não aceita contas a pagar, e uma de despesa não aceita contas a receber).', 409)
        const setting = automaticSettings.find(([key]) => store.dreSettings[key] === row.id)
        if (setting) fail(`Esta classificação está configurada para ${setting[1].toLocaleLowerCase('pt-BR')}. Troque essa configuração em Grupos de contas antes de mudar a linha.`, 409)
      }
      if (!row) { row = { id: randomUUID(), inactive: false, createdAt: new Date().toISOString() }; store.classifications.push(row) }
      Object.assign(row, { code, name, groupId: group.id, behavior: body.behavior, dreLine })
      if (typeof body.inactive === 'boolean') row.inactive = body.inactive
      event(store, req.actor, before ? 'classification_edited' : 'classification_created', { before, after: { ...row } })
      return row
    }); res.json({ item })
  }))
  router.delete('/classifications/:id', handle(async (req, res) => {
    await mutateStore((store) => {
      init(store)
      const row = store.classifications.find((item) => item.id === req.params.id)
      if (!row) fail('Classificação não encontrada.', 404)
      const usage = classificationUsage(store, row.id)
      if (usage.payables || usage.receivables || usage.adjustments) fail('Existem lançamentos usando esta classificação. Desative-a para que ela não apareça em novos lançamentos.', 409)
      const setting = automaticSettings.find(([key]) => store.dreSettings[key] === row.id)
      if (setting) fail(`Esta classificação está configurada para ${setting[1].toLocaleLowerCase('pt-BR')}. Troque essa configuração em Grupos de contas antes de excluir.`, 409)
      store.classifications = store.classifications.filter((item) => item.id !== row.id)
      event(store, req.actor, 'classification_deleted', row)
    }); res.json({ ok: true })
  }))
  return router
}
