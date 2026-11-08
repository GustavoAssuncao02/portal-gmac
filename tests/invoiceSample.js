import PDFDocument from 'pdfkit'

// Fictitious invoices laid out like the ones GMAC issues (the labels and positions of the NFS-e of Feira de Santana and
// of the DANFE), with made-up companies and values. Positions are given as in the PDF (origin at the bottom left).
const nfsePage = (doc, note) => {
  const at = (x, y, size, text) => doc.fontSize(size).text(text, x, 842 - y - size, { lineBreak: false })
  at(138, 808, 13, 'NFS-e - NOTA FISCAL DE SERVIÇO ELETRÔNICA')
  at(15, 779, 18, 'Nº:'); at(42, 779, 18, note.number)
  at(15, 766, 10, 'Nº Interno:'); at(70, 766, 10, '00000999')
  at(202, 792, 10, 'Emitida em:'); at(202, 776, 12, note.issued)
  at(380, 792, 10, 'Código de Verificação:'); at(402, 779, 10, 'ABCD-1234')
  at(152, 740, 12, 'EMPRESA EMITENTE EXEMPLO LTDA')
  at(152, 726, 10, 'CPF/CNPJ: 99888777000166')
  at(25, 633, 12, 'Tomador do Serviço')
  at(26, 613, 11, `00000042 - ${note.customer}`)
  at(26, 589, 9, 'Número:'); at(91, 589, 9, '100'); at(290, 589, 9, 'CPF/CNPJ:'); at(390, 589, 9, note.document)
  at(25, 515, 12, 'Discriminação do Serviço')
  note.lines.forEach((line, index) => at(27, 496 - index * 10, 8, line))
  at(24, 421, 11, 'Valor do serviço:'); at(230, 421, 10, `R$ ${note.value}`)
  at(305, 421, 11, 'Valor do Serviço:'); at(513, 421, 10, `R$ ${note.value}`)
  at(22, 403, 10, '(=) Base de Cálculo:'); at(230, 403, 10, `R$ ${note.value}`)
  at(303, 403, 10, '(-) Retenções Federais'); at(532, 403, 10, 'R$ 0,00')
  at(303, 385, 10, '(-) ISS retido na Fonte:'); at(527, 385, 10, `R$ ${note.iss}`)
  at(23, 362, 11, '(=) Valor do ISS:'); at(238, 362, 11, `R$ ${note.iss}`)
  at(302, 362, 11, '(=) Valor Líquido:'); at(497, 362, 13, `R$ ${note.net}`)
  at(25, 328, 10, 'Vencimentos:'); at(94, 328, 9, note.dues)
  at(23, 303, 10, 'Construção Civil'); at(23, 289, 10, 'Matrícula CEI:')
}

const danfePage = (doc, note) => {
  const at = (x, y, size, text) => doc.fontSize(size).text(text, x, 595 - y - size, { lineBreak: false })
  at(173, 560, 12, 'EMPRESA EMITENTE EXEMPLO LTDA')
  at(413, 555, 16, 'DANFE'); at(388, 544, 8, 'DOCUMENTO AUXILIAR DA'); at(389, 536, 8, 'NOTA FISCAL ELETRÔNICA')
  at(402, 500, 10, 'Nº'); at(421, 500, 10, note.number); at(402, 477, 10, `FOLHA ${note.sheet}`)
  at(508, 519, 6, 'CHAVE DE ACESSO'); at(526, 528, 8, note.key)
  at(97, 426, 6, 'NOME/RAZÃO SOCIAL'); at(97, 418, 7, `00000042-${note.customer}`)
  at(524, 426, 6, 'CNPJ/CPF'); at(524, 418, 7, note.document)
  at(563, 445, 6, 'CNPJ'); at(562, 437, 7, '99.888.777/0001-66')
  at(652, 426, 6, 'DATA EMISSÃO'); at(652, 418, 7, note.issued)
  const columns = [101, 232, 363, 495]
  columns.forEach((x, index) => { at(x, 371, 6, 'FAT/DUP'); at(x + 45, 371, 6, 'VENCIMENTO'); at(x + 104, 371, 6, 'VALOR'); const dup = note.dues[index]; if (dup) { at(x, 360, 7, dup[0]); at(x + 45, 360, 7, dup[1]); at(x + 94, 360, 7, dup[2]) } })
  at(98, 333, 6, 'BASE CÁLCULO ICMS'); at(161, 325, 7, '0,00')
  at(627, 333, 6, 'VALOR TOTAL DOS PRODUTOS'); at(719, 325, 7, note.value)
  at(608, 307, 7, '0,00'); at(626, 315, 6, 'VALOR TOTAL DA NOTA'); at(719, 307, 7, note.value)
  at(102, 230, 6, 'CÓD.'); at(100, 221, 6, 'PROD.'); at(140, 227, 6, 'DESCRIÇÃO DOS PRODUTOS/SERVIÇOS'); at(258, 229, 5, 'QUANTIDADE'); at(300, 227, 6, 'NCM/SH')
  note.products.forEach(([code, name], index) => { at(103, 211 - index * 10, 7, code); at(140, 211 - index * 10, 6, name); at(295, 211 - index * 10, 7, '87168000') })
  at(107, 85, 6, 'INFORMAÇÕES COMPLEMENTARES')
}

// pages: [{ kind: 'nfse' | 'nfe' | 'other', ...note }]
export function invoicePdf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, compress: false })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    for (const page of pages) {
      doc.addPage({ size: page.kind === 'nfe' ? [842, 595] : [595, 842], margin: 0 })
      if (page.kind === 'nfse') nfsePage(doc, page)
      else if (page.kind === 'nfe') danfePage(doc, page)
      else doc.fontSize(12).text(page.text || 'Relatório interno', 50, 50)
    }
    doc.end()
  })
}

export const sampleNfse = { kind: 'nfse', number: '2026000000451', issued: '20/10/2026', customer: 'CLIENTE EXEMPLO SERVIÇOS LTDA', document: '11222333000181', lines: ['1 - SERVICO DE USINAGEM EM 10 PEÇAS DE EXEMPLO - R$ 1.654,40'], value: '1.654,40', iss: '82,72', net: '1.571,68', dues: '04/12/2026 - R$1.571,68' }
export const sampleNfe = { kind: 'nfe', number: '000.000.915', sheet: '1/1', key: '29261099888777000166550010000009151554320559', issued: '08/10/2026', customer: 'INDÚSTRIA EXEMPLO S.A', document: '44.555.666/0001-77', dues: [['001', '05/11/2026', '100.000,00'], ['002', '05/12/2026', '47.000,00']], value: '147.000,00', products: [['000976', 'CARRO DE LONA EXEMPLO 018702']] }
