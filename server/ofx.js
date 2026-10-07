// OFX 1.x (SGML) and 2.x (XML) statement reader. Leaf tags in SGML often have no closing tag, so the
// tree is built from tag tokens instead of an XML parser. Amounts are integer cents; dates keep the bank day.

const BALANCE_MEMOS = new Map([['SALDO ANTERIOR', 'opening'], ['SALDO TOTAL DISPONIVEL DIA', 'daily']])
const CREDIT_TYPES = new Set(['CREDIT', 'DEP', 'INT', 'DIV', 'DIRECTDEP'])
const DEBIT_TYPES = new Set(['DEBIT', 'PAYMENT', 'CHECK', 'FEE', 'SRVCHG', 'ATM', 'POS', 'CASH', 'DIRECTDEBIT', 'REPEATPMT'])
const CHARSETS = { 1252: 'windows-1252', 'WINDOWS-1252': 'windows-1252', 'ISO-8859-1': 'windows-1252', 8859: 'windows-1252', 'UTF-8': 'utf-8' }

export const normalizeText = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

function readHeader(bytes) {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 2048))).toString('latin1')
  const start = head.indexOf('<')
  const header = {}
  for (const line of (start < 0 ? head : head.slice(0, start)).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z]+)\s*:\s*(.*?)\s*$/)
    if (match) header[match[1]] = match[2]
  }
  const xml = head.match(/<\?OFX\s+([^?]*)\?>/i)
  if (xml) for (const [, key, value] of xml[1].matchAll(/([A-Z]+)="([^"]*)"/gi)) header[key.toUpperCase()] = value
  const encoding = head.match(/<\?xml[^>]*encoding="([^"]+)"/i)
  if (encoding) header.ENCODING = encoding[1]
  return header
}

// Strict UTF-8 first; the declared charset is used only when the bytes are not valid UTF-8.
export function decodeOfx(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const header = readHeader(bytes)
  const declared = header.CHARSET && header.CHARSET.toUpperCase() !== 'NONE' ? header.CHARSET.toUpperCase() : (header.ENCODING || '').toUpperCase()
  const warnings = []
  let text, encoding
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    encoding = 'utf-8'
    if (/[^\x00-\x7f]/.test(text) && declared && !['UTF-8', 'UTF8'].includes(declared)) warnings.push({ code: 'encoding-mismatch', message: `O cabeçalho declara ${[header.ENCODING, header.CHARSET].filter(Boolean).join(' / ')}, mas o conteúdo é UTF-8 válido. O arquivo foi lido como UTF-8.` })
  } catch {
    const fallback = CHARSETS[declared] || 'windows-1252'
    text = new TextDecoder(fallback).decode(bytes)
    encoding = fallback
    warnings.push({ code: 'encoding-fallback', message: `O conteúdo não é UTF-8 válido. O arquivo foi lido como ${fallback}${CHARSETS[declared] ? ', conforme o cabeçalho' : ' (codificação declarada não reconhecida)'}.` })
  }
  if (text.includes('�')) warnings.push({ code: 'replacement-character', message: 'O arquivo contém caracteres que não puderam ser decodificados (�). Confira os históricos afetados.' })
  if (/Ã[\u0080-¿]|Â[\u0080-¿]/.test(text)) warnings.push({ code: 'possible-mojibake', message: 'Foram encontrados textos com aparência de dupla codificação (ex.: "Ã"). Nenhuma correção automática foi aplicada.' })
  return { text, encoding, header, warnings }
}

export function parseSgml(text) {
  const start = text.indexOf('<OFX')
  const root = { name: 'ROOT', children: [] }
  const stack = [root]
  for (const [, closing, rawName, rawValue] of text.slice(start < 0 ? 0 : start).matchAll(/<(\/?)([A-Za-z0-9._]+)[^>]*>([^<]*)/g)) {
    const name = rawName.toUpperCase()
    if (closing) {
      const index = stack.findLastIndex((node) => node.name === name)
      if (index > 0) stack.length = index
      continue
    }
    const value = rawValue.replace(/\r?\n/g, ' ').trim()
    const node = { name, children: [] }
    stack.at(-1).children.push(node)
    if (value) node.value = value
    else stack.push(node)
  }
  return root
}

