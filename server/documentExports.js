import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

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
  const digits = String(value).replace(/\D/g, '')
  if (/\bCNPJ\b/.test(label) && /^\d{14}$/.test(String(value).trim())) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (/\bCPF\b/.test(label) && /^\d{11}$/.test(String(value).trim())) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
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

// Shared visual identity for every PDF of the portal (reports, accounts payable and proposals).
const assetDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const asset = (name) => { try { return readFileSync(path.join(assetDirectory, name)) } catch { return null } }
const interFonts = { regular: asset('fonts/Inter-Regular.ttf'), medium: asset('fonts/Inter-Medium.ttf'), semibold: asset('fonts/Inter-SemiBold.ttf'), bold: asset('fonts/Inter-Bold.ttf') }
const standardFonts = { regular: 'Helvetica', medium: 'Helvetica', semibold: 'Helvetica-Bold', bold: 'Helvetica-Bold' }
const logos = { color: asset('gmac-logo.png'), light: asset('gmac-logo-white.png') }
const logoRatio = 340 / 259
const palette = { navy: '#004185', navyDark: '#0b2545', orange: '#f5821f', ink: '#1f2937', body: '#374151', muted: '#6b7280', line: '#e3e8ef', soft: '#f5f8fc', head: '#eaf1f9', headLine: '#c8d6e8', zebra: '#f9fbfd', note: '#f2f6fc' }
const tones = {
  success: { bg: '#e6f6ec', fg: '#166534' }, danger: { bg: '#fdecec', fg: '#b42318' }, warning: { bg: '#fef4e2', fg: '#a15c07' },
  info: { bg: '#e8f0fb', fg: '#1d4f91' }, neutral: { bg: '#eef1f5', fg: '#4b5563' },
}
const statusColumn = (label) => /^(status|situação)$/i.test(String(label))
const empty = (value) => value == null || value === ''
function tone(value) {
  const text = String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/vencid|recusad|desativad|cancelad|atrasad|interromp/.test(text)) return tones.danger
  if (/pago|paga\b|conclu|recebid|adicionad|aceit|ativ/.test(text)) return tones.success
  if (/pendente|aguard|pausad|parcial|analise|vencer/.test(text)) return tones.warning
  if (/execu|andamento|finaliz|proposta/.test(text)) return tones.info
  return tones.neutral
}

