import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { missingFilesReport, missingStoredFiles, storedFileInventory } from '../server/storedFiles.js'

test('start-up check lists each document whose record exists but whose file is gone from the data folder', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gmac-stored-files-'))
  try {
    const put = async (folder, name) => { await mkdir(path.join(directory, folder), { recursive: true }); await writeFile(path.join(directory, folder, name), 'x') }
    await put('payable-files', 'kept')
    await put('files', 'drawing')
    await put('bank-statements', 'imp-1.ofx')
    const store = {
      payables: [{ id: 'PAG-000339', attachments: [{ id: 'lost', name: 'NF - Gmac Metalúrgica.pdf' }, { id: 'kept', name: 'Boleto.pdf' }], payment: { receipts: [{ id: 'proof', name: 'Comprovante.pdf' }] } }],
      payableEvents: [{ type: 'attachment_added', accountId: 'PAG-000339', at: '2026-10-02T13:00:00.000Z', details: { name: 'NF - Gmac Metalúrgica.pdf' } }],
      receivables: [{ id: 'REC-000001', attachments: [], receipt: null }],
      offers: [{ id: 'o1', code: 'OF-2026-0001', createdAt: '2026-10-01T12:00:00.000Z', attachments: [{ id: 'drawing', name: 'Desenho.pdf' }], proposalEmails: [{ sentAt: '2026-10-03T12:00:00.000Z', attachments: [{ id: 'mail', name: 'Proposta.pdf' }] }] }],
      // The OS repeats the offer's attachment: it is counted once.
      orders: [{ code: 'OS-2026-0001', attachments: [{ id: 'drawing', name: 'Desenho.pdf' }], purchaseOrders: [{ id: 'po', name: 'Pedido.pdf', uploadedAt: '2026-10-05T12:00:00.000Z' }] }],
      bankImports: [{ id: 'imp-1', fileName: 'extrato.ofx', importedAt: '2026-10-06T12:00:00.000Z' }],
    }
    const areas = await missingStoredFiles(storedFileInventory(store, directory))
    const byLabel = Object.fromEntries(areas.map((area) => [area.label, area]))
    assert.deepEqual(byLabel['Contas a Pagar e Tesouraria'].missing.map((file) => file.name), ['NF - Gmac Metalúrgica.pdf', 'Comprovante.pdf'])
    assert.equal(byLabel['Contas a Pagar e Tesouraria'].total, 3)
    assert.equal(byLabel['Ofertas e OS'].total, 3)
    assert.deepEqual(byLabel['Ofertas e OS'].missing.map((file) => file.where), ['OF-2026-0001 (e-mail da proposta)', 'OS-2026-0001 (pedido de compra)'])
    assert.equal(byLabel['Extratos OFX importados'].missing.length, 0)
    const report = missingFilesReport(areas)
    assert.ok(report.includes('ATENCAO: 2 de 3 arquivos de Contas a Pagar e Tesouraria estão sem o documento no disco:'))
    assert.ok(report.includes('  - PAG-000339 · NF - Gmac Metalúrgica.pdf · enviado em 02/10/2026'))
    assert.ok(report.includes('  - PAG-000339 · Comprovante.pdf · enviado em data não registrada'))
    assert.ok(report.includes('Arquivos de Contas a Receber: 0 com o documento no disco.'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
