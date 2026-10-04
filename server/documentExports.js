import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

const colors = { blue: '#0c4c91', ink: '#243746', muted: '#536b7b', line: '#dce5ee', light: '#f1f6fb' }
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : value
const currencyColumn = (label) => /R\$|^Valor\/|^Valor do serviço$/.test(label)
const percentColumn = (label) => /\(%\)|^%/.test(label)
const decimalColumn = (label) => /decimal|Horas previstas|Valor|Juros|Desconto|Margem|Lucro/.test(label)
export function documentValue(value, label = '') {
  if (value == null || value === '') return 'Não informado'
  if (typeof value === 'number') {
    if (currencyColumn(label)) return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    if (percentColumn(label)) return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: decimalColumn(label) ? 2 : 0 })
  }
  return String(date(value))
}

export async function exportWorkbook(report) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'GMAC Metalúrgica'
  workbook.created = new Date(report.generatedAt)
  workbook.title = report.title
  for (const [index, part] of report.sections.entries()) {
    const sheet = workbook.addWorksheet(`${index + 1} ${part.name}`.replace(/[\[\]*?:/\\]/g, ' ').slice(0, 31))
    sheet.properties.defaultRowHeight = 24
    sheet.columns = part.columns.map((header, column) => {
      const longest = Math.max(header.length, ...part.rows.map((row) => String(row[column] ?? '').length).slice(0, 1000))
      return { header, width: Math.min(52, Math.max(16, longest + 2)) }
    })
    const heading = sheet.getRow(1)
    heading.height = 34
    heading.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C4C91' } }
    heading.alignment = { vertical: 'middle', wrapText: true }
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
    for (const [index, values] of part.rows.entries()) {
      const row = sheet.addRow(values.map((value) => value ?? ''))
      row.font = { name: 'Calibri', size: 11, color: { argb: 'FF243746' } }
      row.alignment = { vertical: 'top', wrapText: true }
      let lines = 1
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        const label = part.columns[column - 1]
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5EE' } } }
        if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FB' } }
        if (typeof cell.value === 'number') cell.numFmt = currencyColumn(label) ? '"R$" #,##0.00' : percentColumn(label) ? '0.00"%"' : decimalColumn(label) ? '#,##0.00' : '#,##0.##'
        lines = Math.max(lines, String(cell.value ?? '').split('\n').reduce((count, text) => count + Math.max(1, Math.ceil(text.length / (sheet.getColumn(column).width - 2))), 0))
      })
      row.height = Math.min(409, Math.max(24, lines * 15 + 8))
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: part.columns.length } }
    sheet.pageSetup = { paperSize: 9, orientation: part.columns.length > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: part.columns.length > 8 ? 0 : 1, fitToHeight: 0, printTitlesRow: '1:1', printTitlesColumn: 'A:A', margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    sheet.headerFooter.oddHeader = `&LGMAC Metalúrgica&R${report.title.replace(/&/g, '&&')}`
    sheet.headerFooter.oddFooter = '&LDocumento gerado pelo portal&R Página &P de &N'
  }
  const info = workbook.addWorksheet('Informações')
  info.addRows([['Relatório', report.title], ['Período inicial', date(report.start) || 'Todos'], ['Período final', date(report.end) || 'Todos'], ['Gerado em (Bahia)', moment(report.generatedAt)], ...report.summary, ...report.notes.map((note) => ['Observação', note])])
  info.columns = [{ width: 35 }, { width: 85 }]
  info.eachRow((row, index) => {
    row.font = { name: 'Calibri', size: 11, color: { argb: 'FF243746' } }
    row.alignment = { vertical: 'top', wrapText: true }
    row.height = Math.max(26, Math.ceil(String(row.getCell(2).value ?? '').length / 80) * 15 + 10)
    row.getCell(1).font = { ...row.font, bold: true, color: { argb: 'FF0C4C91' } }
    if (index % 2) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FB' } }
  })
  info.pageSetup = { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  return workbook.xlsx.writeBuffer()
}

