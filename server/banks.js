// Banks registered in Cadastros > Bancos (name, branch and account). Every settlement (payment of a bill, receipt of a
// receivable, Tesouraria entry) records the bank the money left or entered. Before any bank is registered, the
// settlements keep working without one, as they did before.
export const bankLabel = (bank) => [bank.name, bank.agency && `Ag. ${bank.agency}`, bank.account && `C/C ${bank.account}`].filter(Boolean).join(' · ')

export function settlementBank(store, bankId) {
  const banks = store.banks || []
  if (bankId == null || bankId === '') {
    if (banks.length) throw Object.assign(new Error('Selecione o banco da baixa.'), { status: 400 })
    return {}
  }
  const bank = banks.find((row) => row.id === String(bankId))
  if (!bank) throw Object.assign(new Error('Banco não encontrado. Confira o cadastro em Cadastros > Bancos.'), { status: 400 })
  return { bankId: bank.id, bankName: bankLabel(bank) }
}

// The bank filter of a list, written in the notes of its PDF and Excel export.
export function bankFilterNote(store, bankId) {
  if (!bankId) return []
  const bank = (store.banks || []).find((row) => row.id === String(bankId))
  return [`Banco da baixa: ${bank ? bankLabel(bank) : bankId}`]
}

// Settlements made with a bank: a bank in use cannot be deleted.
export const bankInUse = (store, bankId) => [...(store.payables || []).map((row) => row.payment), ...(store.receivables || []).map((row) => row.receipt)].filter((settlement) => settlement?.bankId === bankId).length
