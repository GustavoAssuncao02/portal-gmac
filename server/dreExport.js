import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import { dreLines } from './accountPlanRules.js'
import { dreColumns, dreCell, visibleDreRows, variation, changeTone, periodLabel, viewLabels, viewHints, entrySourceLabels, entryKindLabels, percentText } from './dreRules.js'

// The DRE has its own layout: a tree of lines (sections, groups, classifications and results) against month columns,
// which the generic report tables do not draw. Same identity as the other documents of the portal.
const assetDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const asset = (name) => { try { return readFileSync(path.join(assetDirectory, name)) } catch { return null } }
const fontFiles = { regular: asset('fonts/Inter-Regular.ttf'), medium: asset('fonts/Inter-Medium.ttf'), semibold: asset('fonts/Inter-SemiBold.ttf'), bold: asset('fonts/Inter-Bold.ttf') }
const standardFonts = { regular: 'Helvetica', medium: 'Helvetica', semibold: 'Helvetica-Bold', bold: 'Helvetica-Bold' }
const logo = asset('gmac-logo.png'), logoRatio = 340 / 259
const palette = { navy: '#004185', navyDark: '#0b2545', orange: '#f5821f', ink: '#1f2937', muted: '#6b7280', line: '#e3e8ef', section: '#eaf1f9', result: '#dbe6f4', negative: '#b42318', positive: '#166534', warning: '#fef4e2', warningText: '#a15c07' }
const moment = (value) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
const amount = (cents) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const cellText = (report, row, column) => {
  const value = dreCell(report, row, column)
  if (column.type === 'percent' || column.type === 'variation') return percentText(value)
  return value ? amount(value) : '–'
}
const rowLabel = (row) => row.type === 'line' || row.type === 'group' ? `${row.code ? `${row.code}  ` : ''}${row.label}` : row.label
// With a bank chosen, the hint says which one: only the accounts settled in it, without the DRE adjustments.
const hint = (report) => `${viewHints[report.view]}${report.bankName ? ` Banco: ${report.bankName} (só as contas baixadas neste banco; os ajustes da DRE ficam de fora).` : ''}`
const notes = (report) => [hint(report), ...(report.unclassified.count ? [`${report.unclassified.count} ${report.unclassified.count === 1 ? 'lançamento sem classificação não entrou' : 'lançamentos sem classificação não entraram'} na DRE (${money(report.unclassified.inCents)} de entradas e ${money(report.unclassified.outCents)} de saídas). Classifique essas contas para que façam parte do resultado.`] : [])]