export function exportPdf(report, { layout = 'classic', orientation } = {}) {
  return new Promise((resolve, reject) => {
    const landscape = orientation === 'landscape' || (!orientation && report.sections[0]?.columns.length <= 7 && report.sections.some((part) => !part.records && part.columns.length >= 5 && part.columns.length <= 7))
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 90, bottom: 52, left: 36, right: 36 }, bufferPages: true, info: { Title: report.title, Author: 'GMAC Metalúrgica' } })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    const width = doc.page.width - 72, bottom = () => doc.page.height - 58
    const fontSize = layout === 'compact' ? 9.5 : 10
    let y = 98
    function header() {
      doc.fillColor(colors.blue).font('Helvetica-Bold').fontSize(layout === 'executive' ? 21 : 18).text('GMAC Metalúrgica', 36, 26, { width, lineBreak: false })
      doc.fillColor(colors.ink).fontSize(12).text(report.title, 36, 53, { width, lineBreak: false, ellipsis: true })
      doc.strokeColor(colors.line).moveTo(36, 78).lineTo(36 + width, 78).stroke()
      doc.font('Helvetica').fontSize(fontSize).fillColor(colors.ink)
      y = 98
    }
    doc.on('pageAdded', header)
    header()
    function ensure(height) { if (y + height > bottom()) doc.addPage() }
    function text(value, { bold = false, size = fontSize, color = colors.ink } = {}) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
      const height = doc.heightOfString(value, { width, lineGap: 3 })
      ensure(Math.min(height + 6, bottom() - 98))
      doc.text(value, 36, y, { width, lineGap: 3 })
      y = doc.y + 8
    }
    text(`Emitido em ${moment(report.generatedAt)} (Bahia)`, { size: 9, color: colors.muted })
    if (report.start || report.end) text(`Período: ${date(report.start) || 'Sem limite inicial'} a ${date(report.end) || 'Sem limite final'}`, { color: colors.muted })
    for (const [label, value] of report.summary) text(`${label}: ${documentValue(value, label)}`, { bold: true, size: 11 })
    for (const note of report.notes) text(note, { size: 9, color: colors.muted })
    function heading(title) {
      ensure(70)
      y += 8
      doc.rect(36, y, width, 27).fill(colors.light)
      doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.blue).text(title, 44, y + 7, { width: width - 16, lineBreak: false })
      y += 39
    }
    function record(part, row, index) {
      if (!part.singleRecord) text(`${part.columns[0]}: ${documentValue(row[0], part.columns[0])}  |  Registro ${index + 1}`, { bold: true, size: 11 })
      // Wide reports retain every field at a readable font size instead of squeezing columns.
      for (let column = 0; column < part.columns.length;) {
        const label = part.columns[column], value = documentValue(row[column], label)
        const nextValue = documentValue(row[column + 1], part.columns[column + 1])
        if (value.length > 180 || part.columns.length === 1) { text(`${label}: ${value}`); column++; continue }
        const count = column + 1 < part.columns.length && nextValue.length <= 180 ? 2 : 1
        const fieldWidth = (width - 20) / 2
        const fields = Array.from({ length: count }, (_, i) => ({ label: part.columns[column + i], value: documentValue(row[column + i], part.columns[column + i]) }))
        const height = Math.max(...fields.map((field) => {
          doc.font('Helvetica-Bold').fontSize(9)
          const labelHeight = doc.heightOfString(field.label, { width: fieldWidth })
          doc.font('Helvetica').fontSize(fontSize)
          return labelHeight + 5 + doc.heightOfString(field.value, { width: fieldWidth, lineGap: 2 }) + 14
        }))
        ensure(height)
        fields.forEach((field, i) => {
          const x = 36 + i * (fieldWidth + 20)
          doc.font('Helvetica-Bold').fontSize(9).fillColor(colors.muted).text(field.label, x, y, { width: fieldWidth })
          const valueY = doc.y + 5
          doc.font('Helvetica').fontSize(fontSize).fillColor(colors.ink).text(field.value, x, valueY, { width: fieldWidth, lineGap: 2 })
        })
        y += height
        column += count
      }
      ensure(12)
      doc.strokeColor(colors.line).moveTo(36, y).lineTo(36 + width, y).stroke()
      y += 16
    }
    function columnWidths(part) {
      const weights = part.columns.map((label, column) => Math.min(40, Math.max(12, label.length, ...part.rows.slice(0, 200).map((row) => Math.min(40, documentValue(row[column], label).length)))))
      const total = weights.reduce((sum, value) => sum + value, 0)
      return weights.map((value) => width * value / total)
    }
    for (const part of report.sections) {
      const widths = part.records || part.columns.length > 7 ? null : columnWidths(part)
      if (widths && part.rows.length) {
        doc.font('Helvetica-Bold').fontSize(fontSize)
        const headerHeight = Math.max(...part.columns.map((label, i) => doc.heightOfString(label, { width: widths[i] - 14, lineGap: 2 }))) + 16
        doc.font('Helvetica').fontSize(fontSize)
        const firstHeight = Math.max(...part.columns.map((label, i) => doc.heightOfString(documentValue(part.rows[0][i], label), { width: widths[i] - 14, lineGap: 2 }))) + 16
        ensure(Math.min(47 + headerHeight + firstHeight, bottom() - 98))
      }
      heading(part.name)
      if (!part.rows.length) { text('Nenhum registro no período selecionado.', { color: colors.muted }); continue }
      if (part.records || part.columns.length > 7) { part.rows.forEach((row, index) => record(part, row, index)); continue }
      function tableHeader() {
        doc.font('Helvetica-Bold').fontSize(fontSize)
        const height = Math.max(...part.columns.map((label, i) => doc.heightOfString(label, { width: widths[i] - 14, lineGap: 2 }))) + 16
        ensure(height + 30)
        doc.rect(36, y, width, height).fill(colors.blue)
        let x = 36
        part.columns.forEach((label, i) => { doc.fillColor('#ffffff').text(label, x + 7, y + 8, { width: widths[i] - 14, lineGap: 2 }); x += widths[i] })
        y += height
      }
      tableHeader()
      for (const [index, row] of part.rows.entries()) {
        const values = part.columns.map((label, i) => documentValue(row[i], label))
        doc.font('Helvetica').fontSize(fontSize)
        const height = Math.max(...values.map((value, i) => doc.heightOfString(value, { width: widths[i] - 14, lineGap: 2 }))) + 16
        if (height > (bottom() - 98) / 2) { record(part, row, index); tableHeader(); continue }
        if (y + height > bottom()) { doc.addPage(); tableHeader() }
        doc.rect(36, y, width, height).fill(index % 2 ? '#ffffff' : colors.light)
        let x = 36
        doc.font('Helvetica').fontSize(fontSize)
        values.forEach((value, i) => { doc.fillColor(colors.ink).text(value, x + 7, y + 8, { width: widths[i] - 14, lineGap: 2 }); x += widths[i] })
        y += height
        doc.strokeColor(colors.line).moveTo(36, y).lineTo(36 + width, y).stroke()
      }
      y += 14
    }
    const pages = doc.bufferedPageRange()
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i)
      const previousBottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.strokeColor(colors.line).moveTo(36, doc.page.height - 42).lineTo(36 + width, doc.page.height - 42).stroke()
      doc.font('Helvetica').fontSize(8).fillColor(colors.muted).text('GMAC | Sistema de Gestão', 36, doc.page.height - 31, { width: width - 100, lineBreak: false })
      doc.text(`${i + 1} / ${pages.count}`, doc.page.width - 130, doc.page.height - 31, { width: 94, align: 'right', lineBreak: false })
      doc.page.margins.bottom = previousBottom
    }
    doc.end()
  })
}
