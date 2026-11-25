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

// DANFSe of the national NFS-e (DANFSe v2.0): a label over each value; the provider and the taker share the same labels.
const danfsePage = (doc, note) => {
  const at = (x, y, size, text) => doc.fontSize(size).text(text, x, 842 - y - size, { lineBreak: false })
  at(270, 821, 9, 'DANFSe v2.0'); at(234, 811, 9, 'Documento Auxiliar da NFS-e'); at(446, 823, 8, 'Município: Feira de Santana - BA')
  at(12, 791, 7, 'CHAVE DE ACESSO DA NFS-e'); at(12, 783, 7, note.key)
  at(12, 771, 7, 'NÚMERO DA NFS-e'); at(157, 771, 7, 'COMPETÊNCIA DA NFS-e'); at(301, 771, 7, 'DATA E HORA DA EMISSÃO DA NFS-e')
  at(12, 763, 7, note.number); at(157, 763, 7, note.competence); at(301, 763, 7, note.issued)
  at(12, 750, 7, 'NÚMERO DA DPS'); at(157, 750, 7, 'SÉRIE DA DPS'); at(301, 750, 7, 'DATA E HORA DA EMISSÃO DA DPS')
  at(12, 742, 7, '23'); at(157, 742, 7, '70000'); at(301, 742, 7, note.dps)
  const party = (y, title, name, document) => {
    at(12, y, 7, title); at(157, y + 1, 6, 'CNPJ / CPF / NIF'); at(301, y + 1, 6, 'Indicador Municipal (Inscrição)'); at(446, y + 1, 6, 'Telefone')
    at(157, y - 7, 7, document); at(301, y - 7, 7, '-'); at(446, y - 7, 7, '-')
    at(12, y - 18, 6, 'Nome / Nome Empresarial'); at(301, y - 18, 6, 'Município / Sigla UF')
    at(12, y - 26, 7, name); at(301, y - 26, 7, 'Feira de Santana / BA')
  }
  party(710, 'PRESTADOR / FORNECEDOR', 'EMPRESA EMITENTE EXEMPLO LTDA', '99.888.777/0001-66')
  party(633, 'TOMADOR / ADQUIRENTE', note.customer, note.document)
  at(12, 558, 7, 'SERVIÇO PRESTADO'); at(157, 559, 6, 'Código de Tributação Nacional/Municipal'); at(157, 551, 7, '14.01.01 / -')
  at(12, 539, 7, 'Lubrificação, limpeza, revisão, conserto, manutenção e conservação de máquinas, ...')
  at(12, 528, 6, 'Descrição do Serviço'); at(12, 520, 7, note.service)
  at(12, 507, 7, 'TRIBUTAÇÃO MUNICIPAL (ISSQN)'); at(157, 508, 6, 'Tipo de Tributação do ISSQN'); at(157, 500, 7, 'Operação Tributável')
  at(12, 489, 6, 'BC ISSQN'); at(157, 489, 6, 'Alíquota Aplicada'); at(301, 489, 6, 'Retenção do ISSQN'); at(446, 489, 6, 'ISSQN Apurado')
  at(12, 481, 7, `R$ ${note.value}`); at(157, 481, 7, '5,00 %'); at(301, 481, 7, note.retention); at(446, 481, 7, `R$ ${note.iss}`)
  at(12, 469, 7, 'TRIBUTAÇÃO FEDERAL (EXCETO CBS)'); at(157, 470, 6, 'IRRF'); at(301, 470, 6, 'Contribuição Previdenciária - Retida'); at(446, 470, 6, 'Contribuições Sociais - Retidas')
  at(157, 462, 7, note.irrf || '-'); at(301, 462, 7, '-'); at(446, 462, 7, '-')
  at(12, 353, 7, 'VALOR TOTAL DA NFS-e'); at(157, 354, 6, 'VALOR DA OPERAÇÃO / SERVIÇO'); at(301, 354, 6, 'Desconto Incondicionado')
  at(157, 346, 7, `R$ ${note.value}`); at(301, 346, 7, '-')
  at(12, 335, 6, 'Total das Retenções (ISSQN / Federais)'); at(157, 335, 6, 'VALOR LÍQUIDO DA NFS-e'); at(301, 335, 6, 'Total do IBS/CBS'); at(446, 335, 6, 'VALOR LÍQUIDO DA NFS-e + IBS/CBS')
  at(12, 327, 7, `R$ ${note.iss}`); at(157, 327, 7, `R$ ${note.net}`); at(301, 327, 7, 'R$ 0,00'); at(446, 327, 7, 'R$ 0,00')
  at(12, 315, 7, 'INFORMAÇÕES COMPLEMENTARES')
  at(12, 302, 7, `Inf. Cont.: ${note.info}`)
  at(12, 294, 7, 'Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Federais: -; Estaduais: -; Municipais: -;')
  at(13, 40, 6, 'DATA CIENTIFICAÇÃO:'); at(302, 40, 6, 'N° NFS-e / CHAVE NFS-e'); at(302, 32, 7, `${note.number} / ${note.key}`)
}