export function drePdf(report) {
  return new Promise((resolve, reject) => {
    const title = 'Demonstração do Resultado (DRE)'
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 60, bottom: 20, left: 32, right: 32 }, bufferPages: true, info: { Title: `${title} · ${periodLabel(report)}`, Author: 'GMAC Metalúrgica', Subject: 'Gestão Financeira', Creator: 'Portal GMAC' } })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)))
    const fonts = {}
    for (const [weight, data] of Object.entries(fontFiles)) { if (data) doc.registerFont(`Inter-${weight}`, data); fonts[weight] = data ? `Inter-${weight}` : standardFonts[weight] }
    const pageWidth = doc.page.width, pageHeight = doc.page.height, left = 32, right = pageWidth - 32, width = right - left, bottom = pageHeight - 52
    const style = (weight, size, color) => doc.font(fonts[weight]).fontSize(size).fillColor(color)
    const fit = (text, w, weight, size) => { let value = String(text); doc.font(fonts[weight]).fontSize(size); if (doc.widthOfString(value) <= w) return value; while (value.length > 1 && doc.widthOfString(`${value}…`) > w) value = value.slice(0, -1); return `${value.trimEnd()}…` }
    const write = (text, x, top, w, weight, size, color, align = 'left') => style(weight, size, color).text(fit(text, w, weight, size), x, top, { width: w, align, lineBreak: false })
    let logoImage = null
    const drawLogo = (x, top, height) => { if (!logo) return 0; logoImage ||= doc.openImage(logo); doc.image(logoImage, x, top, { height }); return height * logoRatio }
    let y = 0
    function firstHeader() {
      doc.rect(0, 0, pageWidth, 5).fill(palette.navy); doc.rect(0, 0, 132, 5).fill(palette.orange)
      const x = left + drawLogo(left, 18, 50) + 18, metaWidth = 190, titleWidth = right - metaWidth - x - 12
      write('GMAC METALÚRGICA · GESTÃO FINANCEIRA', x, 22, titleWidth, 'semibold', 8.5, palette.orange)
      write(title, x, 35, titleWidth, 'bold', 18, palette.navyDark)
      write(`${periodLabel(report)} · Visão ${viewLabels[report.view].toLocaleLowerCase('pt-BR')} · valores em R$`, x, 59, titleWidth, 'regular', 9.5, palette.muted)
      write('Emitido em', right - metaWidth, 24, metaWidth, 'medium', 8.5, palette.muted, 'right')
      write(moment(report.generatedAt), right - metaWidth, 36, metaWidth, 'semibold', 9.5, palette.ink, 'right')
      doc.moveTo(left, 80).lineTo(right, 80).lineWidth(0.75).strokeColor(palette.line).stroke()
      y = 92
    }
    function continuationHeader() {
      doc.rect(0, 0, pageWidth, 4).fill(palette.navy); doc.rect(0, 0, 132, 4).fill(palette.orange)
      const x = left + drawLogo(left, 12, 26) + 10
      write('GMAC Metalúrgica', x, 15, 300, 'semibold', 9, palette.navy)
      write(`${title} · ${periodLabel(report)} · Visão ${viewLabels[report.view].toLocaleLowerCase('pt-BR')}`, x, 27, right - x, 'regular', 8.5, palette.muted)
      doc.moveTo(left, 46).lineTo(right, 46).lineWidth(0.75).strokeColor(palette.line).stroke()
      y = 56
    }
    doc.on('pageAdded', continuationHeader)
    firstHeader()
    for (const note of notes(report)) {
      const warning = note !== hint(report)
      const height = style('regular', 9, palette.ink).heightOfString(note, { width: width - 24 }) + 12
      if (warning) { doc.roundedRect(left, y, width, height, 5).fill(palette.warning); style('regular', 9, palette.warningText).text(note, left + 12, y + 6, { width: width - 24 }) }
      else style('regular', 9, palette.muted).text(note, left, y, { width })
      y += (warning ? height : height - 10) + 6
    }
    y += 4

    const rows = visibleDreRows(report), columns = dreColumns(report)
    // Months that do not fit on the width go to the next block; the total and the share of the revenue close the last one.
    const valueSize = 8, labelWidth = 220
    const widest = Math.max(52, ...rows.flatMap((row) => columns.map((column) => doc.font(fonts.semibold).fontSize(valueSize).widthOfString(cellText(report, row, column))))) + 12
    const monthColumns = columns.filter((column) => column.month), tail = columns.filter((column) => !column.month)
    const perBlock = report.months.length === 1 ? monthColumns.length : Math.max(1, Math.floor((width - labelWidth) / widest) - tail.length)
    const blocks = []
    for (let index = 0; index < monthColumns.length; index += perBlock) blocks.push(monthColumns.slice(index, index + perBlock))
    blocks[blocks.length - 1] = [...blocks[blocks.length - 1], ...tail]
    const heights = { section: 18, result: 19, group: 16, line: 15, info: 18 }
    blocks.forEach((block, blockIndex) => {
      // The label column takes the width the values leave, so the table always fills the page.
      const valueWidth = Math.min(widest + 30, (width - labelWidth) / block.length), nameWidth = width - valueWidth * block.length, tableWidth = width
      const head = () => {
        doc.rect(left, y, tableWidth, 22).fill(palette.navy)
        write(blocks.length > 1 ? `Linha da DRE (parte ${blockIndex + 1} de ${blocks.length})` : 'Linha da DRE', left + 8, y + 7, nameWidth - 12, 'semibold', 8.5, '#ffffff')
        block.forEach((column, index) => write(column.label, left + nameWidth + index * valueWidth, y + 7, valueWidth - 8, 'semibold', 8.5, '#ffffff', 'right'))
        y += 22
      }
      if (blockIndex && y + 120 > bottom) doc.addPage()
      head()
      rows.forEach((row, index) => {
        const height = heights[row.type]
        if (y + height > bottom) { doc.addPage(); head() }
        const strong = row.type !== 'line', final = row.key === 'net_income'
        if (final) doc.rect(left, y, tableWidth, height).fill(palette.navyDark)
        else if (row.type === 'result') doc.rect(left, y, tableWidth, height).fill(palette.result)
        else if (row.type === 'section' || row.type === 'info') doc.rect(left, y, tableWidth, height).fill(palette.section)
        else if (index % 2) doc.rect(left, y, tableWidth, height).fill('#fafcfe')
        const weight = row.type === 'line' ? 'regular' : row.type === 'group' ? 'semibold' : 'bold', size = row.type === 'line' ? 8 : 8.5
        const indent = (row.depth || 0) * 12, top = y + (height - size) / 2 - 1
        write(rowLabel(row), left + 8 + indent, top, nameWidth - 14 - indent, weight, size, final ? '#ffffff' : strong ? palette.navyDark : palette.ink)
        block.forEach((column, columnIndex) => {
          const value = dreCell(report, row, column)
          const tone = column.type === 'variation' ? { neutral: palette.muted, good: palette.positive, bad: palette.negative }[changeTone(variation(row, row.values[report.start], row.values[report.previousMonth]))] : row.type === 'result' && value < 0 ? palette.negative : palette.ink
          write(cellText(report, row, column), left + nameWidth + columnIndex * valueWidth, top, valueWidth - 8, row.type === 'line' ? 'regular' : 'semibold', size, final ? '#ffffff' : tone, 'right')
        })
        y += height
        doc.moveTo(left, y).lineTo(left + tableWidth, y).lineWidth(0.4).strokeColor(palette.line).stroke()
      })
      y += 16
    })

    const pages = doc.bufferedPageRange()
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index)
      doc.page.margins.bottom = 0
      doc.moveTo(left, pageHeight - 36).lineTo(right, pageHeight - 36).lineWidth(0.5).strokeColor(palette.line).stroke()
      write(`GMAC Metalúrgica · ${title}`, left, pageHeight - 27, width * 0.45, 'semibold', 8, palette.navy)
      write(`Emitido em ${moment(report.generatedAt)}`, left + width * 0.45, pageHeight - 27, width * 0.3, 'regular', 8, palette.muted, 'center')
      write(`Página ${index + 1} de ${pages.count}`, right - width * 0.25, pageHeight - 27, width * 0.25, 'semibold', 8, palette.navy, 'right')
    }
    doc.end()
  })
}