const all = (node, name) => node ? node.children.flatMap((child) => [...(child.name === name ? [child] : []), ...all(child, name)]) : []
const first = (node, name) => all(node, name)[0]
const leaf = (node, name) => node?.children.find((child) => child.name === name)?.value ?? null

// 20261001100000[-03:EST] -> bank day 2026-10-01, without converting to another time zone.
export function parseOfxDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?(?:\.\d+)?)?(?:\[([+-]?\d{1,2}(?:\.\d+)?)(?::([A-Za-z]+))?\])?$/)
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00', offset, zone] = match
  const date = `${year}-${month}-${day}`
  if (new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return null
  const hours = offset == null ? null : Number(offset)
  const sign = hours != null && hours < 0 ? '-' : '+'
  const offsetText = hours == null ? null : `${sign}${String(Math.trunc(Math.abs(hours))).padStart(2, '0')}:${String(Math.round(Math.abs(hours) % 1 * 60)).padStart(2, '0')}`
  return { raw: String(value).trim(), date, time: `${hour}:${minute}:${second}`, offset: offsetText, zone: zone || null, instant: offsetText ? `${date}T${hour}:${minute}:${second}${offsetText}` : null }
}

export function amountCents(value) {
  const text = String(value ?? '').trim().replace(',', '.')
  const match = text.match(/^([+-])?(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? (sign === '-' ? -cents : cents) : null
}

const digitsOf = (value) => value.replace(/\D/g, '')
function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  for (const size of [9, 10]) {
    const sum = [...cpf.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * (size + 1 - index), 0)
    if ((sum * 10 % 11) % 10 !== Number(cpf[size])) return false
  }
  return true
}
function validCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false
  for (const size of [12, 13]) {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const rest = [...cnpj.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * weights[index], 0) % 11
    if ((rest < 2 ? 0 : 11 - rest) !== Number(cnpj[size])) return false
  }
  return true
}
export const validDocument = (digits) => digits.length === 11 ? validCpf(digits) : digits.length === 14 ? validCnpj(digits) : false

// Only punctuated CPF/CNPJ with valid check digits are accepted; loose digit runs are not documents.
export function extractDocument(memo) {
  const text = String(memo ?? '')
  for (const [type, pattern] of [['cnpj', /(?<![\d.])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/g], ['cpf', /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g]]) {
    for (const match of text.matchAll(pattern)) {
      const digits = digitsOf(match[0])
      if (validDocument(digits)) return { type, digits, formatted: match[0], index: match.index }
    }
  }
  return null
}

const OPERATIONS = [
  ['PIX ENVIADO', 'pix-sent', 'PIX enviado', true],
  ['PIX RECEBIDO', 'pix-received', 'PIX recebido', true],
  ['BOLETO PAGO', 'bill-paid', 'Boleto pago', true],
  ['RECEBIMENTOS', 'collection-received', 'Recebimento de cobrança', true],
  ['TED RECEBIDA', 'ted-received', 'TED recebida', true],
  ['TED ENVIADA', 'ted-sent', 'TED enviada', true],
  ['SISPAG SALARIOS', 'payroll', 'Pagamento de salários (SISPAG)', false],
  ['PAGAMENTOS RECEITA FEDERAL', 'federal-tax', 'Pagamento à Receita Federal', false],
  ['AQUISICAO FORNECEDORES', 'supplier-acquisition', 'Aquisição fornecedores', false],
  ['IOF', 'iof', 'IOF', false],
  ['DA', 'automatic-debit', 'Débito automático', true],
]
export const operationLabels = Object.fromEntries([...OPERATIONS.map(([, key, label]) => [key, label]), ['other', 'Outros']])

