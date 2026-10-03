import express from 'express'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import { readStore } from './offers.js'
import { machineRows } from './machines.js'
import { stageLabel } from './serviceStages.js'
import { duration, hourReport, reportRange, workIntervals } from './reportData.js'

const titles = { employees: 'Funcionários', clients: 'Clientes', admins: 'Administradores', 'employee-hours': 'Horas trabalhadas', 'machine-hours': 'Horas de máquinas', orders: 'Ordens de serviço' }
const status = { waiting: 'Aguardando', running: 'Em execução', paused: 'Pausado', finalizing: 'Finalizando', completed: 'Concluído' }
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'America/Bahia' }) : ''
const moment = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : ''
const blank = (value) => value ?? ''
const section = (name, columns, rows) => ({ name, columns, rows })

export async function exportWorkbook(report) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'GMAC Metalúrgica'
  for (const [index, part] of report.sections.entries()) {
    const sheet = workbook.addWorksheet(`${index + 1} ${part.name}`.slice(0, 31))
    sheet.columns = part.columns.map((header) => ({ header, width: Math.min(48, Math.max(18, header.length + 4)) }))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FF0C4C91' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FB' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    for (const row of part.rows) sheet.addRow(row.map(blank)).alignment = { vertical: 'top', wrapText: true }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: part.columns.length } }
  }
  const info = workbook.addWorksheet('Informações')
  info.addRows([['Relatório', report.title], ['Período inicial', report.start || 'Todos'], ['Período final', report.end || 'Todos'], ['Gerado em (Bahia)', moment(report.generatedAt)], ...report.summary.map(([label, value]) => [label, value]), ...report.notes.map((note) => ['Observação', note])])
  info.getColumn(1).width = 35
  info.getColumn(2).width = 85
  info.getColumn(2).alignment = { wrapText: true }
  return workbook.xlsx.writeBuffer()
}

export function exportPdf(report) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.fillColor('#0c4c91').font('Helvetica-Bold').fontSize(20).text('GMAC Metalúrgica')
    document.fontSize(15).text(report.title)
    document.fillColor('#334155').font('Helvetica').fontSize(10).text(`Gerado em: ${moment(report.generatedAt)}`)
    if (report.start) document.text(`Período: ${date(report.start)} a ${date(report.end)}`)
    for (const [label, value] of report.summary) document.moveDown(0.4).font('Helvetica-Bold').text(`${label}: ${value}`)
    for (const note of report.notes) document.moveDown(0.3).font('Helvetica').fontSize(9).text(note)
    for (const part of report.sections) {
      document.moveDown().fillColor('#0c4c91').font('Helvetica-Bold').fontSize(13).text(part.name)
      document.fillColor('#26384c').font('Helvetica').fontSize(10)
      if (!part.rows.length) document.text('Nenhum registro no período selecionado.')
      for (const row of part.rows) {
        document.moveDown(0.6)
        for (let i = 0; i < part.columns.length; i++) document.text(`${part.columns[i]}: ${blank(row[i]) || 'Não informado'}`)
      }
    }
    const pages = document.bufferedPageRange()
    for (let i = 0; i < pages.count; i++) {
      document.switchToPage(i)
      document.fontSize(8).fillColor('#71859a').text(`${i + 1}/${pages.count}`, 40, document.page.height - 30, { lineBreak: false, align: 'right' })
    }
    document.end()
  })
}

