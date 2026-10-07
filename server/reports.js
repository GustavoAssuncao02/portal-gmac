import express from 'express'
import { readStore } from './offers.js'
import { machineRows } from './machines.js'
import { laborServiceRows, laborServiceHistory } from './laborServices.js'
import { stageLabel } from './serviceStages.js'
import { activeEmployeeNames, activeSessions, operationElapsed } from './operationSessions.js'
import { duration, hourReport, machineUtilization, ordersWithOperations, reportRange, workIntervals } from './reportData.js'
import { exportPdf, exportWorkbook } from './documentExports.js'
export { exportPdf, exportWorkbook } from './documentExports.js'

const titles = { employees: 'Funcionários', clients: 'Clientes', admins: 'Administradores', 'employee-hours': 'Horas trabalhadas', 'machine-hours': 'Horas de máquinas', 'service-hours': 'Serviços', orders: 'Ordens de serviço' }
const status = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const operationLabel = { started: 'Trabalho iniciado', resumed: 'Trabalho retomado', paused: 'Trabalho pausado', completed: 'Serviço concluído', admin_interrupted: 'Interrompido pelo administrador', machine_changed: 'Máquina alterada', labor_service_changed: 'Serviço de hora homem alterado', resource_changed: 'Recurso alterado', session_ended: 'Sessão encerrada na conclusão', stage_progress: 'Produção registrada', completion_acknowledged: 'Conclusão confirmada', order_edited: 'OS editada', order_reopened: 'OS reaberta' }
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'America/Bahia' }) : ''
const moment = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : ''
const section = (name, columns, rows) => ({ name, columns, rows })

