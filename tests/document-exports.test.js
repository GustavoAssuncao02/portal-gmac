import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { documentValue, exportPdf, exportWorkbook } from '../server/documentExports.js'

test('document formatting preserves zeros, monetary precision, percentages and Brazilian dates', () => {
  assert.equal(documentValue(0, 'Horas (decimal)'), '0,00')
  assert.equal(documentValue(25, 'Ativa (%)'), '25,00%')
  assert.equal(documentValue('2026-10-01'), '01/10/2026')
  assert.match(documentValue(1500.5, 'Valor (R$)'), /1\.500,50/)
  assert.equal(documentValue(null), 'Não informado')
})

test('exports retain all records and numeric values with readable rows, frozen headers and print setup', async () => {
  const report = { title: 'Teste de legibilidade', generatedAt: '2026-10-03T12:00:00Z', summary: [['Registros', 60]], notes: [], sections: [{ name: 'Valores', columns: ['ID', 'Descrição', 'Valor (R$)', 'Ativa (%)'], rows: Array.from({ length: 60 }, (_, i) => [`000${i}`, i === 0 ? 'Descrição muito longa. '.repeat(80) : 'Material industrial', 1250.5 + i, 25]) }] }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportWorkbook(report))
  const sheet = workbook.worksheets[0]
  assert.equal(sheet.rowCount, 61)
  assert.equal(sheet.getCell('A2').value, '0000')
  assert.equal(sheet.getCell('C2').value, 1250.5)
  assert.equal(sheet.getCell('C2').numFmt, '"R$" #,##0.00')
  assert.equal(sheet.getCell('D2').numFmt, '0.00"%"')
  assert.equal(sheet.views[0].ySplit, 1)
  assert.equal(sheet.views[0].xSplit, 1)
  assert.equal(sheet.pageSetup.printTitlesRow, '1:1')
  assert.ok(sheet.getRow(2).height > 24)
  assert.ok(sheet.getColumn(2).width >= 40)
  const pdf = await exportPdf(report)
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  assert.ok(pdf.length > 3000)
})