// Newer NFS-e of Feira de Santana: the number of the note is an image (left out here); the values are in tables, each
// figure aligned to the right edge of its label.
const feiraNfsePage = (doc, note) => {
  const at = (x, y, size, text) => doc.fontSize(size).text(text, x, 842 - y - size, { lineBreak: false })
  const column = (x, y, label, value, size = 7.5) => { at(x, y, 6, label); const edge = x + doc.fontSize(6).widthOfString(label); at(edge - doc.fontSize(size).widthOfString(value), y - 13.5, size, value) }
  at(94, 819, 10.5, 'MUNICÍPIO DE FEIRA DE SANTANA'); at(94, 801, 9, 'Secretaria Municipal da Fazenda')
  at(102, 761, 9, 'NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e')
  at(12, 729, 6, 'Emissão (Horário de Brasília)'); at(152, 729, 6, 'Período de Competência'); at(277, 729, 6, 'Município de Prestação do Serviço')
  at(12, 718, 6, note.issued); at(152, 718, 6, note.competence); at(277, 718, 6, 'Feira de Santana - BA')
  const party = (y, title, nameLabel, name, document) => {
    at(16, y, 6, title); at(12, y - 14, 6, nameLabel); at(12, y - 26, 6, name)
    at(12, y - 41, 6, 'CPF/CNPJ'); at(104, y - 41, 6, 'Inscrição Municipal'); at(12, y - 53, 6, document); at(104, y - 53, 6, '389447')
  }
  party(678, 'PRESTADOR DE SERVIÇOS', 'Razão Social', 'EMPRESA EMITENTE EXEMPLO LTDA', '99.888.777/0001-66')
  party(561, 'TOMADOR DE SERVIÇOS', 'Nome/Razão Social', note.customer, note.document)
  at(16, 468, 6, 'SERVIÇO PRESTADO'); at(12, 457, 6, '1405 - Restauração, recondicionamento, pintura, corte, polimento e congêneres de objetos quaisquer.')
  at(16, 409, 6, 'DESCRIÇÃO DOS SERVIÇOS')
  note.lines.forEach((line, index) => at(12, 399 - index * 8.25, 7.5, line))
  at(16, 228, 6, 'TRIBUTOS FEDERAIS')
  for (const [x, label] of [[56, 'INSS (R$)'], [123, 'IR (R$)'], [186, 'PIS (R$)'], [271, 'COFINS (R$)'], [358, 'CSLL (R$)'], [490, 'Outras Retenções (R$)']]) column(x, 214, label, label === 'IR (R$)' ? note.ir || '0,00' : '0,00')
  at(16, 185, 6, 'VALORES')
  column(15, 171, 'Valor dos Serviços (R$)', note.value); column(120, 171, 'Deduções (R$)', '0,00'); column(331, 171, 'B.C. do ISS (R$)', note.value)
  column(388, 171, 'Alíquota ISS (%)', '5,00'); column(481, 171, 'ISS (R$)', '*****'); column(514, 171, 'ISS Retido (R$)', note.iss)
  column(449, 144, 'Valor Líquido (R$)', note.net); column(513, 144, 'Valor Total (R$)', note.value, 10.5)
  at(16, 113, 6, 'OUTRAS INFORMAÇÕES')
  at(12, 90, 6, `Chave de Acesso da NFS-e Nacional: ${note.key}`)
}