// Suggests the operation and counterparty from the memo. It never invents a payee for generic memos.
export function describeMemo(memo) {
  const original = String(memo ?? '')
  const normalized = normalizeText(original)
  const document = extractDocument(original)
  const operation = OPERATIONS.find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix} `))
  const result = { operationType: operation?.[1] || 'other', counterpartyName: null, counterpartyReference: null, counterpartyDocument: document?.digits || null, documentType: document?.type || null, documentFormatted: document?.formatted || null }
  if (operation?.[1] === 'federal-tax') result.counterpartyName = 'RECEITA FEDERAL'
  if (!operation?.[3]) return result
  const prefixWords = operation[0].split(' ').length
  let rest = collapse(original).split(' ').slice(prefixWords).join(' ')
  if (document) rest = rest.replace(document.formatted, '')
  rest = collapse(rest)
  if (operation[1] === 'ted-received' || operation[1] === 'ted-sent') {
    const bank = rest.match(/^(\d{3}\.\d{4,5}\.)(.*)$/)
    if (bank) { result.counterpartyReference = bank[1].replace(/\.$/, ''); rest = collapse(bank[2]) }
  }
  if (operation[1] === 'pix-received') {
    const reference = rest.match(/^(.*?\d{2}\/\d{2})\s+(.+)$/)
    if (reference) { result.counterpartyReference = reference[1]; rest = reference[2] }
  }
  result.counterpartyName = rest || null
  return result
}

export const balanceKind = (memo) => BALANCE_MEMOS.get(normalizeText(memo)) || null
export function typeConsistency(type, cents) {
  if (cents === 0) return 'zero'
  if (CREDIT_TYPES.has(type)) return cents > 0 ? 'ok' : 'credit-negative'
  if (DEBIT_TYPES.has(type)) return cents < 0 ? 'ok' : 'debit-positive'
  return 'unchecked'
}

export function parseOfx(input) {
  const decoded = decodeOfx(input)
  const tree = parseSgml(decoded.text)
  const statement = first(tree, 'STMTRS') || first(tree, 'CCSTMTRS')
  if (!statement) throw Object.assign(new Error('Arquivo OFX sem extrato bancário (STMTRS).'), { status: 400 })
  const account = first(statement, 'BANKACCTFROM') || first(statement, 'CCACCTFROM')
  const list = first(statement, 'BANKTRANLIST')
  const ledger = first(statement, 'LEDGERBAL')
  const available = first(statement, 'AVAILBAL')
  const warnings = [...decoded.warnings]
  const records = all(list, 'STMTTRN').map((node, index) => {
    const raw = Object.fromEntries(node.children.filter((child) => child.value != null).map((child) => [child.name, child.value]))
    const posted = parseOfxDate(raw.DTPOSTED)
    const cents = amountCents(raw.TRNAMT)
    const memo = raw.MEMO ?? raw.NAME ?? ''
    return { position: index + 1, raw, trnType: (raw.TRNTYPE || '').toUpperCase(), fitId: raw.FITID ?? null, checkNum: raw.CHECKNUM ?? null, postedRaw: raw.DTPOSTED ?? null, posted, bankDate: posted?.date ?? null, amountCents: cents, memo, normalizedMemo: normalizeText(memo), balanceKind: balanceKind(memo) }
  })
  const invalid = records.filter((row) => !row.fitId || !row.bankDate || row.amountCents == null)
  for (const row of invalid) warnings.push({ code: 'invalid-record', message: `Registro ${row.position} ignorado: FITID, data ou valor inválido.`, position: row.position })
  const valid = records.filter((row) => !invalid.includes(row))
  const balances = valid.filter((row) => row.balanceKind).map((row) => ({ ...row, kind: row.balanceKind }))
  const transactions = valid.filter((row) => !row.balanceKind).map((row) => {
    const consistency = typeConsistency(row.trnType, row.amountCents)
    return { ...row, direction: row.amountCents > 0 ? 'in' : row.amountCents < 0 ? 'out' : 'zero', consistency, ...describeMemo(row.memo) }
  })
  for (const row of transactions.filter((item) => !['ok', 'unchecked'].includes(item.consistency))) warnings.push({ code: 'type-sign-mismatch', message: `FITID ${row.fitId}: TRNTYPE ${row.trnType} com valor ${row.amountCents < 0 ? 'negativo' : row.amountCents > 0 ? 'positivo' : 'zero'}. O sinal original foi mantido.`, fitId: row.fitId })
  const statementInfo = {
    currency: leaf(statement, 'CURDEF'),
    bankId: leaf(account, 'BANKID'),
    branchId: leaf(account, 'BRANCHID'),
    accountId: leaf(account, 'ACCTID'),
    accountType: leaf(account, 'ACCTTYPE'),
    start: parseOfxDate(leaf(list, 'DTSTART')),
    end: parseOfxDate(leaf(list, 'DTEND')),
    ledgerBalance: ledger ? { cents: amountCents(leaf(ledger, 'BALAMT')), raw: leaf(ledger, 'BALAMT'), asOf: parseOfxDate(leaf(ledger, 'DTASOF')) } : null,
    availableBalance: available ? { cents: amountCents(leaf(available, 'BALAMT')), raw: leaf(available, 'BALAMT'), asOf: parseOfxDate(leaf(available, 'DTASOF')) } : null,
    serverDate: parseOfxDate(leaf(first(tree, 'SONRS'), 'DTSERVER')),
  }
  if (!statementInfo.bankId || !statementInfo.accountId) throw Object.assign(new Error('O extrato não identifica banco e conta (BANKID/ACCTID).'), { status: 400 })
  const seen = new Map()
  for (const row of [...transactions, ...balances]) {
    const previous = seen.get(row.fitId)
    if (previous) warnings.push({ code: 'duplicate-fitid', message: `FITID ${row.fitId} aparece mais de uma vez no arquivo (registros ${previous.position} e ${row.position}).`, fitId: row.fitId })
    else seen.set(row.fitId, row)
  }
  return { header: decoded.header, encoding: decoded.encoding, statement: statementInfo, records, transactions, balances, warnings, validation: validateBalances(transactions, balances, statementInfo) }
}

// Daily closings group every movement of the day, wherever the bank placed the balance record.
export function validateBalances(transactions, balances, statement) {
  const sum = (rows) => rows.reduce((total, row) => total + row.amountCents, 0)
  const credits = transactions.filter((row) => row.amountCents > 0), debits = transactions.filter((row) => row.amountCents < 0)
  const opening = balances.find((row) => row.kind === 'opening') || null
  const result = { creditsCents: sum(credits), creditCount: credits.length, debitsCents: -sum(debits), debitCount: debits.length, openingCents: opening?.amountCents ?? null, openingDate: opening?.bankDate ?? null, computedFinalCents: null, ledgerCents: statement.ledgerBalance?.cents ?? null, differenceCents: null, days: [] }
  if (opening) {
    let running = opening.amountCents
    const dates = [...new Set(transactions.map((row) => row.bankDate))].sort()
    for (const date of dates) {
      const day = transactions.filter((row) => row.bankDate === date)
      running += sum(day)
      const reported = balances.filter((row) => row.kind === 'daily' && row.bankDate === date).at(-1)
      result.days.push({ date, movementCount: day.length, netCents: sum(day), closingCents: running, reportedCents: reported?.amountCents ?? null, matches: reported ? reported.amountCents === running : null })
    }
    result.computedFinalCents = running
    if (result.ledgerCents != null) result.differenceCents = result.ledgerCents - running
  }
  return result
}