export function exportPdf(report, { layout = 'classic', orientation } = {}) {
  return new Promise((resolve, reject) => {
    const landscape = orientation === 'landscape' || (!orientation && report.sections[0]?.columns.length <= 7 && report.sections.some((part) => !part.records && part.columns.length >= 5 && part.columns.length <= 7))
    const compact = layout === 'compact', executive = layout === 'executive'
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 70, bottom: 20, left: 36, right: 36 }, bufferPages: true, info: { Title: report.title, Author: 'GMAC Metalúrgica', Subject: report.eyebrow || 'Relatório', Creator: 'Portal GMAC' } })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    const fonts = {}
    for (const [weight, data] of Object.entries(interFonts)) {
      if (data) doc.registerFont(`Inter-${weight}`, data)
      fonts[weight] = data ? `Inter-${weight}` : standardFonts[weight]
    }
    const pageWidth = doc.page.width, pageHeight = doc.page.height
    const left = 36, width = pageWidth - 72, right = left + width
    const contentTop = 68, bottom = () => pageHeight - 56
    const base = compact ? 9 : 9.5
    const pad = compact ? { x: 7, y: 5 } : { x: 9, y: 7 }
    const cardPad = compact ? 10 : 14
    const eyebrow = (report.eyebrow || 'Relatório').toLocaleUpperCase('pt-BR')
    const issued = moment(report.generatedAt)
    const period = report.start || report.end ? `${date(report.start) || 'Sem limite inicial'} a ${date(report.end) || 'Sem limite final'}` : null
    let y = contentTop

    const style = (weight, size, color) => { current = { weight, size }; return doc.font(fonts[weight]).fontSize(size).fillColor(color) }
    const measure = (value, w, weight = 'regular', size = base) => doc.font(fonts[weight]).fontSize(size).heightOfString(String(value), { width: w, lineGap: 2 })
    const fitSize = (value, w, weight, size, min) => {
      let current = size
      while (current > min && doc.font(fonts[weight]).fontSize(current).widthOfString(String(value)) > w - 3) current -= 0.5
      return current
    }
    // Single-line labels are shortened explicitly so they never wrap into the margins.
    const truncate = (value, w, weight, size, options = {}) => {
      let text = String(value)
      doc.font(fonts[weight]).fontSize(size)
      if (doc.widthOfString(text, options) <= w) return text
      while (text.length > 1 && doc.widthOfString(`${text}…`, options) > w) text = text.slice(0, -1)
      return `${text.trimEnd()}…`
    }
    // PDFKit still wraps text with a width even when lineBreak is false, so single lines are shortened first.
    let current = { weight: 'regular', size: base }
    doc.line = (value, x, top, w, align = 'left', extra = {}) => doc.text(truncate(value, w - 1, current.weight, current.size, extra), x, top, { width: w, align, lineBreak: false, ...extra })
    const rule = (top, color = palette.line, thickness = 0.75) => doc.moveTo(left, top).lineTo(right, top).lineWidth(thickness).strokeColor(color).stroke()
    const cellText = (value, label) => empty(value) ? '—' : documentValue(value, label)
    function ensure(height) { if (y + Math.min(height, bottom() - contentTop) > bottom()) doc.addPage() }
    // Each logo is embedded once and referenced on every page.
    const logoImages = {}
    function logo(x, top, height, light = false) {
      const key = light ? 'light' : 'color'
      if (!logos[key]) return 0
      logoImages[key] ||= doc.openImage(logos[key])
      doc.image(logoImages[key], x, top, { height })
      return height * logoRatio
    }

    function metaBlock(x, top, w, light) {
      let line = top
      for (const [label, value] of [['Emitido em', issued], ...(period ? [['Período', period]] : [])]) {
        style('medium', 9, light ? '#b9cde6' : palette.muted).line(label, x, line, w, 'right')
        style('semibold', 9.5, light ? '#ffffff' : palette.ink).line(value, x, line + 12, w, 'right')
        line += 27
      }
    }
    function firstPageHeader() {
      const metaWidth = landscape ? 200 : 132
      if (executive) {
        doc.rect(0, 0, pageWidth, 124).fill(palette.navyDark)
        doc.rect(0, 124, pageWidth, 4).fill(palette.orange)
        const x = left + logo(left, 32, 56, true) + 20
        const titleWidth = right - metaWidth - x - 16
        style('semibold', 9, palette.orange).line(`GMAC METALÚRGICA · ${eyebrow}`, x, 38, titleWidth, 'left', { characterSpacing: 1 })
        style('bold', fitSize(report.title, titleWidth, 'bold', 23, 14), '#ffffff').line(report.title, x, 54, titleWidth, 'left')
        metaBlock(right - metaWidth, 38, metaWidth, true)
        y = 150
        return
      }
      doc.rect(0, 0, pageWidth, 5).fill(palette.navy)
      doc.rect(0, 0, 132, 5).fill(palette.orange)
      const logoHeight = compact ? 40 : 50
      const x = left + logo(left, compact ? 20 : 22, logoHeight) + 18
      const titleWidth = right - metaWidth - x - 16
      style('semibold', 9, palette.orange).line(`GMAC METALÚRGICA · ${eyebrow}`, x, compact ? 24 : 27, titleWidth, 'left', { characterSpacing: 1 })
      style('bold', fitSize(report.title, titleWidth, 'bold', compact ? 17 : 20, 13), palette.navyDark).line(report.title, x, compact ? 37 : 41, titleWidth, 'left')
      metaBlock(right - metaWidth, compact ? 22 : 25, metaWidth, false)
      const divider = compact ? 74 : 86
      rule(divider)
      y = divider + (compact ? 14 : 18)
    }
    function continuationHeader() {
      doc.rect(0, 0, pageWidth, 4).fill(palette.navy)
      doc.rect(0, 0, 132, 4).fill(palette.orange)
      const x = left + logo(left, 15, 26) + 10
      style('semibold', 9, palette.navy).line('GMAC Metalúrgica', x, 18, right - x, 'left')
      style('regular', 9, palette.muted).line(report.title, x, 30, right - x, 'left')
      rule(50)
      y = contentTop
    }
    doc.on('pageAdded', continuationHeader)
    firstPageHeader()

    // Long text continues across pages instead of being cut or squeezed.
    function flowText(value, x, w, { weight = 'regular', size = base, color = palette.ink } = {}) {
      let rest = String(value)
      while (rest) {
        style(weight, size, color)
        const options = { width: w, lineGap: 2 }
        const available = bottom() - y
        const full = doc.heightOfString(rest, options)
        if (full <= available) { doc.text(rest, x, y, options); y += full; return }
        const words = rest.split(/(\s+)/)
        let low = 0, high = words.length
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (doc.heightOfString(words.slice(0, middle).join(''), options) <= available) low = middle
          else high = middle - 1
        }
        if (low === 0 && y > contentTop) { doc.addPage(); continue }
        low ||= 1
        doc.text(words.slice(0, low).join(''), x, y, options)
        rest = words.slice(low).join('').replace(/^\s+/, '')
        doc.addPage()
      }
    }

    function summaryCards() {
      const items = report.summary || []
      if (!items.length) return
      const perRow = Math.min(items.length, landscape ? 5 : 4)
      const gap = 10, cardWidth = (width - gap * (perRow - 1)) / perRow, cardHeight = compact ? 48 : 58
      for (let start = 0; start < items.length; start += perRow) {
        ensure(cardHeight)
        items.slice(start, start + perRow).forEach(([label, value], index) => {
          const x = left + index * (cardWidth + gap), strong = report.highlight && start + index === 0
          const text = documentValue(value, label)
          doc.roundedRect(x, y, cardWidth, cardHeight, 6).fill(strong ? palette.navy : palette.soft)
          if (!strong) doc.roundedRect(x, y, cardWidth, cardHeight, 6).lineWidth(0.75).strokeColor(palette.line).stroke()
          doc.roundedRect(x + 6, y + 11, 3, cardHeight - 22, 1.5).fill(palette.orange)
          style('medium', 9, strong ? '#c7d7ee' : palette.muted).line(label, x + 17, y + (compact ? 9 : 11), cardWidth - 28, 'left')
          style('bold', fitSize(text, cardWidth - 28, 'bold', compact ? 13 : 16, 9.5), strong ? '#ffffff' : palette.navyDark).line(text, x + 17, y + (compact ? 24 : 29), cardWidth - 28, 'left')
        })
        y += cardHeight + 10
      }
    }

    function notesBox() {
      const notes = report.notes || []
      if (!notes.length) return
      const noteWidth = width - 40
      const heights = notes.map((note) => measure(note, noteWidth, 'regular', 9))
      const height = heights.reduce((sum, value) => sum + value + 5, 0) + 30
      if (height > bottom() - contentTop) { for (const note of notes) { flowText(note, left, width, { size: 9, color: palette.body }); y += 6 } return }
      ensure(height)
      doc.roundedRect(left, y, width, height, 6).fill(palette.note)
      doc.roundedRect(left, y, 3, height, 1.5).fill(palette.navy)
      style('semibold', 9, palette.navy).line('OBSERVAÇÕES', left + 16, y + 10, right - (left + 16), 'left', { characterSpacing: 0.8 })
      let line = y + 25
      notes.forEach((note, index) => {
        doc.circle(left + 19, line + 5.5, 1.7).fill(palette.navy)
        style('regular', 9, palette.body).text(note, left + 26, line, { width: noteWidth, lineGap: 2 })
        line += heights[index] + 5
      })
      y += height + 12
    }

    function chip(value, x, top, maxWidth, alignRight = false) {
      const colors = tone(value)
      const chipWidth = Math.min(maxWidth, doc.font(fonts.semibold).fontSize(9).widthOfString(value) + 18)
      const start = alignRight ? x - chipWidth : x
      doc.roundedRect(start, top, chipWidth, 17, 8.5).fill(colors.bg)
      style('semibold', 9, colors.fg).line(value, start + 8, top + 4, chipWidth - 14, 'left')
    }

    const headingHeight = compact ? 28 : 36
    function heading(part) {
      y += compact ? 4 : 8
      doc.roundedRect(left, y + 1, 4, 15, 2).fill(palette.orange)
      style('bold', compact ? 11.5 : 12.5, palette.navyDark).line(part.name, left + 12, y, width - 150, 'left')
      if (!part.singleRecord) style('regular', 9, palette.muted).line(`${part.rows.length} ${part.rows.length === 1 ? 'registro' : 'registros'}`, right - 140, y + 3, 140, 'right')
      y += compact ? 22 : 26
    }

    function emptyState() {
      ensure(38)
      doc.roundedRect(left, y, width, 34, 6).fill(palette.soft)
      style('regular', base, palette.muted).line('Nenhum registro no período selecionado.', left + 14, y + 11, width - 28, 'left')
      y += 46
    }

    // Records with many fields are shown as cards with a field grid, split across pages when necessary.
    function cardLayout(part, row) {
      const single = part.singleRecord
      const statusIndex = single ? -1 : part.columns.findIndex(statusColumn)
      // Lists with many records use one more field column to keep the document shorter.
      const perRow = (landscape ? 4 : 3) + (single ? 0 : 1), gap = 16, inner = width - 2 * cardPad, rowGap = single ? 12 : 9
      const columnWidth = (inner - gap * (perRow - 1)) / perRow
      const fields = part.columns.map((label, index) => ({ label, index, text: cellText(row[index], label), missing: empty(row[index]) })).filter((field) => single || (field.index !== 0 && field.index !== statusIndex))
      const lines = []
      let current = []
      const flush = () => { if (current.length) lines.push({ fields: current, wide: false }); current = [] }
      for (const field of fields) {
        if (field.text.length > (landscape ? 90 : 60) || field.text.includes('\n')) {
          if (current.length) { lines.push({ fields: current, wide: false, stretch: true }); current = [] }
          lines.push({ fields: [field], wide: true })
          continue
        }
        current.push(field)
        if (current.length === perRow) flush()
      }
      flush()
      for (const line of lines) {
        line.fieldWidth = line.wide ? inner : line.stretch ? (inner - gap * (line.fields.length - 1)) / line.fields.length : columnWidth
        const fieldWidth = line.fieldWidth
        line.height = Math.max(...line.fields.map((field) => measure(field.label, fieldWidth, 'medium', 9) + 3 + measure(field.text, fieldWidth))) + rowGap
        line.flow = line.wide && line.height > bottom() - contentTop - 90
      }
      return { lines, columnWidth, gap, inner, statusIndex, rowGap }
    }
    function cardFirstHeight(part, row) {
      const { lines, rowGap } = cardLayout(part, row)
      const total = (part.singleRecord ? 0 : 34) + cardPad * 2 + lines.reduce((sum, line) => sum + line.height, 0) - rowGap
      // Keeps the section title with its first card when that card is moved whole to the next page.
      if (!lines.some((line) => line.flow) && total <= (bottom() - contentTop) * 0.75) return total
      return (part.singleRecord ? 0 : 34) + cardPad * 2 + (lines[0] && !lines[0].flow ? lines[0].height : 40)
    }
    function card(part, row, index) {
      const { lines, gap, inner, statusIndex, rowGap } = cardLayout(part, row)
      const headerHeight = part.singleRecord ? 0 : 34
      // A card that fits on one page is moved whole instead of being split.
      const total = headerHeight + cardPad * 2 + lines.reduce((sum, line) => sum + line.height, 0) - rowGap
      if (!lines.some((line) => line.flow) && total <= (bottom() - contentTop) * 0.75 && y + total > bottom()) doc.addPage()
      let next = 0, first = true
      while (next < lines.length || first) {
        if (lines[next]?.flow && !(first && headerHeight)) {
          const field = lines[next].fields[0]
          ensure(60)
          style('medium', 9, palette.muted).line(field.label, left + cardPad, y, inner, 'left')
          y += 14
          flowText(field.text, left + cardPad, inner)
          y += 12
          next++
          first = false
          continue
        }
        // Every part of a split card repeats its identification.
        const head = headerHeight
        ensure(head + cardPad * 2 + (lines[next] && !lines[next].flow ? lines[next].height : 40))
        const available = bottom() - y
        let used = head + cardPad, count = 0
        while (next + count < lines.length && !lines[next + count].flow && (count === 0 || used + lines[next + count].height + cardPad <= available)) { used += lines[next + count].height; count++ }
        const boxHeight = count ? used + cardPad - rowGap : head || cardPad * 2
        doc.roundedRect(left, y, width, boxHeight, 7).fill('#ffffff')
        if (head) {
          doc.roundedRect(left, y, width, head, 7).fill(palette.soft)
          doc.rect(left, y + head - 8, width, 8).fill(palette.soft)
          doc.moveTo(left, y + head).lineTo(right, y + head).lineWidth(0.75).strokeColor(palette.line).stroke()
          const title = `${cellText(row[0], part.columns[0])}${first ? '' : ' (continuação)'}`
          const status = statusIndex >= 0 && !empty(row[statusIndex]) ? documentValue(row[statusIndex], part.columns[statusIndex]) : null
          const counter = `${index + 1} de ${part.rows.length}`
          const counterWidth = doc.font(fonts.regular).fontSize(9).widthOfString(counter)
          const reserved = counterWidth + (status ? 130 : 0) + 20
          style('semibold', 11, palette.navyDark).line(title, left + cardPad, y + 11, width - 2 * cardPad - reserved, 'left')
          if (status) chip(status, right - cardPad, y + 8.5, 120, true)
          style('regular', 9, palette.muted).line(counter, right - cardPad - (status ? 130 : 0) - counterWidth - 4, y + 12, counterWidth + 4, 'left')
        }
        doc.roundedRect(left, y, width, boxHeight, 7).lineWidth(0.75).strokeColor(palette.line).stroke()
        let top = y + head + cardPad
        for (const line of lines.slice(next, next + count)) {
          line.fields.forEach((field, column) => {
            const fieldWidth = line.fieldWidth, x = left + cardPad + column * (fieldWidth + gap)
            style('medium', 9, palette.muted).text(field.label, x, top, { width: fieldWidth, lineGap: 2 })
            style('regular', base, field.missing ? '#9ca3af' : palette.ink).text(field.text, x, doc.y + 3, { width: fieldWidth, lineGap: 2 })
          })
          top += line.height
        }
        y += boxHeight + 10
        next += count
        first = false
      }
    }

    function columnWidths(part) {
      const sample = part.rows.slice(0, 200)
      const textWidth = (text, weight, size) => doc.font(fonts[weight]).fontSize(size).widthOfString(String(text))
      const longestWord = (text, weight, size) => Math.max(0, ...String(text).split(/\s+/).map((word) => textWidth(word, weight, size)))
      const columns = part.columns.map((label, column) => {
        const values = sample.map((row) => cellText(row[column], label))
        const extra = 2 * pad.x + 2 + (statusColumn(label) ? 18 : 0)
        const minimum = Math.min(170, Math.max(longestWord(label, 'semibold', 9), ...values.map((text) => longestWord(text, 'regular', base)))) + extra
        const natural = Math.max(textWidth(label, 'semibold', 9), ...values.map((text) => Math.min(240, textWidth(text, 'regular', base)))) + extra
        return { minimum, natural: Math.max(natural, minimum) }
      })
      const total = (key) => columns.reduce((sum, column) => sum + column[key], 0)
      const natural = total('natural'), minimum = total('minimum')
      if (natural <= width) return columns.map((column) => column.natural * width / natural)
      if (minimum >= width) return columns.map((column) => column.minimum * width / minimum)
      return columns.map((column) => column.minimum + (width - minimum) * (column.natural - column.minimum) / (natural - minimum))
    }
    function tableLayout(part) {
      const widths = columnWidths(part)
      const measureText = (value, label) => typeof value === 'number' || (/^(R\$\s?)?-?\d[\d.]*([,:]\d+)*\s?%?$/.test(documentValue(value, label).trim()) && /[,:%]|R\$/.test(documentValue(value, label)))
      const numeric = part.columns.map((label, i) => part.rows.some((row) => !empty(row[i])) && part.rows.every((row) => empty(row[i]) || measureText(row[i], label)))
      const status = part.columns.map(statusColumn)
      const headerHeight = Math.max(...part.columns.map((label, i) => measure(label, widths[i] - 2 * pad.x, 'semibold', 9))) + 2 * pad.y + 2
      const rowHeight = (row) => Math.max(...part.columns.map((label, i) => status[i] && !empty(row[i]) ? 17 : measure(cellText(row[i], label), widths[i] - 2 * pad.x))) + 2 * pad.y
      return { widths, numeric, status, headerHeight, rowHeight }
    }

    summaryCards()
    notesBox()
    for (const part of report.sections) {
      const asCards = part.records || part.columns.length > 7
      const table = !asCards && part.rows.length ? tableLayout(part) : null
      const firstBlock = !part.rows.length ? 40 : asCards ? cardFirstHeight(part, part.rows[0]) : table.headerHeight + Math.min(table.rowHeight(part.rows[0]), 80)
      ensure(headingHeight + firstBlock)
      heading(part)
      if (!part.rows.length) { emptyState(); continue }
      if (asCards) { part.rows.forEach((row, index) => card(part, row, index)); y += 6; continue }
      const { widths, numeric, status, headerHeight, rowHeight } = table
      const tableHeader = () => {
        doc.rect(left, y, width, headerHeight).fill(palette.head)
        rule(y + headerHeight, palette.headLine, 1)
        let x = left
        part.columns.forEach((label, i) => { style('semibold', 9, palette.navy).text(label, x + pad.x, y + pad.y + 1, { width: widths[i] - 2 * pad.x, lineGap: 2, align: numeric[i] ? 'right' : 'left' }); x += widths[i] })
        y += headerHeight
      }
      let needsHeader = true
      part.rows.forEach((row, index) => {
        const height = rowHeight(row)
        if (height > (bottom() - contentTop) / 2) { y += 8; card(part, row, index); needsHeader = true; return }
        if (y + height > bottom()) { doc.addPage(); needsHeader = true }
        if (needsHeader) { tableHeader(); needsHeader = false }
        if (index % 2) doc.rect(left, y, width, height).fill(palette.zebra)
        let x = left
        part.columns.forEach((label, i) => {
          const missing = empty(row[i])
          if (status[i] && !missing) chip(documentValue(row[i], label), x + pad.x, y + pad.y, widths[i] - 2 * pad.x)
          else style('regular', base, missing ? '#9ca3af' : palette.ink).text(cellText(row[i], label), x + pad.x, y + pad.y, { width: widths[i] - 2 * pad.x, lineGap: 2, align: numeric[i] ? 'right' : 'left', features: numeric[i] ? ['tnum'] : [] })
          x += widths[i]
        })
        y += height
        rule(y, palette.line, 0.5)
      })
      y += 18
    }

    const pages = doc.bufferedPageRange()
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i)
      doc.page.margins.bottom = 0
      rule(pageHeight - 40, palette.line, 0.5)
      const brandArea = width * 0.48
      const brandWidth = doc.font(fonts.semibold).fontSize(8).widthOfString('GMAC Metalúrgica')
      style('semibold', 8, palette.navy).line('GMAC Metalúrgica', left, pageHeight - 30, brandWidth + 2, 'left')
      style('regular', 8, palette.muted).text(truncate(`· ${report.title}`, brandArea - brandWidth - 12, 'regular', 8), left + brandWidth + 5, pageHeight - 30, { lineBreak: false })
      style('regular', 8, palette.muted).line(`Emitido em ${issued}`, left + brandArea, pageHeight - 30, width * 0.3, 'center')
      style('semibold', 8, palette.navy).line(`Página ${i + 1} de ${pages.count}`, right - width * 0.22, pageHeight - 30, width * 0.22, 'right')
    }
    doc.end()
  })
}