// pages: [{ kind: 'nfse' | 'nfe' | 'danfse' | 'nfseFeira' | 'other', ...note }]
export function invoicePdf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, compress: false })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    for (const page of pages) {
      doc.addPage({ size: page.kind === 'nfe' ? [842, 595] : [595, 842], margin: 0 })
      if (page.kind === 'nfse') nfsePage(doc, page)
      else if (page.kind === 'nfe') danfePage(doc, page)
      else if (page.kind === 'danfse') danfsePage(doc, page)
      else if (page.kind === 'nfseFeira') feiraNfsePage(doc, page)
      else doc.fontSize(12).text(page.text || 'Relatório interno', 50, 50)
    }
    doc.end()
  })
}

export const sampleNfse = { kind: 'nfse', number: '2026000000451', issued: '20/10/2026', customer: 'CLIENTE EXEMPLO SERVIÇOS LTDA', document: '11222333000181', lines: ['1 - SERVICO DE USINAGEM EM 10 PEÇAS DE EXEMPLO - R$ 1.654,40'], value: '1.654,40', iss: '82,72', net: '1.571,68', dues: '04/12/2026 - R$1.571,68' }
// National access key: municipality, environment, kind of registration, issuer's CNPJ, number of the NFS-e, year and month,
// code and check digit.
export const sampleDanfse = { kind: 'danfse', number: '42', competence: '24/11/2026', issued: '24/11/2026 09:12:37', dps: '23/11/2026 18:00:00', key: ['2910800', '2', '2', '99888777000166', '0000000000042', '2611', '804364095', '9'].join(''), customer: 'CLIENTE NACIONAL EXEMPLO S.A.', document: '55.666.777/0001-88', service: 'INSTALACAO DE PONTOS DE EXEMPLO E MANUTENCAO DE 02 PLATAFORMAS', info: 'COT 13001 - PDC 4500000001 - SOLICITANTE MARIA - VENCIMENTO 04/12/26', value: '58.924,59', retention: 'Retido pelo Tomador', iss: '2.946,23', net: '55.978,36' }
export const sampleFeiraNfse = { kind: 'nfseFeira', issued: '18/11/2026 17:15:58', competence: '11/2026', key: ['2910800', '1', '2', '99888777000166', '2026000000305', '2611', '041419538', '0'].join(''), customer: 'ALIMENTOS EXEMPLO NORDESTE LTDA', document: '08.111.222/0001-33', lines: ['1 - Serviço de usinagem na base de exemplo - R$ 2.205,95', 'Cotação: Nº 2022951', 'Pedido: Nº 4500000002', 'Solicitante: Mariana', 'Vencimento: 16/02/2027'], value: '2.205,95', iss: '110,30', net: '2.095,65' }
export const sampleNfe = { kind: 'nfe', number: '000.000.915', sheet: '1/1', key: '29261099888777000166550010000009151554320559', issued: '08/10/2026', customer: 'INDÚSTRIA EXEMPLO S.A', document: '44.555.666/0001-77', dues: [['001', '05/11/2026', '100.000,00'], ['002', '05/12/2026', '47.000,00']], value: '147.000,00', products: [['000976', 'CARRO DE LONA EXEMPLO 018702']] }