export default function createReportsRouter(pool, accounts, requireAdmin) {
  const router = express.Router()
  router.use('/reports', requireAdmin)
  async function employees() {
    if (!pool) return (await readStore()).employees || []
    const [rows] = await pool.execute("SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, cpf, email, i_identificacao AS identification, created_at AS createdAt FROM employees ORDER BY name")
    return rows
  }
  async function ordersWithEvents() {
    const orders = (await readStore()).orders
    if (!pool) return orders
    const [states] = await pool.execute('SELECT order_code, data FROM order_operations')
    const [events] = await pool.execute('SELECT order_code, data FROM order_operation_events ORDER BY seq')
    const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value
    const operations = new Map(states.map((row) => [row.order_code, parse(row.data)]))
    const history = new Map()
    for (const event of events) { if (!history.has(event.order_code)) history.set(event.order_code, []); history.get(event.order_code).push(parse(event.data)) }
    return orders.map((order) => ({ ...order, operation: operations.get(order.code), operationEvents: history.get(order.code) || [] }))
  }
  async function build(input) {
    const kind = input.kind
    if (!titles[kind]) throw Object.assign(new Error('Relatório inválido.'), { status: 400 })
    let range
    if (['employee-hours', 'machine-hours', 'orders'].includes(kind)) {
      try { range = reportRange(input.start, input.end) } catch (error) { error.status = 400; throw error }
    }
    if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 1000 || input.ids.some((id) => !['string', 'number'].includes(typeof id)))) throw Object.assign(new Error('Seleção inválida.'), { status: 400 })
    const report = { title: titles[kind], kind, start: range ? input.start : null, end: range ? input.end : null, generatedAt: new Date().toISOString(), summary: [], notes: [], sections: [] }
    if (['employees', 'admins', 'clients'].includes(kind)) {
      const rows = kind === 'employees' ? await employees() : await accounts[kind]()
      report.summary.push(['Registros', rows.length])
      report.sections.push(kind === 'clients'
        ? section(titles[kind], ['ID', 'Nome / Razão social', 'Tipo de documento', 'Documento', 'E-mail', 'Cadastro em'], rows.map((row) => [String(row.id), row.name, row.documentType.toUpperCase(), row.document, row.email, moment(row.createdAt)]))
        : section(titles[kind], ['ID', 'Nome', 'Identificação', 'CPF', 'E-mail', 'Nascimento', 'Cadastro em'], rows.map((row) => [String(row.id), row.name, row.identification || '', row.cpf, row.email || '', date(row.birthDate), moment(row.createdAt)])))
      return report
    }
    const orders = await ordersWithEvents()
    if (kind.endsWith('-hours')) {
      const machine = kind === 'machine-hours'
      const rows = machine ? await machineRows() : await employees()
      const result = hourReport(workIntervals(orders, Date.parse(report.generatedAt)), rows, machine ? 'machineId' : 'employeeId', range, input.ids || [])
      report.summary.push(['Horas totais', duration(result.totalMs)], [machine ? 'Máquinas' : 'Funcionários', result.totals.length])
      report.notes.push('Tempo real de sessões, sem pausas. Sessões que atravessam a meia-noite são divididas por dia (Bahia). Intervalos simultâneos da mesma pessoa ou máquina são contados uma única vez.')
      if (machine && result.unidentifiedMs) report.notes.push(`Sessões antigas ou manuais sem máquina identificada: ${duration(result.unidentifiedMs)}. Este tempo não foi atribuído a nenhuma máquina.`)
      const label = machine ? 'Máquina' : 'Funcionário'
      report.sections.push(section('Totais por cadastro', [label, 'Horas totais', 'Horas (decimal)'], result.totals.map((row) => [row.name, duration(row.ms), row.ms / 3600000])))
      report.sections.push(section('Detalhamento diário', ['Data', label, 'Horas trabalhadas', 'Horas (decimal)', 'OS vinculadas'], result.details.map((row) => [date(row.date), row.name, duration(row.ms), row.ms / 3600000, row.orders])))
      return report
    }
    const selected = orders.filter((order) => { const time = Date.parse(order.createdAt); return time >= range.start && time < range.end }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    report.summary.push(['OS no período', selected.length])
    report.notes.push('Período baseado na data de criação da OS. Os dados operacionais refletem o momento da emissão.')
    report.sections.push(section('Ordens de serviço', ['OS', 'Oferta', 'Serviço', 'Cliente', 'CNPJ', 'Etiqueta', 'Quantidade', 'Solicitação', 'Criação da OS', 'Prazo solicitado', 'Prazo acordado', 'Status', 'Descrição', 'Tipo', 'Fabricado a partir de', 'Têmpera', 'Cor/Tipo', 'Detalhes do serviço', 'Tempo real ativo', 'Operador atual', 'Máquina atual', 'Concluído em', 'Conclusão confirmada em', 'Última pausa', 'Proposta', 'Valor do serviço', 'Materiais (R$)', 'Mão de obra (R$)', 'Desconto (%)', 'Margem (%)', 'Lucro estimado (R$)', 'Horas de máquina previstas', 'Horas de serviço previstas'], selected.map((order) => {
      const r = order.resources || {}, p = order.proposal || {}, o = order.operation || {}
      const activeMs = o.activeSession ? Math.max(0, Date.parse(report.generatedAt) - Date.parse(o.activeSession.startedAt)) : 0
      return [order.code, order.offerId, order.service, order.company, order.cnpj, order.labelNumber, order.quantity, moment(order.requestedAt), moment(order.createdAt), date(order.deadline), date(p.deadline), status[o.status] || order.status, order.description, (r.kind || p.kind) === 'product' ? 'Produto' : 'Serviço', r.manufacturedFrom === 'sample' ? 'Amostra' : r.manufacturedFrom === 'drawing' ? 'Desenho' : '', r.tempering === true ? 'Sim' : r.tempering === false ? 'Não' : '', r.paintColor || '', r.serviceDescription || '', duration((Number(o.accumulatedMs) || 0) + activeMs), o.activeSession?.employeeName || '', o.activeSession?.machineName || '', moment(o.completedAt), moment(o.completionAcknowledgedAt), o.lastPauseReason || '', p.title || p.key, p.serviceValue, p.materials, p.labor, p.discount, p.margin, p.profit, p.machine, p.serviceTime]
    })))
    report.sections.push(section('Materiais', ['OS', 'Material', 'Especificação', 'Quantidade (kg)', 'Valor/kg', 'Estoque', 'Disponível (kg)', 'Compra necessária (kg)'], selected.flatMap((order) => (order.resources?.materials || []).map((row) => [order.code, row.name, row.detail, row.quantity, row.unitPrice, row.stockStatus, row.stockAvailable, row.purchaseQuantity]))))
    report.sections.push(section('Mão de obra prevista', ['OS', 'Tipo', 'Recurso', 'Horas previstas', 'Valor/hora'], selected.flatMap((order) => (order.resources?.laborEntries || []).map((row) => [order.code, row.type === 'machine' ? 'Máquina' : 'Profissional', row.resource, row.hours, row.hourlyRate]))))
    report.sections.push(section('Etapas', ['OS', 'Ordem', 'Etapa', 'Peças registradas', 'Total de peças'], selected.flatMap((order) => (order.operation?.stages || (order.proposal?.stages || []).map((key) => ({ key, name: stageLabel(key) }))).map((row, index) => [order.code, index + 1, row.name, order.operation?.stageCounts?.[row.key] || 0, order.quantity]))))
    report.sections.push(section('Arquivos', ['OS', 'Arquivo', 'Tipo', 'Tamanho (bytes)', 'Link'], selected.flatMap((order) => (order.attachments || []).map((row) => [order.code, row.name, row.contentType, row.size, `/api/offers/${order.offerId}/attachments/${row.id}`]))))
    report.sections.push(section('Operações', ['OS', 'Data/hora', 'Operação', 'Funcionário', 'Máquina', 'Motivo', 'Etapa', 'Quantidade', 'Total da etapa', 'Duração da sessão', 'Detalhes'], selected.flatMap((order) => (order.operationEvents || []).map((row) => [order.code, moment(row.at), row.type, row.affectedEmployeeName || row.employeeName || '', row.machineName, row.reason, row.stageName, row.quantity, row.stageTotal, row.durationMs != null ? duration(row.durationMs) : '', Array.isArray(row.details) ? row.details.join(', ') : row.details || '']))))
    return report
  }
  router.get('/reports/catalog', async (_request, response, next) => {
    try { response.json({ employees: await employees(), machines: await machineRows() }) } catch (error) { next(error) }
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