export async function dreWorkbook(report, classifications) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'GMAC Metalúrgica'
  workbook.created = new Date(report.generatedAt)
  workbook.title = `DRE · ${periodLabel(report)}`
  const font = { name: 'Calibri', size: 11, color: { argb: 'FF243746' } }
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const columns = dreColumns(report), rows = visibleDreRows(report)
  const sheet = workbook.addWorksheet('DRE', { views: [{ state: 'frozen', ySplit: 6, xSplit: 2, showGridLines: false }] })
  sheet.columns = [{ width: 10 }, { width: 56 }, ...columns.map(() => ({ width: 17 }))]
  if (logo) sheet.addImage(workbook.addImage({ buffer: logo, extension: 'png' }), { tl: { col: 0.15, row: 0.2 }, ext: { width: 66, height: 50 } })
  sheet.getRow(1).height = 22; sheet.getRow(2).height = 18; sheet.getRow(3).height = 18
  Object.assign(sheet.getCell('B1'), { value: 'Demonstração do Resultado (DRE)', font: { ...font, size: 16, bold: true, color: { argb: 'FF0B2545' } } })
  Object.assign(sheet.getCell('B2'), { value: `GMAC Metalúrgica · ${periodLabel(report)} · Visão ${viewLabels[report.view].toLocaleLowerCase('pt-BR')} · valores em R$`, font: { ...font, color: { argb: 'FF6B7280' } } })
  Object.assign(sheet.getCell('B3'), { value: `Emitido em ${moment(report.generatedAt)}`, font: { ...font, color: { argb: 'FF6B7280' } } })
  Object.assign(sheet.getCell('B4'), { value: notes(report).join(' '), font: { ...font, size: 10, italic: true, color: { argb: report.unclassified.count ? 'FFA15C07' : 'FF6B7280' } }, alignment: { wrapText: true, vertical: 'top' } })
  sheet.getRow(4).height = report.unclassified.count ? 44 : 18
  const header = sheet.getRow(6)
  header.values = ['Código', 'Linha da DRE', ...columns.map((column) => column.label)]
  header.height = 26
  header.eachCell((cell, index) => Object.assign(cell, { font: { ...font, bold: true, color: { argb: 'FFFFFFFF' } }, fill: fill('FF0C4C91'), alignment: { vertical: 'middle', horizontal: index > 2 ? 'right' : 'left' } }))
  for (const row of rows) {
    const values = columns.map((column) => { const value = dreCell(report, row, column); return value == null ? null : column.type === 'percent' || column.type === 'variation' ? value / 100 : value / 100 })
    const line = sheet.addRow([row.type === 'line' || row.type === 'group' ? row.code || '' : '', row.label, ...values])
    const final = row.key === 'net_income', strong = row.type !== 'line'
    line.height = row.type === 'line' ? 18 : 21
    line.eachCell({ includeEmpty: true }, (cell, index) => {
      cell.font = { ...font, bold: strong, color: { argb: final ? 'FFFFFFFF' : strong ? 'FF0B2545' : 'FF243746' } }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5EE' } } }
      cell.alignment = { vertical: 'middle', ...(index === 2 ? { indent: row.depth || 0 } : {}) }
      if (final) cell.fill = fill('FF0B2545'); else if (row.type === 'result') cell.fill = fill('FFDBE6F4'); else if (row.type === 'section' || row.type === 'info') cell.fill = fill('FFEAF1F9')
      const column = columns[index - 3]
      if (column) cell.numFmt = column.type === 'percent' || column.type === 'variation' ? '0.0%;[Red]-0.0%' : '#,##0.00;[Red]-#,##0.00;"–"'
    })
  }

  const byId = new Map(classifications.map((item) => [item.id, item]))
  const details = workbook.addWorksheet('Lançamentos', { views: [{ state: 'frozen', ySplit: 1 }] })
  const detailColumns = [['Data', 12], ['Origem', 16], ['Tipo', 15], ['ID', 13], ['Nome', 32], ['Descrição', 44], ['Documento', 16], ['Código', 9], ['Classificação', 36], ['Grupo de contas', 28], ['Linha da DRE', 30], ['Valor (R$)', 16]]
  details.columns = detailColumns.map(([header, width]) => ({ header, width }))
  details.getRow(1).height = 26
  details.getRow(1).eachCell((cell) => Object.assign(cell, { font: { ...font, bold: true, color: { argb: 'FFFFFFFF' } }, fill: fill('FF0C4C91'), alignment: { vertical: 'middle' } }))
  report.entries.filter((entry) => report.months.includes(entry.month)).forEach((entry, index) => {
    const item = byId.get(entry.classificationId)
    const row = details.addRow([entry.date.split('-').reverse().join('/'), entrySourceLabels[entry.source], entryKindLabels[entry.kind], entry.refId, entry.name, entry.description, entry.documentNumber, item?.code || '', item?.name || 'Sem classificação', item?.groupName || '', item ? dreLines[item.dreLine]?.label || '' : '', entry.valueCents / 100])
    row.eachCell({ includeEmpty: true }, (cell) => { cell.font = font; cell.alignment = { vertical: 'top', wrapText: true }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5EE' } } }; if (index % 2 === 0) cell.fill = fill('FFF1F6FB') })
    row.getCell(12).numFmt = '#,##0.00;[Red]-#,##0.00'
  })
  details.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, details.rowCount), column: detailColumns.length } }
  for (const target of [sheet, details]) {
    target.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    target.headerFooter.oddFooter = '&LGMAC Metalúrgica · DRE&R Página &P de &N'
  }
  sheet.pageSetup.printTitlesRow = '6:6'
  details.pageSetup.printTitlesRow = '1:1'
  return workbook.xlsx.writeBuffer()
}