export default function createReportsRouter(pool, accounts, requireAdmin) {
  const router = express.Router()
  router.use('/reports', requireAdmin)
  async function employees() {
    if (!pool) return (await readStore()).employees || []
    const [rows] = await pool.execute("SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, i_identificacao AS identification, created_at AS createdAt FROM employees ORDER BY name")
    return rows
  }
  async function ordersWithEvents() {
    return ordersWithOperations((await readStore()).orders, pool)
  }
  async function build(input) {
    const kind = input.kind
    if (!titles[kind]) throw Object.assign(new Error('Relatório inválido.'), { status: 400 })
    let range
    if (['employee-hours', 'machine-hours', 'service-hours', 'orders'].includes(kind)) {
      try { range = reportRange(input.start, input.end) } catch (error) { error.status = 400; throw error }
    }
    if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 1000 || input.ids.some((id) => !['string', 'number'].includes(typeof id)))) throw Object.assign(new Error('Seleção inválida.'), { status: 400 })
    if (input.idleHours !== undefined && typeof input.idleHours !== 'boolean') throw Object.assign(new Error('Opção de horas ociosas inválida.'), { status: 400 })
    const report = { title: titles[kind], kind, start: range ? input.start : null, end: range ? input.end : null, generatedAt: new Date().toISOString(), summary: [], notes: [], sections: [] }
    if (['employees', 'admins', 'clients'].includes(kind)) {
      const rows = kind === 'employees' ? await employees() : await accounts[kind]()
      report.summary.push(['Registros', rows.length])
      report.sections.push(kind === 'clients'
        ? section(titles[kind], ['ID', 'Nome / Razão social', 'Tipo de documento', 'CPF/CNPJ', 'E-mail', 'Cadastro em'], rows.map((row) => [String(row.id), row.name, row.documentType.toUpperCase(), row.document, row.email, moment(row.createdAt)]))
        : section(titles[kind], ['ID', 'Nome', 'Identificação', 'CPF', 'E-mail', 'Nascimento', 'Cadastro em'], rows.map((row) => [String(row.id), row.name, row.identification || '', row.cpf, row.email || '', date(row.birthDate), moment(row.createdAt)])))
      return report
    }
    const orders = await ordersWithEvents()
    if (kind.endsWith('-hours')) {
      const machine = kind === 'machine-hours'
      const service = kind === 'service-hours'
      const rows = machine ? await machineRows() : service ? await laborServiceRows() : await employees()
      const result = hourReport(workIntervals(orders, Date.parse(report.generatedAt)), rows, machine ? 'machineId' : service ? 'laborServiceId' : 'employeeId', range, input.ids || [], service ? { parallelField: 'employeeId' } : {})
      report.summary.push(['Horas totais', duration(result.totalMs)], [machine ? 'Máquinas' : service ? 'Serviços' : 'Funcionários', result.totals.length])
      report.notes.push(service ? 'Horas reais de serviço, sem pausas, por dia (Bahia). Trabalhos simultâneos de funcionários diferentes são somados; intervalos da mesma pessoa no mesmo serviço são contados uma única vez.' : 'Tempo real de sessões, sem pausas. Sessões que atravessam a meia-noite são divididas por dia (Bahia). Intervalos simultâneos da mesma pessoa ou máquina são contados uma única vez.')
      if (machine && result.unidentifiedMs) report.notes.push(`Sessões antigas ou manuais sem máquina identificada: ${duration(result.unidentifiedMs)}. Este tempo não foi atribuído a nenhuma máquina.`)
      const label = machine ? 'Máquina' : service ? 'Serviço' : 'Funcionário'
      report.sections.push(section('Totais por cadastro', [label, 'Horas totais', 'Horas (decimal)'], result.totals.map((row) => [row.name, duration(row.ms), row.ms / 3600000])))
      report.sections.push(section('Detalhamento diário', ['Data', label, 'Horas trabalhadas', 'Horas (decimal)', 'OS vinculadas'], result.details.map((row) => [date(row.date), row.name, duration(row.ms), row.ms / 3600000, row.orders])))
      if (service) {
        const selectedIds = new Set(result.totals.map((row) => row.id))
        report.sections.push(section('Cadastro dos serviços', ['ID', 'Serviço', 'Tipo', 'Setor', 'Valor/hora (R$)', 'Cadastro em'], rows.filter((row) => selectedIds.has(String(row.id))).map((row) => [row.id, row.name, row.type, row.sector, row.hourlyRate, moment(row.createdAt)])))
        report.sections.push(section('Utilizações por funcionário', ['Serviço', 'Funcionário', 'OS', 'Projeto', 'Início', 'Encerramento', 'Tempo no período', 'Horas (decimal)'], result.totals.flatMap((row) => laborServiceHistory(row.id, orders, range, Date.parse(report.generatedAt)).map((use) => [row.name, use.employeeName, use.orderCode, use.service, moment(use.startedAt), use.endedAt ? moment(use.endedAt) : 'Em andamento', duration(use.durationMs), use.durationMs / 3600000]))))
        if (result.unidentifiedMs) report.notes.push(`Sessões antigas ou sem serviço identificado: ${duration(result.unidentifiedMs)}. Elas não foram atribuídas automaticamente a nenhum serviço.`)
      }
      if (machine && input.idleHours) {
        const utilization = machineUtilization(result, range, Date.parse(report.generatedAt))
        const percent = (value) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`
        report.summary.push(['Horas disponíveis', duration(utilization.availableMs)], ['Horas ociosas', duration(utilization.idleMs)], ['Utilização das máquinas', percent(utilization.activePercent)])
        report.sections.push(section('Utilização e ociosidade', ['Máquina', 'Horas disponíveis', 'Horas utilizadas', 'Horas ociosas', 'Ativa (%)', 'Ociosa (%)'], utilization.totals.map((row) => [row.name, duration(row.availableMs), duration(row.ms), duration(row.idleMs), row.activePercent, row.idlePercent])))
        report.sections.push(section('Ociosidade diária', ['Data', 'Máquina', 'Horas disponíveis', 'Horas utilizadas', 'Horas ociosas', 'Ativa (%)', 'Ociosa (%)'], utilization.details.map((row) => [date(row.date), row.name, duration(row.availableMs), duration(row.ms), duration(row.idleMs), row.activePercent, row.idlePercent])))
        report.notes.push('Disponibilidade: 24 horas por dia, todos os dias (Bahia). O tempo sem uso registrado é considerado ocioso. Horários posteriores à emissão não entram no cálculo. Totais de disponibilidade somam o período observado de cada máquina selecionada.')
      }
      return report
    }
    const selected = orders.filter((order) => { const time = Date.parse(order.createdAt); return time >= range.start && time < range.end }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    report.summary.push(['OS no período', selected.length])
    report.notes.push('Período baseado na data de criação da OS. Os dados operacionais refletem o momento da emissão.')
    report.sections.push(section('Ordens de serviço', ['OS', 'Oferta', 'Serviço', 'Cliente', 'CNPJ', 'Etiqueta', 'Quantidade', 'Solicitação', 'Criação da OS', 'Prazo solicitado', 'Prazo acordado', 'Status', 'Descrição', 'Tipo', 'Fabricado a partir de', 'Têmpera', 'Cor/Tipo', 'Detalhes do serviço', 'Tempo real ativo', 'Operador atual', 'Máquina atual', 'Concluído em', 'Conclusão confirmada em', 'Última pausa', 'Proposta', 'Valor do serviço', 'Materiais (R$)', 'Mão de obra (R$)', 'Desconto (%)', 'Margem (%)', 'Lucro estimado (R$)', 'Horas de máquina previstas', 'Horas de serviço previstas'], selected.map((order) => {
      const r = order.resources || {}, p = order.proposal || {}, o = order.operation || {}
      return [order.code, order.offerId, order.service, order.company, order.cnpj, order.labelNumber, order.quantity, moment(order.requestedAt), moment(order.createdAt), date(order.deadline), date(p.deadline), status[o.status] || order.status, order.description, (r.kind || p.kind) === 'product' ? 'Produto' : 'Serviço', r.manufacturedFrom === 'sample' ? 'Amostra' : r.manufacturedFrom === 'drawing' ? 'Desenho' : '', r.tempering === true ? 'Sim' : r.tempering === false ? 'Não' : '', r.paintColor || '', r.serviceDescription || '', duration(operationElapsed(o, Date.parse(report.generatedAt))), activeEmployeeNames(o), [...new Set(activeSessions(o).map((session) => session.machineName).filter(Boolean))].join(', '), moment(o.completedAt), moment(o.completionAcknowledgedAt), o.lastPauseReason || '', p.title || p.key, p.serviceValue, p.materials, p.labor, p.discount, p.margin, p.profit, p.machine, p.serviceTime]
    })))
    report.sections.push(section('Materiais', ['OS', 'Material', 'Especificação', 'Quantidade (kg)', 'Valor/kg', 'Estoque', 'Disponível (kg)', 'Compra necessária (kg)'], selected.flatMap((order) => (order.resources?.materials || []).map((row) => [order.code, row.name, row.detail, row.quantity, row.unitPrice, row.stockStatus, row.stockAvailable, row.purchaseQuantity]))))
    report.sections.push(section('Mão de obra prevista', ['OS', 'Tipo', 'Recurso', 'Horas previstas', 'Valor/hora'], selected.flatMap((order) => (order.resources?.laborEntries || []).map((row) => [order.code, row.type === 'machine' ? 'Máquina' : 'Profissional', row.resource, row.hours, row.hourlyRate]))))
    report.sections.push(section('Etapas', ['OS', 'Ordem', 'Etapa', 'Peças registradas', 'Total de peças'], selected.flatMap((order) => (order.operation?.stages || (order.proposal?.stages || []).map((key) => ({ key, name: stageLabel(key) }))).map((row, index) => [order.code, index + 1, row.name, order.operation?.stageCounts?.[row.key] || 0, order.quantity]))))
    report.sections.push(section('Arquivos', ['OS', 'Arquivo', 'Tipo', 'Tamanho (bytes)', 'Link'], selected.flatMap((order) => (order.attachments || []).map((row) => [order.code, row.name, row.contentType, row.size, `/api/offers/${order.offerId}/attachments/${row.id}`]))))
    report.sections.push(section('Operações', ['OS', 'Data/hora', 'Operação', 'Funcionário', 'Máquina', 'Motivo', 'Etapa', 'Quantidade', 'Total da etapa', 'Duração da sessão', 'Detalhes'], selected.flatMap((order) => (order.operationEvents || []).map((row) => [order.code, moment(row.at), operationLabel[row.type] || row.type, row.affectedEmployeeName || row.employeeName || '', row.machineName, row.reason, row.stageName, row.quantity, row.stageTotal, row.durationMs != null ? duration(row.durationMs) : '', Array.isArray(row.details) ? row.details.join(', ') : row.details || '']))))
    return report
  }
  router.get('/reports/catalog', async (_request, response, next) => {
    try { response.json({ employees: await employees(), machines: await machineRows(), services: await laborServiceRows() }) } catch (error) { next(error) }
  })
  router.post('/reports/generate', async (request, response, next) => {
    try { response.json(await build(request.body)) } catch (error) { next(error) }
  })
  router.post('/reports/export', async (request, response, next) => {
    try {
      const format = request.body.format
      if (!['pdf', 'xlsx'].includes(format)) return response.status(400).json({ message: 'Formato inválido.' })
      const report = await build(request.body)
      const output = format === 'pdf' ? await exportPdf(report) : await exportWorkbook(report)
      response.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      response.setHeader('Content-Disposition', `attachment; filename="gmac-${report.kind}.${format}"`)
      response.send(Buffer.from(output))
    } catch (error) { next(error) }
  })
  return router
}
