// Synthetic OFX 1.02 statement: balance records mid-day, two equal debits, a non-balance 'SALDO' memo and a R$ 0,18 ledger gap.
const header = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n'
const entry = ([type, date, amount, fitId, memo]) => `<STMTTRN>\n<TRNTYPE>${type}\n<DTPOSTED>${date}100000[-03:EST]\n<TRNAMT>${amount}\n<FITID>${fitId}\n<CHECKNUM>${fitId}\n<MEMO>${memo}\n</STMTTRN>\n`
export function sampleOfx(rows, ledger = '859.18', account = '0001234567') {
  return `${header}<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>BRL\n<BANKACCTFROM>\n<BANKID>0341\n<ACCTID>${account}\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n<DTSTART>20261001100000[-03:EST]\n<DTEND>20261002100000[-03:EST]\n${rows.map(entry).join('')}</BANKTRANLIST>\n<LEDGERBAL>\n<BALAMT>${ledger}\n<DTASOF>20261002100000[-03:EST]\n</LEDGERBAL>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n`
}
export const sampleRows = [
  ['CREDIT', '20260930', '2000.00', 'T0', 'SALDO ANTERIOR'],
  ['CREDIT', '20261001', '500.00', 'T1', 'RECEBIMENTOS CLIENTE TESTE LTDA 11.222.333/0001-81'],
  ['DEBIT', '20261001', '-800.00', 'T2', 'PIX ENVIADO SODEXO 49.930.514/0001-35'],
  ['DEBIT', '20261001', '-800.00', 'T3', 'BOLETO PAGO QUIRAVELLI I C P QUIM LTDA EPP 59.568.774/0001-66'],
  ['CREDIT', '20261001', '850.00', 'T4', 'SALDO TOTAL DISPONÍVEL DIA'],
  ['DEBIT', '20261001', '-50.00', 'T5', 'SISPAG SALARIOS'],
  ['DEBIT', '20261002', '-1.00', 'T6', 'IOF'],
  ['CREDIT', '20261002', '10.00', 'T7', 'SALDO EM CONTA REMUNERADA'],
]

// Sicoob (756) exports two OFX models, "money" (CRLF header) and "unix" (LF only): closed tags, Windows-1252 accents, short
// memos and the counterparty in <NAME>. The data below is fictitious; real statements are not versioned.
export const sicoobRecords = [
  ['CREDIT', '1500.00', 'S1', 'CRÉD.TED-STR', 'CLIENTE EXEMPLO INDUSTRIA E COM'],
  ['DEBIT', '-1000.00', 'S2', 'RDC AUTOMÁTICO'],
  ['DEBIT', '-200.00', 'S3', 'PIX EMITIDO OUTRA IF', 'Pagamento Pix ***.123.456-**'],
  ['CREDIT', '1000.00', 'S4', 'RESGATE RDC AUTOMÁTICO'],
  ['DEBIT', '-350.00', 'S5', 'DÉB.CONV.DEMAIS EMPRESAS'],
]
export function sicoobOfx(newline = '\n', records = sicoobRecords) {
  const header = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE'].join(newline)
  const rows = records.map(([type, amount, fitId, memo, name]) => ['<STMTTRN>', `<TRNTYPE>${type}</TRNTYPE>`, '<DTPOSTED>20261001120000[-3:BRT]</DTPOSTED>', `<TRNAMT>${amount}</TRNAMT>`, `<FITID>${fitId}</FITID>`, '<CHECKNUM>0</CHECKNUM>', `<MEMO>${memo}</MEMO>`, ...(name ? [`<NAME>${name}</NAME>`] : []), '</STMTTRN>'].join('\n')).join('\n')
  const body = ['<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', '<CODE>0</CODE>', '<SEVERITY>INFO</SEVERITY>', '</STATUS>', '<DTSERVER>20261016120000[-3:BRT]</DTSERVER>', '<LANGUAGE>POR</LANGUAGE>', '<FI>', '<ORG>Banco Cooperativo do Brasil</ORG>', '<FID>756</FID>', '</FI>', '</SONRS>', '</SIGNONMSGSRSV1>', '<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1</TRNUID>', '<STMTRS>', '<CURDEF>BRL</CURDEF>', '<BANKACCTFROM>', '<BANKID>756</BANKID>', '<BRANCHID>0001-0</BRANCHID>', '<ACCTID>12345-6</ACCTID>', '<ACCTTYPE>CHECKING</ACCTTYPE>', '</BANKACCTFROM>', '<BANKTRANLIST>', '<DTSTART>20261001120000[-3:BRT]</DTSTART>', '<DTEND>20261016120000[-3:BRT]</DTEND>', rows, '</BANKTRANLIST>', '<LEDGERBAL>', '<BALAMT>950.00</BALAMT>', '<DTASOF>20261015120000[-3:BRT]</DTASOF>', '</LEDGERBAL>', '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>'].join('\n')
  return Buffer.from(`${header}${newline}${body}`, 'latin1')
}
