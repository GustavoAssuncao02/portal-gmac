import { useEffect, useState } from 'react'
import { cachedResource } from './payablesApi.js'

// Banks of Cadastros > Bancos, read once per form (cache no navegador acelera a abertura; a rede sempre confirma).
export function useBanks() {
  const [banks, setBanks] = useState(null)
  useEffect(() => {
    let active = true
    cachedResource('/banks', (result) => { if (active) setBanks(result.items) }).catch(() => { if (active) setBanks((current) => current ?? []) })
    return () => { active = false }
  }, [])
  return banks
}

export const bankOptionLabel = (bank) => [bank.name, bank.agency && `Ag. ${bank.agency}`, bank.account && `C/C ${bank.account}`].filter(Boolean).join(' · ')

// The bank the money left or entered, required in every settlement once banks are registered.
export default function BankSelect({ value, onChange, disabled = false, className = '' }) {
  const banks = useBanks()
  if (banks && !banks.length) return <p className={`payable-hint bank-select-empty ${className}`}>Nenhum banco cadastrado: a baixa fica sem banco. Cadastre os bancos em Cadastros &gt; Bancos.</p>
  return <label className={className}>Banco<select aria-label="Banco" required value={value || ''} disabled={disabled || !banks} onChange={(event) => onChange(event.target.value)}><option value="">{banks ? 'Selecione o banco' : 'Carregando...'}</option>{(banks || []).map((bank) => <option key={bank.id} value={bank.id}>{bankOptionLabel(bank)}</option>)}</select></label>
}
